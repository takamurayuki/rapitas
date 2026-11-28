/**
 * check-catalog/catalog
 *
 * The single list of mechanical checks (task 1602): which checks the
 * self-verifier runs, which CI job steps and pre-save screens they stand for,
 * what the real gate says when they fail, and how to fix them. The
 * self-verifier and the post-commit gate both run `runAutomatedVerification`,
 * so they read this list through the same code. CI workflows are YAML under a
 * protected path and cannot import it; check-catalog.test.ts pins the values
 * below to them instead. Not responsible for running any check.
 */
import type { VerificationCheckName } from '../verification-check-types';

/** One mechanical check the self-verifier knows. */
export interface CheckCatalogEntry {
  id: VerificationCheckName;
  /** True when runAutomatedVerification runs it. */
  selfVerify: boolean;
  /** Name the pre-save stage reports for the same screen, when it has one. */
  presaveName?: string;
  /** What the real gate reports when this fails. */
  gateMessage: string;
  /** How to fix a failure. */
  fixHint: string;
}

export const CHECK_CATALOG: readonly CheckCatalogEntry[] = [
  {
    id: 'lint',
    selfVerify: true,
    gateMessage: 'CI の Lint Code（Lint backend/frontend code）が eslint のエラーで落ちます。',
    fixHint: '対象ファイルで eslint を実行し、エラー（警告ではなく）をすべて直してください。',
  },
  {
    id: 'typecheck',
    selfVerify: true,
    gateMessage: 'CI の Lint Code / Check Frontend の tsc --noEmit が型エラーで落ちます。',
    fixHint:
      'bunx tsc --noEmit（frontend は pnpm tsc --noEmit）を実行し、対象ファイルの型エラーを直してください。',
  },
  {
    id: 'test',
    selfVerify: true,
    gateMessage: 'CI の「Run the tests this PR adds or changes」が失敗します。',
    fixHint:
      '失敗したテストファイルを bun test --isolate <file> で1つずつ実行し、原因を直してください。',
  },
  {
    id: 'format',
    selfVerify: true,
    gateMessage: 'CI の Check backend/frontend formatting（prettier --check）が落ちます。',
    fixHint: '対象ファイルに prettier --write をかけてください。',
  },
  {
    id: 'generated-sync',
    selfVerify: true,
    gateMessage:
      'CI の Lint Code の生成物の同期チェック（boundary guide / type guards / route barrels / SQLite 生成物）が落ちます。',
    fixHint:
      'details にある再生成コマンドを rapitas-backend で実行し、生成物を同じ変更に含めてください。',
  },
  {
    id: 'scope',
    selfVerify: true,
    gateMessage: '計画外のファイルへの変更として差分レビューで指摘されます（参考のみ）。',
    fixHint: '計画外の変更が必要な理由を最終サマリに書くか、不要な変更を戻してください。',
  },
  {
    id: 'coverage',
    selfVerify: true,
    gateMessage: '検証ゲートの coverage がテストのないソース変更で落ちます。',
    fixHint: '変更したソースの振る舞いを確かめるテストを追加してください。',
  },
  {
    id: 'runtime',
    selfVerify: true,
    gateMessage: '検証ゲートの runtime（アプリの起動確認）が落ちます。',
    fixHint: 'details の起動ログを読み、起動を妨げている原因を直してください。',
  },
  {
    id: 'tamper',
    selfVerify: true,
    presaveName: 'tamper',
    gateMessage: '保存前の検査の改ざん検知が、保護パスの計画外の変更でコミットを止めます。',
    fixHint: '保護パスの変更を戻すか、plan.md に対象ファイルを明記して承認を得てください。',
  },
  {
    id: 'acceptance',
    selfVerify: true,
    gateMessage: '受入基準に対応する変更がないと検証の担当が差し戻します（参考のみ）。',
    fixHint: '各受入基準に対応する変更とテストを確かめてください。',
  },
  {
    id: 'schema-change',
    selfVerify: true,
    gateMessage: '検証ゲートが計画にない Prisma スキーマの変更を止めます。',
    fixHint: 'スキーマの変更を戻すか、計画に明記して承認を得てください。',
  },
  {
    id: 'red-state',
    selfVerify: true,
    gateMessage: '検証ゲートの red-state が、変更前のコードでも通るテストを差し戻します。',
    fixHint: '変更前のコードで失敗し、変更後に通るテストにしてください。',
  },
  {
    id: 'file-size',
    selfVerify: true,
    gateMessage: 'CI の Enforce per-file line limits（scripts/check-large-files.cjs）が落ちます。',
    fixHint:
      '300行を超えるファイルは分割し、ベースライン登録ファイルは行数を増やさないでください。',
  },
  {
    id: 'import-graph',
    selfVerify: true,
    gateMessage:
      'CI の Lint Code（Import direction and cycles）が新しい層違反か循環 import で落ちます。',
    fixHint:
      '下位の層へ共通部分を移すか、型だけなら import type、循環を切るだけなら動的 import() にしてください。ベースラインには足さないでください。',
  },
  {
    id: 'docs-drift',
    selfVerify: true,
    gateMessage: 'CI の Check Rust Code（Docs match the code）が文書とコードの食い違いで落ちます。',
    fixHint:
      '新しく読む環境変数は rapitas-backend/.env.example に足し、文書のパス・スクリプト名・版数はコードに合わせてください。',
  },
  {
    id: 'todos',
    selfVerify: true,
    gateMessage: 'CI の Enforce HACK/FIXME ceilings（ADR-0004）が上限超過で落ちます。',
    fixHint: '追加した HACK / FIXME の印を直すか、NOTE / TODO に書き換えて上限内に収めてください。',
  },
  {
    id: 'secret',
    selfVerify: true,
    presaveName: 'secret',
    gateMessage: '保存前の検査が秘密情報らしいファイルか文字列でコミットを止めます。',
    fixHint:
      '秘密情報を変更から取り除き、値は環境変数か OS のキーチェーンから読むようにしてください。',
  },
  {
    id: 'attribution',
    selfVerify: true,
    presaveName: 'attribution',
    gateMessage:
      '保存前の検査が、このタスクの作業と結び付けられないファイルでコミットを止めます（自己検証では参考のみ）。',
    fixHint: 'このタスクで変更していないファイルが差分に入っていないか確かめてください。',
  },
];

