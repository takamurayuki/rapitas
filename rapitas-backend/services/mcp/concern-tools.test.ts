/**
 * concern-tools.test
 *
 * submitConcern does not always file what it is given: a near-duplicate is
 * merged into the existing concern and some filings are suppressed outright.
 * The tool therefore has to say which happened — a caller told only an id
 * would believe it filed something new and move on, which is the failure this
 * file exists to prevent.
 */
import { describe, expect, it, mock, beforeEach } from 'bun:test';
import type { ConcernFilingResult, SubmitConcernInput } from '../memory/concern-backlog-types';

const submitCalls: SubmitConcernInput[] = [];
let nextResult: ConcernFilingResult = { id: 1, outcome: 'created', reason: 'new', stored: true };

const submitConcern = mock(async (input: SubmitConcernInput): Promise<ConcernFilingResult> => {
  submitCalls.push(input);
  return nextResult;
});

// The real module is spread in so all fourteen of its exports are mirrored —
// Bun replaces the whole module, and a missing one makes this file's tests
// vanish rather than fail.
const actualService = await import('../memory/concern-backlog-service');
mock.module('../memory/concern-backlog-service', () => ({
  ...actualService,
  submitConcern,
}));

const { CONCERN_TOOL_DEFINITIONS, executeConcernTool } = await import('./concern-tools');

async function file(args: Record<string, string>): Promise<string> {
  const result = await executeConcernTool('rapitas_create_concern', args);
  if (result === null) throw new Error('the tool was not routed');
  return result.content[0].text;
}

beforeEach(() => {
  submitCalls.length = 0;
  nextResult = { id: 1, outcome: 'created', reason: 'new', stored: true };
  submitConcern.mockClear();
});

describe('definitions', () => {
  it('requires a title and a detail', () => {
    const tool = CONCERN_TOOL_DEFINITIONS.find((t) => t.name === 'rapitas_create_concern');
    expect(tool?.inputSchema.required).toEqual(['title', 'detail']);
  });

  it('offers the real concern types and severities as enums', () => {
    const { properties } = CONCERN_TOOL_DEFINITIONS[0].inputSchema;
    expect(properties.type.enum).toContain('security');
    expect(properties.severity.enum).toContain('urgent');
  });
});

describe('validation', () => {
  it('refuses a blank title or detail without touching the backlog', async () => {
    const noTitle = await executeConcernTool('rapitas_create_concern', {
      title: '  ',
      detail: 'something',
    });
    const noDetail = await executeConcernTool('rapitas_create_concern', {
      title: 'something',
      detail: '',
    });

    expect(noTitle?.isError).toBe(true);
    expect(noDetail?.isError).toBe(true);
    expect(submitConcern).not.toHaveBeenCalled();
  });
});

describe('submission', () => {
  it('trims and forwards the fields, marking the filing as mcp-sourced', async () => {
    await file({
      title: '  leaky handle  ',
      detail: '  the probe never closes it  ',
      type: 'bug',
      severity: 'high',
      location: '  services/mcp/x.ts  ',
    });

    expect(submitCalls[0]).toEqual({
      title: 'leaky handle',
      detail: 'the probe never closes it',
      type: 'bug',
      severity: 'high',
      location: 'services/mcp/x.ts',
      source: 'mcp',
    });
  });

  it('normalises an unrecognised type and severity instead of rejecting them', async () => {
    await file({ title: 't', detail: 'd', type: 'nonsense', severity: 'whenever' });
    expect(submitCalls[0].type).toBe('bug');
    expect(submitCalls[0].severity).toBe('medium');
  });

  it('omits an empty location rather than storing a blank string', async () => {
    await file({ title: 't', detail: 'd', location: '   ' });
    expect(submitCalls[0].location).toBeUndefined();
  });
});

describe('reporting what happened', () => {
  it('confirms a new filing with its id', async () => {
    nextResult = { id: 7336, outcome: 'created', reason: 'new', stored: true };
    expect(await file({ title: 'leaky handle', detail: 'd' })).toBe(
      'Filed concern #7336: leaky handle',
    );
  });

  it('says a merged filing was not filed, and points at the existing concern', async () => {
    nextResult = { id: 42, outcome: 'merged', reason: 'near-duplicate', stored: false };
    const text = await file({ title: 't', detail: 'd' });

    expect(text).toContain('Not filed as new');
    expect(text).toContain('near-duplicate');
    expect(text).toContain('#42');
  });

  // Only the jev-not-relevant outcome has a null id — nothing was written and
  // there is no existing row to point at. "#null" would be a dead reference.
  it('does not dangle a #null when the suppression anchored to nothing', async () => {
    nextResult = { id: null, outcome: 'suppressed', reason: 'jev-not-relevant', stored: false };
    const text = await file({ title: 't', detail: 'd' });

    expect(text).toContain('Not filed as new');
    expect(text).not.toContain('#null');
  });
});

describe('routing', () => {
  it('returns null for a tool it does not own', async () => {
    expect(await executeConcernTool('rapitas_search_knowledge', {})).toBeNull();
  });
});
