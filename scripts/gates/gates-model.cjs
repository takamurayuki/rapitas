/**
 * gates-model
 *
 * Pure logic behind scripts/gates/quality-gates.cjs: resolves the check-run
 * names a workflow job reports (matrix expansion included) and validates
 * .github/quality-gates.json against the workflows. NOT responsible for file
 * IO or the CLI — the caller passes parsed workflows in, so tests need no disk.
 */
'use strict';

const MODES = new Set(['required', 'conditional', 'advisory']);
const PR_EVENTS = ['pull_request', 'pull_request_target'];
const MATRIX_REF = /\$\{\{\s*matrix\.([A-Za-z0-9_-]+)\s*\}\}/g;

/**
 * Expand a strategy.matrix into its combinations, following GitHub's
 * include/exclude rules. Returns null when the matrix is an expression
 * (e.g. `${{ fromJSON(...) }}`) that cannot be expanded statically.
 *
 * @param {unknown} matrix - strategy.matrix value / matrix 定義
 * @returns {Array<Record<string, unknown>> | null} Combinations / 組み合わせ
 */
function expandMatrix(matrix) {
  if (!matrix || typeof matrix !== 'object' || Array.isArray(matrix)) return null;
  const baseKeys = Object.keys(matrix).filter((k) => k !== 'include' && k !== 'exclude');
  if (baseKeys.some((k) => !Array.isArray(matrix[k]))) return null;
  let combos = baseKeys.length === 0 ? [] : [{}];
  for (const key of baseKeys) {
    combos = combos.flatMap((c) => matrix[key].map((v) => ({ ...c, [key]: v })));
  }
  const excludes = Array.isArray(matrix.exclude) ? matrix.exclude : [];
  combos = combos.filter(
    (c) => !excludes.some((ex) => Object.keys(ex).every((k) => c[k] === ex[k])),
  );
  const originals = combos.length;
  for (const inc of Array.isArray(matrix.include) ? matrix.include : []) {
    let matched = false;
    // An include extends every original combination it does not contradict;
    // otherwise it becomes a combination of its own.
    for (let i = 0; i < originals; i++) {
      if (baseKeys.every((k) => !(k in inc) || inc[k] === combos[i][k])) {
        Object.assign(combos[i], inc);
        matched = true;
      }
    }
    if (!matched) combos.push({ ...inc });
  }
  return combos;
}

/**
 * The check-run names one job reports on a PR.
 *
 * @param {string} jobKey - Key under `jobs:` / ジョブキー
 * @param {Record<string, unknown>} job - Parsed job / ジョブ定義
 * @returns {string[]} Distinct reported names / 報告されるチェック名
 */
