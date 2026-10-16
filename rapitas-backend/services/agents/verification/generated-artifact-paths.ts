/**
 * generated-artifact-paths
 *
 * Which changed paths are build artifacts rather than hand-written code, and
 * why. Owns only that classification — it runs no generator and checks no
 * drift (generated-sync-check.ts does that).
 *
 * Why the jury needs this. Task 1107 was failed for scope drift on "本タスクと
 * 無関係な既存キー" inside rapitas-frontend/messages/{en,ja}.json. Nobody edits
 * those by hand: generate-messages.mjs emits them from messages/fragments/ on
 * every predev/pretest/prebuild, so unrelated keys moving is the generator
 * running, not the agent widening its scope. The diff handed to the jury carried
 * no marking, so the only reading available to it was scope creep.
 *
 * Every entry was confirmed against the generator that writes it. Marking a
 * HAND-WRITTEN file as generated is the dangerous direction — it would tell the
 * jury to excuse real scope creep — so this list stays conservative and names
 * its evidence.
 */

/** One generated-path rule: how to recognise it, and why it is generated. */
interface GeneratedRule {
  test: (posixPath: string) => boolean;
  reason: string;
}

const RULES: GeneratedRule[] = [
  {
    // scripts/generate-messages.mjs (predev / pretest / prebuild)
    test: (p) => /(^|\/)rapitas-frontend\/messages\/(ja|en)\.json$/.test(p),
    reason: 'messages/fragments/ から generate-messages.mjs が生成',
  },
  {
    // db:prepare:sqlite regenerates this from prisma/schema/
    test: (p) => p.includes('/prisma/schema.desktop/') || p.startsWith('prisma/schema.desktop/'),
    reason: 'prisma/schema/ から db:prepare:sqlite が生成',
  },
  {
    test: (p) => /(^|\/)src\/generated\//.test(p),
    reason: 'src/generated/ 配下はコード生成の出力',
  },
  {
    // gen-type-guards.ts and gen-boundary-guide.ts both use this convention.
    test: (p) => /\.generated\.[A-Za-z0-9]+$/.test(p),
    reason: '`.generated.` 命名のコード生成出力',
  },
  {
    // scripts/generate-route-barrels.cjs writes routes/<domain>/index.ts —
    // exactly one level under routes/, so nested index.ts files are hand-written.
    test: (p) => /(^|\/)rapitas-backend\/routes\/[^/]+\/index\.ts$/.test(p),
    reason: 'generate-route-barrels.cjs が生成するドメインバレル',
  },
];

/** Normalise to forward slashes so Windows diff paths match the rules. */
const toPosix = (p: string): string => p.replace(/\\/g, '/');

/**
 * Whether a changed path is a generated build artifact.
 *
 * @param path - Repo-relative path, either separator style. / 変更パス
 * @returns true when a generator owns the file. / 生成物なら true
 */
export function isGeneratedArtifact(path: string): boolean {
  const p = toPosix(path);
  return RULES.some((r) => r.test(p));
}

/**
 * Why a path is generated, for the explanation shown to the jury.
 *
 * @param path - Repo-relative path, either separator style. / 変更パス
 * @returns The reason, or null when the file is hand-written. / 理由（手書きなら null）
 */
export function generatedArtifactReason(path: string): string | null {
  const p = toPosix(path);
  return RULES.find((r) => r.test(p))?.reason ?? null;
}
