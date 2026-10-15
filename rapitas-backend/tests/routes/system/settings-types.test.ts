/**
 * settings-types SSRF allowlist テスト
 *
 * validateOllamaUrl/isLoopbackOrPrivateHost is the guard that stops the
 * ollamaUrl setting from being used as a server-side-request-forgery (SSRF)
 * primitive. Regression-locks the fix that removed 169.254.0.0/16 (IPv4
 * link-local, which contains the 169.254.169.254 cloud-metadata endpoint on
 * AWS/GCP/Azure) and fe80::/10 (IPv6 link-local) from the allowlist, while
 * keeping loopback/RFC1918-private/.local hosts allowed (Ollama's real
 * deployment targets).
 */
import { describe, test, expect } from 'bun:test';
import {
  isLoopbackOrPrivateHost,
  validateOllamaUrl,
} from '../../../routes/system/settings/settings-types';

describe('isLoopbackOrPrivateHost — cloud-metadata / link-local exclusion', () => {
  test('rejects the AWS/GCP/Azure metadata IP (169.254.169.254)', () => {
    expect(isLoopbackOrPrivateHost('169.254.169.254')).toBe(false);
  });

  test('rejects the wider IPv4 link-local range (169.254.0.0/16)', () => {
    expect(isLoopbackOrPrivateHost('169.254.0.1')).toBe(false);
    expect(isLoopbackOrPrivateHost('169.254.255.255')).toBe(false);
  });

  test('rejects IPv6 link-local (fe80::/10)', () => {
    expect(isLoopbackOrPrivateHost('fe80::1')).toBe(false);
  });

  test('still allows loopback', () => {
    expect(isLoopbackOrPrivateHost('localhost')).toBe(true);
    expect(isLoopbackOrPrivateHost('127.0.0.1')).toBe(true);
    expect(isLoopbackOrPrivateHost('::1')).toBe(true);
  });

  test('still allows RFC1918 private LAN ranges', () => {
    expect(isLoopbackOrPrivateHost('10.0.0.5')).toBe(true);
    expect(isLoopbackOrPrivateHost('192.168.1.10')).toBe(true);
    expect(isLoopbackOrPrivateHost('172.16.0.1')).toBe(true);
    expect(isLoopbackOrPrivateHost('172.31.255.255')).toBe(true);
  });

  test('still allows .local mDNS names and IPv6 unique-local (fc00::/7)', () => {
    expect(isLoopbackOrPrivateHost('my-ollama-box.local')).toBe(true);
    expect(isLoopbackOrPrivateHost('fd12:3456:789a::1')).toBe(true);
  });

  test('rejects a public host', () => {
    expect(isLoopbackOrPrivateHost('example.com')).toBe(false);
    expect(isLoopbackOrPrivateHost('8.8.8.8')).toBe(false);
  });
});

describe('validateOllamaUrl — SSRF guard end-to-end', () => {
  test('rejects a URL pointing at the cloud-metadata endpoint', () => {
    const result = validateOllamaUrl('http://169.254.169.254/latest/meta-data/');
    expect(result.valid).toBe(false);
  });

  test('accepts a loopback URL', () => {
    const result = validateOllamaUrl('http://127.0.0.1:11434');
    expect(result.valid).toBe(true);
  });

  test('rejects a public URL', () => {
    const result = validateOllamaUrl('https://example.com');
    expect(result.valid).toBe(false);
  });
});
