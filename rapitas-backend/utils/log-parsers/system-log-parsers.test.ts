/**
 * Tests for system-level log parsers (Windows Event Log, Docker, PostgreSQL).
 *
 * Covers both sub-formats each parser accepts, level-mapping branches, and the
 * loose canParse() checks that can accept a line the stricter parse() then rejects.
 */

import { describe, expect, test } from 'bun:test';
import { WindowsEventLogParser, DockerLogParser, PostgreSQLLogParser } from './system-log-parsers';
import { LogLevel, LogType } from '../debug-log-analyzer';

describe('WindowsEventLogParser', () => {
  const parser = new WindowsEventLogParser();
  const csvLine = '"Error","2024-01-01 10:00:00","Application","1000","(1)","Something failed"';

  test('canParse accepts CSV rows and Event[...] lines', () => {
    expect(parser.canParse(csvLine)).toBe(true);
    expect(parser.canParse('Event[System]: service stopped')).toBe(true);
  });

  test('canParse rejects unrelated text', () => {
    expect(parser.canParse('plain text line')).toBe(false);
  });

  test('parse extracts fields from a CSV row', () => {
    const entry = parser.parse(csvLine);
    expect(entry).not.toBeNull();
    expect(entry!.type).toBe(LogType.CUSTOM);
    expect(entry!.timestamp).toEqual(new Date('2024-01-01 10:00:00'));
    expect(entry!.level).toBe(LogLevel.ERROR);
    expect(entry!.source).toBe('Application');
    expect(entry!.message).toBe('Something failed');
    expect(entry!.metadata).toEqual({ eventId: '1000', category: '(1)', type: 'windows_event' });
  });

  test.each([
    ['Information', LogLevel.INFO],
    ['Warning', LogLevel.WARN],
    ['Error', LogLevel.ERROR],
    ['Critical', LogLevel.FATAL],
    ['Unknown', LogLevel.INFO],
  ])('maps CSV level %s to %s', (level, expected) => {
    const line = `"${level}","2024-01-01 00:00:00","Src","1","(0)","msg"`;
    expect(parser.parse(line)!.level).toBe(expected);
  });

  test('parse extracts source/message from Event[...] format', () => {
    const entry = parser.parse('Event[System]: The service has stopped unexpectedly');
    expect(entry).not.toBeNull();
    expect(entry!.source).toBe('System');
    expect(entry!.message).toBe('The service has stopped unexpectedly');
    expect(entry!.level).toBe(LogLevel.INFO);
  });

  test.each([
    ['Event[App]: an error occurred', LogLevel.ERROR],
    ['Event[App]: operation failed', LogLevel.ERROR],
    ['Event[App]: this is a warning', LogLevel.WARN],
    ['Event[App]: all good', LogLevel.INFO],
  ])('detectLevelFromMessage classifies "%s" as %s', (line, expected) => {
    expect(parser.parse(line)!.level).toBe(expected);
  });

  test('parse returns null for plain unrelated text', () => {
    expect(parser.parse('plain text line')).toBeNull();
  });

  test('parse returns null when canParse matched on "Event[" but the line has no closing colon', () => {
    const line = 'Event[System] missing colon';
    expect(parser.canParse(line)).toBe(true);
    expect(parser.parse(line)).toBeNull();
  });
});

