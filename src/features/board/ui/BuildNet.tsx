import { Icon } from '@/core/ui/kit/Icons';
import { NET_KINDS, NET_LABEL, netName, netOfSnap, type NetKind } from '@/features/board/sim/buildnet';
import { PartArt } from '@/features/economy/ui/shop/PartArt';
import { kindIcon, priceOf } from '@/features/economy/ui/shop/shopdata';
import { getIspSpec, getRouterSpec } from '@/features/network/sim';
import { getOsSpec } from '@/features/os/sim';
import type { Snapshot } from '@/worker/protocol';
import { linkLine, rate } from './buildhud';

type Stage = import('../render/three/buildmode3d').BuildStage;

const money = (n: number): string => `$${n.toLocaleString('en-US')}`;

/** A few words under a network item's name: what it gives (short: the panel is narrow; the row's tooltip says all of it). */
function detail(kind: NetKind, id: string, full = false): string {
  if (kind === 'router') {
    const r = getRouterSpec(id);
    return r ? `${rate(r.mbps)}${full ? ` · ${r.clients} clients` : ''}` : '';
  }
  if (kind === 'isp') {
    const p = getIspSpec(id);
    return p ? `${rate(p.downMbps)} down${full ? ` · ${rate(p.upMbps)} up · ${p.clients} clients` : ''}` : '';
  }
  const o = getOsSpec(id);
  return o
    ? `${o.programSlots} program${o.programSlots === 1 ? '' : 's'}${full ? ` · ${o.queueSlots} queued jobs` : ''}`
    : '';
}

/**
 * The network at the foot of the machine's list: the OS, the router and the internet plan, a row each (an empty place is a dashed row that opens the shelf at its
 * kind; a full one opens it too, to choose another, and its eject takes it out), and one line for the link they make with the cable: the speed and what holds it back.
 */
export function BuildNet({
  stage,
  snap,
  busy,
  onShelf,
}: {
  stage: Stage | null;
  snap: Snapshot;
  busy: boolean;
  onShelf: (kind: string) => void;
}) {
  const state = netOfSnap(snap),
    link = linkLine(snap.net);
  return (
    <>
      <li class="bld-grp static">
        <span class="bld-gk">
          <Icon name="router" size={11} />
          Network and software
        </span>
      </li>
      {NET_KINDS.map((kind) => {
        const id = state[kind];
        if (!id) {
          return (
            <li class="bld-part shell vacant" key={kind} data-net={kind}>
              <button
                class="bld-shellbtn"
                title={`Choose ${kind === 'os' ? 'an operating system' : kind === 'router' ? 'a router' : 'an internet plan'} from the shelf`}
                onClick={() => onShelf(kind)}
              >
                <span class="bld-thumb">
                  <Icon name={kindIcon(kind)} size={16} />
                </span>
                <span class="bld-row">
                  <span class="bld-name">No {NET_LABEL[kind].toLowerCase()}</span>
                  <em>Pick one from the shelf</em>
                </span>
                <Icon name="next" size={10} class="bld-go" />
              </button>
            </li>
          );
        }
        const price = priceOf(id);
        return (
          <li class="bld-part shell" key={kind} data-net={kind}>
            <button
              class="bld-shellbtn"
              title={`${netName(id)}: ${detail(kind, id, true)}. Choose another ${NET_LABEL[kind].toLowerCase()} from the shelf`}
              onClick={() => onShelf(kind)}
            >
              <span class="bld-thumb">
                <PartArt id={id} size={32} />
              </span>
              <span class="bld-row">
                <span class="bld-name">{netName(id)}</span>
                <em>{detail(kind, id)}</em>
              </span>
              {price !== null && <span class="bld-cost">{money(price)}</span>}
            </button>
            <button
              class="bld-out"
              disabled={busy || !stage}
              aria-label={`Take out ${netName(id)}`}
              title="Take it out"
              onClick={() => {
                void stage?.removeNet(kind);
              }}
            >
              <Icon name="eject" size={11} />
            </button>
          </li>
        );
      })}
      <li
        class={`bld-link ${link.tone}`}
        role="status"
        title="The link the OS, the router, the plan and the ethernet cable make"
      >
        <Icon name="globe" size={11} />
        <span>{link.text}</span>
      </li>
    </>
  );
}
