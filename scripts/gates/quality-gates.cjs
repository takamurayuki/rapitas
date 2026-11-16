#!/usr/bin/env node
/**
 * quality-gates
 *
 * CLI over .github/quality-gates.json, the one definition of which CI checks
 * gate a merge (#1410). `--check` proves every name in it is a check a
 * workflow really reports and that each mode is honest; `--print-protection`
 * prints the branch-protection body generated from it. NOT responsible for
 * applying branch protection — it never calls the GitHub API; a maintainer
 * pipes the payload into `gh api` deliberately.
 *
 * Exists because on 2026-10-16 `main` required four job names that no longer
 * existed: GitHub treats an unreported required context as pending, so every
 * PR was BLOCKED, and the in-app auto-merge kept a second, different list.
 *
 * Usage:
 *   node scripts/gates/quality-gates.cjs --check [--gates <file>] [--workflows <dir>] [--today YYYY-MM-DD]
 *   node scripts/gates/quality-gates.cjs --print-protection <branch> [--strict] [--enforce-admins] [--gates <file>]
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseYaml } = require('./workflow-yaml.cjs');
const { checkGates, protectionPayload, validateSchema } = require('./gates-model.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_GATES = path.join(ROOT, '.github', 'quality-gates.json');
const DEFAULT_WORKFLOWS = path.join(ROOT, '.github', 'workflows');

function parseArgs(argv) {
  const opts = {
    strict: false,
    enforceAdmins: false,
    gates: DEFAULT_GATES,
    workflows: DEFAULT_WORKFLOWS,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--check') opts.command = 'check';
    else if (arg === '--print-protection') {
      opts.command = 'protection';
      opts.branch = argv[++i];
    } else if (arg === '--strict') opts.strict = true;
    else if (arg === '--enforce-admins') opts.enforceAdmins = true;
    else if (arg === '--gates') opts.gates = path.resolve(argv[++i]);
    else if (arg === '--workflows') opts.workflows = path.resolve(argv[++i]);
    else if (arg === '--today') opts.today = argv[++i];
    else throw new Error(`unknown argument: ${arg}`);
  }
  return opts;
}

/**
 * Read every workflow file in a directory.
 *
 * @param {string} dir - .github/workflows directory / ワークフローディレクトリ
 * @returns {Record<string, object>} File name → parsed workflow / 解析済みワークフロー
 * @throws {Error} When a workflow cannot be parsed / 解析できない場合
 */
function loadWorkflows(dir) {
  const out = {};
  for (const file of fs.readdirSync(dir).sort()) {
    if (!/\.ya?ml$/.test(file)) continue;
    try {
      out[file] = parseYaml(fs.readFileSync(path.join(dir, file), 'utf8'));
    } catch (err) {
      throw new Error(`${file}: ${err.message}`);
    }
  }
  return out;
}

function run(argv) {
  const opts = parseArgs(argv);
  const gates = JSON.parse(fs.readFileSync(opts.gates, 'utf8'));

  if (opts.command === 'protection') {
    if (!opts.branch) throw new Error('--print-protection needs a branch name');
    const schemaErrors = validateSchema(gates);
    if (schemaErrors.length) throw new Error(schemaErrors.join('\n'));
    process.stdout.write(`${JSON.stringify(protectionPayload(gates, opts), null, 2)}\n`);
    process.stderr.write(
      `# Apply with: gh api -X PUT repos/<owner>/<repo>/branches/${opts.branch}/protection --input <this file>\n` +
        '# NOTE: PUT replaces the whole protection object (reviews/restrictions are set to null).\n',
    );
    return 0;
  }
  if (opts.command !== 'check') throw new Error('pass --check or --print-protection <branch>');

  const today = opts.today || new Date().toISOString().slice(0, 10);
  const { errors, warnings } = checkGates(gates, loadWorkflows(opts.workflows), { today });
  for (const w of warnings) console.log(`warning: ${w}`);
  if (errors.length) {
    console.error(
      `quality-gates: ${errors.length} problem(s) in ${opts.gates.startsWith(ROOT) ? path.relative(ROOT, opts.gates) : opts.gates}`,
    );
    for (const e of errors) console.error(`  - ${e}`);
    return 1;
  }
  const counts = { required: 0, conditional: 0, advisory: 0 };
  for (const c of gates.checks) counts[c.mode]++;
  console.log(
    `quality-gates: OK — ${gates.checks.length} checks (${counts.required} required, ` +
      `${counts.conditional} conditional, ${counts.advisory} advisory), every name reported by a workflow job`,
  );
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = run(process.argv.slice(2));
  } catch (err) {
    console.error(`quality-gates: ${err.message}`);
    process.exitCode = 1;
  }
}

module.exports = { run, loadWorkflows, parseArgs };