describe('DockerLogParser', () => {
  const parser = new DockerLogParser();

  test('canParse accepts lines containing "docker" and valid docker JSON logs', () => {
    expect(parser.canParse('docker: container started')).toBe(true);
    expect(parser.canParse('{"log":"hi\\n","stream":"stdout","time":"2024-01-01T00:00:00Z"}')).toBe(
      true,
    );
  });

  test('canParse rejects plain text and JSON missing required fields', () => {
    expect(parser.canParse('plain text')).toBe(false);
    expect(parser.canParse('{"log":"hi","stream":"stdout"}')).toBe(false);
  });

  test('parse extracts fields from a docker JSON log (stdout -> INFO)', () => {
    const line = JSON.stringify({
      log: 'hello world\n',
      stream: 'stdout',
      time: '2024-01-01T00:00:00Z',
      containerId: 'abc123',
    });
    const entry = parser.parse(line);
    expect(entry).not.toBeNull();
    expect(entry!.type).toBe(LogType.CUSTOM);
    expect(entry!.timestamp).toEqual(new Date('2024-01-01T00:00:00Z'));
    expect(entry!.level).toBe(LogLevel.INFO);
    expect(entry!.message).toBe('hello world');
    expect(entry!.source).toBe('docker');
    expect(entry!.metadata).toEqual({
      stream: 'stdout',
      containerId: 'abc123',
      type: 'docker',
    });
  });

  test('parse maps a stderr stream to ERROR', () => {
    const line = JSON.stringify({ log: 'boom', stream: 'stderr', time: '2024-01-01T00:00:00Z' });
    expect(parser.parse(line)!.level).toBe(LogLevel.ERROR);
  });

  test('parse extracts container/message from docker-compose pipe format', () => {
    const entry = parser.parse('docker_web_1  | Listening on port 3000');
    expect(entry).not.toBeNull();
    expect(entry!.source).toBe('docker_web_1');
    expect(entry!.message).toBe('Listening on port 3000');
    expect(entry!.level).toBe(LogLevel.INFO);
  });

  test.each([
    ['docker_web_1 | an error occurred', LogLevel.ERROR],
    ['docker_web_1 | uncaught exception', LogLevel.ERROR],
    ['docker_web_1 | warn: low disk space', LogLevel.WARN],
    ['docker_web_1 | debug: tracing request', LogLevel.DEBUG],
    ['docker_web_1 | normal startup message', LogLevel.INFO],
  ])('detectLevelFromMessage classifies "%s" as %s', (line, expected) => {
    expect(parser.parse(line)!.level).toBe(expected);
  });

  test('parse returns null when the line contains "docker" but matches neither sub-format', () => {
    expect(parser.parse('docker')).toBeNull();
  });
});

describe('PostgreSQLLogParser', () => {
  const parser = new PostgreSQLLogParser();
  const line = '2024-01-01 10:00:00.123 UTC [1234] ERROR:  duplicate key value';

  test('canParse accepts the structured format and any line mentioning postgres', () => {
    expect(parser.canParse(line)).toBe(true);
    expect(parser.canParse('connecting to postgres')).toBe(true);
  });

  test('canParse rejects unrelated text', () => {
    expect(parser.canParse('plain text')).toBe(false);
  });

  test('parse extracts timestamp, pid, level, and message', () => {
    const entry = parser.parse(line);
    expect(entry).not.toBeNull();
    expect(entry!.type).toBe(LogType.CUSTOM);
    expect(entry!.timestamp).toEqual(new Date('2024-01-01 10:00:00.123 UTC'));
    expect(entry!.level).toBe(LogLevel.ERROR);
    expect(entry!.source).toBe('postgres[1234]');
    expect(entry!.message).toBe('duplicate key value');
    expect(entry!.metadata).toEqual({ pid: 1234, type: 'postgresql' });
  });

  test('parse returns null when canParse matched via the loose "postgres" substring but the line is unstructured', () => {
    const looseLine = 'connecting to postgres';
    expect(parser.canParse(looseLine)).toBe(true);
    expect(parser.parse(looseLine)).toBeNull();
  });

  test.each([
    ['DEBUG', LogLevel.DEBUG],
    ['DEBUG5', LogLevel.DEBUG],
    ['INFO', LogLevel.INFO],
    ['NOTICE', LogLevel.INFO],
    ['LOG', LogLevel.INFO],
    ['WARNING', LogLevel.WARN],
    ['ERROR', LogLevel.ERROR],
    ['FATAL', LogLevel.FATAL],
    ['PANIC', LogLevel.FATAL],
    ['UNKNOWNLEVEL', LogLevel.INFO],
  ])('maps postgres level %s to %s', (level, expected) => {
    const l = `2024-01-01 10:00:00.000 UTC [1] ${level}:  msg`;
    expect(parser.parse(l)!.level).toBe(expected);
  });
});
