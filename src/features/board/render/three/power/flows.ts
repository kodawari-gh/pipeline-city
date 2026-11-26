// The power lens's lines as meshes (docs/render/power.md "The lines"). One instanced mesh of strips turned to face the camera, a strip for each straight stretch of each
// line of the net (`powerShape`). Nothing is moved per frame on the CPU: the shader finds the pulses. A pulse is a comet that runs along the line toward the part (the
// arc length of the line is in the strip's ends), brighter, closer and faster the more watts the line carries (its place on the power scale, `levelOf`); between the pulses
// the line keeps a steady glow, so it reads at a glance. A line with no draw is a dim thread, a cable that is out pulses red and does not move. The lines are drawn with
// the depth test, lifted a little toward the eye (a cable is seen where it runs, and goes behind the parts that stand in front of it); the runs the machine does not
// show (behind the tray) are drawn through everything, thin and dim. Rings on the open sockets are drawn through everything too.
import * as THREE from 'three';
import * as powerscale from '@/core/render/three/powerscale';
import type { PowerDraw, PowerLine, PowerShape } from './net';

/** The brightness of the lines over the picture. */
const STRENGTH = 1.25;
/** How much of a plate's brightness shows through what stands in front of it. */
const HIDDEN_PLATE = 0.22;
/** Speed (units a second) and gap between pulses (units) at the foot and the top of the scale. */
const SPEED_LO = 1500,
  SPEED_HI = 5200,
  GAP_LO = 1500,
  GAP_HI = 800;
/** A held cable's lines (the hand draws its own). */
const HELD = 3;

/** A number in [0, 1) from a name: where in its gap each line's pulses start, so the strands of a cable do not pulse as one. */
export function seedOf(id: string): number {
  let h = 2_166_136_261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16_777_619);
  }
  return ((h >>> 0) % 10_007) / 10_007;
}

/** The straight stretches of some lines, as the buffers of a mesh: each strip's two ends (the fourth number: the arc length along its line), its width, its seed and its lift. */
export interface Strips {
  a: Float32Array;
  b: Float32Array;
  look: Float32Array;
  n: number;
  first: Int32Array;
  count: Int32Array;
}
export function strips(lines: readonly PowerLine[]): Strips {
  let cap = 0;
  for (const l of lines) {
    cap += Math.max(0, l.pts.length - 1);
  }
  const a = new Float32Array(4 * cap),
    b = new Float32Array(4 * cap),
    look = new Float32Array(4 * cap),
    first = new Int32Array(lines.length),
    count = new Int32Array(lines.length);
  let k = 0;
  lines.forEach((l, i) => {
    first[i] = k;
    const seed = seedOf(l.id),
      { lift } = l;
    let s = 0;
    for (let j = 1; j < l.pts.length; j++) {
      const p = l.pts[j - 1]!,
        q = l.pts[j]!,
        len = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
      if (!(len > 1e-3)) {
        continue;
      }
      a.set([p[0], p[1], p[2], s], 4 * k);
      b.set([q[0], q[1], q[2], s + len], 4 * k);
      look.set([l.width, seed, lift, l.fade], 4 * k);
      s += len;
      k++;
    }
    count[i] = k - first[i]!;
  });
  return { a, b, look, n: k, first, count };
}

/** A line's tone in its strips' state: a use's amber, a hub's cyan, a source's white. */
const TONE: Record<powerscale.Role, number> = { use: 0, hub: 1, source: 2 };

const VERT = /* glsl */ `
attribute vec2 corner;
attribute vec4 iA, iB, iLook;
attribute vec3 iState;
uniform float uPixel;
varying float vS, vAcross, vLevel, vState, vSeed, vFade, vTone;
void main() {
  vec3 pa = (modelViewMatrix * vec4(iA.xyz, 1.0)).xyz, pb = (modelViewMatrix * vec4(iB.xyz, 1.0)).xyz;
  vec3 way = pb - pa;
  float len = max(length(way), 1e-3);
  vec3 dir = way / len;
  vec3 p = mix(pa, pb, corner.x);
  // the strip lies across the view ray
  vec3 side = cross(dir, p);
  side = dot(side, side) > 1e-8 ? normalize(side) : vec3(0.0, 1.0, 0.0);
  // never finer than two pixels each side: a thread from far, the cable's own size from close
  float px = uPixel * max(-p.z, 1.0);
  float w = max(iLook.x, px * 2.0);
  // each strip reaches a little past its ends, so two strips meet without a gap at a bend
  float end = corner.x * 2.0 - 1.0;
  p += dir * w * 0.6 * end + side * w * corner.y;
  // toward the eye: the cable's own sleeve is round the line
  p -= normalize(p) * iLook.z;
  gl_Position = projectionMatrix * vec4(p, 1.0);
  if (iState.y > ${(HELD - 0.5).toFixed(1)}) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  vS = mix(iA.w, iB.w, corner.x) + end * w * 0.6 * (iB.w - iA.w) / len;
  vAcross = corner.y;
  vLevel = iState.x;
  vState = iState.y;
  vTone = iState.z;
  vSeed = iLook.y;
  vFade = iLook.w;
}`;

