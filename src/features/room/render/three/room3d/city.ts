// The city in the window, one for every room: built before the room (`prepareCity`), swapped when the graphics cross the Low line.
import { effective, isLow } from '@/app/graphics';
import { OutsideView } from '../outside/view';
import { WINDOW } from '../roomplan';
import { GLASS_Z } from './consts';
import type { CityDetail, Mesh, WebGLRenderer } from './types';

/** The city in the window, one for every room (a case of another tier is a new room, but the same view): it takes seconds to build. */
let city: OutsideView | null = null;
/** The city's detail now: Low graphics (`isLow`) build the cut city, any other settings the full one. */
export const wantedDetail = (): CityDetail => (isLow(effective.peek()) ? 'low' : 'high');
/** The window's quad for the city: its middle, its size and the depth of the glass. */
const cityQuad = () => [WINDOW.x + WINDOW.w / 2, -(WINDOW.y + WINDOW.h / 2), WINDOW.w, WINDOW.h, GLASS_Z] as const;
/** A city of another detail than wanted goes (the graphics settings crossed the Low line). */
const dropOldCity = (detail: CityDetail): void => {
  if (city && city.detail !== detail) {
    city.mesh.removeFromParent();
    city.dispose();
    city = null;
  }
};
/** The city of `detail` (the wanted one by default), built now if the room has none of it. */
export const theCity = (detail: CityDetail = wantedDetail()): OutsideView => {
  dropOldCity(detail);
  return (city ??= new OutsideView(...cityQuad(), detail));
};
/**
 * How the boot follows the city's build: `between` runs before each step, told its name and how far along the work is (0 to 1); `until`: the
 * baked textures, still loading (the buildings, which need none, build while they do).
 */
interface CityBoot {
  between?: (label: string, share: number) => Promise<void>;
  until?: Promise<void>;
}

/** A caller with no boot screen has nothing to show between the steps. */
const settled = Promise.resolve();
const noWait = async (): Promise<void> => settled;

/**
 * Builds the city in the window before the room, its sun's shadow at `shadows` of the graphics settings, and starts linking its programs
 * (`compile.ts`): the driver links them while the page builds the room. The city builds a step at a time: `between` runs before each (and
 * before the programs start), told its name and how far along the work is (0 to 1), so the boot screen can say it and the page can paint.
 * Once the programs start, the caller must not wait for a paint: it would wait for the driver.
 */
export async function prepareCity(
  r: WebGLRenderer,
  shadows: number,
  { between = noWait, until }: CityBoot = {},
): Promise<void> {
  const detail = wantedDetail();
  dropOldCity(detail);
  // `until`: the baked textures, still loading: the buildings, which need none, build while they do (`OutsideView.make`)
  city ??= await OutsideView.make(
    ...cityQuad(),
    detail,
    between,
    until && {
      until,
      turn: async () =>
        new Promise<void>((resolve) => {
          setTimeout(resolve, 0);
        }),
    },
  );
  const c = city;
  await between('Starting the city shaders', 1);

  c.setShadows(shadows);
  c.startPrograms(r);
}

/** The city's quad in the window (its root in the room), for the debug overlay's hide. Null until `prepareCity` has built the city. */
export const cityMesh = (): Mesh | null => city?.mesh ?? null;

/** The city's view, for the debug overlay's layer toggles and its triangle count (`app/debug/city-layers.ts`). Null until the city is built. */
export const cityLayers = (): OutsideView | null => city;
