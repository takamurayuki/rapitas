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
