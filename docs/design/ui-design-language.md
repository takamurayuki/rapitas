# Rapitas UI Design Language

> The reference for **how rapitas UI should look and feel**: what makes a screen
> read as generic / "AI-generated", and the principles we use instead —
> original, intuitive, usable. Consult this before building or restyling any UI.
>
> Adopt it **incrementally**: improve one screen/component at a time, log the
> change in [§5 Change log](#5-change-log-incremental-adoption), and refine this doc as we learn.
> It complements `.claude/COMPONENT_SPLITTING_POLICY.md` (structure) — this doc
> governs *aesthetics & interaction*.

---

## 1. Why this exists

A lot of generated UI lands in a recognizable local optimum: indigo gradients,
glassy cards, rounded-everything, a sparkle icon, and a centered hero. It looks
"fine" but anonymous — it could belong to any of a thousand demos. rapitas is a
"human intelligence OS"; its surface should feel **deliberate and ownable**, not
templated. This doc names the tells so we can avoid them on purpose.

---

## 2. The "AI-generated look" — tells to avoid

Each row: the tell → why it reads as generic → what we do instead. Examples cite
real code we have already corrected or should watch for.

| # | Tell | Why it reads as "AI" | Do instead |
|---|------|----------------------|------------|
| 1 | **One saturated hue everywhere** (indigo on icons, text, borders, chips, hovers) | Color stops carrying meaning; everything competes for attention | Neutral base (`zinc`), **one** accent (`indigo`) reserved for *active/selected* and *primary action* only |
| 2 | **Gradient-clipped text** (`bg-clip-text text-transparent`, often on a solid color so it isn't even a gradient) | The signature "AI hero" flourish; hurts legibility & contrast | Solid, high-contrast text (`text-indigo-600 dark:text-indigo-400`); weight & size for emphasis |
| 3 | **Heavy elevation** — `shadow-2xl`, glows, layered drop shadows on every card | Fake depth; no real z-hierarchy; muddy in dark mode | Prefer **1px borders** for separation; at most one soft elevation (`shadow-sm`/`shadow-lg`) for true overlays |
| 4 | **Decorative motion** — pulsing glows, long ambient fades, motion with no trigger | Motion that doesn't track a state change is noise; feels "look at me" | Motion only to explain a state change; keep it short and respect `prefers-reduced-motion`. Motion that *does* accompany a real state change can stay — see the nav expand animation in [§7 Signature elements](#7-signature-elements) |
| 5 | **Sparkle / emoji as *decoration*** (✨, 🚀, 🤖 sprinkled on buttons/sections for flavor) | The universal "AI" garnish | Consistent line icons (`lucide-react`), sized to text. **Functional exception:** a `Sparkles`/star icon is fine when it *labels a feature or state* (e.g. the AI tab in `header-toolbar.tsx`) — what's banned is the same icon as ambient decoration. Emoji only as user content, never chrome |
| 6 | **Rounded-everything + uniform cards** — every block is a `rounded-xl` card with the same padding | No hierarchy; a wall of equally-loud boxes | Vary radius/elevation by role; group with whitespace and headings, not nested cards |
| 7 | **Glassmorphism / neon gradients on controls** (`backdrop-blur` panels, gradient buttons) | Trend-chasing; poor contrast & focus visibility | Solid surfaces; accent fill for primary action; clear `:focus-visible` rings |
| 8 | **No typographic scale** — one or two sizes, bold used for everything | Flat, undifferentiated reading order | Deliberate scale (e.g. 12/14/16/20/24) and limited weights; let size+spacing build hierarchy |
| 9 | **Centered hero + generic empty states** ("Get started ✨", big centered CTA) | Template smell | Task-first layouts; empty states that state the *next concrete action* in the product's voice |
| 10 | **Redundant chrome** (app name/icon repeated in header *and* nav) | Padding for its own sake | Say each thing once; give reclaimed space to content |

---

## 3. rapitas design principles

1. **Restraint over decoration.** The default look is calm: neutral surfaces,
   one accent. If a color, shadow, or animation isn't carrying meaning, remove it.
2. **Hierarchy from type & space, not color & shadow.** Reach for size, weight,
   and whitespace first; color/elevation are a last resort and always meaningful.
3. **One accent, with a job.** Indigo = "this is active / this is the primary
   action." Never use it as ambient decoration.
   - **Brand exception:** the brand mark — the header logo chip and "Rapi+"
     wordmark — may use indigo as a small, fixed identity element. This is the
     *only* sanctioned ambient use of the accent. Keep it small and singular;
     it is not a license to tint surrounding chrome.
4. **Motion is feedback.** Animate a transition only when it helps the user track
   what changed. Honors reduced-motion. **Single duration rule:** default
   **≤200ms**; overlays and panel open/close (side nav, modals, drawers) may go
   up to **≤300ms**. Nothing slower.
5. **Depth is rare.** Separate with borders. Elevate only things that truly float
   (overlays, menus) — one shadow level, never stacked glows.
6. **Consistent, quiet iconography.** Line icons from lucide, aligned to the text
   baseline and sized with it. No emoji in chrome.
7. **Density with rhythm.** Comfortable, consistent spacing; align to a grid.
   Information-dense where the task needs it, never cramped.
8. **Intuitive by default.** A first-time user should predict where things are
   and what an action does. Prefer familiar patterns; reserve novelty for one or
   two signature moments, not the whole screen.
9. **Originality through opinion, not ornament.** Distinctiveness comes from a
   considered layout and a signature element (e.g. the Discovery Feed), not from
   gradients and glows.
10. **Accessible is non-negotiable.** WCAG AA contrast, visible focus rings,
    keyboard reachability, and `prefers-reduced-motion` support.

---

## 4. Tokens & defaults (current stack: Tailwind v4)

- **Surfaces**: `bg-white` / `dark:bg-indigo-dark-900`. Separators: `border-zinc-200 dark:border-zinc-800`.
- **Text**: primary `text-zinc-900 dark:text-zinc-100`; secondary `text-zinc-600 dark:text-zinc-400`; muted `text-zinc-500 dark:text-zinc-500` (light-mode `zinc-400` is ~2.8:1 on white — fails WCAG AA for real text; `zinc-400`/`zinc-500` remain fine on dark surfaces).
- **Accent (single)**: `indigo` — active bg `indigo-50 dark:indigo-900/30`, active fg `indigo-600 dark:indigo-400`, primary action `bg-indigo-500/600`. Brand mark (logo/wordmark) may also use indigo as a small fixed identity element (see principle #3).
- **Radius**: controls `rounded-md`/`rounded-lg`; avoid `rounded-2xl`+ on everything.
- **Elevation**: borders by default; `shadow-lg` only for overlays/menus. Avoid `shadow-2xl`.
- **Motion**: `transition-colors`/`transition-transform`; default `duration-150`/`200` (≤200ms), overlays/panels up to `duration-300`. No keyframe draw-ins for decoration (functional ones that track a state change are allowed — see §7).
- **Status hues (one meaning = one hue, app-wide)**: running / in-progress / active phase = **blue** (`blue-600 dark:blue-400`, bg `blue-50 dark:blue-900/30`); waiting-on-user & warning = **amber**; error / blocked = **red**; success / completed = **green** (`green-500/600`, never emerald — emerald near-misses green and reads as drift; it stays reserved for non-completion meanings like the auto-run active state and learning-goals domain theming). Blue is reserved for the *running state* and is distinct from the indigo *interactive accent* — do not swap them. Sources of truth: `ui/status-card/StatusCard.tsx`, `workflow/WorkflowStatusIndicator.tsx`, `feature/tasks/config/StatusConfig.tsx`, `ui/alert.tsx`.
- **Focus**: always a visible ring in the **accent**, on `focus-visible`: `focus-visible:ring-2 focus-visible:ring-indigo-500`. **Do not use `ring-blue-*`.** There are ~38 legacy `focus:ring-blue-500` instances (e.g. `header-search.tsx`, `app/tasks/new/NewTaskClient.tsx`, `HomeQuickAdd.tsx`); migrate each to `ring-indigo-500` (and `focus:` → `focus-visible:`) when you next touch that file.

### Type scale (role → recommended class)

| Role | Class |
|------|-------|
| Page title | `text-2xl font-semibold` (24) |
| Page heading / card title | `text-xl font-semibold` (20) |
| Section heading | `text-sm font-semibold` (14, often `uppercase tracking-wide text-zinc-500`) |
| Body / default | `text-base` (16) or `text-sm` (14) in dense UI |
| Secondary / label | `text-sm text-zinc-600 dark:text-zinc-400` (14) |
| Caption / meta / kbd | `text-xs text-zinc-500 dark:text-zinc-400` (12) — bumped from `zinc-400` in light mode for AA contrast; dark stays `zinc-400` |

Limit weights to `font-normal` / `font-medium` / `font-semibold`. Build emphasis with size + weight + color, not size alone, and never with the accent.

---

## 5. Change log (incremental adoption)

Track each screen/component as it is brought in line, so coverage is visible.

| Date | Area | Change | Tells fixed |
|------|------|--------|-------------|
| 2026-05-29 | Header / side nav | Nav moved below header; removed duplicated app name/icon; slim "メニュー" bar + pin; backdrop dim; softened shadow (`shadow-2xl`→`shadow-lg`); logo gradient-text → solid; dropped logo chip shadow. **Kept** the expand draw-in animation (signature — see §7) | #1, #2, #3, #10 |
| 2026-05-29 | Task detail | Flatten the primary cards (task meta, subtasks, workflow) onto the surface system: `rounded-2xl shadow-xl` → `rounded-lg`, no shadow, unified border; one content radius. Hid the internal workflow file path (`tasks/1/17`). Focus rings → indigo (earlier). | #1, #3, #6 |
| 2026-07-16 | Dashboard | Hierarchy: KPI strip → suggested-tasks as the single primary zone → study/exams → analytics. Dropped the oversized accent page icon; KPI/widget icons muted to zinc; card chrome unified to `rounded-lg` + border (no shadow, `dark:bg-zinc-900`); heatmap tabs & burnup period buttons now use the indigo active state (was white+`shadow-sm` / `bg-green-500`); burnup summary de-rainbowed (green kept for completed only); `font-bold`→`font-semibold`; page split per COMPONENT_SPLITTING_POLICY (`_components/`, `widgets/burnup-chart/`). | #1, #3, #6, #8, #10 |
| 2026-07-16 | Ideas | Removed the "eureka" flash animation (glow + 600-800ms flash lines) from the header; amber ambient accent retired (active filters, primary actions → indigo; Lightbulb glyphs muted to zinc); add/save buttons' hard offset shadows → solid indigo primary + neutral secondary; inputs `border-0 shadow-sm` → bordered; `rounded-xl`/`rounded` → `rounded-lg`; `focus:border-blue-400` → `focus-visible:ring-indigo-500`; modal `shadow-xl` → `shadow-lg`. | #1, #3, #4, #6 |
| 2026-07-25 | Ideas (add modal) | Reintroduced a small amber flash, deliberately narrower than the one removed 2026-07-16: the add-idea modal's `Lightbulb` icon plays a **single 0.45s** scale+glow flash (`animate-idea-lamp-flash`, globals.css) **only when a new idea POST actually succeeds** (`flashKey` counter in `use-idea-form.ts`, bumped once per successful add — never on mount, edit, or failure). Scoped to that one icon only — no surface/border/badge amber, so it doesn't reintroduce tell #1 (a second ambient accent competing with indigo). This satisfies tell #4's carve-out ("motion IS allowed when it explains a real state change") rather than reverting it — do not remove this as "AI-ish decorative motion" without first checking that it's still gated on the actual POST-success path. | (adds delight without reintroducing #1/#4) |
| 2026-07-25 | Ideas (icon, add button, status tabs, task-created badge) | User explicitly asked for a wider re-skin after seeing the scoped flash above ("the icon/add-button/status filter/task-created badge should all be amber"), superseding the 2026-07-16 de-ambering for this feature specifically — this is a deliberate per-feature exception, not a reversion of tell #1 app-wide. `Lightbulb` icon and the primary "add idea" button (`IdeaBoxHeader.tsx`, `idea-create-form.tsx`) → amber-600/500, matching the already-shipped `IdeaBoxPanel.tsx` (home widget) palette for consistency between the two surfaces. Status filter tabs' active state and the "タスク化済" badge (`idea-filter-bar.tsx`, `idea-card.tsx`) → amber. Focus rings stay indigo (app-wide convention, untouched). Also removed the redundant Category→Theme two-step selector everywhere in this feature (add form, filter bar, theme-picker modal) — themes shown are already scoped to dev-project themes, so the category step added a click with no filtering value. | (per-feature exception to #1, not a regression) |

### Candidate next steps (not yet done — pick one at a time)

- **Empty states** across list pages → concrete next-action copy (tell #9).
- **ExamCountdown** (`components/exam-countdown`): `shadow-sm/md` on the mini calendar chip, `font-extrabold` — normalize when next touched (tell #3, #8).

---

## 6. Quick review checklist (before merging UI)

- [ ] Is indigo used **only** for active state / primary action (brand mark excepted)?
- [ ] Any gradient-clipped text? → make it solid.
- [ ] Any `shadow-2xl` / glow / stacked shadows? → border or single soft shadow.
- [ ] Any animation that isn't explaining a state change? → remove. Otherwise ≤200ms (overlays/panels ≤300ms).
- [ ] Any **decorative** emoji/sparkle as chrome? → remove. (Sparkle as a feature/state label is fine.)
- [ ] Is reading order clear from **size & spacing** without relying on color? (See the type-scale table in §4.)
- [ ] Is anything (name, icon, label) repeated unnecessarily?
- [ ] Focus ring uses **`focus-visible:ring-indigo-500`** (never `ring-blue-*`), with AA contrast + reduced-motion respected?

---

## 7. Signature elements

Deliberate, sanctioned distinctive touches. They embody principle #9 (originality
through opinion). **Do not remove these as "AI-ish" during cleanup** — they are
intentional. Add to this list when the team blesses a new signature.

- **Side-nav expand draw-in animation** (`line-animate-vertical` /
  `line-animate-horizontal`, defined in `header.tsx`, applied in `nav-item.tsx`
  via `lineStyle`/`getLineDelay` in `types.ts`). The connector lines draw in as a
  group expands. It is **kept on purpose**: it accompanies a real state change
  (expand) rather than being ambient decoration, and it gives the nav a small,
  recognizable character. Keep it short and gated on the expand; honor
  `prefers-reduced-motion` if added later.

---

## 8. Surface system (content sections & cards)

Default to **flat sections, not nested cards**. "Everything is a rounded,
shadowed card" is a primary AI-ish tell (#6) and reads as undifferentiated.
Organize content with dividers, headings, and whitespace; reserve a surface
only for blocks that genuinely need to feel distinct (interactive/input areas).

**The three surface roles — use exactly these, nothing else:**

1. **Section (default)** — *flat*. A thin top divider + a small label, then
   content with vertical breathing room. No box, border, radius, or shadow.
   - separator: `border-t border-zinc-200 dark:border-zinc-800`
   - label: `text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400`
   - spacing: `py-5` / `py-6` between sections
2. **Interactive block** — a *subtle fill*, no border, no shadow. For add-forms,
   editors, config/option panels — things the user acts on.
   - `bg-zinc-50 dark:bg-zinc-900/40 rounded-lg p-3/4`
3. **Overlay** — the *only* place elevation is allowed. Menus, popovers, modals,
   the task slide panel.
   - `rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-800`

**Radius:** one content radius — `rounded-lg`. `rounded-full` only for
pills / avatars / icon chips. **No `rounded-md` / `rounded-xl` / `rounded-2xl`**
on content surfaces.

**Shadow:** **none on content.** Shadows live on overlays only. Remove
`shadow-sm`/`md`/`lg`/`xl`/`2xl` from in-page sections and cards.

> Migration: the task detail mixed `rounded-md/lg/xl/2xl`, five shadow weights,
> and 117 borders. We are converging it onto this system incrementally, starting
> with the most prominent sections. Track each in §5.

## 9. Rotating / spinning icons (stability) — MUST READ before adding one

A continuously-rotating icon (`animate-spin`) **distorts/warps mid-spin** whenever
the browser is forced to **re-rasterize it while it is rotating**. In rapitas
(Tauri WebView / Chromium) this showed up as the auto-run `Orbit` spinner warping
on navigation and on hover. The fix is not one trick — it is a **rule**:

> **The rotating element and ALL of its ancestors must not change while it spins.**
> Anything that re-paints or re-composites the subtree re-rasterizes the rotating
> frame and warps it.

### What re-rasterizes a spinning icon (avoid ALL of these on it or any ancestor)

1. **Visibility toggling** of the spinner — in *any* form:
   - `display:none ↔ block` (e.g. `group-hover:hidden`) → tears it down and
     **restarts the animation** on re-show.
   - **`opacity` reaching < 1 on the spinner OR any ancestor** (e.g.
     `group-hover:opacity-0`) → an element with `opacity<1` groups its subtree
     into one layer, so toggling it **re-groups + re-rasterizes** the icon.
     `transition-opacity` is not required; reaching `0` at all does it.
   - This is true **even with `will-change-transform` / `transform-gpu`** on the
     spinner — a own-layer hint does **not** save it here, and `will-change` adds
     its own per-mount layer-promotion churn (distorts on navigation).
2. **Colour transitions on an ancestor** — e.g. a button with `transition-colors`
   whose `bg/border/text` animate to a hover colour. The spinner **inherits the
   text colour**, so the whole subtree (including the spin) repaints every frame
   of the fade.
3. **Rotating the inline `<svg>` directly** — an SVG's intrinsic size/baseline
   isn't settled for a frame after mount, so the rotating glyph warps on first
   paint. Spin a **fixed-size box**, not the SVG.

### The rule, applied (this is how the auto-run spinner is built — copy it)

- **Never toggle the spinner.** Render it **once, always visible**, and never put
  it inside anything that toggles `opacity`/`display`.
- To show a *different* hover/active state (e.g. a Stop button), **do not hide
  the spinner — cover it with an OPAQUE SIBLING overlay.** A sibling's opacity can
  fade freely; it can't re-rasterize the spinner. The overlay carries the entire
  alternate look (its own `bg` + `border` via `-inset-px`).
- **No colour change on any ancestor of the spinner on hover.** Drop the button's
  `transition-colors`/`hover:bg/text/border`; let the overlay provide the hover
  look. Give the spinner a **fixed colour** so nothing it inherits can animate.
- **Spin a rigid box, not the SVG:** wrap a static `<Orbit>` in
  `inline-flex h-4 w-4 shrink-0 animate-spin [transform-origin:center]` and put
  the SVG (`h-4 w-4`) inside. `shrink-0` keeps it square; a box can't warp.

```tsx
{/* spinner: always rendered, never toggled, fixed colour, rigid box */}
<span className="inline-flex h-4 w-4 shrink-0 items-center justify-center animate-spin text-emerald-600 [transform-origin:center] dark:text-emerald-400">
  <Orbit className="h-4 w-4" />
</span>
{/* hover/active state: OPAQUE sibling overlay covers the spinner (don't hide it) */}
<span className="absolute -inset-px flex items-center justify-center gap-2 rounded-lg border border-red-300 bg-red-50 opacity-0 group-hover:opacity-100 dark:border-red-700 dark:bg-red-950">
  …
</span>
```

> Reference implementation: `app/home/_components/AutoExecutionMode.tsx`.
> **Last resort:** if a rotating icon still warps in this WebView, switch to a
> **radially-symmetric** spinner (`Loader2` / a circular border) — it looks
> identical at every angle, so re-rasterization can never be perceived as warp.
