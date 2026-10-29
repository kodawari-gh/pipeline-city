import { useEffect, useRef, useState } from 'preact/hooks';
import type { Snapshot } from '../../sim/game/game';
import { Icon } from '../kit/Icons';
import { billChip, fmtNum, fmtTicks } from '../logic';

// The power bill in the HUD bar (docs/GAME.md "The power bill"): a chip with what is running up and when it is due, and a
// popover with the rate and the figures behind it. Styles are in ui.css (the power bill section).
// Keyboard: the chip toggles the popover, Escape closes it and gives focus back to the chip.

export function PowerBill({ s }: { s: Snapshot }) {
  const [open, setOpen] = useState(false);
  const chip = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      chip.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const c = billChip(s);
  const b = s.bill;
  if (!c || !b) return null;
  const rate = `$${fmtNum(b.ratePerWh, 2)} per Wh`;
  return (
    <div class="bill">
      <button
        ref={chip} class={`chip ${c.level}`} aria-expanded={open} aria-controls="bill-pop" data-hud="bill"
        title={`Power bill: ${rate}, issued every ${fmtTicks(b.periodTicks)} and paid from your money. Click for the details.`}
        onClick={() => setOpen(!open)}
      >
        <Icon name="bolt" size={12} /> {c.text}
      </button>
      {open && (
        <div id="bill-pop" class="card bill-pop" role="dialog" aria-label="Power bill">
          <dl>
            <dt>Rate</dt><dd>{rate}</dd>
            <dt>Drawing now</dt><dd>{fmtNum(s.energy.wallW, 0)} W</dd>
            <dt>Since the last bill</dt><dd>{fmtNum(b.accruedWh, 1)} Wh = ${b.accruedCost}</dd>
            <dt>Next bill</dt><dd>{b.nextTick === null ? 'after the first power-on' : `in ${fmtTicks(b.nextTick - s.baseTick)}`}</dd>
            <dt>Last bill</dt><dd>{b.last ? `$${b.last.amount} (${fmtNum(b.last.wh, 1)} Wh)` : 'none yet'}</dd>
            <dt>Paid so far</dt><dd>${b.paidTotal}</dd>
            {b.unpaid > 0 && <><dt>Unpaid</dt><dd class="bad">${b.unpaid}</dd></>}
          </dl>
          <div class="bill-msg">
            {b.cut
              ? 'The wall is cut. The bill is paid by itself once you have the money (sell a spare part if you must), then press power.'
              : b.unpaid > 0
                ? `Not enough money. The wall is cut ${b.cutTick === null ? 'soon' : `in ${fmtTicks(b.cutTick - s.baseTick)}`} unless the bill is paid.`
                : 'Bills are paid from your money by themselves. A bill you cannot pay cuts the wall after a short grace.'}
          </div>
        </div>
      )}
    </div>
  );
}
