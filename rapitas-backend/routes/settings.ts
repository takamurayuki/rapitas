/**
 * User Settings API Routes
 */
import { Elysia, t } from "elysia";
import { prisma } from "../config/database";
import { isApiKeyConfiguredAsync } from "../services/claude-agent";

export const settingsRoutes = new Elysia({ prefix: "/settings" })
  // Get settings (create if not exists)
  .get("/", async () => {
    let settings = await prisma.userSettings.findFirst();
    if (!settings) {
      settings = await prisma.userSettings.create({
        data: {},
      });
    }
    const apiKeyConfigured = await isApiKeyConfiguredAsync();
    return {
      ...settings,
      claudeApiKeyConfigured: apiKeyConfigured,
    };
  })

  // Update settings
  .patch(
    "/",
    async ({ body }: {
      body: {
        developerModeDefault?: boolean;
        aiTaskAnalysisDefault?: boolean;
        autoResumeInterruptedTasks?: boolean;
      }
    }) => {
      const { developerModeDefault, aiTaskAnalysisDefault, autoResumeInterruptedTasks } = body;

      let settings = await prisma.userSettings.findFirst();
      if (!settings) {
        settings = await prisma.userSettings.create({
          data: {
            developerModeDefault: developerModeDefault ?? false,
            aiTaskAnalysisDefault: aiTaskAnalysisDefault ?? false,
            autoResumeInterruptedTasks: autoResumeInterruptedTasks ?? false,
          },
        });
      } else {
        settings = await prisma.userSettings.update({
          where: { id: settings.id },
          data: {
            ...(developerModeDefault !== undefined && { developerModeDefault }),
            ...(aiTaskAnalysisDefault !== undefined && { aiTaskAnalysisDefault }),
            ...(autoResumeInterruptedTasks !== undefined && { autoResumeInterruptedTasks }),
          },
        });
      }

      return settings;
    },
    {
      body: t.Object({
        developerModeDefault: t.Optional(t.Boolean()),
        aiTaskAnalysisDefault: t.Optional(t.Boolean()),
        autoResumeInterruptedTasks: t.Optional(t.Boolean()),
      }),
    }
  )

  // Get API status
  .get("/api-status", async () => {
    const apiKeyConfigured = await isApiKeyConfiguredAsync();
    return {
      claudeApiKeyConfigured: apiKeyConfigured,
    };
  });