/** The colour of a role at a place on its scale (GLSL): `tone` 0 a use, 1 a hub, 2 a source. */
const ROLE_GLSL = /* glsl */ `
vec3 role(float tone, float h) { return tone > 1.5 ? source(h) : (tone > 0.5 ? hub(h) : power(h)); }`;

const FRAG = /* glsl */ `
uniform float uT, uClock, uStrength, uDim;
varying float vS, vAcross, vLevel, vState, vSeed, vFade, vTone;
${powerscale.powerGlsl()}
${ROLE_GLSL}
void main() {
  // a round line: a hot core, a soft edge
  float prof = pow(1.0 - min(abs(vAcross), 1.0), 1.7);
  vec3 col;
  float a;
  if (vState > 1.5) {
    // a cable that is out: red, pulsing, still
    float p = 0.5 + 0.5 * sin(uClock * 6.0 + vSeed * 6.2831853);
    col = warn() * (0.8 + 0.7 * p);
    a = prof * (0.4 + 0.45 * p);
  } else if (vState < 0.5) {
    // nothing runs: a dim thread
    col = role(vTone, 0.0) * 0.9;
    a = prof * 0.3;
  } else {
    // a pulse is a comet: a bright head, a tail behind it, going along the line toward the part
    float lv = max(vLevel, 0.1);
    float speed = mix(${SPEED_LO.toFixed(1)}, ${SPEED_HI.toFixed(1)}, lv), gap = mix(${GAP_LO.toFixed(1)}, ${GAP_HI.toFixed(1)}, lv);
    float f = fract((vS - uT * speed) / gap + vSeed);
    float head = pow(f, 9.0) * (1.0 - smoothstep(0.94, 1.0, f));
    float body = 0.14 + 0.2 * lv;
    // (the head is hotter than the line: paler, toward white at the top of the scale)
    col = role(vTone, lv) * body + role(vTone, min(1.0, lv + 0.35)) * (1.9 * head);
    a = prof * (0.5 + 0.5 * head);
  }
  // a stub of a hidden run fades in toward the cable it ends in
  a *= vFade > 0.0 ? smoothstep(0.0, vFade, vS) : 1.0;
  gl_FragColor = vec4(col * uStrength * uDim, a);
}`;

const RING_VERT = /* glsl */ `
attribute vec2 corner;
attribute vec4 iRing;
attribute float iOpen;
uniform float uPixel;
varying vec2 vUv;
varying float vSeed;
void main() {
  vec3 c = (modelViewMatrix * vec4(iRing.xyz, 1.0)).xyz;
  // a ring is never smaller than a dozen pixels each side: from far it is still a mark
  float r = max(iRing.w, uPixel * max(-c.z, 1.0) * 13.0);
  gl_Position = projectionMatrix * vec4(c + vec3(corner * r * 1.6, 0.0), 1.0);
  if (iOpen < 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  vUv = corner * 1.6;
  vSeed = fract(dot(iRing.xyz, vec3(0.013, 0.007, 0.011)));
}`;

const RING_FRAG = /* glsl */ `
uniform float uClock;
varying vec2 vUv;
varying float vSeed;
${powerscale.powerGlsl()}
float band(float d, float at, float hw) { return 1.0 - smoothstep(hw * 0.4, hw, abs(d - at)); }
void main() {
  float d = length(vUv), p = 0.5 + 0.5 * sin(uClock * 6.0 + vSeed * 6.2831853);
  // a steady ring, and a ripple that leaves it
  float r = fract(uClock * 0.8 + vSeed), ripple = band(d, 1.0 + 0.5 * r, 0.1) * (1.0 - r);
  float ring = band(d, 1.0, 0.09) * (0.55 + 0.45 * p);
  float a = clamp(ring + 0.7 * ripple, 0.0, 1.0);
  gl_FragColor = vec4(warn() * (1.0 + 0.5 * p), a);
}`;

