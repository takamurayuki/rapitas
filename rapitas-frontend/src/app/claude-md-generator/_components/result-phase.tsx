'use client';
// result-phase

import React, { useMemo, useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import type { AppProposal, DocKind, GenerateResult } from '../_types/types';
import type { SetupPhase } from '../_hooks/useWizard';
import { GLOBAL_CSS } from '../_utils/styles';
import { AGENT_TARGETS } from '../_utils/constants';
import { ScoreRing } from './score-ring';

interface ResultPhaseProps {
  topRef: React.RefObject<HTMLDivElement | null>;
  /** Translation function from use-wizard / use-wizardからの翻訳関数 */
  t: (key: string) => string;
  pickedProp: AppProposal | null;
  result: GenerateResult | null;
  setupPhase: SetupPhase;
  /** id of the primary agent the repo targets / 対象エージェントID */
  agentTargetId: string;
  /** Selects the primary agent (decides the guide file name/path) / 対象エージェントを選択 */
  onSetAgentTarget: (id: string) => void;
  createdThemePath: string | null;
  setupError: string | null;
  onRestart: () => void;
  onCreateTheme: () => void;
  onResetSetup: () => void;
}

interface DocTab {
  kind: DocKind;
  label: string;
  filename: string;
  content: string;
}

/**
 * Result screen presenting the generated 3-document package (requirements,
 * design, CLAUDE.md) in tabs with per-tab copy, plus the theme-creation action
 * that scaffolds and git-inits the repository.
 *
 * @param props - ResultPhaseProps / ResultPhaseProps参照
 */
export function ResultPhase({
  topRef,
  t,
  pickedProp,
  result,
  setupPhase,
  agentTargetId,
  onSetAgentTarget,
  createdThemePath,
  setupError,
  onRestart,
  onCreateTheme,
  onResetSetup,
}: ResultPhaseProps) {
  const agentTarget = AGENT_TARGETS.find((a) => a.id === agentTargetId) || AGENT_TARGETS[0];
  // The agent guide's tab label/path follow the chosen primary agent.
  const agentFileName = agentTarget.path.split('/').pop() || agentTarget.path;

  // Only surface docs that were actually generated; requirements/design are
  // optional (e.g. on the error fallback path).
  const tabs = useMemo<DocTab[]>(() => {
    const defs: DocTab[] = [
      {
        kind: 'requirements',
        label: t('tabRequirements'),
        filename: 'docs/requirements.md',
        content: result?.requirements || '',
      },
      {
        kind: 'design',
        label: t('tabDesign'),
        filename: 'docs/design.md',
        content: result?.design || '',
      },
      {
        kind: 'claude_md',
        label: agentFileName,
        filename: agentTarget.path,
        content: result?.claude_md || '',
      },
    ];
    return defs.filter((d) => d.content.trim().length > 0);
  }, [result, t, agentFileName, agentTarget.path]);

  const [activeKind, setActiveKind] = useState<DocKind>('requirements');
  const [copied, setCopied] = useState(false);

  const active = tabs.find((d) => d.kind === activeKind) || tabs[tabs.length - 1];

  const handleCopyActive = () => {
    if (!active) return;
    navigator.clipboard.writeText(active.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="cmd-gen"
      style={{ minHeight: 'calc(100vh - 4rem - 1px)', background: 'var(--bg)', padding: '40px 20px' }}
    >
      <style>{GLOBAL_CSS}</style>
      <div style={{ maxWidth: 820, margin: '0 auto' }} className="fade" ref={topRef}>
        {/* Header row */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: 28,
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
            <h2 style={{ fontSize: 26, fontWeight: 800, whiteSpace: 'pre-line' }}>
              {(t as (k: string, v?: Record<string, unknown>) => string)('resultTitle', {
                name: pickedProp?.name ?? '',
              })}
            </h2>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              className="btn btn-p"
              onClick={handleCopyActive}
              style={{ background: copied ? 'var(--green)' : undefined }}
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
            <p style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.85 }}>
              {result.tech_rationale}
            </p>
          </div>
        )}

        {/* Document tabs */}
        <div
          style={{
            display: 'flex',
            gap: 4,
            borderBottom: '1px solid var(--border)',
            marginBottom: 16,
            flexWrap: 'wrap',
          }}
        >
          {tabs.map((tab) => {
            const isActive = active?.kind === tab.kind;
            return (
              <button
                key={tab.kind}
                onClick={() => setActiveKind(tab.kind)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  borderBottom: `2px solid ${isActive ? 'var(--accent)' : 'transparent'}`,
                  color: isActive ? 'var(--accent)' : 'var(--muted)',
                  fontWeight: isActive ? 700 : 500,
                  fontSize: 13,
                  padding: '10px 16px',
                  cursor: 'pointer',
                  marginBottom: -1,
                  transition: 'color .15s,border-color .15s',
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {active && (
          <>
            <div
              style={{
                fontSize: 11,
                fontFamily: "'JetBrains Mono',ui-monospace,monospace",
                color: 'var(--accent2)',
                marginBottom: 8,
              }}
            >
              {active.filename}
            </div>
            <div className="codebox">{active.content}</div>
          </>
        )}

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
          <p style={{ color: 'var(--text)', fontSize: 14, lineHeight: 1.6, marginBottom: 16 }}>
            {t('createThemeDescription')}
          </p>

          {setupPhase === 'idle' && (
            <>
              <div style={{ marginBottom: 16 }}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--muted)',
                    marginBottom: 8,
                  }}
                >
                  {t('targetAgentLabel')}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                  {AGENT_TARGETS.map((a) => {
                    const sel = a.id === agentTargetId;
                    return (
                      <button
                        key={a.id}
                        onClick={() => onSetAgentTarget(a.id)}
                        style={{
                          background: sel ? 'rgba(99,102,241,.12)' : 'transparent',
                          border: `1.5px solid ${sel ? 'var(--accent)' : 'var(--border)'}`,
                          color: sel ? 'var(--accent2)' : 'var(--muted)',
                          borderRadius: 9,
                          padding: '8px 14px',
                          fontSize: 13,
                          fontWeight: sel ? 700 : 500,
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                          transition: 'all .15s',
                        }}
                      >
                        {a.label}
                      </button>
                    );
                  })}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    fontFamily: "'JetBrains Mono',ui-monospace,monospace",
                    color: 'var(--accent2)',
                  }}
                >
                  {agentTarget.path}
                </div>
              </div>

              <button
                className="btn btn-p"
                onClick={onCreateTheme}
                style={{ background: 'var(--green)', fontSize: 14, padding: '12px 24px' }}
              >
                {t('createTheme')}
              </button>
            </>
          )}

          {setupPhase === 'loading' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div className="spin" style={{ width: 20, height: 20 }} />
              <span style={{ color: 'var(--text)', fontSize: 14 }}>{t('creatingTheme')}</span>
            </div>
          )}

          {setupPhase === 'success' && (
            <div>
              <div
                style={{
                  color: 'var(--green)',
                  fontSize: 14,
                  marginBottom: 8,
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <CheckCircle2 size={16} strokeWidth={1.75} /> {t('themeCreated')}
              </div>
              <p style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 12 }}>
                {t('themeCreatedDescription')}
              </p>
              {createdThemePath && (
                <div
                  style={{
                    background: 'var(--s2)',
                    padding: '8px 12px',
                    borderRadius: 6,
                    fontSize: 11,
                    fontFamily: "'JetBrains Mono',ui-monospace,monospace",
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
                  color: 'var(--red)',
                  fontSize: 14,
                  marginBottom: 8,
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <XCircle size={16} strokeWidth={1.75} /> {t('themeCreateError')}
              </div>
              {setupError && (
                <p style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 12 }}>{setupError}</p>
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
            fontFamily: "'JetBrains Mono',ui-monospace,monospace",
          }}
        >
          {t('saveInstruction')}
        </p>
      </div>
    </div>
  );
}
