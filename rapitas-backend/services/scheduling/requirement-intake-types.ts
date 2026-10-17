/**
 * requirement-intake-types
 *
 * The shapes the requirement intake shares between its job and its filers.
 * Separated so requirement-intake-filers.ts can take the deps type without
 * importing the job (which would be a cycle).
 */

import type { RequirementTaskPayload } from '../organization/requirements-task-payload';
import type { DriftTaskPayload } from '../organization/spec-drift';
import type { BootstrapTaskPayload } from '../organization/project-bootstrap-task';
import type { SpecGateTaskPayload } from '../organization/spec-gate-task';

/** A theme eligible for scanning. */
export interface IntakeTheme {
  id: number;
  workingDirectory: string | null;
  /** Branch the project's documents are authoritative on. / 文書の正となるブランチ */
  defaultBranch?: string | null;
  /**
   * The theme's own preview config. Either this or a `rapitas.runtime.json` in
   * the project turns runtime-smoke on. / テーマ側のプレビュー設定
   */
  runtimeConfigJson?: string | null;
}

/** Side-effecting collaborators, injectable so tests need no module mocking. */
export interface RequirementIntakeDeps {
  listThemes: () => Promise<IntakeTheme[]>;
  /** Returns the document text, or null when absent / unreadable. */
  readRequirements: (
    workingDirectory: string,
    defaultBranch?: string | null,
  ) => Promise<string | null>;
  /** Returns `docs/design.md`, or null when absent. / 設計書 */
  readDesign: (workingDirectory: string, defaultBranch?: string | null) => Promise<string | null>;
  /** Whether the project root carries a dependency manifest. / ルートに manifest があるか */
  hasProjectManifest: (workingDirectory: string) => boolean;
  /**
   * Whether `rapitas.runtime.json` is present on the project's authoritative
   * branch (falling back to the working tree). Checked separately from the
   * theme's own config because either one enables runtime-smoke.
   * / 正となるブランチに rapitas.runtime.json があるか
   */
  hasRuntimeConfigFile: (
    workingDirectory: string,
    defaultBranch?: string | null,
  ) => Promise<boolean>;
  /** Titles of every task in the theme, regardless of status. */
  listExistingTitles: (themeId: number) => Promise<string[]>;
  /** How many filed tasks the theme has that nobody has started. */
  countUnstartedTasks: (themeId: number) => Promise<number>;
  /**
   * Whether every already-filed environment-setup task has finished. Decides
   * whether a zero-filing run is a theme legitimately waiting for its setup
   * task or one that can never file again (requirement-intake-outcome.ts).
   *
   * Optional: when omitted the outcome is left unreported rather than guessed,
   * so a test fixture without it cannot manufacture a false alarm.
   * / 環境構築タスクが完了済みか
   */
  isBootstrapTaskFinished?: (themeId: number) => Promise<boolean>;
  /** Files one task; a falsy result means nothing was created. */
  createTask: (
    payload: RequirementTaskPayload | DriftTaskPayload | BootstrapTaskPayload | SpecGateTaskPayload,
  ) => Promise<unknown>;
}
