// The PCIe power leads (machine3d.ts, the cables in the case): the supply's leads dealt to the cards that take one, a lead each.
import { assignLeads } from '../../../sim/cables';
import { isPcieKind } from '../../wiring/routes';
import { specOf, visualOf } from './keys';
import type { Inside, MachineParts } from './types';
import { pcieLead } from './pcie';

/** The PCIe leads: each from its own grommet in the gutter up into a card's top edge, or loose. */
export function* pcieLeads(m: MachineParts, c: Inside): Generator<void> {
  const cards = c.s.devices
    .filter((d) => (d.kind === 'gpu' || d.kind === 'npu') && !d.burnt)
    .map((d) => ({
      slot: d.slot,
      loadW: specOf(d.spec).loadW,
      visual: visualOf(d.spec),
    }));
  const deals = assignLeads(cards);
  const leads = c.alive.flatMap((y) => (isPcieKind(y.id) ? [{ id: y.id, connected: y.connected }] : []));
  for (const [k, x] of leads.entries()) {
    const deal = deals.find((l) => l.lead === x.id),
      card = deal && m.cards.get(deal.slot),
      sock = card !== undefined && deal !== undefined ? card.sockets[deal.plug] : undefined;
    const target = (deal && c.s.devices.find((d) => d.slot === deal.slot)?.id) ?? null;
    yield* pcieLead(m, c, { k, id: x.id, connected: x.connected, target, sock, card });
  }
}
