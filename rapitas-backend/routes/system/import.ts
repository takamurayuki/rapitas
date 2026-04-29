/**
 * Import Routes
 *
 * HTTP routes for importing user data from various formats (JSON backup).
 * Supports restoring tasks, projects, labels, and other user data from backups.
 */

import { Elysia, t } from 'elysia';
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';

const log = createLogger('routes:import');

/**
 * Validates the backup file structure
 */
function validateBackupStructure(data: unknown): data is {
  version: string;
  data: {
    tasks?: unknown[];
    projects?: unknown[];
    milestones?: unknown[];
    labels?: unknown[];
    categories?: unknown[];
    themes?: unknown[];
    habits?: unknown[];
    habitLogs?: unknown[];
    flashcardDecks?: unknown[];
    flashcards?: unknown[];
    examGoals?: unknown[];
    learningGoals?: unknown[];
    studyStreaks?: unknown[];
    scheduleEvents?: unknown[];
    timeEntries?: unknown[];
    pomodoroSessions?: unknown[];
  };
} {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  if (!obj.data || typeof obj.data !== 'object') return false;
  return true;
}

/**
 * Import result tracking
 */
interface ImportResult {
  success: boolean;
  imported: Record<string, number>;
  skipped: Record<string, number>;
  errors: string[];
}

