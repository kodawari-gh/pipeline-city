import { snapshot } from '@/app/store';
import { fmtTicks } from '@/core/ui/logic';
import { Icon } from '@/core/ui/kit/Icons';
import { Meter } from '@/core/ui/kit/Meter';
import { fmtMbit, netPanel, netPanelShown, offerPay, type AddrRow, type NatRow, type OfferRow } from './netui';
import { netOpen, toggleNet } from '@/core/ui/state';

/** The network panel body: link state, bandwidth ladder, flow stages, offers, transfers, spool, USB fallback. */
export function NetPanel() {
  const s = snapshot.value;
  const m = s ? netPanel(s) : null;
  if (!m) return null;
  const up = m.ladder.segs.length > 0;
  return (
    <div class="stats netpanel">
      <h2>Network</h2>
      <section class="net-head">
        <div class="kv">
          <span class={`chip ${m.chip.level}`} title={m.chip.title}>{m.chip.text}</span>
          <span class="net-clients" title="Clients being served right now, of the most the plan allows"><b>{m.clients.busy}</b>/{m.clients.max} clients</span>
        </div>
        {m.reason && <div class="mute sub">{m.reason}</div>}
        <div class="net-speed">
          <span title="How fast jobs come in"><small>Down</small><b>{up ? fmtMbit(m.ladder.downMbps) : '-'}</b></span>
          <span title="How fast answers go out"><small>Up</small><b>{up ? fmtMbit(m.ladder.upMbps) : '-'}</b></span>
        </div>
      </section>
      <section>
        <h3 title="Port, router, plan and drive side by side. The slowest one sets the speed.">What sets the speed</h3>
        <div class="net-ladder">
          {m.ladder.segs.map((g) => (
            <div key={g.id} class={`net-seg${g.binding ? ' binding' : ''}`} title={g.detail}>
              <div class="kv"><span>{g.label}{g.binding && <em class="net-limit">limit</em>}</span><b>{g.text}</b></div>
              <i style={{ width: `${g.frac * 100}%` }} />
            </div>
          ))}
        </div>
        {m.uploadLimit && <div class="kv" title="The slowest piece on the way out. Web jobs are paid for how fast the answer goes back."><span>on the way out</span><b class="limit">{m.uploadLimit}</b></div>}
        {m.advice && <div class="mute sub">{m.advice}</div>}
      </section>
      <section>
        <h3>On the wire <span class="mute">· {m.delivered} delivered</span></h3>
        <div class="net-flow" role="list">
          {m.stages.map((g) => <span key={g.id} role="listitem" class={`net-step${g.count ? ' live' : ''}`}><b>{g.count}</b><small>{g.label}</small></span>)}
        </div>
        {m.uploadsWaiting > 0 && (
          <div class="kv warn" title="Finished results are waiting for a free client slot. A router and plan with more clients send them sooner.">
            <span>Waiting for a slot</span><b>{m.uploadsWaiting}</b>
          </div>
        )}
      </section>
      {m.stack && (
        <details class="stat-fold" open>
          <summary title="How the jobs travel: in segments, each answered by the kernel. A segment the line loses, or the card drops because the kernel is busy, is sent again after a timeout.">
            <h3>Packets</h3><span class="mute">{m.stack.rows.find((r) => r.id === 'loss')?.text} loss</span>
          </summary>
          {m.stack.rows.map((r) => <div class={`kv${r.level === 'warn' ? ' warn' : ''}`} key={r.id} title={r.title}><span>{r.label}</span><b>{r.text}</b></div>)}
        </details>
      )}
      {m.addrs.rows.length > 0 && (
        <details class="stat-fold" open>
          <summary title="The names the network uses. An IP address says where a machine is. A MAC address says which network jack it is. The router's DHCP gives the PC its IP address while the link is up.">
            <h3>Addresses</h3><span class="mute">{m.addrs.rows[0]!.id === 'pc' ? m.addrs.rows[0]!.ip ?? 'no IP address' : ''}</span>
          </summary>
          {m.addrs.rows.map((r) => <AddrLine key={r.id} r={r} />)}
        </details>
      )}
      {m.addrs.nat.length > 0 && (
        <details class="stat-fold" open>
          <summary title="The router's NAT table: one line for each job in flight. The router swaps the PC's private address and port for its own public ones, so the server sees only the router.">
            <h3>NAT table</h3><span class="mute">{m.addrs.nat.length}</span>
          </summary>
          {m.addrs.nat.slice(0, NAT_ROWS).map((c) => <NatLine key={c.key} c={c} />)}
          {m.addrs.nat.length > NAT_ROWS && (
            <details class="net-more">
              <summary>{m.addrs.nat.length - NAT_ROWS} more</summary>
              {m.addrs.nat.slice(NAT_ROWS).map((c) => <NatLine key={c.key} c={c} />)}
            </details>
          )}
        </details>
      )}
      {m.transfers.length > 0 && (
        <section>
          <h3>Transfers</h3>
          {m.transfers.map((t) => (
            <div key={`${t.jobId}${t.dir}`}>
              <div class="bar-row" title={`${t.doneMB.toFixed(1)} of ${t.totalMB.toFixed(1)} MB, ${t.etaText} left`}>
                <span>{t.dir === 'down' ? 'down' : 'up'} {t.label}</span>
                <Meter value={t.pct} max={100} level="ok" label={`${t.label} ${t.dir}load`} text={`${Math.round(t.pct)} percent`} />
                <b>{Math.round(t.pct)}%</b>
              </div>
              {t.flow && <div class="mute sub" title={t.flow.title}>{t.flow.text}{t.flow.resent > 0 && <b class="warn"> · {t.flow.resent} sent again</b>}</div>}
            </div>
          ))}
        </section>
      )}
      {m.offers.length > 0 && (
        <section>
          <h3>Offers <span class="mute">· {m.offers.length}</span></h3>
          {m.offers.slice(0, OFFER_ROWS).map((o) => <OfferLine key={o.key.id} o={o} />)}
          {m.offers.length > OFFER_ROWS && (
            <details class="net-more">
              <summary>{m.offers.length - OFFER_ROWS} more</summary>
              {m.offers.slice(OFFER_ROWS).map((o) => <OfferLine key={o.key.id} o={o} />)}
            </details>
          )}
        </section>
      )}
      {(m.spooled.length > 0 || m.spool) && (
        <section>
          <h3>Spool{m.spool && <span class="mute"> · {m.spool.used}/{m.spool.slots}</span>}</h3>
          {m.spool?.full && <div class="kv warn"><span>Spool full</span><b>no new downloads</b></div>}
          {m.spooled.map((k) => <div class="kv" key={k.key.id}><span>{k.label}</span><b class={k.level === 'ok' ? '' : 'mute'}>{k.state}</b></div>)}
        </section>
      )}
      {m.usb && (
        <section>
          <h3>USB</h3>
          <div class="kv" title={m.usb.detail ?? ''}><span class={`chip ${m.usb.level}`}>{m.usb.text}</span></div>
          {m.usb.detail && <div class="mute sub">{m.usb.detail}</div>}
        </section>
      )}
      {m.retiredKeys > 0 && <div class="kv"><span>Retired keys</span><b>{m.retiredKeys}</b></div>}
    </div>
  );
}

