// The air's particles drawn as ribbons (docs/render/air.md): one instanced mesh, a fixed pool. Each particle is a short strip along its trail, turned to face
// the camera, wide at the head and fine at the tail, coloured by its temperature and added to the picture. A veil under them dims the room so they read.
import {
  AdditiveBlending, Color, Group, InstancedBufferAttribute, InstancedBufferGeometry, InstancedInterleavedBuffer, InterleavedBufferAttribute, Float32BufferAttribute,
  Mesh, NormalBlending, PlaneGeometry, ShaderMaterial, type PerspectiveCamera,
} from 'three';
import { TRAIL, type AirParticles } from './particles';

/** The air's colours by its rise over the room, blue through amber to red (the 2D lens's, `airColor`); the water's by its temperature. */
const AIR_COOL = '#6fd6ff', AIR_WARM = '#ffb84a', AIR_HOT = '#ff4538', WATER_COOL = '#4fc8ff', WATER_HOT = '#ff7a3a';
/** The rise over the room that is full red, C, and the water's range. */
export const AIR_RANGE_C = 18;
export const WATER_FROM_C = 22, WATER_TO_C = 62;

const VERT = /* glsl */`
attribute vec2 corner;
attribute vec3 p0, p1, p2, p3, p4;
attribute vec3 info;
uniform float uWidth, uPixel, uPass, uNearFrom, uNearTo;
varying float vHeat, vAlpha, vEdge, vKind;
vec3 pick(float t) { return t < 0.5 ? p0 : t < 1.5 ? p1 : t < 2.5 ? p2 : t < 3.5 ? p3 : p4; }
void main() {
  // one pass draws the air, the other the coolant and the power supply's air (over the parts, as they run inside hoses and a case of their own)
  if ((uPass < 0.5) != (info.z < 1.5)) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vHeat = 0.0; vAlpha = 0.0; vEdge = 0.0; vKind = 0.0; return; }
  float t = corner.x;
  vec3 a = (modelViewMatrix * vec4(pick(t), 1.0)).xyz;
  vec3 b = (modelViewMatrix * vec4(pick(min(t + 1.0, 4.0)), 1.0)).xyz;
  vec3 c = (modelViewMatrix * vec4(pick(max(t - 1.0, 0.0)), 1.0)).xyz;
  float tl = length(b - c);
  // the strip lies across the view ray, along the trail as a whole (not each step of it: the head's step is short and turns with every eddy)
  vec3 head = (modelViewMatrix * vec4(p0, 1.0)).xyz, tail = (modelViewMatrix * vec4(p4, 1.0)).xyz;
  vec3 way = head - tail;
  if (dot(way, way) < 1e-2) way = b - c;
  vec3 cr = cross(way, a);
  vec3 side = dot(cr, cr) > 1e-6 ? normalize(cr) : vec3(1.0, 0.0, 0.0);
  float kind = info.z;
  bool water = kind > 1.5 && kind < 2.5;
  // a thread from far, a fine streak from close: between a pixel and three pixels each side, whatever the size the air has in the machine; then it tapers to its tail
  float px = uPixel * max(-a.z, 1.0);
  float w = clamp(uWidth * (water ? 1.5 : 1.0), px * 0.9, px * (water ? 3.2 : 3.0)) * (1.0 - 0.65 * t / 4.0);
  w = max(w, px * 0.5);
  gl_Position = projectionMatrix * vec4(a + side * w * corner.y, 1.0);
  vHeat = info.x;
  // a streak close to the eye (the camera of a close-up stands inside the case) fades out: it would be a long line over the part the player came to see
  vAlpha = info.y * pow(1.0 - t / 4.0, 1.3) * (tl > 1e-3 || t < 0.5 ? 1.0 : 0.0) * smoothstep(uNearFrom, uNearTo, -a.z);
  vEdge = corner.y;
  vKind = kind;
}`;

const FRAG = /* glsl */`
uniform vec3 uCool, uWarm, uHot, uWaterCool, uWaterHot;
uniform float uAmb, uRange, uStrength, uWaterFrom, uWaterTo, uCold;
varying float vHeat, vAlpha, vEdge, vKind;
void main() {
  vec3 col;
  if (vKind > 1.5 && vKind < 2.5) col = mix(uWaterCool, uWaterHot, clamp((vHeat - uWaterFrom) / (uWaterTo - uWaterFrom), 0.0, 1.0));
  else {
    float h = clamp((vHeat - uAmb) / uRange, 0.0, 1.0);
    col = h < 0.5 ? mix(uCool, uWarm, h * 2.0) : mix(uWarm, uHot, (h - 0.5) * 2.0);
  }
  // the room's own air is a quiet haze and the air that took heat stands out: where the heat goes is what the eye should find
  float warm = vKind > 1.5 && vKind < 2.5 ? 1.0 : mix(uCold, 1.0, sqrt(clamp((vHeat - uAmb) / uRange, 0.0, 1.0)));
  float soft = 1.0 - vEdge * vEdge;
  gl_FragColor = vec4(col * uStrength, vAlpha * soft * warm);
}`;

