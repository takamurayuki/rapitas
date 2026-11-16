# CI/CD Setup Guide for Rapitas

This guide explains how to set up the CI/CD pipeline for the Rapitas project.

## Required GitHub Secrets

To enable the CI/CD pipeline, you need to configure the following secrets in your GitHub repository:

### 1. Code Signing (Optional but Recommended)

For production releases, it's recommended to sign your Tauri application:

- **`TAURI_SIGNING_PRIVATE_KEY`**: Your Tauri signing private key
- **`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`**: Password for the signing key

To generate signing keys:

```bash
cd rapitas-desktop
pnpm tauri signer generate
```

### 2. GitHub Token

The `GITHUB_TOKEN` is automatically provided by GitHub Actions and doesn't need manual configuration.

## Workflow Files

The CI/CD pipeline consists of several workflow files:

### 1. `tauri-build.yml`

- **Purpose**: Build Tauri applications for all platforms
- **Triggers**: Push to main branches, tags, PRs, manual dispatch
- **Outputs**: Platform-specific installers (exe via NSIS, msi, dmg, app, deb, rpm; AppImage is not built)
- **Platforms**: Windows, macOS (Intel & Apple Silicon), Linux

### 2. `test-lint.yml`

- **Purpose**: Run tests and linting checks
- **Triggers**: Push to `main` / `develop`, PRs into them
- **Jobs**:
  - `test-backend` — backend gate suite with PostgreSQL, coverage floor
  - `route-regression` — route wiring gate
  - `test-sqlite` — SQLite-compatible suite
  - `test-full-advisory`, `test-order-check` — advisory full suite / shuffled order
  - `check-frontend` — frontend type check and gate tests with coverage
  - `lint` — ESLint / Prettier
  - `rust-check`, `rust-check-windows` — Rust formatting and Clippy (Linux, Windows)
  - `frozen-install` — every lockfile installs with `--frozen-lockfile`

#### Test Baseline & Failure Policy

The test jobs in `test-lint.yml` follow a two-tier strategy:

| Tier | Jobs | Merge impact |
| ---- | ---- | ------------ |
| **required** | `test-backend`, `test-sqlite`, `lint`, `check-frontend`, `rust-check`, `rust-check-windows`, `route-regression`, `frozen-install` | Blocks merge on failure |
| **advisory** | `test-full-advisory`, `test-order-check` | Visible in Step Summary; does **not** block merge |

The tiers above are an excerpt. The single definition of which checks gate a
merge — across every workflow — is [`.github/quality-gates.json`](quality-gates.json);
see "Branch Protection" below.

Backend gates are declared in `rapitas-backend/scripts/ci-gates.ts`; each gate's
file list is a manifest next to it (`ci-gate-tests.txt`, `route-regression-tests.txt`,
`sqlite-compat-tests.txt`). Do not edit the file lists inline in the YAML.

For full details on failure tiers, retrigger policy, coverage thresholds, and the gate
escalation path, see **[TESTING_POLICY.md](TESTING_POLICY.md)**.

### 3. `security-scan.yml`

- **Purpose**: Security vulnerability scanning
- **Triggers**: Push to main branches, PRs, weekly schedule
- **Scans**:
  - Trivy for general vulnerabilities
  - cargo-audit for Rust dependencies
  - pnpm audit (frontend, desktop) and bun audit (backend) for JavaScript dependencies
  - CodeQL for code-level security issues

### 4. `pr-preview.yml`

- **Purpose**: Quick build checks for PRs
- **Triggers**: Pull requests with code changes
- **Features**: Posts build status as PR comment

### 5. `update-releases.yml`

- **Purpose**: Generate update metadata for Tauri auto-updater
- **Triggers**: Release events, manual dispatch
- **Output**: `update.json` file for Tauri updater

### 6. Quality evals (`bun run eval:gates` / `bun run eval:judge`)

Two "measure the AI, don't just trust it" scripts live in `rapitas-backend/scripts/`:

