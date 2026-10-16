/**
 * correlation-engine
 *
 * Pure statistical functions for the test-failure correlation matrix: Pearson
 * correlation between "file X changed" and "test Y failed" indicator vectors,
 * a two-tailed p-value via the exact Student's t distribution (regularized
 * incomplete beta function — no external stats library, per plan.md's
 * decision to avoid a new dependency), and the resulting confidence label.
 * Contains no I/O — run history is passed in by the caller. Deliberately does
 * NOT import scripts/retry-policy.ts (services/ → scripts/ is a
 * layer-crossing import avoided elsewhere, e.g. ci-timing.ts) — the caller
 * passes in a precomputed per-file flake-rate map instead.
 */
import type { ConfidenceLevel, CorrelationCell, RunRecord } from './test-correlation.types';

/**
 * Computes the Pearson correlation coefficient between two equal-length
 * numeric vectors. Returns null when there are fewer than 2 samples or when
 * either vector has zero variance (division by zero would otherwise occur).
 *
 * @param x - First vector / 系列1
 * @param y - Second vector (same length as x) / 系列2
 * @returns Pearson r in [-1, 1], or null when undefined / ピアソン相関係数
 */
export function computePearson(x: number[], y: number[]): number | null {
  const n = x.length;
  if (n < 2 || y.length !== n) return null;

  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;

  let cov = 0;
  let varX = 0;
  let varY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    cov += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }

  if (varX === 0 || varY === 0) return null;
  return cov / Math.sqrt(varX * varY);
}

/**
 * Regularized incomplete beta function via a continued-fraction expansion
 * (Numerical Recipes' betacf/betai). Used to derive the exact two-tailed
 * Student's t p-value without a statistics dependency.
 *
 * @param x - Upper limit of integration, in [0, 1] / 積分上限
 * @param a - Shape parameter a / 形状パラメータ
 * @param b - Shape parameter b / 形状パラメータ
 * @returns I_x(a, b) / 正則化不完全ベータ関数値
 */
function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  const lnBeta = logGamma(a + b) - logGamma(a) - logGamma(b);
  const front = Math.exp(lnBeta + a * Math.log(x) + b * Math.log(1 - x));

  // NOTE: The continued fraction converges faster on the (0, (a+1)/(a+b+2)] side;
  // use the symmetry relation I_x(a,b) = 1 - I_{1-x}(b,a) otherwise.
  if (x < (a + 1) / (a + b + 2)) {
    return (front * betaContinuedFraction(x, a, b)) / a;
  }
  return 1 - (front * betaContinuedFraction(1 - x, b, a)) / b;
}

/** Lanczos approximation of ln(Gamma(z)) for z > 0. */
function logGamma(z: number): number {
  const g = 7;
  const coefficients = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  }
  const zAdj = z - 1;
  let x = coefficients[0];
  for (let i = 1; i < g + 2; i++) {
    x += coefficients[i] / (zAdj + i);
  }
  const t = zAdj + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (zAdj + 0.5) * Math.log(t) - t + Math.log(x);
}

/** Continued-fraction expansion used by incompleteBeta (Numerical Recipes betacf). */
function betaContinuedFraction(x: number, a: number, b: number): number {
  const maxIterations = 200;
  const epsilon = 3e-12;
  const fpMin = 1e-300;

  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < fpMin) d = fpMin;
  d = 1 / d;
  let h = d;

  for (let m = 1; m <= maxIterations; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < fpMin) d = fpMin;
    c = 1 + aa / c;
    if (Math.abs(c) < fpMin) c = fpMin;
    d = 1 / d;
    h *= d * c;

    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < fpMin) d = fpMin;
    c = 1 + aa / c;
    if (Math.abs(c) < fpMin) c = fpMin;
    d = 1 / d;
    const del = d * c;
    h *= del;

    if (Math.abs(del - 1) < epsilon) break;
  }

  return h;
}

/**
 * Two-tailed p-value for a Pearson correlation coefficient, via the exact
 * relationship between Student's t distribution and the regularized
 * incomplete beta function: p = I_{df/(df+t^2)}(df/2, 1/2).
 *
 * @param r - Pearson correlation coefficient / ピアソン相関係数
 * @param n - Sample size / サンプル数
 * @returns Two-tailed p-value in (0, 1], or null when n < 3 (df <= 0) or |r| === 1
 */
export function pValueForPearsonR(r: number, n: number): number | null {
  const df = n - 2;
  if (df <= 0) return null;
  if (Math.abs(r) >= 1) return 0;

  const t = (r * Math.sqrt(df)) / Math.sqrt(1 - r * r);
  const x = df / (df + t * t);
  return incompleteBeta(x, df / 2, 0.5);
}

/**
 * Labels a correlation cell's confidence based on sample size and
 * significance. A high |r| with too few samples is deliberately capped at
 * 'low' — see plan.md's "相関が高いがサンプル数が少ない" edge case.
 *
 * @param sampleSize - Number of runs contributing to the correlation / サンプル数
 * @param pValue - Two-tailed p-value, or null when correlation is undefined / p値
 * @returns Confidence label / 信頼度
 */
export function confidenceLevel(sampleSize: number, pValue: number | null): ConfidenceLevel {
  if (sampleSize < 5 || pValue === null) return 'low';
  if (pValue < 0.01 && sampleSize >= 10) return 'high';
  if (pValue < 0.05) return 'medium';
  return 'low';
}

/**
 * Builds the full changed-file × test-file correlation matrix from run
 * history. Each cell correlates a binary "file changed in this run" vector
 * against a binary "test failed in this run" vector, restricted to runs
 * where the test file actually executed (skipped runs are excluded from
 * that pair's sample).
 *
 * @param runs - Run records already filtered to the desired time window / 対象期間のラン一覧
 * @param options.flakeRates - Optional per-test-file flake rate map (from scripts/retry-policy.ts,
 *   computed by the caller) used to derive the nonDeterministic flag / ファイル別フレーク率
 * @returns Flattened list of correlation cells / 相関マトリックスのセル一覧
 */
export function buildCorrelationMatrix(
  runs: RunRecord[],
  options: { flakeRates?: Record<string, number> } = {},
): CorrelationCell[] {
  const changedFiles = new Set<string>();
  const testFiles = new Set<string>();
  for (const run of runs) {
    for (const f of run.changedFiles) changedFiles.add(f);
    for (const t of run.testResults) testFiles.add(t.file);
  }

  const cells: CorrelationCell[] = [];

  for (const changedFile of changedFiles) {
    for (const testFile of testFiles) {
      const x: number[] = [];
      const y: number[] = [];

      for (const run of runs) {
        const testResult = run.testResults.find((t) => t.file === testFile);
        if (!testResult || testResult.status === 'skip') continue;
        x.push(run.changedFiles.includes(changedFile) ? 1 : 0);
        y.push(testResult.status === 'fail' ? 1 : 0);
      }

      const sampleSize = x.length;
      const correlation = computePearson(x, y);
      const pValue = correlation === null ? null : pValueForPearsonR(correlation, sampleSize);
      const nonDeterministic = (options.flakeRates?.[testFile] ?? 0) > 0;

      cells.push({
        changedFile,
        testFile,
        correlation,
        pValue,
        sampleSize,
        confidence: confidenceLevel(sampleSize, pValue),
        nonDeterministic,
      });
    }
  }

  return cells;
}
