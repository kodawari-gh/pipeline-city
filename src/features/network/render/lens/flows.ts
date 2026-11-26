// The network lens's lines as one mesh (docs/render/net.md "The network lens"): an instanced mesh of strips turned to face the camera, a strip for each straight stretch of
// each line of the path (`netShape`). Nothing is moved per frame on the CPU: the shader finds the pulses. A line that is up keeps a steady glow; data that comes in is a
// cyan comet that runs along the line toward the machine, results that go out are violet comets that run back; the faster the link, the faster and closer the comets. With
// the link up and nothing moving, a faint slow trickle shows it lives. A line that is out (the lead unplugged, the link down) pulses red and does not move. The lines are
// drawn with the depth test, lifted a little toward the eye (a cable is seen where it runs, and goes behind what stands in front of it).
import * as THREE from 'three';
import { seedOf } from '@/features/board/render/three/power/flows';
import type { NetDraw, NetShape } from './shape';

/** The brightness of the lines over the picture. */
const STRENGTH = 1;
/** Speed (units a second) and gap between comets (units) at the foot and the top of the speed scale. */
const SPEED_LO = 1400,
  SPEED_HI = 5600,
  GAP_LO = 1700,
  GAP_HI = 900;

/** The strips of some lines, as the buffers of a mesh: each strip's two ends (the fourth number: the arc length along its line), its width, its seed and its lift. */
export interface NetStrips {
  a: Float32Array;
  b: Float32Array;
  look: Float32Array;
  n: number;
  first: Int32Array;
  count: Int32Array;
}
function netStrips(shape: NetShape): NetStrips {
  const { lines } = shape;
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
    // (each strand of a lead has its own place in its gap: the strands of one cable do not pulse as one)
    const seed = seedOf(`${l.id}${i}`);
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
      look.set([l.width, seed, l.lift, 0], 4 * k);
      s += len;
      k++;
    }
    count[i] = k - first[i]!;
  });
  return { a, b, look, n: k, first, count };
}

const VERT = /* glsl */ `
attribute vec2 corner;
attribute vec4 iA, iB, iLook;
attribute vec3 iState;
uniform float uPixel;
varying float vS, vAcross, vDown, vUp, vState, vSeed;
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
  vS = mix(iA.w, iB.w, corner.x) + end * w * 0.6 * (iB.w - iA.w) / len;
  vAcross = corner.y;
  vDown = iState.x;
  vUp = iState.y;
  vState = iState.z;
  vSeed = iLook.y;
}`;

const FRAG = /* glsl */ `
uniform float uT, uClock, uStrength;
varying float vS, vAcross, vDown, vUp, vState, vSeed;
const vec3 DOWN = vec3(0.22, 0.80, 1.0);
const vec3 UP = vec3(0.74, 0.60, 1.0);
const vec3 WARN = vec3(1.0, 0.2, 0.36);
// a comet: a bright head and a tail behind it; \`way\` +1 goes along the line (toward the machine), -1 back along it; \`lv\` the link's place on the speed scale
float comet(float lv, float way, float off) {
  float speed = mix(${SPEED_LO.toFixed(1)}, ${SPEED_HI.toFixed(1)}, lv), gap = mix(${GAP_LO.toFixed(1)}, ${GAP_HI.toFixed(1)}, lv);
  float f = fract((vS - way * uT * speed) / gap + vSeed + off);
  return pow(f, 9.0) * (1.0 - smoothstep(0.94, 1.0, f));
}
void main() {
  // a round line: a hot core, a soft edge
  float prof = pow(1.0 - min(abs(vAcross), 1.0), 1.7);
  vec3 col;
  float a;
  if (vState > 1.5) {
    // a lead that is out, or a link that is down: red, pulsing, still
    float p = 0.5 + 0.5 * sin(uClock * 5.0 + vSeed * 6.2831853);
    col = WARN * (0.7 + 0.7 * p);
    a = prof * (0.35 + 0.45 * p);
  } else if (vState < 0.5) {
    // nothing runs: a dim thread
    col = DOWN * 0.5;
    a = prof * 0.22;
  } else {
    // the link is up: a steady glow, the comets of what moves on it. Idle (neither way moves): a slow faint trickle coming in.
    float idle = (vDown <= 0.0 && vUp <= 0.0) ? 1.0 : 0.0;
    float hd = comet(mix(0.05, 1.0, vDown), 1.0, 0.0) * (vDown > 0.0 ? 1.0 : 0.3 * idle);
    float hu = comet(mix(0.05, 1.0, vUp), -1.0, 0.5) * (vUp > 0.0 ? 1.0 : 0.0);
    // with data going both ways each has its own lane: in on one side of the line, out on the other, so the two colours do not add up to white
    float both = (vDown > 0.0 && vUp > 0.0) ? 1.0 : 0.0, lane = smoothstep(-0.2, 0.2, vAcross);
    float wd = mix(1.0, 1.0 - lane, both), wu = mix(1.0, lane, both);
    col = DOWN * (0.10 + 1.5 * hd) * wd + UP * (vUp > 0.0 ? (0.10 + 1.5 * hu) * wu : 0.0);
    a = prof * (0.36 + 0.64 * clamp(max(hd * wd, hu * wu), 0.0, 1.0));
  }
  gl_FragColor = vec4(col * uStrength, a);
}`;

/** The lines of one shape. */
export class NetFlows {
  readonly mesh: THREE.Mesh;
  private readonly geo = new THREE.InstancedBufferGeometry();
  private readonly mat: THREE.ShaderMaterial;
  private readonly state: Float32Array;
  private readonly attr: THREE.InstancedBufferAttribute;
  private readonly s: NetStrips;
  private t = 0;

  constructor(private readonly shape: NetShape) {
    const s = (this.s = netStrips(shape));
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
      // (added to the picture: two strips that overlap at a bend, or the strands of a lead at its plug, add up; both faces, a strip's winding turns with its run's way)
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      side: THREE.DoubleSide,
      uniforms: { uPixel: { value: 0.002 }, uT: { value: 0 }, uClock: { value: 0 }, uStrength: { value: STRENGTH } },
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1002;
    this.mesh.raycast = () => {};
    this.mesh.visible = s.n > 0;
  }

  /** A new snapshot: each strip's pace and state. */
  set(draw: NetDraw): void {
    const { state: st, s } = this;
    this.shape.lines.forEach((_, i) => {
      for (let k = s.first[i]!, e = k + s.count[i]!; k < e; k++) {
        st[3 * k] = draw.down[i]!;
        st[3 * k + 1] = draw.up[i]!;
        st[3 * k + 2] = draw.state[i]!;
      }
    });
    this.attr.needsUpdate = true;
  }

  /** Per frame: `dt` game seconds (0 holds the comets), `clock` real seconds (the red pulse goes on while the game is paused). */
  frame(cam: THREE.PerspectiveCamera, pxHeight: number, dt: number, clock: number): void {
    this.t = (this.t + dt) % 10_000;
    const u = this.mat.uniforms;
    u['uPixel']!.value = 2 / (cam.projectionMatrix.elements[5]! * Math.max(1, pxHeight));
    u['uT']!.value = this.t;
    u['uClock']!.value = clock % 1000;
  }

  /** How many strips are drawn, for the check tool. */
  get strips(): number {
    return this.s.n;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}
