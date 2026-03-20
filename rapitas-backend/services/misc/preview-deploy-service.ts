/**
 * PreviewDeployService
 *
 * Triggers preview deployments on Vercel/Netlify when PRs are created.
 * Checks deployment status and posts preview URLs back to PR comments.
 */
import { createLogger } from '../config/logger';
import { prisma } from '../config/database';

const log = createLogger('preview-deploy');

/** Deployment status for a PR. */
export type DeploymentStatus = {
  provider: 'vercel' | 'netlify' | 'none';
  status: 'pending' | 'building' | 'ready' | 'error' | 'skipped';
  previewUrl?: string;
  error?: string;
};

/**
 * Trigger a preview deployment for a PR and post the preview URL as a comment.
 *
 * @param workingDirectory - Repository root / リポジトリルート
 * @param prNumber - PR number / PR番号
 * @param branchName - Branch name / ブランチ名
 * @returns Deployment status / デプロイステータス
 */
export async function triggerPreviewDeploy(
  workingDirectory: string,
  prNumber: number,
  branchName: string,
): Promise<DeploymentStatus> {
  const settings = await prisma.userSettings.findFirst();
  // HACK(agent): Cast needed until prisma generate runs with new schema fields
  const settingsData = settings as Record<string, unknown> | null;

  const vercelToken = process.env.VERCEL_TOKEN;
  const netlifyToken = process.env.NETLIFY_AUTH_TOKEN;

  // NOTE: Try Vercel first, then Netlify. If neither is configured, check gh deployments.
  if (vercelToken) {
    return await triggerVercelDeploy(workingDirectory, prNumber, branchName, vercelToken);
  }

  if (netlifyToken) {
    return await triggerNetlifyDeploy(workingDirectory, prNumber, branchName, netlifyToken);
  }

  // Fallback: check if GitHub has automatic preview deployments configured
  return await checkGitHubDeployments(workingDirectory, prNumber);
}

/**
 * Check GitHub deployment status for a PR (works with any CI/CD provider).
 *
 * @param workingDirectory - Repository root / リポジトリルート
 * @param prNumber - PR number / PR番号
 * @returns Deployment status from GitHub / GitHubからのデプロイステータス
 */
async function checkGitHubDeployments(
  workingDirectory: string,
  prNumber: number,
): Promise<DeploymentStatus> {
  try {
    const { execSync } = await import('child_process');
    const ghPath =
      process.platform === 'win32' ? '"C:\\Program Files\\GitHub CLI\\gh.exe"' : 'gh';

    // NOTE: Check PR checks for deployment URLs (works with Vercel, Netlify, etc.)
    const checksJson = execSync(
      `${ghPath} pr checks ${prNumber} --json name,state,link`,
      { cwd: workingDirectory, encoding: 'utf8', timeout: 15000 },
    );

    const checks = JSON.parse(checksJson) as Array<{
      name: string;
      state: string;
      link: string;
    }>;

    // Look for deployment-related checks
    const deployCheck = checks.find(
      (c) =>
        c.name.toLowerCase().includes('deploy') ||
        c.name.toLowerCase().includes('preview') ||
        c.name.toLowerCase().includes('vercel') ||
        c.name.toLowerCase().includes('netlify'),
    );

    if (!deployCheck) {
      return { provider: 'none', status: 'skipped' };
    }

    const status =
      deployCheck.state === 'SUCCESS'
        ? 'ready'
        : deployCheck.state === 'PENDING'
          ? 'building'
          : 'pending';

    return {
      provider: deployCheck.name.toLowerCase().includes('vercel') ? 'vercel' : 'netlify',
      status,
      previewUrl: deployCheck.link || undefined,
    };
  } catch (error) {
    log.debug({ err: error }, '[PreviewDeploy] No GitHub deployment checks found');
    return { provider: 'none', status: 'skipped' };
  }
}

/**
 * Trigger Vercel deployment via API.
 */