export const importRoutes = new Elysia({ prefix: '/import' })
  /**
   * Import tasks from JSON
   */
  .post(
    '/tasks',
    async ({ body }) => {
      const { tasks, skipExisting } = body as {
        tasks: Array<{
          title: string;
          description?: string;
          status?: string;
          priority?: string;
          dueDate?: string;
          estimatedHours?: number;
          labels?: string[];
          projectId?: number;
          themeId?: number;
        }>;
        skipExisting?: boolean;
      };

      const result: ImportResult = {
        success: true,
        imported: { tasks: 0 },
        skipped: { tasks: 0 },
        errors: [],
      };

      for (const task of tasks) {
        try {
          // Check for existing task with same title if skipExisting is true
          if (skipExisting) {
            const existing = await prisma.task.findFirst({
              where: { title: task.title },
            });
            if (existing) {
              result.skipped.tasks++;
              continue;
            }
          }

          await prisma.task.create({
            data: {
              title: task.title,
              description: task.description,
              status: task.status || 'todo',
              priority: task.priority || 'medium',
              dueDate: task.dueDate ? new Date(task.dueDate) : null,
              estimatedHours: task.estimatedHours,
              labels: JSON.stringify(task.labels || []),
              projectId: task.projectId,
              themeId: task.themeId,
            },
          });
          result.imported.tasks++;
        } catch (error) {
          result.errors.push(`Failed to import task "${task.title}": ${error}`);
        }
      }

      log.info(`Imported ${result.imported.tasks} tasks, skipped ${result.skipped.tasks}`);

      return result;
    },
    {
      body: t.Object({
        tasks: t.Array(
          t.Object({
            title: t.String(),
            description: t.Optional(t.String()),
            status: t.Optional(t.String()),
            priority: t.Optional(t.String()),
            dueDate: t.Optional(t.String()),
            estimatedHours: t.Optional(t.Number()),
            labels: t.Optional(t.Array(t.String())),
            projectId: t.Optional(t.Number()),
            themeId: t.Optional(t.Number()),
          }),
        ),
        skipExisting: t.Optional(t.Boolean({ default: true })),
      }),
    },
  )

  /**
   * Restore from full backup
   * Warning: This can overwrite existing data
   */
  .post(
    '/restore',
    async ({ body, query }) => {
      const { mode } = query;
      const backup = body;

      if (!validateBackupStructure(backup)) {
        return {
          success: false,
          error: 'Invalid backup file structure',
        };
      }

      const result: ImportResult = {
        success: true,
        imported: {},
        skipped: {},
        errors: [],
      };

      const { data } = backup;

      // Helper function to import entities
      async function importEntities<T extends Record<string, unknown>>(
        entityName: string,
        entities: T[] | undefined,
        createFn: (entity: T) => Promise<unknown>,
        findExisting?: (entity: T) => Promise<unknown>,
      ) {
        if (!entities || !Array.isArray(entities)) {
          result.skipped[entityName] = 0;
          result.imported[entityName] = 0;
          return;
        }

        result.imported[entityName] = 0;
        result.skipped[entityName] = 0;

        for (const entity of entities) {
          try {
            // Skip if exists and mode is 'skip'
            if (mode === 'skip' && findExisting) {
              const existing = await findExisting(entity);
              if (existing) {
                result.skipped[entityName]++;
                continue;
              }
            }

            await createFn(entity);
            result.imported[entityName]++;
          } catch (error) {
            result.errors.push(`Failed to import ${entityName}: ${error}`);
          }
        }
      }

      // Import categories first (no dependencies)
      await importEntities(
        'categories',
        data.categories as Array<{ name: string; description?: string; mode?: string }>,
        async (cat) => {
          await prisma.category.create({
            data: {
              name: cat.name,
              description: cat.description,
              mode: cat.mode || 'both',
            },
          });
        },
        async (cat) => prisma.category.findFirst({ where: { name: cat.name } }),
      );

      // Import labels
      await importEntities(
        'labels',
        data.labels as Array<{ name: string; color?: string; description?: string }>,
        async (label) => {
          await prisma.label.create({
            data: {
              name: label.name,
              color: label.color,
              description: label.description,
            },
          });
        },
        async (label) => prisma.label.findFirst({ where: { name: label.name } }),
      );

      // Import projects
      await importEntities(
        'projects',
        data.projects as Array<{ name: string; description?: string; color?: string }>,
        async (project) => {
          await prisma.project.create({
            data: {
              name: project.name,
              description: project.description,
              color: project.color,
            },
          });
        },
        async (project) => prisma.project.findFirst({ where: { name: project.name } }),
      );

      // Import habits
      await importEntities(
        'habits',
        data.habits as Array<{
          name: string;
          description?: string;
          frequency?: string;
          targetCount?: number;
        }>,
        async (habit) => {
          await prisma.habit.create({
            data: {
              name: habit.name,
              description: habit.description,
              frequency: habit.frequency || 'daily',
              targetCount: habit.targetCount || 1,
            },
          });
        },
        async (habit) => prisma.habit.findFirst({ where: { name: habit.name } }),
      );

      // Import exam goals
      await importEntities(
        'examGoals',
        data.examGoals as Array<{
          name: string;
          description?: string;
          examDate?: string;
          targetScore?: number;
        }>,
        async (goal) => {
          await prisma.examGoal.create({
            data: {
              name: goal.name,
              description: goal.description,
              examDate: goal.examDate ? new Date(goal.examDate) : new Date(),
              targetScore: goal.targetScore?.toString(),
            },
          });
        },
        async (goal) => prisma.examGoal.findFirst({ where: { name: goal.name } }),
      );

      // Import flashcard decks
      await importEntities(
        'flashcardDecks',
        data.flashcardDecks as Array<{ name: string; description?: string; color?: string }>,
        async (deck) => {
          await prisma.flashcardDeck.create({
            data: {
              name: deck.name,
              description: deck.description,
              color: deck.color,
            },
          });
        },
        async (deck) => prisma.flashcardDeck.findFirst({ where: { name: deck.name } }),
      );

      log.info(
        `Restore completed: imported=${JSON.stringify(result.imported)}, skipped=${JSON.stringify(result.skipped)}, errors=${result.errors.length}`,
      );

      return {
        success: result.errors.length === 0,
        timestamp: new Date().toISOString(),
        mode,
        imported: result.imported,
        skipped: result.skipped,
        errors: result.errors.slice(0, 10), // Limit errors in response
        totalErrors: result.errors.length,
      };
    },
    {
      query: t.Object({
        mode: t.Optional(t.Union([t.Literal('skip'), t.Literal('overwrite')], { default: 'skip' })),
      }),
    },
  )

  /**
   * Import from CSV (tasks only)
   */
  .post(
    '/tasks/csv',
    async ({ body }) => {
      const { csv, skipExisting } = body as {
        csv: string;
        skipExisting?: boolean;
      };

      const rows = parseCSVRows(csv);
      if (rows.length < 2) {
        return {
          success: false,
          error: 'CSV must have at least a header and one data row',
        };
      }

      const headers = rows[0].map((h) => h.trim().toLowerCase());
      const titleIndex = headers.indexOf('title');

      if (titleIndex === -1) {
        return {
          success: false,
          error: 'CSV must have a "title" column',
        };
      }

      const result: ImportResult = {
        success: true,
        imported: { tasks: 0 },
        skipped: { tasks: 0 },
        errors: [],
      };

      for (let i = 1; i < rows.length; i++) {
        const values = rows[i];
        const title = values[titleIndex]?.trim();

        if (!title) {
          result.errors.push(`Row ${i + 1}: Missing title`);
          continue;
        }

        try {
          if (skipExisting) {
            const existing = await prisma.task.findFirst({ where: { title } });
            if (existing) {
              result.skipped.tasks++;
              continue;
            }
          }

          const statusIndex = headers.indexOf('status');
          const priorityIndex = headers.indexOf('priority');
          const descriptionIndex = headers.indexOf('description');
          const dueDateIndex = headers.indexOf('duedate');

          await prisma.task.create({
            data: {
              title,
              description: descriptionIndex >= 0 ? values[descriptionIndex] : undefined,
              status: statusIndex >= 0 ? values[statusIndex] || 'todo' : 'todo',
              priority: priorityIndex >= 0 ? values[priorityIndex] || 'medium' : 'medium',
              dueDate:
                dueDateIndex >= 0 && values[dueDateIndex]
                  ? new Date(values[dueDateIndex])
                  : undefined,
            },
          });
          result.imported.tasks++;
        } catch (error) {
          result.errors.push(`Row ${i + 1}: ${error}`);
        }
      }

      log.info(`CSV import: ${result.imported.tasks} tasks imported`);

      return result;
    },
    {
      body: t.Object({
        csv: t.String(),
        skipExisting: t.Optional(t.Boolean({ default: true })),
      }),
    },
  );