| Script | CI status | Why |
| ------ | --------- | --- |
| `eval-gates.ts` (`bun run eval:gates`) | **Wired into `test-lint.yml`** (`test-backend` job) | Deterministic — scores the workflow quality-gate LOGIC (plan-scope, phase validators, the adversarial-judge reply *parser*) against a golden set with no live API calls. Safe to hard-gate. |
| `eval-judge.ts` (`bun run eval:judge`) | **Not scheduled in CI** — local/manual only | Measures the adversarial diff-review **judge model's** end-to-end accuracy (does it return the right verdict on a labelled diff→verdict set). This makes real LLM calls, so it needs live credentials. The repo's Actions runners have no `CLAUDE_API_KEY`/equivalent secret provisioned, and the CLI-based auxiliary-AI path (the app's default, subscription-billed) needs an interactive `claude login` that a hosted runner can't perform — so there's no way to run it unattended today. |

To run `eval:judge` locally:

```bash
cd rapitas-backend
RAPITAS_EVAL_JUDGE=1 bun run eval:judge
# optional: RAPITAS_EVAL_JUDGE_PROVIDER=claude|gemini|chatgpt (default claude)
# optional: RAPITAS_EVAL_JUDGE_MIN=0.8 (accuracy threshold, default 0.8)
```

Without `RAPITAS_EVAL_JUDGE=1` it prints a skip notice and exits 0, so it is
safe to leave un-set — it will never fail an unconfigured environment.
If a `CLAUDE_API_KEY` (or provider-equivalent) secret is ever provisioned for
Actions, this could be added as its own `continue-on-error: true` advisory job
(same pattern as `test-full-advisory` in `test-lint.yml`) rather than a
hard-gate, since live-LLM output is inherently non-deterministic.

## Setting Up the Pipeline

1. **Enable GitHub Actions**:
   - Go to Settings → Actions → General
   - Select "Allow all actions and reusable workflows"

2. **Configure Secrets**:
   - Go to Settings → Secrets and variables → Actions
   - Add the required secrets mentioned above

3. **Create Release Tags**:

   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```

4. **Monitor Builds**:
   - Check the Actions tab in your GitHub repository
   - Review build logs for any issues

## Build Artifacts

Build artifacts are automatically uploaded for each platform:

- **Windows**: `.exe` (NSIS installer) and `.msi` files
- **macOS**: `.dmg` files and `.app` bundles
- **Linux**: `.deb` and `.rpm` files (`--bundles deb,rpm`)

## Auto-Update Configuration

The Tauri auto-updater is configured to check for updates using the `update.json` file generated during releases.

To enable auto-updates in your application:

1. Ensure the `update-releases.yml` workflow runs on releases
2. Configure the updater endpoint in your Tauri configuration
3. Implement update checking in your application code

## CI Build Configuration

The CI/CD pipeline uses a special configuration to avoid database dependencies and development server requirements:

### CI-Specific Configuration Files

1. **tauri.build.conf.json**: The release configuration that `pnpm run build`
   passes with `-c src-tauri/tauri.build.conf.json` (CI runs the same script).
   It:
   - Skips `beforeDevCommand` and `beforeBuildCommand`, so no development servers start
   - Uses the pre-built frontend from the `public` directory
   - Bundles the compiled backend from `src-tauri/binaries/` as a resource

   `tauri.ci.conf.json` still exists, but only the version sync tooling
   (`scripts/sync-version.cjs`, `version-check.yml`) touches it.

2. **ci-build.js**: A CI-specific build preparation script that:
   - Copies frontend build output to the desktop public directory
   - Prepares the environment for Tauri build without starting servers
   - Skips database synchronization and Prisma generation

### Database Dependencies in CI

The CI/CD pipeline does NOT require PostgreSQL to be running because:

- The build configuration (`tauri.build.conf.json`) empties `beforeDevCommand` and `beforeBuildCommand`, so dev.js never runs
- Frontend and backend are built independently
- No database operations are performed during the build process

If you see PostgreSQL connection errors in CI, ensure:

1. The build is using `-c src-tauri/tauri.build.conf.json` (via `pnpm run build`)
2. The `ci:prepare` script is run instead of the regular dev script

## Troubleshooting

### Bun Lockfile Issues

If you encounter `Unknown lockfile version` errors:

1. **Root Cause**: The lockfile was written by a different Bun version. CI installs the
   version pinned in `.github/toolchain.json` (checked by `rapitas-backend/scripts/check-toolchain-drift.ts`)
   and every install uses `bun install --frozen-lockfile`, so a lockfile the pinned Bun would
   rewrite fails CI instead of being silently updated.
2. **Local Fix**: Install the pinned Bun version, then regenerate and commit the lockfile in
   the main checkout (never inside a git worktree):

   ```bash
   cd rapitas-backend
   bun install
   ```

3. **Check**: The `fix-bun-lock.yml` workflow runs `bun install --frozen-lockfile` and reports
   a mismatch for a human to resolve; it does not rewrite the lockfile.

### pnpm Lockfile Issues

If you encounter `pnpm-lock.yaml is not up to date` errors:

1. **Root Cause**: New dependencies were added to package.json but the lockfile wasn't updated.
   CI installs with `pnpm install --frozen-lockfile` (pnpm version pinned in
   `.github/toolchain.json`), so the stale lockfile fails the job.
2. **Local Fix**: To update the lockfile locally (main checkout, not a worktree):

   ```bash
   cd rapitas-frontend  # or rapitas-desktop
   pnpm install
   git add pnpm-lock.yaml
   git commit -m "fix: update pnpm lockfile"
   ```

3. **Prevention**: Always commit lockfile changes when adding/updating dependencies

### Build Failures

1. **Dependency Issues**: Ensure all lock files are committed
2. **Rust Compilation**: Check target compatibility
3. **System Dependencies**: Review platform-specific requirements
4. **Backend Build Path**: The backend entry point is `rapitas-backend/index.ts`, not `src/index.ts`
   - If you see `FileNotFound opening root directory "src"`, update build commands to use `index.ts`
   - Example: `bun build index.ts --compile --outfile rapitas-backend`
5. **Turbopack Import Issues**: If you encounter "Module not found" errors during CI builds:
   - **Symptom**: Error like `Module not found: Can't resolve './Toast'`
   - **Cause**: Turbopack sometimes has issues with relative imports in CI environments
   - **Solution**: Turbopack is disabled in CI builds (`NEXT_TURBO=0` in the workflow env)
   - **Note**: Local development still uses Turbopack for faster builds

### Security Scan Issues

1. **High Severity Vulnerabilities**: Update affected dependencies
2. **False Positives**: Add exceptions with justification
3. **Audit Failures**: Review and update dependencies regularly

## Best Practices

1. **Version Tagging**: Use semantic versioning (e.g., v1.0.0)
2. **Branch Protection**: Required status checks come from
   [`.github/quality-gates.json`](quality-gates.json) (#1410), the same file the
   in-app auto-merge reads (`required` + `conditional` entries). Only `required`
   entries — checks that run on every PR — go into branch protection: on
   2026-10-16 `main` required four job names that no longer existed, and GitHub
   holds an unreported required context at pending, so every PR was BLOCKED.
   `node scripts/gates/quality-gates.cjs --check` (CI, `rust-check` job) fails
   when a name matches no job, a required check is path-filtered,
   `continue-on-error` or `if:`-gated, an advisory entry is past its `expires`
   date, or a PR job is unclassified. Generate the protection body with
   `node scripts/gates/quality-gates.cjs --print-protection develop > protection.json`
   (add `--strict` / `--enforce-admins` to match the branch's current settings),
   then apply it with `gh api -X PUT repos/<owner>/<repo>/branches/develop/protection --input protection.json`.
   PUT replaces the whole protection object, so re-add any review rules.
3. **Regular Updates**: Keep dependencies and tools updated
4. **Security First**: Address security issues promptly
5. **Cache Usage**: Leverage caching for faster builds

## Support

For CI/CD issues:

1. Check workflow logs in the Actions tab
2. Review this documentation
3. Open an issue with relevant logs and context
