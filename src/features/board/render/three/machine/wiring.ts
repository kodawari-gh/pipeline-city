// The cables built in turn (machine3d.ts): the supply's leads, the drives' cables, the fans' cords and the front-panel leads in the case, then the
// cords out of it.
import { buildRoomCords } from './cords';
import { fanCords } from './fancords';
import { insideOf } from './inside';
import { boardLeads } from './leads';
import { pcieLeads } from './pcie-leads';
import { sataCables } from './sata';
import { panelLeads } from './panel';
import type { MachineParts, RoomGeo, Snapshot } from './types';

/**
 * The cables, as real cables hanging under their weight (wires3d.ts): each power lead comes out of a grommet in the tray beside its socket (its
 * run from the power supply is behind the tray) as a comb of sleeved strands into its plug, or hangs loose with the plug at its end when it is
 * out. The PCIe leads (dealt to the cards as the sim deals them, `assignLeads`) plug into the cards' top edges; each drive's SATA cable runs
 * from its port into the gutter; the fans' cords run to their headers and the hub; the loop's hoses arc to the radiator. Out of the case the
 * video cable drapes over the desk to the monitor, the mains cords drop through the desk's grommet to the wall socket.
 */
export function* buildCables(m: MachineParts, s: Snapshot, geo: RoomGeo): Generator<void> {
  const c = insideOf(m, s);
  m.rigs.clear();
  yield* boardLeads(m, c);
  yield* pcieLeads(m, c);
  yield* sataCables(m, c);
  yield* fanCords(m, c);
  panelLeads(m, c);
  yield;
  yield* buildRoomCords(m, s, geo);
}
