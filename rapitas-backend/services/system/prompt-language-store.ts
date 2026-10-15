/**
 * PromptLanguageStore
 *
 * File-backed persistence for the agent output language. The desktop UI
 * pushes its active locale here (PATCH /settings { uiLocale }) so every
 * agent prompt — auto-run phases and the manual "実行" path alike — asks for
 * the same language the user reads the app in. Lives in RAPITAS_DATA_DIR
 * (default ~/.rapitas) because UserSettings gains no new Prisma column for
 * this (same mechanism as auto-restart-merged-code/settings-store.ts).
 * Not responsible for deciding WHAT is written in that language.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';

/** Languages the prompt templates exist in (see workflow-role-prompts.ts). */
export type PromptLanguage = 'ja' | 'en';

/** Matches the frontend's defaultLocale (i18n/config.ts). */
const DEFAULT_PROMPT_LANGUAGE: PromptLanguage = 'ja';

function dataDir(): string {
  return process.env.RAPITAS_DATA_DIR?.trim() || join(homedir(), '.rapitas');
}

function languageFile(): string {
  return join(dataDir(), '.prompt-language');
}

/**
 * Narrow an arbitrary value to a supported prompt language.
 *
 * @param value - Candidate value (settings body, file content, …) / 候補値
 * @returns The language when supported, otherwise null / 対応言語なら返す
 */
export function asPromptLanguage(value: unknown): PromptLanguage | null {
  return value === 'ja' || value === 'en' ? value : null;
}

/**
 * Read the language every agent prompt should request its output in.
 *
 * @returns Stored language; absent or invalid file = 'ja' / 保存済み言語(既定 ja)
 */
export function readPromptLanguage(): PromptLanguage {
  try {
    return asPromptLanguage(readFileSync(languageFile(), 'utf8').trim()) ?? DEFAULT_PROMPT_LANGUAGE;
  } catch {
    return DEFAULT_PROMPT_LANGUAGE;
  }
}

/**
 * Persist the prompt language (best-effort: a failed write only keeps the
 * previous language, never fails the settings request).
 *
 * @param language - Language to persist / 保存する言語
 */
export function writePromptLanguage(language: PromptLanguage): void {
  try {
    mkdirSync(dirname(languageFile()), { recursive: true });
    writeFileSync(languageFile(), language);
  } catch {
    // Never let a settings write failure crash a request or an agent dispatch.
  }
}
