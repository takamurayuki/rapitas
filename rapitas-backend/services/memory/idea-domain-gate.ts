/**
 * idea-domain-gate
 *
 * Lexical domain-fit gate for AI-submitted ideas (#738). idea #5592 (a media-
 * conversion preset recommender) was attached to the ime-live-converter theme
 * and auto-promoted into task #602 with no matching code in that repository —
 * `submitIdea` resolves a theme without ever comparing the idea's content
 * against the theme's functional domain. This gate compares the idea text
 * against the theme's own material (name/description/repositoryUrl/
 * workingDirectory) using a character-bigram containment score — the same
 * primitive as theme-saturation.ts, chosen because embedding cosine measured
 * useless for Japanese near-duplicate/similarity detection here. Fail-open on
 * missing theme, thin material, or any Prisma error: this gate only flags a
 * mismatch for human triage, it never blocks idea storage. Not responsible for
 * applying the themeId=null reassignment (idea-box-service.ts does that).
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { charBigrams } from './theme-saturation';

const log = createLogger('memory:idea-domain-gate');

/** Minimum combined length of theme material before a verdict is attempted. */
const MIN_THEME_MATERIAL_LEN = (() => {
  const v = parseInt(process.env.RAPITAS_IDEA_DOMAIN_MIN_MATERIAL_LEN ?? '8', 10);
  return Number.isFinite(v) && v > 0 ? v : 8;
})();

/** Overlap score below which the idea is flagged as a domain mismatch. */
const DOMAIN_OVERLAP_MIN = (() => {
  const v = parseFloat(process.env.RAPITAS_IDEA_DOMAIN_OVERLAP_MIN ?? '0.12');
  return Number.isFinite(v) && v > 0 && v <= 1 ? v : 0.12;
})();

/** Whether the domain-fit gate is enabled (default ON; set 0/false/off to skip). */
export function isDomainGateEnabled(): boolean {
  const v = (process.env.RAPITAS_IDEA_DOMAIN_GATE || '').trim().toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'off';
}

/** Gate mode: 'log' only records the mismatch, 'enforce' also strips themeId. */
export function getDomainGateMode(): 'log' | 'enforce' {
  const v = (process.env.RAPITAS_IDEA_DOMAIN_GATE_MODE || '').trim().toLowerCase();
  return v === 'enforce' ? 'enforce' : 'log';
}

/**
 * Join a theme's non-empty descriptive fields into one material string used
 * as the domain-fit comparison target.
 *
 * @param theme - Theme fields relevant to its functional domain. / テーマのドメイン関連フィールド
 * @returns Space-joined material string (empty when all fields are blank). / 結合された判定材料
 */
export function buildThemeMaterial(theme: {
  name: string;
  description: string | null;
  repositoryUrl: string | null;
  workingDirectory: string | null;
}): string {
  return [theme.name, theme.description, theme.repositoryUrl, theme.workingDirectory]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .join(' ');
}

/**
 * Asymmetric containment score: how much of the theme material's character-
 * bigram vocabulary appears in the idea text. Containment (not symmetric
 * Jaccard) so a long idea body does not dilute the score against a short
 * theme material string.
 *
 * @param ideaText - Idea title+content. / アイデア本文
 * @param themeMaterial - Theme's joined material string. / テーマ判定材料
 * @returns Overlap ratio in [0, 1]; 1 when the theme material has no bigrams. / 重複率
 */
export function domainOverlapScore(ideaText: string, themeMaterial: string): number {
  const themeGrams = charBigrams(themeMaterial);
  if (themeGrams.size === 0) return 1;
  const ideaGrams = charBigrams(ideaText);
  let inter = 0;
  for (const g of themeGrams) if (ideaGrams.has(g)) inter += 1;
  return inter / themeGrams.size;
}

export interface DomainGateResult {
  mismatch: boolean;
  score: number;
  reason: string;
}

/**
 * Evaluate whether an AI-submitted idea's content lexically fits its resolved
 * theme's functional domain. Fail-open (mismatch:false) when the theme is
 * missing, its material is too thin to judge, or the lookup throws.
 *
 * @param input - Candidate idea text and its resolved theme id. / 候補アイデアと解決済みテーマID
 * @returns Mismatch verdict, overlap score, and a human-readable reason. / 判定結果
 */
export async function evaluateIdeaDomainFit(input: {
  title: string;
  content: string;
  themeId: number;
}): Promise<DomainGateResult> {
  try {
    const theme = await prisma.theme.findFirst({
      where: { id: input.themeId },
      select: { name: true, description: true, repositoryUrl: true, workingDirectory: true },
    });
    if (!theme) {
      return { mismatch: false, score: 1, reason: 'テーマ未検出' };
    }

    const themeMaterial = buildThemeMaterial(theme);
    if (themeMaterial.length < MIN_THEME_MATERIAL_LEN) {
      return { mismatch: false, score: 1, reason: '判定材料不足' };
    }

    const score = domainOverlapScore(`${input.title} ${input.content}`, themeMaterial);
    if (score < DOMAIN_OVERLAP_MIN) {
      return { mismatch: true, score, reason: `語彙オーバーラップ不足（${score.toFixed(3)}）` };
    }
    return { mismatch: false, score, reason: '語彙オーバーラップ十分' };
  } catch (err) {
    log.warn({ err, themeId: input.themeId }, '[idea-domain-gate] Evaluation failed (fail-open)');
    return { mismatch: false, score: 1, reason: '判定エラー（フェイルオープン）' };
  }
}
