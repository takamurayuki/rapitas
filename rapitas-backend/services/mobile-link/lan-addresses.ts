/**
 * LanAddresses
 *
 * Lists the IPv4 addresses a phone on the same network could reach this
 * desktop at, for the QR payload (#1421). The phone tries them in order, and
 * falls back to mDNS discovery when all of them have changed.
 */
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';

/** Interface names that are never the LAN the phone is on. */
const VIRTUAL_INTERFACE = /^(docker|br-|veth|vmnet|vboxnet|virbr|utun|tun|tap|zt|wsl|vEthernet)/i;

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
    if (!infos || VIRTUAL_INTERFACE.test(name)) continue;
    for (const info of infos) {
      if (info.family !== 'IPv4' || info.internal) continue;
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
