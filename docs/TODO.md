# TODO

Source of truth for tasks in this repository.

## Rules for every task

- One task = one commit, touching only the paths listed in `Files`. Stage with `git add <paths>`, never `git add -A`.
- `npm test` and `npm run build` must both pass before the commit. If they cannot, change nothing and say why in one line.
- Read the task's `Docs`, not the whole repo.
- UI code: every size is relative (rem, em, %, clamp). `src/core/ui/scaling.test.ts` must stay green.
- Use the Edit tool, never rewrite a file from a script.
- When done, delete the task's line.

## Tags

- `[auto]` an unattended session can finish and verify it with tests and the build.
- `[owner]` needs a decision from the owner first. Never run unattended.
- `[~]` instead of `[ ]`: waiting on the owner.

Line format (the script matches `^- \[ \] <ID> `): `- [ ] ID [tag] Title. Files: ... Docs: ... Done when: ...`

## Open now

Menu review (`docs/MENU_REVIEW.md`): one menu per task, shot before and after.

## 3D render: one light, one palette, one level of detail

From the 2026-11-05 survey of the `?3d` room. The owner's goal: uniformity above all (one palette, one level of detail, one light across the room, its props and the view out). Run the tasks in this order. Shoot with `npm run shot -- <png> --3d --size 1920x1080 --hour h --look x,y,z,yaw,pitch,height` (or `--view room`); the rects below assume 1920x1080. L is the mean linear luminance that `node tools/lum.mjs <png> x,y,w,h` prints. Look at each shot before you call a task done.

## Design notes (no code)

