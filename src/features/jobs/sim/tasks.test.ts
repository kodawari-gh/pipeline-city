// The kinds of job inside a class (docs/JOBS.md "The catalogue"): which ones a level has reached, what each needs, and that each one runs to the end in a game.
import { describe, expect, it } from "vitest";
import { ECONOMY } from "../../economy/sim/economy";
import { Game } from "@/worker/game/game";
import { Operator } from "../../economy/sim/operator";
import { WEB_SIZES } from "../../network/sim";
import { JOB_DEX, pickTask, taskLevel, taskNeeds, taskOfTemplate } from "./jobdex";
import { JOB_CLASSES, jobClass, MAX_LEVEL, type Need } from "../../economy/sim/levels";
import { econ, netRig, rig } from "@/worker/game/testkit";

ECONOMY.levelGating = false;
ECONOMY.caseGating = false;

const tasks = JOB_DEX.filter((e) => !e.planned);

describe("the catalogue", () => {
  it("every kind of job has its own template, in a class that exists, arriving no earlier than its class", () => {
    expect(new Set(tasks.map((e) => e.template)).size).toBe(tasks.length - tasks.filter((e) => e.id === "web").length);
    for (const e of tasks) {
      const c = jobClass(e.cls);
      expect(c, e.id).toBeDefined();
      expect(taskLevel(e), e.id).toBeGreaterThanOrEqual(c!.firstLevel);
      expect(taskLevel(e), e.id).toBeLessThanOrEqual(MAX_LEVEL);
      expect(taskOfTemplate(e.template)?.cls, e.id).toBe(e.cls);
    }
  });

  it("a class sends only the kinds its level has reached, and the first level sends its own template", () => {
    for (const c of JOB_CLASSES) {
      for (let level = 1; level <= MAX_LEVEL; level++) {
        const open = tasks.filter((e) => e.cls === c.id && taskLevel(e) <= level);
        for (let seed = 1; seed < 400; seed += 7) {
          const t = pickTask(c, level, seed * 2654435761);
          if (t) expect(open.map((e) => e.id), `${c.id} at level ${level}`).toContain(t.id);
          else expect(open.every((e) => e.legacy) || open.length === 0, `${c.id} at level ${level}`).toBe(true);
        }
      }
    }
  });

  it("over many draws every kind a class has opened is sent", () => {
    for (const c of JOB_CLASSES) {
      const open = tasks.filter((e) => e.cls === c.id && taskLevel(e) <= MAX_LEVEL);
      if (open.length < 2 || open.every((e) => e.legacy)) continue;
      const seen = new Set<string>();
      for (let seed = 1; seed < 3000; seed++) { const t = pickTask(c, MAX_LEVEL, seed * 2654435761); if (t) seen.add(t.id); }
      expect([...seen].sort(), c.id).toEqual(open.map((e) => e.id).sort());
    }
  });

  it("the first levels play as they always did: the everyday class sends its own mixed template until a new kind has arrived", () => {
    const cli = jobClass("cli")!;
    for (let seed = 1; seed < 200; seed++) expect(pickTask(cli, 1, seed * 40503)).toBeUndefined();
    expect(pickTask(cli, 3, 5)).toBeUndefined();
    expect(pickTask(cli, 4, 5)).toBeDefined();
  });
});

describe("each kind of job that needs nothing runs to the end in a game", () => {
  for (const e of tasks.filter((x) => taskNeeds(x).length === 0 && x.cls === "cli")) {
    it(`${e.id} (${e.template}) is delivered and paid, and the log and the almanac know it by name`, () => {
      const g = rig("ssd1", { keys: [{ template: e.template }] });
      expect(g.snapshot().tray[0]).toMatchObject({ type: e.id, cls: e.cls });
      g.powerButton();
      for (let t = 0; t < 400 && g.currentPhase() !== "idle-os"; t++) g.advanceBaseTick();
      g.plugKey(g.trayKeyIds()[0]!);
      for (let t = 0; t < 4000 && g.completed < 1; t++) g.advanceBaseTick();
      expect(g.completed, e.id).toBe(1);
      const s = g.snapshot();
      expect(s.jobLog![0]).toMatchObject({ type: e.id, outcome: "done" });
      expect(s.dex!.find((d) => d.id === e.id)).toMatchObject({ state: "done", runs: 1 });
    });
  }
});

