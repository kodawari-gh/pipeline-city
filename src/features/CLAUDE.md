# src/features
One folder per feature: `cpu gpu npu tpm memory storage network os board economy jobs tutorial room sandbox`.
- Each has `sim/` (pure, worker), `render/` (Pixi), `ui/` (Preact) as needed, plus its doc (`GPU.md`, `OS.md`...) at the folder root.
- Shared code: `src/core/{sim,render,ui}`. Main thread: `src/app`. Worker entry and `Game` root: `src/worker`.
- Rules (checked by `src/architecture.test.ts`): `sim/` never imports `render/`, `ui/` or `app/`; `core/` should not import `features/` (about 80 known imports in the hubs `render/live`, `render/interact`, `sim/machine`, `ui/Hud`; the count may only fall).
