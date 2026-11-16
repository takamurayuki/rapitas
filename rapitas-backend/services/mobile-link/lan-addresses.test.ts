/**
 * lan-addresses tests (#1421)
 */
import { test, expect } from 'bun:test';
import type { NetworkInterfaceInfo } from 'node:os';
import { lanAddresses } from './lan-addresses';

const v4 = (address: string, internal = false) =>
  ({ address, family: 'IPv4', internal, netmask: '', mac: '', cidr: null }) as NetworkInterfaceInfo;

test('keeps real LAN IPv4 addresses, private ranges first, and drops the rest', () => {
  const result = lanAddresses({
    lo: [v4('127.0.0.1', true)],
    'Wi-Fi': [
      v4('100.64.1.2'),
      v4('192.168.1.5'),
      { ...v4('fe80::1'), family: 'IPv6' } as NetworkInterfaceInfo,
    ],
    Ethernet: [v4('10.0.0.8'), v4('169.254.3.4')],
    docker0: [v4('172.17.0.1')],
    'vEthernet (WSL)': [v4('172.20.0.1')],
  });
  expect(result).toEqual(['192.168.1.5', '10.0.0.8', '100.64.1.2']);
});

test('keeps a mesh VPN (Tailscale, 100.64/10) address on a utun interface, after the LAN', () => {
  const result = lanAddresses({
    en0: [v4('192.168.1.5')],
    utun9: [v4('100.64.5.5')],
  });
  expect(result).toEqual(['192.168.1.5', '100.64.5.5']);
});

test('still drops non-mesh addresses on virtual interfaces', () => {
  const result = lanAddresses({
    en0: [v4('192.168.1.5')],
    utun9: [v4('10.1.2.3')],
    tun0: [v4('100.128.0.1')],
    docker0: [v4('172.17.0.1')],
  });
  expect(result).toEqual(['192.168.1.5']);
});

test('mesh VPN range on a virtual interface is exactly 100.64.0.0/10 (boundaries)', () => {
  const result = lanAddresses({
    utun9: [v4('100.63.255.255'), v4('100.64.0.0'), v4('100.127.255.255'), v4('100.128.0.0')],
  });
  // Both survivors share the same rank, so the stable sort keeps input order.
  expect(result).toEqual(['100.64.0.0', '100.127.255.255']);
});