/** CI steps that set up the job instead of checking anything. */
export const NON_CHECK_STEP_RE = /^(Checkout|Setup|Install|Get |Generate|Prepare)/;

/** HACK / FIXME ceilings of ADR-0004, pinned to todos-check.yml by the tests. */
export const TODO_CEILINGS = { hack: 14, fixme: 1 } as const;

/** One check step of a CI job and the catalog check that stands for it. */
export interface CiStepMapping {
  step: string;
  checkId: VerificationCheckName | null;
  /** Command the step runs; pinned to the workflow by the tests when set. */
  command?: string;
}

/** A required CI job (quality-gates.json `name`) and every check step in it. */
export interface CiJobMapping {
  workflow: string;
  job: string;
  steps: CiStepMapping[];
}

const step = (name: string, checkId: VerificationCheckName | null = null, command?: string) => ({
  step: name,
  checkId,
  ...(command ? { command } : {}),
});

// NOTE: A failing CI check arrives as its job name only, so a job counts as
// covered only when every check step in it maps to a self-verified check.
export const CI_JOB_STEPS: Record<string, CiJobMapping> = {
  'Lint Code': {
    workflow: 'test-lint.yml',
    job: 'lint',
    steps: [
      step(
        'Import direction and cycles',
        'import-graph',
        'node scripts/import-graph/check-import-graph.cjs',
      ),
      step('Unused files'),
      step('Check desktop SQLite Prisma generation'),
      step('Check backend TypeScript', 'typecheck', 'tsc --noEmit'),
      step('Verify SQLite generated artifacts match committed files', 'generated-sync'),
      step('Verify PostgreSQL init SQL matches the schema'),
      step('Check backend TypeScript with SQLite Prisma Client'),
      step('Check backend formatting', 'format', 'prettier --check'),
      step('Check boundary guide drift', 'generated-sync', 'bun run check:boundary-guide'),
      step('Check type-guard drift', 'generated-sync', 'bun run check:type-guards'),
      step('Check route barrel drift', 'generated-sync', 'bun run generate:route-barrels:check'),
      step('Check toolchain version drift'),
      step('Check determinism guard (advisory)'),
      step('Lint backend code', 'lint', 'bun run lint'),
      step('Lint frontend code', 'lint', 'pnpm lint'),
      step('Check frontend formatting', 'format', 'prettier --check'),
    ],
  },
  'Check Rust Code': {
    workflow: 'test-lint.yml',
    job: 'rust-check',
    steps: [
      step('Test the system-dependency installer'),
      step('Test the root script tools'),
      step('Repo hygiene'),
      step('Docs match the code', 'docs-drift', 'node scripts/docs/check-docs-drift.cjs'),
      step('Docs follow the style rules'),
      step('Quality gates match the workflows'),
      step('Test the desktop dev-server scripts'),
      step('Check Rust formatting'),
      step('Run Clippy'),
    ],
  },
  'Check Frontend': {
    workflow: 'test-lint.yml',
    job: 'check-frontend',
    steps: [
      step('Run TypeScript type check', 'typecheck', 'tsc --noEmit'),
      step('Run frontend gate tests'),
      step('Run the tests this PR adds or changes (frontend)', 'test'),
    ],
  },
  'Test Backend': {
    workflow: 'test-lint.yml',
    job: 'test-backend',
    steps: [
      step('Run backend gate suite with coverage'),
      step('Print backend coverage summary'),
      step('Evaluate workflow quality gates'),
      step('Run the tests this PR adds or changes (backend)', 'test'),
    ],
  },
  'Enforce per-file line limits (with ratchet baseline)': {
    workflow: 'file-size.yml',
    job: 'file-size',
    steps: [
      step('Run file-size script tests'),
      step('Run file-size check (ratchet)', 'file-size', 'node scripts/check-large-files.cjs'),
    ],
  },
  'Enforce HACK/FIXME ceilings (ADR-0004)': {
    workflow: 'todos-check.yml',
    job: 'todos',
    steps: [step('Check TODO/HACK ceiling', 'todos', 'node scripts/check-todos.cjs')],
  },
  'Secret scanning': {
    workflow: 'gitleaks.yml',
    job: 'gitleaks',
    // gitleaks is broader than the pre-save token screen, so it stays unmapped.
    steps: [step('Run gitleaks')],
  },
};

