import type { JSX } from 'preact';
import { fmtTicks } from '@/core/ui/logic';
import { Meter } from '@/core/ui/kit/Meter';
import * as netui from './netui';

type Panel = netui.NetPanelModel;

/** The offers a client holds out first; the rest sit behind a fold. */
const OFFER_ROWS = 4;

export function TransfersSection({ m }: { m: Panel }): JSX.Element | null {
  if (m.transfers.length === 0) {
    return null;
  }
  return (
    <section>
      <h3>Transfers</h3>
      {m.transfers.map((t) => (
        <div key={`${t.jobId}${t.dir}`}>
          <div class="bar-row" title={`${t.doneMB.toFixed(1)} of ${t.totalMB.toFixed(1)} MB, ${t.etaText} left`}>
            <span>
              {t.dir === 'down' ? 'down' : 'up'} {t.label}
            </span>
            <Meter
              value={t.pct}
              max={100}
              level="ok"
              label={`${t.label} ${t.dir}load`}
              text={`${Math.round(t.pct)} percent`}
            />
            <b>{Math.round(t.pct)}%</b>
          </div>
          {t.flow !== null && t.flow !== undefined && (
            <div class="mute sub" title={t.flow.title}>
              {t.flow.text}
              {t.flow.resent > 0 ? <b class="warn"> · {t.flow.resent} sent again</b> : null}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

export function OffersSection({ m }: { m: Panel }): JSX.Element | null {
  if (m.offers.length === 0) {
    return null;
  }
  return (
    <section>
      <h3>
        Offers <span class="mute">· {m.offers.length}</span>
      </h3>
      {m.offers.slice(0, OFFER_ROWS).map((o) => (
        <OfferLine key={o.key.id} o={o} />
      ))}
      {m.offers.length > OFFER_ROWS && (
        <details class="net-more">
          <summary>{m.offers.length - OFFER_ROWS} more</summary>
          {m.offers.slice(OFFER_ROWS).map((o) => (
            <OfferLine key={o.key.id} o={o} />
          ))}
        </details>
      )}
    </section>
  );
}

export function SpoolSection({ m }: { m: Panel }): JSX.Element | null {
  if (m.spooled.length === 0 && m.spool === null) {
    return null;
  }
  return (
    <section>
      <h3>
        Spool
        {m.spool !== null && (
          <span class="mute">
            {' '}
            · {m.spool.used}/{m.spool.slots}
          </span>
        )}
      </h3>
      {m.spool?.full === true && (
        <div class="kv warn">
          <span>Spool full</span>
          <b>no new downloads</b>
        </div>
      )}
      {m.spooled.map((k) => (
        <div class="kv" key={k.key.id}>
          <span>{k.label}</span>
          <b class={k.level === 'ok' ? '' : 'mute'}>{k.state}</b>
        </div>
      ))}
    </section>
  );
}

export function UsbSection({ m }: { m: Panel }): JSX.Element | null {
  if (m.usb === null) {
    return null;
  }
  return (
    <section>
      <h3>USB</h3>
      <div class="kv" title={m.usb.detail ?? ''}>
        <span class={`chip ${m.usb.level}`}>{m.usb.text}</span>
      </div>
      {m.usb.detail !== null && m.usb.detail !== '' && <div class="mute sub">{m.usb.detail}</div>}
    </section>
  );
}

function OfferLine({ o }: { o: netui.OfferRow }) {
  return (
    <div
      class="kv"
      title={`${o.type} job. The client leaves in ${fmtTicks(o.left)}.${o.sla !== null && o.sla !== undefined ? ' A web client pays in full only if the answer is back in time.' : ''}`}
    >
      <span>
        {o.label}
        {o.retired && <span class="chip idle"> retired</span>}
        {o.sla !== null && o.sla !== undefined && <span class={`sla ${o.sla.over ? 'warn' : ''}`}> {o.sla.text}</span>}
      </span>
      <b class={o.late ? 'warn' : ''}>{netui.offerPay(o)}</b>
    </div>
  );
}
