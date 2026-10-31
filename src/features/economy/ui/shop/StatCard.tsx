import type { Snapshot } from '@/worker/game/game';
import { describeId } from '@/core/ui/logic';
import { Icon } from '@/core/ui/kit/Icons';
import { PartArt } from './PartArt';
import { Compare } from './PickerCard';
import { compareRows, kindOf } from './picker';
import { currentSpecFor, kindIcon, kindLabel, tierOfSpec } from './shopdata';

const shortName = (name: string) => name.split(' (')[0]!;

/**
 * A part's stats as bars: the part against the one fitted now (grey), each row an icon, a bar and a delta. Used by the
 * inventory's side card and the shop. `fit` adds one line saying whether it can go in right now.
 */
export function StatCard({ s, specId, fit }: { s: Snapshot; specId: string; fit?: { ok: boolean; text: string } }) {
  const kind = kindOf(specId, s);
  const current = kind ? currentSpecFor(s, kind) : null;
  const rows = kind ? compareRows(kind, current, specId) : [];
  const d = describeId(specId, s);
  const tier = tierOfSpec(specId);
  return (
    <div class="statcard" aria-label={d?.title ?? specId}>
      <header class="sc-head">
        <PartArt id={specId} size={52} />
        <div class="sc-title">
          <b title={d?.plain}>{shortName(d?.title ?? specId)}</b>
          <span class="mute">
            {kind && <Icon name={kindIcon(kind)} size={11} />} {kind ? kindLabel(kind) : ''}{tier !== null ? ` · Tier ${tier}` : ''}
          </span>
        </div>
      </header>
      {fit && (
        <div class={`pline ${fit.ok ? 'ok' : 'warn'}`}><Icon name={fit.ok ? 'check' : 'lock'} size={11} /> {fit.text}</div>
      )}
      {current && current !== specId && <div class="sc-vs mute">Grey bars: what is fitted now.</div>}
      <Compare rows={rows} option={specId} />
    </div>
  );
}
