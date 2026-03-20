/**
 * use-wizard
 *
 * Central state and action hook for the CLAUDE.md generator wizard.
 * Encapsulates all phases, async API calls, and local state so that
 * phase components remain purely presentational.
 */

'use client';

import { useState, useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import type { AppAnswers, AppProposal, DynamicItem, GenerateResult } from './types';
import { proposeApps, generateClaudeMd, fetchSuggestions } from './api';
import { ELEMENTS, SUB_GENRES } from './constants';

export type WizardPhase =
  | 'intro'
  | 'genre'
  | 'sub'
  | 'elements'
  | 'platform'
  | 'proposing'
  | 'proposals'
  | 'generating'
  | 'result';

export type SetupPhase = 'idle' | 'loading' | 'success' | 'error';

/**
 * Manages all wizard state and exposes typed actions to phase components.
 *
 * @returns wizard state and action handlers / ウィザードの状態とアクションハンドラ
 */
export function useWizard() {
  const t = useTranslations('claudeMd');

  const [phase, setPhase] = useState<WizardPhase>('intro');
  const [answers, setAnswers] = useState<AppAnswers>({
    genre: '',
    platform: '',
    scale: '',
    priority: '',
  });
  const [proposals, setProposals] = useState<AppProposal[]>([]);
  const [aiErrorMessage, setAiErrorMessage] = useState('');
  const [pickedProp, setPickedProp] = useState<AppProposal | null>(null);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [setupPhase, setSetupPhase] = useState<SetupPhase>('idle');
  const [createdThemePath, setCreatedThemePath] = useState<string | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const topRef = useRef<HTMLDivElement>(null);

  const [dynamicSubs, setDynamicSubs] = useState<DynamicItem[]>([]);
  const [dynamicElements, setDynamicElements] = useState<DynamicItem[]>([]);
  const [subsLoading, setSubsLoading] = useState(false);
  const [elementsLoading, setElementsLoading] = useState(false);

  // Platform phase local selections — kept at top level to avoid conditional hooks
  const [localPlatform, setLocalPlatform] = useState<string | null>(null);
  const [localScale, setLocalScale] = useState<string | null>(null);
  const [localPrio, setLocalPrio] = useState<string | null>(null);

  useEffect(() => {
    setLocalPlatform(answers.platform || null);
    setLocalScale(answers.scale || null);
    setLocalPrio(answers.priority || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    topRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [phase]);

  const diffLabel = (d: string) =>
    d === 'easy'
      ? t('difficultyEasy')
      : d === 'medium'
        ? t('difficultyMedium')
        : t('difficultyHard');

  /**
   * Selects a genre, transitions to the sub-genre phase, and fetches AI suggestions.
   *
   * @param genreId - the genre id to select / 選択するジャンルID
   */
  const handleSelectGenre = async (genreId: string) => {
    setAnswers((a) => ({ ...a, genre: genreId, subs: [], elements: [] }));
    setPhase('sub');
    setSubsLoading(true);
    setDynamicSubs([]);
    const aiSubs = await fetchSuggestions('sub_genres', t('genre_' + genreId));
    if (aiSubs) {
      setDynamicSubs(aiSubs);
    } else {
      const staticSubs = SUB_GENRES[genreId] || [];
      setDynamicSubs(
        staticSubs.map((s) => ({
          id: s.id,
          icon: s.icon,
          label: t(`sub_${genreId}_${s.id}`),
        })),
      );
    }
    setSubsLoading(false);
  };

  /**
   * Advances from sub-genre to elements phase and fetches AI element suggestions.
   *
   * @param selectedSubIds - currently selected sub-genre ids / 選択済みサブジャンルID一覧
   */
  const handleSubNext = async (selectedSubIds: string[]) => {
    setPhase('elements');
    setElementsLoading(true);
    setDynamicElements([]);

    const aiElements = await fetchSuggestions(
      'elements',
      answers.genre,
      selectedSubIds,
    );
    if (aiElements) {
      setDynamicElements(aiElements);
    } else {
      setDynamicElements(
        ELEMENTS.map((e) => ({
          id: e.id,
          icon: e.icon,
          label: t('elem_' + e.id),
        })),
      );
    }
    setElementsLoading(false);
  };

  /**
   * Runs AI proposal generation and transitions through proposing → proposals phases.
   *
   * @param overrideAnswers - answers snapshot including platform/scale/priority / プラットフォーム等を含む回答スナップショット
   */
  const runProposeApps = async (overrideAnswers: AppAnswers) => {
    setPhase('proposing');
    try {
      const r = await proposeApps(t, overrideAnswers, dynamicSubs, dynamicElements);
      setProposals(r.proposals || []);
      if (r.aiFailed && r.errorMessage) {
        setAiErrorMessage(r.errorMessage);
      } else {
        setAiErrorMessage('');
      }
    } catch (error) {
      setProposals([]);
      setAiErrorMessage(
        error instanceof Error
          ? error.message
          : 'プロポーザル生成に失敗しました',
      );
    }
    setPhase('proposals');
  };

  /**
   * Commits platform/scale/priority selections and triggers AI proposal generation.
   */
  const handlePlatformGenerate = async () => {
    const next: AppAnswers = {
      ...answers,
      platform: localPlatform || '',
      scale: localScale || '',
      priority: localPrio || '',
    };
    setAnswers(next);
    await runProposeApps(next);
  };

  /**
   * Re-runs proposal generation with current answers, resetting picked proposal.
   */
  const handleRegenerateProposals = async () => {
    setPickedProp(null);
    await runProposeApps(answers);
  };

  /**
   * Generates the final CLAUDE.md for the picked proposal.
   */
  const handleGenerateClaudeMd = async () => {
    if (!pickedProp) return;
    setPhase('generating');
    try {
      const r = await generateClaudeMd(
        t,
        answers,
        pickedProp,
        dynamicSubs,
        dynamicElements,
      );
      setResult(r);
    } catch {
      setResult({ tech_rationale: '', score: 90, claude_md: t('errorOccurred') });
    }
    setPhase('result');
  };

  /**
   * Calls the setup-theme API to create a project directory from the generated CLAUDE.md.
   */
  const handleCreateTheme = async () => {
    if (!pickedProp || !result) return;
    setSetupPhase('loading');
    setSetupError(null);
    try {
      const response = await fetch('/api/setup-theme', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appName: pickedProp.name,
          claudeMd: result.claude_md,
          description: pickedProp.tagline,
        }),
      });
      const data = await response.json();
      if (response.ok && data.success) {
        setSetupPhase('success');
        setCreatedThemePath(data.projectPath);
      } else {
        setSetupPhase('error');
        setSetupError(data.error || 'テーマの作成に失敗しました');
      }
    } catch (error) {
      setSetupPhase('error');
      setSetupError(
        error instanceof Error ? error.message : 'テーマの作成に失敗しました',
      );
    }
  };

  /**
   * Copies the generated CLAUDE.md to the clipboard and briefly shows confirmation.
   */
  const handleCopy = () => {
    navigator.clipboard.writeText(result?.claude_md || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  /**
   * Resets all wizard state back to the intro phase.
   */
  const handleRestart = () => {
    setPhase('intro');
    setAnswers({ genre: '', platform: '', scale: '', priority: '' });
    setProposals([]);
    setPickedProp(null);
    setResult(null);
  };

  const toggleSub = (id: string) =>
    setAnswers((a) => ({
      ...a,
      subs: a.subs?.includes(id)
        ? a.subs.filter((x) => x !== id)
        : [...(a.subs || []), id],
    }));

  const toggleElement = (id: string) =>
    setAnswers((a) => ({
      ...a,
      elements: a.elements?.includes(id)
        ? a.elements.filter((x) => x !== id)
        : [...(a.elements || []), id],
    }));

  return {
    t,
    phase,
    setPhase,
    answers,
    proposals,
    aiErrorMessage,
    setAiErrorMessage,
    pickedProp,
    setPickedProp,
    result,
    copied,
    setupPhase,
    setSetupPhase,
    createdThemePath,
    setCreatedThemePath,
    setupError,
    setSetupError,
    topRef,
    dynamicSubs,
    dynamicElements,
    subsLoading,
    elementsLoading,
    localPlatform,
    setLocalPlatform,
    localScale,
    setLocalScale,
    localPrio,
    setLocalPrio,
    diffLabel,
    handleSelectGenre,
    handleSubNext,
    handlePlatformGenerate,
    handleRegenerateProposals,
    handleGenerateClaudeMd,
    handleCreateTheme,
    handleCopy,
    handleRestart,
    toggleSub,
    toggleElement,
    runProposeApps,
  };
}
