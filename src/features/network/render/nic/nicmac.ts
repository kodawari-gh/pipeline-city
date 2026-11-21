// The address each network card carries in its flash (docs/render/net.md "Inside the NIC and the router"): the initials of the invented maker (RL) after the locally administered
// 02 (no real maker's prefix), then bytes of its own. The 3D card's
// sticker (board/render/three/nic3d.ts `macLabel`) and the card's detailed view print the same one. Data only, so any layer may import it.

const MAC: Record<string, string> = { 'nic-gbe': '02:52:4C:3A:7C:4F', 'nic-10g': '02:52:4C:5C:7C:4F', 'nic-40g': '02:52:4C:3D:7C:E0' };

/** The MAC address of the card of look `visual`. */
export const macOf = (visual: string): string => MAC[visual] ?? MAC['nic-gbe']!;
