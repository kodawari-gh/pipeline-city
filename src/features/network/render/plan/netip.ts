// IP, MAC and prefix helpers for the network address model (docs/render/net.md "Addresses").

// ---------------------------------------------------------------- the small arithmetic

/** FNV-1a: the same text gives the same number. */
export function hash32(s: string): number {
  let h = 0x81_1c_9d_c5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.codePointAt(i) ?? 0;
    h = Math.imul(h, 0x01_00_01_93);
  }
  return h >>> 0;
}

const hex2 = (n: number): string => (n & 255).toString(16).toUpperCase().padStart(2, '0');
/** A MAC address from its six bytes. */
const macOfBytes = (b: readonly number[]): string => b.map((n) => hex2(n)).join(':');
/** An IPv4 address from the four bytes (a 32 bit number is split in four). */
export const ipv4 = (o: { a: number; b: number; c: number; d: number }): number =>
  (((o.a * 256 + o.b) * 256 + o.c) * 256 + o.d) >>> 0;
export const ipStr = (n: number): string => [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.');
export const maskBits = (prefix: number): number => (prefix <= 0 ? 0 : (0xff_ff_ff_ff << (32 - prefix)) >>> 0);
/** The dotted mask of a prefix length (24: 255.255.255.0). */
export const maskOf = (prefix: number): string => ipStr(maskBits(prefix));

/** Is this text a MAC address? (Six pairs of hex digits, colons between.) */
export const isMac = (s: string): boolean => /^(?:[0-9A-F]{2}:){5}[0-9A-F]{2}$/u.test(s);
/** Is this text a dotted IPv4 address? */
export const isIp = (s: string): boolean => {
  const p = s.split('.');
  return p.length === 4 && p.every((x) => /^\d{1,3}$/u.test(x) && Number(x) <= 255);
};

// ---------------------------------------------------------------- what the game's parts are called

/**
 * The LAN each router makes, by tier: a home router a /24, the faster ones larger (the 10G switch-router a /22, the edge router a /16). The router takes the first address, the
 * DHCP pool starts at 100.
 */
export const LAN: Record<number, { base: number; prefix: number }> = {
  1: { base: ipv4({ a: 192, b: 168, c: 0, d: 0 }), prefix: 24 },
  2: { base: ipv4({ a: 192, b: 168, c: 1, d: 0 }), prefix: 24 },
  3: { base: ipv4({ a: 10, b: 10, c: 0, d: 0 }), prefix: 22 },
  4: { base: ipv4({ a: 10, b: 0, c: 0, d: 0 }), prefix: 16 },
};
/** The lease the router's DHCP gives, in words. */
export const LEASE = '24 h';
/** The ISP's side of the line: one documentation block (RFC 5737 TEST-NET-3): the gateway at 1, the name servers at 53 and 54, the plans' customers above 100. */
export const ISP_NET = ipv4({ a: 203, b: 0, c: 113, d: 0 });
/** The job servers: another documentation block (TEST-NET-2). */
export const SERVER_NET = ipv4({ a: 198, b: 51, c: 100, d: 0 });

/** The router's two MACs, by tier: the maker's initials (RL) after the locally administered 02, the tier, then 01 for the WAN jack and 02 for the LAN jack. */
export const routerMac = (tier: number, lan: boolean): string =>
  macOfBytes([0x02, 0x52, 0x4c, tier, 0x00, lan ? 2 : 1]);
/** The ISP gateway's MAC, by the plan's tier (the initials ISP). */
export const gatewayMac = (tier: number): string => macOfBytes([0x02, 0x49, 0x53, 0x50, 0x00, tier]);
/** The board's own jack: the initials HAKO's board, its tier. */
export const boardMac = (tier: number): string => macOfBytes([0x02, 0x48, 0x41, 0x4b, tier, 0x01]);
