/**
 * elements-phase
 *
 * Step 3 of the CLAUDE.md generator wizard.
 * Lets the user pick optional app features/elements such as auth, payment, AI,
 * realtime etc. Shows a loading skeleton while AI suggestions are being fetched.
 */

'use client';

import React from 'react';
import type { DynamicItem } from '../_types/types';
import { ELEMENTS } from '../_utils/constants';
import { PageWrap } from './page-wrap';
import { CheckIcon } from './icons';

interface ElementsPhaseProps {
  topRef: React.RefObject<HTMLDivElement | null>;
  /** Translation function from use-wizard / use-wizardからの翻訳関数 */
  t: (key: string) => string;
  /** Currently selected element ids / 選択済み要素ID一覧 */
  selectedElements: string[];
  /** AI-generated element items; falls back to static list when empty / AIが生成した要素一覧 */
  dynamicElements: DynamicItem[];
  /** True while AI suggestions are loading / AI提案取得中はtrue */
  elementsLoading: boolean;
  /** Toggles an element selection by id / IDで要素選択を切り替える */
  onToggle: (id: string) => void;
  /** Advances to platform phase / プラットフォームフェーズへ進む */
  onNext: () => void;
  /** Returns to sub-genre phase / サブジャンルフェーズへ戻る */
  onBack: () => void;
}

/**
 * Elements multi-select grid wrapped in the shared PageWrap layout.
 *
 * @param props - ElementsPhaseProps / ElementsPhaseProps参照
 */
export function ElementsPhase({
  topRef,
  t,
  selectedElements,
  dynamicElements,
  elementsLoading,
  onToggle,
  onNext,
  onBack,
}: ElementsPhaseProps) {
  const elements =
    dynamicElements.length > 0
      ? dynamicElements
      : ELEMENTS.map((e) => ({
          id: e.id,
          icon: e.icon,
          label: t(`elem_${e.id}`),
        }));

  return (
    <PageWrap
      topRef={topRef}
      title={t('elementsTitle')}
      sub={t('elementsSub')}
      step={3}
      total={5}
      onBack={onBack}
      onNext={onNext}
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
        {elementsLoading
          ? Array.from({ length: 10 }, (_, i) => (
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
                      width: 90,
                    }}
                  >
                    &nbsp;
                  </span>
                </div>
              </div>
            ))
          : elements.map((e) => {
              const isSel = selectedElements.includes(e.id);
              return (
                <div
                  key={e.id}
                  className={`card ${isSel ? 'sel' : ''}`}
                  onClick={() => onToggle(e.id)}
                >
                  <div className="card-checkb">{isSel && <CheckIcon />}</div>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <span>{e.icon}</span>
                    <span>{e.label || t('elem_' + e.id)}</span>
                  </div>
                </div>
              );
            })}
      </div>
    </PageWrap>
  );
}
