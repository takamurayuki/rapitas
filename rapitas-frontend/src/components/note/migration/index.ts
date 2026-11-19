/**
 * note/migration
 *
 * Moving this browser's notes onto the server (design §5.3): the band and
 * difference list on the /notes page, the hook that drives them, and the
 * pure plan and runner behind it.
 */
export { default as NoteMigrationBanner } from './NoteMigrationBanner';
export { default as NoteMigrationDiffList } from './NoteMigrationDiffList';
export { useNoteMigration } from './useNoteMigration';
export type { MigrationView, NoteMigrationControls } from './useNoteMigration';
export { runMigration, applyDecisions } from './note-migration-runner';
export { planMigration, normalizeLocalNote, sha256Hex } from './note-migration-plan';
export type { ManifestEntry, MigrationDiff, MigrationPlan } from './note-migration-plan';
export { httpMigrationApi } from './note-migration-api';
export type { MigrationApi } from './note-migration-api';
export { writeNoteBackup } from './note-migration-backup';
