/**
 * inventory-loader
 *
 * Resolves, reads, validates and mtime-caches the team's outage-guidance
 * inventory (services, dependencies, incidents) from a JSON file. Rejects
 * invalid data outright instead of assessing on partial input. Does not
 * compute anything from the inventory.
 */
import { readFile, stat } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import {
  DEPENDENCY_KINDS,
  OUTAGE_VERDICTS,
  SERVICE_LAYERS,
  type OutageInventory,
} from './outage-guidance.types';

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
/** Upper bound of the performance guarantee (see the 200-node perf test). */
const MAX_SERVICES = 200;

/** Thrown when the inventory file does not exist. */
export class InventoryNotFoundError extends Error {
  constructor(public readonly path: string) {
    super(`Outage-guidance inventory not found: ${path}`);
    this.name = 'InventoryNotFoundError';
  }
}

/** Thrown when the inventory content is malformed; `issues` lists every problem found. */
export class InventoryValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid outage-guidance inventory: ${issues.slice(0, 3).join('; ')}`);
    this.name = 'InventoryValidationError';
  }
}

/**
 * Inventory path: RAPITAS_OUTAGE_GUIDANCE_FILE, else
 * `<RAPITAS_DATA_DIR | ~/.rapitas>/outage-guidance/inventory.json`
 * (same data-dir rule as config/logger.ts).
 *
 * @returns Absolute path of the inventory file / インベントリファイルのパス
 */
export function resolveInventoryPath(): string {
  const explicit = process.env.RAPITAS_OUTAGE_GUIDANCE_FILE;
  if (explicit && explicit.trim().length > 0) return explicit;
  const override = process.env.RAPITAS_DATA_DIR;
  const base = override && override.trim().length > 0 ? override : join(homedir(), '.rapitas');
  return join(base, 'outage-guidance', 'inventory.json');
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function oneOf(list: readonly string[], v: unknown): boolean {
  return typeof v === 'string' && list.includes(v);
}

function isPositiveNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

function validateServices(raw: unknown, issues: string[]): Set<string> {
  const ids = new Set<string>();
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_SERVICES) {
    issues.push(`services must be an array of 1-${MAX_SERVICES} entries`);
    return ids;
  }
  raw.forEach((s, i) => {
    const at = `services[${i}]`;
    if (!isRecord(s)) return void issues.push(`${at} must be an object`);
    if (typeof s.id !== 'string' || !ID_PATTERN.test(s.id)) {
      issues.push(`${at}: invalid service id ${JSON.stringify(s.id)}`);
    } else if (ids.has(s.id)) {
      issues.push(`${at}: duplicate service id "${s.id}"`);
    } else {
      ids.add(s.id);
    }
    if (typeof s.name !== 'string' || s.name.trim() === '') issues.push(`${at}: name is required`);
    if (!oneOf(SERVICE_LAYERS, s.layer)) issues.push(`${at}: invalid layer`);
    if (!isPositiveNumber(s.slaMinutes) || !Number.isInteger(s.slaMinutes)) {
      issues.push(`${at}: slaMinutes must be a positive integer`);
    }
    if (!isPositiveNumber(s.declaredRecoveryMinutes)) {
      issues.push(`${at}: declaredRecoveryMinutes must be positive`);
    }
  });
  return ids;
}

function validateDependencies(raw: unknown, ids: Set<string>, issues: string[]): void {
  if (!Array.isArray(raw)) return void issues.push('dependencies must be an array');
  raw.forEach((d, i) => {
    const at = `dependencies[${i}]`;
    if (!isRecord(d)) return void issues.push(`${at} must be an object`);
    for (const end of ['from', 'to'] as const) {
      if (typeof d[end] !== 'string' || !ids.has(d[end])) {
        issues.push(`${at}.${end}: unknown service "${String(d[end])}"`);
      }
    }
    if (d.from === d.to) issues.push(`${at}: self loop on "${String(d.from)}"`);
    if (!oneOf(DEPENDENCY_KINDS, d.kind)) issues.push(`${at}: invalid kind`);
  });
}

function validateIncidents(raw: unknown, ids: Set<string>, issues: string[]): void {
  if (!Array.isArray(raw)) return void issues.push('incidents must be an array');
  raw.forEach((inc, i) => {
    const at = `incidents[${i}]`;
    if (!isRecord(inc)) return void issues.push(`${at} must be an object`);
    if (typeof inc.id !== 'string' || inc.id.trim() === '') issues.push(`${at}: id is required`);
    if (typeof inc.targetServiceId !== 'string' || !ids.has(inc.targetServiceId)) {
      issues.push(`${at}.targetServiceId: unknown service "${String(inc.targetServiceId)}"`);
    }
    if (typeof inc.occurredAt !== 'string' || Number.isNaN(Date.parse(inc.occurredAt))) {
      issues.push(`${at}.occurredAt: invalid ISO 8601 date`);
    }
    const minutes = inc.actualRecoveryMinutes;
    if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes < 0) {
      issues.push(`${at}.actualRecoveryMinutes must be >= 0`);
    }
    if (!Array.isArray(inc.actualImpactedServiceIds)) {
      issues.push(`${at}.actualImpactedServiceIds must be an array`);
    } else {
      for (const id of inc.actualImpactedServiceIds) {
        if (typeof id !== 'string' || !ids.has(id)) {
          issues.push(`${at}.actualImpactedServiceIds: unknown service "${String(id)}"`);
        }
      }
    }
    if (inc.label !== undefined && !oneOf(OUTAGE_VERDICTS, inc.label)) {
      issues.push(`${at}.label: invalid label`);
    }
  });
}

/**
 * Validates raw parsed JSON as a version-1 inventory.
 *
 * @param raw - Parsed JSON / パース済みJSON
 * @returns The typed inventory / 型付きインベントリ
 * @throws {InventoryValidationError} With every issue found / 検出した全問題を含む
 */
export function validateInventory(raw: unknown): OutageInventory {
  const issues: string[] = [];
  if (!isRecord(raw)) throw new InventoryValidationError(['inventory must be a JSON object']);
  if (raw.version !== 1)
    issues.push(`unsupported version ${JSON.stringify(raw.version)} (expected 1)`);
  if (raw.team !== undefined && typeof raw.team !== 'string') issues.push('team must be a string');
  const ids = validateServices(raw.services, issues);
  validateDependencies(raw.dependencies, ids, issues);
  validateIncidents(raw.incidents, ids, issues);
  if (issues.length > 0) throw new InventoryValidationError(issues);
  return raw as unknown as OutageInventory;
}

const cache = new Map<string, { mtimeMs: number; inventory: OutageInventory }>();

/** Drops every cached inventory (tests and forced reloads). */
export function clearInventoryCache(): void {
  cache.clear();
}

/**
 * Loads the inventory, re-reading only when the file's mtime changed so file
 * IO stays out of the real-time assessment budget.
 *
 * @param path - File to load (defaults to resolveInventoryPath()) / 読み込むファイル
 * @returns Inventory and the resolved path / インベントリと解決済みパス
 * @throws {InventoryNotFoundError} When the file is missing / ファイルが無い場合
 * @throws {InventoryValidationError} When JSON or schema is invalid / 内容が不正な場合
 */
export async function loadInventory(
  path: string = resolveInventoryPath(),
): Promise<{ inventory: OutageInventory; path: string }> {
  let mtimeMs: number;
  try {
    mtimeMs = (await stat(path)).mtimeMs;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new InventoryNotFoundError(path);
    throw err;
  }
  const hit = cache.get(path);
  if (hit && hit.mtimeMs === mtimeMs) return { inventory: hit.inventory, path };

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new InventoryValidationError([`invalid JSON: ${err.message}`]);
    }
    throw err;
  }
  const inventory = validateInventory(parsed);
  cache.set(path, { mtimeMs, inventory });
  return { inventory, path };
}
