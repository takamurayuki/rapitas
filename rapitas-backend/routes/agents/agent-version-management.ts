/**
 * Agent Version Management API Routes
 * Version control, installation, and update management for AI agents
 */
import { Elysia, t } from "elysia";
import { prisma } from "../config/database";
import { logAgentConfigChange } from "../utils/agent-audit-log";

// 型定義
interface VersionInfo {
  version: string;
  releaseDate: string;
  description: string;
  features: string[];
  breaking: boolean;
  downloadUrl: string;
  fileSize: string;
}

// シミュレーション用のエージェント利用可能バージョン情報
const AVAILABLE_AGENT_VERSIONS: Record<string, Record<string, VersionInfo>> = {
  "claude-code": {
    "2.1.0": {
      version: "2.1.0",
      releaseDate: "2024-02-15T10:00:00Z",
      description: "Performance improvements and bug fixes",
      features: ["Improved code analysis", "Better error handling", "Enhanced security"],
      breaking: false,
      downloadUrl: "https://releases.example.com/claude-code/2.1.0",
      fileSize: "45.2MB"
    },
    "2.0.1": {
      version: "2.0.1",
      releaseDate: "2024-01-28T14:30:00Z",
      description: "Security patch release",
      features: ["Security vulnerability fixes", "Dependency updates"],
      breaking: false,
      downloadUrl: "https://releases.example.com/claude-code/2.0.1",
      fileSize: "43.8MB"
    },
    "2.0.0": {
      version: "2.0.0",
      releaseDate: "2024-01-15T09:00:00Z",
      description: "Major release with new features",
      features: ["New task execution engine", "Parallel processing", "Enhanced AI models"],
      breaking: true,
      downloadUrl: "https://releases.example.com/claude-code/2.0.0",
      fileSize: "42.5MB"
    }
  },
  "chatgpt-assistant": {
    "1.4.2": {
      version: "1.4.2",
      releaseDate: "2024-02-10T16:45:00Z",
      description: "ChatGPT-4 Turbo integration",
      features: ["GPT-4 Turbo support", "Improved context handling", "Faster response times"],
      breaking: false,
      downloadUrl: "https://releases.example.com/chatgpt-assistant/1.4.2",
      fileSize: "38.7MB"
    },
    "1.4.1": {
      version: "1.4.1",
      releaseDate: "2024-01-25T11:20:00Z",
      description: "Bug fixes and stability improvements",
      features: ["Memory leak fixes", "API rate limiting", "Better error messages"],
      breaking: false,
      downloadUrl: "https://releases.example.com/chatgpt-assistant/1.4.1",
      fileSize: "37.9MB"
    }
  },
  "gemini-pro": {
    "1.2.0": {
      version: "1.2.0",
      releaseDate: "2024-02-05T13:15:00Z",
      description: "Gemini Pro 1.5 integration",
      features: ["Gemini Pro 1.5 support", "Enhanced multimodal capabilities", "Better reasoning"],
      breaking: false,
      downloadUrl: "https://releases.example.com/gemini-pro/1.2.0",
      fileSize: "41.3MB"
    }
  }
};

