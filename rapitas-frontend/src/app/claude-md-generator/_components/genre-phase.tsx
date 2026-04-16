'use client';
// genre-phase

import React from 'react';
import { GENRES } from '../_utils/constants';
import { PageWrap } from './page-wrap';

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
}

/**
 * Genre selection grid wrapped in the shared PageWrap layout.
 *
 * @param topRef - scroll anchor ref / スクロールアンカーref
 * @param t - translation function / 翻訳関数
 * @param onSelectGenre - genre selection callback / ジャンル選択コールバック
 */
export function GenrePhase({ topRef, t, onSelectGenre }: GenrePhaseProps) {
  return (
    <PageWrap
      topRef={topRef}
      title={t('genreTitle')}
      sub={t('genreSub')}
      step={1}
      total={5}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3,1fr)',
          gap: 10,
          marginBottom: 36,
        }}
      >
        {GENRES.map((g) => (
          <div key={g.id} className="card" onClick={() => onSelectGenre(g.id)}>
            <div style={{ fontSize: 24, marginBottom: 6 }}>{g.icon}</div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>
              {t('genre_' + g.id)}
            </div>
          </div>
        ))}
      </div>
    </PageWrap>
  );
}
