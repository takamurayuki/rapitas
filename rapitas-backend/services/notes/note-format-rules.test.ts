/**
 * note-format-rules.test
 *
 * The one place the note Markdown rules are written, and the prompts that
 * lead to a note body carrying them: the copilot's replies (saved as notes
 * from the chat on PC and phone) and the roadmap's note fields.
 */
import { describe, it, expect } from 'bun:test';
import {
  NOTE_MARKDOWN_FORMAT_RULES,
  NOTE_REPLY_FORMAT_RULES,
  NOTE_FIELD_TEXT_RULE,
} from './note-format-rules';
import {
  TASK_COPILOT_SYSTEM_PROMPT,
  GENERAL_COPILOT_SYSTEM_PROMPT,
} from '../ai/copilot-system-prompts';
import { INTERVIEW_PROMPT, PLAN_PROMPT } from '../assistant/roadmap-prompts';

describe('the note Markdown rules', () => {
  it('name the range both renderers draw the same', () => {
    for (const mark of ['## ', '### ', '**', '- ', '1. ', '| --- |', '```', '](https://', '> ']) {
      expect(NOTE_MARKDOWN_FORMAT_RULES).toContain(mark);
    }
  });

  it('put diagrams in mermaid fences and rule out raw HTML', () => {
    expect(NOTE_MARKDOWN_FORMAT_RULES).toContain('```mermaid');
    expect(NOTE_MARKDOWN_FORMAT_RULES).toContain('HTML');
    expect(NOTE_MARKDOWN_FORMAT_RULES).toContain('<br>');
  });

  it('start a reply one heading level down, under the saved note\'s "## ラピの回答"', () => {
    expect(NOTE_REPLY_FORMAT_RULES).toContain('## ラピの回答');
    expect(NOTE_REPLY_FORMAT_RULES).toContain('### ');
    expect(NOTE_REPLY_FORMAT_RULES).toContain('```mermaid');
    expect(NOTE_REPLY_FORMAT_RULES).not.toContain('見出しは ## と ###');
  });
});

describe('prompts that lead to a note body', () => {
  it('give both copilot prompts the reply rules', () => {
    expect(TASK_COPILOT_SYSTEM_PROMPT).toContain(NOTE_REPLY_FORMAT_RULES);
    expect(GENERAL_COPILOT_SYSTEM_PROMPT).toContain(NOTE_REPLY_FORMAT_RULES);
  });

  it('give both roadmap rounds the note field rule', () => {
    expect(INTERVIEW_PROMPT).toContain(NOTE_FIELD_TEXT_RULE);
    expect(PLAN_PROMPT).toContain(NOTE_FIELD_TEXT_RULE);
  });
});
