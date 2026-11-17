/**
 * read-stamp.test
 *
 * The glyph rule shared with the mobile app, and the routing notes it reads.
 */
import { describe, it, expect } from 'vitest';
import { intentOfRoutingNote, stampGlyphFor } from '../read-stamp';

describe('stampGlyphFor', () => {
  it('🫡 for what she takes on, 👀 for watch, 👌 for the rest', () => {
    for (const i of ['create', 'roadmap', 'change', 'tidy', 'companion']) {
      expect(stampGlyphFor(i)).toBe('🫡');
    }
    expect(stampGlyphFor('watch')).toBe('👀');
    for (const i of ['ask', 'consult', 'chat', 'unknown', undefined, null]) {
      expect(stampGlyphFor(i)).toBe('👌');
    }
  });
});

describe('intentOfRoutingNote', () => {
  it('reads the mobile note, the old web note and its English form', () => {
    expect(intentOfRoutingNote('タスク作成として受け取りました — 資料')).toBe('create');
    expect(intentOfRoutingNote('見守りとして受け取りました')).toBe('watch');
    expect(intentOfRoutingNote('「計画を立てる」として受け取りました — 目標')).toBe('roadmap');
    expect(intentOfRoutingNote('Took that as “Tidy up” — old ones')).toBe('tidy');
    expect(intentOfRoutingNote('伴走の終了として受け取りました')).toBe('companion');
  });

  it('is null for any other line', () => {
    expect(intentOfRoutingNote('送信に失敗しました')).toBeNull();
    expect(intentOfRoutingNote('「謎」として受け取りました')).toBeNull();
  });
});
