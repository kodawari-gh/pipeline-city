import type { RefObject } from 'preact';
import { Icon } from '@/core/ui/kit/Icons';
import { netKindOf } from '@/features/board/sim/buildnet';
import { PartShelf } from '@/features/economy/ui/shop/PartShelf';

type Part = import('../render/three/buildmode3d').BinPart;

/** What a press on a tile starts: a part off the shelf (the stage's shelf is unlimited). */
export interface Pressed { item: string; spec: string; name: string }

/**
 * The left panel: the catalogue (the studio's shelf, `PartShelf`, as the Gallery has it). Drag a tile onto the PC; a click fits it in the first free
 * socket. While a machine part is dragged the panel is the bin: it says so and takes the drop.
 */
export function BuildShelf({ shelf, kinds, parts, kind, setKind, busy, press, fit, taking, over, lift }: {
  shelf: RefObject<HTMLElement | null>;
  kinds: readonly string[];
  parts: readonly Part[];
  kind: string;
  setKind: (k: string) => void;
  busy: boolean;
  press: (t: Pressed, e: PointerEvent) => void;
  /** Fit a part in the first free socket (the key on a focused tile; a click is `press` without a move). */
  fit: (item: string) => void;
  /** A machine part is being dragged out: the shelf shows its drop zone. */
  taking: boolean;
  /** ...and the pointer is over the shelf. */
  over: boolean;
  /** A drag is in the air: the parts flyout stays open until it lets go. */
  lift: boolean;
}) {
  return (
    <PartShelf
      shelf={shelf}
      class={`${lift ? 'lift' : ''} ${taking ? 'taking' : ''} ${taking && over ? 'drop' : ''}`}
      eyebrow="Workshop"
      title="Build my PC"
      kinds={kinds}
      parts={parts}
      kind={kind}
      setKind={setKind}
      all
      dim={busy}
      tip={(p) => (netKindOf(p.id)
        ? `${p.name}. Drag it onto the stage, or click, to ${p.kind === 'os' ? 'install it on the first drive that holds it' : p.kind === 'router' ? 'stand it by the wall, cabled to the PC' : 'bring it in by the wall jack'}.`
        : `${p.name}. Drag it onto the PC to fit it, or click to fit it in the first free socket.`)}
      onPress={(p, e) => press({ item: p.id, spec: p.id, name: p.name }, e)}
      onActivate={(p) => fit(p.id)}
    >
      <div class="bld-bin-note" aria-hidden={!taking}>
        <Icon name="eject" size={22} />
        <b>Drop it here to take it out</b>
        <span>Everything in its way comes out first.</span>
      </div>
    </PartShelf>
  );
}
