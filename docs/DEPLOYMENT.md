# Deployment

## Docker

```sh
docker compose up --build
```

The image and service are named `piggybudget`. Project identity and build defaults are validated from [`slopstack.yaml`](../slopstack.yaml). PocketBase data persists in the existing `slopstack-data` volume mounted at `/app/pb_data`; keep that volume name and mount when upgrading an existing deployment.

The server build resolves the pinned Slopstack Go module v0.3.0 from `go.mod`,
so the image builds from this repository alone.

Pushes to `main` run the GitHub Actions image pipeline, which builds and pushes
`linux/amd64` and `linux/arm64` images to GHCR as `main` and `sha-<commit>`.
Version tags are published by the release workflow as the matching version and
`latest` tags. The image repository is `ghcr.io/andreasmolnardev/piggybudget`.

`pnpm deploy` validates the config and prints the multi-platform Buildx command by default. To publish, log in to the registry and opt in explicitly:

```sh
pnpm deploy --push
```

To build a local multi-platform OCI archive without registry access, run
`pnpm deploy --export ./piggybudget.oci.tar`. Publishing and exporting check
that the installed Docker Buildx version matches `tools.dockerBuildx` in
`slopstack.yaml`.

The command reads image repository, tag, platforms, registry host, and Buildx
version from `slopstack.yaml`.

`pnpm release --version 1.2.3` previews a release config update. Apply it with
`pnpm release --version 1.2.3 --apply`; that only updates `release.version` and
`image.tag` in `slopstack.yaml`. It does not create a Git tag, image, or release.

## Required production settings

- Set `PIGGYBUDGET_PUBLIC_URL` to the public origin.
- Set a durable `PIGGYBUDGET_STORAGE_PATH`.
- Keep PocketBase data outside ephemeral container storage.
- Set `PIGGYBUDGET_LOG_LEVEL` to `debug`, `info`, `warn`, or `error` to filter
  application `slog` output. PocketBase's persisted log settings still control
  its own logs.

Piggybudget's web client sends PocketBase bearer tokens; the server does not use
cookie authentication, so there is no secure-cookie setting to configure.

## Reverse proxy and upgrades

Terminate HTTPS at a trusted reverse proxy and forward requests to the private
server port. Keep the `Host` and forwarded protocol headers intact so links and
redirects use the public HTTPS origin. For Caddy:

```caddyfile
finance.example.com {
    reverse_proxy 127.0.0.1:8090
}
```

Set `PIGGYBUDGET_PUBLIC_URL=https://finance.example.com`. Keep port 8090 off
the public network. Before an upgrade, create a backup and retain a copy outside
the live volume. Deploy the new image with the existing data volume mounted;
PocketBase applies additive migrations at startup. Check `/api/health` after
startup. If the new version cannot use the data, stop all app instances and
restore the pre-upgrade archive before restarting the previous image.

`PIGGYBUDGET_REGISTRATION_MODE=otp` currently stores a generated activation
code but does not deliver it by email. Use `approval` until mail delivery is
configured; activation codes are never written to application logs.

The `PIGGYBUDGET_*` names are preferred. Existing `SLOPSTACK_*` names remain supported as deprecated aliases; the Piggybudget value wins if both are set.

Run `pnpm config:check` to validate the Slopstack config schema and verify that
its app identity matches the Go module and web package.

## Backups

Scheduled backups use PocketBase's transaction-safe backup engine. Docker enables one backup each day at 03:00 and keeps the newest 14 archives. Local archives are stored under `pb_data/backups`.

Set these values to change the schedule:

```sh
PIGGYBUDGET_BACKUP_ENABLED=true
PIGGYBUDGET_BACKUP_CRON="0 3 * * *"
PIGGYBUDGET_BACKUP_MAX_KEEP=14
```

Local archives share the same storage volume as the live database. This protects against bad writes, but not disk or volume loss. Production systems should use private S3-compatible storage:

```sh
PIGGYBUDGET_BACKUP_S3_ENABLED=true
PIGGYBUDGET_BACKUP_S3_BUCKET=piggybudget-backups
PIGGYBUDGET_BACKUP_S3_REGION=us-east-1
PIGGYBUDGET_BACKUP_S3_ENDPOINT=https://s3.example.com
PIGGYBUDGET_BACKUP_S3_ACCESS_KEY=...
PIGGYBUDGET_BACKUP_S3_SECRET=...
PIGGYBUDGET_BACKUP_S3_FORCE_PATH_STYLE=false
```

Use a private bucket, TLS, a dedicated least-privilege key, versioning, and server-side encryption. Keep credentials in the deployment secret store. Do not commit them.

Use the current server CLI for manual backup work:

```sh
piggybudget backup create
piggybudget backup list
piggybudget backup restore <exact-name-from-list> --confirm
```

`backup create` prints the new archive name. `backup restore` rejects paths and other unsafe names, requires an exact archive name, and will not run without `--confirm`. Restore replaces the live PocketBase data and restarts the process. Stop traffic and other app instances first. There is no app HTTP restore endpoint.

Manual encrypted archives use the shared Slopstack `SLBK1` envelope while
leaving PocketBase's archive format intact. Initialize a key once, keep the
printed recovery key out of logs and source control, then create encrypted
archives explicitly:

```sh
piggybudget backup key-init
piggybudget backup create --encrypt
piggybudget backup list
piggybudget backup key-import <recovery-key>
piggybudget backup restore <exact-name.zip.enc> --confirm
```

The existing `backup create` command continues to create a regular PocketBase
`.zip` archive. PocketBase's scheduled backups also remain regular `.zip`
archives; encrypt those at the storage layer when required. Encrypted archives
require the matching key in the target data directory before restore.

Keep at least twice the data size free during backup and restore. Restore a copy into an isolated instance first when possible. Run a restore drill after setup and at least monthly. A backup is not proven until restore succeeds.

### Disposable compatibility fixture

Run the repository smoke test from the project root:

```sh
./scripts/backup-restore-smoke-test.sh
```

The script builds the Piggybudget binary into a temporary directory, checks its
Go module and CLI identities, verifies the legacy storage setting against a
disposable directory, creates a PocketBase archive in a separate disposable
directory, and restores a copy into another disposable directory. It does not
use Docker Compose or the configured `pb_data` path and needs no deployment
credentials. It removes only the temporary fixture directory when it exits.

Run this check after identity, build, or backup changes. It does not inspect or
alter a production database or an existing deployment volume.

## Frontend

The frontend is a static Vite build copied into the image and served by the Go
runtime. `PIGGYBUDGET_PUBLIC_DIR` selects the static directory and defaults to
`public`; client-side routes fall back to `index.html`, while API and DAV paths
remain backend-owned. During development, Vite serves the frontend and proxies
`/api` to PocketBase. Set `VITE_API_URL` when the API uses a different public
origin.
