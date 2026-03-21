/**
 * NoteModal
 *
 * Floating, draggable, and resizable modal window that hosts the Note editor
 * and AI chat tabs. Responsible for drag/resize logic, keyboard shortcuts,
 * and wiring store state to child components.
 */
'use client';
import { useEffect, useRef, useState } from 'react';
import { useNoteStore, type ModalTab } from '@/stores/note-store';
import DragOverlay from './drag-overlay';
import NoteModalHeader from './note-modal-header';
import NoteTabContent from './note-tab-content';
import AITabContent from './ai-tab-content';

export default function NoteModal() {
  const {
    modalState,
    notes,
    currentNoteId,
    searchQuery,
    closeModal,
    toggleMaximize,
    setModalPosition,
    setModalSize,
    bringToFront,
    createNote,
    setModalTab,
    setSearchQuery,
  } = useNoteStore();

  const modalRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isDragPending, setIsDragPending] = useState(false);
  const [isResizing, setIsResizing] = useState(false);

  const dragStartRef = useRef({ x: 0, y: 0 });
  const didDragRef = useRef(false);
  const dragOriginRef = useRef({ x: 0, y: 0 });
  const tempPositionRef = useRef({ x: 0, y: 0 });
  const rafRef = useRef<number | null>(null);

  const resizeStartRef = useRef({ x: 0, y: 0, width: 0, height: 0 });
  const tempSizeRef = useRef({ width: 0, height: 0 });
  const resizeRafRef = useRef<number | null>(null);

  // NOTE: Drag starts only after the cursor moves beyond this threshold to
  // distinguish a click from a drag intent.
  const DRAG_THRESHOLD = 3;

  const currentNote = notes.find((note) => note.id === currentNoteId);
  const activeTab = modalState.activeTab;

  // --- Drag handling ---

  const handleDragStart = (e: React.MouseEvent) => {
    // NOTE: Allow native input interaction inside the header (search field).
    if ((e.target as HTMLElement).closest('input, select, textarea')) return;

    e.preventDefault();
    didDragRef.current = false;
    dragOriginRef.current = { x: e.clientX, y: e.clientY };
    dragStartRef.current = {
      x: e.clientX - modalState.position.x,
      y: e.clientY - modalState.position.y,
    };
    tempPositionRef.current = { ...modalState.position };
    setIsDragPending(true);
    bringToFront();
  };

  useEffect(() => {
    if (!isDragging && !isDragPending) return;

    const onMove = (e: MouseEvent) => {
      if (isDragPending && !isDragging) {
        const dx = e.clientX - dragOriginRef.current.x;
        const dy = e.clientY - dragOriginRef.current.y;
        if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
          didDragRef.current = true;
          setIsDragPending(false);
          setIsDragging(true);
          if (modalRef.current) {
            modalRef.current.style.willChange = 'transform';
          }
        }
        return;
      }
      didDragRef.current = true;

      tempPositionRef.current = {
        x: e.clientX - dragStartRef.current.x,
        y: e.clientY - dragStartRef.current.y,
      };

      if (modalRef.current && !modalState.isMaximized) {
        modalRef.current.style.left = `${tempPositionRef.current.x}px`;
        modalRef.current.style.top = `${tempPositionRef.current.y}px`;
      }

      // NOTE: requestAnimationFrame batches store updates to avoid excessive renders.
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(() => {
          setModalPosition(
            tempPositionRef.current.x,
            tempPositionRef.current.y,
          );
          rafRef.current = null;
        });
      }
    };

    const onUp = () => {
      setIsDragPending(false);
      setIsDragging(false);
      if (modalRef.current) modalRef.current.style.willChange = 'auto';
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (didDragRef.current) {
        setModalPosition(tempPositionRef.current.x, tempPositionRef.current.y);
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isDragging, isDragPending, setModalPosition, modalState.isMaximized]);

  // --- Resize handling ---

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    resizeStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      width: modalState.size.width,
      height: modalState.size.height,
    };
    tempSizeRef.current = { ...modalState.size };
    bringToFront();
    if (modalRef.current) {
      modalRef.current.style.willChange = 'width, height';
    }
  };

  useEffect(() => {
    if (!isResizing) return;

    const onMove = (e: MouseEvent) => {
      const s = resizeStartRef.current;
      tempSizeRef.current = {
        width: Math.max(400, s.width + e.clientX - s.x),
        height: Math.max(300, s.height + e.clientY - s.y),
      };

      if (modalRef.current && !modalState.isMaximized) {
        modalRef.current.style.width = `${tempSizeRef.current.width}px`;
        modalRef.current.style.height = `${tempSizeRef.current.height}px`;
      }

      if (resizeRafRef.current === null) {
        resizeRafRef.current = requestAnimationFrame(() => {
          setModalSize(tempSizeRef.current.width, tempSizeRef.current.height);
          resizeRafRef.current = null;
        });
      }
    };

    const onUp = () => {
      setIsResizing(false);
      if (modalRef.current) modalRef.current.style.willChange = 'auto';
      if (resizeRafRef.current !== null) {
        cancelAnimationFrame(resizeRafRef.current);
        resizeRafRef.current = null;
      }
      if (tempSizeRef.current.width && tempSizeRef.current.height) {
        setModalSize(tempSizeRef.current.width, tempSizeRef.current.height);
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (resizeRafRef.current !== null) {
        cancelAnimationFrame(resizeRafRef.current);
        resizeRafRef.current = null;
      }
    };
  }, [isResizing, setModalSize, modalState.isMaximized]);

  // Keyboard shortcut: Escape closes the modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeModal();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeModal]);

  // Sync DOM position on open without triggering a re-render
  useEffect(() => {
    if (modalState.isOpen && modalRef.current && !modalState.isMaximized) {
      modalRef.current.style.left = `${modalState.position.x}px`;
      modalRef.current.style.top = `${modalState.position.y}px`;
    }
  }, [modalState.isOpen]);

  const handleTabChange = (tab: ModalTab) => {
    setModalTab(tab);
    if (tab === 'note' && notes.length === 0) {
      createNote();
    }
  };

  if (!modalState.isOpen) return null;

  return (
    <>
      {(isDragging || isResizing) && (
        <DragOverlay cursor={isDragging ? 'move' : 'se-resize'} />
      )}
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="note-modal-title"
        className={`fixed bg-white dark:bg-zinc-900 overflow-hidden note-modal-enter ${
          modalState.isMaximized ? 'rounded-none' : 'rounded-xl shadow-2xl'
        } ${
          isDragging || isResizing ? 'note-modal-dragging' : 'note-modal-smooth'
        }`}
        style={
          modalState.isMaximized
            ? {
                left: 0,
                top: 64,
                width: '100vw',
                height: 'calc(100vh - 64px)',
                zIndex: modalState.zIndex,
              }
            : {
                left: modalState.position.x,
                top: modalState.position.y,
                width: `${modalState.size.width}px`,
                height: `${modalState.size.height}px`,
                zIndex: modalState.zIndex,
                boxShadow:
                  '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
              }
        }
      >
        <NoteModalHeader
          activeTab={activeTab}
          isMaximized={modalState.isMaximized}
          searchQuery={searchQuery}
          didDragRef={didDragRef}
          onDragStart={handleDragStart}
          onTabChange={handleTabChange}
          onSearchChange={setSearchQuery}
          onToggleMaximize={toggleMaximize}
          onClose={closeModal}
        />

        {/* Tab body */}
        <div
          id={activeTab === 'note' ? 'note-tab-panel' : 'ai-tab-panel'}
          role="tabpanel"
          className={`h-[calc(100%-48px)] ${
            isDragging || isResizing
              ? 'note-modal-non-interactive'
              : 'note-modal-interactive'
          }`}
        >
          {activeTab === 'note' ? (
            <NoteTabContent
              currentNote={currentNote}
              onCreateNote={createNote}
            />
          ) : (
            <AITabContent />
          )}
        </div>

        {/* Resize handle (hidden when maximized) */}
        {!modalState.isMaximized && (
          <div
            className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
            onMouseDown={handleResizeStart}
          >
            <div className="absolute bottom-1 right-1 w-2 h-2 bg-zinc-400 dark:bg-zinc-600 rounded-sm" />
          </div>
        )}
      </div>
    </>
  );
}
