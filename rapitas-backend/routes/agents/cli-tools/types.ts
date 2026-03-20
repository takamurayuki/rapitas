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
];
