/**
 * cli-availability
 *
 * Detects which agent-useful command-line tools are installed on PATH and
 * produces a short prompt section so the agent prefers them (e.g. `rg` over
 * `grep`). The agent already has shell access, so this only makes it AWARE of
 * what's available. Result is cached to avoid probing PATH on every execution.
 * Not responsible for installing tools (see routes/agents/cli-tools).
 */
import { exec } from 'child_process';
import { promisify } from 'util';
import { createLogger } from '../../config/logger';

const execAsync = promisify(exec);
const log = createLogger('agents:cli-availability');

interface AgentCli {
  /** Command name as invoked in the shell. */
  cmd: string;
  /** One-line usage hint shown to the agent. */
  hint: string;
}

/**
 * CLIs that materially help an AUTONOMOUS agent when present. Deliberately a
 * curated subset of the CLI Tools registry: human-facing pagers (delta, bat) and
 * interactive tools (fzf) are excluded — their ANSI/colour output is noise to an
 * agent parsing plain text, and interactive tools can't run non-interactively.
 */
const AGENT_CLIS: AgentCli[] = [
  { cmd: 'rg', hint: '高速な全文検索（grep より高速。テキスト検索に）' },
  { cmd: 'fd', hint: '高速なファイル検索（find の代替）' },
  {
    cmd: 'ast-grep',
    hint: '構文単位のコード検索・リファクタ（grep/rg より構造を正確に扱える）',
  },
  { cmd: 'jq', hint: 'JSON の整形・抽出（API レスポンス処理に）' },
  { cmd: 'gh', hint: 'GitHub 操作（PR / Issue の作成・参照）' },
];

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { value: string; at: number } | null = null;

/** True when `cmd` resolves on PATH (`where` on Windows, `command -v` elsewhere). */
async function isOnPath(cmd: string): Promise<boolean> {
  const probe = process.platform === 'win32' ? `where ${cmd}` : `command -v ${cmd}`;
  try {
    const { stdout } = await execAsync(probe, { timeout: 4000 });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Markdown section listing the agent-useful CLIs currently installed on PATH so
 * the agent uses them. Empty string when none are present. Cached for 5 minutes.
 *
 * @returns Prompt section, or '' when no such CLI is installed / プロンプト節（無ければ空）
 */
export async function getAgentCliContext(): Promise<string> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;

  const present = new Set<string>();
  await Promise.all(
    AGENT_CLIS.map(async (c) => {
      if (await isOnPath(c.cmd)) present.add(c.cmd);
    }),
  );

  const installed = AGENT_CLIS.filter((c) => present.has(c.cmd));
  const value =
    installed.length === 0
      ? ''
      : [
          '## 利用可能な CLI ツール',
          '次のコマンドラインツールがこの環境にインストール済みで、シェル（Bash ツール）から直接使用できます。適切な場面で活用してください:',
          ...installed.map((c) => `- \`${c.cmd}\` — ${c.hint}`),
        ].join('\n');

  cache = { value, at: Date.now() };
  log.debug({ count: installed.length }, '[cli-availability] resolved agent CLI context');
  return value;
}

/** Clears the cache so the next call re-probes PATH (e.g. after an install). */
export function invalidateAgentCliCache(): void {
  cache = null;
}
