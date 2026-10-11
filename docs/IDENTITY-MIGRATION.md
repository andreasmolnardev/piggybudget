# Piggybudget application identity

Piggybudget now has its own Go module (`github.com/piggybudget/piggybudget`),
server command (`apps/server/cmd/piggybudget`), root package (`piggybudget`), and
web package (`@piggybudget/web`). Docker builds produce a `piggybudget` image.

Runtime configuration uses `PIGGYBUDGET_*`. The server reads the corresponding
`SLOPSTACK_*` key as a deprecated alias when the Piggybudget key is unset or
empty. When both have values, the Piggybudget key wins. Move deployment secrets
and settings to the new prefix over time.

The data location is unchanged: local storage defaults to `pb_data`, Docker
stores it at `/app/pb_data`, and Compose keeps the existing `slopstack-data`
volume. No collection names, IDs, or migration files were renamed or rewritten.

Changing a Compose service name changes commands that address that service. The
service is now `piggybudget`; set `BACKUP_COMPOSE_SERVICE` when running the
backup smoke script with a custom Compose service name.
