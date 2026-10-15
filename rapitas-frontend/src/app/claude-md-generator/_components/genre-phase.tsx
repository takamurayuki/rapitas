'use client';
// genre-phase

import React from 'react';
import { GENRES } from '../_utils/constants';
import { PageWrap } from './page-wrap';
import { WizardIcon } from './wizard-icons';
import type { DynamicItem } from '../_types/types';
import { ProposedOptions } from './proposed-options';
import { ConceptChip } from './concept-chip';

interface GenrePhaseProps {
  topRef: React.RefObject<HTMLDivElement | null>;
  /** Translation function from use-wizard / use-wizardからの翻訳関数 */
  t: (key: string) => string;
  /**
   * Called when a genre card is clicked; receives the genre id.
   * Triggers AI sub-genre suggestions and advances to the sub phase.
   * / ジャンルカードクリック時のコールバック。サブジャンル取得後にsubフェーズへ遷移する。
   */
  onSelectGenre: (genreId: string) => void;
  /** Options proposed from the concept. / 題材からの提案 */
  proposed?: readonly DynamicItem[];
  proposedLoading?: boolean;
  proposedReason?: string;
  concept?: string;
  onChangeConcept?: (next: string) => void;
}

/**
 * Genre selection grid wrapped in the shared PageWrap layout.
 *
 * @param topRef - scroll anchor ref / スクロールアンカーref
 * @param t - translation function / 翻訳関数
 * @param onSelectGenre - genre selection callback / ジャンル選択コールバック
 */
export function GenrePhase({
  topRef,
  t,
  onSelectGenre,
  proposed = [],
  proposedLoading,
  proposedReason,
  concept = '',
  onChangeConcept,
}: GenrePhaseProps) {
  const hasProposals = proposed.length > 0 || proposedLoading || proposedReason;
  return (
    <PageWrap topRef={topRef} title={t('genreTitle')} sub={t('genreSub')} step={1} total={6}>
      {onChangeConcept && <ConceptChip concept={concept} onChange={onChangeConcept} />}

      <ProposedOptions
        items={proposed}
        heading="お題に合わせた提案"
        onPick={onSelectGenre}
        loading={proposedLoading}
        degradedReason={proposedReason}
      />

      {hasProposals && (
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>定番から選ぶ</div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3,1fr)',
          gap: 10,
          marginBottom: 36,
        }}
      >
        {GENRES.map((g) => (
          <div
            key={g.id}
            className="card"
            onClick={() => onSelectGenre(g.id)}
            style={{ display: 'flex', alignItems: 'center', gap: 10 }}
          >
            <span style={{ color: 'var(--accent)', display: 'flex', flexShrink: 0 }}>
              <WizardIcon name={g.icon} size={20} />
            </span>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{t('genre_' + g.id)}</span>
          </div>
        ))}
      </div>
    </PageWrap>
  );
}
