'use client';
// sub-phase

import React from 'react';
import type { DynamicItem } from '../_types/types';
import { SUB_GENRES } from '../_utils/constants';
import { PageWrap } from './page-wrap';
import { CheckIcon } from './icons';

interface SubPhaseProps {
  topRef: React.RefObject<HTMLDivElement | null>;
  /** Translation function from use-wizard / use-wizardからの翻訳関数 */
  t: (key: string) => string;
  /** Currently selected genre id / 選択済みジャンルID */
  genre: string;
  /** Currently selected sub-genre ids / 選択済みサブジャンルID一覧 */
  selectedSubs: string[];
  /** AI-generated sub-genre items; falls back to static list when empty / AIが生成したサブジャンル一覧 */
  dynamicSubs: DynamicItem[];
  /** True while AI suggestions are loading / AI提案取得中はtrue */
  subsLoading: boolean;
  /** Toggles a sub-genre selection by id / IDでサブジャンル選択を切り替える */
  onToggle: (id: string) => void;
  /** Advances to elements phase; receives the resolved sub items for element suggestions / 要素フェーズへ進む */
  onNext: (selectedSubIds: string[]) => void;
  /** Returns to genre phase / ジャンルフェーズへ戻る */
  onBack: () => void;
}

/**
 * Sub-genre multi-select grid wrapped in the shared PageWrap layout.
 *
 * @param props - SubPhaseProps / SubPhaseProps参照
 */
export function SubPhase({
  topRef,
  t,
  genre,
  selectedSubs,
  dynamicSubs,
  subsLoading,
  onToggle,
  onNext,
  onBack,
}: SubPhaseProps) {
  const subs =
    dynamicSubs.length > 0
      ? dynamicSubs
      : (SUB_GENRES[genre] || []).map((s) => ({
          id: s.id,
          icon: s.icon,
          label: t(`sub_${genre}_${s.id}`),
        }));

  return (
    <PageWrap
      topRef={topRef}
      title={(t as (k: string, v?: Record<string, unknown>) => string)('subTitle', {
        genre: t('genre_' + genre),
      })}
      sub={t('subSub')}
      step={2}
      total={5}
      onBack={onBack}
      onNext={() => onNext(subs.filter((s) => selectedSubs.includes(s.id)).map((s) => s.id))}
      nextLabel={t('next')}
      canNext={true}
      backLabel={t('back')}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2,1fr)',
          gap: 10,
          marginBottom: 32,
        }}
      >
        {subsLoading
          ? Array.from({ length: 6 }, (_, i) => (
              <div
                key={`skeleton-${i}`}
                className="card"
                style={{ opacity: 0.6, pointerEvents: 'none' }}
              >
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <span>⏳</span>
                  <span
                    style={{
                      background: 'var(--border)',
                      borderRadius: 4,
                      height: 16,
                      width: 80,
                    }}
                  >
                    &nbsp;
                  </span>
                </div>
              </div>
            ))
          : subs.map((s) => {
              const isSel = selectedSubs.includes(s.id);
              return (
                <div
                  key={s.id}
                  className={`card ${isSel ? 'sel' : ''}`}
                  onClick={() => onToggle(s.id)}
                >
                  <div className="card-checkb">{isSel && <CheckIcon />}</div>
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 600,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <span>{s.icon}</span>
                      <span>{s.label}</span>
                    </div>
                  </div>
                </div>
              );
            })}
      </div>
    </PageWrap>
  );
}
