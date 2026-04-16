'use client';
// result-phase

import React from 'react';
import type { AppProposal, GenerateResult } from '../_types/types';
import type { SetupPhase } from '../_hooks/useWizard';
import { GLOBAL_CSS } from '../_utils/styles';
import { ScoreRing } from './score-ring';

interface ResultPhaseProps {
  topRef: React.RefObject<HTMLDivElement | null>;
  /** Translation function from use-wizard / use-wizardからの翻訳関数 */
  t: (key: string) => string;
  pickedProp: AppProposal | null;
  result: GenerateResult | null;
  copied: boolean;
  setupPhase: SetupPhase;
  createdThemePath: string | null;
  setupError: string | null;
  onCopy: () => void;
  onRestart: () => void;
  onCreateTheme: () => void;
  onResetSetup: () => void;
}

/**
 * Result screen showing the generated CLAUDE.md with copy, restart, and theme-creation actions.
 *
 * @param props - ResultPhaseProps / ResultPhaseProps参照
 */
export function ResultPhase({
  topRef,
  t,
  pickedProp,
  result,
  copied,
  setupPhase,
  createdThemePath,
  setupError,
  onCopy,
  onRestart,
  onCreateTheme,
  onResetSetup,
}: ResultPhaseProps) {
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
        style={{ maxWidth: 760, margin: '0 auto' }}
        className="fade"
        ref={topRef}
      >
        {/* Header row */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: 32,
            flexWrap: 'wrap',
            gap: 16,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 10,
                letterSpacing: '.18em',
                color: 'var(--accent)',
                marginBottom: 6,
              }}
            >
              {t('resultLabel')}
            </div>
            <h2
              style={{
                fontFamily: "'Outfit',sans-serif",
                fontSize: 26,
                fontWeight: 800,
                whiteSpace: 'pre-line',
              }}
            >
              {(t as (k: string, v?: Record<string, unknown>) => string)(
                'resultTitle',
                { name: pickedProp?.name ?? '' },
              )}
            </h2>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              className="btn btn-p"
              onClick={onCopy}
              style={{ background: copied ? '#059669' : undefined }}
            >
              {copied ? t('copyDone') : t('copy')}
            </button>
            <button className="btn btn-g" onClick={onRestart}>
              {t('restart')}
            </button>
          </div>
        </div>

        <ScoreRing score={result?.score || 95} label={t('scoreLabel')} />

        {result?.tech_rationale && (
          <div
            style={{
              border: '1px solid rgba(99,102,241,.3)',
              background: 'rgba(99,102,241,.06)',
              borderRadius: 10,
              padding: '16px 20px',
              marginBottom: 20,
            }}
          >
            <div
              style={{
                fontSize: 10,
                color: 'var(--accent)',
                letterSpacing: '.12em',
                marginBottom: 8,
              }}
            >
              {t('techRationale')}
            </div>
            <p style={{ color: '#c0c0d8', fontSize: 13, lineHeight: 1.85 }}>
              {result.tech_rationale}
            </p>
          </div>
        )}

        <div className="codebox">{result?.claude_md}</div>

        {/* Theme creation section */}
        <div
          style={{
            marginTop: 24,
            padding: '20px 24px',
            border: '1px solid var(--border)',
            borderRadius: 12,
            background: 'var(--s1)',
          }}
        >
          <div
            style={{
              fontSize: 10,
              letterSpacing: '.12em',
              color: 'var(--accent)',
              marginBottom: 8,
            }}
          >
            {t('createThemeSection')}
          </div>
          <p
            style={{
              color: 'var(--text)',
              fontSize: 14,
              lineHeight: 1.6,
              marginBottom: 16,
            }}
          >
            {t('createThemeDescription')}
          </p>

          {setupPhase === 'idle' && (
            <button
              className="btn btn-p"
              onClick={onCreateTheme}
              style={{
                background: '#10b981',
                fontSize: 14,
                padding: '12px 24px',
              }}
            >
              {t('createTheme')}
            </button>
          )}

          {setupPhase === 'loading' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div className="spin" style={{ width: 20, height: 20 }} />
              <span style={{ color: 'var(--text)', fontSize: 14 }}>
                {t('creatingTheme')}
              </span>
            </div>
          )}

          {setupPhase === 'success' && (
            <div>
              <div
                style={{
                  color: '#10b981',
                  fontSize: 14,
                  marginBottom: 8,
                  fontWeight: 600,
                }}
              >
                ✅ {t('themeCreated')}
              </div>
              <p
                style={{
                  color: 'var(--muted)',
                  fontSize: 12,
                  marginBottom: 12,
                }}
              >
                {t('themeCreatedDescription')}
              </p>
              {createdThemePath && (
                <div
                  style={{
                    background: 'var(--s2)',
                    padding: '8px 12px',
                    borderRadius: 6,
                    fontSize: 11,
                    fontFamily: "'JetBrains Mono',monospace",
                    color: 'var(--accent2)',
                    marginBottom: 12,
                  }}
                >
                  {createdThemePath}
                </div>
              )}
              <button
                className="btn btn-outline"
                onClick={onResetSetup}
                style={{ fontSize: 12, padding: '8px 16px' }}
              >
                {t('createAnother')}
              </button>
            </div>
          )}

          {setupPhase === 'error' && (
            <div>
              <div
                style={{
                  color: '#f87171',
                  fontSize: 14,
                  marginBottom: 8,
                  fontWeight: 600,
                }}
              >
                ❌ {t('themeCreateError')}
              </div>
              {setupError && (
                <p
                  style={{
                    color: 'var(--muted)',
                    fontSize: 12,
                    marginBottom: 12,
                  }}
                >
                  {setupError}
                </p>
              )}
              <button
                className="btn btn-outline"
                onClick={onResetSetup}
                style={{ fontSize: 12, padding: '8px 16px' }}
              >
                {t('retry')}
              </button>
            </div>
          )}
        </div>

        <p
          style={{
            color: 'var(--dimmed)',
            fontSize: 11,
            marginTop: 14,
            textAlign: 'center',
            fontFamily: "'JetBrains Mono',monospace",
          }}
        >
          {t('saveInstruction')}{' '}
          <code style={{ color: 'var(--accent2)' }}>CLAUDE.md</code>{' '}
          {t('saveInstructionSuffix')}
        </p>
      </div>
    </div>
  );
}
