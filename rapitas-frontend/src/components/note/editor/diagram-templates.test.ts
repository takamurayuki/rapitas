/**
 * diagram-templates.test
 *
 * Every starting point, through the real parser.
 *
 * This is the one test in the editor that does not mock mermaid, and that
 * is the point: a template is a promise that inserting it gives you
 * something that renders. The live preview re-renders as you type, so a
 * template that does not parse paints "Syntax error in text" the moment it
 * is clicked — the exact wall of errors this editor was fixed for. Mocking
 * the parser here would check that the strings exist, which nobody doubted.
 *
 * It also pins the version: these sources are accepted by mermaid 11.16.0
 * and a few of them (`radar-beta`, `kanban`, `ishikawa`) are recent enough
 * that a downgrade would quietly turn them back into errors.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type mermaidModule from 'mermaid';
import { DIAGRAM_TEMPLATES } from './diagram-templates';

let mermaid: typeof mermaidModule;

beforeAll(async () => {
  mermaid = (await import('mermaid')).default;
  // 'strict' to match the editor: a template that only parses under a looser
  // security level is not a template that works.
  mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'strict' });
});

describe('every template', () => {
  it.each(DIAGRAM_TEMPLATES.map((t) => [t.labelKey, t.source] as const))(
    'parses: %s',
    async (_label, source) => {
      await expect(mermaid.parse(source)).resolves.toBeTruthy();
    },
  );

  it('offers each label once, or two chips would do the same thing', () => {
    const labels = DIAGRAM_TEMPLATES.map((t) => t.labelKey);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('the parser this leans on', () => {
  // Without this the suite above could be green because `parse` resolves for
  // anything — which is how a gate ends up measuring nothing.
  it('rejects something that is not a diagram at all', async () => {
    await expect(mermaid.parse('これは図ではありません')).rejects.toThrow();
  });
});
