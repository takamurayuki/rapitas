/**
 * capture-jury-reply-1541
 *
 * Asks one real review seat, once, to judge task 1541's diff with the current
 * diff-review prompt, and stores its raw reply as the fixture that acceptance
 * criterion 5 of task 1547 replays (services/agents/verification/fixtures/
 * task-1541-negation-capture.json). Not a test: it costs a model call, its
 * result varies, and tests only read the fixture it writes.
 *
 * NOTE: The input is a RECONSTRUCTION, not the version transition 22030 saw.
 * Task 1541 committed once at the end (3d770fba3, after the negation miss was
 * fixed), so no commit holds the reviewed version. The only record of it is
 * transition 22030's `metadata.reason`, which quotes the negation rule:
 * 「NEGATED_CONTRADICTION の「矛盾して\s*(いない|いません|ない)」」 and
 * 「POSITIVE_CONTRADICTION は「自己矛盾」だけで一致する」.
 * The script takes 3d770fba3's bounce-reason-classifier.ts and reverts only the
 * negation check to that quote:
 *   1. adds `const NEGATED_CONTRADICTION = /矛盾して\s*(いない|いません|ない)/;`
 *      before `isNegatedAfterContradiction`;
 *   2. replaces that function's two-line body (`indexOf('矛盾')` + NEGATION_TAIL)
 *      with `return NEGATED_CONTRADICTION.test(sentence);`.
 * POSITIVE_CONTRADICTION already ends in `自己矛盾` and is kept as is.
 * Everything else (comments, the machine-word branch, tests in the diff) stays
 * as in 3d770fba3. Before calling the model the script checks the quote is in
 * the transition, each replaced line occurs exactly once, and the miss
 * reproduces (「検証レポートは自己矛盾していなかった」 is verify_contradiction only in
 * the reconstruction; present-tense negation stays excluded). Any failure exits 1.
 *
 * It reads the running backend with GET only and git with show/diff/merge-base
 * only; it writes nothing to the DB, only the fixture and a private temp dir.
 *
 * Usage (from rapitas-backend): bun run scripts/capture-jury-reply-1541.ts --attempt <1-3> [--check-only]
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDiffReviewPrompt } from '../services/agents/verification/adversarial-diff-review-prompt';
import { parseReviewVerdict } from '../services/agents/verification/adversarial-diff-review-verdict';
import {
  buildJuryDiffText,
  type JuryDiffFile,
} from '../services/agents/verification/jury-diff-text';
import { buildPanel } from '../services/agents/verification/jury-panel';
import { parseAcceptanceCriteria } from '../services/agents/verification/review-acceptance-criteria';
import { sendAIMessage } from '../utils/ai-client';

const API = process.env.RAPITAS_API_URL ?? 'http://127.0.0.1:3001';
const TASK_ID = 1541;
const TRANSITION_ID = 22030;
const COMMIT = '3d770fba3';
const MERGE = '53342af86';
const FILE = 'rapitas-backend/services/self-improvement/bounce-reason-classifier.ts';
const FIXTURE = join(
  import.meta.dir,
  '../services/agents/verification/fixtures/task-1541-negation-capture.json',
);
const QUOTES = ['矛盾して\\s*(いない|いません|ない)', '自己矛盾'];
const FN_HEAD = 'function isNegatedAfterContradiction(sentence: string): boolean {';
const OLD_LINE_1 = "  const at = sentence.indexOf('矛盾');";
const OLD_LINE_2 = "  return at >= 0 && NEGATION_TAIL.test(sentence.slice(at + '矛盾'.length));";
const NEW_CONST = 'const NEGATED_CONTRADICTION = /矛盾して\\s*(いない|いません|ない)/;';
const NEW_BODY = '  return NEGATED_CONTRADICTION.test(sentence);';
const NEGATION_RE = /否定|なかった|ません|ない/;

function fail(message: string, code = 1): never {
  console.error(`[capture-1541] ${message}`);
  process.exit(code);
}

// NOTE: Run at the repo root: pathspecs are root-relative. From rapitas-backend/
// they matched nothing, so attempt 1 saw empty patches except the classifier.
const REPO_ROOT = join(import.meta.dir, '..', '..');
const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });

async function getJson(path: string): Promise<unknown> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) fail(`GET ${path} → HTTP ${res.status}`);
  return res.json();
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Revert only the negation check of 3d770fba3's classifier to the quoted form. */
function reconstruct(original: string): string {
  for (const line of [FN_HEAD, OLD_LINE_1, OLD_LINE_2]) {
    if (original.split(line).length !== 2) fail(`expected exactly one occurrence of: ${line}`);
  }
  return original
    .replace(FN_HEAD, `${NEW_CONST}\n\n${FN_HEAD}`)
    .replace(`${OLD_LINE_1}\n${OLD_LINE_2}`, NEW_BODY);
}

