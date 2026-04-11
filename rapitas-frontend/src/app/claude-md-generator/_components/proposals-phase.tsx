/**
 * proposals-phase
 *
 * Step 5 of the CLAUDE.md generator wizard.
 * Displays AI-generated app proposal cards and lets the user pick one before
 * proceeding to CLAUDE.md generation. Handles the empty / error state and
 * provides a "regenerate" action.
 */

'use client';

import React from 'react';
import type { AppProposal } from '../_types/types';
import { GLOBAL_CSS } from '../_utils/styles';
import { CheckIcon } from './icons';

interface ProposalsPhaseProps {
  topRef: React.RefObject<HTMLDivElement | null>;
  /** Translation function from use-wizard / use-wizardからの翻訳関数 */
  t: (key: string) => string;
  proposals: AppProposal[];
  aiErrorMessage: string;
  pickedProp: AppProposal | null;
  onPick: (proposal: AppProposal) => void;
  /** Re-runs AI proposal generation with the same answers / 同じ回答でAI提案生成を再実行する */
  onRegenerate: () => void;
  /** Generates the final CLAUDE.md for the picked proposal / 選択した提案のCLAUDE.mdを生成する */
  onGenerate: () => void;
}

/**
 * Returns the CSS color variable for a given difficulty string.
 *
 * @param d - difficulty value: 'easy' | 'medium' | 'hard' / 難易度値
 * @returns CSS custom property string / CSSカスタムプロパティ文字列
 */
function diffColor(d: string): string {
  return d === 'easy'
    ? 'var(--green)'
    : d === 'medium'
      ? 'var(--amber)'
      : 'var(--red)';
}

/**
 * Proposals list view with pick interaction, empty-state handling, and navigation buttons.
 *
 * @param props - ProposalsPhaseProps / ProposalsPhaseProps参照
 */
export function ProposalsPhase({
  topRef,
  t,
  proposals,
  aiErrorMessage,
  pickedProp,
  onPick,
  onRegenerate,
  onGenerate,
}: ProposalsPhaseProps) {
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
        <div style={{ marginBottom: 32 }}>
          <div
            style={{
              fontSize: 10,
              letterSpacing: '.18em',
              color: 'var(--accent)',
              marginBottom: 8,
            }}
          >
            STEP 5 / 5
          </div>
          <h2
            style={{
              fontFamily: "'Outfit',sans-serif",
              fontSize: 26,
              fontWeight: 800,
              marginBottom: 6,
            }}
          >
            {t('proposalsTitle')}
          </h2>
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>
            {t('proposalsDescription')}
          </p>
        </div>

        {proposals.length === 0 && (
          <div
            style={{
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: '32px 24px',
              textAlign: 'center',
              marginBottom: 32,
              background: 'var(--s1)',
            }}
          >
            <div style={{ fontSize: 32, marginBottom: 12 }}>
              &#x26A0;&#xFE0F;
            </div>
            {aiErrorMessage ? (
              <p
                style={{
                  color: 'var(--danger, #ef4444)',
                  fontSize: 13,
                  lineHeight: 1.6,
                  marginBottom: 20,
                  padding: '12px 16px',
                  background: 'var(--danger-bg, rgba(239, 68, 68, 0.1))',
                  borderRadius: 8,
                  border:
                    '1px solid var(--danger-border, rgba(239, 68, 68, 0.2))',
                }}
              >
                {aiErrorMessage}
              </p>
            ) : (
              <p
                style={{
                  color: 'var(--muted)',
                  fontSize: 13,
                  lineHeight: 1.8,
                  marginBottom: 20,
                }}
              >
                {t('proposalsEmpty')}
              </p>
            )}
            <button className="btn btn-p" onClick={onRegenerate}>
              {t('retry')}
            </button>
          </div>
        )}

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            marginBottom: 32,
          }}
        >
          {proposals.map((p, i) => {
            const picked = pickedProp?.id === p.id;
            return (
              <div
                key={p.id}
                className={`prop-card ${picked ? 'picked' : ''} fade stagger-${i + 1}`}
                onClick={() => onPick(p)}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    marginBottom: 10,
                  }}
                >
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: 10 }}
                  >
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 9,
                        background: `rgba(99,102,241,${0.1 + i * 0.08})`,
                        border: '1px solid rgba(99,102,241,.25)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 800,
                        fontSize: 16,
                        color: 'var(--accent2)',
                        flexShrink: 0,
                      }}
                    >
                      {p.id}
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 17 }}>
                        {p.name}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: 'var(--accent2)',
                          marginTop: 1,
                        }}
                      >
                        {p.tagline}
                      </div>
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      padding: '3px 10px',
                      borderRadius: 6,
                      background: `rgba(${p.difficulty === 'easy' ? '74,222,128' : p.difficulty === 'medium' ? '251,191,36' : '248,113,113'},.12)`,
                      color: diffColor(p.difficulty),
                      flexShrink: 0,
                    }}
                  >
                    {p.difficulty === 'easy'
                      ? t('difficultyEasy')
                      : p.difficulty === 'medium'
                        ? t('difficultyMedium')
                        : t('difficultyHard')}
                  </span>
                </div>

                <p
                  style={{
                    fontSize: 13,
                    color: '#c0c0d8',
                    lineHeight: 1.7,
                    marginBottom: 10,
                  }}
                >
                  {p.concept}
                </p>
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--accent2)',
                    marginBottom: 10,
                  }}
                >
                  ✦ {p.unique}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {(p.tech_hint || []).map((hint) => (
                    <span
                      key={hint}
                      className="tag tag-accent"
                      style={{ fontSize: 10 }}
                    >
                      {hint}
                    </span>
                  ))}
                </div>

                {picked && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 14,
                      right: 14,
                      width: 22,
                      height: 22,
                      borderRadius: '50%',
                      background: 'var(--accent)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <CheckIcon />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <button className="btn btn-g" onClick={onRegenerate}>
            {t('otherProposals')}
          </button>
          <button
            className="btn btn-p"
            disabled={!pickedProp}
            onClick={onGenerate}
          >
            {t('generateClaudeMd')}
          </button>
        </div>
      </div>
    </div>
  );
}
