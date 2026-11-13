'use client';
/**
 * useClearBrowsingData
 *
 * "Clear browsing data" for the in-app browser (Q11): confirm, then clear the
 * link views' own cookies / storage / cache — signing the user out of the
 * sites opened there. The app's sign-in, the tab list and the favourites are
 * untouched. Desktop only; on the web the cookies belong to the user's
 * browser and only a hint is offered.
 */
import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useConfirmDialog } from '@/components/ui/dialog/ConfirmDialogProvider';
import { useToast } from '@/components/ui/toast/ToastContainer';
import { clearLinkViewData } from '@/utils/link-view';
import { useLinkViewStatusStore } from '@/stores/link-view-status-store';

/**
 * @returns A function that asks, clears, and reports / 確認して消去する関数
 */
export function useClearBrowsingData(): () => Promise<void> {
  const t = useTranslations('browser');
  const confirm = useConfirmDialog();
  const { showToast } = useToast();

  return useCallback(async () => {
    const ok = await confirm({
      title: t('clearDataConfirmTitle'),
      message: t('clearDataConfirmBody'),
      confirmLabel: t('clearData'),
      variant: 'destructive',
    });
    if (!ok) return;
    const cleared = await clearLinkViewData();
    if (cleared) {
      // The command closed every link view; rebuild them from the tab URLs.
      useLinkViewStatusStore.getState().bumpWebviewEpoch();
      showToast(t('clearDataDone'), 'success');
    } else {
      showToast(t('clearDataFailed'), 'error');
    }
  }, [confirm, showToast, t]);
}
