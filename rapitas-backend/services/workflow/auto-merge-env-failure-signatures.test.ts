/**
 * auto-merge-env-failure-signatures テスト
 *
 * 既知の環境要因（apt-get タイムアウト）のログだけが印に当たり、
 * テスト失敗・型エラー・lint のログは当たらないことを固定する。
 */
import { describe, test, expect } from 'bun:test';
import {
  ENV_FAILURE_SIGNATURES,
  matchEnvFailureSignature,
  type EnvFailureSignature,
} from './auto-merge-env-failure-signatures';

const STEP = 'Install system dependencies';
const line = (step: string, text: string) =>
  `Build (ubuntu-latest)\t${step}\t2026-11-24T10:00:00.0000000Z ${text}`;

const APT_TIMEOUT_LOG = [
  line(STEP, 'Reading package lists...'),
  line(STEP, 'E: Failed to fetch http://archive.ubuntu.com/ubuntu/pool/main/x.deb'),
  line(STEP, 'apt-get install failed after 2 attempts.'),
  line(STEP, '##[error]Process completed with exit code 124.'),
].join('\n');

describe('matchEnvFailureSignature — 当たるログ', () => {
  test('apt-get タイムアウト（工程名 + failed after + exit code 124）は当たる', () => {
    const hit = matchEnvFailureSignature(APT_TIMEOUT_LOG);
    expect(hit?.id).toBe('apt-install-timeout');
  });
});

describe('matchEnvFailureSignature — 実工程名の接尾辞', () => {
  const ubuntu = 'Install system dependencies (Ubuntu)';
  const log = (step: string) =>
    [
      line(step, 'apt-get install failed after 2 attempts.'),
      line(step, '##[error]Process completed with exit code 124.'),
    ].join('\n');

  test('括弧つき接尾辞の実工程（tauri-build.yml）も当たる', () => {
    expect(matchEnvFailureSignature(log(ubuntu))?.id).toBe('apt-install-timeout');
  });

  test('括弧の前に空白が無くても、同名の後ろが括弧なら当たる', () => {
    expect(matchEnvFailureSignature(log('Install system dependencies(Ubuntu)'))).not.toBeNull();
  });

  test('類似名の別工程（括弧でない後置き・前置き）は当たらない', () => {
    expect(matchEnvFailureSignature(log('Install system dependencies later'))).toBeNull();
    expect(matchEnvFailureSignature(log('Do not Install system dependencies'))).toBeNull();
    expect(matchEnvFailureSignature(log('Install system dependencies (Ubuntu) extra'))).toBeNull();
  });
});

describe('matchEnvFailureSignature — 当たらないログ', () => {
  test('テスト失敗のログは当たらない', () => {
    const log = [
      line('Run tests', '(fail) services > foo > bar'),
      line('Run tests', '3 fail'),
      line('Run tests', '##[error]Process completed with exit code 1.'),
    ].join('\n');
    expect(matchEnvFailureSignature(log)).toBeNull();
  });

  test('型エラーのログは当たらない', () => {
    const log = [
      line('Type check', "error TS2322: Type 'string' is not assignable to type 'number'."),
      line('Type check', '##[error]Process completed with exit code 2.'),
    ].join('\n');
    expect(matchEnvFailureSignature(log)).toBeNull();
  });

  test('lint のログは当たらない', () => {
    const log = [
      line('Lint', '/src/a.ts  12:3  error  no-unused-vars'),
      line('Lint', '##[error]Process completed with exit code 1.'),
    ].join('\n');
    expect(matchEnvFailureSignature(log)).toBeNull();
  });

  test('工程名が違う場合は当たらない', () => {
    const log = [
      line('Run tests', 'apt-get install failed after 2 attempts.'),
      line('Run tests', '##[error]Process completed with exit code 124.'),
    ].join('\n');
    expect(matchEnvFailureSignature(log)).toBeNull();
  });

  test('exit code が 124 以外なら当たらない', () => {
    const log = [
      line(STEP, 'apt-get install failed after 2 attempts.'),
      line(STEP, '##[error]Process completed with exit code 100.'),
    ].join('\n');
    expect(matchEnvFailureSignature(log)).toBeNull();
  });

  test('exit code 1240 のような部分一致では当たらない', () => {
    const log = [
      line(STEP, 'apt-get install failed after 2 attempts.'),
      line(STEP, '##[error]Process completed with exit code 1240.'),
    ].join('\n');
    expect(matchEnvFailureSignature(log)).toBeNull();
  });

  test('failed after が無い apt の失敗は当たらない', () => {
    const log = [
      line(STEP, 'E: Unable to locate package foo'),
      line(STEP, '##[error]Process completed with exit code 124.'),
    ].join('\n');
    expect(matchEnvFailureSignature(log)).toBeNull();
  });

  test('空ログ・空白のみは当たらない', () => {
    expect(matchEnvFailureSignature('')).toBeNull();
    expect(matchEnvFailureSignature('  \n \n')).toBeNull();
  });
});

describe('ENV_FAILURE_SIGNATURES — 拡張性', () => {
  test('一覧に別の印を渡すとその印で当たる', () => {
    const extra: EnvFailureSignature = {
      id: 'dummy',
      matches: (log) => log.includes('ECONNRESET'),
    };
    expect(matchEnvFailureSignature('npm ERR! ECONNRESET', [extra])?.id).toBe('dummy');
    expect(matchEnvFailureSignature('npm ERR! ECONNRESET')).toBeNull();
  });

  test('既定の一覧は apt の印を含む', () => {
    expect(ENV_FAILURE_SIGNATURES.map((s) => s.id)).toContain('apt-install-timeout');
  });
});
