/**
 * integration-provisioning.test
 *
 * A generated project's PRs were invisible to auto-merge and ci_repair because
 * nothing ever created a `GitHubIntegration` row for it: integrations are only
 * created through the manual POST route, while `repo-bootstrap` creates the
 * GitHub repo without registering one. `resolveIntegrationId` then found no
 * match, `linkAutoCreatedPr` returned early, and the PR was never persisted —
 * so no watcher could see it.
 *
 * Measured 2026-10-11: six integrations exist (rapitas, tripla, trendline,
 * ui-catalog, ime-live-converter, fusen) and none for temporaid or contextflow,
 * the two newest generated projects. temporaid's PR #1 sat green and unmerged
 * with zero rows in GitHubPullRequest.
 *
 * The second defect is the fallback: with exactly one integration configured,
 * `resolveIntegrationId` returned it for ANY repository, which would file a
 * generated project's PR under the wrong repo — and `@@unique([integrationId,
 * prNumber])` means PR #1 of one project would then collide with PR #1 of
 * another.
 */
import { describe, expect, it, beforeEach } from 'bun:test';
import { pickIntegrationId, integrationCreateData } from './integration-provisioning';

const INTEGRATIONS = [
  { id: 1, ownerName: 'takamurayuki', repositoryName: 'rapitas' },
  { id: 2, ownerName: 'takamurayuki', repositoryName: 'tripla' },
  { id: 6, ownerName: 'takamurayuki', repositoryName: 'fusen' },
];

describe('pickIntegrationId', () => {
  it('matches on owner/repo regardless of case', () => {
    expect(pickIntegrationId(INTEGRATIONS, { owner: 'takamurayuki', repo: 'rapitas' })).toBe(1);
    expect(pickIntegrationId(INTEGRATIONS, { owner: 'TakamuraYuki', repo: 'FUSEN' })).toBe(6);
  });

  it('returns null for a repo with no integration, even when one exists', () => {
    // The measured defect: temporaid has no row, so it must NOT borrow another
    // project's integration — PR numbers would collide on the unique key.
    expect(
      pickIntegrationId(INTEGRATIONS, { owner: 'takamurayuki', repo: 'temporaid' }),
    ).toBeNull();
    expect(
      pickIntegrationId([INTEGRATIONS[0]], { owner: 'takamurayuki', repo: 'temporaid' }),
    ).toBeNull();
  });

  it('falls back to the only integration ONLY when the repo is unknown', () => {
    // A caller with no repositoryUrl and no git remote cannot be placed; with a
    // single integration configured that is still unambiguous.
    expect(pickIntegrationId([INTEGRATIONS[0]], null)).toBe(1);
    expect(pickIntegrationId(INTEGRATIONS, null)).toBeNull();
  });

  it('returns null when nothing is configured', () => {
    expect(pickIntegrationId([], { owner: 'takamurayuki', repo: 'rapitas' })).toBeNull();
    expect(pickIntegrationId([], null)).toBeNull();
  });
});

describe('integrationCreateData', () => {
  it('builds a row whose repositoryUrl matches the stored convention', () => {
    // Existing rows store https://github.com/<owner>/<repo>, and that column is
    // @unique — the upsert key depends on producing the same shape.
    expect(integrationCreateData({ owner: 'takamurayuki', repo: 'temporaid' })).toEqual({
      repositoryUrl: 'https://github.com/takamurayuki/temporaid',
      ownerName: 'takamurayuki',
      repositoryName: 'temporaid',
    });
  });

  it('does not invent credentials', () => {
    // accessTokenEnc is nullable; auto-provisioning must not fabricate a token.
    const data = integrationCreateData({ owner: 'o', repo: 'r' });
    expect('accessTokenEnc' in data).toBe(false);
    expect('webhookSecret' in data).toBe(false);
  });
});
