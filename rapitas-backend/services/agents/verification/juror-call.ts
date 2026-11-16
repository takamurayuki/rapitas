/**
 * juror-call
 *
 * Asks one juror of the adversarial diff-review panel for its verdict, with a
 * wall-clock cap and per-provider timeout history (rest a juror that keeps
 * timing out). Captures the call's cost for the review's cost record. Not
 * responsible for the prompt, the vote or the panel composition.
 */
import { sendAIMessage } from '../../../utils/ai-client';
import { createLogger } from '../../../config/logger';
import type { JurorSpec } from './jury-panel';
import type { UnknownReason } from './juror-unknown-reason';
import { parseReviewVerdict, type JurorVerdict } from './adversarial-diff-review-verdict';
import { coolVendorAfterJurorFailure } from './juror-cli-cooldown';

const log = createLogger('verification:adversarial-diff-review');

/**
 * Wall-clock cap for a single juror.
 *
 * NOTE: This whole review runs SYNCHRONOUSLY inside the agent's
 * `PUT /workflow/tasks/:id/files/verify` request, and `sendAIMessage` has no
 * deadline of its own — one wedged provider held the request open indefinitely.
 * The saving agent's Bash tool gives up on its curl at 120s, backgrounds it and
 * then blocks waiting for output, so wall time past that point is pure idle.
 * The sibling phase-critic gate already caps itself for exactly this reason
 * (critic-gate.ts, task 492).
 *
 * Deliberately does NOT change any verdict semantics: a juror that times out
 * reports 'unknown', which is the same state it reaches today when it errors,
 * so the high-risk fail-closed policy below still applies unchanged.
 */
export function jurorTimeoutMs(): number {
  const v = parseInt(process.env.RAPITAS_ADVERSARIAL_JUROR_TIMEOUT_MS ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : 120_000;
}

/** Consecutive timeouts before a juror is rested. */
export const JUROR_TIMEOUT_STRIKES = 3;

/** How long a rested juror is skipped before being tried again. */
export const JUROR_COOLOFF_MS = 30 * 60_000;

/**
 * Per-provider timeout history, in memory on purpose.
 *
 * Jurors run under `Promise.all`, so the review waits for the SLOWEST one: a
 * provider that always times out adds the full timeout to every single review.
 * On 2026-08-28 all 29 adversarial log lines were timeouts, 26 of them the same
 * provider — roughly an hour of added latency for verdicts that were 'unknown'
 * before they were asked. Resting it costs nothing: a skipped juror returns the
 * same 'unknown' it would have returned, just immediately.
 */
const jurorHealth = new Map<string, { strikes: number; skipUntilMs: number }>();

/** Clear the juror timeout history. Test-only — never call from production code. */
export function resetJurorHealth(): void {
  jurorHealth.clear();
}

/**
 * Whether a juror is currently rested after repeated timeouts.
 *
 * @param juror - Juror label (provider:model). / 陪審員ラベル
 * @param nowMs - Current time (ms). / 現在時刻
 * @returns true while the juror should be skipped. / 休ませる間は true
 */
export function jurorIsRested(juror: string, nowMs: number): boolean {
  return (jurorHealth.get(juror)?.skipUntilMs ?? 0) > nowMs;
}

/**
 * Record one juror attempt so repeated timeouts eventually rest the provider.
 *
 * @param juror - Juror label (provider:model). / 陪審員ラベル
 * @param timedOut - Whether this attempt timed out. / タイムアウトしたか
 * @param nowMs - Current time (ms). / 現在時刻
 */
export function recordJurorOutcome(juror: string, timedOut: boolean, nowMs: number): void {
  if (!timedOut) {
    jurorHealth.delete(juror);
    return;
  }
  const prev = jurorHealth.get(juror);
  const strikes = (prev?.strikes ?? 0) + 1;
  jurorHealth.set(juror, {
    strikes,
    skipUntilMs: strikes >= JUROR_TIMEOUT_STRIKES ? nowMs + JUROR_COOLOFF_MS : 0,
  });
}

/**
 * Ask one juror for an independent verdict. Never throws.
 *
 * The seat carries its own model: in Claude-only CLI mode the panel is three
 * distinct Claude models rather than three vendors, because routing Gemini
 * and OpenAI through Claude would be one vote counted three times
 * (jury-panel.ts).
 *
 * @param seat - The juror to ask. / 問い合わせる陪審員
 * @param prompt - Shared review prompt. / 共通レビュープロンプト
 * @returns The juror's verdict ('unknown' on error/timeout/unparseable). / 判定
 */
export async function askJuror(seat: JurorSpec, prompt: string): Promise<JurorVerdict> {
  const { provider, model, label } = seat;
  // One shape per cause: four different failures used to land on the same
  // bare 'unknown', which is why a slide in the unknown rate could not be
  // attributed afterwards (juror-unknown-reason.ts).
  const unknownFor = (unknownReason: UnknownReason): JurorVerdict => ({
    provider,
    model,
    verdict: 'unknown',
    severity: 0,
    reasons: [],
    unknownReason,
  });
  const timeoutMs = jurorTimeoutMs();
  const startedAt = new Date();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const verdict = await Promise.race([
      sendAIMessage({
        provider,
        model,
        ...(seat.cliRoute ? { cliRoute: seat.cliRoute } : {}),
        systemPrompt: 'You are a meticulous, skeptical senior code reviewer.',
        // Structured findings (severity/evidence/repro per item) need more
        // room than the old one-line reasons did.
        maxTokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      }).then((res): JurorVerdict => {
        const v = parseReviewVerdict(res.content);
        recordJurorOutcome(label, false, Date.now());
        return {
          provider,
          model,
          verdict: v.verdict,
          severity: v.severity,
          reasons: v.reasons,
          ...(v.verdict === 'unknown' ? { unknownReason: 'unparsable' as const } : {}),
          ...(v.findings ? { findings: v.findings } : {}),
          usage: {
            costUsd: res.costUsd,
            tokensUsed: res.tokensUsed ?? 0,
            inputTokens: res.inputTokens,
            outputTokens: res.outputTokens,
            cacheReadInputTokens: res.cacheReadInputTokens,
            cacheCreationInputTokens: res.cacheCreationInputTokens,
            modelName: res.modelName,
            startedAt,
            durationMs: Date.now() - startedAt.getTime(),
          },
        };
      }),
      new Promise<JurorVerdict>((resolve) => {
        timer = setTimeout(() => {
          recordJurorOutcome(label, true, Date.now());
          log.warn(
            { juror: label, timeoutMs },
            '[adversarial-review] Juror timed out — counting as unknown',
          );
          resolve(unknownFor('timeout'));
        }, timeoutMs);
      }),
    ]);
    return verdict;
  } catch (err) {
    log.warn({ err, juror: label }, '[adversarial-review] Juror failed');
    // Quota/auth on the seat's CLI cools that vendor for the next review
    // (routing2b); the verdict itself stays 'unknown' as before.
    coolVendorAfterJurorFailure(err, model);
    return unknownFor('error');
  } finally {
    // Without this the pending timer keeps the event loop (and in tests, the
    // process) alive for the full timeout after a fast juror already answered.
    if (timer) clearTimeout(timer);
  }
}
