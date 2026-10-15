'use client';
// concept-chip

import { useState } from 'react';

interface ConceptChipProps {
  /** The user's own words about what they want to build. / 題材 */
  concept: string;
  /** Saves an edit and re-fetches proposals. / 編集を確定して再提案 */
  onChange: (next: string) => void;
}

/**
 * The concept, shown on every option screen with an edit affordance.
 *
 * NOTE: the concept is what the proposed options are derived from, so it has to
 * stay visible and correctable. Hiding it would leave the user unable to tell
 * why a set of options appeared, or to steer it without restarting the wizard.
 *
 * Renders nothing when the user entered no concept — that path is the original
 * wizard, and an empty chip would imply something was lost.
 */
export function ConceptChip({ concept, onChange }: ConceptChipProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(concept);

  if (!concept.trim() && !editing) return null;

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next !== concept.trim()) onChange(next);
  };

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '10px 12px',
        marginBottom: 20,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
      }}
    >
      <span style={{ fontSize: 12, color: 'var(--muted)', flexShrink: 0 }}>お題</span>
      {editing ? (
        <>
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') {
                setDraft(concept);
                setEditing(false);
              }
            }}
            aria-label="お題"
            autoFocus
            style={{
              flex: 1,
              minWidth: 200,
              padding: '7px 10px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--card)',
              color: 'inherit',
              fontSize: 13,
            }}
          />
          <button
            type="button"
            className="btn btn-g"
            onClick={commit}
            style={{ fontSize: 12, padding: '5px 12px' }}
          >
            反映
          </button>
        </>
      ) : (
        <>
          <span style={{ flex: 1, minWidth: 180, fontSize: 13, lineHeight: 1.6 }}>{concept}</span>
          <button
            type="button"
            className="btn btn-g"
            onClick={() => {
              setDraft(concept);
              setEditing(true);
            }}
            style={{ fontSize: 12, padding: '5px 12px' }}
          >
            変更
          </button>
        </>
      )}
    </div>
  );
}
