'use client';
// proposed-options

import type { DynamicItem } from '../_types/types';
import { WizardIcon } from './wizard-icons';

interface ProposedOptionsProps {
  /** Options proposed from the user's concept. / 題材から提案された選択肢 */
  items: readonly DynamicItem[];
  /** Heading above the block. / ブロックの見出し */
  heading: string;
  /** Picks one. / 選択 */
  onPick: (id: string) => void;
  /** Ids currently selected, for multi-select screens. / 選択済みID */
  selected?: readonly string[];
  /** True while candidates are still being fetched. / 取得中 */
  loading?: boolean;
  /** Why there are none, when the fetch degraded. / 取得できなかった理由 */
  degradedReason?: string;
}

/**
 * The AI-proposed options, shown above the static catalog.
 *
 * NOTE: deliberately the SAME card markup as the static grids. The user's
 * complaint was that the fixed catalogs constrain what can be built, not that
 * the interaction was wrong — so only the heading distinguishes the two
 * sources, and a pick behaves identically either way.
 *
 * Renders nothing when there is nothing to say: no items, not loading and no
 * reason means the user never entered a concept, and an empty labelled block
 * would be pure noise on the screen they already had.
 */
export function ProposedOptions({
  items,
  heading,
  onPick,
  selected,
  loading,
  degradedReason,
}: ProposedOptionsProps) {
  if (items.length === 0 && !loading && !degradedReason) return null;

  return (
    <div style={{ marginBottom: 24 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          fontSize: 13,
          fontWeight: 700,
          marginBottom: 10,
        }}
      >
        <span style={{ color: 'var(--accent2)', display: 'flex' }}>
          <WizardIcon name="Sparkles" size={16} />
        </span>
        {heading}
      </div>

      {loading && (
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          お題に合わせた選択肢を考えています…
        </div>
      )}

      {items.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
          {items.map((item) => {
            const isSelected = selected?.includes(item.id) ?? false;
            return (
              <div
                key={item.id}
                className="card"
                onClick={() => onPick(item.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  borderColor: isSelected ? 'var(--green)' : undefined,
                }}
              >
                <span style={{ color: 'var(--accent2)', display: 'flex', flexShrink: 0 }}>
                  <WizardIcon name={item.icon} size={20} />
                </span>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{item.label}</span>
              </div>
            );
          })}
        </div>
      )}

      {!loading && items.length === 0 && degradedReason && (
        <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
          {degradedReason}
          定番の選択肢から選べます。
        </div>
      )}
    </div>
  );
}
