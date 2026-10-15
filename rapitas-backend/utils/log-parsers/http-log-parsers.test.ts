/**
 * Tests for HTTP log parsers (Nginx / Apache Combined).
 *
 * Covers canParse/parse happy paths, status-code-to-level mapping, "-" placeholder
 * fields, and malformed/unparseable date fallbacks.
 */

import { describe, expect, test } from 'bun:test';
import { NginxLogParser, ApacheCombinedLogParser } from './http-log-parsers';
import { LogLevel, LogType } from '../debug-log-analyzer';

const NGINX_LINE =
  '127.0.0.1 - frank [10/Oct/2000:13:55:36 -0700] "GET /apache.gif HTTP/1.0" 200 2326 "http://www.example.com/start.html" "Mozilla/4.08"';

describe('NginxLogParser', () => {
  const parser = new NginxLogParser();

  test('canParse accepts a well-formed combined log line', () => {
    expect(parser.canParse(NGINX_LINE)).toBe(true);
  });

  test('canParse rejects malformed lines', () => {
    expect(parser.canParse('not a log line')).toBe(false);
    expect(parser.canParse('')).toBe(false);
  });

  test('parse extracts all fields from a well-formed line', () => {
    const entry = parser.parse(NGINX_LINE);
    expect(entry).not.toBeNull();
    expect(entry!.type).toBe(LogType.NGINX);
    expect(entry!.source).toBe('127.0.0.1');
    expect(entry!.message).toBe('GET /apache.gif HTTP/1.0');
    expect(entry!.level).toBe(LogLevel.INFO);
    expect(entry!.metadata?.user).toBe('frank');
    expect(entry!.metadata?.statusCode).toBe(200);
    expect(entry!.metadata?.size).toBe(2326);
    expect(entry!.metadata?.referer).toBe('http://www.example.com/start.html');
    expect(entry!.metadata?.userAgent).toBe('Mozilla/4.08');
    expect(entry!.timestamp).toEqual(new Date(2000, 9, 10, 13, 55, 36));
  });

  test('parse returns null for a malformed line', () => {
    expect(parser.parse('garbage')).toBeNull();
  });

  test('parse maps "-" user and referer to undefined', () => {
    const line =
      '10.0.0.1 - - [01/Jan/2024:00:00:00 +0000] "GET / HTTP/1.1" 200 100 "-" "curl/8.0"';
    const entry = parser.parse(line);
    expect(entry!.metadata?.user).toBeUndefined();
    expect(entry!.metadata?.referer).toBeUndefined();
  });

  test.each([
    [200, LogLevel.INFO],
    [301, LogLevel.INFO],
    [399, LogLevel.INFO],
    [400, LogLevel.WARN],
    [404, LogLevel.WARN],
    [499, LogLevel.WARN],
    [500, LogLevel.ERROR],
    [503, LogLevel.ERROR],
  ])('maps status %i to level %s', (status, level) => {
    const line = `1.1.1.1 - - [01/Jan/2024:00:00:00 +0000] "GET / HTTP/1.1" ${status} 10 "-" "-"`;
    expect(parser.parse(line)!.level).toBe(level);
  });

  test('falls back to current date when the bracketed timestamp cannot be parsed', () => {
    const line = '1.1.1.1 - - [not-a-date] "GET / HTTP/1.1" 200 10 "-" "-"';
    const before = Date.now();
    const entry = parser.parse(line);
    const after = Date.now();
    expect(entry!.timestamp!.getTime()).toBeGreaterThanOrEqual(before);
    expect(entry!.timestamp!.getTime()).toBeLessThanOrEqual(after);
  });

  test('resolves every month abbreviation', () => {
    const months: Array<[string, number]> = [
      ['Jan', 0],
      ['Feb', 1],
      ['Mar', 2],
      ['Apr', 3],
      ['May', 4],
      ['Jun', 5],
      ['Jul', 6],
      ['Aug', 7],
      ['Sep', 8],
      ['Oct', 9],
      ['Nov', 10],
      ['Dec', 11],
    ];
    for (const [month, index] of months) {
      const line = `1.1.1.1 - - [15/${month}/2023:10:20:30 +0900] "GET / HTTP/1.1" 200 10 "-" "-"`;
      const entry = parser.parse(line);
      expect(entry!.timestamp).toEqual(new Date(2023, index, 15, 10, 20, 30));
    }
  });
});

describe('ApacheCombinedLogParser', () => {
  const parser = new ApacheCombinedLogParser();

  const apacheLine =
    '192.168.1.1 - jdoe [25/Dec/2023:10:20:30 +0900] "POST /api HTTP/1.1" 500 1234 "http://ref.example" "Chrome/1.0"';

  test('canParse accepts a well-formed combined log line', () => {
    expect(parser.canParse(apacheLine)).toBe(true);
  });

  test('canParse rejects malformed lines', () => {
    expect(parser.canParse('not a log line')).toBe(false);
  });

  test('parse extracts all fields from a well-formed line', () => {
    const entry = parser.parse(apacheLine);
    expect(entry).not.toBeNull();
    expect(entry!.type).toBe(LogType.APACHE_COMBINED);
    expect(entry!.source).toBe('192.168.1.1');
    expect(entry!.metadata?.user).toBe('jdoe');
    expect(entry!.metadata?.statusCode).toBe(500);
    expect(entry!.metadata?.size).toBe(1234);
    expect(entry!.level).toBe(LogLevel.ERROR);
    expect(entry!.timestamp).toEqual(new Date(2023, 11, 25, 10, 20, 30));
  });

  test('parse returns null for a malformed line', () => {
    expect(parser.parse('garbage')).toBeNull();
  });

  test('maps a "-" size field to 0 (unlike Nginx, size is not digits-only)', () => {
    const line = '10.0.0.1 - - [01/Jan/2024:00:00:00 +0000] "GET / HTTP/1.1" 304 - "-" "-"';
    const entry = parser.parse(line);
    expect(entry!.metadata?.size).toBe(0);
    expect(entry!.level).toBe(LogLevel.INFO);
  });

  test('falls back to current date when the bracketed timestamp cannot be parsed', () => {
    const line = '1.1.1.1 - - [nope] "GET / HTTP/1.1" 200 10 "-" "-"';
    const before = Date.now();
    const entry = parser.parse(line);
    const after = Date.now();
    expect(entry!.timestamp!.getTime()).toBeGreaterThanOrEqual(before);
    expect(entry!.timestamp!.getTime()).toBeLessThanOrEqual(after);
  });

  test.each([
    [200, LogLevel.INFO],
    [404, LogLevel.WARN],
    [500, LogLevel.ERROR],
  ])('maps status %i to level %s', (status, level) => {
    const line = `1.1.1.1 - - [01/Jan/2024:00:00:00 +0000] "GET / HTTP/1.1" ${status} 10 "-" "-"`;
    expect(parser.parse(line)!.level).toBe(level);
  });
});
