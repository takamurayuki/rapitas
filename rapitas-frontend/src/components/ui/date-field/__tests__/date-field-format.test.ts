/**
 * date-field-format.test
 *
 * The native <input type="date"> renders mm/dd/yyyy and no setting changes it:
 * measured 2026-10-07 in the running WebView2, the `lang` attribute has no
 * effect, and --lang=ja only switches the clock to 24h while leaving the date
 * order as mm/dd/yyyy (only --lang=zh-CN yields yyyy/mm/dd, which would turn the
 * whole browser UI Chinese). These helpers back the replacement field, so the
 * app's own locale-independent yyyy/mm/dd shape (operator decision 2026-09-03)
 * also applies to editing, not just display.
 */
import { describe, it, expect } from 'vitest';
import { toDisplayValue, parseDisplayValue } from '../date-field-format';

describe('toDisplayValue', () => {
  it('日付のみを yyyy/mm/dd にする', () => {
    expect(toDisplayValue('2026-10-07', false)).toBe('2026/10/07');
  });

  it('日時を yyyy/mm/dd HH:mm にする', () => {
    expect(toDisplayValue('2026-10-07T13:45', true)).toBe('2026/10/07 13:45');
  });

  it('withTime でも時刻が無ければ日付だけ返す', () => {
    expect(toDisplayValue('2026-10-07', true)).toBe('2026/10/07');
  });

  it('秒やタイムゾーンが付いていても切り捨てる', () => {
    expect(toDisplayValue('2026-10-07T13:45:30', true)).toBe('2026/10/07 13:45');
  });

  it('空文字は空文字のまま', () => {
    expect(toDisplayValue('', false)).toBe('');
    expect(toDisplayValue('', true)).toBe('');
  });

  it('解釈できない値は空文字(壊れた表示を出さない)', () => {
    expect(toDisplayValue('not-a-date', false)).toBe('');
  });
});

describe('parseDisplayValue', () => {
  it('yyyy/mm/dd を YYYY-MM-DD に戻す', () => {
    expect(parseDisplayValue('2026/10/07', false)).toBe('2026-10-07');
  });

  it('yyyy/mm/dd HH:mm を YYYY-MM-DDTHH:mm に戻す', () => {
    expect(parseDisplayValue('2026/10/07 13:45', true)).toBe('2026-10-07T13:45');
  });

  // Typing is forgiving on purpose: a hyphen and a missing leading zero are the
  // two things people actually type.
  it('ハイフン区切りも受け付ける', () => {
    expect(parseDisplayValue('2026-10-07', false)).toBe('2026-10-07');
  });

  it('1桁の月日を0埋めする', () => {
    expect(parseDisplayValue('2026/1/7', false)).toBe('2026-01-07');
    expect(parseDisplayValue('2026/1/7 9:05', true)).toBe('2026-01-07T09:05');
  });

  it('前後の空白を無視する', () => {
    expect(parseDisplayValue('  2026/10/07  ', false)).toBe('2026-10-07');
  });

  it('withTime で時刻が無ければ 00:00 を補う', () => {
    expect(parseDisplayValue('2026/10/07', true)).toBe('2026-10-07T00:00');
  });

  it('空文字は空文字(値のクリアを許す)', () => {
    expect(parseDisplayValue('', false)).toBe('');
    expect(parseDisplayValue('   ', true)).toBe('');
  });

  it('不正な文字列は null', () => {
    expect(parseDisplayValue('abc', false)).toBeNull();
    expect(parseDisplayValue('2026/10', false)).toBeNull();
  });

  // A real date, not just a well-shaped string: 2026-02-30 must not round-trip.
  it('存在しない日付は null', () => {
    expect(parseDisplayValue('2026/02/30', false)).toBeNull();
    expect(parseDisplayValue('2026/13/01', false)).toBeNull();
  });

  it('不正な時刻は null', () => {
    expect(parseDisplayValue('2026/10/07 25:00', true)).toBeNull();
    expect(parseDisplayValue('2026/10/07 10:61', true)).toBeNull();
  });

  it('往復変換で値が変わらない', () => {
    const iso = '2026-10-07T13:45';
    expect(parseDisplayValue(toDisplayValue(iso, true), true)).toBe(iso);
  });
});