/** One mesh of strips: the lines of one kind of pass (depth-tested, or through everything). `index`: each line's place in the shape's. */
class Layer {
  readonly mesh: THREE.Mesh;
  private readonly geo = new THREE.InstancedBufferGeometry();
  private readonly mat: THREE.ShaderMaterial;
  private readonly state: Float32Array;
  private readonly attr: THREE.InstancedBufferAttribute;
  private readonly s: Strips;

  constructor(
    private readonly lines: readonly PowerLine[],
    private readonly index: readonly number[],
    depth: boolean,
    order: number,
  ) {
    const s = (this.s = strips(lines));
    // one strip: two ends, two sides
    this.geo.setAttribute('corner', new THREE.Float32BufferAttribute([0, -1, 0, 1, 1, -1, 1, 1], 2));
    // (`position` is needed for the draw count; the shader does not read it)
    this.geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(12), 3));
    this.geo.setIndex([0, 1, 2, 1, 3, 2]);
    this.geo.setAttribute('iA', new THREE.InstancedBufferAttribute(s.a, 4));
    this.geo.setAttribute('iB', new THREE.InstancedBufferAttribute(s.b, 4));
    this.geo.setAttribute('iLook', new THREE.InstancedBufferAttribute(s.look, 4));
    this.state = new Float32Array(3 * Math.max(1, s.n));
    this.attr = new THREE.InstancedBufferAttribute(this.state, 3);
    this.geo.setAttribute('iState', this.attr);
    this.geo.instanceCount = s.n;
    this.mat = new THREE.ShaderMaterial({
      // (added to the picture: two strips that overlap at a bend, or the strands of a cable at its plug, add up; both faces, a strip's winding turns with its run's way)
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: depth,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      side: THREE.DoubleSide,
      uniforms: {
        uPixel: { value: 0.002 },
        uT: { value: 0 },
        uClock: { value: 0 },
        uStrength: { value: STRENGTH },
        uDim: { value: 1 },
      },
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = order;
    this.mesh.raycast = () => {};
    this.mesh.visible = s.n > 0;
  }

  /** The new draw: each strip's place on the scale and its state. */
  set(draw: PowerDraw, held: ReadonlySet<string>, dim: number): void {
    const { state: st, s } = this;
    this.lines.forEach((l, i) => {
      const ix = this.index[i]!,
        lv = draw.level[ix]!,
        state = held.has(l.cable) ? HELD : draw.state[ix]!,
        tone = TONE[l.tone];
      for (let k = s.first[i]!, e = k + s.count[i]!; k < e; k++) {
        st[3 * k] = lv;
        st[3 * k + 1] = state;
        st[3 * k + 2] = tone;
      }
    });
    this.attr.needsUpdate = true;
    this.mat.uniforms['uDim']!.value = dim;
  }

  frame(pixel: number, t: number, clock: number): void {
    const u = this.mat.uniforms;
    u['uPixel']!.value = pixel;
    u['uT']!.value = t;
    u['uClock']!.value = clock;
  }

  get strips(): number {
    return this.s.n;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}

/** The rings on the sockets of cables that are out: one billboard each, drawn while open. */
class Rings {
  readonly mesh: THREE.Mesh;
  private readonly geo = new THREE.InstancedBufferGeometry();
  private readonly mat: THREE.ShaderMaterial;
  private readonly open: Float32Array;
  private readonly attr: THREE.InstancedBufferAttribute;

  constructor(shape: PowerShape) {
    const n = shape.rings.length,
      ring = new Float32Array(4 * n);
    shape.rings.forEach((r, i) => ring.set([r.at[0], r.at[1], r.at[2], r.r], 4 * i));
    this.geo.setAttribute('corner', new THREE.Float32BufferAttribute([-1, -1, 1, -1, -1, 1, 1, 1], 2));
    this.geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(12), 3));
    this.geo.setIndex([0, 1, 2, 1, 3, 2]);
    this.geo.setAttribute('iRing', new THREE.InstancedBufferAttribute(ring, 4));
    this.open = new Float32Array(Math.max(1, n));
    this.attr = new THREE.InstancedBufferAttribute(this.open, 1);
    this.geo.setAttribute('iOpen', this.attr);
    this.geo.instanceCount = n;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: RING_VERT,
      fragmentShader: RING_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      side: THREE.DoubleSide,
      uniforms: { uPixel: { value: 0.002 }, uClock: { value: 0 } },
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1004;
    this.mesh.raycast = () => {};
    this.mesh.visible = n > 0;
  }

  set(open: Uint8Array): void {
    for (let i = 0; i < open.length; i++) {
      this.open[i] = open[i]!;
    }
    this.attr.needsUpdate = true;
  }

  frame(pixel: number, clock: number): void {
    this.mat.uniforms['uPixel']!.value = pixel;
    this.mat.uniforms['uClock']!.value = clock;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}

