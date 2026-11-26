// The air's particles drawn as ribbons (docs/render/air.md): one instanced mesh, a fixed pool. Each particle is a strip along its trail, turned to face
// the camera, bright and wide at the head and fine at the tail, coloured by its temperature on the thermal scale (`core/render/three/thermal.ts`: the same
// scale the parts glow by) and added to the picture. A veil under them turns the room cold and dark so the heat reads.
import * as THREE from 'three';
import { THERMAL_BEND, thermalGlsl } from '@/core/render/three/thermal';
import * as particles from './particles';
import type { V3 } from './grid';

const LAST = particles.TRAIL - 1;
const POINTS = Array.from({ length: particles.TRAIL }, (_, k) => `p${k}`);
const pick = POINTS.map((p, k) => (k === LAST ? p : `t < ${k}.5 ? ${p} : `)).join('');

const VERT = /* glsl */ `
attribute vec2 corner;
attribute vec3 ${POINTS.join(', ')};
attribute vec3 info;
uniform float uWidth, uPixel, uPass, uNearFrom, uNearTo;
varying float vHeat, vAlpha, vEdge, vCore;
varying vec3 vWorld;
vec3 pick(float t) { return ${pick}; }
void main() {
  float t = corner.x;
  vec3 pw = pick(t);
  vec3 a = (modelViewMatrix * vec4(pw, 1.0)).xyz;
  vec3 b = (modelViewMatrix * vec4(pick(min(t + 1.0, ${LAST}.0)), 1.0)).xyz;
  vec3 c = (modelViewMatrix * vec4(pick(max(t - 1.0, 0.0)), 1.0)).xyz;
  float tl = length(b - c);
  // the strip lies across the view ray, along the trail as a whole (not each step of it: the head's step is short and turns with every eddy)
  vec3 head = (modelViewMatrix * vec4(p0, 1.0)).xyz, tail = (modelViewMatrix * vec4(p${LAST}, 1.0)).xyz;
  vec3 way = head - tail;
  if (dot(way, way) < 1e-2) way = b - c;
  vec3 cr = cross(way, a);
  vec3 side = dot(cr, cr) > 1e-6 ? normalize(cr) : vec3(1.0, 0.0, 0.0);
  // a fine thread from far, a thin streak from close: about a pixel each side whatever the size the air has in the machine; then it tapers to its tail
  float px = uPixel * max(-a.z, 1.0);
  float w = clamp(uWidth, px * 0.8, px * 2.0) * (1.0 - 0.7 * t / ${LAST}.0);
  w = max(w, px * 0.5);
  gl_Position = projectionMatrix * vec4(a + side * w * corner.y, 1.0);
  vHeat = info.x;
  // a streak close to the eye (the camera of a close-up stands inside the case) fades out: it would be a long line over the part the player came to see
  // (never below zero: a GPU's division can leave the last point a hair under it, and pow() of a negative number is not a number, which blacks the tail out)
  float along = clamp(1.0 - t * ${(1 / LAST).toFixed(7)}, 0.0, 1.0);
  vAlpha = info.y * pow(max(along, 1e-4), 1.6) * (tl > 1e-3 || t < 0.5 ? 1.0 : 0.0) * smoothstep(uNearFrom, uNearTo, -a.z);
  vCore = along * along * along;
  vEdge = corner.y;
  vWorld = pw;
}`;

const FRAG = /* glsl */ `
uniform float uPass, uLo, uHi, uStrength, uCold;
uniform vec3 uXMin, uXMax;
varying float vHeat, vAlpha, vEdge, vCore;
varying vec3 vWorld;
${thermalGlsl()}
void main() {
  bool inside = all(greaterThan(vWorld, uXMin)) && all(lessThan(vWorld, uXMax));
  // the depth-tested pass draws the air outside the x-ray box; the other draws the air inside it (the supply's unit hides what it holds)
  if (uPass < 0.5) { if (inside) discard; }
  else if (!inside) discard;
  float h = pow(clamp((vHeat - uLo) / max(1e-3, uHi - uLo), 0.0, 1.0), ${THERMAL_BEND.toFixed(3)});
  // the room's own air is a faint haze, a hint of which way it goes: the air that took heat is what the eye should find
  float lum = mix(uCold, 1.0, h);
  float soft = 1.0 - vEdge * vEdge;
  gl_FragColor = vec4(thermal(h) * uStrength * (1.0 + 0.5 * vCore), vAlpha * soft * lum);
}`;

/** How bright the streaks add to the picture (the colours are the share of it), and the share of it the room's own air keeps. */
const STRENGTH = 1.3,
  COLD_SHARE = 0.2;
/** The distance from the eye, in units, where the streaks begin to show and where they are whole (23000 units a metre: 11 cm to 30 cm). */
const NEAR_FROM = 2500,
  NEAR_TO = 7000;
/** A box no point is inside: the x-ray box when there is none. */
const NO_BOX: V3 = [1e9, 1e9, 1e9];

