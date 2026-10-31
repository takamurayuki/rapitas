/**
 * url-fetch-guard.test
 *
 * `POST /url-metadata` fetched whatever URL it was handed and returned the
 * fetched page's `<title>`. That makes it more than a blind SSRF: a caller
 * could name an internal address and read a line of its content back. The
 * worst target is this API itself — `http://127.0.0.1:3001/...` — which the
 * repository documents as having no user auth.
 *
 * What is pinned here is the address policy and the response-size cap, as pure
 * functions. DNS resolution is tested through an injected resolver so the
 * rebinding case can be exercised without a network.
 */
import { describe, expect, test } from 'bun:test';
import {
  MAX_METADATA_BYTES,
  assertFetchableUrl,
  isBlockedAddress,
  readCappedText,
} from './url-fetch-guard';

describe('isBlockedAddress', () => {
  test.each([
    ['127.0.0.1', 'IPv4 loopback — the API itself lives here'],
    ['127.1.2.3', 'the rest of 127/8'],
    ['0.0.0.0', 'the unspecified address'],
    ['10.1.2.3', 'private 10/8'],
    ['172.16.0.1', 'private 172.16/12'],
    ['172.31.255.255', 'the top of 172.16/12'],
    ['192.168.1.1', 'private 192.168/16'],
    ['169.254.169.254', 'link-local — the cloud metadata address'],
    ['100.64.0.1', 'carrier NAT space'],
    ['224.0.0.1', 'multicast'],
    ['255.255.255.255', 'broadcast'],
    ['::1', 'IPv6 loopback'],
    ['::', 'the IPv6 unspecified address'],
    ['fc00::1', 'IPv6 unique-local'],
    ['fd12:3456::1', 'the rest of fc00::/7'],
    ['fe80::1', 'IPv6 link-local'],
    ['::ffff:127.0.0.1', 'an IPv4-mapped loopback'],
    ['::ffff:10.0.0.1', 'an IPv4-mapped private address'],
  ])('blocks %s (%s)', (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  test.each([
    '8.8.8.8',
    '1.1.1.1',
    '93.184.216.34',
    '172.32.0.1',
    '11.0.0.1',
    '2606:4700:4700::1111',
  ])('allows the public address %s', (ip) => {
    expect(isBlockedAddress(ip)).toBe(false);
  });

  test('treats an unparseable address as blocked', () => {
    // Fail closed: an address this code cannot classify is not one it can vouch
    // for.
    expect(isBlockedAddress('not-an-ip')).toBe(true);
    expect(isBlockedAddress('')).toBe(true);
  });
});

/** A resolver that answers with fixed addresses, standing in for DNS. */
function resolverFor(map: Record<string, string[]>) {
  return async (hostname: string) => map[hostname] ?? [];
}

describe('assertFetchableUrl', () => {
  const publicDns = resolverFor({ 'example.com': ['93.184.216.34'] });

  test('accepts an https URL that resolves publicly', async () => {
    const url = await assertFetchableUrl('https://example.com/page', publicDns);
    expect(url.hostname).toBe('example.com');
  });

  test('accepts plain http too — a LAN-hosted page is a normal bookmark', async () => {
    await expect(assertFetchableUrl('http://example.com/', publicDns)).resolves.toBeDefined();
  });

  test.each([
    'file:///etc/passwd',
    'ftp://example.com/x',
    'gopher://example.com/',
    'data:text/html,x',
  ])('rejects the scheme in %s', async (raw) => {
    await expect(assertFetchableUrl(raw, publicDns)).rejects.toThrow();
  });

  test('rejects a literal loopback host without consulting DNS', async () => {
    const neverCalled = async () => {
      throw new Error('DNS must not be consulted for a literal address');
    };
    await expect(assertFetchableUrl('http://127.0.0.1:3001/tasks', neverCalled)).rejects.toThrow();
  });

  test.each(['http://localhost:3001/', 'http://[::1]:3001/', 'http://192.168.0.5/'])(
    'rejects %s',
    async (raw) => {
      await expect(assertFetchableUrl(raw, publicDns)).rejects.toThrow();
    },
  );

  // The host is public in the URL but resolves inward. Checking the name alone
  // is not enough, which is the whole point of resolving before fetching.
  test('rejects a public name that resolves to a private address', async () => {
    const rebinding = resolverFor({ 'evil.example.com': ['169.254.169.254'] });
    await expect(assertFetchableUrl('http://evil.example.com/', rebinding)).rejects.toThrow();
  });

  test('rejects when ANY resolved address is private', async () => {
    const mixed = resolverFor({ 'mixed.example.com': ['93.184.216.34', '10.0.0.1'] });
    await expect(assertFetchableUrl('http://mixed.example.com/', mixed)).rejects.toThrow();
  });

  test('rejects a name that resolves to nothing', async () => {
    await expect(assertFetchableUrl('http://nowhere.example.com/', publicDns)).rejects.toThrow();
  });

  test('rejects a malformed URL', async () => {
    await expect(assertFetchableUrl('not a url', publicDns)).rejects.toThrow();
  });
});

describe('readCappedText', () => {
  /** A Response whose body streams `chunks` in order. */
  function streaming(chunks: string[]): Response {
    const encoder = new TextEncoder();
    return new Response(
      new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
          controller.close();
        },
      }),
    );
  }

  test('returns a short body unchanged', async () => {
    expect(await readCappedText(streaming(['<title>hi</title>']))).toBe('<title>hi</title>');
  });

  test('stops reading once the cap is reached', async () => {
    const huge = 'x'.repeat(MAX_METADATA_BYTES * 3);
    const text = await readCappedText(streaming([huge]));

    // A title lives in <head>; reading a whole multi-megabyte page to find it
    // hands a caller a way to exhaust memory.
    expect(text.length).toBeLessThanOrEqual(MAX_METADATA_BYTES);
  });

  test('keeps the beginning, which is where <head> is', async () => {
    const body = `<title>found</title>${'x'.repeat(MAX_METADATA_BYTES * 2)}`;
    expect(await readCappedText(streaming([body]))).toContain('<title>found</title>');
  });

  test('returns an empty string for a body-less response', async () => {
    expect(await readCappedText(new Response(null))).toBe('');
  });
});
