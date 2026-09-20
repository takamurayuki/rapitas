/**
 * guard-incident-filer
 *
 * Turns guard-incidents-*.ndjson lines (written by scripts/primary-guard-hook.cjs
 * when an agent command is denied) into security concerns. Not responsible for
 * detecting or denying commands — the hook does that in a separate process.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from '../../config/logger';
import { submitConcern } from '../memory/concern-backlog-service';
import type { SubmitConcernInput } from '../memory/concern-backlog-types';

const log = createLogger('workflow:guard-incident-filer');

const POLL_INTERVAL_MS = 5 * 60_000;

/** Concern submission function (injectable for tests). */
export type GuardIncidentSubmit = (input: SubmitConcernInput) => Promise<unknown>;

interface GuardIncident {
  taskId: number | null;
  kind: string;
  command: string;
}

/** Same resolution as scripts/primary-guard-hook.cjs so both sides agree on the directory. */
function defaultDir(): string {
  const base = process.env.RAPITAS_DATA_DIR || join(homedir(), '.rapitas');
  return process.env.RAPITAS_GUARD_LOG_DIR || join(base, 'logs');
}

function readIncidents(dir: string): GuardIncident[] {
  if (!existsSync(dir)) return [];
  const out: GuardIncident[] = [];
  for (const name of readdirSync(dir)) {
    if (!/^guard-incidents-.*\.ndjson$/.test(name)) continue;
    for (const line of readFileSync(join(dir, name), 'utf8').split('\n')) {
      try {
        const rec = JSON.parse(line) as GuardIncident;
        if (rec && typeof rec.kind === 'string') out.push(rec);
      } catch {
        // Malformed/partial line — skip it.
      }
    }
  }
  return out;
}

/**
 * File one high-severity security concern per (task, kind) found in the guard log.
 *
 * @param opts - dir/submit/seen overrides / ディレクトリ・起票関数・処理済みキー集合
 * @returns Number of concerns newly filed this pass / 今回起票した件数
 */
export async function fileGuardIncidents(
  opts: { dir?: string; submit?: GuardIncidentSubmit; seen?: Set<string> } = {},
): Promise<number> {
  const submit = opts.submit ?? submitConcern;
  const seen = opts.seen ?? processedKeys;
  let filed = 0;
  for (const rec of readIncidents(opts.dir ?? defaultDir())) {
    // Fixed key (no timestamp/command): volatile parts would defeat dedup and the saturation gate.
    const dedupKey = `guard-incident:${rec.taskId ?? 'unknown'}:${rec.kind}`;
    if (seen.has(dedupKey)) continue;
    try {
      await submit({
        title: `[Security] エージェントが禁止コマンドを実行しようとした (${rec.kind}, task ${rec.taskId ?? '?'})`,
        detail: `実行前フックが拒否した。種別: ${rec.kind}。コマンド(先頭200字・秘匿値マスク済み): ${rec.command}`,
        type: 'security',
        severity: 'high',
        location: 'scripts/primary-guard-hook.cjs',
        originTaskId: rec.taskId ?? undefined,
        source: 'guard-incident',
        dedupKey,
      });
      seen.add(dedupKey);
      filed++;
      log.warn({ taskId: rec.taskId, kind: rec.kind }, 'Guard incident filed as concern');
    } catch (err) {
      log.warn({ err, dedupKey }, 'Failed to file guard incident; will retry');
    }
  }
  return filed;
}

const processedKeys = new Set<string>();
let handle: ReturnType<typeof setInterval> | null = null;

/** Start the periodic incident filer. Safe to call multiple times. */
export function startGuardIncidentFiler(): void {
  if (handle) return;
  handle = setInterval(() => {
    fileGuardIncidents().catch((err) => log.warn({ err }, 'Guard incident pass failed'));
  }, POLL_INTERVAL_MS);
}

/** Stop the periodic incident filer. */
export function stopGuardIncidentFiler(): void {
  if (handle) {
    clearInterval(handle);
    handle = null;
  }
}
