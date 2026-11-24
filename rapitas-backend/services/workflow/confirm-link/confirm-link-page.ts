/**
 * confirm-link-page
 *
 * Renders the public confirm-link pages as self-contained HTML (task 1430):
 * the A/B form, and the answered / rejected pages. Every variable string is
 * HTML-escaped and no Markdown is rendered. Japanese only — the outside
 * respondent never loads the frontend, so next-intl is not available here.
 */
import type { ConfirmLinkPageResult, ConfirmLinkView } from './confirm-link-types';

/** Headers every public confirm-link response carries. */
export const CONFIRM_LINK_PUBLIC_HEADERS: Readonly<Record<string, string>> = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy':
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; img-src 'self'",
};

/**
 * Escape text for an HTML text node or a double-quoted attribute.
 *
 * @param value - Untrusted text / 未検証の文字列
 * @returns Escaped text / エスケープ済み文字列
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const STYLE = `
body{font-family:system-ui,sans-serif;max-width:640px;margin:2rem auto;padding:0 1rem;line-height:1.6;color:#1f2937;background:#f9fafb}
.card{background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:1.25rem;margin-bottom:1rem}
h1{font-size:1.25rem;margin:0 0 .75rem}h2{font-size:1rem;margin:0 0 .5rem}
.muted{color:#6b7280;font-size:.875rem}.error{color:#b91c1c}
label.opt{display:block;border:1px solid #d1d5db;border-radius:6px;padding:.75rem;margin:.5rem 0;cursor:pointer}
input[type=text]{width:100%;padding:.5rem;border:1px solid #d1d5db;border-radius:6px;box-sizing:border-box}
button{background:#2563eb;color:#fff;border:0;border-radius:6px;padding:.6rem 1.25rem;font-size:1rem;cursor:pointer}
p.pre{white-space:pre-wrap}
@media (prefers-color-scheme:dark){body{color:#e5e7eb;background:#050810}.card{background:#151d31;border-color:#374151}
label.opt,input[type=text]{border-color:#4b5563;background:#0b1220;color:#e5e7eb}.muted{color:#9ca3af}.error{color:#f87171}}
`;

function layout(title: string, body: string): string {
  return (
    `<!doctype html><html lang="ja"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="robots" content="noindex,nofollow">` +
    `<title>${escapeHtml(title)}</title><style>${STYLE}</style></head>` +
    `<body>${body}</body></html>`
  );
}

function renderResources(view: ConfirmLinkView, token: string): string {
  if (view.resources.length === 0) return '';
  const items = view.resources
    .map((r) => {
      const title = escapeHtml(r.title);
      if (r.url) {
        return `<li><a href="${escapeHtml(r.url)}" rel="noopener noreferrer" target="_blank">${title}</a></li>`;
      }
      if (r.hasFile) {
        const href = `/public/confirm-links/${encodeURIComponent(token)}/resources/${r.id}`;
        return `<li><a href="${escapeHtml(href)}">${title}</a></li>`;
      }
      return `<li>${title}</li>`;
    })
    .join('');
  return `<div class="card"><h2>根拠資料（読み取り専用）</h2><ul>${items}</ul></div>`;
}

function renderForm(view: ConfirmLinkView, token: string, error?: string): string {
  const options = view.options
    .map((o, i) => {
      const consequence = o.consequence
        ? `<br><span class="muted">${escapeHtml(o.consequence)}</span>`
        : '';
      return (
        `<label class="opt"><input type="radio" name="choice" value="${escapeHtml(o.key)}"` +
        `${i === 0 ? ' required' : ''}> ${escapeHtml(o.key)}案: ${escapeHtml(o.label)}${consequence}</label>`
      );
    })
    .join('');
  const message = view.message
    ? `<div class="card"><h2>依頼内容</h2><p class="pre">${escapeHtml(view.message)}</p></div>`
    : '';
  const expires = new Date(view.expiresAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  return layout(
    '判断のご確認',
    `<div class="card"><h1>判断のご確認</h1><p class="muted">このリンクは1回だけ回答でき、${escapeHtml(expires)}（日本時間）に失効します。</p></div>` +
      message +
      renderResources(view, token) +
      `<form method="post" class="card"><h2>${escapeHtml(view.summary)}</h2>` +
      (error ? `<p class="error">${escapeHtml(error)}</p>` : '') +
      options +
      `<p><label>お名前（自己申告・50文字以内）<br><input type="text" name="respondentName" maxlength="50" required></label></p>` +
      `<p><label><input type="checkbox" name="confirmed" value="on" required> 内容を確認しました</label></p>` +
      `<button type="submit">回答を送信する</button></form>`,
  );
}

function renderMessage(title: string, body: string): string {
  return layout(
    title,
    `<div class="card"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p></div>`,
  );
}

/**
 * Render the HTML for a service result.
 *
 * @param result - Service outcome / サービスの結果
 * @param token - Token of the current URL (for resource links) / トークン
 * @returns HTML document / HTML 文書
 */
export function renderConfirmLinkPage(result: ConfirmLinkPageResult, token: string): string {
  switch (result.kind) {
    case 'form':
      return renderForm(result.view, token, result.error);
    case 'answered':
      return renderMessage(
        '回答を受け付けました',
        `「${result.selectedLabel}」で回答しました。このリンクは無効になりました。`,
      );
    case 'gone':
      return renderMessage(
        'このリンクは使用済みか無効です',
        '回答の変更が必要な場合は、依頼元の担当者にご連絡ください。',
      );
    case 'error':
      return renderMessage('回答を処理できませんでした', '時間をおいて再度お試しください。');
    default:
      return renderMessage('ページが見つかりません', 'リンクが正しいかご確認ください。');
  }
}
