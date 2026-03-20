import { type ScreenshotResult } from '../../services/misc/screenshot-service';

/**
 * Strips the filesystem path from screenshot results before sending to the frontend.
 * The path is internal and should not be exposed to clients.
 */
export function sanitizeScreenshots(screenshots: ScreenshotResult[]) {
  return screenshots.map(({ path, ...rest }) => rest);
}

/**
 * Extracts a clean implementation summary from raw agent output.
 * Removes log noise, debug info, stack traces, and duplicate content,
 * producing a concise user-facing summary.
 *
 * @param rawOutput - Raw agent output text
 * @returns Cleaned summary string
 */
export function cleanImplementationSummary(rawOutput: string): string {
  if (!rawOutput || rawOutput.trim().length === 0) {
    return 'Implementation completed.';
  }

  const lines = rawOutput.split('\n');
  const cleanedLines: string[] = [];
  const seenContent = new Set<string>();

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === '') continue;

    // Exclude log output patterns
    if (/^\[(?:実行開始|実行中|API|DEBUG|INFO|WARN|ERROR|LOG)\]/.test(trimmed)) continue;
    if (/^\[[\d\-T:.Z]+\]/.test(trimmed)) continue;
    if (/^(?:>|>>|\$)\s/.test(trimmed)) continue;
    if (/^(?:npm|bun|yarn|pnpm)\s(?:run|install|build|test|exec)/.test(trimmed)) continue;
    if (/^(?:Running|Executing|Starting|Compiling|Building|Installing)[\s:]/.test(trimmed))
      continue;
    if (/^(?:stdout|stderr|exit code|pid|process)[\s:]/i.test(trimmed)) continue;
    if (/^(?:✓|✗|✔|✘|⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏)\s/.test(trimmed)) continue;
    if (/^(?:warning|error|info|debug|trace|verbose)\s*:/i.test(trimmed)) continue;
    if (/^(?:at\s+|Error:|TypeError:|ReferenceError:|SyntaxError:)/.test(trimmed)) continue;
    if (/^(?:\d+\s+(?:passing|failing|pending))/.test(trimmed)) continue;
    if (/console\.(?:log|error|warn|info|debug)\s*\(/.test(trimmed)) continue;
    if (/^[\-=]{3,}$/.test(trimmed)) continue;
    if (/^#{4,}\s/.test(trimmed)) continue; // Exclude deeply nested headings (h4+)

    // Deduplicate by normalized content
    const normalized = trimmed.replace(/\s+/g, ' ').toLowerCase();
    if (seenContent.has(normalized)) continue;
    seenContent.add(normalized);

    cleanedLines.push(line);
  }

  let result = cleanedLines.join('\n').trim();

  // Fall back to the beginning of the raw text if everything was filtered
  if (result.length === 0) {
    result = rawOutput.trim().substring(0, 500);
  }

  // Truncate at paragraph boundaries to preserve Markdown structure
  if (result.length > 2000) {
    const paragraphs = result.split(/\n\n+/);
    let truncated = '';
    for (const paragraph of paragraphs) {
      if (truncated.length + paragraph.length > 1800) break;
      truncated += (truncated ? '\n\n' : '') + paragraph;
    }
    result = truncated || result.substring(0, 1800);
  }

  return result;
}
