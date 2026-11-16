/**
 * LanAddresses
 *
 * Lists the IPv4 addresses a phone on the same network could reach this
 * desktop at, for the QR payload (#1421). The phone tries them in order, and
 * falls back to mDNS discovery when all of them have changed.
 * Mesh VPN (Tailscale) addresses in 100.64.0.0/10 are included too, even on
 * virtual interfaces such as macOS utun, so the phone can connect away from home.
 */
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';

/** Interface names that are never the LAN the phone is on. */
const VIRTUAL_INTERFACE = /^(docker|br-|veth|vmnet|vboxnet|virbr|utun|tun|tap|zt|wsl|vEthernet)/i;

/** 100.64.0.0/10 (CGNAT), the range Tailscale assigns mesh VPN addresses from. */
const MESH_VPN_ADDRESS = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./;

/**
 * Reachable-looking IPv4 addresses, private ranges first.
 *
 * @param interfaces - Interfaces to read (tests inject) / 読み取るインターフェース
 * @returns Candidate addresses / 候補アドレス
 */
export function lanAddresses(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces(),
): string[] {
  const out: string[] = [];
  for (const [name, infos] of Object.entries(interfaces)) {
    if (!infos) continue;
    const virtual = VIRTUAL_INTERFACE.test(name);
    for (const info of infos) {
      if (info.family !== 'IPv4' || info.internal) continue;
      // A virtual interface is skipped unless it carries a mesh VPN address.
      if (virtual && !MESH_VPN_ADDRESS.test(info.address)) continue;
      // 169.254/16 is link-local: present when DHCP failed, never routable.
      if (info.address.startsWith('169.254.')) continue;
      out.push(info.address);
    }
  }
  return [...new Set(out)].sort((a, b) => rank(a) - rank(b));
}

function rank(address: string): number {
  if (address.startsWith('192.168.')) return 0;
  if (address.startsWith('10.')) return 1;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) return 2;
  return 3;
}
