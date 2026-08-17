# Schema 2.0 migration and recovery

Opening a Schema 1.0 project starts a directory transaction. Schema 2.0 projects return immediately, so repeated opens are idempotent and do not create additional backups.

## Successful transaction

1. Copy the complete project directory to a hidden sibling backup named `.<project>.backup-v1-<transaction>`.
2. Copy the original into a hidden sibling staging directory. All new registry, project, workflow, backup-pointer, and migration-log files are written only in staging.
3. Validate the staged project, Screen registry, and workflow as one Schema 2.0 unit.
4. Rename the original to a temporary rollback directory and promote the validated staging directory into its place.
5. Remove the temporary rollback directory only after promotion succeeds.

`workflow/migration-backup-v1.json` is a pointer to the full backup, not a claim that two JSON files are a complete backup. `workflow/migration-log.json` records the transaction ID, backup directory, validation result, and completion time. Legacy files and visuals remain present because staging starts from a complete copy. The migration never invents fonts or components; an existing strict project enters blocked typography, component, and binding stages until real evidence exists.

## Failure and retry

Any exception before directory promotion leaves the original untouched. An exception after either rename moves the promoted directory aside and restores the original rollback directory. Temporary staging is then removed.

Failure evidence is written outside the restored project as `<project>.migration-failed.json`; this preserves byte-for-byte equality of the original tree. The record contains the transaction ID, failure point/reason, full-backup directory, whether backup completed, and whether recovery restored the original. Keep this log and its named backup when escalating an incident.

After resolving the cause, open the project again. A restored Schema 1.0 tree starts a fresh transaction; a successfully migrated Schema 2.0 tree performs no work.

## Verification

Automated tests inject a failure after every migration write or directory-switch point, compare the restored project-tree digest with the pre-migration digest, verify the full nested backup, retry successfully, and then verify a second run is a no-op.
