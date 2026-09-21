/**
 * Log Tail Reader
 *
 * Reads only the trailing bytes of a log file as text, so a large, all-day log
 * is never fully materialised in one synchronous string operation.
 * Not responsible for parsing lines or applying time filters.
 */
import { open, stat } from 'fs/promises';

/**
 * Reads up to maxBytes from the end of a file and drops a leading partial line.
 *
 * @param path - Log file path / ログファイルのパス
 * @param maxBytes - Max trailing bytes to read / 末尾から読む最大バイト数
 * @returns Whole lines of the tail as text / 末尾の完全な行のテキスト
 */
export async function readLogTail(path: string, maxBytes: number): Promise<string> {
  const { size } = await stat(path);
  const start = Math.max(0, size - maxBytes);
  const handle = await open(path, 'r');
  let raw: string;
  try {
    const buf = Buffer.alloc(size - start);
    const { bytesRead } = await handle.read(buf, 0, buf.length, start);
    raw = buf.toString('utf-8', 0, bytesRead);
  } finally {
    await handle.close();
  }
  // A tail read starts mid-line; drop that fragment so it is not parsed as broken JSON.
  if (start > 0) {
    const firstNewline = raw.indexOf('\n');
    raw = firstNewline === -1 ? '' : raw.slice(firstNewline + 1);
  }
  return raw;
}