describe("the trust jobs run against a TPM, and the one that wants the second module says so", () => {
  const maxed = () => new Game({ seed: 3, sandbox: true, preassembled: true, maxed: true, economy: econ() });
  const withTpm = (id: string): Game => {
    const g = maxed();
    const r = g.purchase(id);
    if (!r.ok) throw new Error(r.reason);
    expect(g.install(r.invId).ok).toBe(true);
    g.clearQueue();
    g.advanceBaseTick();
    return g;
  };

  for (const e of tasks.filter((x) => x.cls === "secure" && x.template !== "secure.sign")) {
    const tpmNeed = taskNeeds(e).find((n): n is Extract<Need, { kind: "tpm" }> => n.kind === "tpm");
    const tier = tpmNeed?.minTier ?? 1;
    it(`${e.id} (${e.template}) runs and is paid with a TPM of tier ${tier}`, () => {
      const g = withTpm(`tpm${tier}`);
      expect(g.spawnKey(e.template, e.scale ?? 2).ok).toBe(true);
      expect(g.snapshot().tray[0]).toMatchObject({ type: e.id, cls: "secure", runnable: true });
      const op = new Operator(g, 1);
      let ticks = 0;
      while (g.completed < 1 && ticks < 3000) { g.advanceBaseTick(); op.step(); ticks++; }
      expect(g.completed, e.id).toBe(1);
      expect(g.errors).toBe(0);
      expect(g.snapshot().dex!.find((d) => d.id === e.id)).toMatchObject({ state: "done", runs: 1 });
    }, 60_000);
  }

  it("the attestation burst is refused with the first module and runs with the second", () => {
    const g = withTpm("tpm1");
    g.spawnKey("secure.attest", 2);
    expect(g.snapshot().tray[0]).toMatchObject({ runnable: false, missing: ["a second-generation TPM (Secure module 2)"], needs: ["TPM 2", "ECC"] });
  });
});

describe("the network jobs travel over the link, each with its own sizes and the plan it wants", () => {
  const offer = (g: Game, template: string, scale: number) => (g as unknown as { enqueue(t: string, s: number, c: string, n: boolean): boolean }).enqueue(template, scale, "web", true);

  it("a page is offered, downloaded, run, uploaded at its own size, and paid", () => {
    const g = netRig("ssd1");
    expect(offer(g, "web.page", 2)).toBe(true);
    expect(g.snapshot().net.offers[0]).toMatchObject({ type: "page", cls: "web", runnable: true });
    const up = new Set<number>();
    for (let t = 0; t < 3000 && g.completed < 1; t++) {
      g.advanceBaseTick();
      for (const x of g.snapshot().net.transfers) if (x.dir === "up") up.add(x.totalMB);
    }
    expect(g.completed).toBe(1);
    expect([...up]).toEqual([WEB_SIZES.page!.upMB]);
    expect(g.snapshot().jobLog![0]).toMatchObject({ type: "page", outcome: "done" });
  });

  it("a kind that wants a faster plan is refused on a slower one, and runnable on a faster one", () => {
    const slow = netRig("ssd1", { isp: "isp1" });
    offer(slow, "web.search", 2);
    expect(slow.snapshot().net.offers[0]).toMatchObject({ type: "search", runnable: false, missing: ["a Cable plan or better"], needs: ["NET 2"] });
    const fast = netRig("ssd1", { isp: "isp2", router: "router2" });
    offer(fast, "web.search", 2);
    expect(fast.snapshot().net.offers[0]).toMatchObject({ type: "search", runnable: true });
  });

  it("every network kind has its sizes, and the slower leg of a kind that asks for the first plan fits its first plan", () => {
    for (const e of tasks.filter((x) => x.cls === "web")) {
      const z = WEB_SIZES[e.id]!;
      expect(z, e.id).toBeDefined();
      const tier = taskNeeds(e)[0] && taskNeeds(e)[0]!.kind === "net" ? (taskNeeds(e)[0] as { minTier?: number }).minTier ?? 1 : 1;
      const plan = [0, { down: 50, up: 10 }, { down: 200, up: 50 }, { down: 1000, up: 300 }][tier] as { down: number; up: number };
      const ticks = Math.max(z.downMB / (plan.down / 8), z.upMB / (plan.up / 8));
      expect(ticks, `${e.id} on plan ${tier}`).toBeLessThan(120);
    }
  });
});
