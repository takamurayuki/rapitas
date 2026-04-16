'use client';
// platform-phase

import React from 'react';
import { PLATFORMS, SCALES, PRIORITIES } from '../_utils/constants';
import { PageWrap } from './page-wrap';
import { DotIcon } from './icons';

interface PlatformPhaseProps {
  topRef: React.RefObject<HTMLDivElement | null>;
  /** Translation function from use-wizard / use-wizardからの翻訳関数 */
  t: (key: string) => string;
  localPlatform: string | null;
  localScale: string | null;
  localPrio: string | null;
  onSetPlatform: (id: string) => void;
  onSetScale: (id: string) => void;
  onSetPrio: (id: string) => void;
  /** Commits selections and triggers AI proposal generation / 選択を確定してAI提案生成を実行する */
  onGenerate: () => void;
  /** Returns to elements phase / 要素フェーズへ戻る */
  onBack: () => void;
}

/**
 * Platform, scale, and priority selection form wrapped in the shared PageWrap layout.
 *
 * @param props - PlatformPhaseProps / PlatformPhaseProps参照
 */
export function PlatformPhase({
  topRef,
  t,
  localPlatform,
  localScale,
  localPrio,
  onSetPlatform,
  onSetScale,
  onSetPrio,
  onGenerate,
  onBack,
}: PlatformPhaseProps) {
  const canGo = localPlatform && localScale && localPrio;

  return (
    <PageWrap
      topRef={topRef}
      title={t('platformTitle')}
      sub=""
      step={4}
      total={5}
      onBack={onBack}
    >
      {/* Platform */}
      <div style={{ marginBottom: 28 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--muted)',
            marginBottom: 12,
            letterSpacing: '.05em',
          }}
        >
          {t('platformQuestion')}
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2,1fr)',
            gap: 8,
          }}
        >
          {PLATFORMS.map((p) => {
            const sel = localPlatform === p.id;
            return (
              <div
                key={p.id}
                className={`card ${sel ? 'sel' : ''}`}
                onClick={() => onSetPlatform(p.id)}
              >
                <div className="card-check">{sel && <DotIcon />}</div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    {p.icon} {t('plat_' + p.id)}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                    {t('plat_' + p.id + '_desc')}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Scale */}
      <div style={{ marginBottom: 28 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--muted)',
            marginBottom: 12,
            letterSpacing: '.05em',
          }}
        >
          {t('scaleQuestion')}
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2,1fr)',
            gap: 8,
          }}
        >
          {SCALES.map((s) => {
            const sel = localScale === s.id;
            return (
              <div
                key={s.id}
                className={`card ${sel ? 'sel' : ''}`}
                onClick={() => onSetScale(s.id)}
              >
                <div className="card-check">{sel && <DotIcon />}</div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    {s.icon} {t('scale_' + s.id)}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                    {t('scale_' + s.id + '_desc')}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Priority */}
      <div style={{ marginBottom: 36 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--muted)',
            marginBottom: 12,
            letterSpacing: '.05em',
          }}
        >
          {t('priorityQuestion')}
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2,1fr)',
            gap: 8,
          }}
        >
          {PRIORITIES.map((p) => {
            const sel = localPrio === p.id;
            return (
              <div
                key={p.id}
                className={`card ${sel ? 'sel' : ''}`}
                onClick={() => onSetPrio(p.id)}
              >
                <div className="card-check">{sel && <DotIcon />}</div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    {p.icon} {t('prio_' + p.id)}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                    {t('prio_' + p.id + '_desc')}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <button className="btn btn-g" onClick={onBack}>
          {t('back')}
        </button>
        <button className="btn btn-p" onClick={onGenerate} disabled={!canGo}>
          {t('proposeWithAi')}
        </button>
      </div>
    </PageWrap>
  );
}
