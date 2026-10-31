# src/core/ui and src/features/*/ui
- Preact panels; read signals from `src/app`, send actions as `ToSim` messages. No sim imports beyond types.
- Every size is relative (rem, em, %, clamp). `scaling.test.ts` must stay green.
- Shared UI here: `kit/` (icons, meter, sprite, hover), state, logic, Hud, Toasts and `ui.css` (80 KB, Grep the selector). Feature panels live in `src/features/<f>/ui/` (shop and levels in `economy`, tutorial in `tutorial`).
- Docs: `docs/UI.md` (47 KB: Grep `^## ` and Read one section).
- Test the file you touched: `npx vitest run src/features/<f>/ui/<name>.test.ts`.
