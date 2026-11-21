# Reference material (lower precedence than SPEC.md and the mocks)

- `renders-r3/`: layout renders of 07 to 12 at 1920 × 1080 and 530 × 1080 (1:1 CSS px), drawn by the Art Director to check the r3 layout. Not mocks: typography and the scene are approximate. Use them until the v3 mocks arrive in `../mocks/`.
- `before-after/`: v2 mock next to the r3 render, per in-game screen, with coverage numbers.
- `coverage-table.md`: the measured coverage, navy share and cyan share before and after r3.
- `coverage.py`: the coverage check used in ACCEPTANCE.md §5.
- `build-camera-framing.md`: how the Build camera was reframed at runtime for the v2 capture, and how a real implementation should add stage insets. Its inset numbers are the v2 layout; r3 uses the ones in IMPLEMENTATION.md step 7.
- `renderer-r3/`: the Python source that drew `renders-r3/` (exact r3 coordinates in code form). It points at files on the design machine, so it will not run as is; read it for numbers if SPEC.md is unclear.
