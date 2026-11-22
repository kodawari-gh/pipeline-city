---
status: accepted
---
# In-game UI uses neutral edge tabs, not glass

The HUD, Build my PC, Gallery and the in-game menu leave the "dark glass" look of `docs/art-style.md` and `docs/UI.md`. They become small neutral tabs at the screen edges, with ramps instead of blur and vignette. The scene stays visible: HUD coverage rises from about 64% to 90%. We accept two UI languages for a while, because the owner approved the menu mocks. `art-style.md` and `UI.md` change in the same PR as the code. The Build rim light stays cool; the package's warmer `0xc8d0e0` is rejected.

## Consequences
Shop, Almanac, Log, OS, the level-up card and the picker card stay out of scope and keep glass. The game shows two looks until each panel gets its own restyle task in `docs/TODO.md`; the restyle does not block the HUD.

## Considered options
- Keep glass in game and use the new look only in menus. Rejected: the glass panels cover the scene the player is building.
- Warm the rim light so the part stops reading blue. Rejected: `art-style.md` fixes a cool key light with a neon rim.
