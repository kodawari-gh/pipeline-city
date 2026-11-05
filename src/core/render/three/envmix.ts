// Two lights in one environment: the studio's (the board view's, `init.ts`) and the room's probe (`probe.ts`), blended by weight into one
// prefiltered cube, so what takes the scene's environment (the machine) fades from one light to the other as the camera moves, with no switch.
// Both are three's PMREM at one size (a cube of 256 and its rough mips), so a blend face by face and mip by mip is a blend of their light, and a
// material keeps its program whichever of the three it takes.
import {
  BackSide, BoxGeometry, CubeCamera, HalfFloatType, LinearMipmapLinearFilter, LinearSRGBColorSpace, Mesh, NoBlending, PMREMGenerator, ShaderChunk,
  ShaderMaterial, WebGLCubeRenderTarget, type CubeTexture, type Scene, type Texture, type WebGLRenderer,
} from 'three';

const MIX = /* glsl */`
varying vec3 vWorldDirection;
uniform samplerCube a, b;
uniform float ka, kb, lod;
void main() {
  gl_FragColor = vec4( ka * textureLod( a, vWorldDirection, lod ).rgb + kb * textureLod( b, vWorldDirection, lod ).rgb, 1.0 );
}`;

export class EnvMix {
  private readonly pmrem: PMREMGenerator;
  /** The probe's last capture, prefiltered (`setRoom`). */
  private target: WebGLCubeRenderTarget | null = null;
  private captures = 0;
  /** The blend, and what it holds: the room's share and the capture it was made from. */
  private readonly out: WebGLCubeRenderTarget;
  private held = { t: -1, capture: -1 };
  private readonly u = { a: { value: null as Texture | null }, b: { value: null as Texture | null }, ka: { value: 0 }, kb: { value: 0 }, lod: { value: 0 } };
  private readonly box: Mesh<BoxGeometry, ShaderMaterial>;
  private readonly cam: CubeCamera;

  /** `studioK`, `roomK`: each map's strength alone (the scene's `environmentIntensity`). */
  constructor(private readonly renderer: WebGLRenderer, private readonly studio: Texture, private readonly studioK: number, private readonly roomK: number) {
    this.pmrem = new PMREMGenerator(renderer);
    // the studio's own layout: its size and its mips, which the program reads (`ENVMAP_MAX_LOD`)
    const size = (studio.image as { width: number }[])[0]!.width;
    this.out = new WebGLCubeRenderTarget(size, { minFilter: LinearMipmapLinearFilter, generateMipmaps: false, type: HalfFloatType, colorSpace: LinearSRGBColorSpace, depthBuffer: false });
    const mips = this.out.texture.mipmaps as unknown as { width: number; height: number }[];
    for (const m of studio.mipmaps as { width: number; height: number }[]) mips.push({ width: m.width, height: m.height });
    Object.assign(this.out.texture, { isPMREMTexture: true });
    this.box = new Mesh(new BoxGeometry(5, 5, 5), new ShaderMaterial({ uniforms: this.u, vertexShader: ShaderChunk.cube_vert, fragmentShader: MIX, side: BackSide, blending: NoBlending, depthTest: false, depthWrite: false }));
    this.box.frustumCulled = false;
    this.cam = new CubeCamera(1, 10, this.out);
  }

  /** The room's light prefiltered, once the probe has a capture (the room's own materials take it at every height). */
  get room(): Texture | null { return this.target?.texture ?? null; }

  /** Takes the probe's new capture. */
  setRoom(cube: CubeTexture): void {
    this.target = this.pmrem.fromCubemap(cube, this.target);
    this.captures++;
  }

  /** Lights `scene` with `t` of the room's light and the rest of the studio's: either map alone at its strength at the ends, the blend between. */
  apply(scene: Scene, t: number): void {
    const room = this.target;
    if (!room || t <= 0) { scene.environment = this.studio; scene.environmentIntensity = this.studioK; return; }
    if (t >= 1) { scene.environment = room.texture; scene.environmentIntensity = this.roomK; return; }
    if (t !== this.held.t || this.captures !== this.held.capture) { this.blend(room.texture, t); this.held = { t, capture: this.captures }; }
    scene.environment = this.out.texture;
    scene.environmentIntensity = 1;
  }

  /** Draws the blend into every face of every mip (the viewport set to the mip's size, as three's PMREM does). */
  private blend(room: Texture, t: number): void {
    const u = this.u;
    u.a.value = this.studio; u.b.value = room; u.ka.value = this.studioK * (1 - t); u.kb.value = this.roomK * t;
    for (let lod = 0; lod < this.out.texture.mipmaps.length; lod++) {
      const size = this.out.width >> lod;
      u.lod.value = lod;
      this.cam.activeMipmapLevel = lod;
      this.out.viewport.set(0, 0, size, size);
      this.cam.update(this.renderer, this.box);
    }
    this.out.viewport.set(0, 0, this.out.width, this.out.height);
  }
}
