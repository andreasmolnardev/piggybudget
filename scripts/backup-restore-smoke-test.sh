#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_dir=$(dirname "$script_dir")
fixture_dir=$(mktemp -d "${TMPDIR:-/tmp}/piggybudget-backup-fixture.XXXXXX")
cleanup() {
	rm -rf "$fixture_dir"
}
trap cleanup EXIT HUP INT TERM

cd "$repo_dir"

binary="$fixture_dir/piggybudget"
source_dir="$fixture_dir/source-data"
restore_dir="$fixture_dir/restore-data"
historical_restore_dir="$fixture_dir/historical-restore-data"
legacy_dir="$fixture_dir/legacy-data"

mkdir -p "$source_dir" "$restore_dir/backups" "$historical_restore_dir/backups"

go build -o "$binary" ./apps/server/cmd/piggybudget
if [ "$(go list -m)" != "github.com/piggybudget/piggybudget" ]; then
	echo "Go module identity is not github.com/piggybudget/piggybudget" >&2
	exit 1
fi
if ! "$binary" --help | grep -Fq 'Piggybudget application server'; then
	echo "built server does not report the Piggybudget CLI identity" >&2
	exit 1
fi

# Exercise the deprecated environment alias against a disposable data dir.
env -u PIGGYBUDGET_STORAGE_PATH \
	PIGGYBUDGET_BACKUP_ENABLED=false \
	SLOPSTACK_STORAGE_PATH="$legacy_dir" \
	"$binary" backup list >/dev/null
if [ ! -s "$legacy_dir/data.db" ]; then
	echo "legacy storage alias did not create a database in the fixture directory" >&2
	exit 1
fi

archive=$(env -u SLOPSTACK_STORAGE_PATH \
	-u PIGGYBUDGET_BACKUP_RESTORE_RESTARTED \
	-u SLOPSTACK_BACKUP_RESTORE_RESTARTED \
	PIGGYBUDGET_BACKUP_ENABLED=false \
	PIGGYBUDGET_STORAGE_PATH="$source_dir" \
	"$binary" backup create)
if ! printf '%s\n' "$archive" | grep -Eq '^@?[a-z0-9_-]+\.zip$'; then
	echo "backup create did not return a plain archive name" >&2
	exit 1
fi

if ! env -u SLOPSTACK_STORAGE_PATH \
	PIGGYBUDGET_BACKUP_ENABLED=false \
	PIGGYBUDGET_STORAGE_PATH="$source_dir" \
	"$binary" backup list | grep -Fq "$archive"; then
	echo "backup list did not return the newly created fixture archive" >&2
	exit 1
fi

cp "$source_dir/backups/$archive" "$restore_dir/backups/$archive"
env -u SLOPSTACK_STORAGE_PATH \
	-u PIGGYBUDGET_BACKUP_RESTORE_RESTARTED \
	-u SLOPSTACK_BACKUP_RESTORE_RESTARTED \
	PIGGYBUDGET_BACKUP_ENABLED=false \
	PIGGYBUDGET_STORAGE_PATH="$restore_dir" \
	"$binary" backup restore "$archive" --confirm

if [ ! -s "$restore_dir/data.db" ]; then
	echo "restore did not place a database in the disposable target directory" >&2
	exit 1
fi

# Exercise the current CLI restore path with a populated archive from an older
# Piggybudget source revision. The fixture is synthetic and checked into source.
historical_archive=piggybudget-historical-fixture.zip
cp apps/server/testdata/piggybudget-eb40d62-populated.zip "$historical_restore_dir/backups/$historical_archive"
env -u SLOPSTACK_STORAGE_PATH \
	-u PIGGYBUDGET_BACKUP_RESTORE_RESTARTED \
	-u SLOPSTACK_BACKUP_RESTORE_RESTARTED \
	PIGGYBUDGET_BACKUP_ENABLED=false \
	PIGGYBUDGET_STORAGE_PATH="$historical_restore_dir" \
	"$binary" backup restore "$historical_archive" --confirm

python3 - "$historical_restore_dir/data.db" <<'PY'
import sqlite3
import sys

db = sqlite3.connect(sys.argv[1])
assert db.execute("SELECT email FROM users WHERE id = ?", ("histuser0000001",)).fetchone() == ("historical-piggy@example.invalid",)
assert db.execute("SELECT name, currency, opening_balance FROM accounts WHERE id = ?", ("histacct0000001",)).fetchone() == ("Historical checking", "EUR", 125.5)
assert db.execute("SELECT payee, description, category, amount FROM transactions WHERE id = ?", ("histtxn00000001",)).fetchone() == ("Historical market", "Synthetic historical transaction", "Groceries", -18.75)
assert db.execute("SELECT name, type, currency FROM assets WHERE id = ?", ("histasset000001",)).fetchone() == ("Historical index fund", "investment", "EUR")
for collection in ("transaction_attachments", "asset_groups", "asset_positions"):
    assert db.execute("SELECT 1 FROM _collections WHERE name = ?", (collection,)).fetchone(), f"missing migrated collection {collection}"
assert "asset_group" in {row[1] for row in db.execute("PRAGMA table_info(assets)")}
PY

env -u SLOPSTACK_STORAGE_PATH \
	PIGGYBUDGET_BACKUP_ENABLED=false \
	PIGGYBUDGET_STORAGE_PATH="$source_dir" \
	"$binary" backup key-init >"$fixture_dir/key-init.out"
recovery_key=$(awk 'NF { line = $0 } END { print line }' "$fixture_dir/key-init.out")
env -u SLOPSTACK_STORAGE_PATH \
	PIGGYBUDGET_BACKUP_ENABLED=false \
	PIGGYBUDGET_STORAGE_PATH="$source_dir" \
	"$binary" backup create --encrypt >"$fixture_dir/encrypted-name.out"
encrypted_archive=$(awk 'NF { line = $0 } END { print line }' "$fixture_dir/encrypted-name.out")
if ! printf '%s\n' "$encrypted_archive" | grep -Eq '^@?[a-z0-9_-]+\.zip\.enc$'; then
	echo "encrypted backup create did not return an encrypted archive name" >&2
	exit 1
fi
cp "$source_dir/backups/$encrypted_archive" "$restore_dir/backups/$encrypted_archive"
env -u SLOPSTACK_STORAGE_PATH \
	PIGGYBUDGET_BACKUP_ENABLED=false \
	PIGGYBUDGET_STORAGE_PATH="$restore_dir" \
	"$binary" backup key-import "$recovery_key"
env -u SLOPSTACK_STORAGE_PATH \
	-u PIGGYBUDGET_BACKUP_RESTORE_RESTARTED \
	-u SLOPSTACK_BACKUP_RESTORE_RESTARTED \
	PIGGYBUDGET_BACKUP_ENABLED=false \
	PIGGYBUDGET_STORAGE_PATH="$restore_dir" \
	"$binary" backup restore "$encrypted_archive" --confirm

printf 'identity, disposable plain/encrypted restore, and historical CLI restore checks passed: %s %s\n' "$archive" "$encrypted_archive"
