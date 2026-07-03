/**
 * StatusConfig.test.tsx
 *
 * ステータス設定解決（todoフォールバック含む）、in-progress判定、
 * ラベル翻訳、アイコン描画の分岐を検証する。
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import {
  statusConfig,
  isInProgressStatus,
  resolveStatusConfig,
  getStatusDisplay,
  renderStatusIcon,
} from '../StatusConfig';

describe('isInProgressStatus', () => {
  it('in-progressをtrueと判定すること', () => {
    expect(isInProgressStatus('in-progress')).toBe(true);
  });

  it('blockedもin-progress扱いすること（UX仕様）', () => {
    expect(isInProgressStatus('blocked')).toBe(true);
  });

  it('todo/doneはfalseを返すこと', () => {
    expect(isInProgressStatus('todo')).toBe(false);
    expect(isInProgressStatus('done')).toBe(false);
  });

  it('null/undefinedはfalseを返すこと', () => {
    expect(isInProgressStatus(null)).toBe(false);
    expect(isInProgressStatus(undefined)).toBe(false);
  });
});

describe('resolveStatusConfig', () => {
  it('既知のstatusはそのまま返すこと', () => {
    expect(resolveStatusConfig('done')).toBe(statusConfig.done);
    expect(resolveStatusConfig('in-progress')).toBe(statusConfig['in-progress']);
  });

  it('blockedはin-progressと同じ見た目（statusInProgressラベル）を持つこと', () => {
    expect(resolveStatusConfig('blocked').labelKey).toBe('statusInProgress');
  });

  it('未知のstatusはtodoにフォールバックすること', () => {
    expect(resolveStatusConfig('unknown-status')).toBe(statusConfig.todo);
  });

  it('null/undefinedはtodoにフォールバックすること', () => {
    expect(resolveStatusConfig(null)).toBe(statusConfig.todo);
    expect(resolveStatusConfig(undefined)).toBe(statusConfig.todo);
  });
});

describe('getStatusDisplay', () => {
  const t = (key: string) => `translated:${key}`;

  it('labelKeyを翻訳した文字列をlabelとして含むこと', () => {
    const display = getStatusDisplay(t, 'done');
    expect(display.label).toBe('translated:statusDone');
    expect(display.color).toBe(statusConfig.done.color);
  });

  it('未知のstatusでもtodo設定+翻訳ラベルを返すこと', () => {
    const display = getStatusDisplay(t, 'nonexistent');
    expect(display.label).toBe('translated:statusTodo');
  });
});

describe('renderStatusIcon', () => {
  it('todoは塗りつぶし無しの矩形のみを描画すること', () => {
    const { container } = render(<>{renderStatusIcon('todo')}</>);
    const rects = container.querySelectorAll('rect');
    expect(rects).toHaveLength(1);
    expect(rects[0].getAttribute('fill')).toBe('none');
  });

  it('in-progressは枠+塗りつぶし矩形の2要素を描画すること', () => {
    const { container } = render(<>{renderStatusIcon('in-progress')}</>);
    const rects = container.querySelectorAll('rect');
    expect(rects).toHaveLength(2);
    expect(rects[1].getAttribute('fill')).toBe('currentColor');
  });

  it('blockedはin-progressと同じ描画になること', () => {
    const { container } = render(<>{renderStatusIcon('blocked')}</>);
    expect(container.querySelectorAll('rect')).toHaveLength(2);
  });

  it('doneはチェックマークのpathを描画すること', () => {
    const { container } = render(<>{renderStatusIcon('done')}</>);
    const path = container.querySelector('path');
    expect(path).not.toBeNull();
    expect(path?.getAttribute('d')).toContain('M5 13l4 4L19 7');
  });

  it('未知のstatusはtodoと同じフォールバック描画になること', () => {
    const { container } = render(<>{renderStatusIcon('unknown')}</>);
    const rects = container.querySelectorAll('rect');
    expect(rects).toHaveLength(1);
    expect(container.querySelector('path')).toBeNull();
  });
});
