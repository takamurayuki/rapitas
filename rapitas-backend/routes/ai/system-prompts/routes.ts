/**
 * SystemPrompts / Routes
 *
 * Elysia route handlers for the system-prompts CRUD API.
 * Not responsible for the seed-data definitions (see default-prompts.ts).
 */

import { Elysia } from 'elysia';
import { prisma } from '../../../config/database';
import { NotFoundError, ValidationError, ConflictError } from '../../../middleware/error-handler';
import { DEFAULT_SYSTEM_PROMPTS } from './default-prompts';

export const systemPromptsRoutes = new Elysia()
  .get('/system-prompts', async (context) => {
    const { query } = context;
    const where: Record<string, unknown> = {};
    if (query.category) {
      where.category = query.category;
    }

    const prompts = await prisma.systemPrompt.findMany({
      where,
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });

    return prompts;
  })

  .get('/system-prompts/:key', async (context) => {
    const { params } = context;
    const prompt = await prisma.systemPrompt.findUnique({
      where: { key: params.key },
    });

    if (!prompt) {
      throw new NotFoundError('システムプロンプトが見つかりません');
    }

    return prompt;
  })

  .post('/system-prompts', async (context) => {
    const { body } = context;
    const { key, name, description, content, category } = body as {
      key: string;
      name: string;
      description?: string;
      content: string;
      category?: string;
    };

    if (!key || !name || !content) {
      throw new ValidationError('key, name, content は必須です');
    }

    const existing = await prisma.systemPrompt.findUnique({
      where: { key },
    });

    if (existing) {
      throw new ConflictError('同じキーのプロンプトが既に存在します');
    }

    const prompt = await prisma.systemPrompt.create({
      data: {
        key,
        name,
        description,
        content,
        category: category || 'general',
        isDefault: false,
      },
    });

    return prompt;
  })

  .patch('/system-prompts/:key', async (context) => {
    const { params, body } = context;
    const existing = await prisma.systemPrompt.findUnique({
      where: { key: params.key },
    });

    if (!existing) {
      throw new NotFoundError('システムプロンプトが見つかりません');
    }

    const { name, description, content, category, isActive } = body as {
      name?: string;
      description?: string;
      content?: string;
      category?: string;
      isActive?: boolean;
    };

    const updated = await prisma.systemPrompt.update({
      where: { key: params.key },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(content !== undefined && { content }),
        ...(category !== undefined && { category }),
        ...(isActive !== undefined && { isActive }),
      },
    });

    return updated;
  })

  // NOTE: Default prompts cannot be deleted — use PATCH isActive:false to disable them
  .delete('/system-prompts/:key', async (context) => {
    const { params } = context;
    const existing = await prisma.systemPrompt.findUnique({
      where: { key: params.key },
    });

    if (!existing) {
      throw new NotFoundError('システムプロンプトが見つかりません');
    }

    if (existing.isDefault) {
      throw new ValidationError('デフォルトプロンプトは削除できません。無効化してください。');
    }

    await prisma.systemPrompt.delete({
      where: { key: params.key },
    });

    return { success: true };
  })

  // Reset a default prompt to its original content
  .post('/system-prompts/:key/reset', async (context) => {
    const { params } = context;
    const defaultPrompt = DEFAULT_SYSTEM_PROMPTS.find((p) => p.key === params.key);
    if (!defaultPrompt) {
      throw new NotFoundError('デフォルトプロンプトが見つかりません');
    }

    const updated = await prisma.systemPrompt.upsert({
      where: { key: params.key },
      update: {
        content: defaultPrompt.content,
        name: defaultPrompt.name,
        description: defaultPrompt.description,
        category: defaultPrompt.category,
        isActive: true,
        isDefault: true,
      },
      create: {
        ...defaultPrompt,
        isActive: true,
        isDefault: true,
      },
    });

    return updated;
  })

  // Seed default prompts (idempotent — safe to call multiple times)
  .post('/system-prompts/seed', async () => {
    const results: Array<{ key: string; action: string }> = [];

    for (const prompt of DEFAULT_SYSTEM_PROMPTS) {
      const existing = await prisma.systemPrompt.findUnique({
        where: { key: prompt.key },
      });

      if (!existing) {
        await prisma.systemPrompt.create({
          data: {
            ...prompt,
            isActive: true,
            isDefault: true,
          },
        });
        results.push({ key: prompt.key, action: 'created' });
      } else {
        results.push({ key: prompt.key, action: 'skipped' });
      }
    }

    return { results };
  });
