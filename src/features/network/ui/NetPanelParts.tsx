import type { JSX } from 'preact';
import * as netui from './netui';

type Panel = netui.NetPanelModel;

/** The NAT lines shown at once; the rest sit behind a fold. */
const NAT_ROWS = 3;

export function NetHead({ m }: { m: Panel }): JSX.Element {
  const up = m.ladder.segs.length > 0;
  return (
    <section class="net-head">
      <div class="kv">
        <span class={`chip ${m.chip.level}`} title={m.chip.title}>
          {m.chip.text}
        </span>
        <span class="net-clients" title="Clients being served right now, of the most the plan allows">
          <b>{m.clients.busy}</b>/{m.clients.max} clients
        </span>
      </div>
      {m.reason !== null && m.reason !== '' && <div class="mute sub">{m.reason}</div>}
      <div class="net-speed">
        <span title="How fast jobs come in">
          <small>Down</small>
          <b>{up ? netui.fmtMbit(m.ladder.downMbps) : '-'}</b>
        </span>
        <span title="How fast answers go out">
          <small>Up</small>
          <b>{up ? netui.fmtMbit(m.ladder.upMbps) : '-'}</b>
        </span>
      </div>
    </section>
  );
}

export function SpeedLadder({ m }: { m: Panel }): JSX.Element {
  return (
    <section>
      <h3 title="Port, router, plan and drive side by side. The slowest one sets the speed.">What sets the speed</h3>
      <div class="net-ladder">
        {m.ladder.segs.map((g) => (
          <div key={g.id} class={`net-seg${g.binding ? ' binding' : ''}`} title={g.detail}>
            <div class="kv">
              <span>
                {g.label}
                {g.binding && <em class="net-limit">limit</em>}
              </span>
              <b>{g.text}</b>
            </div>
            <i style={{ width: `${g.frac * 100}%` }} />
          </div>
        ))}
      </div>
      {m.uploadLimit !== null && m.uploadLimit !== '' && (
        <div class="kv" title="The slowest piece on the way out. Web jobs are paid for how fast the answer goes back.">
          <span>on the way out</span>
          <b class="limit">{m.uploadLimit}</b>
        </div>
      )}
      {m.advice !== null && m.advice !== '' && <div class="mute sub">{m.advice}</div>}
    </section>
  );
}

export function OnTheWire({ m }: { m: Panel }): JSX.Element {
  return (
    <section>
      <h3>
        On the wire <span class="mute">· {m.delivered} delivered</span>
      </h3>
      <ul class="net-flow">
        {m.stages.map((g) => (
          <li key={g.id} class={`net-step${g.count ? ' live' : ''}`}>
            <b>{g.count}</b>
            <small>{g.label}</small>
          </li>
        ))}
      </ul>
      {m.uploadsWaiting > 0 && (
        <div
          class="kv warn"
          title="Finished results are waiting for a free client slot. A router and plan with more clients send them sooner."
        >
          <span>Waiting for a slot</span>
          <b>{m.uploadsWaiting}</b>
        </div>
      )}
    </section>
  );
}

export function PacketsFold({ m }: { m: Panel }): JSX.Element | null {
  if (!m.stack) {
    return null;
  }
  return (
    <details class="stat-fold" open>
      <summary title="How the jobs travel: in segments, each answered by the kernel. A segment the line loses, or the card drops because the kernel is busy, is sent again after a timeout.">
        <h3>Packets</h3>
        <span class="mute">{m.stack.rows.find((r) => r.id === 'loss')?.text} loss</span>
      </summary>
      {m.stack.rows.map((r) => (
        <div class={`kv${r.level === 'warn' ? ' warn' : ''}`} key={r.id} title={r.title}>
          <span>{r.label}</span>
          <b>{r.text}</b>
        </div>
      ))}
    </details>
  );
}

export function AddressesFold({ m }: { m: Panel }): JSX.Element | null {
  const [first] = m.addrs.rows;
  if (first === undefined) {
    return null;
  }
  const hint = first.id === 'pc' ? (first.ip ?? 'no IP address') : '';
  return (
    <details class="stat-fold" open>
      <summary title="The names the network uses. An IP address says where a machine is. A MAC address says which network jack it is. The router's DHCP gives the PC its IP address while the link is up.">
        <h3>Addresses</h3>
        <span class="mute">{hint}</span>
      </summary>
      {m.addrs.rows.map((r) => (
        <AddrLine key={r.id} r={r} />
      ))}
    </details>
  );
}

export function NatFold({ m }: { m: Panel }): JSX.Element | null {
  if (m.addrs.nat.length === 0) {
    return null;
  }
  return (
    <details class="stat-fold" open>
      <summary title="The router's NAT table: one line for each job in flight. The router swaps the PC's private address and port for its own public ones, so the server sees only the router.">
        <h3>NAT table</h3>
        <span class="mute">{m.addrs.nat.length}</span>
      </summary>
      {m.addrs.nat.slice(0, NAT_ROWS).map((c) => (
        <NatLine key={c.key} c={c} />
      ))}
      {m.addrs.nat.length > NAT_ROWS && (
        <details class="net-more">
          <summary>{m.addrs.nat.length - NAT_ROWS} more</summary>
          {m.addrs.nat.slice(NAT_ROWS).map((c) => (
            <NatLine key={c.key} c={c} />
          ))}
        </details>
      )}
    </details>
  );
}

/** A place on the path: its name and IP address, its MAC under them, and (with no IP address) the reason. */
function AddrLine({ r }: { r: netui.AddrRow }) {
  return (
    <div class="net-addr" title={r.note}>
      <div class="kv">
        <span>{r.label}</span>
        <b class={r.ip !== null && r.ip !== '' ? '' : 'mute'}>{r.ip ?? 'no IP address'}</b>
      </div>
      <div class="kv sub">
        <span>MAC</span>
        <span class="mono">{r.mac}</span>
      </div>
      {(r.ip === null || r.ip === '') && <div class="mute sub">{r.note}</div>}
    </div>
  );
}

/** A job's line of the NAT table: the job and the server it speaks to, then the two ports the router swaps. */
function NatLine({ c }: { c: netui.NatRow }) {
  return (
    <div class="net-addr" title={c.line}>
      <div class="kv">
        <span>{c.label}</span>
        <b>
          {c.proto} {c.server}
        </b>
      </div>
      <div class="kv sub">
        <span class="mono">{c.ports}</span>
      </div>
    </div>
  );
}