export const agentVersionManagementRoutes = new Elysia()
  // Get available versions for all agents
  .get("/agents/versions", async () => {
    try {
      const agents = await prisma.aIAgentConfig.findMany({
        where: { isActive: true },
        select: {
          id: true,
          agentType: true,
          name: true,
          version: true,
          latestVersion: true,
          isInstalled: true,
          installPath: true,
          updatedAt: true
        }
      });

      const agentsWithVersions = agents.map(agent => {
        const availableVersions = AVAILABLE_AGENT_VERSIONS[agent.agentType as keyof typeof AVAILABLE_AGENT_VERSIONS] || {};
        const versionList = (Object.values(availableVersions) as VersionInfo[]).sort((a, b) =>
          new Date(b.releaseDate).getTime() - new Date(a.releaseDate).getTime()
        );

        return {
          ...agent,
          availableVersions: versionList,
          hasUpdate: agent.version && agent.latestVersion ?
            agent.version !== agent.latestVersion : false,
          status: agent.isInstalled ? "installed" : "not_installed"
        };
      });

      return {
        success: true,
        data: agentsWithVersions
      };
    } catch (error) {
      console.error("[Agent Version Management] Error fetching agent versions:", error);
      return {
        success: false,
        error: "Failed to fetch agent versions",
        details: error instanceof Error ? error.message : String(error)
      };
    }
  })

  // Get version details for specific agent
  .get("/agent-types/:agentType/versions", async ({ params }) => {
    try {
      const { agentType } = params;

      const agent = await prisma.aIAgentConfig.findFirst({
        where: {
          agentType: agentType,
          isActive: true
        }
      });

      if (!agent) {
        return {
          success: false,
          error: "Agent not found"
        };
      }

      const availableVersions = AVAILABLE_AGENT_VERSIONS[agentType as keyof typeof AVAILABLE_AGENT_VERSIONS] || {};
      const versionList = Object.values(availableVersions).sort((a, b) =>
        new Date(b.releaseDate).getTime() - new Date(a.releaseDate).getTime()
      );

      return {
        success: true,
        data: {
          agent: {
            id: agent.id,
            agentType: agent.agentType,
            name: agent.name,
            currentVersion: agent.version,
            latestVersion: agent.latestVersion,
            isInstalled: agent.isInstalled,
            installPath: agent.installPath
          },
          availableVersions: versionList,
          hasUpdate: agent.version && agent.latestVersion ?
            agent.version !== agent.latestVersion : false
        }
      };
    } catch (error) {
      console.error("[Agent Version Management] Error fetching agent version details:", error);
      return {
        success: false,
        error: "Failed to fetch agent version details",
        details: error instanceof Error ? error.message : String(error)
      };
    }
  })

  // Update agent to specific version
  .post("/agents/:id/update", async ({ params, body }) => {
    try {
      const agentId = parseInt(params.id);
      const { targetVersion } = body as { targetVersion: string };

      const agent = await prisma.aIAgentConfig.findUnique({
        where: { id: agentId }
      });

      if (!agent) {
        return {
          success: false,
          error: "Agent not found"
        };
      }

      // バージョン情報を検証
      const availableVersions = AVAILABLE_AGENT_VERSIONS[agent.agentType as keyof typeof AVAILABLE_AGENT_VERSIONS];
      const targetVersionInfo = availableVersions?.[targetVersion as keyof typeof availableVersions];

      if (!targetVersionInfo) {
        return {
          success: false,
          error: "Target version not available"
        };
      }

      const previousVersion = agent.version;

      // エージェント設定を更新
      const updatedAgent = await prisma.aIAgentConfig.update({
        where: { id: agentId },
        data: {
          version: targetVersion,
          latestVersion: Object.keys(availableVersions || {}).sort((a, b) =>
            new Date(availableVersions[b as keyof typeof availableVersions].releaseDate).getTime() -
            new Date(availableVersions[a as keyof typeof availableVersions].releaseDate).getTime()
          )[0],
          isInstalled: true,
          installPath: `/usr/local/agents/${agent.agentType}/${targetVersion}`,
          updatedAt: new Date()
        }
      });

      // 変更ログを記録
      await logAgentConfigChange({
        agentConfigId: agentId,
        action: "update_version",
        changeDetails: {
          from: previousVersion,
          to: targetVersion,
          versionInfo: targetVersionInfo
        },
        previousValues: { version: previousVersion },
        newValues: { version: targetVersion }
      });

      return {
        success: true,
        data: {
          agent: updatedAgent,
          versionInfo: targetVersionInfo,
          message: `Successfully updated ${agent.name} from version ${previousVersion || 'none'} to ${targetVersion}`
        }
      };

    } catch (error) {
      console.error("[Agent Version Management] Error updating agent version:", error);
      return {
        success: false,
        error: "Failed to update agent version",
        details: error instanceof Error ? error.message : String(error)
      };
    }
  })

  // Install agent
  .post("/agents/:id/install", async ({ params }) => {
    try {
      const agentId = parseInt(params.id);

      const agent = await prisma.aIAgentConfig.findUnique({
        where: { id: agentId }
      });

      if (!agent) {
        return {
          success: false,
          error: "Agent not found"
        };
      }

      if (agent.isInstalled) {
        return {
          success: false,
          error: "Agent is already installed"
        };
      }

      // 最新バージョンを取得
      const availableVersions = AVAILABLE_AGENT_VERSIONS[agent.agentType as keyof typeof AVAILABLE_AGENT_VERSIONS];
      const latestVersion = availableVersions ? Object.keys(availableVersions).sort((a, b) =>
        new Date(availableVersions[b as keyof typeof availableVersions].releaseDate).getTime() -
        new Date(availableVersions[a as keyof typeof availableVersions].releaseDate).getTime()
      )[0] : "1.0.0";

      // エージェントをインストール済みに更新
      const updatedAgent = await prisma.aIAgentConfig.update({
        where: { id: agentId },
        data: {
          version: latestVersion,
          latestVersion: latestVersion,
          isInstalled: true,
          installPath: `/usr/local/agents/${agent.agentType}/${latestVersion}`,
          updatedAt: new Date()
        }
      });

      // 変更ログを記録
      await logAgentConfigChange({
        agentConfigId: agentId,
        action: "install",
        changeDetails: {
          version: latestVersion,
          installPath: updatedAgent.installPath
        },
        previousValues: { isInstalled: false },
        newValues: { isInstalled: true }
      });

      return {
        success: true,
        data: {
          agent: updatedAgent,
          message: `Successfully installed ${agent.name} version ${latestVersion}`
        }
      };

    } catch (error) {
      console.error("[Agent Version Management] Error installing agent:", error);
      return {
        success: false,
        error: "Failed to install agent",
        details: error instanceof Error ? error.message : String(error)
      };
    }
  })

  // Uninstall agent
  .post("/agents/:id/uninstall", async ({ params }) => {
    try {
      const agentId = parseInt(params.id);

      const agent = await prisma.aIAgentConfig.findUnique({
        where: { id: agentId }
      });

      if (!agent) {
        return {
          success: false,
          error: "Agent not found"
        };
      }

      if (!agent.isInstalled) {
        return {
          success: false,
          error: "Agent is not installed"
        };
      }

      const previousVersion = agent.version;
      const previousPath = agent.installPath;

      // エージェントをアンインストール状態に更新
      const updatedAgent = await prisma.aIAgentConfig.update({
        where: { id: agentId },
        data: {
          version: null,
          isInstalled: false,
          installPath: null,
          updatedAt: new Date()
        }
      });

      // 変更ログを記録
      await logAgentConfigChange({
        agentConfigId: agentId,
        action: "uninstall",
        changeDetails: {
          previousVersion,
          previousPath
        },
        previousValues: {
          isInstalled: true,
          version: previousVersion,
          installPath: previousPath
        },
        newValues: {
          isInstalled: false,
          version: null,
          installPath: null
        }
      });

      return {
        success: true,
        data: {
          agent: updatedAgent,
          message: `Successfully uninstalled ${agent.name}`
        }
      };

    } catch (error) {
      console.error("[Agent Version Management] Error uninstalling agent:", error);
      return {
        success: false,
        error: "Failed to uninstall agent",
        details: error instanceof Error ? error.message : String(error)
      };
    }
  })

  // Get version history for agent
  .get("/agents/:id/version-history", async ({ params }) => {
    try {
      const agentId = parseInt(params.id);

      const agent = await prisma.aIAgentConfig.findUnique({
        where: { id: agentId }
      });

      if (!agent) {
        return {
          success: false,
          error: "Agent not found"
        };
      }

      // エージェント設定変更ログを取得
      const auditLogs = await prisma.agentConfigAuditLog.findMany({
        where: {
          agentConfigId: agentId,
          action: {
            in: ["update_version", "install", "uninstall"]
          }
        },
        orderBy: { createdAt: "desc" },
        take: 20
      });

      const versionHistory = auditLogs.map(log => {
        let changeDetails: any = {};
        let previousValues: any = {};
        let newValues: any = {};

        try {
          if (log.changeDetails) changeDetails = JSON.parse(log.changeDetails);
          if (log.previousValues) previousValues = JSON.parse(log.previousValues);
          if (log.newValues) newValues = JSON.parse(log.newValues);
        } catch (e) {
          // JSON解析エラーは無視
        }

        return {
          id: log.id,
          action: log.action,
          timestamp: log.createdAt,
          changeDetails,
          previousValues,
          newValues,
          description: getVersionChangeDescription(log.action, changeDetails, previousValues, newValues)
        };
      });

      return {
        success: true,
        data: {
          agent: {
            id: agent.id,
            name: agent.name,
            agentType: agent.agentType,
            currentVersion: agent.version,
            isInstalled: agent.isInstalled
          },
          versionHistory
        }
      };

    } catch (error) {
      console.error("[Agent Version Management] Error fetching version history:", error);
      return {
        success: false,
        error: "Failed to fetch version history",
        details: error instanceof Error ? error.message : String(error)
      };
    }
  });

/**
 * バージョン変更の説明文を生成
 */
function getVersionChangeDescription(
  action: string,
  changeDetails: any,
  previousValues: any,
  newValues: any
): string {
  switch (action) {
    case "update_version":
      const from = changeDetails?.from || previousValues?.version || "unknown";
      const to = changeDetails?.to || newValues?.version || "unknown";
      return `Updated from version ${from} to ${to}`;

    case "install":
      const installVersion = changeDetails?.version || newValues?.version || "unknown";
      return `Installed version ${installVersion}`;

    case "uninstall":
      const uninstallVersion = changeDetails?.previousVersion || previousValues?.version || "unknown";
      return `Uninstalled version ${uninstallVersion}`;

    default:
      return `Action: ${action}`;
  }
}