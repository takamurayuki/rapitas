'use client';
// page-wrap

import React from 'react';
import { GLOBAL_CSS } from '../_utils/styles';

interface PageWrapProps {
  topRef: React.RefObject<HTMLDivElement | null>;
  /** Step title text / ステップのタイトルテキスト */
  title: string;
  /** Optional subtitle rendered below the title / タイトルの下に表示する任意のサブタイトル */
  sub?: string;
  /** Current step number (1-based) / 現在のステップ番号（1始まり） */
  step: number;
  /** Total number of steps / ステップの総数 */
  total: number;
  /** Callback for the back button; back button is hidden when omitted / 戻るボタンのコールバック。省略時は非表示 */
  onBack?: () => void;
  /** Callback for the next button; entire nav footer is hidden when omitted / 次へボタンのコールバック。省略時はナビフッターを非表示 */
  onNext?: () => void;
  nextLabel?: string;
  backLabel?: string;
  /** Whether the next button is enabled / 次へボタンの有効状態 */
  canNext?: boolean;
  children: React.ReactNode;
}

/**
 * Layout wrapper for step-based wizard phases.
 *
 * @param props - PageWrapProps / PageWrapProps参照
 */
export function PageWrap({
  topRef,
  title,
  sub,
  step,
  total,
  onBack,
  onNext,
  nextLabel,
  backLabel,
  canNext = true,
  children,
}: PageWrapProps) {
  const progress = ((step - 1) / total) * 100;

  return (
    <div
      className="cmd-gen"
      style={{
        minHeight: '100vh',
        background: 'var(--bg)',
        padding: '40px 20px',
        fontFamily: "'Outfit',sans-serif",
      }}
    >
      <style>{GLOBAL_CSS}</style>
      <div
        style={{ maxWidth: 680, margin: '0 auto' }}
        className="fade"
        ref={topRef}
      >
        {/* Progress */}
        <div style={{ marginBottom: 36 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 11,
              color: 'var(--muted)',
              marginBottom: 10,
              fontFamily: "'JetBrains Mono',monospace",
            }}
          >
            <span style={{ color: 'var(--accent)', letterSpacing: '.1em' }}>
              STEP {step} / {total}
            </span>
            <span>{Math.round(progress)}%</span>
          </div>
          <div className="prog">
            <div className="prog-f" style={{ width: `${progress}%` }} />
          </div>
        </div>

        {/* Title */}
        <h2
          style={{
            fontFamily: "'Outfit',sans-serif",
            fontSize: 26,
            fontWeight: 800,
            lineHeight: 1.3,
            marginBottom: sub ? 6 : 28,
            whiteSpace: 'pre-line',
          }}
        >
          {title}
        </h2>
        {sub && (
          <p style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 24 }}>
            {sub}
          </p>
        )}

        {children}

        {/* Nav — only rendered when onNext is provided */}
        {onNext && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            {onBack ? (
              <button className="btn btn-g" onClick={onBack}>
                {backLabel || '← Back'}
              </button>
            ) : (
              <span />
            )}
            <button className="btn btn-p" onClick={onNext} disabled={!canNext}>
              {nextLabel || 'Next →'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