/** The offers a client holds out first; the rest sit behind a fold. */
const OFFER_ROWS = 4;
/** The NAT lines shown at once; the rest sit behind a fold. */
const NAT_ROWS = 3;

/** A place on the path: its name and IP address, its MAC under them, and (with no IP address) the reason. */
function AddrLine({ r }: { r: AddrRow }) {
  return (
    <div class="net-addr" title={r.note}>
      <div class="kv"><span>{r.label}</span><b class={r.ip ? '' : 'mute'}>{r.ip ?? 'no IP address'}</b></div>
      <div class="kv sub"><span>MAC</span><span class="mono">{r.mac}</span></div>
      {!r.ip && <div class="mute sub">{r.note}</div>}
    </div>
  );
}

/** A job's line of the NAT table: the job and the server it speaks to, then the two ports the router swaps. */
function NatLine({ c }: { c: NatRow }) {
  return (
    <div class="net-addr" title={c.line}>
      <div class="kv"><span>{c.label}</span><b>{c.proto} {c.server}</b></div>
      <div class="kv sub"><span class="mono">{c.ports}</span></div>
    </div>
  );
}

function OfferLine({ o }: { o: OfferRow }) {
  return (
    <div class="kv" title={`${o.type} job. The client leaves in ${fmtTicks(o.left)}.${o.sla ? ' A web client pays in full only if the answer is back in time.' : ''}`}>
      <span>{o.label}{o.retired && <span class="chip idle"> retired</span>}{o.sla && <span class={`sla ${o.sla.over ? 'warn' : ''}`}> {o.sla.text}</span>}</span>
      <b class={o.late ? 'warn' : ''}>{offerPay(o)}</b>
    </div>
  );
}

/** The dock that hosts the panel: shown while `netOpen` is set and a network exists. */
export function NetDock() {
  const s = snapshot.value;
  if (!s || !netPanelShown(netOpen.value, s)) return null;
  return (
    <aside class="dock" aria-label="Network">
      <button class="close" aria-label="Close network panel" onClick={toggleNet}><Icon name="close" size={11} /></button>
      <NetPanel />
    </aside>
  );
}