const NODE_VERT = /* glsl */ `
attribute vec2 corner;
attribute vec3 iAt, iEx, iEy;
attribute vec4 iLook;
varying vec2 vLocal, vHalf;
varying float vRole, vLevel, vState, vRound, vSeed;
void main() {
  // the plate and a margin round it, for the glow of its edge
  vHalf = vec2(length(iEx), length(iEy));
  vLocal = corner * vHalf * 1.14;
  vec4 mv = modelViewMatrix * vec4(iAt + iEx * corner.x * 1.14 + iEy * corner.y * 1.14, 1.0);
  // toward the eye a little: the plate lies just over what it marks
  mv.xyz -= normalize(mv.xyz) * 16.0;
  gl_Position = projectionMatrix * mv;
  vRole = iLook.x; vLevel = iLook.y; vState = iLook.z; vRound = iLook.w;
  vSeed = fract(dot(iAt, vec3(0.011, 0.007, 0.013)));
}`;

const NODE_FRAG = /* glsl */ `
uniform float uClock, uStrength;
varying vec2 vLocal, vHalf;
varying float vRole, vLevel, vState, vRound, vSeed;
${powerscale.powerGlsl()}
${ROLE_GLSL}
// the signed distance to a rounded box: negative inside
float sdBox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
void main() {
  float d = sdBox(vLocal, vHalf, vRound), w = max(26.0, 0.1 * min(vHalf.x, vHalf.y));
  // a bright edge and a soft fill: the node's outline, so it reads as a thing and not a smear
  float edge = 1.0 - smoothstep(0.0, w, abs(d));
  float fill = 1.0 - smoothstep(-w, w * 0.4, d);
  vec3 col;
  float a;
  if (vState > 1.5) {
    // fed by a cable that is out: red, pulsing
    float p = 0.5 + 0.5 * sin(uClock * 6.0 + vSeed * 6.2831853);
    col = warn() * (0.8 + 0.6 * p);
    a = edge * (0.5 + 0.4 * p) + fill * 0.2 * p;
  } else if (vState < 0.5) {
    // nothing passes: a dim outline
    col = role(vRole, 0.0);
    a = edge * 0.45 + fill * 0.06;
  } else {
    float lv = max(vLevel, 0.2), breathe = 0.86 + 0.14 * sin(uClock * 2.4 + vSeed * 6.2831853);
    col = role(vRole, lv) * (0.9 + 0.5 * lv);
    a = (edge * 0.95 + fill * (0.2 + 0.2 * lv)) * breathe;
  }
  if (d > w * 1.2) discard;
  gl_FragColor = vec4(col * uStrength, a);
}`;

/** The plates' material: with `depthTest` a part in front hides a plate, without it the plate shows through everything. */
function nodeMaterial(depthTest: boolean, strength: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: NODE_VERT,
    fragmentShader: NODE_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    side: THREE.DoubleSide,
    uniforms: { uClock: { value: 0 }, uStrength: { value: strength } },
  });
}

/**
 * The plates of the nodes that are places (`PowerNode`): one quad each, lying where the thing is, drawn with the depth test so a part in front of it hides it. The colour is
 * the role (a hub cyan, a source white), the brightness what passes through; a hub whose feeding cable is out pulses red.
 */
class Nodes {
  readonly mesh: THREE.Mesh;
  private readonly geo = new THREE.InstancedBufferGeometry();
  private readonly mat: THREE.ShaderMaterial;
  /** The same plates through everything, dim: a hub that stands behind a drive cage or a card is still where it is (as the runs behind the tray are drawn dim). */
  private readonly hiddenMat: THREE.ShaderMaterial;
  private readonly look: Float32Array;
  private readonly attr: THREE.InstancedBufferAttribute;
  private readonly n: number;

