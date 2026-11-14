/**
 * pane-layering
 *
 * The stacking order of the panels that dock over the page, in one place.
 *
 * These lived as `z-[60]` / `z-[65]` / `z-[70]` literals in three different
 * components, each with a comment describing an ordering none of them could
 * enforce. The ordering is the thing that matters, so it is stated once and
 * pinned by `pane-layering.test.ts`.
 *
 * The header and dialogs are styled with Tailwind classes, which cannot import
 * from here; `HEADER_Z` and `MODAL_Z` mirror them so ラピ's place between the
 * two can be pinned.
 */

/**
 * The app header. Mirrors the `z-110` class on `<header>` in `header.tsx`,
 * which a Tailwind class cannot import; stated here so the ordering against
 * it can be pinned.
 */
export const HEADER_Z = 110;

/**
 * Dialogs. Mirrors `z-[120]` in `components/ui/modal/Modal.tsx`.
 */
export const MODAL_Z = 120;

/**
 * The integrated terminal, docked at the bottom or split beside the page.
 *
 * Page furniture: it dims along with everything else when the task detail
 * panel comes up as an overlay.
 */
export const TERMINAL_PANEL_Z = 60;

/**
 * The task detail panel's click-to-close overlay.
 *
 * Covers the whole viewport below the header, so anything meant to stay
 * usable while that panel is open has to sit above it.
 */
export const TASK_DETAIL_OVERLAY_Z = 65;

/**
 * The in-app link pane.
 *
 * Above the overlay, because it docks to the edge the task detail panel is
 * NOT on specifically so both can be used at once (#1065). Underneath, the
 * overlay swallowed every click meant for the pane: pressing the pane's ✕
 * closed the task detail instead, and the pane then jumped from the left
 * edge to the right.
 */
export const LINK_PANE_Z = 66;

/**
 * The task detail panel itself.
 *
 * Highest: if it ever does overlap another panel, it is the one that must
 * stay reachable.
 */
export const TASK_DETAIL_PANEL_Z = 70;

/**
 * ラピ, the resident avatar in the bottom-right corner.
 *
 * Above the task detail panel, which is the one exception to that panel being
 * highest. She is reachable from every screen by design, and the task panel
 * docks to the corner she lives in: underneath it she was simply gone
 * whenever a task was open as a side panel, which is most of the time. Being
 * covered by the overlay was worse still — she was visible, dimmed, and
 * clicking her closed the task instead.
 *
 * Above the header too, and below dialogs: carried to the top of the window
 * she went behind the header (#1535). On the desktop she is drawn in a
 * window of her own instead (`rapi_float.rs`), so this governs the browser
 * build and her order inside that window.
 */
export const RAPI_AVATAR_Z = 112;

/**
 * What ラピ opens: her speech bubble.
 *
 * One above her, so the bubble is never drawn behind the character it comes
 * out of.
 */
export const RAPI_BUBBLE_Z = 113;
