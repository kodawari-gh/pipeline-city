// The CPU cooler and the loop's radiator in 3D, at their real sizes (23 units a millimetre, `fanLen`; docs/PC_PARTS.md). Every cooler mounts on
// the board's four cooler holes (`COOLER_HOLES`) with a backplate behind the board (`mount`). The stock heatsink is a copper core in a ring of swept
// vanes under a plastic shroud on four push pins, a 92 mm fan on top blowing down. The tower is a stack of aluminium fins offset north of the socket
// (clear of the first card), four copper heat pipes rising from its base through every fin, held by a sprung crossbar on two bars; a 120 mm fan on
// each end clips on by its wire clips, both blowing west. The loop's pump is a cold plate under a square base and a round anodised body (a thin
// light ring under a brushed cap with a diamond-cut edge; the impeller is inside, unseen) on a four-arm bracket; two 12 mm braided hoses arc from
// the G1/4 fittings in the port block on its north side to the radiator's (`LoopHoses`, hung round the parts in their way; only with both fitted). The radiator (`radiatorModel`) is the 2D one stood up across the case,
// inboard of its side's fans: a core as thick as its grade and as deep as a fan, an end tank past the fans at each end. Heatsinks and radiators come
// bare: the fans are parts of their own (`fanPart`), shown where the player fitted them (a radiator's on the case's mounts it spans).
// The parts live in `cooler/`: the coolers (`model`, `stock`, `tower`, `pump`), their spots (`plan`), the hoses (`hoses`, `loopHoses`) and the
// radiator (`radiator`, `radiatorModel`). This file keeps the old import path.
export { pipe } from './cooler/kit';
export { COOLER_AIR, coolerFanBox, coolerFanLead, coolerFoot } from './cooler/plan';
export { coolerModel, type Model, type RadiatorAt } from './cooler/model';
export { HOSE_COLD, HOSE_HOT, hose, hoseEnds } from './cooler/hoses';
export { LoopHoses } from './cooler/loopHoses';
export { radiatorDepth, radiatorFlow, radiatorPorts3d, radiatorTubeLayout, type RadiatorFlow } from './cooler/radiator';
export { radiatorModel } from './cooler/radiatorModel';