/** The material of one pass of the strips: pass 0 is hidden by what stands in front of it, pass 1 is not. */
function ribbonMaterial(pass: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: pass === 0,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    uniforms: {
      uWidth: { value: 62 },
      uPixel: { value: 0.002 },
      uPass: { value: pass },
      uLo: { value: 25 },
      uHi: { value: 55 },
      uStrength: { value: STRENGTH },
      uCold: { value: COLD_SHARE },
      uNearFrom: { value: NEAR_FROM },
      uNearTo: { value: NEAR_TO },
      uXMin: { value: [...NO_BOX] },
      uXMax: { value: [...NO_BOX].map((v) => -v) },
    },
  });
}

/** The particles of one `AirParticles` as meshes: the air, hidden behind the parts it flows round (and drawn over the supply's unit, where its fan draws it through). */
export class Ribbons {
  readonly mesh = new THREE.Group();
  private readonly geo = new THREE.InstancedBufferGeometry();
  private readonly mats: THREE.ShaderMaterial[] = [];
  private readonly buf: THREE.InstancedInterleavedBuffer;
  private readonly info: Float32Array;
  private readonly infoAttr: THREE.InstancedBufferAttribute;

  constructor(private readonly p: particles.AirParticles) {
    // the strip: TRAIL points, two corners each (the side), triangles between them
    const corner: number[] = [],
      index: number[] = [];
    for (let t = 0; t < particles.TRAIL; t++) {
      corner.push(t, -1, t, 1);
    }
    for (let t = 0; t < particles.TRAIL - 1; t++) {
      const a = 2 * t;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.geo.setAttribute('corner', new THREE.Float32BufferAttribute(corner, 2));
    // (`position` is needed for the draw count; the shader does not read it)
    this.geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(particles.TRAIL * 2 * 3), 3));
    this.geo.setIndex(index);
    this.buf = new THREE.InstancedInterleavedBuffer(p.P, particles.TRAIL * 3, 1);
    for (let k = 0; k < particles.TRAIL; k++) {
      this.geo.setAttribute(`p${k}`, new THREE.InterleavedBufferAttribute(this.buf, 3, 3 * k));
    }
    this.info = new Float32Array(p.cap * 3);
    this.infoAttr = new THREE.InstancedBufferAttribute(this.info, 3);
    this.geo.setAttribute('info', this.infoAttr);
    this.geo.instanceCount = 0;
    for (const pass of [0, 1]) {
      const mat = ribbonMaterial(pass);
      const m = new THREE.Mesh(this.geo, mat);
      m.frustumCulled = false;
      m.renderOrder = 1000 + pass;
      m.raycast = () => {};
      this.mats.push(mat);
      this.mesh.add(m);
    }
  }

  /** A box (in the machine's space) the air in is drawn over the parts, not behind them: the supply's unit, whose casing would hide it. Null: none. */
  xray(min: V3 | null, max: V3 | null): void {
    for (const m of this.mats) {
      m.uniforms['uXMin']!.value = min ? [...min] : [...NO_BOX];
      m.uniforms['uXMax']!.value = max ? [...max] : [...NO_BOX].map((v) => -v);
    }
  }

  /**
   * Per frame: copy what the particles hold to the mesh. `lo`, `hi`: the temperatures at the two ends of the thermal scale; `pxHeight`: the view's height in
   * pixels.
   */
  frame(cam: THREE.PerspectiveCamera, pxHeight: number, lo: number, hi: number, strength = 1): void {
    const { p } = this,
      n = p.count;
    for (let i = 0; i < n; i++) {
      this.info[3 * i] = p.T[i]!;
      this.info[3 * i + 1] = p.A[i]!;
      this.info[3 * i + 2] = p.K[i]!;
    }
    this.buf.needsUpdate = true;
    this.infoAttr.needsUpdate = true;
    this.geo.instanceCount = n;
    // the world size of a pixel at one unit of depth: a ribbon is never finer than it
    const pixel = 2 / (cam.projectionMatrix.elements[5]! * Math.max(1, pxHeight));
    for (const m of this.mats) {
      m.uniforms['uLo']!.value = lo;
      m.uniforms['uHi']!.value = hi;
      m.uniforms['uStrength']!.value = STRENGTH * strength;
      m.uniforms['uPixel']!.value = pixel;
    }
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geo.dispose();
    for (const m of this.mats) {
      m.dispose();
    }
  }
}

/**
 * A sheet over the whole view, under the ribbons, that turns the room cold: the picture is multiplied by a deep blue, so it goes dark and blue and keeps its
 * light and shade. The parts glow on it by their temperature (`PartSkin.thermal`) and the air is drawn over it. `tint`: the colour it multiplies by (the power lens's is less blue).
 */
export function makeVeil(tint: readonly [number, number, number] = [0.13, 0.16, 0.32]): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'uniform vec3 uTint; void main() { gl_FragColor = vec4(uTint, 1.0); }',
    uniforms: { uTint: { value: [...tint] } },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.ZeroFactor,
    blendDst: THREE.SrcColorFactor,
    toneMapped: false,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  m.frustumCulled = false;
  m.renderOrder = 900;
  m.raycast = () => {};
  return m;
}
