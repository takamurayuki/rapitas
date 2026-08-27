/**
 * panel-types
 *
 * Shared metadata type for agents-page panel auto-registration.
 * Not responsible for the registry itself (see panels.generated.tsx).
 */

/**
 * Registration metadata a panel component exports alongside its component
 * function so scripts/generate-agents-panels.mjs can discover and order it.
 */
export type PanelMeta = {
  /** Unique panel identifier, used for React key and duplicate detection. */
  id: string;
  /** Sort key; lower renders first. Ties break by `id` ascending. */
  order: number;
};
