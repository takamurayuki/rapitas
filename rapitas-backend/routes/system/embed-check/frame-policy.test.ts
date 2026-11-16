/**
 * frame-policy.test
 *
 * The framing rules for /url-embed-check: CSP frame-ancestors outranks
 * X-Frame-Options, every frame-ancestors policy must allow the embedder, and
 * anything the parser cannot judge is `unknown`, never a guess.
 */
import { describe, expect, test } from 'bun:test';
import { evaluateFramePolicy, type FramePolicyHeaders } from './frame-policy';

const APP = 'http://localhost:3000';
const target = new URL('https://docs.example.com/page');

const judge = (h: Partial<FramePolicyHeaders>, embedder = APP, url = target) =>
  evaluateFramePolicy({ csp: null, xFrameOptions: null, ...h }, url, embedder);

describe('no framing headers', () => {
  test('is embeddable', () => {
    expect(judge({})).toBe('embeddable');
  });

  test('a CSP without frame-ancestors does not refuse', () => {
    expect(judge({ csp: "default-src 'self'; script-src 'none'" })).toBe('embeddable');
  });
});

describe('X-Frame-Options (only without frame-ancestors)', () => {
  test.each([
    ['DENY', 'refused'],
    ['deny', 'refused'],
    ['SAMEORIGIN', 'refused'],
    ['SAMEORIGIN, SAMEORIGIN', 'refused'],
    ['SAMEORIGIN, DENY', 'refused'],
    ['ALLOW-FROM http://localhost:3000', 'unknown'],
    ['nonsense', 'unknown'],
    ['SAMEORIGIN, ALLOWALL', 'unknown'],
  ])('%s → %s', (xfo, expected) => {
    expect(judge({ xFrameOptions: xfo })).toBe(expected);
  });
});

describe('frame-ancestors outranks X-Frame-Options', () => {
  test('frame-ancestors allowing the app wins over XFO: DENY', () => {
    expect(judge({ csp: 'frame-ancestors http://localhost:3000', xFrameOptions: 'DENY' })).toBe(
      'embeddable',
    );
  });

  test('frame-ancestors refusing the app refuses even with no XFO', () => {
    expect(judge({ csp: "frame-ancestors 'self'" })).toBe('refused');
  });

  test("'none' refuses", () => {
    expect(judge({ csp: "frame-ancestors 'none'" })).toBe('refused');
  });
});

describe('several policies', () => {
  test('one refusing policy among several refuses', () => {
    const csp = "frame-ancestors *, frame-ancestors 'self'";
    expect(judge({ csp })).toBe('refused');
  });

  test('every policy allowing makes it embeddable', () => {
    const csp = 'frame-ancestors *, frame-ancestors http://localhost:*';
    expect(judge({ csp })).toBe('embeddable');
  });

  test('only the first frame-ancestors in a policy counts', () => {
    expect(judge({ csp: "frame-ancestors 'none'; frame-ancestors *" })).toBe('refused');
  });

  test('a policy without frame-ancestors is not consulted', () => {
    expect(judge({ csp: "script-src 'self', frame-ancestors *" })).toBe('embeddable');
  });
});

describe('source expressions', () => {
  test.each([
    ['*', 'embeddable'],
    ['http:', 'embeddable'],
    ['https:', 'refused'],
    ['localhost:3000', 'unknown-scheme'],
    ['http://localhost:3000', 'embeddable'],
    ['http://localhost:*', 'embeddable'],
    ['http://localhost', 'refused'],
    ['http://localhost:3001', 'refused'],
    ['https://localhost:3000', 'refused'],
    ['http://*.localhost:3000', 'refused'],
    ['http://example.org', 'refused'],
  ])('frame-ancestors %s from http://localhost:3000', (src, expected) => {
    const result = judge({ csp: `frame-ancestors ${src}` });
    if (expected === 'unknown-scheme') {
      // No scheme in the expression ⇒ must match the protected page's scheme
      // (https here), which the http embedder does not.
      expect(result).toBe('refused');
    } else {
      expect(result).toBe(expected);
    }
  });

  test('a wildcard subdomain matches subdomains only', () => {
    const csp = 'frame-ancestors https://*.example.com';
    expect(judge({ csp }, 'https://app.example.com')).toBe('embeddable');
    expect(judge({ csp }, 'https://example.com')).toBe('refused');
  });

  test("'self' matches the page's own origin", () => {
    expect(judge({ csp: "frame-ancestors 'self'" }, 'https://docs.example.com')).toBe('embeddable');
  });

  test('a matching source decides even next to an unparseable one', () => {
    expect(judge({ csp: "frame-ancestors 'strict-dynamic' *" })).toBe('embeddable');
  });

  test.each([
    "frame-ancestors 'unsafe-inline'",
    'frame-ancestors http://localhost:3000/app',
    'frame-ancestors data:',
    'frame-ancestors http://[::1]:3000',
  ])('%s is unknown when nothing else matches', (csp) => {
    expect(judge({ csp })).toBe('unknown');
  });

  test('an unknown source next to a refusing policy still refuses', () => {
    expect(judge({ csp: "frame-ancestors 'unsafe-inline', frame-ancestors 'none'" })).toBe(
      'refused',
    );
  });

  test('an unparsable embedder origin is unknown', () => {
    expect(judge({}, 'not a url')).toBe('unknown');
  });
});