async function triggerVercelDeploy(
  workingDirectory: string,
  prNumber: number,
  branchName: string,
  token: string,
): Promise<DeploymentStatus> {
  try {
    // NOTE: Vercel auto-deploys on push if GitHub integration is configured.
    // We poll for the deployment status rather than triggering manually.
    const { execSync } = await import('child_process');
    const ghPath =
      process.platform === 'win32' ? '"C:\\Program Files\\GitHub CLI\\gh.exe"' : 'gh';

    // Wait briefly for Vercel to pick up the push
    await new Promise((r) => setTimeout(r, 5000));

    const result = await checkGitHubDeployments(workingDirectory, prNumber);

    if (result.status !== 'skipped' && result.previewUrl) {
      await postDeploymentComment(workingDirectory, prNumber, result);
    }

    return result.status !== 'skipped' ? result : { provider: 'vercel', status: 'pending' };
  } catch (error) {
    log.error({ err: error }, '[PreviewDeploy] Vercel deploy check failed');
    return { provider: 'vercel', status: 'error', error: String(error) };
  }
}

/**
 * Trigger Netlify deployment via API.
 */
async function triggerNetlifyDeploy(
  workingDirectory: string,
  prNumber: number,
  branchName: string,
  token: string,
): Promise<DeploymentStatus> {
  try {
    // NOTE: Similar to Vercel — Netlify auto-deploys from GitHub.
    // Poll for deployment status via GitHub checks.
    await new Promise((r) => setTimeout(r, 5000));

    const result = await checkGitHubDeployments(workingDirectory, prNumber);

    if (result.status !== 'skipped' && result.previewUrl) {
      await postDeploymentComment(workingDirectory, prNumber, result);
    }

    return result.status !== 'skipped' ? result : { provider: 'netlify', status: 'pending' };
  } catch (error) {
    log.error({ err: error }, '[PreviewDeploy] Netlify deploy check failed');
    return { provider: 'netlify', status: 'error', error: String(error) };
  }
}

/**
 * Post a preview deployment URL as a PR comment.
 *
 * @param workingDirectory - Repository root / リポジトリルート
 * @param prNumber - PR number / PR番号
 * @param deployment - Deployment status / デプロイステータス
 */
async function postDeploymentComment(
  workingDirectory: string,
  prNumber: number,
  deployment: DeploymentStatus,
): Promise<void> {
  if (!deployment.previewUrl) return;

  try {
    const { execSync } = await import('child_process');
    const ghPath =
      process.platform === 'win32' ? '"C:\\Program Files\\GitHub CLI\\gh.exe"' : 'gh';

    const body = `🚀 **Preview Deploy** (${deployment.provider})\n\n` +
      `Status: ${deployment.status}\n` +
      `Preview: ${deployment.previewUrl}\n\n` +
      `---\n🤖 Posted by Rapitas`;

    execSync(
      `${ghPath} pr comment ${prNumber} --body "${body.replace(/"/g, '\\"')}"`,
      { cwd: workingDirectory, encoding: 'utf8', timeout: 15000 },
    );

    log.info(`[PreviewDeploy] Posted preview URL for PR #${prNumber}: ${deployment.previewUrl}`);
  } catch (error) {
    log.warn({ err: error }, '[PreviewDeploy] Failed to post deployment comment');
  }
}

/**
 * Poll for deployment status (call after PR creation, runs in background).
 *
 * @param workingDirectory - Repository root / リポジトリルート
 * @param prNumber - PR number / PR番号
 * @param maxAttempts - Max polling attempts / 最大ポーリング回数
 * @param intervalMs - Polling interval in ms / ポーリング間隔（ms）
 */
export async function pollDeploymentStatus(
  workingDirectory: string,
  prNumber: number,
  maxAttempts: number = 12,
  intervalMs: number = 10000,
): Promise<DeploymentStatus> {
  for (let i = 0; i < maxAttempts; i++) {
    const status = await checkGitHubDeployments(workingDirectory, prNumber);

    if (status.status === 'ready' || status.status === 'error') {
      if (status.previewUrl) {
        await postDeploymentComment(workingDirectory, prNumber, status);
      }
      return status;
    }

    if (status.status === 'skipped') return status;

    await new Promise((r) => setTimeout(r, intervalMs));
  }

  return { provider: 'none', status: 'pending' };
}
