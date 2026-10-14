'use client';
// context-phase

import React from 'react';
import { CONTEXT_FIELDS } from '../_utils/constants';
import type { ProjectContext } from '../_types/types';
import { PageWrap } from './page-wrap';

interface ContextPhaseProps {
  topRef: React.RefObject<HTMLDivElement | null>;
  /** Translation function from use-wizard / use-wizardからの翻訳関数 */
  t: (key: string) => string;
  /** The app the user picked, named back to them for concreteness. / 選択されたアプリ */
  appName: string;
  context: ProjectContext;
  onSetField: (key: keyof ProjectContext, value: string) => void;
  /** Starts generation with whatever was filled in. / 入力内容で生成を開始する */
  onGenerate: () => void;
  /** Returns to the proposals phase. / 提案フェーズへ戻る */
  onBack: () => void;
}

/**
 * Asks the user for the facts about their own project before the specification
 * is written.
 *
 * Every field is optional and blank means 未確認 — the generator records those
 * as assumptions in the requirements' 前提と未決事項 section instead of
 * inventing a value. That matters because an invented figure does not stay a
 * figure: measured 2026-10-11, TempoRaid's spec asserted 10,000 concurrent
 * users, p95 150ms and 99.5% availability — none of it asked for — and those
 * numbers chose Redis-backed room state and a horizontally scaled API.
 *
 * @param props - ContextPhaseProps / ContextPhaseProps参照
 */
export function ContextPhase({
  topRef,
  t,
  appName,
  context,
  onSetField,
  onGenerate,
  onBack,
}: ContextPhaseProps) {
  const answered = CONTEXT_FIELDS.filter((k) => (context[k] ?? '').trim()).length;

  return (
    <PageWrap
      topRef={topRef}
      title={t('contextTitle')}
      sub={t('contextSubtitle')}
      step={5}
      total={6}
      onBack={onBack}
      onNext={onGenerate}
      nextLabel={t('contextGenerate')}
    >
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <p style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>{appName}</p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {CONTEXT_FIELDS.map((key) => (
            <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label htmlFor={`ctx-${key}`} style={{ fontSize: 13, fontWeight: 700 }}>
                {t(`contextField_${key}`)}
              </label>
              <input
                id={`ctx-${key}`}
                type="text"
                value={context[key] ?? ''}
                onChange={(e) => onSetField(key, e.target.value)}
                placeholder={t(`contextHint_${key}`)}
                style={{
                  padding: '9px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'var(--card)',
                  color: 'inherit',
                  fontSize: 14,
                }}
              />
            </div>
          ))}
        </div>

        <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 18, lineHeight: 1.7 }}>
          {(t as (k: string, v?: Record<string, unknown>) => string)('contextProgress', {
            answered,
            total: CONTEXT_FIELDS.length,
          })}
        </p>
      </div>
    </PageWrap>
  );
}
