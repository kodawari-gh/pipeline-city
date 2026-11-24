// The coolant drawn as a liquid (docs/render/air.md "The water"): one instanced mesh of strips turned to face the camera, a strip for each straight run of the
// water's net (`waterNet`). Each is shaded as a round tube of liquid (a lit body, a bright streak along one side, a soft rim), coloured on the thermal scale by the
// water's temperature at that place of the loop (`waterAt`: hot from the pump to the radiator's core, cooling along its lanes, cold on the way back, heated again
// across the pump's cold plate), and bands of light run along it at the speed of the flow. It is drawn over the picture, through the hoses and the radiator's
// plates: the hose's own sleeve and the radiator's body glow by their temperature (`PartSkin.thermal`) round it.
import {
  DoubleSide,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  ShaderMaterial,
  type PerspectiveCamera,
} from 'three';
import { THERMAL_BEND, thermalGlsl } from '@/core/render/three/thermal';
import type { WaterNet } from './waternet';

/** The knots of the temperature along the loop (`waterNet` makes this many). */
export const KNOTS = 8;

const VERT = /* glsl */ `
attribute vec2 corner;
attribute vec3 iA, iB;
attribute vec4 iInfo;
uniform float uPixel;
varying float vS, vAcross, vPh;
void main() {
  vec3 pa = (modelViewMatrix * vec4(iA, 1.0)).xyz, pb = (modelViewMatrix * vec4(iB, 1.0)).xyz;
  vec3 way = pb - pa;
  float len = max(length(way), 1e-3);
  vec3 dir = way / len;
  vec3 p = mix(pa, pb, corner.x);
  // the strip lies across the view ray; the same side of the screen for every run, so the highlight is on one side of every tube whichever way it runs
  vec3 side = cross(dir, p);
  side = dot(side, side) > 1e-8 ? normalize(side) : vec3(0.0, 1.0, 0.0);
  side *= (side.x + 0.001 * side.y) >= 0.0 ? 1.0 : -1.0;
  // never finer than a pixel and a half each side: a thread from far, the tube's own size from close
  float px = uPixel * max(-p.z, 1.0);
  float w = max(iInfo.z, px * 1.5);
  // each run reaches a little past its ends, so two runs meet without a gap at a bend
  float end = corner.x * 2.0 - 1.0;
  p += dir * w * end + side * w * corner.y;
  gl_Position = projectionMatrix * vec4(p, 1.0);
  vS = mix(iInfo.x, iInfo.y, corner.x) + end * w * (iInfo.y - iInfo.x) / len;
  vAcross = corner.y;
  vPh = iInfo.w;
}`;

const FRAG = /* glsl */ `
#define COVER 0.92
uniform float uS[${KNOTS}], uK[${KNOTS}];
uniform float uLo, uHi, uStrength, uPhase, uLambda, uMove;
varying float vS, vAcross, vPh;
${thermalGlsl()}
float tempAt(float s) {
  if (s <= uS[0]) return uK[0];
  for (int i = 1; i < ${KNOTS}; i++) {
    if (s < uS[i]) return mix(uK[i - 1], uK[i], (s - uS[i - 1]) / max(uS[i] - uS[i - 1], 1e-3));
  }
  return uK[${KNOTS - 1}];
}
void main() {
  float x = vAcross;
  float h = pow(clamp((tempAt(vS) - uLo) / max(1e-3, uHi - uLo), 0.0, 1.0), ${THERMAL_BEND.toFixed(3)});
  vec3 base = thermal(h);
  // a round tube of liquid: the body is lit toward its middle, one bright streak runs along it, the rim is soft
  float depth = sqrt(max(0.0, 1.0 - x * x));
  float body = 0.5 + 0.5 * depth;
  // (the streak adds a little light, not white: a narrow tube would wash out to it)
  float streak = exp(-pow((x + 0.36) / 0.16, 2.0));
  // bands of light run along it with the flow (still water has none)
  float wave = 0.5 + 0.5 * sin((vS / uLambda - uPhase + vPh) * 6.2831853);
  float band = 1.0 + uMove * (0.3 * pow(wave, 2.0) - 0.12);
  // (laid over the picture, not added to it: a part glowing behind the water must not wash out its colour)
  float cover = COVER * (1.0 - smoothstep(0.7, 1.0, abs(x)));
  vec3 c = base * body * band + base * streak * 0.22 + vec3(0.5, 0.6, 0.8) * streak * 0.08;
  gl_FragColor = vec4(c * uStrength, cover);
}`;

