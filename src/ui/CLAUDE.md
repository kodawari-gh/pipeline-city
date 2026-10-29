# src/ui
- Preact panels; read signals from `src/game`, send actions as `ToSim` messages. No sim imports beyond types.
- Every size is relative (rem, em, %, clamp). `scaling.test.ts` must stay green.
- Layout: `panels/`, `shop/`, `tutorial/`, `kit/` (icons, meter, sprite, hover); shared state, logic and `ui.css` (80 KB, Grep the selector) at the root.
- Docs: `docs/UI.md` (47 KB: Grep `^## ` and Read one section).
- Test the file you touched: `npx vitest run src/ui/<area>/<name>.test.ts`.
