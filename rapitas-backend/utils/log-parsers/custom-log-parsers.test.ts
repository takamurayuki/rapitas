/**
 * Tests for the custom/application log parsers and LogParserFactory.
 *
 * Covers the user-definable CustomFormatParser field mapping, the Python
 * logging-format parser, and the factory's parser-selection/creation helpers.
 */

import { describe, expect, test } from 'bun:test';
import { CustomFormatParser, PythonLogParser, LogParserFactory } from './custom-log-parsers';
import { NginxLogParser, ApacheCombinedLogParser } from './http-log-parsers';
import { WindowsEventLogParser, DockerLogParser, PostgreSQLLogParser } from './system-log-parsers';
import { LogLevel, LogType } from '../debug-log-analyzer';

describe('CustomFormatParser', () => {
  const pattern = /^\[(\S+)]\s+(\w+)\s+(\S+)\s+(.*)$/;
  const fieldMap = {
    groups: ['timestamp', 'level', 'source', 'message'],
  };

  test('canParse reflects the supplied pattern', () => {
    const parser = new CustomFormatParser(pattern, fieldMap);
    expect(parser.canParse('[2024-01-01T00:00:00Z] INFO svc hello world')).toBe(true);
    expect(parser.canParse('no match here')).toBe(false);
  });

  test('parse maps capture groups to timestamp/level/source/message', () => {
    const parser = new CustomFormatParser(pattern, fieldMap);
    const entry = parser.parse('[2024-01-01T00:00:00Z] warn svc-a something happened');
    expect(entry).not.toBeNull();
    expect(entry!.type).toBe(LogType.CUSTOM);
    expect(entry!.timestamp).toEqual(new Date('2024-01-01T00:00:00Z'));
    expect(entry!.level).toBe(LogLevel.WARN);
    expect(entry!.source).toBe('svc-a');
    expect(entry!.message).toBe('something happened');
  });

  test('parse returns null when the pattern does not match', () => {
    const parser = new CustomFormatParser(pattern, fieldMap);
    expect(parser.parse('unrelated text')).toBeNull();
  });

  test('unmapped capture groups fall into metadata under their field name', () => {
    const parser = new CustomFormatParser(/^(\w+)=(\w+)$/, { groups: ['key', 'value'] });
    const entry = parser.parse('requestId=abc123');
    expect(entry!.metadata?.key).toBe('requestId');
    expect(entry!.metadata?.value).toBe('abc123');
  });

  test('skips a capture group with no corresponding field name', () => {
    const parser = new CustomFormatParser(/^(\w+) (\w+)$/, { groups: ['message'] });
    const entry = parser.parse('hello world');
    expect(entry!.message).toBe('hello');
    expect(entry!.metadata).toEqual({});
  });

  test('skips an empty captured value', () => {
    const parser = new CustomFormatParser(/^(\w*)(\|)(\w+)$/, {
      groups: ['source', 'sep', 'message'],
    });
    const entry = parser.parse('|hello');
    expect(entry!.source).toBeUndefined();
    expect(entry!.message).toBe('hello');
  });

  test.each([
    ['trace', LogLevel.TRACE],
    ['debug', LogLevel.DEBUG],
    ['info', LogLevel.INFO],
    ['information', LogLevel.INFO],
    ['warn', LogLevel.WARN],
    ['warning', LogLevel.WARN],
    ['error', LogLevel.ERROR],
    ['err', LogLevel.ERROR],
    ['fatal', LogLevel.FATAL],
    ['critical', LogLevel.FATAL],
    ['ERROR', LogLevel.ERROR],
    ['nonsense', LogLevel.INFO],
  ])('maps level string "%s" to %s', (raw, expected) => {
    const parser = new CustomFormatParser(/^(\w+)$/, { groups: ['level'] });
    expect(parser.parse(raw)!.level).toBe(expected);
  });

  test('parseTimestamp uses the Date constructor for both ISO8601 and other formats', () => {
    const isoParser = new CustomFormatParser(/^(\S+)$/, {
      groups: ['timestamp'],
      timestampFormat: 'ISO8601',
    });
    const customParser = new CustomFormatParser(/^(\S+)$/, {
      groups: ['timestamp'],
      timestampFormat: 'MM/DD/YYYY',
    });
    expect(isoParser.parse('2024-06-01T00:00:00Z')!.timestamp).toEqual(
      new Date('2024-06-01T00:00:00Z'),
    );
    expect(customParser.parse('2024-06-01T00:00:00Z')!.timestamp).toEqual(
      new Date('2024-06-01T00:00:00Z'),
    );
  });
});

