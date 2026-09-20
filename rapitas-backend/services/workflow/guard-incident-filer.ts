/**
 * guard-incident-filer
 *
 * Turns guard-incidents-*.ndjson lines (written by scripts/primary-guard-hook.cjs
 * when an agent command is denied) into security concerns. Not responsible for
 * detecting or denying commands — the hook does that in a separate process.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { submitConcern } from '../memory/concern-backlog-service';
import type { SubmitConcernInput } from '../memory/concern-backlog-types';

const log = createLogger('workflow:guard-incident-filer');

const POLL_INTERVAL_MS = 5 * 60_000;

/** Title prefix every concern filed here carries — used to recognise our own promoted tasks. */
const GUARD_TASK_TITLE_MARK = 'エージェントが禁止コマンドを実行しようとした';

/** Concern submission function (injectable for tests). */
export type GuardIncidentSubmit = (input: SubmitConcernInput) => Promise<unknown>;

/** Resolves whether a task is itself a guard-incident task (injectable for tests). */
export type GuardTaskLookup = (taskId: number) => Promise<boolean>;

async function isGuardIncidentTask(taskId: number): Promise<boolean> {
  try {
    const t = await prisma.task.findUnique({ where: { id: taskId }, select: { title: true } });
    return t?.title?.includes(GUARD_TASK_TITLE_MARK) ?? false;
  } catch {
    return false; // unknown → file as usual (fail toward reporting)
  }
}

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

/** Sidecar recording which (task, kind) keys were already filed — survives restarts. */
const FILED_STATE_FILE = 'guard-incidents-filed.json';

function loadFiledKeys(dir: string): string[] {
  try {
    const raw = readFileSync(join(dir, FILED_STATE_FILE), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return []; // missing or unreadable sidecar = nothing filed yet
  }
}

function saveFiledKeys(dir: string, keys: Set<string>): void {
  try {
    writeFileSync(join(dir, FILED_STATE_FILE), JSON.stringify([...keys].sort()));
  } catch (err) {
    // A failed save only risks one duplicate concern after a restart — never block filing.
    log.warn({ err, dir }, 'Could not persist filed guard-incident keys');
  }
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
  opts: {
    dir?: string;
    submit?: GuardIncidentSubmit;
    seen?: Set<string>;
    isGuardTask?: GuardTaskLookup;
  } = {},
): Promise<number> {
  const submit = opts.submit ?? submitConcern;
  const seen = opts.seen ?? processedKeys;
  const isGuardTask = opts.isGuardTask ?? isGuardIncidentTask;
  const dir = opts.dir ?? defaultDir();
  // The in-memory set alone reset on every backend restart, and the concern
  // backlog only dedups against LIVE concerns — so once a filed concern had
  // been promoted and its task finished, every restart re-filed the whole
  // day's log (2026-09-20: 13 denial records → 9 tasks, 1004–1015). The
  // sidecar makes "already filed" survive restarts and task completion.
  for (const key of loadFiledKeys(dir)) seen.add(key);
  let filed = 0;
  for (const rec of readIncidents(dir)) {
    // Fixed key (no timestamp/command): volatile parts would defeat dedup and the saturation gate.
    const dedupKey = `guard-incident:${rec.taskId ?? 'unknown'}:${rec.kind}`;
    if (seen.has(dedupKey)) continue;
    // A guard-incident task's own agent exercises the hook with kill/prisma
    // strings while fixing or testing it, trips the hook, and would file the
    // NEXT guard-incident task — 1004→1006→1008→1011→1012→1013→1016→1017 on
    // 2026-09-20. Denials raised from such a task are the hook working, not a
    // new incident: record the key and move on.
    if (rec.taskId != null && (await isGuardTask(rec.taskId))) {
      seen.add(dedupKey);
      saveFiledKeys(dir, seen);
      log.info(
        { taskId: rec.taskId, kind: rec.kind },
        'Guard denial from a guard-incident task — not re-filed',
      );
      continue;
    }
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
      saveFiledKeys(dir, seen);
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