/** How bright the water is over the picture, the length of a band of light along it (units), and how fast the bands go at full flow (bands a second). */
const STRENGTH = 1,
  LAMBDA = 2600,
  SPEED = 0.45;
/** The water's temperature, shown from the loop's mean this many times as far (the loop's own rise is a few kelvins: on the scale the parts glow by it would not show). */
const SPREAD = 3.5;

/** The water of one machine, as a mesh. */
export class Water {
  readonly mesh: Mesh;
  private readonly geo = new InstancedBufferGeometry();
  private readonly mat: ShaderMaterial;
  private phase = 0;

  constructor(private readonly net: WaterNet) {
    // one strip: two ends, two sides
    this.geo.setAttribute('corner', new Float32BufferAttribute([0, -1, 0, 1, 1, -1, 1, 1], 2));
    // (`position` is needed for the draw count; the shader does not read it)
    this.geo.setAttribute('position', new Float32BufferAttribute(new Float32Array(12), 3));
    this.geo.setIndex([0, 1, 2, 1, 3, 2]);
    const n = net.runs.length,
      a = new Float32Array(3 * n),
      b = new Float32Array(3 * n),
      info = new Float32Array(4 * n);
    net.runs.forEach((r, i) => {
      a.set(r.a, 3 * i);
      b.set(r.b, 3 * i);
      info.set([r.sa, r.sb, r.r, r.ph], 4 * i);
    });
    this.geo.setAttribute('iA', new InstancedBufferAttribute(a, 3));
    this.geo.setAttribute('iB', new InstancedBufferAttribute(b, 3));
    this.geo.setAttribute('iInfo', new InstancedBufferAttribute(info, 4));
    this.geo.instanceCount = n;
    const s = Array.from({ length: KNOTS }, (_, i) => net.stops[Math.min(i, net.stops.length - 1)] ?? 0);
    this.mat = new ShaderMaterial({
      // (laid over the picture: two runs that overlap at a bend are one colour, so they add nothing; both faces, a strip's winding turns with the run's way)
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
      side: DoubleSide,
      uniforms: {
        uPixel: { value: 0.002 },
        uS: { value: s },
        uK: { value: new Array<number>(KNOTS).fill(25) },
        uLo: { value: 25 },
        uHi: { value: 55 },
        uStrength: { value: STRENGTH },
        uPhase: { value: 0 },
        uLambda: { value: LAMBDA },
        uMove: { value: 0 },
      },
    });
    this.mesh = new Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1002;
    this.mesh.raycast = () => {};
  }

  /**
   * Per frame. `lo`, `hi`: the temperatures at the two ends of the thermal scale; `hotC`, `coldC`: the water where it leaves the pump and where it comes back;
   * `flow`: how hard the pump drives it (0 to 1; 0 is still water); `dt`: game seconds; `pxHeight`: the view's height in pixels.
   */
  frame(
    cam: PerspectiveCamera,
    pxHeight: number,
    lo: number,
    hi: number,
    hotC: number,
    coldC: number,
    flow: number,
    dt: number,
  ): void {
    const u = this.mat.uniforms,
      mean = (hotC + coldC) / 2,
      f = Math.max(0, Math.min(1, flow));
    this.phase = (this.phase + dt * SPEED * f) % 1000;
    const k = u['uK']!.value as number[];
    for (let i = 0; i < KNOTS; i++) {
      const level = this.net.level[Math.min(i, this.net.level.length - 1)] ?? 0;
      k[i] = mean + SPREAD * (coldC + level * (hotC - coldC) - mean);
    }
    u['uLo']!.value = lo;
    u['uHi']!.value = hi;
    u['uPhase']!.value = this.phase;
    u['uMove']!.value = Math.min(1, f * 3);
    // still water is dimmer: the pump has stopped
    u['uStrength']!.value = STRENGTH * (0.45 + 0.55 * Math.min(1, f * 3));
    u['uPixel']!.value = 2 / (cam.projectionMatrix.elements[5]! * Math.max(1, pxHeight));
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}
