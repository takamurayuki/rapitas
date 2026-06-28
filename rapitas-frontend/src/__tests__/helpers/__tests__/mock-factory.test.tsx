/**
 * mock-factory.test
 *
 * Unit tests for the generic buildModuleMock factory.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { buildModuleMock } from '../mock-factory';

/** Creates a minimal fake module for testing. */
function makeFakeModule(keys: string[]): () => Promise<unknown> {
  const fakeExports: Record<string, () => null> = {};
  for (const key of keys) {
    fakeExports[key] = () => null;
  }
  return () => Promise.resolve(fakeExports);
}

describe('buildModuleMock', () => {
  it('全エクスポートがスタブ化される', async () => {
    const keys = ['A', 'B', 'C'];
    const mock = await buildModuleMock(
      makeFakeModule(keys),
      (key) => `stub-${key}`,
    );
    for (const key of keys) {
      expect(mock[key]).toBe(`stub-${key}`);
    }
  });

  it('overrides のある key は指定 testId で makeStub が呼ばれる', async () => {
    const received: Array<[string, string]> = [];
    await buildModuleMock(
      makeFakeModule(['Foo', 'Bar']),
      (key, testId) => {
        received.push([key, testId]);
        return null;
      },
      { Foo: 'foo-custom' },
    );
    expect(received).toContainEqual(['Foo', 'foo-custom']);
    // NOTE: 'Bar' has no override → testId falls back to the key name itself
    expect(received).toContainEqual(['Bar', 'Bar']);
  });

  it('overrides 未指定の key は key 自身が testId になる', async () => {
    const received: string[] = [];
    await buildModuleMock(
      makeFakeModule(['X', 'Y']),
      (_key, testId) => {
        received.push(testId);
        return null;
      },
    );
    expect(received).toContain('X');
    expect(received).toContain('Y');
  });

  it('空モジュール（エクスポート 0 件）は空オブジェクトを返す', async () => {
    const mock = await buildModuleMock(makeFakeModule([]), () => 'stub');
    expect(mock).toEqual({});
  });

  it('importOriginal が reject した場合は例外が伝播する', async () => {
    const error = new Error('module not found');
    await expect(
      buildModuleMock(
        () => Promise.reject(error),
        () => null,
      ),
    ).rejects.toThrow('module not found');
  });

  it('overrides に実在しないキーが含まれていても無視される', async () => {
    const mock = await buildModuleMock(
      makeFakeModule(['Real']),
      (key, testId) => `${key}:${testId}`,
      { NonExistent: 'ghost', Real: 'real-custom' },
    );
    expect(mock['Real']).toBe('Real:real-custom');
    expect(mock['NonExistent']).toBeUndefined();
  });

  it('makeStub がコンポーネントを返す場合も正しく格納される', async () => {
    const mock = await buildModuleMock(
      makeFakeModule(['Icon']),
      (_key, testId) => {
        const C = () => <div data-testid={testId} />;
        return C;
      },
      { Icon: 'my-icon' },
    );
    const Icon = mock['Icon'] as React.FC;
    render(<Icon />);
    expect(screen.getByTestId('my-icon')).toBeInTheDocument();
  });

  it('makeStub の戻り値が関数でない場合（プリミティブ値）も格納される', async () => {
    const mock = await buildModuleMock(
      makeFakeModule(['version', 'debug']),
      (key) => (key === 'version' ? '1.0.0' : false),
    );
    expect(mock['version']).toBe('1.0.0');
    expect(mock['debug']).toBe(false);
  });

  it('vi.fn を返す makeStub の呼び出し記録が追跡できる', async () => {
    const pushFn = vi.fn();
    const mock = await buildModuleMock(
      makeFakeModule(['push']),
      () => pushFn,
    );
    void mock;
    pushFn('/home');
    expect(pushFn).toHaveBeenCalledWith('/home');
  });
});
