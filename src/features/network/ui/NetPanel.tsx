import { snapshot } from '@/app/store';
import { Icon } from '@/core/ui/kit/Icons';
import * as netui from './netui';
import { netOpen, toggleNet } from '@/core/ui/state';
import { AddressesFold, NatFold, NetHead, OnTheWire, PacketsFold, SpeedLadder } from './NetPanelParts';
import { OffersSection, SpoolSection, TransfersSection, UsbSection } from './NetPanelFlows';

/** The network panel body: link state, bandwidth ladder, flow stages, offers, transfers, spool, USB fallback. */
function NetPanel() {
  const s = snapshot.value;
  const m = s ? netui.netPanel(s) : null;
  if (!m) {
    return null;
  }
  return (
    <div class="stats netpanel">
      <h2>Network</h2>
      <NetHead m={m} />
      <SpeedLadder m={m} />
      <OnTheWire m={m} />
      <PacketsFold m={m} />
      <AddressesFold m={m} />
      <NatFold m={m} />
      <TransfersSection m={m} />
      <OffersSection m={m} />
      <SpoolSection m={m} />
      <UsbSection m={m} />
      {m.retiredKeys > 0 && (
        <div class="kv">
          <span>Retired keys</span>
          <b>{m.retiredKeys}</b>
        </div>
      )}
    </div>
  );
}

/** The dock that hosts the panel: shown while `netOpen` is set and a network exists. */
export function NetDock() {
  const s = snapshot.value;
  if (!s || !netui.netPanelShown(netOpen.value, s)) {
    return null;
  }
  return (
    <aside class="dock" aria-label="Network">
      <button class="close" aria-label="Close network panel" onClick={toggleNet}>
        <Icon name="close" size={11} />
      </button>
      <NetPanel />
    </aside>
  );
}
