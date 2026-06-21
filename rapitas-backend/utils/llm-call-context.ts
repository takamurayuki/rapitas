/**
 * LLM Call Context
 *
 * AsyncLocalStorage-based scope for counting sendAIMessage calls per execution.
 * Tier 2 of the llmCallCount two-layer approach: captures main-process LLM calls
 * that are not counted via CLI num_turns (which is a subprocess metric).
 * Not responsible for CLI subprocess calls or AnthropicApiAgent direct calls.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

interface LlmCallContext {
  count: number;
}

const als = new AsyncLocalStorage<LlmCallContext>();

/**
 * Run `fn` inside an LLM call scope. Every `incrementLlmCall()` within the
 * async call tree will increment this scope's counter.
 *
 * @param fn - Async function to execute in scope. / スコープ内で実行する非同期関数
 * @returns The return value of `fn`. / fnの戻り値
 */
export function withLlmCallScope<T>(fn: () => Promise<T>): Promise<T> {
  return als.run({ count: 0 }, fn);
}

/**
 * Increment the LLM call counter for the current ALS scope.
 * No-op when called outside a `withLlmCallScope` context (e.g. standalone jobs).
 * No-op behaviour is intentional — erroneous attribution is worse than undercounting.
 */
export function incrementLlmCall(): void {
  const ctx = als.getStore();
  if (ctx) ctx.count++;
}

/**
 * Return the current LLM call count for the active ALS scope.
 * Returns 0 when called outside a scope.
 *
 * @returns Current call count. / 現在のカウント
 */
export function getLlmCallCount(): number {
  return als.getStore()?.count ?? 0;
}
