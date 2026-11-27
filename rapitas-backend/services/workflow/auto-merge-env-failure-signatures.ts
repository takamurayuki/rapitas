/**
 * auto-merge-env-failure-signatures
 *
 * Pure detection of known environmental CI failures (failures that say nothing
 * about the PR's code) from a failed job's log. NOT responsible for fetching
 * logs or re-running anything — auto-merge-env-rerun owns that.
 *
 * Add a signature by appending one entry to ENV_FAILURE_SIGNATURES.
 */

/** One known environmental failure and how to recognise it in a job log. */
export interface EnvFailureSignature {
  /** Stable identifier recorded in the transition metadata. */
  id: string;
  /** Whether the given `gh run view --log-failed` output shows this failure. */
  matches: (log: string) => boolean;
}

/**
 * Lines of `gh run view --log-failed` look like `<job>\t<step>\t<time> <text>`.
 * Returns the text of the lines whose step column equals `step`.
 */
function linesOfStep(log: string, step: string): string[] {
  // Real workflows suffix the step with a parenthesised platform, e.g.
  // "Install system dependencies (Ubuntu)" (tauri-build.yml), so accept the
  // bare name or the name followed only by a "(...)" suffix — never a looser
  // substring, which would also match unrelated steps.
  const stepName = new RegExp(`^${step.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s*\\(.*\\))?$`);
  const out: string[] = [];
  for (const raw of log.split('\n')) {
    const cols = raw.split('\t');
    if (cols.length >= 3 && stepName.test(cols[1].trim())) out.push(cols.slice(2).join('\t'));
  }
  return out;
}

/**
 * apt-get timing out while installing system dependencies (2026-11-24, PRs
 * #1711/#1712/#1715): the step's own retry gave up and the step was killed by
 * `timeout` (exit code 124). All three conditions must hold on the same step.
 */
const APT_INSTALL_TIMEOUT: EnvFailureSignature = {
  id: 'apt-install-timeout',
  matches: (log) => {
    const lines = linesOfStep(log, 'Install system dependencies');
    return (
      lines.some((l) => l.includes('apt-get install failed after')) &&
      // \b-style guard so "exit code 1240" does not count.
      lines.some((l) => /exit code 124(?!\d)/.test(l))
    );
  },
};

/** Known environmental failure signatures; extend by appending. */
export const ENV_FAILURE_SIGNATURES: EnvFailureSignature[] = [APT_INSTALL_TIMEOUT];

/**
 * Find the first known signature that the log matches.
 *
 * @param log - Failed-job log text. / 失敗ジョブのログ
 * @param signatures - Signatures to try (defaults to the built-in list). / 印の一覧
 * @returns The matching signature, or null (empty log included). / 当たった印
 */
export function matchEnvFailureSignature(
  log: string,
  signatures: EnvFailureSignature[] = ENV_FAILURE_SIGNATURES,
): EnvFailureSignature | null {
  if (!log.trim()) return null;
  return signatures.find((s) => s.matches(log)) ?? null;
}
