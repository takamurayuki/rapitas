/**
 * note/index
 *
 * Barrel re-exports for the note feature components. Import from this file
 * instead of referencing individual component paths from outside this folder.
 */
export { default as NoteModal } from './NoteModal';
export { default as NoteEditor } from './NoteEditor';
export { default as NoteSidebar } from './NoteSidebar';
export { default as NoteProvider } from './NoteProvider';
export { default as DeleteNoteModal } from './DeleteNoteModal';
export { default as AITabContent } from './ai-tab-content';
export { default as ChatMessage } from './chat-message';
export { default as DragOverlay } from './drag-overlay';
export { default as NoteModalHeader } from './note-modal-header';
export { default as NoteTabContent } from './note-tab-content';
export { useAIChat } from './useAIChat';
export { fetchConfiguredProviders, fetchAvailableModels } from './ai-service';
