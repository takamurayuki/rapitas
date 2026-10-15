/**
 * Fault-Injection Scenario Common Helpers
 *
 * Shared context, result type, and timeout wrapper for the 7 fault-injection
 * scenarios under scripts/fault-scenarios/. Kept separate so each scenario
 * file stays under the file-size guideline (COMPONENT_SPLITTING_POLICY.md).
 */
import { assertNotPort3001 } from '../restart-loop-smoke';

/** Context passed to every scenario — the isolated backend under test. */
export interface ScenarioContext {
  port: number;
  baseUrl: string;
  cwd: string;
}

/** Outcome of running one fault-injection scenario. */
export interface ScenarioResult {
  name: string;
  passed: boolean;
  detail: string;
}

const DEFAULT_SCENARIO_TIMEOUT_MS = 60_000;

/**
 * Runs a scenario function with a bounded timeout so one hung scenario can't
 * block the rest of the fault-injection E2E run.
 *
 * @param name - Scenario name, used in the result / シナリオ名
 * @param fn - The scenario body / シナリオ本体
 * @param timeoutMs - Max wait before declaring a timeout failure / タイムアウト（ミリ秒）
 * @returns The scenario result, always resolved (never throws) / 常に解決される結果
 */
export async function runWithTimeout(
  name: string,
  fn: () => Promise<ScenarioResult>,
  timeoutMs = DEFAULT_SCENARIO_TIMEOUT_MS,
): Promise<ScenarioResult> {
  try {
    return await Promise.race([
      fn(),
      new Promise<ScenarioResult>((resolve) =>
        setTimeout(
          () => resolve({ name, passed: false, detail: `timed out after ${timeoutMs}ms` }),
          timeoutMs,
        ),
      ),
    ]);
  } catch (err) {
    return { name, passed: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Validates the isolated E2E port before any scenario touches the network —
 * re-exported here so scenario files don't each import restart-loop-smoke
 * directly.
 *
 * @param port - Port to validate / バリデート対象のポート番号
 */
export function assertIsolatedPort(port: number): void {
  assertNotPort3001(port);
}

/** Max characters of a failed response body kept in a scenario detail. */
export const RESPONSE_BODY_MAX_CHARS = 500;

const ERROR_MESSAGE_MAX_CHARS = 200;

/**
 * Reads a failed response's body for inclusion in a scenario detail.
 *
 * The task-create route replaces every exception with a fixed 500 message, so the
 * body is often the only server-side clue in the CI log. Never throws — the
 * scenario must still report its own failure. Keeps the head of the body,
 * where Prisma/Elysia put the error code.
 *
 * @param res - The non-ok response / 失敗したレスポンス
 * @returns Text to append to a detail string / detail に付加する文字列
 */
export async function readFailedResponseBody(res: Response): Promise<string> {
  try {
    const raw = (await res.text()).trim();
    if (!raw) return `no body: レスポンス本文は空でした（status=${res.status}）`;
    if (raw.length <= RESPONSE_BODY_MAX_CHARS) return raw;
    return `${raw.slice(0, RESPONSE_BODY_MAX_CHARS)}…（省略）`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `レスポンス本文を読めませんでした: ${msg.slice(0, ERROR_MESSAGE_MAX_CHARS)}`;
  }
}
