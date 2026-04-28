'use client';
// intro-phase

import React from 'react';
import { GLOBAL_CSS } from '../_utils/styles';

interface IntroPhaseProps {
  topRef: React.RefObject<HTMLDivElement | null>;
  /** Translation function from use-wizard / use-wizardからの翻訳関数 */
  t: (key: string) => string;
  /** Advances the wizard to the genre selection phase / ウィザードをジャンル選択フェーズへ進める */
  onStart: () => void;
}

/**
 * Full-screen intro panel for the CLAUDE.md generator wizard.
 *
 * @param topRef - ref used to scroll the page to the top on phase change / フェーズ変更時にスクロールするref
 * @param t - translation function / 翻訳関数
 * @param onStart - callback to begin the wizard / ウィザード開始コールバック
 */
export function IntroPhase({ topRef, t, onStart }: IntroPhaseProps) {
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
      <div
        style={{ maxWidth: 500, width: '100%', textAlign: 'center' }}
        className="fade"
        ref={topRef}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            border: '1px solid rgba(99,102,241,.35)',
            borderRadius: 100,
            padding: '5px 16px',
            marginBottom: 36,
            background: 'rgba(99,102,241,.07)',
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'var(--accent)',
              display: 'inline-block',
            }}
          />
          <span
            style={{
              fontSize: 11,
              color: 'var(--accent2)',
              letterSpacing: '.14em',
            }}
          >
            {t('wizardLabel')}
          </span>
        </div>

        <h1
          style={{
            fontFamily: "'Outfit',sans-serif",
            fontSize: 44,
            fontWeight: 800,
            lineHeight: 1.1,
            letterSpacing: '-.03em',
            marginBottom: 20,
            background: 'linear-gradient(135deg, #eeeef5 20%, var(--accent2) 80%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            whiteSpace: 'pre-line',
          }}
        >
          {t('heroTitle')}
        </h1>

        <p
          style={{
            color: 'var(--muted)',
            fontSize: 14,
            lineHeight: 1.9,
            marginBottom: 44,
            whiteSpace: 'pre-line',
          }}
        >
          {t('heroDescription')}
          <span style={{ color: 'var(--text)' }}>{t('heroHighlight')}</span>
          <br />
          {t('heroPerfect')} <code style={{ color: 'var(--accent2)' }}>CLAUDE.md</code>{' '}
          {t('heroSuffix')}
        </p>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            justifyContent: 'center',
            marginBottom: 40,
          }}
        >
          {[t('tagDeepDive'), t('tagAiPropose'), t('tagAutoTech'), t('tagBehavior')].map((tag) => (
            <span key={tag} className="tag tag-accent">
              {tag}
            </span>
          ))}
        </div>

        <button
          className="btn btn-p"
          onClick={onStart}
          style={{ fontSize: 16, padding: '15px 48px' }}
        >
          {t('start')}
        </button>
      </div>
    </div>
  );
}
