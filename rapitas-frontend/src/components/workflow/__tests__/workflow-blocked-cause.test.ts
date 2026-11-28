/**
 * workflow-blocked-cause テスト
 * resolveBlockedCauseLabel の cause → i18n キー解決ロジックの検証。
 */
import { describe, it, expect, vi } from 'vitest';
import {
  blockedCauseFromTransitions,
  resolveBlockedCauseLabel,
  BLOCKED_CAUSE_I18N_KEYS,
} from '../workflow-blocked-cause';

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

  it('検査名つきの停止原因は検査名を含む表示にすること', () => {
    const t = (key: string, values?: Record<string, string>) => `${key}:${values?.cause}`;
    expect(resolveBlockedCauseLabel(t, 'verification_stopped:scope,runtime')).toBe(
      'statusIndicator.blockedCauseUnknown:verification_stopped: scope, runtime',
    );
    expect(resolveBlockedCauseLabel(t, 'verification_unverifiable_hold:runtime')).toBe(
      'statusIndicator.blockedCauseUnknown:verification_unverifiable_hold: runtime',
    );
  });

  it('コロンを含む他の原因コードは書き換えないこと', () => {
    const t = (key: string, values?: Record<string, string>) => `${key}:${values?.cause}`;
    expect(resolveBlockedCauseLabel(t, 'phase_completed:implementer')).toBe(
      'statusIndicator.blockedCauseUnknown:phase_completed:implementer',
    );
  });
});

describe('blockedCauseFromTransitions（古い順の遷移）', () => {
  const stopped = { cause: 'verification_stopped', metadata: { failedChecks: ['scope'] } };

  it('停止記録は検査名を付けて返すこと', () => {
    expect(blockedCauseFromTransitions([{ cause: 'file_saved:verify' }, stopped])).toBe(
      'verification_stopped:scope',
    );
    expect(
      blockedCauseFromTransitions([
        {
          cause: 'verification_unverifiable_hold',
          metadata: { unverifiableChecks: ['runtime'] },
        },
      ]),
    ).toBe('verification_unverifiable_hold:runtime');
  });

  it('後続行は飛ばして直前の停止記録を返すこと', () => {
    expect(
      blockedCauseFromTransitions([
        stopped,
        { cause: 'verification_gate_repeat_hold' },
        { cause: 'verification_gate_failed' },
        { cause: 'verify_pr_not_created' },
      ]),
    ).toBe('verification_stopped:scope');
  });

  it('別の行が挟まる、または停止記録が無い場合は最新の cause を返すこと', () => {
    expect(blockedCauseFromTransitions([stopped, { cause: 'verify_repair' }])).toBe(
      'verify_repair',
    );
    expect(blockedCauseFromTransitions([{ cause: 'verify_pr_not_created' }])).toBe(
      'verify_pr_not_created',
    );
  });

  it('空・cause なし・壊れた metadata でも落ちないこと', () => {
    expect(blockedCauseFromTransitions([])).toBeNull();
    expect(blockedCauseFromTransitions([{ cause: null }])).toBeNull();
    for (const metadata of [undefined, null, { raw: '{x' }, { failedChecks: 'a' }]) {
      expect(blockedCauseFromTransitions([{ cause: 'verification_stopped', metadata }])).toBe(
        'verification_stopped',
      );
    }
  });
});