const lin = (hex: string): Color => new Color(hex);
/** How bright the streaks add to the picture (the colours are the share of it), and the share of it the room's own air keeps. */
const STRENGTH = 1.7, COLD_SHARE = 0.5;
/** The distance from the eye, in units, where the streaks begin to show and where they are whole (23000 units a metre: 20 cm to 43 cm). */
const NEAR_FROM = 4500, NEAR_TO = 10000;

/** The particles of one `AirParticles` as meshes: the air (hidden behind the parts it flows round), and the coolant and the supply's air (seen through the hoses and the casing they run in). */
export class Ribbons {
  readonly mesh = new Group();
  private readonly geo = new InstancedBufferGeometry();
  private readonly mats: ShaderMaterial[] = [];
  private readonly buf: InstancedInterleavedBuffer;
  private readonly info: Float32Array;
  private readonly infoAttr: InstancedBufferAttribute;

  constructor(private readonly p: AirParticles) {
    // the strip: TRAIL points, two corners each (the side), triangles between them
    const corner: number[] = [], index: number[] = [];
    for (let t = 0; t < TRAIL; t++) corner.push(t, -1, t, 1);
    for (let t = 0; t < TRAIL - 1; t++) { const a = 2 * t; index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    this.geo.setAttribute('corner', new Float32BufferAttribute(corner, 2));
    // (`position` is needed for the draw count; the shader does not read it)
    this.geo.setAttribute('position', new Float32BufferAttribute(new Float32Array(TRAIL * 2 * 3), 3));
    this.geo.setIndex(index);
    this.buf = new InstancedInterleavedBuffer(p.P, TRAIL * 3, 1);
    for (let k = 0; k < TRAIL; k++) this.geo.setAttribute(`p${k}`, new InterleavedBufferAttribute(this.buf, 3, 3 * k));
    this.info = new Float32Array(p.cap * 3);
    this.infoAttr = new InstancedBufferAttribute(this.info, 3);
    this.geo.setAttribute('info', this.infoAttr);
    this.geo.instanceCount = 0;
    for (const pass of [0, 1]) {
      const mat = new ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, depthTest: pass === 0, blending: AdditiveBlending, toneMapped: false,
        uniforms: {
          uWidth: { value: 62 }, uPixel: { value: 0.002 }, uPass: { value: pass }, uAmb: { value: 25 }, uRange: { value: AIR_RANGE_C }, uStrength: { value: STRENGTH }, uCold: { value: COLD_SHARE }, uNearFrom: { value: NEAR_FROM }, uNearTo: { value: NEAR_TO },
          uCool: { value: lin(AIR_COOL) }, uWarm: { value: lin(AIR_WARM) }, uHot: { value: lin(AIR_HOT) },
          uWaterCool: { value: lin(WATER_COOL) }, uWaterHot: { value: lin(WATER_HOT) }, uWaterFrom: { value: WATER_FROM_C }, uWaterTo: { value: WATER_TO_C },
        },
      });
      const m = new Mesh(this.geo, mat);
      m.frustumCulled = false;
      m.renderOrder = 1000 + pass;
      m.raycast = () => {};
      this.mats.push(mat);
      this.mesh.add(m);
    }
  }

  /** Per frame: copy what the particles hold to the mesh. `ambientC`: the room's temperature, the red's base; `pxHeight`: the view's height in pixels. */
  frame(cam: PerspectiveCamera, pxHeight: number, ambientC: number, strength = 1): void {
    const p = this.p, n = p.count;
    for (let i = 0; i < n; i++) { this.info[3 * i] = p.T[i]!; this.info[3 * i + 1] = p.A[i]!; this.info[3 * i + 2] = p.K[i]!; }
    this.buf.needsUpdate = true;
    this.infoAttr.needsUpdate = true;
    this.geo.instanceCount = n;
    // the world size of a pixel at one unit of depth: a ribbon is never finer than it
    const pixel = 2 / (cam.projectionMatrix.elements[5]! * Math.max(1, pxHeight));
    for (const m of this.mats) {
      m.uniforms.uAmb!.value = ambientC;
      m.uniforms.uStrength!.value = STRENGTH * strength;
      m.uniforms.uPixel!.value = pixel;
    }
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geo.dispose();
    for (const m of this.mats) m.dispose();
  }
}

/** A dark sheet over the whole view, under the ribbons: the room dims, the air stays bright. */
export function makeVeil(): Mesh {
  const mat = new ShaderMaterial({
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'uniform float uA; void main() { gl_FragColor = vec4(0.012, 0.016, 0.04, uA); }',
    uniforms: { uA: { value: 0.5 } }, transparent: true, depthTest: false, depthWrite: false, blending: NormalBlending, toneMapped: false,
  });
  const m = new Mesh(new PlaneGeometry(2, 2), mat);
  m.frustumCulled = false;
  m.renderOrder = 900;
  m.raycast = () => {};
  return m;
}
