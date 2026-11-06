// The area lights' shading as a plain loop. three writes a light's shading out once per light (`#pragma unroll_loop`), as an array of samplers
// takes only a constant index. An area light has no sampler of its own, and its shading (LTC) is long: with the room's 12, ANGLE's D3D compiler
// took about 1 s on each lit program, and that was most of the load's link (`docs/render/load.md`). The same sums in a loop take a third of that.
// Import this before reading `ShaderChunk.lights_fragment_begin`.
import { ShaderChunk } from 'three';

ShaderChunk.lights_fragment_begin = ShaderChunk.lights_fragment_begin.replace(
  /#pragma unroll_loop_start(\s+for \( int i = 0; i < NUM_RECT_AREA_LIGHTS; i \+\+ \) \{[\s\S]+?\})\s+#pragma unroll_loop_end/,
  '$1',
);
