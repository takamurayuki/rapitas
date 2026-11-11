/**
 * cli-errors
 *
 * Error types shared between the auxiliary Claude CLI provider and its
 * process-cleanup module. Kept in a separate file so neither module needs to
 * import the other just to reference the error class (avoids a circular
 * import between claude-cli-provider.ts and aux-cli-cleanup.ts).
 */

/** Vendor whose subscription CLI failed (ModelVendor's spelling). */
export type AuxCliVendor = 'anthropic' | 'openai';

/**
 * Base of every auxiliary-CLI failure. `vendor` names the CLI that was
 * actually called, so a caller can attribute the failure (e.g. to a cooldown)
 * without guessing from the message — "you've hit your usage limit" is worded
 * the same by both CLIs.
 */
export class AuxCliUnavailableError extends Error {
  readonly vendor: AuxCliVendor;

  /**
   * @param message - Failure text / 失敗の内容
   * @param vendor - The CLI's vendor / 呼んだ CLI のベンダー
   */
  constructor(message: string, vendor: AuxCliVendor) {
    super(message);
    this.name = 'AuxCliUnavailableError';
    this.vendor = vendor;
  }
}

/**
 * Thrown when the CLI path cannot serve a request (binary missing, not logged
 * in, non-zero exit, timeout, or a pending cleanup blocking new calls). Lets
 * the router / callers degrade gracefully instead of silently falling back to
 * the paid API.
 */
// NOTE: Keeps its own `name` — callers such as pre-pr-base-sync.ts match on
// err.name === 'ClaudeCliUnavailableError' to fail open.
export class ClaudeCliUnavailableError extends AuxCliUnavailableError {
  constructor(message: string) {
    super(message, 'anthropic');
    this.name = 'ClaudeCliUnavailableError';
  }
}

/** Thrown when the auxiliary Codex CLI call cannot serve a request. */
export class CodexCliUnavailableError extends AuxCliUnavailableError {
  constructor(message: string) {
    super(message, 'openai');
    this.name = 'CodexCliUnavailableError';
  }
}
