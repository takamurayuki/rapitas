/**
 * gate-manifest-parser.ts
 *
 * Shared parser utilities for CI gate suite manifests (.txt files).
 * Centralises parseGateManifest so that all gate runners share a single implementation.
 * Not responsible for process lifecycle (exit / logging) — callers own that.
 */

import { existsSync } from 'fs';
import { resolve } from 'path';

/**
 * Parses a gate-suite manifest text into a list of test file paths.
 * Lines starting with '#' (after trim) and blank lines are ignored.
 * Each returned entry is trimmed.
 *
 * @param text - Raw manifest file content / マニフェストファイルの生テキスト
 * @returns Array of trimmed, non-empty, non-comment file path strings
 */
export function parseGateManifest(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

/**
 * Checks that each path in `files` exists on disk relative to `rootDir`.
 * Returns the paths that are missing; empty array means no drift detected.
 * Process exit is NOT called here — callers decide how to handle missing files.
 *
 * @param files - File paths to verify, relative to `rootDir` / `rootDir` 基準の相対パス
 * @param rootDir - Absolute directory from which `files` are resolved / 絶対ルートディレクトリ
 * @returns Array of paths absent from the filesystem (empty = all present)
 */
export function validateManifestFiles(files: string[], rootDir: string): string[] {
  return files.filter((f) => !existsSync(resolve(rootDir, f)));
}
