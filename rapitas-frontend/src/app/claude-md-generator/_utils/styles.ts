/**
 * styles
 *
 * Global CSS string injected as a <style> tag throughout the CLAUDE.md
 * generator wizard. Uses CSS custom properties so all phases share one
 * consistent dark-theme design token set without Tailwind interference.
 */

export const GLOBAL_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');
.cmd-gen,
.cmd-gen *,
.cmd-gen *::before,
.cmd-gen *::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#08080c;--s1:#0f0f15;--s2:#16161f;--s3:#1e1e2a;
  --border:#252535;--border2:#32324a;
  --accent:#6366f1;--accent2:#a78bfa;--accent3:#38bdf8;
  --text:#eeeef5;--muted:#6b6b85;--dimmed:#3a3a55;
  --green:#4ade80;--amber:#fbbf24;--red:#f87171;
}
.cmd-gen{background:var(--bg);color:var(--text);font-family:'Outfit',sans-serif}

.fade{animation:fadeUp .38s cubic-bezier(.22,1,.36,1) both}
@keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
.stagger-1{animation-delay:.05s}.stagger-2{animation-delay:.1s}.stagger-3{animation-delay:.15s}

/* Cards */
.card{
  border:1.5px solid var(--border);border-radius:12px;
  background:var(--s1);padding:14px 16px;cursor:pointer;
  transition:border-color .15s,background .15s,transform .12s;
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
  font-family:'Outfit',sans-serif;font-size:15px;font-weight:600;
  cursor:pointer;transition:all .18s;letter-spacing:.01em}
.btn-p{background:var(--accent);color:#fff}
.btn-p:hover{filter:brightness(1.12)}
.btn-p:disabled{opacity:.3;cursor:not-allowed;filter:none}
.btn-g{background:transparent;color:var(--muted);border:1.5px solid var(--border)}
.btn-g:hover{border-color:var(--border2);color:var(--text)}
.btn-outline{background:transparent;color:var(--accent);border:1.5px solid var(--accent)}
.btn-outline:hover{background:rgba(99,102,241,.1)}

/* Progress */
.prog{height:3px;background:var(--s3);border-radius:3px;overflow:hidden}
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
  background:#060609;border:1px solid var(--border);border-radius:12px;
  padding:26px 30px;font-family:'JetBrains Mono',monospace;font-size:12px;
  line-height:2;white-space:pre-wrap;color:#9090b8;
  max-height:540px;overflow-y:auto;
}
.codebox::-webkit-scrollbar{width:5px}
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
.tag-accent{background:rgba(99,102,241,.15);border:1px solid rgba(99,102,241,.3);color:var(--accent2)}
.tag-green{background:rgba(74,222,128,.1);border:1px solid rgba(74,222,128,.25);color:var(--green)}
.tag-amber{background:rgba(251,191,36,.1);border:1px solid rgba(251,191,36,.25);color:var(--amber)}
`;
