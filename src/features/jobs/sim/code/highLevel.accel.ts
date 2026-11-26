// The Accelerators jobs as a person would write them (`HIGH_LEVEL` in highLevel.ts), in C++ and in Python.

import type { HighLevel } from './types';

export const ACCEL_HIGH_LEVEL: Record<string, HighLevel> = {
  vadd: {
    cpp: `// gpu.vadd (brightness): a 64 x 40 picture, a few frames; each frame adds a level to the scene and clamps to 0..255
#include <cstdint>
int tri(int a) { int v = (a & 63) - 32; return v < 0 ? -v : v; }
int scene(int i, int phase) {                      // three moving triangle waves: a plasma
    int x = i & 63, y = i >> 6;
    return 2 * (tri(2 * y - phase) + tri(3 * x + phase) + tri(x + y + 2 * phase));
}
void vadd(int32_t* out, int phase, int level) {
    for (int i = 0; i < 64 * 40; i++) {            // on the card: one pixel per lane, lanes pixels at a time
        int v = scene(i, phase) + level;           // the level goes from dark to bright over the frames
        out[i] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
}`,
    python: `# gpu.vadd (brightness): a 64 x 40 picture, a few frames; each frame adds a level to the scene and clamps to 0..255
def tri(a):
    return abs((a & 63) - 32)
def scene(i, phase):                               # three moving triangle waves: a plasma
    x, y = i & 63, i >> 6
    return 2 * (tri(2 * y - phase) + tri(3 * x + phase) + tri(x + y + 2 * phase))
def vadd(phase, level):
    return [max(0, min(255, scene(i, phase) + level)) for i in range(64 * 40)]   # on the card: one pixel per lane`,
  },
  saxpy: {
    cpp: `// gpu.saxpy (contrast): each frame stretches the scene away from mid-grey by a growing gain
#include <cstdint>
int scene(int i, int phase);                       // the plasma, as in gpu.vadd
void saxpy(int32_t* out, int phase, int gain) {
    for (int i = 0; i < 64 * 40; i++) {
        int v = (((scene(i, phase) - 96) * gain) >> 3) + 96;   // a multiply around the middle grey: gain / 8
        out[i] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
}`,
    python: `# gpu.saxpy (contrast): each frame stretches the scene away from mid-grey by a growing gain
def saxpy(phase, gain):                            # scene() is the plasma, as in gpu.vadd
    return [max(0, min(255, (((scene(i, phase) - 96) * gain) >> 3) + 96)) for i in range(64 * 40)]   # one multiply per pixel`,
  },
  thresh: {
    cpp: `// gpu.thresh (a computer-vision mask): white where the scene is brighter than the level, black elsewhere; the level rises each frame
#include <cstdint>
int scene(int i, int phase);                       // the plasma, as in gpu.vadd
void thresh(int32_t* out, int phase, int level) {
    for (int i = 0; i < 64 * 40; i++)
        out[i] = scene(i, phase) >= level ? 255 : 0;   // on the card: an if and an else under the lane mask, so lanes take turns
}`,
    python: `# gpu.thresh (a computer-vision mask): white where the scene is brighter than the level, black elsewhere; the level rises each frame
def thresh(phase, level):                          # scene() is the plasma, as in gpu.vadd
    return [255 if scene(i, phase) >= level else 0 for i in range(64 * 40)]   # on the card: an if and an else under the lane mask`,
  },
  blur3: {
    cpp: `// gpu.blur3: every pixel becomes the average of the scene a few steps either side of it; the blur widens each frame
#include <cstdint>
int scene(int i, int phase);                       // the plasma, as in gpu.vadd
void blur3(int32_t* out, int phase, int width) {
    for (int i = 0; i < 64 * 40; i++) {
        int sum = scene(i - width, phase) + scene(i, phase) + scene(i + width, phase);   // three evaluations per pixel
        out[i] = (uint32_t)(sum * 21846) >> 16;    // a multiply by 1/3 in fixed point
    }
}`,
    python: `# gpu.blur3: every pixel becomes the average of the scene a few steps either side of it; the blur widens each frame
def blur3(phase, width):                           # scene() is the plasma, as in gpu.vadd
    return [((scene(i - width, phase) + scene(i, phase) + scene(i + width, phase)) * 21846 & 0xFFFFFFFF) >> 16 for i in range(64 * 40)]   # a multiply by 1/3 in fixed point`,
  },
  poly: {
    cpp: `// gpu.poly (a tone curve): each frame blends the scene with its own square, darkening the midtones more
#include <cstdint>
int scene(int i, int phase);                       // the plasma, as in gpu.vadd
void poly(int32_t* out, int phase, int level) {
    for (int i = 0; i < 64 * 40; i++) {
        int v = scene(i, phase);
        out[i] = (v * (256 - level) + ((v * v >> 8) * level)) >> 8;   // a line blended toward a parabola
    }
}`,
    python: `# gpu.poly (a tone curve): each frame blends the scene with its own square, darkening the midtones more
def poly(phase, level):                            # scene() is the plasma, as in gpu.vadd
    out = []
    for i in range(64 * 40):
        v = scene(i, phase)
        out.append((v * (256 - level) + ((v * v >> 8) * level)) >> 8)   # a line blended toward a parabola
    return out`,
  },
  mandel: {
    cpp: `// gpu.mandel: how long each point of a 64 x 40 picture takes to escape; the iteration budget grows each frame
#include <cstdint>
int mandel_point(int32_t cx, int32_t cy, int budget) {   // Q12 fixed point
    int32_t zr = 0, zi = 0; int count = 0;
    while (count < budget) {
        int32_t zr2 = (zr * zr) >> 12, zi2 = (zi * zi) >> 12;
        if (((zr2 + zi2) >> 14) != 0) break;           // escaped: lanes leave the loop at different times
        zi = ((zr * zi) >> 11) + cy;
        zr = zr2 - zi2 + cx;
        count++;
    }
    return count << 4;                                 // drawn brighter the longer it took
}`,
    python: `# gpu.mandel: how long each point of a 64 x 40 picture takes to escape; the iteration budget grows each frame
def mandel_point(cx, cy, budget):                      # Q12 fixed point
    zr = zi = count = 0
    while count < budget:
        zr2, zi2 = (zr * zr) >> 12, (zi * zi) >> 12
        if (zr2 + zi2) >> 14:                          # escaped: lanes leave the loop at different times
            break
        zi = ((zr * zi) >> 11) + cy
        zr = zr2 - zi2 + cx
        count += 1
    return count << 4                                  # drawn brighter the longer it took`,
  },
  sphere: {
    cpp: `// gpu.sphere: one point of a 64 x 40 picture, two rows of four checkered balls (16 x 20 points each), lit from the upper left
#include <cstdint>
int ball_pixel(int col, int row, int phase) {
    int band = (row * 205) >> 12, r = row - 20 * band;   // which row of balls: row / 20 without a divide
    int x = 2 * (col & 15) - 15, y = ((2 * r - 19) * 205) >> 8;   // the point's place on its ball
    int d2 = x * x + y * y, h = 225 - d2;
    if (h <= 0) return 0;                              // off the ball: dark
    int s = x + ((x * d2) >> 8) + phase + ((col >> 4) + 2 * band) * 21;   // the checker slides faster toward the rim, and each ball is turned differently
    int chk = ((s >> 3) ^ (y >> 3)) & 1;
    return 40 + 36 * chk - x - y + (h >> 2);           // square colour, the light from the corner, brightest at the middle
}`,
    python: `# gpu.sphere: one point of a 64 x 40 picture, two rows of four checkered balls (16 x 20 points each), lit from the upper left
def ball_pixel(col, row, phase):
    band = (row * 205) >> 12                           # row // 20 without a divide
    r = row - 20 * band
    x, y = 2 * (col & 15) - 15, ((2 * r - 19) * 205) >> 8   # the point's place on its ball
    d2 = x * x + y * y
    h = 225 - d2
    if h <= 0:
        return 0                                       # off the ball: dark
    s = x + ((x * d2) >> 8) + phase + ((col >> 4) + 2 * band) * 21   # the checker slides faster toward the rim, and each ball is turned differently
    chk = ((s >> 3) ^ (y >> 3)) & 1
    return 40 + 36 * chk - x - y + (h >> 2)            # square colour, the light from the corner, brightest at the middle`,
  },
  perceptron: {
    cpp: `// npu.perceptron: one dense layer, X <- relu(W X + b), over an 8x8 batch
#include <cstdint>
void layer(const int32_t W[8][8], const int32_t b[8], const int32_t X[8][8], int32_t out[8][8]) {
    for (int s = 0; s < 8; s++)                       // each sample of the batch
        for (int o = 0; o < 8; o++) {
            int32_t acc = b[o];
            for (int i = 0; i < 8; i++) acc += W[o][i] * X[s][i];   // 512 multiply-adds in all: the NPU does a grid of them at once
            out[s][o] = acc > 0 ? acc : 0;             // relu
        }
}`,
    python: `# npu.perceptron: one dense layer, X <- relu(W X + b), over an 8x8 batch
def layer(W, b, X):
    return [[max(0, b[o] + sum(W[o][i] * x[i] for i in range(8))) for o in range(8)] for x in X]   # the NPU does a grid of multiply-adds at once`,
  },
  deep: {
    cpp: `// npu.deep: six dense layers one after the other, each on the last one's output
#include <cstdint>
void layer(const int32_t W[8][8], const int32_t b[8], const int32_t X[8][8], int32_t out[8][8]);   // as in the perceptron
void deep(const int32_t W[6][8][8], const int32_t b[6][8], int32_t X[8][8], int32_t scratch[8][8]) {
    for (int l = 0; l < 6; l++) {                      // a layer needs the one before it: six launches on a GPU, one descriptor list on an NPU
        layer(W[l], b[l], X, scratch);
        for (int s = 0; s < 8; s++) for (int o = 0; o < 8; o++) X[s][o] = scratch[s][o];
    }
}`,
    python: `# npu.deep: six dense layers one after the other, each on the last one's output
def deep(layers, X):
    for W, b in layers:                                # a layer needs the one before it: six launches on a GPU, one descriptor list on an NPU
        X = [[max(0, b[o] + sum(W[o][i] * x[i] for i in range(8))) for o in range(8)] for x in X]
    return X`,
  },
  npu: {
    cpp: `// npu.infer: dense layers X <- relu(W X + b) over an 8x8 batch (shown: the CPU path)
#include <cstdint>
void layer(const int32_t* W, const int32_t* X, int32_t* Y, const int32_t* b) {
    for (int r = 0; r < 8; r++)
        for (int c = 0; c < 8; c++) {
            int32_t acc = b[r];
            for (int k = 0; k < 8; k++) acc += W[r * 8 + k] * X[k * 8 + c];   // 512 multiplies a layer
            Y[r * 8 + c] = acc > 0 ? acc : 0;                                  // relu
        }
}`,
    python: `# npu.infer: dense layers X <- relu(W X + b) over an 8x8 batch (shown: the CPU path)
def layer(W, X, b):
    return [[max(0, b[r] + sum(W[r][k] * X[k][c] for k in range(8)))   # 512 multiplies a layer
             for c in range(8)] for r in range(8)]`,
  },
};
