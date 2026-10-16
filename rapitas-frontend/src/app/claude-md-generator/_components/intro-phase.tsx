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
  /** The user's own words about what they want to build. / 題材 */
  concept: string;
  onSetConcept: (v: string) => void;
  /** Starts with concept-derived options. / 題材から選択肢を提案して開始 */
  onStartWithConcept: () => void;
}

/**
 * Full-screen intro panel for the CLAUDE.md generator wizard.
 *
 * @param topRef - ref used to scroll the page to the top on phase change / フェーズ変更時にスクロールするref
 * @param t - translation function / 翻訳関数
 * @param onStart - callback to begin the wizard / ウィザード開始コールバック
 */
export function IntroPhase({
  topRef,
  t,
  onStart,
  concept,
  onSetConcept,
  onStartWithConcept,
}: IntroPhaseProps) {
  const hasConcept = concept.trim().length > 0;
  return (
    <div
      className="cmd-gen"
      style={{
        minHeight: 'calc(100vh - 4rem - 1px)',
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
            background: 'linear-gradient(135deg, var(--text) 20%, var(--accent2) 80%)',
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
          {t('heroPerfect')} <code style={{ color: 'var(--accent2)' }}>{t('heroDocSet')}</code>{' '}
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

        {/* NOTE: optional on purpose. Written, it becomes the source of the
            option cards, which is what lifts the fixed-catalog ceiling
            (reported 2026-10-12). Left blank, the wizard behaves exactly as
            before, so the easy path is never taken away. */}
        <div
          style={{
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: 16,
            marginBottom: 24,
            textAlign: 'left',
          }}
        >
          <label
            htmlFor="wizard-concept"
            style={{ fontSize: 13, fontWeight: 700, display: 'block', marginBottom: 8 }}
          >
            作りたいもの・解決したい課題（任意）
          </label>
          <textarea
            id="wizard-concept"
            value={concept}
            onChange={(e) => onSetConcept(e.target.value)}
            rows={3}
            placeholder={'例: 会議の録音から、次に誰が何をするかだけを抜き出して本人に配りたい'}
            style={{
              width: '100%',
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--card)',
              color: 'inherit',
              fontSize: 13,
              lineHeight: 1.7,
              resize: 'vertical',
            }}
          />
          <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8, lineHeight: 1.7 }}>
            ここに書くと、この内容に合わせた選択肢を提案します。
            空欄のままでも始められます（定番の選択肢を表示）。
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            className="btn btn-p"
            onClick={onStartWithConcept}
            disabled={!hasConcept}
            title={hasConcept ? undefined : '上の欄に書くと提案できます'}
            style={{
              fontSize: 15,
              padding: '14px 32px',
              opacity: hasConcept ? undefined : 0.5,
              cursor: hasConcept ? undefined : 'not-allowed',
            }}
          >
            選択肢を提案してもらう
          </button>
          <button
            className="btn btn-g"
            onClick={onStart}
            style={{ fontSize: 15, padding: '14px 32px' }}
          >
            定番から選ぶ
          </button>
        </div>
      </div>
    </div>
  );
}
