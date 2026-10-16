'use client';
// generation-history

import { describeEntry, type GenerationEntry } from '../_hooks/useGenerationHistory';

interface GenerationHistoryProps {
  /** Entries oldest first; the last one is what is on screen. / 古い順の履歴 */
  history: readonly GenerationEntry[];
  /** Restores one entry without regenerating. / 再生成せず復元する */
  onSelect: (entry: GenerationEntry) => void;
}

/**
 * Lists the packages this session generated so an earlier one can be restored.
 *
 * NOTE: shown because the wizard kept only the latest package, so returning to
 * a previous version meant another model call — and the new output is not even
 * guaranteed to match what the user remembered. Reported 2026-10-12.
 *
 * Renders nothing for a single entry: with one version there is nothing to
 * choose between, and an empty-looking panel would just add noise.
 */
export function GenerationHistory({ history, onSelect }: GenerationHistoryProps) {
  if (history.length < 2) return null;
  const currentRound = history[history.length - 1].round;

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: 14,
        marginTop: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700 }}>生成履歴</div>
      <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
        この回で生成した版です。選び直しても再生成は走りません。
      </div>
      {[...history].reverse().map((entry) => {
        const isCurrent = entry.round === currentRound;
        return (
          <div
            key={entry.round}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              padding: '8px 10px',
              borderRadius: 8,
              border: `1px solid ${isCurrent ? 'var(--green)' : 'var(--border)'}`,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ fontSize: 12, lineHeight: 1.7 }}>
              <span style={{ fontWeight: 700 }}>{`${entry.round} 版目`}</span>
              <span style={{ color: 'var(--muted)' }}>{` — ${describeEntry(entry)}`}</span>
              {isCurrent && <span style={{ color: 'var(--green)' }}>{' （表示中）'}</span>}
            </div>
            {!isCurrent && (
              <button
                type="button"
                className="btn btn-g"
                onClick={() => onSelect(entry)}
                style={{ fontSize: 12, padding: '5px 10px' }}
              >
                この版に戻す
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
