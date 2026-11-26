// BuildStage and the case's front-panel leads: they are the case's, not the game's cables. When a board goes in the hand runs them out of their hole to its
// headers and plugs them; when the board comes out the hand pulls them off and takes them back. The machine's drawing and the hand are stubbed: what is under
// test is the order of the steps and the stage's own say of which leads are in (the hand reads it as the snapshot's cables).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Group, PerspectiveCamera, Scene } from 'three';
import { BuildStage } from './buildmode3d';
import { isPanelId } from './casetray3d';
import { setLayoutTier } from '../layout/layout';
import { Game } from '@/worker/game/game';
import { playCue } from '@/app/audio/engine';
import type * as init from '@/core/render/three/init';
import type * as engine from '@/app/audio/engine';

function createPost() {
  return {
    render: () => {
      /* no-op */
    },
    refine: () => false,
    meter: () => null,
    metered: () => null,
    setEye: () => {
      /* no-op */
    },
    setReach: () => {
      /* no-op */
    },
    setDark: () => {
      /* no-op */
    },
    setOpaqueSort: () => {
      /* no-op */
    },
    apply: () => {
      /* no-op */
    },
    setSize: () => {
      /* no-op */
    },
    startPrograms: () => [],
  };
}

function createLens3D() {
  return {
    frame: () => {
      /* no-op */
    },
  };
}

const { Post, Lens3D } = vi.hoisted(() => ({ Post: createPost, Lens3D: createLens3D }));

function ResizeObserverStub() {
  return {
    observe: (): void => {
      /* no-op */
    },
    disconnect: (): void => {
      /* no-op */
    },
  };
}

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

vi.mock('@/core/render/three/init', async (orig) => {
  const actual = await orig<typeof init>();
  return {
    ...actual,
    createRenderContext: () => ({
      scene: new Scene(),
      camera: new PerspectiveCamera(30, 1, 10, 1e6),
      renderer: {
        domElement: {
          width: 400,
          height: 400,
          addEventListener: () => {
            /* no-op */
          },
          removeEventListener: () => {
            /* no-op */
          },
        },
        setOpaqueSort: () => {
          /* no-op */
        },
        getPixelRatio: () => 1,
        setSize: () => {
          /* no-op */
        },
        properties: { get: () => ({}) },
        compile: () => new Set(),
        getRenderTarget: () => null,
        setRenderTarget: () => {
          /* no-op */
        },
      },
    }),
  };
});
vi.mock('@/core/render/three/post', () => ({
  Post,
}));
vi.mock('./lens3d', () => ({
  Lens3D,
}));
vi.mock('@/app/audio/engine', async (orig) => ({
  ...(await orig<typeof engine>()),
  playCue: vi.fn(),
}));

const LEADS = ['panel:ARGB', 'panel:USB_3', 'panel:F_PANEL', 'panel:USB_2'];

/** What the tests reach into. */
interface Inside {
  panelOut: Set<string>;
  reeled: Set<string>;
  handSnapshot: () => { cables: { id: string; connected: boolean }[] };
  plugPanelLead: (id: string, plugged: boolean) => void;
  hand: unknown;
}
const hid = (s: BuildStage): Inside => s as unknown as Inside;

/** The hand's host callbacks as the stage built them (the real hand's, kept before the test puts its stub in place). */
interface PlugHost {
  connect: (id: string, port?: string) => void;
  disconnect: (id: string) => void;
}
interface Fake {
  calls: string[];
  synced: number[];
  held: string[][];
  host?: PlugHost;
}

/** A stage with the full rig and no 3D: the machine's drawing is stubbed (it has the four leads), the hand only writes down what it was asked. */
function stage(): { s: BuildStage; fake: Fake } {
  const fake: Fake = { calls: [], synced: [], held: [] };
  const s = new (BuildStage as unknown as new (h: unknown) => Record<string, unknown>)({
    clientWidth: 400,
    clientHeight: 800,
  });
  s['_machine'] = {
    moving: false,
    doorOpen: false,
    frame: () => {
      /* no-op */
    },
    setOpen: () => {
      /* no-op */
    },
    closeDoor: () => {
      /* no-op */
    },
    holdDetail: () => {
      /* no-op */
    },
    lod: () => {
      /* no-op */
    },
    root: new Group(),
    boardRoots: () => [],
    caseRoots: [],
    rig: (id: string) => (isPanelId(id) ? { name: `the ${id} header` } : null),
    holdBack: (ids: Iterable<string>) => {
      fake.held.push([...ids]);
    },
    letRun: () => {
      /* no-op */
    },
    isHeldBack: () => false,
    panelIds: () => LEADS,
    syncPanel: (out: ReadonlySet<string>) => {
      fake.synced.push(out.size);
    },
  };
  s['_game'] = new Game({ seed: 1, sandbox: true, preassembled: true, maxed: true, looseFit: true });
  s['rebuild'] = s['rebuildAll'] = function (this: {
    snaps: { drop: () => void };
    board: { tier: number; caseTier: number };
    holdReeled: () => void;
  }) {
    this.snaps.drop();
    setLayoutTier(this.board.tier, Math.max(this.board.tier, this.board.caseTier));
    this.holdReeled(); // (what a build of the machine does: the cables the job holds back stay out of sight)
  };
  s['playAll'] = async () => {
    /* no-op */
  };
  s['door'] = async () => {
    /* no-op */
  };
  // the hand: a front-panel lead it pulls or runs goes out of or into its header as the real hand's host would say (`plugPanelLead`); no other cable has a rig
  const t = s as unknown as Inside;
  fake.host = (t.hand as { host: PlugHost }).host;
  s['hand'] = {
    root: new Group(),
    kind: null,
    cancel: () => {
      /* no-op */
    },
    pullOut: (id: string) => {
      if (!isPanelId(id)) {
        return Promise.resolve(false);
      }
      fake.calls.push(`pull ${id}`);
      t.plugPanelLead(id, false);
      return Promise.resolve(true);
    },
    stow: (id: string) => {
      if (!isPanelId(id)) {
        return Promise.resolve(false);
      }
      fake.calls.push(`stow ${id}`);
      return Promise.resolve(true);
    },
    feed: (id: string, plug: boolean) => {
      fake.calls.push(`feed ${id}${plug ? ' in' : ''}`);
      if (plug) {
        t.plugPanelLead(id, true);
      }
      return Promise.resolve(true);
    },
    plugIn: () => Promise.resolve(false),
  };
  return { s: s as unknown as BuildStage, fake };
}

