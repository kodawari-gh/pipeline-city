// The OS block of a picker card: what the OS is doing, its queue, the host drive and the later tiers.

import type { Snapshot } from '@/worker/game/game';
import { statusChip } from '@/core/ui/logic';
import { findKey, jobView } from './keyCards';
import { ladderFor } from './pickerLadder';
import type { OsSection } from './pickerTypes';

type OsQueueRow = OsSection['queue'][number];
type OsJob = NonNullable<Snapshot['os']>['queue'][number];

/** Where a queued job stands: running now, done, next, or how many jobs are ahead. */
function queueText(j: OsJob): string {
  if (j.state === 'running') {
    return 'running now';
  }
  if (j.state === 'result') {
    return 'done';
  }
  return j.ahead === 0 ? 'next' : `${j.ahead} ahead`;
}

function queueRow(s: Snapshot, j: OsJob): OsQueueRow {
  const k = findKey(s, j.keyId);
  return {
    keyId: j.keyId,
    label: j.label,
    type: k?.type ?? '',
    state: j.state,
    retired: k?.retired === true,
    job: k ? jobView(k) : null,
    text: queueText(j),
  };
}

/**
 * The OS section for a snapshot with an OS installed, or null. Pure: every number comes from the snapshot. Queue rows say
 * how many jobs are ahead; held keys say which key to plug in again to collect.
 */
export function osSection(s: Snapshot): OsSection | null {
  const { os } = s;
  if (!os) {
    return null;
  }
  const st = statusChip(s);
  const host = s.storage.find((x) => x.hasOs);
  return {
    name: os.name,
    tier: os.tier,
    status: st.text,
    level: st.level === 'idle' ? 'info' : st.level,
    programSlots: os.programSlots,
    queueSlots: os.queueSlots,
    running: os.queue.find((j) => j.state === 'running')?.label ?? null,
    queue: os.queue.map((j) => queueRow(s, j)),
    host: host
      ? { slot: host.slot, usedK: Math.round(host.usedBytes / 1024), capK: Math.round(host.capacityBytes / 1024) }
      : null,
    ladder: ladderFor(s, 'os'),
  };
}
