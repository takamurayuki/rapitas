/**
 * date-field-format
 *
 * Conversion between the app's displayed date shape (`yyyy/mm/dd [HH:mm]`) and
 * the value shape a native date input uses (`YYYY-MM-DD` / `YYYY-MM-DDTHH:mm`).
 * Pure string work only — not responsible for rendering or for opening a picker
 * (see date-field.tsx).
 *
 * Why the app formats this itself: the native input's field order comes from the
 * browser's UI locale and nothing in the page can change it. Measured 2026-10-07
 * in the running WebView2 and in Edge — the `lang` attribute has no effect, and
 * `--lang=ja` only switches the clock to 24h, leaving mm/dd/yyyy (of the locales
 * tried only `zh-CN` yields yyyy/mm/dd, at the cost of a Chinese browser UI).
 */

/** `YYYY-MM-DD`, optionally followed by `THH:mm` and anything after it. */
const VALUE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/;
/** `yyyy/mm/dd` or `yyyy-mm-dd`, optional ` HH:mm`; month/day/hour may be 1 digit. */
const DISPLAY_RE = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2}))?$/;

/** Whether y-m-d names a day that exists (rejects 2026-02-30 and month 13). */
function isRealDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  const probe = new Date(y, m - 1, d);
  return probe.getFullYear() === y && probe.getMonth() === m - 1 && probe.getDate() === d;
}

const p2 = (n: string | number): string => String(n).padStart(2, '0');

/**
 * Render an input value in the app's display shape.
 *
 * @param value - Native input value (`YYYY-MM-DD` or `YYYY-MM-DDTHH:mm`). / 入力欄の値
 * @param withTime - Include the time part when present. / 時刻を含めるか
 * @returns `yyyy/mm/dd`, `yyyy/mm/dd HH:mm`, or '' when unparseable. / 表示用文字列
 */
export function toDisplayValue(value: string, withTime: boolean): string {
  const m = VALUE_RE.exec(value.trim());
  if (!m) return '';
  const [, y, mo, d, hh, mm] = m;
  const date = `${y}/${mo}/${d}`;
  // A date-only value stays date-only even in a datetime field, so a half-filled
  // value never renders as a misleading "00:00" the user did not choose.
  return withTime && hh !== undefined && mm !== undefined ? `${date} ${hh}:${mm}` : date;
}

/**
 * Parse what the user typed back into a native input value.
 *
 * Deliberately forgiving about the separator and leading zeros — a hyphen and a
 * missing zero are what people actually type — but strict about the value being
 * a real date and time, so an impossible entry is rejected rather than silently
 * rolled over by Date.
 *
 * @param text - Text as typed. / 入力されたテキスト
 * @param withTime - Produce a `YYYY-MM-DDTHH:mm` value. / 時刻付きで返すか
 * @returns The input value, '' when the text is blank, or null when invalid. / 変換結果
 */
export function parseDisplayValue(text: string, withTime: boolean): string | null {
  const trimmed = text.trim();
  if (trimmed === '') return '';
  const m = DISPLAY_RE.exec(trimmed);
  if (!m) return null;
  const [, y, mo, d, hh, mm] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  if (!isRealDate(year, month, day)) return null;

  const date = `${y}-${p2(month)}-${p2(day)}`;
  if (!withTime) return date;

  // Missing time means midnight; a present one must be a real clock reading.
  const hour = hh === undefined ? 0 : Number(hh);
  const minute = mm === undefined ? 0 : Number(mm);
  if (hour > 23 || minute > 59) return null;
  return `${date}T${p2(hour)}:${p2(minute)}`;
}
