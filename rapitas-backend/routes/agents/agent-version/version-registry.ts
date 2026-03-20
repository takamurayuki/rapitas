/**
 * Agent Version Registry
 *
 * Defines the VersionInfo type and the static registry of available agent versions.
 * Does not contain any route handlers or database access.
 */

/** Metadata describing a single releasable agent version. */
export interface VersionInfo {
  version: string;
  releaseDate: string;
  description: string;
  features: string[];
  breaking: boolean;
  downloadUrl: string;
  fileSize: string;
}

// NOTE: Simulated version registry — replace with actual registry API when available.
export const AVAILABLE_AGENT_VERSIONS: Record<string, Record<string, VersionInfo>> = {
  'claude-code': {
    '2.1.0': {
      version: '2.1.0',
      releaseDate: '2024-02-15T10:00:00Z',
      description: 'Performance improvements and bug fixes',
      features: ['Improved code analysis', 'Better error handling', 'Enhanced security'],
      breaking: false,
      downloadUrl: 'https://releases.example.com/claude-code/2.1.0',
      fileSize: '45.2MB',
    },
    '2.0.1': {
      version: '2.0.1',
      releaseDate: '2024-01-28T14:30:00Z',
      description: 'Security patch release',
      features: ['Security vulnerability fixes', 'Dependency updates'],
      breaking: false,
      downloadUrl: 'https://releases.example.com/claude-code/2.0.1',
      fileSize: '43.8MB',
    },
    '2.0.0': {
      version: '2.0.0',
      releaseDate: '2024-01-15T09:00:00Z',
      description: 'Major release with new features',
      features: ['New task execution engine', 'Parallel processing', 'Enhanced AI models'],
      breaking: true,
      downloadUrl: 'https://releases.example.com/claude-code/2.0.0',
      fileSize: '42.5MB',
    },
  },
  'chatgpt-assistant': {
    '1.4.2': {
      version: '1.4.2',
      releaseDate: '2024-02-10T16:45:00Z',
      description: 'ChatGPT-4 Turbo integration',
      features: ['GPT-4 Turbo support', 'Improved context handling', 'Faster response times'],
      breaking: false,
      downloadUrl: 'https://releases.example.com/chatgpt-assistant/1.4.2',
      fileSize: '38.7MB',
    },
    '1.4.1': {
      version: '1.4.1',
      releaseDate: '2024-01-25T11:20:00Z',
      description: 'Bug fixes and stability improvements',
      features: ['Memory leak fixes', 'API rate limiting', 'Better error messages'],
      breaking: false,
      downloadUrl: 'https://releases.example.com/chatgpt-assistant/1.4.1',
      fileSize: '37.9MB',
    },
  },
  'gemini-pro': {
    '1.2.0': {
      version: '1.2.0',
      releaseDate: '2024-02-05T13:15:00Z',
      description: 'Gemini Pro 1.5 integration',
      features: ['Gemini Pro 1.5 support', 'Enhanced multimodal capabilities', 'Better reasoning'],
      breaking: false,
      downloadUrl: 'https://releases.example.com/gemini-pro/1.2.0',
      fileSize: '41.3MB',
    },
  },
};

/**
 * Returns the latest version key for a given agent type by release date, or a fallback.
 *
 * @param agentType - Agent type identifier / エージェントタイプの識別子
 * @param fallback - Value returned when no versions are found / バージョンが見つからない場合の返却値
 * @returns Latest version string
 */
export function getLatestVersionKey(agentType: string, fallback = '1.0.0'): string {
  const versions = AVAILABLE_AGENT_VERSIONS[agentType];
  if (!versions) return fallback;

  return Object.keys(versions).sort(
    (a, b) =>
      new Date(versions[b].releaseDate).getTime() - new Date(versions[a].releaseDate).getTime(),
  )[0] ?? fallback;
}

/**
 * Generates a human-readable description for a version change audit entry.
 *
 * @param action - Audit action name / 監査アクション名
 * @param changeDetails - Parsed changeDetails JSON / 解析済みchangeDetails JSON
 * @param previousValues - Parsed previousValues JSON / 解析済みpreviousValues JSON
 * @param newValues - Parsed newValues JSON / 解析済みnewValues JSON
 * @returns Human-readable description string
 */
export function getVersionChangeDescription(
  action: string,
  changeDetails: Record<string, unknown>,
  previousValues: Record<string, unknown>,
  newValues: Record<string, unknown>,
): string {
  switch (action) {
    case 'update_version': {
      const from = changeDetails?.from || previousValues?.version || 'unknown';
      const to = changeDetails?.to || newValues?.version || 'unknown';
      return `Updated from version ${from} to ${to}`;
    }
    case 'install': {
      const installVersion = changeDetails?.version || newValues?.version || 'unknown';
      return `Installed version ${installVersion}`;
    }
    case 'uninstall': {
      const uninstallVersion =
        changeDetails?.previousVersion || previousValues?.version || 'unknown';
      return `Uninstalled version ${uninstallVersion}`;
    }
    default:
      return `Action: ${action}`;
  }
}
