# Pipeline City

An incremental game about building computing hardware. This glossary holds the words the game, the code and the design docs use for the same thing.

## Language

### Clock

**Pause**:
The player stopped the clock, with the HUD or Space. Only the player lifts it; the rail shows "Paused".
_Avoid_: stop, freeze

**Hold**:
A level-up popup, a tutorial popup or the in-game menu stops the clock. The player cannot lift it from the HUD. Closing the last holder resumes the clock, unless the player had paused first; the rail shows "Held".
_Avoid_: popup pause, menu pause

### Saves

**Previous save**:
A copy of the autosave, made before New game overwrites it. The main menu offers it as one row, only while it exists.
_Avoid_: backup slot, undo

### In-game UI

**Edge tab**:
An in-game panel that touches a screen edge, so the scene stays visible around it.
_Avoid_: glass panel (the older in-game look, see ADR 0001)
