/**
 * supervisor-agreement-format
 *
 * Renders an AgreementReport as a plain-text table for stdout. Pure: no I/O,
 * no database. The `--json` output is just JSON.stringify of the report.
 */
import {
  EXCLUSION_REASONS,
  type AgreementReport,
  type Bucket,
} from './supervisor-agreement-scoring';

/** Format a rate as a percentage; n/a when there is nothing to divide. */
export function formatRate(rate: number | null): string {
  return rate === null ? 'n/a' : `${(rate * 100).toFixed(1)}%`;
}

function row(label: string, b: Bucket): string {
  return `  ${label.padEnd(40)} ${String(b.total).padStart(5)}  ${String(b.matched).padStart(5)}  ${formatRate(b.rate).padStart(7)}`;
}

function reasons(byReason: Partial<Record<string, number>>): string[] {
  return EXCLUSION_REASONS.map((reason) => `    ${reason.padEnd(28)} ${byReason[reason] ?? 0}`);
}

/**
 * Render the report for humans.
 *
 * @param r - Aggregated report. / 集計結果
 * @returns Multi-line text, ending without a newline. / 表示用テキスト
 */
export function formatAgreementReport(r: AgreementReport): string {
  const head = `  ${'group'.padEnd(40)} ${'count'.padStart(5)}  ${'match'.padStart(5)}  ${'rate'.padStart(7)}`;
  const pair = (label: string, s: { with: Bucket; without: Bucket }) => [
    row(`  ${label}: yes`, s.with),
    row(`  ${label}: no`, s.without),
  ];
  return [
    '[supervisor-agreement] operator proxy answers vs recommended option',
    `  answers: ${r.answers.total} = counted ${r.answers.counted} + excluded ${r.answers.excluded.total}`,
    `  questions: ${r.questions.total} = counted ${r.questions.counted} + excluded ${r.questions.excluded.total}`,
    `  not proxy answers (out of scope, counted only): ${r.outOfScope}`,
    '',
    head,
    row('overall (counted questions)', r.overall),
    '  by kind',
    ...Object.entries(r.byKind).map(([k, b]) => row(`  ${k}`, b)),
    '  by marks on the recommended option',
    ...pair('mutatesGate', r.byMutatesGate),
    ...pair('requiresOperatorAction', r.byRequiresOperatorAction),
    '  by marks on the option actually chosen (reference)',
    ...pair('mutatesGate', r.byChosenMutatesGate),
    ...pair('requiresOperatorAction', r.byChosenRequiresOperatorAction),
    '',
    'excluded answers by reason',
    ...reasons(r.answers.excluded.byReason),
    'excluded questions by reason',
    ...reasons(r.questions.excluded.byReason),
    '',
    `selection source: selections ${r.selectionSource.selections}, key ${r.selectionSource.key}, label ${r.selectionSource.label}`,
  ].join('\n');
}
