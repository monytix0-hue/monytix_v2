# Backups

Back up the Postgres data volume with `pg_dump` from the running database. Restore with `psql` into an empty database, then run `database/verification` checks.

Store dump files outside this repository. Do not put connection strings or passwords in this folder.
