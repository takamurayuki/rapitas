/**
 * stdin-prompt-writer
 *
 * Streams a prompt to a child process stdin in chunks and tolerates the pipe
 * closing early. It does not decide how the child's exit is reported.
 */
import type { Writable } from 'stream';

const CHUNK_SIZE = 16384; // 16KB chunks

/** Error codes that only mean the child closed its stdin before we finished writing. */
const PIPE_CLOSED_CODES = new Set(['EPIPE', 'ERR_STREAM_DESTROYED', 'ERR_STREAM_WRITE_AFTER_END']);

/**
 * Whether an stdin error is just a symptom of the child having exited.
 *
 * @param err - Error emitted by stdin / stdin の error / 子プロセス終了の二次症状かどうか
 * @returns true when the pipe was closed by the peer / 相手側が pipe を閉じた場合 true
 */
export function isPipeClosedError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === 'string' && PIPE_CLOSED_CODES.has(code);
}

/**
 * Write the prompt to stdin in chunks without hanging or raising ERROR on a broken pipe.
 *
 * @param stdin - Child stdin stream / 子プロセスの stdin
 * @param prompt - Prompt text / プロンプト
 * @param onError - Called for stdin errors; `pipeClosed` is true for EPIPE-like errors / stdin エラー通知
 * @returns Bytes in the prompt and whether it was fully written / バイト数と完全書き込みの可否
 */
export async function writePromptChunks(
  stdin: Writable,
  prompt: string,
  onError: (err: Error, pipeClosed: boolean) => void,
): Promise<{ bytes: number; completed: boolean }> {
  // Already destroyed/ended: 'close' will not fire again, so waiting on it would hang.
  let broken = stdin.destroyed || stdin.writableEnded;
  // Waiters blocked on 'drain' must be released when the pipe breaks; 'drain' never fires then.
  const release = new Set<() => void>();
  const onClose = () => {
    broken = true;
    release.forEach((r) => r());
  };
  // NOTE: The error listener stays attached for good; a late EPIPE after end() would otherwise be unhandled.
  stdin.on('error', (err) => {
    broken = true;
    onError(err, isPipeClosedError(err));
    release.forEach((r) => r());
  });
  stdin.on('close', onClose);

  const promptBuffer = Buffer.from(prompt, 'utf8');
  try {
    for (let i = 0; i < promptBuffer.length && !broken; i += CHUNK_SIZE) {
      const canContinue = stdin.write(
        promptBuffer.subarray(i, Math.min(i + CHUNK_SIZE, promptBuffer.length)),
      );
      if (!canContinue && !broken) {
        await new Promise<void>((r) => {
          release.add(r);
          stdin.once('drain', r);
        });
      }
    }
    // end() on a broken pipe would only raise another error; the close handler reports the exit.
    if (!broken) stdin.end();
  } finally {
    stdin.off('close', onClose);
  }
  return { bytes: promptBuffer.length, completed: !broken };
}
