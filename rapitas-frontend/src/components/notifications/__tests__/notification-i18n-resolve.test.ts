/**
 * notification-i18n-resolve.test
 *
 * Guards the 2026-08-30 regression: the backend stores the FULL key path
 * (notification.types.x.title) while the translator is already scoped to the
 * `notification` namespace, which rendered raw keys in the header bell.
 */
import { describe, it, expect } from 'vitest';
import { resolveNotificationText } from '../notification-type-icons';

const CATALOG: Record<string, string> = {
  'types.auto_merge_success.title': '自動マージ成功',
  'types.auto_merge_success.message': 'PR #{pr} をマージしました',
};

/** Mimics next-intl: returns the (namespaced) key path when missing, never throws. */
const t = (key: string, params?: Record<string, string | number | Date>) => {
  const hit = CATALOG[key];
  if (!hit) return `notification.${key}`;
  return hit.replace(/\{(\w+)\}/g, (_, name) => String(params?.[name] ?? `{${name}}`));
};

const base = { title: '保存済みタイトル', message: '保存済みメッセージ' };

describe('resolveNotificationText', () => {
  it('backend の完全パスキーを名前空間相対に正規化して翻訳する', () => {
    const r = resolveNotificationText(t, {
      ...base,
      metadata: {
        i18n: { key: 'notification.types.auto_merge_success.title', params: { pr: 540 } },
      },
    });
    expect(r.title).toBe('自動マージ成功');
    expect(r.message).toBe('PR #540 をマージしました');
  });

  it('カタログに無いキーは生のキーを表示せず保存文字列に落ちる', () => {
    const r = resolveNotificationText(t, {
      ...base,
      metadata: { i18n: { key: 'notification.types.unknown_type.title' } },
    });
    expect(r).toEqual(base);
  });

  it('metadata.i18n の無いレガシー行は保存文字列のまま', () => {
    expect(resolveNotificationText(t, { ...base, metadata: null })).toEqual(base);
  });
});
