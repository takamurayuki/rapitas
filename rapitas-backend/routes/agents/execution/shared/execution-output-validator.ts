/**
 * execution-output-validator
 *
 * Inspects agent CLI execution output for signs of unaddressed failures
 * (test crashes, EPERM on binary spawn, abandoned commands, etc).
 *
 * Codex/Claude CLIs sometimes report success ("対応しました" / "completed") even
 * when the verification commands they ran (vitest, pnpm test, build) failed
 * for environmental reasons (Windows AV locking esbuild, missing binaries,
 * lockfile mismatch). Without an explicit guard, the post-execution pipeline
 * commits + opens a PR for unverified code, masking real regressions.
 *
 * This validator is a syntactic guard — it only catches well-defined process
 * failure markers. It does not evaluate semantic correctness; that is the AI
 * review step's job.
 */

export interface FailureSignal {
  /** Short tag identifying the matched pattern / マッチしたパターンのタグ */
  pattern: string;
  /** The matched substring (truncated) for logging / ログ用にトリミング済みのマッチ文字列 */
  excerpt: string;
}

interface PatternRule {
  name: string;
  regex: RegExp;
}

// NOTE: Patterns here must be specific enough that they only match when a
// command the agent ran actually crashed. Plain occurrences of words like
// "error" or "failed" in narration must NOT match — those produce false
// positives from agent self-reflection.
const FAILURE_PATTERNS: PatternRule[] = [
  // pnpm/npm/yarn lifecycle test failure
  { name: 'pnpm-test-failed', regex: /ELIFECYCLE\s+Test failed/i },
  { name: 'pnpm-script-failed', regex: /ELIFECYCLE\s+Command failed/i },

  // Vitest/Vite startup crashes
  { name: 'vitest-startup-error', regex: /Startup Error[\s─-╿]+\n/ },
  { name: 'vitest-config-load-failed', regex: /failed to load config from/i },

  // Subprocess spawn failures (Windows AV / missing native binary)
  { name: 'eperm-spawn', regex: /\bEPERM\b.*\bspawn\b/i },
  { name: 'spawn-eperm', regex: /\bspawn\b.*\bEPERM\b/i },
  { name: 'enoent-spawn', regex: /\bENOENT\b.*\bspawn\b/i },
  { name: 'spawn-enoent', regex: /\bspawn\b.*\bENOENT\b/i },

  // Generic non-zero exit reported by the agent's own runner
  { name: 'codex-exit-1', regex: /exited 1 in \d+ms/i },
  { name: 'codex-router-error', regex: /codex_core::tools::router:\s+error=Exit code:\s*[1-9]/ },

  // Common test-runner failure markers (narrowly scoped)
  { name: 'jest-failed', regex: /Tests:.*\b\d+\s+failed/i },
  { name: 'vitest-tests-failed', regex: /Tests\s+\d+\s+failed/i },

  // pnpm reinstall hint (indicates missing node_modules)
  { name: 'node-modules-missing', regex: /node_modules missing,\s+did you mean to install/i },

  // Build/compile catastrophic failure
  { name: 'next-build-failed', regex: /Error:\s+Build failed/i },
  { name: 'tsc-fatal-error', regex: /error TS\d+:\s+(?:Cannot find|Module not found)/i },
];

/**
 * Scan agent execution output for hard failure markers.
 *
 * @param output - Combined stdout+stderr captured during agent execution / 実行中に収集したstdout+stderr
 * @returns Array of detected failures (empty when output looks clean) / 検出された失敗の配列（クリーンなら空）
 */
export function detectExecutionFailures(output: string | null | undefined): FailureSignal[] {
  if (!output) return [];

  const signals: FailureSignal[] = [];
  for (const rule of FAILURE_PATTERNS) {
    const match = output.match(rule.regex);
    if (match) {
      const start = Math.max(0, (match.index ?? 0) - 40);
      const end = Math.min(output.length, (match.index ?? 0) + match[0].length + 80);
      const excerpt = output.slice(start, end).replace(/\s+/g, ' ').trim();
      signals.push({ pattern: rule.name, excerpt });
    }
  }
  return signals;
}

/**
 * Convenience: returns true when at least one failure marker is present.
 *
 * @param output - Agent execution output / エージェント実行出力
 * @returns true if any failure pattern matched / 失敗パターンに一致した場合true
 */
export function hasExecutionFailures(output: string | null | undefined): boolean {
  return detectExecutionFailures(output).length > 0;
}
