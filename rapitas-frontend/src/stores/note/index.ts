/**
 * stores/note
 *
 * The note store's parts. Components import the store from
 * `@/stores/note-store`; this barrel is for the modules that need a part
 * directly (the migration, the roadmap's server save).
 */
export * from './note-types';
export * from './note-api';
export * from './note-local-backup';
export * from './note-migration-record';
export { createNoteModalSlice, defaultModalState } from './note-modal-slice';
export type { ModalTab, SplitNoteSide, NoteModalState, NoteModalSlice } from './note-modal-slice';