/**
 * Helper function to parse CSV content correctly, handling quoted fields with newlines
 */
function parseCSVRows(csv: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentValue = '';
  let inQuotes = false;

  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];

    if (char === '"') {
      if (inQuotes && csv[i + 1] === '"') {
        // Escaped quote
        currentValue += '"';
        i++;
      } else {
        // Toggle quote mode
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      // End of field
      currentRow.push(currentValue.trim());
      currentValue = '';
    } else if ((char === '\n' || (char === '\r' && csv[i + 1] === '\n')) && !inQuotes) {
      // End of row
      if (char === '\r') i++; // Skip \r in \r\n
      currentRow.push(currentValue.trim());
      if (currentRow.some((v) => v)) {
        // Only add non-empty rows
        rows.push(currentRow);
      }
      currentRow = [];
      currentValue = '';
    } else if (char === '\r' && !inQuotes) {
      // Handle standalone \r as newline
      currentRow.push(currentValue.trim());
      if (currentRow.some((v) => v)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentValue = '';
    } else {
      currentValue += char;
    }
  }

  // Handle last row if not ending with newline
  if (currentValue || currentRow.length > 0) {
    currentRow.push(currentValue.trim());
    if (currentRow.some((v) => v)) {
      rows.push(currentRow);
    }
  }

  return rows;
}

/**
 * Parse a CSV line handling quoted values
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}
