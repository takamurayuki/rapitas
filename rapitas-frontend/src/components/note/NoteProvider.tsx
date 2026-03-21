'use client';
import { useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useNoteStore } from '@/stores/note-store';

// NOTE: Dynamic import to improve initial render performance
const NoteModal = dynamic(() => import('./NoteModal'), {
  ssr: false,
});

export default function NoteProvider() {
  const { toggleModal } = useNoteStore();

  // Global event listener so other components can open the note modal
  useEffect(() => {
    const handleOpenNote = () => toggleModal();
    window.addEventListener('openNoteModal', handleOpenNote);
    return () => window.removeEventListener('openNoteModal', handleOpenNote);
  }, [toggleModal]);

  return <NoteModal />;
}