function addedPatch(filename: string, content: string): JuryDiffFile {
  const lines = content.endsWith('\n') ? content.slice(0, -1).split('\n') : content.split('\n');
  // Same "new file" patch shape getDiff synthesizes (diff-structured.ts).
  const head = `diff --git a/${filename} b/${filename}\nnew file mode 100644\n--- /dev/null`;
  const patch = `${head}\n+++ b/${filename}\n@@ -0,0 +1,${lines.length} @@\n+${lines.join('\n+')}`;
  return { filename, status: 'added', additions: lines.length, deletions: 0, patch };
}

function parseAttempt(): { attempt: number; checkOnly: boolean } {
  const i = process.argv.indexOf('--attempt');
  const attempt = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  if (!Number.isInteger(attempt) || attempt < 1) fail('--attempt <1-3> is required', 2);
  if (attempt > 3) fail('at most 3 attempts are allowed (plan §R4)', 2);
  return { attempt, checkOnly: process.argv.includes('--check-only') };
}

async function main(): Promise<void> {
  const { attempt, checkOnly } = parseAttempt();

  // 1. The quote on transition 22030.
  const tr = (await getJson(`/workflow/tasks/${TASK_ID}/transitions`)) as {
    transitions?: Array<{ id: number; createdAt: string; metadata: unknown }>;
  };
  const row = tr.transitions?.find((t) => t.id === TRANSITION_ID);
  if (!row) fail(`transition ${TRANSITION_ID} not found`);
  const m = row.metadata;
  const meta = (typeof m === 'string' ? JSON.parse(m) : m) as { reason?: string } | null;
  const reason = meta?.reason ?? '';
  for (const q of QUOTES) if (!reason.includes(q)) fail(`transition reason lacks quote: ${q}`);

  // 2. Reconstruct and check the miss reproduces.
  const original = git('show', `${COMMIT}:${FILE}`);
  const rebuilt = reconstruct(original);
  const dir = mkdtempSync(join(tmpdir(), 'capture-1541-'));
  try {
    writeFileSync(join(dir, 'original.ts'), original);
    writeFileSync(join(dir, 'bounce-reason-classifier.ts'), rebuilt);
    type Classifier = { classifyBounceReason: (s: string) => string };
    const load = (name: string) => import(join(dir, name)) as Promise<Classifier>;
    const [rebuiltMod, originalMod] = await Promise.all([
      load('bounce-reason-classifier.ts'),
      load('original.ts'),
    ]).catch((err) => fail(`reproduction check 1: could not import (${String(err)})`));
    const past = '検証レポートは自己矛盾していなかった';
    const present = '検証レポートは自己矛盾していない';
    const VC = 'verify_contradiction';
    const reproductionCheck = [
      { check: 1, input: past, reconstructed: rebuiltMod.classifyBounceReason(past), expect: VC },
      {
        check: 2,
        input: past,
        original: originalMod.classifyBounceReason(past),
        expect: `not ${VC}`,
      },
      {
        check: 3,
        input: present,
        reconstructed: rebuiltMod.classifyBounceReason(present),
        expect: `not ${VC}`,
      },
    ];
    console.log(JSON.stringify({ reproductionCheck }, null, 2));
    if (reproductionCheck[0].reconstructed !== VC) fail('reproduction check 1 failed');
    if (reproductionCheck[1].original === VC) fail('reproduction check 2 failed');
    if (reproductionCheck[2].reconstructed === VC) fail('reproduction check 3 failed');
    let revertedDiff = '';
    try {
      execFileSync('git', ['diff', '--no-index', 'original.ts', 'bounce-reason-classifier.ts'], {
        cwd: dir,
        encoding: 'utf8',
      });
    } catch (err) {
      // git diff --no-index exits 1 when the files differ; stdout is the diff.
      revertedDiff = String((err as { stdout?: string }).stdout ?? '')
        .split('a/original.ts')
        .join(`a/${FILE}`)
        .split('b/bounce-reason-classifier.ts')
        .join(`b/${FILE}`);
    }
    if (!revertedDiff) fail('could not diff the reconstruction');
    if (checkOnly) {
      console.log(revertedDiff);
      console.log('[capture-1541] --check-only: all checks passed, model not called');
      return;
    }

    // 3. The diff the seat sees, with the classifier swapped for the reconstruction.
    const base = git('merge-base', COMMIT, `${MERGE}^1`).trim();
    const statusOf = new Map(
      git('diff', '--name-status', base, COMMIT)
        .trim()
        .split('\n')
        .map((l) => l.split('\t'))
        .map(([s, f]) => [f, s === 'A' ? 'added' : s === 'D' ? 'deleted' : 'modified'] as const),
    );
    const files: JuryDiffFile[] = git('diff', '--numstat', base, COMMIT)
      .trim()
      .split('\n')
      .map((l) => l.split('\t'))
      .map(([add, del, filename]) =>
        filename === FILE
          ? addedPatch(FILE, rebuilt)
          : {
              filename,
              status: statusOf.get(filename) ?? 'modified',
              additions: Number(add),
              deletions: Number(del),
              patch: git('diff', base, COMMIT, '--', filename),
            },
      );
    const empty = files.filter((f) => !f.patch?.trim()).map((f) => f.filename);
    if (empty.length > 0) fail(`empty patch for: ${empty.join(', ')}`);
    const diffText = buildJuryDiffText(files);

    // 4. The prompt, exactly as reviewDiffAdversarially builds it.
    const task = (await getJson(`/tasks/${TASK_ID}`)) as Record<string, unknown>;
    const t = (task.task ?? task.data ?? task) as Record<string, unknown>;
    const planFile = (await getJson(`/workflow/tasks/${TASK_ID}/files/plan`)) as {
      content?: string;
    };
    const acceptanceCriteria = parseAcceptanceCriteria(t.acceptanceCriteria);
    const prompt = buildDiffReviewPrompt({
      taskTitle: String(t.title ?? `task-${TASK_ID}`),
      taskDescription: t.description as string | null,
      goals: parseAcceptanceCriteria(t.goals),
      constraints: parseAcceptanceCriteria(t.constraints),
      planContent: planFile.content ?? '',
      acceptanceCriteria,
      diffText,
      measuredVerification: null,
      verifyClaim: null,
    });

    // 5. One call to the first reviewer seat, with askJuror's arguments
    // (juror-call.ts: systemPrompt, maxTokens 2000, cliRoute).
    const seat = buildPanel({ implementerModel: null })[0] ?? fail('buildPanel returned no seat');
    const res = await sendAIMessage({
      provider: seat.provider,
      model: seat.model,
      ...(seat.cliRoute ? { cliRoute: seat.cliRoute } : {}),
      systemPrompt: 'You are a meticulous, skeptical senior code reviewer.',
      maxTokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });
    const rawReply = res.content;

    const parsed = parseReviewVerdict(rawReply); // 6. summary: same rule as the replay test
    const target = (parsed.findings ?? []).find(
      (f) =>
        f.criterion === '受入基準1' &&
        [f.summary, f.evidence ?? '', ...(f.examples ?? [])].some((s) => NEGATION_RE.test(s)),
    );
    const summary = !target
      ? `verdict ${parsed.verdict}, no negation finding on 受入基準1`
      : `${target.impact ?? 'blocking'}, examples ${target.examples?.length ?? 0} 件`;
    console.log(`[capture-1541] attempt ${attempt}: ${summary}`);

    type Prev = { _capture?: { attempts?: unknown[] } };
    const prev = (existsSync(FIXTURE) ? JSON.parse(readFileSync(FIXTURE, 'utf8')) : {}) as Prev;
    const prior = prev._capture?.attempts ?? [];
    const capturedAt = new Date().toISOString();
    const fixture = {
      _capture: {
        reconstruction: {
          reconstructed: true,
          note: '遷移 22030 の時点の版は残っていないため、3d770fba3 の分類器の否定の判定だけを、22030 の evidence が引用する正規表現に戻した再構成',
          sourceTransitionId: TRANSITION_ID,
          sourceField: 'metadata.reason',
          quotedText: QUOTES,
          sourceCommit: COMMIT,
          file: FILE,
          revertedDiff,
          reproductionCheck,
        },
        input: {
          taskId: TASK_ID,
          sourceTransitionId: TRANSITION_ID,
          transitionCreatedAt: row.createdAt,
          commit: COMMIT,
          baseCommit: base,
          changedFiles: files.map((f) => f.filename),
          diffChars: diffText.length,
          diffSha256: sha256(diffText),
          promptChars: prompt.length,
          promptSha256: sha256(prompt),
          criteria: acceptanceCriteria,
          planSource: '採取時点の GET /workflow/tasks/1541/files/plan（22030 当時の版ではない）',
          promptRevision: git('rev-parse', 'HEAD').trim(),
        },
        model: { provider: seat.provider, model: seat.model, modelName: res.modelName ?? null },
        capturedAt,
        script: 'scripts/capture-jury-reply-1541.ts',
        attempts: [...prior, { attempt, capturedAt, result: summary }],
        rawReplySha256: sha256(rawReply),
      },
      rawReply,
    };
    writeFileSync(FIXTURE, `${JSON.stringify(fixture, null, 2)}\n`);
    console.log(`[capture-1541] wrote ${FIXTURE}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

await main();