function reportedNames(jobKey, job) {
  const base = typeof job.name === 'string' ? job.name : jobKey;
  const matrix = job.strategy && job.strategy.matrix;
  if (!matrix) return [base];
  const combos = expandMatrix(matrix);
  if (!combos || combos.length === 0) return [base];
  const names = combos.map((combo) => {
    if (/\$\{\{\s*matrix\./.test(base)) {
      return base.replace(MATRIX_REF, (_, key) => (key in combo ? String(combo[key]) : ''));
    }
    // GitHub appends the combination's values when the name has no matrix expression.
    return `${base} (${Object.values(combo).map(String).join(', ')})`;
  });
  return [...new Set(names)];
}

/** The workflow's pull_request trigger config: undefined = no PR trigger, {} = unfiltered. */
function prTrigger(workflow) {
  const on = workflow && workflow.on;
  if (typeof on === 'string') return PR_EVENTS.includes(on) ? {} : undefined;
  if (Array.isArray(on)) return on.some((e) => PR_EVENTS.includes(e)) ? {} : undefined;
  if (!on || typeof on !== 'object') return undefined;
  for (const event of PR_EVENTS) {
    if (event in on) return on[event] && typeof on[event] === 'object' ? on[event] : {};
  }
  return undefined;
}

function globMatches(pattern, value) {
  const re = String(pattern)
    .replace(/[.+^$()|\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '.*');
  return new RegExp(`^${re}$`).test(value);
}

function isValidDate(text) {
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(`${text}T00:00:00Z`));
}

/** Schema problems in the gates file itself. */
function validateSchema(gates) {
  const errors = [];
  if (!gates || !Array.isArray(gates.checks)) return ['gates file has no "checks" array'];
  const seen = new Set();
  gates.checks.forEach((c, i) => {
    const where = `checks[${i}]${c && c.name ? ` "${c.name}"` : ''}`;
    for (const field of ['name', 'workflow', 'job', 'reason']) {
      if (!c || typeof c[field] !== 'string' || c[field].trim() === '') {
        errors.push(`${where}: "${field}" must be a non-empty string`);
      }
    }
    if (!c || !MODES.has(c.mode))
      errors.push(`${where}: "mode" must be required|conditional|advisory`);
    if (c && c.expires !== undefined) {
      if (c.mode !== 'advisory')
        errors.push(`${where}: "expires" is only meaningful on advisory entries`);
      else if (!isValidDate(c.expires)) errors.push(`${where}: "expires" must be YYYY-MM-DD`);
    }
    if (c && typeof c.name === 'string') {
      if (seen.has(c.name)) errors.push(`${where}: duplicate name`);
      seen.add(c.name);
    }
  });
  return errors;
}

/**
 * Validate the gates file against the parsed workflows.
 *
 * @param {object} gates - Parsed .github/quality-gates.json / ゲート定義
 * @param {Record<string, object>} workflows - File name → parsed workflow / ワークフロー
 * @param {{ today: string }} options - today as YYYY-MM-DD / 基準日
 * @returns {{ errors: string[], warnings: string[] }} Findings / 検出結果
 */
function checkGates(gates, workflows, options) {
  const errors = validateSchema(gates);
  const warnings = [];
  if (!Array.isArray(gates && gates.checks)) return { errors, warnings };
  const protectedBranches = gates.protectedBranches || ['main', 'develop'];

  for (const entry of gates.checks) {
    const label = `"${entry.name}" (${entry.mode})`;
    const wf = workflows[entry.workflow];
    const job = wf && wf.jobs && wf.jobs[entry.job];
    if (!job) {
      const elsewhere = findJobsReporting(workflows, entry.name);
      errors.push(
        `${label}: no job "${entry.job}" in .github/workflows/${entry.workflow}` +
          (elsewhere.length
            ? ` (reported by ${elsewhere.join(', ')})`
            : ' and no job reports this name'),
      );
      continue;
    }
    const names = reportedNames(entry.job, job);
    if (!names.includes(entry.name)) {
      errors.push(
        `${label}: ${entry.workflow}#${entry.job} reports ${JSON.stringify(names)}, not this name`,
      );
      continue;
    }
    const coe = job['continue-on-error'];
    const hasCoe =
      coe === true || (typeof coe === 'string' && coe.trim() !== '' && coe !== 'false');
    if (entry.mode === 'required') {
      const trigger = prTrigger(wf);
      if (trigger === undefined)
        errors.push(`${label}: ${entry.workflow} does not run on pull_request`);
      else {
        for (const key of ['paths', 'paths-ignore']) {
          if (trigger[key])
            errors.push(
              `${label}: ${entry.workflow} has a pull_request "${key}" filter — it does not run on every PR, so it can only be conditional`,
            );
        }
        if (trigger.branches) {
          for (const b of protectedBranches) {
            if (!trigger.branches.some((p) => globMatches(p, b))) {
              errors.push(
                `${label}: ${entry.workflow} pull_request.branches does not include "${b}"`,
              );
            }
          }
        }
        if (trigger['branches-ignore'])
          errors.push(`${label}: ${entry.workflow} uses pull_request.branches-ignore`);
      }
      if (hasCoe)
        errors.push(`${label}: job "${entry.job}" is continue-on-error — it cannot block`);
      if (job.if !== undefined)
        errors.push(
          `${label}: job "${entry.job}" has a job-level if: — a skipped run never reports`,
        );
    } else if (entry.mode === 'conditional' && hasCoe) {
      warnings.push(
        `${label}: job "${entry.job}" is continue-on-error but the gates file says it blocks`,
      );
    } else if (entry.mode === 'advisory' && entry.expires && entry.expires < options.today) {
      errors.push(
        `${label}: expired on ${entry.expires} — promote it, or re-justify and push the date`,
      );
    }
  }

  const classified = new Set(gates.checks.map((c) => c.name));
  const always = new Set(gates.alwaysClassify || []);
  for (const [file, wf] of Object.entries(workflows)) {
    if (!always.has(file) && prTrigger(wf) === undefined) continue;
    for (const [key, job] of Object.entries((wf && wf.jobs) || {})) {
      for (const name of reportedNames(key, job || {})) {
        if (!classified.has(name)) {
          errors.push(
            `unclassified job: "${name}" (${file}#${key}) — add it to .github/quality-gates.json as required, conditional or advisory`,
          );
        }
      }
    }
  }
  return { errors, warnings };
}

function findJobsReporting(workflows, name) {
  const out = [];
  for (const [file, wf] of Object.entries(workflows)) {
    for (const [key, job] of Object.entries((wf && wf.jobs) || {})) {
      if (reportedNames(key, job || {}).includes(name)) out.push(`${file}#${key}`);
    }
  }
  return out;
}

/**
 * Build the body for `gh api -X PUT repos/<owner>/<repo>/branches/<branch>/protection`.
 *
 * @param {object} gates - Parsed gates file / ゲート定義
 * @param {{ strict: boolean, enforceAdmins: boolean }} settings - Protection flags / 保護設定
 * @returns {object} The PUT payload / PUT 用ペイロード
 */
function protectionPayload(gates, settings) {
  return {
    required_status_checks: {
      strict: settings.strict,
      contexts: gates.checks.filter((c) => c.mode === 'required').map((c) => c.name),
    },
    enforce_admins: settings.enforceAdmins,
    required_pull_request_reviews: null,
    restrictions: null,
  };
}

module.exports = {
  expandMatrix,
  reportedNames,
  prTrigger,
  checkGates,
  protectionPayload,
  validateSchema,
};