describe('the front-panel leads', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {
      /* no-op */
    });
  });

  it('are in their headers on a machine the game built, and the hand reads them as cables', () => {
    const { s } = stage(),
      snap = hid(s).handSnapshot();
    for (const id of LEADS) {
      expect(snap.cables.find((c) => c.id === id)).toMatchObject({ connected: true });
    }
    // (the game's own cables are all still there)
    expect(snap.cables.some((c) => c.id === 'atx')).toBe(true);
  });

  it('read as unplugged while the stage says they are out, and as plugged again when the hand pushes one in', () => {
    const { s } = stage(),
      t = hid(s);
    t.plugPanelLead('panel:USB_3', false);
    expect(t.handSnapshot().cables.find((c) => c.id === 'panel:USB_3')?.connected).toBe(false);
    expect(t.handSnapshot().cables.find((c) => c.id === 'panel:F_PANEL')?.connected).toBe(true);
    t.plugPanelLead('panel:USB_3', true);
    expect(t.handSnapshot().cables.find((c) => c.id === 'panel:USB_3')?.connected).toBe(true);
  });

  it('run out of their hole and are plugged when a board goes into a bare case (and are pulled off no board)', async () => {
    const { s, fake } = stage();
    await s.clear();
    await s.fit('case3');
    expect(fake.calls).toStrictEqual([]);
    await s.fit('board3');
    expect(fake.calls).toStrictEqual(LEADS.map((id) => `feed ${id} in`));
    // (the board is in and its leads are plugged: nothing stays out)
    expect(hid(s).panelOut.size).toBe(0);
    expect(hid(s).reeled.size).toBe(0);
  });

  it('come off the old board and go back into their hole before it lifts out, and run out to the new board', async () => {
    const { s, fake } = stage();
    await s.clear();
    await s.fit('case3');
    await s.fit('board3');
    fake.calls.length = 0;
    await s.fit('board2');
    const pulls = LEADS.flatMap((id) => [`pull ${id}`, `stow ${id}`]),
      feeds = LEADS.map((id) => `feed ${id} in`);
    // each lead is pulled off its header and taken back, one after the other; then the new board's come out (the machine stub has the same four)
    expect(fake.calls).toStrictEqual([...pulls, ...feeds]);
    expect(hid(s).panelOut.size).toBe(0);
  });

  it('are held back, out of sight and out of their headers, from the board that comes in until the hand runs them', async () => {
    const { s, fake } = stage();
    await s.clear();
    await s.fit('case3');
    await s.fit('board3');
    // (the machine of the new board was told to hold every lead back: they show only as the hand runs them)
    expect(fake.held.flat()).toStrictEqual(expect.arrayContaining(LEADS));
  });

  it('play the cable connect cue when the hand pushes a front-panel lead in, and the disconnect cue when it pulls one out', () => {
    const { s, fake } = stage(),
      t = hid(s);
    vi.mocked(playCue).mockClear();
    // (the hand's own callbacks, as a plug in or out calls them: a lead out of its header, then back into it)
    must(fake.host).disconnect('panel:USB_3');
    expect(t.panelOut.has('panel:USB_3')).toBe(true);
    expect(vi.mocked(playCue).mock.calls).toStrictEqual([['cable_disconnect']]);
    must(fake.host).connect('panel:USB_3', 'USB');
    expect(t.panelOut.has('panel:USB_3')).toBe(false);
    expect(vi.mocked(playCue).mock.calls).toStrictEqual([['cable_disconnect'], ['cable_connect']]);
  });

  it('are in their headers again after a job whatever the hand did (a refused or a cancelled run shows nothing out)', async () => {
    const { s, fake } = stage();
    await s.clear();
    await s.fit('case3');
    // a hand that cannot run a lead (no rig for it): the job ends with every lead in
    (s as unknown as { hand: { feed: () => Promise<boolean> } }).hand.feed = () => Promise.resolve(false);
    await s.fit('board3');
    expect(hid(s).panelOut.size).toBe(0);
    expect(fake.synced.at(-1)).toBe(0);
  });
});
