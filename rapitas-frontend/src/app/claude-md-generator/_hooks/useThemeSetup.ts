'use client';
// use-theme-setup

import { useState } from 'react';
import type { AppProposal, GenerateResult } from '../_types/types';
import { AGENT_TARGETS } from '../_utils/constants';

export type SetupPhase = 'idle' | 'loading' | 'success' | 'error';

/**
 * Owns the "create the project from this specification" step: the scaffold
 * target, where it lands, and the outcome of the call.
 *
 * Extracted from use-wizard, which crossed the 500-line hard limit — exceeding
 * it turns every other PR red, so the split is not optional. This block was the
 * cleanest candidate: it touches nothing in the hearing or review flow.
 *
 * @param t - Translator, for the failure message / 翻訳関数
 * @returns Setup state and the actions over it / 作成状態と操作
 */
export function useThemeSetup(t: (key: string) => string) {
  const [setupPhase, setSetupPhase] = useState<SetupPhase>('idle');
  // Primary AI agent the scaffolded repo targets — decides the guide file's
  // name/location (.claude/CLAUDE.md, AGENTS.md, GEMINI.md, …).
  const [agentTargetId, setAgentTargetId] = useState<string>(AGENT_TARGETS[0].id);
  // Empty means "let the backend decide": category falls back to 開発, and
  // basePath falls back to ~/Projects.
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [basePath, setBasePath] = useState<string>('');
  const [createdThemePath, setCreatedThemePath] = useState<string | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);

  /**
   * Creates a project directory from the generated documents.
   *
   * @param pickedProp - The chosen app proposal / 選択したアプリ提案
   * @param result - The generated document package / 生成された文書一式
   */
  const createTheme = async (pickedProp: AppProposal | null, result: GenerateResult | null) => {
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
          adr: result.adr,
          scaffold: result.scaffold,
          description: pickedProp.tagline,
          agentFilePath: target.path,
          // Omitted (not null/empty) when unset so the backend's own fallbacks
          // apply rather than being overridden with a blank value.
          ...(categoryId !== null ? { categoryId } : {}),
          ...(basePath.trim() ? { basePath: basePath.trim() } : {}),
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

  /** Back to idle so the user can retry. */
  const resetSetup = () => {
    setSetupPhase('idle');
    setSetupError(null);
    setCreatedThemePath(null);
  };

  /** Full reset, for restarting the wizard. */
  const reset = () => {
    setSetupPhase('idle');
    setAgentTargetId(AGENT_TARGETS[0].id);
    setCategoryId(null);
    setBasePath('');
    setCreatedThemePath(null);
    setSetupError(null);
  };

  return {
    setupPhase,
    agentTargetId,
    setAgentTargetId,
    categoryId,
    setCategoryId,
    basePath,
    setBasePath,
    createdThemePath,
    setupError,
    createTheme,
    resetSetup,
    reset,
  };
}
