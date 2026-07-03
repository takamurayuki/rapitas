/**
 * workflow-blocked-cause テスト
 * resolveBlockedCauseLabel の cause → i18n キー解決ロジックの検証。
 */
import { describe, it, expect, vi } from 'vitest';
import { resolveBlockedCauseLabel, BLOCKED_CAUSE_I18N_KEYS } from '../workflow-blocked-cause';

describe('resolveBlockedCauseLabel', () => {
  it('cause が null/undefined の場合は undefined を返す（呼び出し側で汎用ヒントにフォールバック）', () => {
    const t = vi.fn((key: string) => key);
    expect(resolveBlockedCauseLabel(t, null)).toBeUndefined();
    expect(resolveBlockedCauseLabel(t, undefined)).toBeUndefined();
    expect(t).not.toHaveBeenCalled();
  });

  it('既知のcauseコードをblockedCauses配下のi18nキーへ解決すること', () => {
    const t = vi.fn((key: string) => `translated:${key}`);
    const result = resolveBlockedCauseLabel(t, 'verify_pr_not_created');
    expect(t).toHaveBeenCalledWith('statusIndicator.blockedCauses.verifyPrNotCreated');
    expect(result).toBe('translated:statusIndicator.blockedCauses.verifyPrNotCreated');
  });

  it('全ての既知コードがBLOCKED_CAUSE_I18N_KEYSに存在すること', () => {
    const t = vi.fn((key: string) => key);
    for (const cause of Object.keys(BLOCKED_CAUSE_I18N_KEYS)) {
      const result = resolveBlockedCauseLabel(t, cause);
      expect(result).toBe(`statusIndicator.blockedCauses.${BLOCKED_CAUSE_I18N_KEYS[cause]}`);
    }
  });

  it('未知のcauseコードはblockedCauseUnknownへフォールバックし、causeを渡すこと', () => {
    const t = vi.fn((key: string, values?: Record<string, string>) => `${key}:${values?.cause}`);
    const result = resolveBlockedCauseLabel(t, 'some_unrecognized_code');
    expect(t).toHaveBeenCalledWith('statusIndicator.blockedCauseUnknown', {
      cause: 'some_unrecognized_code',
    });
    expect(result).toBe('statusIndicator.blockedCauseUnknown:some_unrecognized_code');
  });
});
