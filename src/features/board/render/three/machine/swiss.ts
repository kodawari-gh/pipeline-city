// The Swiss mains plugs (machine3d.ts, the mains cords): the room's, drawn small as its wall plate is (`ROOM_SOCKET`), and the studio wall's, a real
// type 12 plug in a real type 13 recess.
import { hexNum } from '../../skins';
import { seatPlug } from '../cablerig3d';
import { swissEngage, swissPlug, swissReal } from '../plugs3d';
import { ROOM_SOCKET } from '../swisssocket3d';
import { MM as WALL_MM } from '../studiowall3d';
import type { CableRig, Look, Seat } from './types';

/** Where a room's mains plug seats: the room's plate is drawn small (swisssocket3d.ts `ROOM_SOCKET`), the plug at the same scale, upright, its earth pin down. */
export const roomSeat = (socket: { x: number; y: number }): Seat => ({
  at: [socket.x, -socket.y, ROOM_SOCKET.face],
  axis: [0, 0, 1],
});

/** The room's mains plug, at the plate's scale. */
export const roomModel =
  (cord: Look, seat: Seat): CableRig['model'] =>
  () => {
    const fit = swissReal(cord.r, hexNum(cord.base), ROOM_SOCKET.k);
    return seatPlug(seat, swissPlug(fit));
  };

/** How far the room's plug goes in. */
export const roomEngage = (): CableRig['engage'] => swissEngage(ROOM_SOCKET.k);

/** The studio wall's mains plug, turned as the socket of the pinwheel it goes into. */
export const wallModel =
  (cord: Look, seat: Seat, roll: number): CableRig['model'] =>
  () => {
    const fit = swissReal(cord.r, hexNum(cord.base));
    return seatPlug(seat, swissPlug(fit), roll);
  };

/** How far the wall's plug goes in. */
export const wallEngage = (): CableRig['engage'] => swissEngage(WALL_MM);