describe('PythonLogParser', () => {
  const parser = new PythonLogParser();
  const line = '2024-01-01 00:00:00,123 - my.module - INFO - Application started';

  test('canParse accepts the python logging format', () => {
    expect(parser.canParse(line)).toBe(true);
    expect(parser.canParse('not a python log')).toBe(false);
  });

  test('parse extracts timestamp (comma -> period), logger, level, message', () => {
    const entry = parser.parse(line);
    expect(entry).not.toBeNull();
    expect(entry!.type).toBe(LogType.CUSTOM);
    expect(entry!.timestamp).toEqual(new Date('2024-01-01 00:00:00.123'));
    expect(entry!.source).toBe('my.module');
    expect(entry!.level).toBe(LogLevel.INFO);
    expect(entry!.message).toBe('Application started');
    expect(entry!.metadata).toEqual({ logger: 'my.module', type: 'python' });
  });

  test('parse returns null for a non-matching line', () => {
    expect(parser.parse('2024-01-01 not-a-log-line')).toBeNull();
  });

  test.each([
    ['DEBUG', LogLevel.DEBUG],
    ['INFO', LogLevel.INFO],
    ['WARNING', LogLevel.WARN],
    ['ERROR', LogLevel.ERROR],
    ['CRITICAL', LogLevel.FATAL],
    ['NOTSET', LogLevel.INFO],
  ])('maps python level %s to %s', (level, expected) => {
    const entry = parser.parse(`2024-01-01 00:00:00,000 - lg - ${level} - msg`);
    expect(entry!.level).toBe(expected);
  });
});

describe('LogParserFactory', () => {
  test('createAllParsers returns one instance of each built-in parser', () => {
    const parsers = LogParserFactory.createAllParsers();
    expect(parsers).toHaveLength(6);
    expect(parsers[0]).toBeInstanceOf(NginxLogParser);
    expect(parsers[1]).toBeInstanceOf(ApacheCombinedLogParser);
    expect(parsers[2]).toBeInstanceOf(WindowsEventLogParser);
    expect(parsers[3]).toBeInstanceOf(DockerLogParser);
    expect(parsers[4]).toBeInstanceOf(PostgreSQLLogParser);
    expect(parsers[5]).toBeInstanceOf(PythonLogParser);
  });

  test('findBestParser selects the correct parser per line format', () => {
    expect(
      LogParserFactory.findBestParser(
        '127.0.0.1 - - [10/Oct/2000:13:55:36 -0700] "GET / HTTP/1.0" 200 100 "-" "-"',
      ),
    ).toBeInstanceOf(NginxLogParser);
    expect(
      LogParserFactory.findBestParser('2024-01-01 00:00:00,000 - lg - INFO - hello'),
    ).toBeInstanceOf(PythonLogParser);
    expect(LogParserFactory.findBestParser('Event[System]: something happened')).toBeInstanceOf(
      WindowsEventLogParser,
    );
  });

  test('findBestParser returns null when no parser matches', () => {
    expect(LogParserFactory.findBestParser('¯\\_(ツ)_/¯ totally unstructured')).toBeNull();
  });

  test('createParserChain returns the given array unchanged', () => {
    const parsers = [new PythonLogParser()];
    expect(LogParserFactory.createParserChain(parsers)).toBe(parsers);
  });

  test('createCustomParser accepts a RegExp pattern', () => {
    const parser = LogParserFactory.createCustomParser(/^(\w+)$/, { groups: ['message'] });
    expect(parser).toBeInstanceOf(CustomFormatParser);
    expect(parser.parse('hello')!.message).toBe('hello');
  });

  test('createCustomParser accepts a string pattern', () => {
    const parser = LogParserFactory.createCustomParser('^(\\w+)$', { groups: ['message'] });
    expect(parser.parse('hello')!.message).toBe('hello');
  });
});
