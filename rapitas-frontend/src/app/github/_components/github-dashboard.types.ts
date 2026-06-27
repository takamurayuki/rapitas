/**
 * github-dashboard.types
 *
 * Shared types for the GitHub integration overview page and its sub-components.
 * Holds only view-model shapes specific to this page; entity types live in `@/types`.
 */

/** Result of `GET /github/status` — whether the gh CLI is usable. */
export interface GitHubCliStatus {
  ghAvailable: boolean;
  authenticated: boolean;
}

/** A repository surfaced by `gh repo list`, with whether it is already integrated. */
export interface AvailableRepo {
  nameWithOwner: string;
  name: string;
  owner: string;
  url: string;
  description: string;
  visibility: string;
  alreadyAdded: boolean;
}
