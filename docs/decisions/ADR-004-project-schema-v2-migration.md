# ADR-004: Project schema 2.0 migration

Status: accepted

Schema 2.0 separates global and screen-local artifacts and introduces a screen registry. Opening a 1.0 project performs a recoverable migration: write a backup, register `main`, preserve legacy visual results, avoid inventing font/component evidence, and record the migration. Failed migration restores the backup.

