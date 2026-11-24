# Pipeline City

Incremental game about building computing hardware. This glossary fixes the words the game and its audio share. Add a term only when a decision settles its meaning.

## Language

### Game

**Job key**:
The removable key that carries one client's job to the machine. The player plugs it in, and it holds the result when the job is done.
_Avoid_: key (alone), USB key

**Level**:
The player's progress step. Each level plays in its own level key.
_Avoid_: tier, rank

**Log note**:
A line the simulation writes to the game log when something happens. It has a kind and a text. Audio reads log notes to fire cues.
_Avoid_: event, message, note (alone)

**Level-up popup**:
The popup that opens when a level is reached. It holds the clock until the player closes it.
_Avoid_: celebration, level-up (alone)

**Part**:
One piece of hardware the player installs in a slot of the machine: a CPU, a stick of RAM, a card, a drive, a cooler, a fan.
_Avoid_: device, component

### Clock

**Pause**:
The player stopped the clock, with the HUD or Space. Only the player lifts it; the rail shows "Paused".
_Avoid_: stop, freeze

**Hold**:
A level-up popup, a tutorial popup or the in-game menu stops the clock. The player cannot lift it from the HUD. Closing the last holder resumes the clock, unless the player had paused first; the rail shows "Held".
_Avoid_: popup pause, menu pause

### Studio

**Studio**:
Build my PC or the Gallery. It opens from the main menu, runs its own machine and has no level.
_Avoid_: mode, sandbox

**Step**:
One change the player made in Build my PC that Undo reverses: a part fitted or removed, an OS, router or plan item set, or a swap.
_Avoid_: action, move, edit

**Swap**:
A step that replaces the whole machine in Build my PC: a preset, a saved build, reset or clear.
_Avoid_: load, replace

**In the way**:
Said of a part that must come out so the player can reach another part or slot. It goes back after the step.
_Avoid_: blocker, obstacle

### Audio

**Audio package**:
The audio designer's handoff: sound files, specs, mix tokens and the code plan. It is the source of truth for what plays and how loud.
_Avoid_: audio pack, sound bank

**Mix tokens**:
The audio package's data file with every level, fade, limit and rate number. Code reads these numbers and hard-codes none.
_Avoid_: audio config, mix settings

**Cue**:
One named sound the game plays for one purpose (`payout`, `ui_click`). A cue has one or more files.
_Avoid_: sound effect, clip, sfx

**Pitched cue**:
A cue whose pitch follows the level key. Its files exist in a few render roots.
_Avoid_: tonal cue

**Fixed cue**:
A cue that never changes pitch: every UI cue, pause, resume, speed changes, key eject.

**State rule**:
A rule that fires a cue from the change between two snapshots, not from a log note (link up, POST, pause).
_Avoid_: snapshot rule

**Level key**:
The musical key a level plays in. Level 1 is F Lydian; each next level goes up a fifth. Pitched cues, the level-up stinger and the music follow it.
_Avoid_: key (alone), tonality, tonic

**Render root**:
One of the four level keys (F, Gs, B, D) in which pitched cues are rendered. Other level keys are reached by moving the pitch at most one semitone.
_Avoid_: base key

**Level-up stinger**:
The cue that plays once per level reached, in the new level key. The music adds its own key-change chord on the same beat, six decibels lower.
_Avoid_: level-up sound, fanfare

**Afterglow**:
The game's reactive music, direction B. It changes with the machine and the game state.
_Avoid_: soundtrack, BGM

**Stem**:
One looping layer of Afterglow (bed, pluck, bass, shimmer, stress, pausebed), rendered once per level key.
_Avoid_: track, layer

**Music note**:
A short chromatic one-shot the music adds on top of a cue. It is quieter than the cue it follows.
_Avoid_: note (alone), accent

**Ambience**:
The two background loops: room and city, and machine hum. The hum follows the machine's fan speed.
_Avoid_: background noise, atmosphere

### Saves

**Previous save**:
A copy of the autosave, made before New game overwrites it. The main menu offers it as one row, only while it exists.
_Avoid_: backup slot, undo

### In-game UI

**Edge tab**:
An in-game panel that touches a screen edge, so the scene stays visible around it.
_Avoid_: glass panel (the older in-game look, see ADR 0001)
