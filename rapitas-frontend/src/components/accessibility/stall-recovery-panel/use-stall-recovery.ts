/**
 * use-stall-recovery
 *
 * State machine for the accessible stall-recovery panel: open-event
 * subscription, on-demand stall fetch, staged approval flow
 * (list → actions → confirm → result) and narration (TTS + aria-live text).
 * The recover API is called ONLY from executePending — i.e. only after the
 * user's explicit Space/button confirmation.
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useStallCheck } from '@/hooks/accessibility';
import { useVoiceNarrationStore } from '@/stores/voice-narration-store';
import { isAvailable, speak, stop as stopSpeaking } from '@/lib/accessibility/speech-narrator';
import {
  OPEN_STALL_RECOVERY_EVENT,
  type RecoverResult,
  type StalledTaskReport,
  type StallRecoveryAction,
  type StallRecoveryStep,
} from './stall-recovery.types';

/** Max stalled tasks narrated individually (the rest become "ほかN件"). */
const MAX_NARRATED_TASKS = 5;

export interface UseStallRecoveryReturn {
  isOpen: boolean;
  isLoading: boolean;
  loadFailed: boolean;
  reports: StalledTaskReport[];
  step: StallRecoveryStep;
  selectedTask: StalledTaskReport | null;
  pendingAction: StallRecoveryAction | null;
  result: RecoverResult | null;
  isExecuting: boolean;
  /** Text mirrored into the aria-live region (always set, voice or not). */
  liveMessage: string;
  /** False when TTS could not be used (voices absent or narration disabled). */
  voiceActive: boolean;
  selectTask: (report: StalledTaskReport) => void;
  selectAction: (action: StallRecoveryAction) => void;
  executePending: () => Promise<void>;
  goBack: () => void;
  closePanel: () => void;
}

/**
 * Drives the stall-recovery panel. Subscribes to the Ctrl+Alt+S open event,
 * fetches the on-demand stall scan, and walks the staged approval flow.
 *
 * @returns Panel state + step transition handlers. / パネル状態と遷移ハンドラ
 */
export function useStallRecovery(): UseStallRecoveryReturn {
  const t = useTranslations('stallRecovery');
  const { check, recover } = useStallCheck();
  const voiceEnabled = useVoiceNarrationStore((s) => s.enabled);
  const voiceRate = useVoiceNarrationStore((s) => s.rate);
  const verbosity = useVoiceNarrationStore((s) => s.verbosity);

  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reports, setReports] = useState<StalledTaskReport[]>([]);
  const [step, setStep] = useState<StallRecoveryStep>('list');
  const [selectedTask, setSelectedTask] = useState<StalledTaskReport | null>(null);
  const [pendingAction, setPendingAction] = useState<StallRecoveryAction | null>(null);
  const [result, setResult] = useState<RecoverResult | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [liveMessage, setLiveMessage] = useState('');
  const [voiceActive, setVoiceActive] = useState(false);

  const narrate = useCallback(
    (text: string) => {
      // aria-live is the guaranteed channel; TTS is best-effort on top.
      setLiveMessage(text);
      if (voiceEnabled) speak(text, { rate: voiceRate });
    },
    [voiceEnabled, voiceRate],
  );

  const openPanel = useCallback(async () => {
    setIsOpen(true);
    setStep('list');
    setSelectedTask(null);
    setPendingAction(null);
    setResult(null);
    setLoadFailed(false);
    setIsLoading(true);
    setVoiceActive(voiceEnabled && isAvailable());
    setLiveMessage(t('checking'));

    const response = await check(verbosity);
    setIsLoading(false);
    if (!response) {
      setLoadFailed(true);
      setReports([]);
      narrate(t('checkFailed'));
      return;
    }
    setReports(response.tasks);
    if (response.tasks.length === 0) {
      narrate(t('noStalledTasks'));
      return;
    }
    const parts = [t('stalledCount', { count: response.tasks.length })];
    for (const task of response.tasks.slice(0, MAX_NARRATED_TASKS)) {
      parts.push(task.narration);
    }
    if (response.tasks.length > MAX_NARRATED_TASKS) {
      parts.push(t('andMore', { count: response.tasks.length - MAX_NARRATED_TASKS }));
    }
    narrate(parts.join(' '));
  }, [check, narrate, t, verbosity, voiceEnabled]);

  const selectTask = useCallback(
    (report: StalledTaskReport) => {
      setSelectedTask(report);
      setStep('actions');
      narrate(`${report.narration} ${t('actionsLabel')}`);
    },
    [narrate, t],
  );

  const selectAction = useCallback(
    (action: StallRecoveryAction) => {
      setPendingAction(action);
      setStep('confirm');
      narrate(`${t('confirmSelected', { action: t(`actions.${action}`) })} ${t('confirmPrompt')}`);
    },
    [narrate, t],
  );

  const executePending = useCallback(async () => {
    // Approval gate: only a confirm-step Space/click may reach the API.
    if (step !== 'confirm' || !selectedTask || !pendingAction || isExecuting) return;
    setIsExecuting(true);
    setLiveMessage(t('executing'));
    const response = await recover(selectedTask.taskId, pendingAction);
    setIsExecuting(false);
    const outcome: RecoverResult = response ?? {
      success: false,
      action: pendingAction,
      message: t('recoverFailed'),
    };
    setResult(outcome);
    setStep('result');
    narrate(outcome.message);
  }, [isExecuting, narrate, pendingAction, recover, selectedTask, step, t]);

  const closePanel = useCallback(() => {
    setIsOpen(false);
    stopSpeaking();
  }, []);

  const goBack = useCallback(() => {
    if (step === 'confirm') {
      setPendingAction(null);
      setStep('actions');
      return;
    }
    if (step === 'actions' || step === 'result') {
      setSelectedTask(null);
      setPendingAction(null);
      setResult(null);
      setStep('list');
      return;
    }
    closePanel();
  }, [closePanel, step]);

  useEffect(() => {
    const handleOpen = () => {
      void openPanel();
    };
    window.addEventListener(OPEN_STALL_RECOVERY_EVENT, handleOpen);
    return () => window.removeEventListener(OPEN_STALL_RECOVERY_EVENT, handleOpen);
  }, [openPanel]);

  return {
    isOpen,
    isLoading,
    loadFailed,
    reports,
    step,
    selectedTask,
    pendingAction,
    result,
    isExecuting,
    liveMessage,
    voiceActive,
    selectTask,
    selectAction,
    executePending,
    goBack,
    closePanel,
  };
}
