"""Coverage check for in-game screens (ACCEPTANCE.md section 5).

Usage: python3 coverage.py with-ui.png without-ui.png [--dilate 12] [--threshold 6]
Both screenshots must show the same frame (pause the game). Prints the unobstructed share of the screen in %.
A pixel is covered when any channel differs by more than the threshold; the covered mask is then grown by the
dilation radius (a square of side 2r+1) so gaps inside text and between rail items count as covered.
Needs Pillow and NumPy.
"""
import argparse
import numpy as np
from PIL import Image

def unobstructed(ui_path: str, noui_path: str, dilate: int = 12, threshold: int = 6) -> float:
    a = np.asarray(Image.open(ui_path).convert('RGB'), dtype=np.int16)
    b = np.asarray(Image.open(noui_path).convert('RGB'), dtype=np.int16)
    if a.shape != b.shape:
        raise SystemExit(f'size mismatch: {a.shape} vs {b.shape}')
    covered = np.abs(a - b).max(-1) > threshold
    if dilate > 0:
        # separable max filter via cumulative sums (no SciPy needed)
        def grow(m, axis):
            c = np.cumsum(np.pad(m.astype(np.int32), [(dilate + 1, dilate) if i == axis else (0, 0) for i in range(2)]), axis=axis)
            hi = np.take(c, range(2 * dilate + 1, c.shape[axis]), axis=axis)
            lo = np.take(c, range(0, c.shape[axis] - 2 * dilate - 1), axis=axis)
            return (hi - lo) > 0
        covered = grow(grow(covered, 0), 1)
    return round(100.0 * (1 - covered.mean()), 1)

if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('ui'); p.add_argument('noui')
    p.add_argument('--dilate', type=int, default=12); p.add_argument('--threshold', type=int, default=6)
    a = p.parse_args()
    print(f'unobstructed {unobstructed(a.ui, a.noui, a.dilate, a.threshold)} %')
