/**
 * error-diagnosis-store テスト
 *
 * JSONL ストア（diagnoses/feedback）の round-trip / ディレクトリ自動生成 /
 * sinceMs フィルタ / 破損行スキップを検証する。RAPITAS_DATA_DIR を
 * 一時ディレクトリへ向ける。
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { appendFileSync, existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  appendDiagnosis,
  readDiagnoses,
  appendFeedback,
  readFeedback,
  diagnosesFilePath,
  feedbackFilePath,
} from './error-diagnosis-store';
import type { DiagnosisFeedbackRecord, DiagnosisRecord } from './error-diagnosis.types';

function makeDiagnosis(overrides: Partial<DiagnosisRecord> = {}): DiagnosisRecord {
  return {
    id: 'diag-1',
    tsMs: 1_000_000,
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

function makeFeedback(overrides: Partial<DiagnosisFeedbackRecord> = {}): DiagnosisFeedbackRecord {
  return {
    id: 'fb-1',
    diagnosisId: 'diag-1',
    tsMs: 1_000_000,
    helpful: true,
    note: null,
    ...overrides,
  };
}

describe('error-diagnosis-store', () => {
  let dir: string;
  const prevDataDir = process.env.RAPITAS_DATA_DIR;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'error-diagnosis-'));
    process.env.RAPITAS_DATA_DIR = dir;
  });

  afterEach(() => {
    if (prevDataDir === undefined) delete process.env.RAPITAS_DATA_DIR;
    else process.env.RAPITAS_DATA_DIR = prevDataDir;
    rmSync(dir, { recursive: true, force: true });
  });

  test('診断: append → read の round-trip で全フィールドが保存される', () => {
    const record = makeDiagnosis();
    appendDiagnosis(record);

    const records = readDiagnoses();
    expect(records).toHaveLength(1);
    expect(records[0]).toEqual(record);
  });

  test('診断: 未作成の error-diagnosis ディレクトリを自動生成して書き込む', () => {
    expect(existsSync(join(dir, 'error-diagnosis'))).toBe(false);
    appendDiagnosis(makeDiagnosis());
    expect(existsSync(diagnosesFilePath())).toBe(true);
  });

  test('診断: sinceMs フィルタは tsMs >= sinceMs のレコードのみ返す（境界を含む）', () => {
    appendDiagnosis(makeDiagnosis({ id: 'a', tsMs: 999 }));
    appendDiagnosis(makeDiagnosis({ id: 'b', tsMs: 1000 }));
    appendDiagnosis(makeDiagnosis({ id: 'c', tsMs: 1001 }));

    const records = readDiagnoses(1000);
    expect(records.map((r) => r.tsMs)).toEqual([1000, 1001]);
  });

  test('診断: 破損行・不正な形状の行はスキップし残りを返す（throw しない）', () => {
    appendDiagnosis(makeDiagnosis({ id: 'a', tsMs: 1 }));
    appendFileSync(diagnosesFilePath(), 'this is not json\n');
    appendFileSync(diagnosesFilePath(), `${JSON.stringify({ foo: 'bar' })}\n`);
    appendDiagnosis(makeDiagnosis({ id: 'b', tsMs: 2 }));

    const records = readDiagnoses();
    expect(records.map((r) => r.tsMs)).toEqual([1, 2]);
  });

  test('診断: ファイル未作成なら空配列を返す', () => {
    expect(readDiagnoses()).toEqual([]);
  });

  test('フィードバック: append → read の round-trip で全フィールドが保存される', () => {
    const record = makeFeedback();
    appendFeedback(record);

    const records = readFeedback();
    expect(records).toHaveLength(1);
    expect(records[0]).toEqual(record);
  });

  test('フィードバック: 未作成の error-diagnosis ディレクトリを自動生成して書き込む', () => {
    expect(existsSync(join(dir, 'error-diagnosis'))).toBe(false);
    appendFeedback(makeFeedback());
    expect(existsSync(feedbackFilePath())).toBe(true);
  });

  test('フィードバック: 破損行はスキップし残りを返す（throw しない）', () => {
    appendFeedback(makeFeedback({ id: 'a' }));
    appendFileSync(feedbackFilePath(), 'this is not json\n');
    appendFeedback(makeFeedback({ id: 'b' }));

    const records = readFeedback();
    expect(records.map((r) => r.id)).toEqual(['a', 'b']);
  });

  test('フィードバック: ファイル未作成なら空配列を返す', () => {
    expect(readFeedback()).toEqual([]);
  });
});
