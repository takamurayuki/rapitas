/**
 * split-by-code
 *
 * Cuts a note body into prose and code pieces that join back to the body
 * character for character, for rules that must not touch code.
 * Uses the code rules of `withoutCode` (note-content-format.ts); the shared
 * table (note-content-kind.cases.json) holds the two equal.
 *
 * NOTE: must match `splitByCode` in the backend's
 * services/notes/note-content-kind.ts. Kept in its own file here because
 * note-content-format.ts is already near the file-size limit.
 */
import {
  ATX_HEADING,
  BLANK_LINE,
  FENCE_CLOSE,
  FENCE_OPEN,
  backtickRunEnd,
} from '../note-content-format';

/** One piece of a body: prose, or code that save-time rules must not touch. */
export interface CodeSegment {
  /** The exact characters of the piece / 断片の文字列（元のまま） */
  text: string;
  /** True for a fenced block or a code span / フェンスかインラインコードなら true */
  code: boolean;
  /** Paragraph index; tags pair only within one block / 段落番号（同じ段落内だけで対にする） */
  block: number;
}

const LINE_BREAK_KEPT = /(\r\n|\r|\n)/;

function matchingRunEnd(paragraph: string, from: number, length: number): number {
  for (let k = from; k < paragraph.length; ) {
    if (paragraph[k] !== '`') {
      k += 1;
      continue;
    }
    const runEnd = backtickRunEnd(paragraph, k);
    if (runEnd - k === length) return runEnd;
    k = runEnd;
  }
  return -1;
}

function splitCodeSpans(paragraph: string, block: number, out: CodeSegment[]): void {
  let text = '';
  let i = 0;
  const pushText = () => {
    if (text !== '') out.push({ text, code: false, block });
    text = '';
  };
  while (i < paragraph.length) {
    const ch = paragraph[i];
    if (ch === '\\') {
      text += paragraph.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (ch !== '`') {
      text += ch;
      i += 1;
      continue;
    }
    const openEnd = backtickRunEnd(paragraph, i);
    const closeEnd = matchingRunEnd(paragraph, openEnd, openEnd - i);
    if (closeEnd < 0) {
      text += paragraph.slice(i, openEnd);
      i = openEnd;
    } else {
      pushText();
      out.push({ text: paragraph.slice(i, closeEnd), code: true, block });
      i = closeEnd;
    }
  }
  pushText();
}

/**
 * The body cut into prose and code pieces in order.
 *
 * @param content - The note body / ノート本文
 * @returns The pieces; joined they give the body back / 断片（連結すると元の本文に戻る）
 */
export function splitByCode(content: string): CodeSegment[] {
  const out: CodeSegment[] = [];
  const parts = content.split(LINE_BREAK_KEPT);
  let block = 0;
  let paragraph = '';
  let fence: { char: string; length: number } | null = null;
  const flush = () => {
    if (paragraph !== '') splitCodeSpans(paragraph, block, out);
    paragraph = '';
    block += 1;
  };
  for (let i = 0; i < parts.length; i += 2) {
    const line = parts[i] ?? '';
    const raw = line + (parts[i + 1] ?? '');
    if (fence) {
      out.push({ text: raw, code: true, block });
      const close = FENCE_CLOSE.exec(line)?.[1];
      if (close && close[0] === fence.char && close.length >= fence.length) {
        fence = null;
        block += 1;
      }
      continue;
    }
    const open = FENCE_OPEN.exec(line);
    const marker = open?.[1];
    if (marker && !(marker[0] === '`' && (open[2] ?? '').includes('`'))) {
      flush();
      fence = { char: marker[0] ?? '`', length: marker.length };
      out.push({ text: raw, code: true, block });
      continue;
    }
    if (BLANK_LINE.test(line)) {
      flush();
      if (raw !== '') out.push({ text: raw, code: false, block });
      block += 1;
      continue;
    }
    if (ATX_HEADING.test(line)) {
      flush();
      splitCodeSpans(raw, block, out);
      block += 1;
      continue;
    }
    paragraph += raw;
  }
  flush();
  return out;
}
