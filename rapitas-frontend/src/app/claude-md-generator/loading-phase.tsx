/**
 * loading-phase
 *
 * Full-screen loading states used during AI proposal generation ("proposing")
 * and CLAUDE.md generation ("generating"). Each variant shows a spinner and
 * contextual copy to set user expectations during the wait.
 */

'use client';

import React from 'react';
import { GLOBAL_CSS } from './styles';

interface LoadingPhaseProps {
  topRef: React.RefObject<HTMLDivElement | null>;
  /** Translation function from use-wizard / use-wizardからの翻訳関数 */
  t: (key: string) => string;
  /** Controls which loading variant is displayed / 表示するローディングバリアントを制御する */
  variant: 'proposing' | 'generating';
}

/**
 * Full-screen spinner with phase-appropriate messaging.
 *
 * @param topRef - scroll anchor ref / スクロールアンカーref
 * @param t - translation function / 翻訳関数
 * @param variant - 'proposing' shows simple description; 'generating' shows step list / バリアント
 */
export function LoadingPhase({ topRef, t, variant }: LoadingPhaseProps) {
  return (
    <div
      className="cmd-gen"
      style={{
        minHeight: '100vh',
        background: 'var(--bg)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px 20px',
      }}
    >
      <style>{GLOBAL_CSS}</style>
      <div style={{ textAlign: 'center' }} ref={topRef}>
        <div className="spin" style={{ margin: '0 auto 28px' }} />
        <h2
          style={{
            fontFamily: "'Outfit',sans-serif",
            fontSize: 22,
            marginBottom: 12,
          }}
        >
          {variant === 'proposing' ? t('proposingTitle') : t('generatingTitle')}
        </h2>

        {variant === 'proposing' && (
          <p
            style={{
              color: 'var(--muted)',
              fontSize: 13,
              lineHeight: 1.9,
              whiteSpace: 'pre-line',
            }}
          >
            {t('proposingDescription')}
          </p>
        )}

        {variant === 'generating' && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              marginTop: 28,
              textAlign: 'left',
            }}
          >
            {[
              t('generatingStep1'),
              t('generatingStep2'),
              t('generatingStep3'),
              t('generatingStep4'),
              t('generatingStep5'),
            ].map((step, i) => (
              <div
                key={step}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  opacity: 0,
                  animation: `fadeUp .4s ${i * 0.25}s both`,
                }}
              >
                <div
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: 'var(--accent)',
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    color: 'var(--muted)',
                    fontSize: 12,
                    fontFamily: "'JetBrains Mono',monospace",
                  }}
                >
                  {step}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
