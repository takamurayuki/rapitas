/**
 * styles
 *
 * Global CSS string injected as a <style> tag throughout the spec-document
 * generator wizard. Tokens are theme-aware (light by default, overridden under
 * `html.dark`) and aligned with the app's zinc/indigo palette so the wizard is
 * visually consistent with the rest of the product instead of a bespoke dark world.
 */

export const GLOBAL_CSS = `
.cmd-gen,
.cmd-gen *,
.cmd-gen *::before,
.cmd-gen *::after{box-sizing:border-box;margin:0;padding:0}

/* Light theme tokens (default) — zinc surfaces + indigo accent */
.cmd-gen{
  --bg:var(--background,#fafafa);--s1:#ffffff;--s2:#f4f4f5;--s3:#e4e4e7;
  --border:#e4e4e7;--border2:#d4d4d8;
  --accent:#6366f1;--accent2:#4f46e5;--accent3:#0ea5e9;
  --text:#18181b;--muted:#71717a;--dimmed:#a1a1aa;
  --green:#16a34a;--amber:#d97706;--red:#dc2626;
  --code-bg:#f4f4f5;--code-text:#3f3f46;
  color:var(--text);
}
/* Dark theme tokens — app toggles dark via html.dark */
html.dark .cmd-gen{
  --bg:var(--background,#09090b);--s1:#18181b;--s2:#27272a;--s3:#3f3f46;
  --border:#27272a;--border2:#3f3f46;
  --accent:#6366f1;--accent2:#a78bfa;--accent3:#38bdf8;
  --text:#fafafa;--muted:#a1a1aa;--dimmed:#52525b;
  --green:#4ade80;--amber:#fbbf24;--red:#f87171;
  --code-bg:#0a0a0f;--code-text:#9090b8;
}
/* Inherit the app font instead of forcing a bespoke display face */
.cmd-gen{font-family:inherit}
.cmd-gen h1,.cmd-gen h2,.cmd-gen h3{font-family:inherit !important}

.fade{animation:fadeUp .38s cubic-bezier(.22,1,.36,1) both}
@keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
.stagger-1{animation-delay:.05s}.stagger-2{animation-delay:.1s}.stagger-3{animation-delay:.15s}

/* Cards */
.card{
  display:flex;align-items:center;gap:12px;
  border:1.5px solid var(--border);border-radius:12px;
  background:var(--s1);padding:14px 16px;cursor:pointer;
  transition:border-color .15s,background .15s,transform .12s,box-shadow .15s;
  user-select:none;position:relative;overflow:hidden;
}
.card:hover{border-color:var(--border2);background:var(--s2);transform:translateY(-1px)}
.card.sel{border-color:var(--accent);background:rgba(99,102,241,.08)}
.card.sel::before{
  content:'';position:absolute;inset:0;
  background:linear-gradient(135deg,rgba(99,102,241,.06),transparent);
  pointer-events:none;
}
.card-check{
  width:20px;height:20px;border-radius:50%;border:1.5px solid var(--dimmed);
  display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:.15s;
}
.card.sel .card-check{background:var(--accent);border-color:var(--accent)}
.card-checkb{
  width:20px;height:20px;border-radius:5px;border:1.5px solid var(--dimmed);
  display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:.15s;
}
.card.sel .card-checkb{background:var(--accent);border-color:var(--accent)}

/* Buttons */
.btn{border:none;border-radius:9px;padding:12px 26px;
  font-family:inherit;font-size:15px;font-weight:600;
  cursor:pointer;transition:all .18s;letter-spacing:.01em}
.btn-p{background:var(--accent);color:#fff}
.btn-p:hover{filter:brightness(1.08)}
.btn-p:disabled{opacity:.4;cursor:not-allowed;filter:none}
.btn-g{background:transparent;color:var(--muted);border:1.5px solid var(--border)}
.btn-g:hover{border-color:var(--border2);color:var(--text)}
.btn-outline{background:transparent;color:var(--accent);border:1.5px solid var(--accent)}
.btn-outline:hover{background:rgba(99,102,241,.1)}

/* Progress */
.prog{height:4px;background:var(--s3);border-radius:3px;overflow:hidden}
.prog-f{height:100%;background:linear-gradient(90deg,var(--accent),var(--accent2));
  border-radius:3px;transition:width .5s ease}

/* Proposal card */
.prop-card{
  border:1.5px solid var(--border);border-radius:14px;
  background:var(--s1);padding:22px 24px;cursor:pointer;
  transition:all .2s;position:relative;overflow:hidden;
}
.prop-card:hover{border-color:var(--accent);transform:translateY(-2px);
  box-shadow:0 8px 32px rgba(99,102,241,.12)}
.prop-card.picked{border-color:var(--accent);background:rgba(99,102,241,.07);
  box-shadow:0 0 0 3px rgba(99,102,241,.2)}

/* Code box */
.codebox{
  background:var(--code-bg);border:1px solid var(--border);border-radius:12px;
  padding:24px 26px;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:12px;
  line-height:1.9;white-space:pre-wrap;color:var(--code-text);
  max-height:540px;overflow-y:auto;
}
.codebox::-webkit-scrollbar{width:6px}
.codebox::-webkit-scrollbar-thumb{background:var(--border2);border-radius:4px}

/* Spinner */
.spin{width:38px;height:38px;border-radius:50%;
  border:3px solid var(--s3);border-top-color:var(--accent);
  animation:rot .7s linear infinite}
@keyframes rot{to{transform:rotate(360deg)}}

/* Tag */
.tag{
  display:inline-block;border-radius:6px;padding:3px 10px;
  font-size:11px;margin:2px 3px;font-weight:600;letter-spacing:.04em;
}
.tag-accent{background:rgba(99,102,241,.12);border:1px solid rgba(99,102,241,.3);color:var(--accent2)}
.tag-green{background:rgba(22,163,74,.1);border:1px solid rgba(22,163,74,.25);color:var(--green)}
.tag-amber{background:rgba(217,119,6,.1);border:1px solid rgba(217,119,6,.25);color:var(--amber)}
`;
