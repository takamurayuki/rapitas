'use client';
// use-wizard

import { useState, useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import type { AppAnswers, AppProposal, GenerateResult, ProjectContext } from '../_types/types';
import { proposeApps, generateClaudeMd, reviewSpec } from '../_utils/api';
import {
  formatReviewAnswers,
  shouldReviewAgain,
  MAX_REVIEW_ROUNDS,
  type ReviewSpecResult,
} from '../../api/review-spec/review-prompt';
import { useThemeSetup, type SetupPhase } from './useThemeSetup';
import { useOptionCatalog } from './useOptionCatalog';
import { useGenerationHistory, type GenerationEntry } from './useGenerationHistory';
import { useConceptCandidates } from './useConceptCandidates';

export type WizardPhase =
  | 'intro'
  | 'genre'
  | 'sub'
  | 'elements'
  | 'platform'
  | 'proposing'
  | 'proposals'
  // NOTE: Inserted between picking an app and generating its specification.
  // Before this, the whole 4-document package derived from six categorical
  // answers plus an AI-written paragraph — the user never stated a single fact
  // about their own project, so every figure in the non-functional
  // requirements was the model's invention (measured 2026-10-11 on TempoRaid).
  | 'context'
  | 'generating'
  // NOTE: Between generation and the result. Before this the wizard was
  // strictly one-way — result-phase had no refine path — so the first chance to
  // notice a requirement gap was an implementation task bouncing. Measured
  // 2026-10-11: TempoRaid's 12 tasks took 6 verify_repair rounds.
  | 'reviewing'
  | 'review'
  | 'result';

export type { SetupPhase };

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
  // Elicited project facts. Blank fields stay blank on purpose: the route sends
  // them as 未確認 so the generator records an assumption instead of inventing
  // a figure.
  const [projectContext, setProjectContext] = useState<ProjectContext>({});
  const [result, setResult] = useState<GenerateResult | null>(null);
  // The review round's findings/questions and the user's answers to them.
  const [review, setReview] = useState<ReviewSpecResult | null>(null);
  const [reviewAnswers, setReviewAnswers] = useState<Record<string, string>>({});
  /** Review rounds already shown, so the wizard cannot be held open forever. */
  const [reviewRound, setReviewRound] = useState(0);
  const setup = useThemeSetup(t);
  const topRef = useRef<HTMLDivElement>(null);

  const catalog = useOptionCatalog({ answers, setAnswers, t });
  const generations = useGenerationHistory();
  const candidates = useConceptCandidates();
  const { dynamicSubs, dynamicElements } = catalog;

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
    catalog.seedSubs(genreId);
    void candidates
      .fetchFor('subs', { genre: genreId })
      .then((items) => catalog.mergeProposed('subs', items));
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
    catalog.seedElements();
    void candidates
      .fetchFor('elements', { genre: answers.genre, subs: answers.subs })
      .then((items) => catalog.mergeProposed('elements', items));
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
      const r = await proposeApps(
        t,
        overrideAnswers,
        dynamicSubs,
        dynamicElements,
        candidates.proposed.genre,
      );
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

  /** Sets one elicited fact; blank clears it back to 未確認. */
  const setContextField = (key: keyof ProjectContext, value: string) =>
    setProjectContext((prev) => ({ ...prev, [key]: value }));

  /**
   * Moves from the chosen proposal to the elicitation step.
   *
   * NOTE: Generation used to start here. Asking first is the whole point: the
   * questions can be concrete now that the app is chosen, and the answers stop
   * the model from inventing the figures that decide the architecture.
   */
  const goToContext = () => {
    if (!pickedProp) return;
    setPhase('context');
  };

  /**
   * Generates the final document package for the picked proposal.
   *
   * @param reviewAnswers - Answers to a previous round's questions / 壁打ちの回答
   */
  const handleGenerateClaudeMd = async (answersBlock?: string) => {
    if (!pickedProp) return;
    setPhase('generating');
    let generated: GenerateResult | null = null;
    try {
      generated = await generateClaudeMd(
        t,
        answers,
        pickedProp,
        dynamicSubs,
        dynamicElements,
        projectContext,
        answersBlock,
        candidates.proposed.genre,
      );
      setResult(generated);
    } catch {
      setResult({
        tech_rationale: '',
        score: 90,
        claude_md: t('errorOccurred'),
      });
      setPhase('result');
      return;
    }

    // Review the documents before showing them as finished. A failure here must
    // not strand the user on a spinner, so any problem falls through to result.
    if (!generated) {
      setPhase('result');
      return;
    }
    // Recorded on the review path too; this covers the case where the review
    // itself could not run, so a package is never produced without an entry.
    setPhase('reviewing');
    try {
      const r = await reviewSpec({
        requirements: generated.requirements,
        design: generated.design,
        adr: generated.adr,
      });
      setReview(r);
      generations.record({ result: generated, review: r, answersBlock });
      // The round that just finished counts BEFORE deciding, so the cap is a
      // cap on rounds SHOWN rather than on regenerations attempted.
      const shown = reviewRound + 1;
      if (!shouldReviewAgain({ round: reviewRound, implementable: r.implementable })) {
        setPhase('result');
        return;
      }
      setReviewRound(shown);
      // NOTE: answers are deliberately NOT cleared. Clearing them made every
      // round look like a fresh interrogation and is why answering never
      // reached the result (reported 2026-10-12). A question the model repeats
      // keeps the answer already given; a new question starts empty.
      setPhase('review');
    } catch {
      generations.record({ result: generated, review: null, answersBlock });
      setPhase('result');
    }
  };

  /**
   * Restores a previously generated package without calling the model again.
   *
   * @param entry - The history entry to return to / 戻る履歴
   */
  const selectGeneration = (entry: GenerationEntry) => {
    setResult(entry.result);
    setReview(entry.review);
    setReviewAnswers({});
    setPhase('result');
  };

  /**
   * Starts the wizard with options derived from the user's own words.
   *
   * The genre screen is shown immediately and the proposals are appended when
   * they arrive: a spinner here would make the entry worse than the fixed
   * catalog it is meant to improve on.
   */
  const startWithConcept = () => {
    setPhase('genre');
    void candidates.fetchFor('genre');
  };

  /** Re-derives the proposals after the concept is edited mid-flow. */
  const changeConcept = (next: string) => {
    candidates.setConcept(next);
    if (!next.trim()) return;
    void candidates.fetchFor('genre');
  };

  /** Records one answer to a review question. */
  const setReviewAnswer = (id: string, value: string) =>
    setReviewAnswers((prev) => ({ ...prev, [id]: value }));

  /** Regenerates the package with the review answers folded in. */
  const handleRegenerateFromReview = async () => {
    const block = formatReviewAnswers(review?.questions ?? [], reviewAnswers);
    if (!block) return;
    await handleGenerateClaudeMd(block);
  };

  /** Accepts the documents as they stand and moves to the result. */
  const handleAcceptReview = () => setPhase('result');

  /**
   * Resets all wizard state back to the intro phase.
   */
  const handleRestart = () => {
    setPhase('intro');
    setAnswers({ genre: '', platform: '', scale: '', priority: '' });
    setProposals([]);
    setPickedProp(null);
    setProjectContext({});
    catalog.reset();
    generations.reset();
    candidates.reset();
    setReview(null);
    setReviewAnswers({});
    setReviewRound(0);
    setResult(null);
    setup.reset();
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
    projectContext,
    setContextField,
    goToContext,
    concept: candidates.concept,
    setConcept: candidates.setConcept,
    changeConcept,
    startWithConcept,
    proposedOptions: candidates.proposed,
    proposedLoading: candidates.loading,
    proposedReason: candidates.degraded,
    history: generations.history,
    selectGeneration,
    review,
    reviewRound,
    maxReviewRounds: MAX_REVIEW_ROUNDS,
    reviewAnswers,
    setReviewAnswer,
    handleRegenerateFromReview,
    handleAcceptReview,
    result,
    setupPhase: setup.setupPhase,
    agentTargetId: setup.agentTargetId,
    setAgentTargetId: setup.setAgentTargetId,
    categoryId: setup.categoryId,
    setCategoryId: setup.setCategoryId,
    basePath: setup.basePath,
    setBasePath: setup.setBasePath,
    createdThemePath: setup.createdThemePath,
    setupError: setup.setupError,
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
    addCustomSub: catalog.addCustomSub,
    addCustomElement: catalog.addCustomElement,
    handlePlatformGenerate,
    handleRegenerateProposals,
    handleGenerateClaudeMd,
    handleCreateTheme: () => setup.createTheme(pickedProp, result),
    handleRestart,
    handleResetSetup: setup.resetSetup,
    toggleSub,
    toggleElement,
    runProposeApps,
  };
}
