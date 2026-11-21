// The address each network card carries in its flash (docs/render/net.md "Inside the NIC and the router"): the maker's prefix, then bytes of its own. The 3D card's
// sticker (board/render/three/nic3d.ts `macLabel`) and the card's detailed view print the same one. Data only, so any layer may import it.

const MAC: Record<string, string> = { 'nic-gbe': '00:1B:21:3A:7C:4F', 'nic-10g': '00:1B:21:5C:7C:4F', 'nic-40g': '00:1B:21:3D:7C:E0' };

/** The MAC address of the card of look `visual`. */
export const macOf = (visual: string): string => MAC[visual] ?? MAC['nic-gbe']!;
