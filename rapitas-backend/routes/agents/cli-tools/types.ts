/**
 * CLI Tools Types
 *
 * Shared type definitions and static tool registry for CLI tools management.
 * Does not contain any runtime logic or HTTP handlers.
 */

/** Represents a supported CLI tool with its install and auth commands. */
export interface CLITool {
  id: string;
  name: string;
  description: string;
  packageName?: string;
  checkCommand: string;
  versionCommand: string;
  installCommand: string;
  updateCommand?: string;
  configCommand?: string;
  authCommand?: string;
  authCheck?: string;
  category: 'ai' | 'development' | 'utility';
  officialSite: string;
  documentation: string;
}

/** GitHub Releases API response shape (subset used by the app). */
export interface GitHubRelease {
  tag_name: string;
  name: string;
  published_at: string;
  body: string;
  html_url: string;
}

/** Registry of all supported CLI tools. */
export const CLI_TOOLS: CLITool[] = [
  {
    id: 'claude-cli',
    name: 'Claude CLI',
    description: 'Official Claude CLI tool by Anthropic',
    checkCommand: 'where claude',
    versionCommand: 'claude --version',
    installCommand: 'npm install -g @anthropic-ai/claude-cli',
    updateCommand: 'npm update -g @anthropic-ai/claude-cli',
    authCommand: 'claude auth login',
    authCheck: 'claude auth status',
    category: 'ai',
    officialSite: 'https://claude.ai',
    documentation: 'https://docs.anthropic.com/claude/cli',
  },
  {
    id: 'openai-cli',
    name: 'OpenAI CLI',
    description: 'OpenAI command line interface',
    packageName: 'openai',
    checkCommand: 'pip show openai',
    versionCommand: 'pip show openai | findstr Version',
    installCommand: 'pip install openai',
    updateCommand: 'pip install --upgrade openai',
    authCommand: 'openai auth',
    category: 'ai',
    officialSite: 'https://openai.com',
    documentation: 'https://platform.openai.com/docs',
  },
  {
    id: 'gemini-cli',
    name: 'Gemini CLI',
    description: 'Google Gemini command line interface',
    checkCommand: 'where gemini',
    versionCommand: 'gemini -v',
    installCommand: 'npm install -g @google/gemini-cli',
    updateCommand: 'npm update -g @google/gemini-cli',
    authCommand: 'gemini auth login',
    authCheck: 'gemini auth status',
    category: 'ai',
    officialSite: 'https://ai.google.dev',
    documentation: 'https://ai.google.dev/docs',
  },
  {
    id: 'gh-cli',
    name: 'GitHub CLI',
    description: 'GitHub command line interface',
    checkCommand: 'where gh',
    versionCommand: 'gh --version',
    installCommand: 'winget install GitHub.cli',
    updateCommand: 'gh extension upgrade --all',
    authCommand: 'gh auth login',
    authCheck: 'gh auth status',
    category: 'development',
    officialSite: 'https://cli.github.com',
    documentation: 'https://cli.github.com/manual/',
  },
  {
    id: 'ripgrep',
    name: 'ripgrep (rg)',
    description: 'Ultra-fast recursive code/text search',
    checkCommand: 'where rg',
    versionCommand: 'rg --version',
    installCommand: 'winget install BurntSushi.ripgrep.MSVC',
    updateCommand: 'winget upgrade BurntSushi.ripgrep.MSVC',
    category: 'utility',
    officialSite: 'https://github.com/BurntSushi/ripgrep',
    documentation: 'https://github.com/BurntSushi/ripgrep#readme',
  },
  {
    id: 'fd',
    name: 'fd',
    description: 'Fast, user-friendly alternative to find',
    checkCommand: 'where fd',
    versionCommand: 'fd --version',
    installCommand: 'winget install sharkdp.fd',
    updateCommand: 'winget upgrade sharkdp.fd',
    category: 'utility',
    officialSite: 'https://github.com/sharkdp/fd',
    documentation: 'https://github.com/sharkdp/fd#readme',
  },
  {
    id: 'jq',
    name: 'jq',
    description: 'Command-line JSON processor',
    checkCommand: 'where jq',
    versionCommand: 'jq --version',
    installCommand: 'winget install jqlang.jq',
    updateCommand: 'winget upgrade jqlang.jq',
    category: 'utility',
    officialSite: 'https://jqlang.github.io/jq/',
    documentation: 'https://jqlang.github.io/jq/manual/',
  },
  {
    id: 'git-delta',
    name: 'git-delta',
    description: 'Syntax-highlighting pager for git diff',
    checkCommand: 'where delta',
    versionCommand: 'delta --version',
    installCommand: 'winget install dandavison.delta',
    updateCommand: 'winget upgrade dandavison.delta',
    category: 'development',
    officialSite: 'https://github.com/dandavison/delta',
    documentation: 'https://dandavison.github.io/delta/',
  },
  {
    id: 'fzf',
    name: 'fzf',
    description: 'Interactive fuzzy finder',
    checkCommand: 'where fzf',
    versionCommand: 'fzf --version',
    installCommand: 'winget install junegunn.fzf',
    updateCommand: 'winget upgrade junegunn.fzf',
    category: 'utility',
    officialSite: 'https://github.com/junegunn/fzf',
    documentation: 'https://github.com/junegunn/fzf#readme',
  },
  {
    id: 'bat',
    name: 'bat',
    description: 'cat clone with syntax highlighting',
    checkCommand: 'where bat',
    versionCommand: 'bat --version',
    installCommand: 'winget install sharkdp.bat',
    updateCommand: 'winget upgrade sharkdp.bat',
    category: 'utility',
    officialSite: 'https://github.com/sharkdp/bat',
    documentation: 'https://github.com/sharkdp/bat#readme',
  },
];
