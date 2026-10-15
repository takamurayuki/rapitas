'use client';
// review-phase

import React from 'react';
import type { ReviewQuestion, ReviewSpecResult } from '../../api/review-spec/review-prompt';
import { PageWrap } from './page-wrap';

interface ReviewPhaseProps {
  topRef: React.RefObject<HTMLDivElement | null>;
  /** Translation function from use-wizard / use-wizardからの翻訳関数 */
  t: (key: string) => string;
  review: ReviewSpecResult | null;
  /** Answer text per question id. / 質問IDごとの回答 */
  answers: Record<string, string>;
  onSetAnswer: (id: string, value: string) => void;
  /** Regenerates the documents with the answers. / 回答を反映して再生成する */
  onRegenerate: () => void;
  /** Accepts the documents as they are. / 現状のまま次へ進む */
  onAccept: () => void;
  /** Rounds already shown, 1-based for display. / 表示中のラウンド(1始まり) */
  round?: number;
  /** Cap on rounds, so the user can see this ends. / ラウンド上限 */
  maxRounds?: number;
}

const SEVERITY_COLOR: Record<string, string> = {
  error: 'var(--red, #e5484d)',
  warning: 'var(--amber, #f5a524)',
};

/** One question with its impact and quick-pick options. */
function QuestionRow({
  q,
  value,
  onSet,
  t,
}: {
  q: ReviewQuestion;
  value: string;
  onSet: (v: string) => void;
  t: (key: string) => string;
}) {
  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 700 }}>{q.question}</div>
      {q.impact && (
        <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>{q.impact}</div>
      )}
      {q.options.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {q.options.map((opt) => (
            <button
              key={opt}
              type="button"
              className="btn btn-g"
              onClick={() => onSet(opt)}
              style={{
                fontSize: 12,
                padding: '5px 10px',
                borderColor: value === opt ? 'var(--green)' : undefined,
              }}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
      <input
        id={`review-${q.id}`}
        type="text"
        value={value}
        onChange={(e) => onSet(e.target.value)}
        placeholder={t('reviewAnswerHint')}
        aria-label={q.question}
        style={{
          padding: '8px 11px',
          borderRadius: 8,
          border: '1px solid var(--border)',
          background: 'var(--card)',
          color: 'inherit',
          fontSize: 13,
        }}
      />
    </div>
  );
}

/**
 * Shows what the generated specification still leaves open, and lets the user
 * answer it before any code is written.
 *
 * Two independent halves: mechanical findings from the backend checker (is
 * every feature verifiable and traceable, are the unknowns recorded) and
 * judgement questions from the model (which figures it decided on its own
 * authority). Either half can be empty — a thin review is still better than the
 * previous behaviour, where the first chance to notice a gap was an
 * implementation task bouncing.
 *
 * @param props - ReviewPhaseProps / ReviewPhaseProps参照
 */
export function ReviewPhase({
  topRef,
  t,
  review,
  answers,
  onSetAnswer,
  onRegenerate,
  onAccept,
  round = 1,
  maxRounds,
}: ReviewPhaseProps) {
  const findings = review?.findings ?? [];
  const questions = review?.questions ?? [];
  const answered = questions.filter((q) => (answers[q.id] ?? '').trim()).length;
  const clean = findings.length === 0 && questions.length === 0;
  // Shown because the first version looped: the user could not tell whether
  // answering was making progress (reported 2026-10-12).
  const isLastRound = maxRounds !== undefined && round >= maxRounds;

  return (
    <PageWrap topRef={topRef} title={t('reviewTitle')} sub={t('reviewSubtitle')} step={6} total={6}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        {clean && <p style={{ fontSize: 14, lineHeight: 1.8 }}>{t('reviewNoFindings')}</p>}

        {findings.length > 0 && (
          <>
            <h3 style={{ fontSize: 15, fontWeight: 800, margin: '4px 0 10px' }}>
              {t('reviewFindingsHeading')}
            </h3>
            <ul style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 24 }}>
              {findings.map((f, i) => (
                <li
                  key={`${f.code}-${i}`}
                  style={{ fontSize: 13, lineHeight: 1.7, display: 'flex', gap: 8 }}
                >
                  <span style={{ color: SEVERITY_COLOR[f.severity], fontWeight: 700 }}>
                    {f.severity === 'error' ? '●' : '○'}
                  </span>
                  <span>{f.message}</span>
                </li>
              ))}
            </ul>
          </>
        )}

        {questions.length > 0 && (
          <>
            <h3 style={{ fontSize: 15, fontWeight: 800, margin: '4px 0 10px' }}>
              {t('reviewQuestionsHeading')}
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {questions.map((q) => (
                <QuestionRow
                  key={q.id}
                  q={q}
                  value={answers[q.id] ?? ''}
                  onSet={(v) => onSetAnswer(q.id, v)}
                  t={t}
                />
              ))}
            </div>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 12, lineHeight: 1.7 }}>
              {(t as (k: string, v?: Record<string, unknown>) => string)('reviewProgress', {
                answered,
                total: questions.length,
              })}
            </p>
          </>
        )}

        {review?.degradedReason && (
          <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 14 }}>
            {review.degradedReason}
          </p>
        )}

        {maxRounds !== undefined && (
          <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 14, lineHeight: 1.7 }}>
            {`壁打ち ${round} / ${maxRounds} 回目。`}
            {isLastRound
              ? '次の再生成で、質問が残っていても結果へ進みます。'
              : '回答は次のラウンドに引き継がれます。いつでも「このまま進む」で結果へ移れます。'}
          </p>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 24, flexWrap: 'wrap' }}>
          <button
            className="btn btn-p"
            onClick={onRegenerate}
            disabled={answered === 0}
            title={answered === 0 ? t('reviewRegenerateDisabled') : undefined}
            style={{
              background: 'var(--green)',
              padding: '12px 22px',
              opacity: answered === 0 ? 0.5 : undefined,
              cursor: answered === 0 ? 'not-allowed' : undefined,
            }}
          >
            {t('reviewRegenerate')}
          </button>
          <button className="btn btn-g" onClick={onAccept} style={{ padding: '12px 22px' }}>
            {t('reviewAccept')}
          </button>
        </div>
      </div>
    </PageWrap>
  );
}
