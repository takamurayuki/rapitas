/**
 * i18n-integrity-check ユニットテスト
 *
 * isSafeToRestoreFromHead(純粋関数)と checkAndHealMessagesFile(deps注入)を検証する。
 */
import { describe, test, expect, mock } from 'bun:test';
import {
  isSafeToRestoreFromHead,
  checkAndHealMessagesFile,
  checkAndHealAllMessagesFiles,
  GUARDED_MESSAGE_FILES,
} from './i18n-integrity-check';

describe('isSafeToRestoreFromHead', () => {
  test('同一内容なら安全ではない(復元不要)と判定しない — falseを返す', () => {
    const content = '{"a":"1"}';
    expect(isSafeToRestoreFromHead(content, content)).toBe(false);
  });

  test('作業ツリーがHEADの値保存サブセット(キー欠落のみ) → true', () => {
    const head = JSON.stringify({ a: '1', b: '2', c: { d: '3' } });
    const working = JSON.stringify({ a: '1' });
    expect(isSafeToRestoreFromHead(head, working)).toBe(true);
  });

  test('作業ツリーに値が異なる同名キーがある(真の編集) → false', () => {
    const head = JSON.stringify({ a: '1', b: '2' });
    const working = JSON.stringify({ a: '1', b: 'changed' });
    expect(isSafeToRestoreFromHead(head, working)).toBe(false);
  });

  test('作業ツリーにHEADに無い新規キーがある(真の追加作業) → false', () => {
    const head = JSON.stringify({ a: '1' });
    const working = JSON.stringify({ a: '1', newKey: 'work in progress' });
    expect(isSafeToRestoreFromHead(head, working)).toBe(false);
  });

  test('作業ツリーがHEADと同じかそれ以上のキー数 → false(欠落なし)', () => {
    const head = JSON.stringify({ a: '1', b: '2' });
    const working = JSON.stringify({ a: '1', b: '2' });
    expect(isSafeToRestoreFromHead(head, working)).toBe(false);
  });

  test('配列の再フォーマット(改行のみの差)は値の相違として扱わない', () => {
    const head = JSON.stringify({ days: ['日', '月', '火'], extra: 'x' });
    // 配列は同じ内容だが欠落キーもある — パース後の値比較なので改行差は無関係
    const working = JSON.stringify({ days: ['日', '月', '火'] });
    expect(isSafeToRestoreFromHead(head, working)).toBe(true);
  });

  test('壊れたJSON(パース不能)は復元不要 → false', () => {
    expect(isSafeToRestoreFromHead('{"a":1}', '{invalid')).toBe(false);
    expect(isSafeToRestoreFromHead('{invalid', '{"a":1}')).toBe(false);
  });
});

describe('checkAndHealMessagesFile', () => {
  test('HEADと作業ツリーが同一内容なら ok を返し、書き込みしない', async () => {
    const content = '{"a":"1"}';
    const writeWorkingContent = mock(() => Promise.resolve());
    const result = await checkAndHealMessagesFile('C:/repo', 'messages/ja.json', {
      readHeadContent: () => Promise.resolve(content),
      readWorkingContent: () => Promise.resolve(content),
      writeWorkingContent,
    });
    expect(result).toBe('ok');
    expect(writeWorkingContent).not.toHaveBeenCalled();
  });

  test('安全なサブセット差分は healed を返し、HEADの内容で書き込む', async () => {
    const head = '{"a":"1","b":"2"}';
    const working = '{"a":"1"}';
    const writeWorkingContent = mock(() => Promise.resolve());
    const result = await checkAndHealMessagesFile('C:/repo', 'messages/ja.json', {
      readHeadContent: () => Promise.resolve(head),
      readWorkingContent: () => Promise.resolve(working),
      writeWorkingContent,
    });
    expect(result).toBe('healed');
    expect(writeWorkingContent).toHaveBeenCalledWith('C:/repo', 'messages/ja.json', head);
  });

  test('安全でない差分(真の編集/追加)は drifted_unsafe を返し、書き込みしない', async () => {
    const head = '{"a":"1","b":"2"}';
    const working = '{"a":"1","b":"2","c":"new work"}';
    const writeWorkingContent = mock(() => Promise.resolve());
    const result = await checkAndHealMessagesFile('C:/repo', 'messages/ja.json', {
      readHeadContent: () => Promise.resolve(head),
      readWorkingContent: () => Promise.resolve(working),
      writeWorkingContent,
    });
    expect(result).toBe('drifted_unsafe');
    expect(writeWorkingContent).not.toHaveBeenCalled();
  });

  test('HEAD取得に失敗したら error を返し、書き込みしない', async () => {
    const writeWorkingContent = mock(() => Promise.resolve());
    const result = await checkAndHealMessagesFile('C:/repo', 'messages/ja.json', {
      readHeadContent: () => Promise.reject(new Error('git show failed')),
      writeWorkingContent,
    });
    expect(result).toBe('error');
    expect(writeWorkingContent).not.toHaveBeenCalled();
  });

  test('作業ツリー読み込みに失敗したら error を返し、書き込みしない', async () => {
    const writeWorkingContent = mock(() => Promise.resolve());
    const result = await checkAndHealMessagesFile('C:/repo', 'messages/ja.json', {
      readHeadContent: () => Promise.resolve('{"a":"1"}'),
      readWorkingContent: () => Promise.reject(new Error('ENOENT')),
      writeWorkingContent,
    });
    expect(result).toBe('error');
    expect(writeWorkingContent).not.toHaveBeenCalled();
  });
});

describe('checkAndHealAllMessagesFiles', () => {
  test('GUARDED_MESSAGE_FILES の全ファイルについて結果を返す', async () => {
    const results = await checkAndHealAllMessagesFiles('C:/repo', {
      readHeadContent: () => Promise.resolve('{"a":"1"}'),
      readWorkingContent: () => Promise.resolve('{"a":"1"}'),
    });
    expect(Object.keys(results).sort()).toEqual([...GUARDED_MESSAGE_FILES].sort());
    for (const outcome of Object.values(results)) {
      expect(outcome).toBe('ok');
    }
  });
});
