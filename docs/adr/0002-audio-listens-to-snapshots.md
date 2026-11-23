# Audio listens to snapshots; the sim stays silent

All audio runs on the main thread and only reads: the `snapshot`, its log notes, and a few UI signals. The worker and the sim carry no sound ids and import nothing audio. A cue is chosen by the log note's kind plus a regex on its text (`mix-tokens.json` `logRules`), and by state rules that compare two snapshots. A guard test lists every `.note(kind, text)` call site and the cue it gets, so a new or reworded note fails the test instead of going silent.

## Considered Options

- **Tag notes in the sim** (`Game.note(kind, text, cue?)`): sturdier against rewording. Rejected for now: it touches about 63 call sites in `features/*/sim`, which other sessions edit, and it puts sound knowledge in the sim. Revisit if the guard test keeps failing on prose changes.

## Consequences

- Rewording a note text can change its cue. The guard test is the safety net.
- The audio package needs no change to the sim, the protocol or the save.
