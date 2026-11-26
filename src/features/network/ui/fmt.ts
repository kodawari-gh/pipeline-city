// Speeds in words, shared by the network's descriptions (netdesc.ts, nicdesc.ts) and its panel. Pure.

/** Speed in words: 100 Mbit, 1 Gbit, 1.5 Gbit, 40 Gbit. (Per second is implied; tooltips say Mbit/s.) */
export function fmtMbit(n: number): string {
  if (!Number.isFinite(n)) {
    return '-';
  }
  if (n >= 1000) {
    const g = n / 1000;
    return `${Number.isInteger(g) ? g : g.toFixed(1)} Gbit`;
  }
  return `${Number.isInteger(n) ? n : n.toFixed(1)} Mbit`;
}
