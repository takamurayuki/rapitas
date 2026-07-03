import { describe, it, expect } from 'vitest';
import { Bot, MessageSquare, Sparkles, User } from 'lucide-react';
import { PRIORITY_ORDER, PRIORITY_HINT_KEY, SOURCE_ICONS } from '../idea-box.utils';

describe('PRIORITY_ORDER', () => {
  it('lists all four priorities in descending urgency order', () => {
    expect(PRIORITY_ORDER).toEqual(['urgent', 'high', 'medium', 'low']);
  });
});

describe('PRIORITY_HINT_KEY', () => {
  it('maps every priority to its i18n hint key', () => {
    expect(PRIORITY_HINT_KEY).toEqual({
      urgent: 'priorityHint.urgent',
      high: 'priorityHint.high',
      medium: 'priorityHint.medium',
      low: 'priorityHint.low',
    });
  });

  it('has an entry for every value in PRIORITY_ORDER', () => {
    for (const priority of PRIORITY_ORDER) {
      expect(PRIORITY_HINT_KEY[priority]).toBeDefined();
    }
  });
});

describe('SOURCE_ICONS', () => {
  it('maps each known idea source to its lucide icon component', () => {
    expect(SOURCE_ICONS.user).toBe(User);
    expect(SOURCE_ICONS.agent_execution).toBe(Bot);
    expect(SOURCE_ICONS.copilot).toBe(MessageSquare);
    expect(SOURCE_ICONS.code_review).toBe(Sparkles);
  });

  it('has no entry for an unknown source key', () => {
    expect(SOURCE_ICONS['unknown_source']).toBeUndefined();
  });
});
