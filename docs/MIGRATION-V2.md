# Schema 2.0 migration

Opening a 1.0 project captures `workflow/migration-backup-v1.json`, registers the legacy `main` Screen, separates global and Screen workflow state, preserves legacy visuals, and writes `workflow/migration-log.json`. The migration never invents fonts or components: existing strict projects enter blocked typography/component/binding stages until real evidence is provided. Atomic JSON writes prevent partial file replacement.

