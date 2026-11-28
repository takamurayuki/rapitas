/**
 * check-catalog — parity with the CI workflows (task 1602)
 *
 * The catalog is the single list the self-verifier and the real gates pick
 * their checks from. CI workflows are YAML under a protected path and cannot
 * import it, so these tests pin the two together instead: change a ceiling,
 * add a CI step or rename a command and a test here goes red.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CHECK_CATALOG,
  CI_JOB_STEPS,
  NON_CHECK_STEP_RE,
  TODO_CEILINGS,
  ciCoverageOf,
  presaveCoverageOf,
} from './catalog';

const REPO = join(import.meta.dir, '..', '..', '..', '..', '..');
const readRepo = (p: string) => readFileSync(join(REPO, p), 'utf8');

/** Steps of one job: name plus the raw text of the step block (holds `run:`). */
function jobSteps(workflow: string, job: string): Array<{ name: string; body: string }> {
  const lines = readRepo(`.github/workflows/${workflow}`).split(/\r?\n/);
  const start = lines.findIndex((l) => l === `  ${job}:`);
  if (start < 0) throw new Error(`job ${job} not found in ${workflow}`);
  let end = lines.findIndex((l, i) => i > start && /^ {2}[a-z0-9-]+:\s*$/.test(l));
  if (end < 0) end = lines.length;
  const steps: Array<{ name: string; body: string }> = [];
  for (let i = start; i < end; i++) {
    const m = /^ {6}- name: (.+)$/.exec(lines[i]!);
    if (!m) continue;
    let j = i + 1;
    while (j < end && !/^ {6}- name: /.test(lines[j]!)) j++;
    steps.push({ name: m[1]!.trim(), body: lines.slice(i, j).join('\n') });
  }
  return steps;
}

describe('check catalog', () => {
  test('every check name the verifier reports is in the catalog once', () => {
    const ids = CHECK_CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ['lint', 'typecheck', 'test', 'tamper', 'file-size', 'generated-sync']) {
      expect(ids).toContain(id as (typeof ids)[number]);
    }
    for (const id of ['import-graph', 'docs-drift', 'todos', 'secret', 'attribution']) {
      expect(CHECK_CATALOG.find((e) => e.id === id)?.selfVerify).toBe(true);
    }
    for (const e of CHECK_CATALOG) {
      expect(e.gateMessage.length).toBeGreaterThan(0);
      expect(e.fixHint.length).toBeGreaterThan(0);
    }
  });

  test('the HACK/FIXME ceilings equal the ones the todos workflow enforces', () => {
    const steps = jobSteps('todos-check.yml', 'todos');
    const run = steps.map((s) => s.body).join('\n');
    const hack = /--max-hack (\d+)/.exec(run)?.[1];
    const fixme = /--max-fixme (\d+)/.exec(run)?.[1];
    expect(Number(hack)).toBe(TODO_CEILINGS.hack);
    expect(Number(fixme)).toBe(TODO_CEILINGS.fixme);
  });

  test('every mapped job is a real gate and lists every check step of its job', () => {
    const gates = JSON.parse(readRepo('.github/quality-gates.json')) as {
      checks: Array<{ name: string; workflow: string; job: string }>;
    };
    for (const [name, mapping] of Object.entries(CI_JOB_STEPS)) {
      const gate = gates.checks.find((c) => c.name === name);
      expect(gate, `quality-gates.json has no check named ${name}`).toBeDefined();
      expect(gate!.workflow).toBe(mapping.workflow);
      expect(gate!.job).toBe(mapping.job);
      const real = jobSteps(mapping.workflow, mapping.job)
        .map((s) => s.name)
        .filter((n) => !NON_CHECK_STEP_RE.test(n));
      expect(mapping.steps.map((s) => s.step).sort()).toEqual([...real].sort());
    }
  });

  test('each mapped command is what the CI step actually runs', () => {
    const ids = new Set(CHECK_CATALOG.map((e) => e.id));
    for (const mapping of Object.values(CI_JOB_STEPS)) {
      const steps = jobSteps(mapping.workflow, mapping.job);
      for (const s of mapping.steps) {
        if (s.checkId) expect(ids.has(s.checkId)).toBe(true);
        if (!s.command) continue;
        const body = steps.find((x) => x.name === s.step)?.body ?? '';
        expect(body, `${mapping.job} / ${s.step}`).toContain(s.command);
      }
    }
  });
});

describe('coverage lookups', () => {
  test('a job whose steps are all self-verified is covered', () => {
    expect(ciCoverageOf('Enforce HACK/FIXME ceilings (ADR-0004)').status).toBe('covered');
  });

  test('a job with unmapped steps is partial and names them', () => {
    const lint = ciCoverageOf('Lint Code');
    expect(lint.status).toBe('partial');
    expect(lint.uncoveredSteps).toContain('Unused files');
    expect(ciCoverageOf('Check Rust Code').uncoveredSteps).toContain('Run Clippy');
  });

  test('a job outside the table is missing', () => {
    expect(ciCoverageOf('Knip (frontend)')).toEqual({ status: 'missing', uncoveredSteps: [] });
  });

  test('pre-save names resolve through the catalog', () => {
    expect(presaveCoverageOf('secret').status).toBe('covered');
    expect(presaveCoverageOf('tamper').status).toBe('covered');
    expect(presaveCoverageOf('verifier').status).toBe('missing');
  });
});
