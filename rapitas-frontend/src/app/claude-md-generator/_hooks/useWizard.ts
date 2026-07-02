'use client';
// use-wizard

import { useState, useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import type { AppAnswers, AppProposal, DynamicItem, GenerateResult } from '../_types/types';
import { proposeApps, generateClaudeMd } from '../_utils/api';
import { AGENT_TARGETS, ELEMENTS, SUB_GENRES } from '../_utils/constants';

/** lucide icon name for user-added custom sub-genres/elements. / 自由入力で追加した項目のアイコン */
const CUSTOM_ICON = 'Plus';

/**
 * Builds a stable, collision-resistant id for a user-typed custom option.
 *
 * @param label - the free-text label / 自由入力されたラベル
 * @returns a `custom_`-prefixed id / `custom_`接頭辞付きID
 */
function customId(label: string): string {
  return `custom_${label.trim().toLowerCase().replace(/\s+/g, '_')}`;
}

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
  const [setupPhase, setSetupPhase] = useState<SetupPhase>('idle');
  // Primary AI agent the scaffolded repo targets — decides the guide file's
  // name/location (.claude/CLAUDE.md, AGENTS.md, GEMINI.md, …).
  const [agentTargetId, setAgentTargetId] = useState<string>(AGENT_TARGETS[0].id);
  const [createdThemePath, setCreatedThemePath] = useState<string | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const topRef = useRef<HTMLDivElement>(null);

  const [dynamicSubs, setDynamicSubs] = useState<DynamicItem[]>([]);
  const [dynamicElements, setDynamicElements] = useState<DynamicItem[]>([]);

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
   * Selects a genre and transitions to the sub-genre phase, seeding the
   * sub-genre options from the local static catalog (no AI call — options are
   * self-owned; users add their own via the free-input field). Switching genre
   * resets sub-genre selections since sub-genres are genre-specific.
   *
   * @param genreId - the genre id to select / 選択するジャンルID
   */
  const handleSelectGenre = (genreId: string) => {
    setAnswers((a) => ({ ...a, genre: genreId, subs: [], elements: [] }));
    setPhase('sub');
    const staticSubs = SUB_GENRES[genreId] || [];
    setDynamicSubs(
      staticSubs.map((s) => ({ id: s.id, icon: s.icon, label: t(`sub_${genreId}_${s.id}`) })),
    );
  };

  /**
   * Advances from sub-genre to elements phase, seeding the element options from
   * the local static catalog on first entry. Re-entry preserves any custom
   * elements the user already added.
   *
   * @param _selectedSubIds - selected sub-genre ids (unused; selection lives in answers) / 選択済みサブジャンルID（未使用）
   */
  const handleSubNext = (_selectedSubIds: string[]) => {
    setPhase('elements');
    setDynamicElements((prev) =>
      prev.length > 0
        ? prev
        : ELEMENTS.map((e) => ({ id: e.id, icon: e.icon, label: t('elem_' + e.id) })),
    );
  };

  /**
   * Adds a user-typed custom sub-genre to the option list and selects it.
   *
   * @param label - free-text sub-genre name / 自由入力のサブジャンル名
   */
  const addCustomSub = (label: string) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    const id = customId(trimmed);
    setDynamicSubs((prev) =>
      prev.some((s) => s.id === id) ? prev : [...prev, { id, icon: CUSTOM_ICON, label: trimmed }],
    );
    setAnswers((a) => ({
      ...a,
      subs: a.subs?.includes(id) ? a.subs : [...(a.subs || []), id],
    }));
  };

  /**
   * Adds a user-typed custom element/feature to the option list and selects it.
   *
   * @param label - free-text element name / 自由入力の機能要素名
   */
  const addCustomElement = (label: string) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    const id = customId(trimmed);
    setDynamicElements((prev) =>
      prev.some((e) => e.id === id) ? prev : [...prev, { id, icon: CUSTOM_ICON, label: trimmed }],
    );
    setAnswers((a) => ({
      ...a,
      elements: a.elements?.includes(id) ? a.elements : [...(a.elements || []), id],
    }));
  };

  /**
   * Maps the propose-apps route's stable error code to a translated message.
   * The route never sends prose directly — only a locale-independent code —
   * so the UI always shows an i18n string, never raw API text.
   *
   * @param code - error code from the route ('parse_failed' | 'server_error' | 'timeout' | 'connection_failed') / ルートからのエラーコード
   * @returns translated error message / 翻訳済みエラーメッセージ
   */
  const translateAiErrorCode = (code: string): string => {
    switch (code) {
      case 'parse_failed':
        return t('aiParseFailed');
      case 'timeout':
        return t('aiTimeout');
      case 'connection_failed':
        return t('aiConnectionFailed');
      case 'server_error':
        return t('aiServerError');
      default:
        return t('proposalGenerateFailed');
    }
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
      if (r.aiFailed && r.errorCode) {
        setAiErrorMessage(translateAiErrorCode(r.errorCode));
      } else {
        setAiErrorMessage('');
      }
    } catch {
      setProposals([]);
      setAiErrorMessage(t('proposalGenerateFailed'));
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
      const r = await generateClaudeMd(t, answers, pickedProp, dynamicSubs, dynamicElements);
      setResult(r);
    } catch {
      setResult({
        tech_rationale: '',
        score: 90,
        claude_md: t('errorOccurred'),
      });
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
      const target = AGENT_TARGETS.find((a) => a.id === agentTargetId) || AGENT_TARGETS[0];
      const response = await fetch('/api/setup-theme', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appName: pickedProp.name,
          claudeMd: result.claude_md,
          requirements: result.requirements,
          design: result.design,
          description: pickedProp.tagline,
          agentFilePath: target.path,
        }),
      });
      const data = await response.json();
      if (response.ok && data.success) {
        setSetupPhase('success');
        setCreatedThemePath(data.projectPath);
      } else {
        // NOTE: Prefer the translated fallback over `data.error` — the API
        // route returns Japanese prose that would otherwise leak into an
        // English UI regardless of the user's locale setting.
        setSetupPhase('error');
        setSetupError(t('themeCreateError'));
      }
    } catch {
      setSetupPhase('error');
      setSetupError(t('themeCreateError'));
    }
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
    // Reset setup state as well
    setSetupPhase('idle');
    setAgentTargetId(AGENT_TARGETS[0].id);
    setCreatedThemePath(null);
    setSetupError(null);
  };

  /**
   * Resets setup state to idle for retry functionality.
   */
  const handleResetSetup = () => {
    setSetupPhase('idle');
    setSetupError(null);
    setCreatedThemePath(null);
  };

  const toggleSub = (id: string) =>
    setAnswers((a) => ({
      ...a,
      subs: a.subs?.includes(id) ? a.subs.filter((x) => x !== id) : [...(a.subs || []), id],
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
    setupPhase,
    setSetupPhase,
    agentTargetId,
    setAgentTargetId,
    createdThemePath,
    setCreatedThemePath,
    setupError,
    setSetupError,
    topRef,
    dynamicSubs,
    dynamicElements,
    localPlatform,
    setLocalPlatform,
    localScale,
    setLocalScale,
    localPrio,
    setLocalPrio,
    diffLabel,
    handleSelectGenre,
    handleSubNext,
    addCustomSub,
    addCustomElement,
    handlePlatformGenerate,
    handleRegenerateProposals,
    handleGenerateClaudeMd,
    handleCreateTheme,
    handleRestart,
    handleResetSetup,
    toggleSub,
    toggleElement,
    runProposeApps,
  };
}
