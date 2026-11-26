// Power-supply and cooler compatibility issues for checkCompat. Pure and static, like compat.ts.
import * as B from './board';
import type { CompatIssue } from './compatTypes';
import { TRIP_RATIO } from './thermal';

const fmt = (n: number, d = 2) => n.toFixed(d);

function psuMissing(): CompatIssue {
  return {
    id: 'psu-missing',
    severity: 'error',
    part: null,
    message: 'There is no power supply: the machine cannot start.',
  };
}

function psuDrawIssues(part: string, need: number, watts: number): CompatIssue[] {
  // (what `ThermalModel.step` does: a draw over the rating slows every clock by rating / draw, a draw over TRIP_RATIO times the rating trips the supply)
  if (need > watts * TRIP_RATIO) {
    return [
      {
        id: 'psu-trip',
        severity: 'error',
        part,
        value: need,
        limit: watts * TRIP_RATIO,
        message: `The parts draw ${fmt(need, 0)} W at full load. The power supply gives ${watts} W. It trips and the machine shuts off.`,
      },
    ];
  }
  if (need > watts) {
    return [
      {
        id: 'psu-brownout',
        severity: 'warn',
        part,
        value: need,
        limit: watts,
        message: `The parts draw ${fmt(need, 0)} W at full load. The power supply gives ${watts} W. The voltage sags and the machine runs at ${fmt((watts / need) * 100, 0)}% of its speed.`,
      },
    ];
  }
  if (need > watts * 0.9) {
    return [
      {
        id: 'psu-headroom',
        severity: 'tip',
        part,
        value: need,
        limit: watts,
        message: `The parts use ${fmt((need / watts) * 100, 0)}% of the power supply: an overclock or a hot part can push it over.`,
      },
    ];
  }
  return [];
}

function psuLeadIssues(board: B.Board, part: string, have: number): CompatIssue[] {
  const leads = B.pcieLeadsNeeded(board);
  if (leads <= have) {
    return [];
  }
  return [
    {
      id: 'pcie-leads',
      severity: 'error',
      part,
      value: leads,
      limit: have,
      message: `The cards need ${leads} PCIe power lead${leads === 1 ? '' : 's'}. The power supply has ${have === 0 ? 'none' : have}. A card with no power does not start, and the machine stops at start-up.`,
    },
  ];
}

export function psuIssues(board: B.Board, need: number): CompatIssue[] {
  const psu = B.installedPsu(board);
  if (!psu) {
    return [psuMissing()];
  }
  return [...psuDrawIssues(psu.dev.id, need, psu.spec.watts), ...psuLeadIssues(board, psu.dev.id, psu.spec.pcieLeads)];
}

export function coolerTipIssues(board: B.Board): CompatIssue[] {
  const out: CompatIssue[] = [];
  const cooler = B.findDevices(board, 'cooler').find((d) => d.burnt !== true),
    rad = B.fittedRadiator(board);
  const coolerKind = cooler === undefined ? undefined : B.deviceSpec(cooler);
  const coolerSpec = coolerKind !== undefined && coolerKind.kind === 'cooler' ? coolerKind : undefined;
  if (cooler !== undefined && coolerSpec?.loop !== undefined && rad === null) {
    out.push({
      id: 'loop-no-radiator',
      severity: 'tip',
      part: cooler.id,
      message:
        'The liquid loop has no radiator: the pump alone gives it little cooling. Fit a radiator on the front or the top of the case.',
    });
  }
  const spots = coolerSpec?.fanSpots;
  if (cooler !== undefined && spots !== undefined && B.fansOn(board, cooler.slot).length === 0) {
    out.push({
      id: 'cooler-no-fan',
      severity: 'tip',
      part: cooler.id,
      message: `The CPU heatsink has no fan: it cools only by itself, at about a third of its rating. Clip a ${spots.size} mm fan on it.`,
    });
  }
  if (
    rad !== null &&
    rad.side === 'front' &&
    B.findDevices(board, 'cpu').some((d) => B.deviceSpec(d).kind === 'cpu' && B.deviceSpec(d).loadW >= 60)
  ) {
    out.push({
      id: 'radiator-front-heat',
      severity: 'tip',
      part: rad.dev.id,
      message:
        "A radiator on the front puts the CPU's heat into the case air, which warms the other parts. On the top it blows the heat out of the case.",
    });
  }
  return out;
}
