/**
 * Themes API Routes
 * Handles theme CRUD operations and default theme management
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../config/database';
import { themeSchema } from '../../schemas/theme.schema';
import { NotFoundError, ValidationError } from '../../middleware/error-handler';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

export const themesRoutes = new Elysia({ prefix: '/themes' })
  // Get all themes
  .get('/', async () => {
    return await prisma.theme.findMany({
      include: {
        _count: {
          select: { tasks: true },
        },
        category: true,
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });
  })

  // Get default theme (must be before /:id to avoid route conflict)
  .get('/default/get', async () => {
    return await prisma.theme.findFirst({
      where: { isDefault: true },
      include: { category: true },
    });
  })

  // Get theme by ID
  .get('/:id', async (context) => {
    const { params } = context;
    const id = parseInt(params.id);
    if (isNaN(id)) {
      throw new ValidationError('無効なIDです');
    }

    const theme = await prisma.theme.findUnique({
      where: { id },
      include: {
        category: true,
        tasks: {
          where: { parentId: null },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!theme) {
      throw new NotFoundError('テーマが見つかりません');
    }

    return theme;
  })

  // Create theme (categoryId is required)
  .post(
    '/',
    async (context) => {
      const { body } = context;
      const {
        name,
        description,
        color,
        icon,
        isDevelopment,
        repositoryUrl,
        workingDirectory,
        defaultBranch,
        categoryId,
      } = body as {
        name: string;
        description?: string;
        color?: string;
        icon?: string;
        isDevelopment?: boolean;
        repositoryUrl?: string;
        workingDirectory?: string;
        defaultBranch?: string;
        categoryId: number;
      };

      return await prisma.theme.create({
        data: {
          name,
          categoryId,
          ...(description && { description }),
          ...(color && { color }),
          ...(icon && { icon }),
          ...(isDevelopment !== undefined && { isDevelopment }),
          ...(repositoryUrl && { repositoryUrl }),
          ...(workingDirectory && { workingDirectory }),
          ...(defaultBranch && { defaultBranch }),
        },
        include: { category: true },
      });
    },
    {
      body: themeSchema.create,
    },
  )

  // Update theme
  .patch(
    '/:id',
    async (context) => {
      const { params, body } = context;
      const id = parseInt(params.id);
      if (isNaN(id)) {
        throw new ValidationError('無効なIDです');
      }

      // Check if theme exists
      const existingTheme = await prisma.theme.findUnique({
        where: { id },
      });

      if (!existingTheme) {
        throw new NotFoundError('テーマが見つかりません');
      }

      const {
        name,
        description,
        color,
        icon,
        isDevelopment,
        repositoryUrl,
        workingDirectory,
        defaultBranch,
        categoryId,
      } = body as {
        name?: string;
        description?: string;
        color?: string;
        icon?: string;
        isDevelopment?: boolean;
        repositoryUrl?: string;
        workingDirectory?: string;
        defaultBranch?: string;
        categoryId?: number | null;
        sortOrder?: number;
      };

      const updateData: Record<string, unknown> = {};
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (color !== undefined) updateData.color = color;
      if (icon !== undefined) updateData.icon = icon;
      if (isDevelopment !== undefined) updateData.isDevelopment = isDevelopment;
      if (repositoryUrl !== undefined) updateData.repositoryUrl = repositoryUrl;
      if (workingDirectory !== undefined) updateData.workingDirectory = workingDirectory;
      if (defaultBranch !== undefined) updateData.defaultBranch = defaultBranch;
      if (categoryId !== undefined) updateData.categoryId = categoryId;

      // Auto-link to Development category when isDevelopment is being set to true and no categoryId specified
      if (isDevelopment === true && categoryId === undefined && !existingTheme.categoryId) {
        const devCategory = await prisma.category.findFirst({
          where: { name: '開発', isDefault: true },
        });
        if (devCategory) {
          updateData.categoryId = devCategory.id;
        }
      }

      return await prisma.theme.update({
        where: { id },
        data: updateData,
        include: { category: true },
      });
    },
    {
      body: themeSchema.update,
    },
  )

  // Delete theme
  .delete('/:id', async (context) => {
    const { params } = context;
    const id = parseInt(params.id);
    if (isNaN(id)) {
      throw new ValidationError('無効なIDです');
    }

    return await prisma.theme.delete({
      where: { id },
    });
  })

  // Reorder themes
  .patch('/reorder', async (context) => {
    const { body } = context;
    const { orders } = body as { orders: Array<{ id: number; sortOrder: number }> };

    await Promise.all(
      orders.map(({ id, sortOrder }) =>
        prisma.theme.update({
          where: { id },
          data: { sortOrder },
        }),
      ),
    );

    return { success: true };
  })

  // Set default theme (per category: only one default per category)
  .patch('/:id/set-default', async (context) => {
    const { params } = context;
    const id = parseInt(params.id);
    if (isNaN(id)) {
      throw new ValidationError('無効なIDです');
    }

    // Get the theme to find its category
    const theme = await prisma.theme.findUnique({
      where: { id },
    });

    if (!theme) {
      throw new NotFoundError('テーマが見つかりません');
    }

    // Reset isDefault for themes in the same category only
    if (theme.categoryId) {
      await prisma.theme.updateMany({
        where: { categoryId: theme.categoryId, isDefault: true },
        data: { isDefault: false },
      });
    } else {
      // If no category, reset all themes without a category
      await prisma.theme.updateMany({
        where: { categoryId: null, isDefault: true },
        data: { isDefault: false },
      });
    }

    // Set the specified theme as default
    return await prisma.theme.update({
      where: { id },
      data: { isDefault: true },
      include: { category: true },
    });
  })

  // Setup theme from CLAUDE.md with directory initialization
  .post(
    '/setup-from-claude-md',
    async (context) => {
      const { body } = context;
      const { appName, claudeMd, basePath, description } = body as {
        appName: string;
        claudeMd: string;
        basePath?: string;
        description?: string;
      };

      try {
        // Sanitize app name to create folder name (kebab-case, ASCII-safe)
        const sanitizedAppName = appName
          .toLowerCase()
          .replace(/[^a-z0-9\s-]/g, '') // Remove non-alphanumeric chars except spaces and hyphens
          .replace(/\s+/g, '-') // Replace spaces with hyphens
          .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
          .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens

        if (!sanitizedAppName) {
          throw new ValidationError('アプリ名から有効なフォルダ名を生成できませんでした');
        }

        // Determine base path (default to user home Projects folder)
        const defaultBasePath =
          process.platform === 'win32'
            ? path.join(require('os').homedir(), 'Projects')
            : path.join(require('os').homedir(), 'Projects');

        const projectBasePath = basePath || defaultBasePath;
        const projectPath = path.join(projectBasePath, sanitizedAppName);

        // Check if directory already exists
        if (fs.existsSync(projectPath)) {
          throw new ValidationError(`フォルダ「${sanitizedAppName}」は既に存在します`);
        }

        // Create directory
        fs.mkdirSync(projectPath, { recursive: true });

        // Initialize git repository
        try {
          execSync('git init', { cwd: projectPath, stdio: 'pipe' });
        } catch (error) {
          throw new ValidationError('Git リポジトリの初期化に失敗しました');
        }

        // Create .claude directory
        const claudeDir = path.join(projectPath, '.claude');
        fs.mkdirSync(claudeDir, { recursive: true });

        // Write CLAUDE.md file
        const claudeFilePath = path.join(claudeDir, 'CLAUDE.md');
        fs.writeFileSync(claudeFilePath, claudeMd, 'utf8');

        // Make initial commit
        try {
          execSync('git add .', { cwd: projectPath, stdio: 'pipe' });
          execSync('git commit -m "chore: initialize project with CLAUDE.md"', {
            cwd: projectPath,
            stdio: 'pipe',
          });
        } catch (error) {
          throw new ValidationError('初期コミットの作成に失敗しました');
        }

        // Find or create Development category
        let devCategory = await prisma.category.findFirst({
          where: { name: '開発', isDefault: true },
        });

        if (!devCategory) {
          // Create Development category if it doesn't exist
          devCategory = await prisma.category.create({
            data: {
              name: '開発',
              mode: 'development',
              isDefault: true,
            },
          });
        }

        // Create theme record
        const theme = await prisma.theme.create({
          data: {
            name: appName,
            description: description || `${appName}プロジェクトのテーマ`,
            categoryId: devCategory.id,
            isDevelopment: true,
            workingDirectory: projectPath,
            defaultBranch: 'main',
          },
          include: { category: true },
        });

        return {
          success: true,
          theme,
          projectPath,
          message: 'テーマとプロジェクトディレクトリが正常に作成されました',
        };
      } catch (error) {
        // Clean up if something went wrong
        const projectPath = basePath
          ? path.join(
              basePath,
              appName
                .toLowerCase()
                .replace(/[^a-z0-9\s-]/g, '')
                .replace(/\s+/g, '-'),
            )
          : path.join(
              require('os').homedir(),
              'Projects',
              appName
                .toLowerCase()
                .replace(/[^a-z0-9\s-]/g, '')
                .replace(/\s+/g, '-'),
            );

        if (fs.existsSync(projectPath)) {
          try {
            fs.rmSync(projectPath, { recursive: true, force: true });
          } catch {
            // Ignore cleanup errors
          }
        }

        if (error instanceof ValidationError) {
          throw error;
        } else {
          throw new ValidationError(
            error instanceof Error ? error.message : 'テーマ作成中にエラーが発生しました',
          );
        }
      }
    },
    {
      body: themeSchema.setupFromClaudeMd,
    },
  );
