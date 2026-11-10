/**
 * JuryFindingRow
 *
 * One jury finding (severity, criterion, evidence, repro, who raised it) and,
 * in the two-reviewer form, the seat that raised it and the verifier seat's
 * check of its grounds. A refuted finding stays visible but reads as dropped.
 * Split out of ReviewHistoryItems.tsx (file size); presentation only.
 */
'use client';

import { useTranslations } from 'next-intl';
import type { DisplayFinding, DisplaySeat, FindingVerification } from './review-history';
import { CHIP, GOOD, BAD, WARN, NEUTRAL } from './review-chips';

// Same tiers as the critic severity chips (high / medium / low).
const FINDING_CHIPS: Record<DisplayFinding['severity'], string> = {
  blocker: BAD,
  major: WARN,
  minor: NEUTRAL,
};

const VERIFICATION_CHIPS: Record<FindingVerification, string> = {
  holds: BAD,
  refuted: NEUTRAL,
  undetermined: WARN,
};

/**
 * One finding row.
 *
 * @param f - Finding to show / 表示する指摘
 * @returns List item / リスト項目
 */
export function JuryFindingRow({ f }: { f: DisplayFinding }) {
  const t = useTranslations('workflow');
  const k = 'taskWorkflowSection.criticHistory.jury';
  const dropped = f.verification === 'refuted';
  return (
    <li className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`${CHIP} ${FINDING_CHIPS[f.severity]}`}>
          {t(`${k}.severity.${f.severity}`)}
        </span>
        {f.verification && (
          <span className={`${CHIP} ${VERIFICATION_CHIPS[f.verification]}`}>
            {t(`${k}.verification.${f.verification}`)}
          </span>
        )}
        {f.needsCheck && <span className={`${CHIP} ${NEUTRAL}`}>{t(`${k}.needsCheck`)}</span>}
        {f.criterion && <span className="text-xs text-zinc-500">{f.criterion}</span>}
        <span
          className={`text-sm ${dropped ? 'text-zinc-400 line-through dark:text-zinc-500' : 'text-zinc-700 dark:text-zinc-200'}`}
        >
          {f.summary}
        </span>
      </div>
      {f.evidence && (
        <p className="pl-1 text-xs text-zinc-500 dark:text-zinc-400">
          {t(`${k}.evidence`)}: <span className="font-mono break-all">{f.evidence}</span>
        </p>
      )}
      {f.repro && (
        <p className="pl-1 text-xs text-zinc-500 dark:text-zinc-400">
          {t(`${k}.repro`)}: {f.repro}
        </p>
      )}
      {f.verificationNote && (
        <p className="pl-1 text-xs text-zinc-500 dark:text-zinc-400">
          {t(`${k}.verificationNote`)}: {f.verificationNote}
        </p>
      )}
      {(f.seatId || f.juror) && (
        <p className="pl-1 text-xs text-zinc-400 dark:text-zinc-500">
          {f.seatId
            ? `${t(`${k}.seat.${f.seatId}`)}${f.juror ? ` (${f.juror})` : ''}`
            : `${t(`${k}.juror`)}: ${f.juror}`}
        </p>
      )}
    </li>
  );
}

/**
 * The seats of a two-reviewer review in one line: who judged what.
 *
 * @param seats - Seats by role / 席
 * @returns Seat chips / 席ごとのチップ
 */
export function JurySeatsLine({ seats }: { seats: DisplaySeat[] }) {
  const t = useTranslations('workflow');
  const k = 'taskWorkflowSection.criticHistory.jury';
  if (seats.length === 0) return null;
  const label = (s: DisplaySeat) => {
    if (s.role === 'verifier')
      return t(`${k}.seatVerdict.${s.verdict === 'pass' ? 'checked' : 'unknown'}`);
    return t(
      `${k}.seatVerdict.${s.verdict === 'pass' || s.verdict === 'fail' ? s.verdict : 'unknown'}`,
    );
  };
  const chip = (s: DisplaySeat) =>
    s.role === 'verifier'
      ? NEUTRAL
      : s.verdict === 'fail'
        ? BAD
        : s.verdict === 'pass'
          ? GOOD
          : WARN;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      {seats.map((s) => (
        <span key={s.seatId} className={`${CHIP} ${chip(s)}`}>
          {t(`${k}.seat.${s.seatId}`)}: {label(s)}
        </span>
      ))}
    </div>
  );
}
