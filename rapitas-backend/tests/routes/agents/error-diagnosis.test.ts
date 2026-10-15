/**
 * GET/POST /agents/error-diagnosis 統合テスト
 *
 * 一覧+集計の形状、windowDaysによる期間境界、フィードバックPOSTの
 * 200/404を、実 store（RAPITAS_DATA_DIR=一時ディレクトリ）経由で検証する。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Elysia } from 'elysia';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const { errorDiagnosisRoutes } = await import('../../../routes/agents/config/error-diagnosis');
const { appendDiagnosis } = await import('../../../services/ai/error-diagnosis');
type DiagnosisRecord = import('../../../services/ai/error-diagnosis').DiagnosisRecord;

const DAY_MS = 24 * 60 * 60 * 1000;

function makeDiagnosis(overrides: Partial<DiagnosisRecord> = {}): DiagnosisRecord {
  return {
    id: 'diag-1',
    tsMs: Date.now(),
    taskId: 612,
    phase: 'manual',
    fromProvider: 'openai',
    fromModel: 'gpt-5',
    rootCause: 'connection reset by peer',
    confidence: 70,
    suggestedAction: 'retry',
    reasoning: 'transient network blip',
    llmLatencyMs: 5000,
    llmModel: 'claude-haiku-4-5-20251001',
    ...overrides,
  };
}

interface DiagnosisResponse {
  diagnoses: Array<{ id: string; rootCause: string; feedback: 'helpful' | 'not_helpful' | null }>;
  summary: { total: number; avgConfidence: number; feedbackRate: number; helpfulRate: number };
  windowDays: number;
  generatedAtMs: number;
}

describe('GET /agents/error-diagnosis', () => {
  let app: Elysia;
  let dir: string;
  const prevDataDir = process.env.RAPITAS_DATA_DIR;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'error-diagnosis-route-'));
    process.env.RAPITAS_DATA_DIR = dir;
    app = new Elysia().use(errorDiagnosisRoutes);
  });

  afterEach(() => {
    if (prevDataDir === undefined) delete process.env.RAPITAS_DATA_DIR;
    else process.env.RAPITAS_DATA_DIR = prevDataDir;
    rmSync(dir, { recursive: true, force: true });
  });

  it('記録0件なら diagnoses:[] と summary(0) を 200 で返す', async () => {
    const res = await app.handle(new Request('http://localhost/agents/error-diagnosis'));
    expect(res.status).toBe(200);

    const body = (await res.json()) as DiagnosisResponse;
    expect(body.diagnoses).toEqual([]);
    expect(body.summary).toEqual({ total: 0, avgConfidence: 0, feedbackRate: 0, helpfulRate: 0 });
    expect(body.windowDays).toBe(45);
    expect(typeof body.generatedAtMs).toBe('number');
  });

  it('一覧にフィードバック状態が結合され、集計に反映される', async () => {
    appendDiagnosis(makeDiagnosis({ id: 'a', confidence: 60 }));
    appendDiagnosis(makeDiagnosis({ id: 'b', confidence: 80 }));

    await app.handle(
      new Request('http://localhost/agents/error-diagnosis/a/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ helpful: true }),
      }),
    );

    const res = await app.handle(new Request('http://localhost/agents/error-diagnosis'));
    const body = (await res.json()) as DiagnosisResponse;

    expect(body.diagnoses).toHaveLength(2);
    const a = body.diagnoses.find((d) => d.id === 'a');
    const b = body.diagnoses.find((d) => d.id === 'b');
    expect(a?.feedback).toBe('helpful');
    expect(b?.feedback).toBeNull();
    expect(body.summary.total).toBe(2);
    expect(body.summary.avgConfidence).toBe(70);
    expect(body.summary.feedbackRate).toBeCloseTo(0.5);
    expect(body.summary.helpfulRate).toBe(1);
  });

  it('?windowDays= が期間境界として効く（窓外レコードは集計されない）', async () => {
    appendDiagnosis(makeDiagnosis({ id: 'old', tsMs: Date.now() - 3 * DAY_MS }));

    const inWindow = (await (
      await app.handle(new Request('http://localhost/agents/error-diagnosis?windowDays=7'))
    ).json()) as DiagnosisResponse;
    expect(inWindow.windowDays).toBe(7);
    expect(inWindow.diagnoses).toHaveLength(1);

    const outOfWindow = (await (
      await app.handle(new Request('http://localhost/agents/error-diagnosis?windowDays=1'))
    ).json()) as DiagnosisResponse;
    expect(outOfWindow.windowDays).toBe(1);
    expect(outOfWindow.diagnoses).toEqual([]);
  });

  it('POST .../feedback は既存の診断IDに対して200を返す', async () => {
    appendDiagnosis(makeDiagnosis({ id: 'exists' }));

    const res = await app.handle(
      new Request('http://localhost/agents/error-diagnosis/exists/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ helpful: false, note: 'not useful' }),
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('POST .../feedback は存在しない診断IDに対して404を返す', async () => {
    const res = await app.handle(
      new Request('http://localhost/agents/error-diagnosis/does-not-exist/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ helpful: true }),
      }),
    );

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('diagnosis_not_found');
  });
});
