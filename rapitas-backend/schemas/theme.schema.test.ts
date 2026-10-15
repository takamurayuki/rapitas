/**
 * theme.schema.test
 *
 * Guards the setup-from-claude-md body contract. Elysia validates the body
 * against this schema BEFORE the handler runs, so a field the handler reads but
 * the schema does not declare never arrives — which is exactly how the category
 * picker shipped with no effect. These tests pin the fields the handler depends
 * on by driving a real Elysia route, not by inspecting the schema object.
 */

import { describe, expect, it } from 'bun:test';
import { Elysia } from 'elysia';
import { themeSchema } from './theme.schema';

/** Posts a body through a route guarded by the real schema. */
async function postBody(body: unknown) {
  const app = new Elysia().post('/t', ({ body: b }) => ({ keys: Object.keys(b as object) }), {
    body: themeSchema.setupFromClaudeMd,
  });
  const res = await app.handle(
    new Request('http://localhost/t', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, json: (await res.json()) as { keys?: string[] } };
}

const MINIMAL = { appName: 'ContextFlow', claudeMd: '# guide' };

describe('themeSchema.setupFromClaudeMd', () => {
  it('reaches the handler with the minimal required fields', async () => {
    const { status, json } = await postBody(MINIMAL);
    expect(status).toBe(200);
    expect(json.keys).toContain('appName');
  });

  it('delivers categoryId to the handler', async () => {
    const { status, json } = await postBody({ ...MINIMAL, categoryId: 7 });
    expect(status).toBe(200);
    expect(json.keys).toContain('categoryId');
  });

  it('delivers adr to the handler', async () => {
    const { status, json } = await postBody({ ...MINIMAL, adr: '# ADR' });
    expect(status).toBe(200);
    expect(json.keys).toContain('adr');
  });

  it('delivers the project skeleton to the handler', async () => {
    const { status, json } = await postBody({
      ...MINIMAL,
      scaffold: [{ path: 'package.json', content: '{}' }],
    });
    expect(status).toBe(200);
    expect(json.keys).toContain('scaffold');
  });

  it('delivers the docs and target fields the handler writes', async () => {
    const { status, json } = await postBody({
      ...MINIMAL,
      requirements: '# req',
      design: '# design',
      adr: '# adr',
      agentFilePath: 'AGENTS.md',
      basePath: 'C:/Projects',
      description: 'tagline',
      categoryId: 3,
    });
    expect(status).toBe(200);
    // Every field setup-from-claude-md destructures must survive validation.
    for (const k of [
      'requirements',
      'design',
      'adr',
      'agentFilePath',
      'basePath',
      'description',
      'categoryId',
    ]) {
      expect(json.keys).toContain(k);
    }
  });

  it('still rejects an empty appName', async () => {
    const { status } = await postBody({ appName: '', claudeMd: '# guide' });
    expect(status).toBe(422);
  });
});
