# Historical Piggybudget database fixture

`piggybudget-eb40d62-populated.zip` is a synthetic PocketBase backup generated
from Piggybudget source commit
`eb40d6220d3de11d6cc36ec4456dce80be160cb3` (2026-10-04). The historical
Piggybudget binary was built from that commit and run with an isolated
`SLOPSTACK_STORAGE_PATH` to bootstrap the database. A helper test compiled from
the same source snapshot cloned that database, seeded a synthetic user,
account, transaction, and asset with stable record IDs, and called that
version's `CreateBackup` implementation. The archive contains no user data.

SHA-256: `0b85c1d9717ca7c6d58fcb880c3a2e55287fdfefbb7cac4a6b36017305348494`.

`apps/server/historical_source_fixture_test.go` restores the archive into a
new temporary directory, verifies the historical schema lacks transaction
attachment and asset group collections, applies the current migrations twice,
and checks that the finance record IDs and values survive. This exercises a
populated historical-source database with real pending app migrations.