  constructor(shape: PowerShape) {
    const n = (this.n = shape.nodes.length),
      at = new Float32Array(3 * n),
      ex = new Float32Array(3 * n),
      ey = new Float32Array(3 * n);
    this.look = new Float32Array(4 * Math.max(1, n));
    shape.nodes.forEach((nd, k) => {
      at.set(nd.at, 3 * k);
      ex.set(nd.ex, 3 * k);
      ey.set(nd.ey, 3 * k);
      this.look[4 * k] = TONE[nd.role];
      this.look[4 * k + 3] = nd.round;
    });
    this.geo.setAttribute('corner', new THREE.Float32BufferAttribute([-1, -1, 1, -1, -1, 1, 1, 1], 2));
    this.geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(12), 3));
    this.geo.setIndex([0, 1, 2, 1, 3, 2]);
    this.geo.setAttribute('iAt', new THREE.InstancedBufferAttribute(at, 3));
    this.geo.setAttribute('iEx', new THREE.InstancedBufferAttribute(ex, 3));
    this.geo.setAttribute('iEy', new THREE.InstancedBufferAttribute(ey, 3));
    this.attr = new THREE.InstancedBufferAttribute(this.look, 4);
    this.geo.setAttribute('iLook', this.attr);
    this.geo.instanceCount = n;
    this.mat = nodeMaterial(true, STRENGTH);
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1001;
    this.mesh.raycast = () => {};
    this.mesh.visible = n > 0;
    this.hiddenMat = nodeMaterial(false, STRENGTH * HIDDEN_PLATE);
    const hidden = new THREE.Mesh(this.geo, this.hiddenMat);
    hidden.frustumCulled = false;
    hidden.renderOrder = 1000;
    hidden.raycast = () => {};
    hidden.visible = n > 0;
    this.mesh.add(hidden);
  }

  set(draw: PowerDraw): void {
    for (let k = 0; k < this.n; k++) {
      this.look[4 * k + 1] = draw.nodeLevel[k]!;
      this.look[4 * k + 2] = draw.nodeState[k]!;
    }
    this.attr.needsUpdate = true;
  }

  frame(clock: number): void {
    this.mat.uniforms['uClock']!.value = clock;
    this.hiddenMat.uniforms['uClock']!.value = clock;
  }

  get count(): number {
    return this.n;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
    this.hiddenMat.dispose();
  }
}

/** The lines, rings and plates of one shape. */
export class PowerFlows {
  readonly mesh = new THREE.Group();
  private readonly solid: Layer;
  private readonly ghost: Layer;
  private readonly rings: Rings;
  private readonly nodes: Nodes;
  private t = 0;

  constructor(shape: PowerShape) {
    const idx = shape.lines.map((_, i) => i),
      pick = (ghost: boolean): number[] => idx.filter((i) => (shape.lines[i]!.kind === 'ghost') === ghost);
    const a = pick(false),
      b = pick(true);
    this.solid = new Layer(
      a.map((i) => shape.lines[i]!),
      a,
      true,
      1002,
    );
    this.ghost = new Layer(
      b.map((i) => shape.lines[i]!),
      b,
      false,
      1003,
    );
    this.rings = new Rings(shape);
    this.nodes = new Nodes(shape);
    this.mesh.add(this.nodes.mesh, this.solid.mesh, this.ghost.mesh, this.rings.mesh);
  }

  /** A new snapshot on the shape (`held`: the cables a hand holds). */
  set(draw: PowerDraw, held: ReadonlySet<string>): void {
    this.solid.set(draw, held, 1);
    // (the runs behind the tray are a hint: dimmer than the rest)
    this.ghost.set(draw, held, 0.55);
    this.rings.set(draw.open);
    this.nodes.set(draw);
  }

  /** Per frame: `dt` game seconds (0 holds the pulses), `clock` real seconds (the red pulse of what is wrong goes on while the game is paused). */
  frame(cam: THREE.PerspectiveCamera, pxHeight: number, dt: number, clock: number): void {
    this.t = (this.t + dt) % 10_000;
    const pixel = 2 / (cam.projectionMatrix.elements[5]! * Math.max(1, pxHeight));
    this.solid.frame(pixel, this.t, clock);
    this.ghost.frame(pixel, this.t, clock);
    this.rings.frame(pixel, clock % 1000);
    this.nodes.frame(clock % 1000);
  }

  /** How many strips are drawn, for the check tool. */
  get strips(): number {
    return this.solid.strips + this.ghost.strips;
  }
  /** How many plates are drawn. */
  get plates(): number {
    return this.nodes.count;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.solid.dispose();
    this.ghost.dispose();
    this.rings.dispose();
    this.nodes.dispose();
  }
}