/** Catalog entry for a check name, if any. */
export function catalogEntry(id: string): CheckCatalogEntry | undefined {
  return CHECK_CATALOG.find((e) => e.id === id);
}

const selfVerified = (id: VerificationCheckName | null) =>
  id !== null && catalogEntry(id)?.selfVerify === true;

/** How far the self-verifier covers one real gate. */
export interface GateCoverage {
  status: 'covered' | 'partial' | 'missing';
  /** Check steps of a partial job that no self-verified check stands for. */
  uncoveredSteps: string[];
}

/**
 * Whether the self-verifier covers a CI job, judged by job name — the only
 * thing a CI failure reports.
 *
 * @param jobName - quality-gates.json `name` of the failing job / CI のジョブ名
 * @returns Coverage and the uncovered steps / 網羅の状態と未対応のステップ
 */
export function ciCoverageOf(jobName: string): GateCoverage {
  const mapping = CI_JOB_STEPS[jobName];
  if (!mapping) return { status: 'missing', uncoveredSteps: [] };
  const uncoveredSteps = mapping.steps.filter((s) => !selfVerified(s.checkId)).map((s) => s.step);
  return { status: uncoveredSteps.length === 0 ? 'covered' : 'partial', uncoveredSteps };
}

/**
 * Whether the self-verifier covers a pre-save / post-commit gate check name.
 *
 * @param name - Check name the stage reported (tamper, secret, lint, …) / 検査名
 * @returns Coverage / 網羅の状態
 */
export function presaveCoverageOf(name: string): GateCoverage {
  const entry = CHECK_CATALOG.find((e) => e.presaveName === name || e.id === name);
  return { status: entry?.selfVerify ? 'covered' : 'missing', uncoveredSteps: [] };
}
