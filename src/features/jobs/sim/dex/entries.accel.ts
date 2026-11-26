// The almanac's Accelerators entries (the `accel` group of `DEX_GROUPS` in catalog.ts), in the order the collection shows them.

import type { DexEntry } from './types';

export const ACCEL_ENTRIES: readonly DexEntry[] = [
  {
    id: 'vadd',
    name: 'Brightness',
    cls: 'gpu',
    template: 'gpu.vadd',
    level: 10,
    scale: 4,
    boost: 'GPU: about 5x faster',
    blurb:
      'Brighten or darken a 64 x 40 picture by adding a number to every pixel, over several frames (the display plays them as they are drawn): the same simple step on every lane.',
    stresses: ['a GPU (lanes)', 'CPU copy speed'],
    footprint: 'no input: the picture is drawn from the element number',
    tips: [
      {
        part: 'gpu',
        short: 'More lanes',
        text: 'Every pixel is worked on its own with the same steps: twice the lanes draws the picture in about half the time.',
      },
      {
        part: 'gpu',
        short: 'No card, slow path',
        text: 'Without a card the CPU does the 2,560 pixels of every frame one after another, for the same pay: a card is how you stop losing time on these.',
      },
      {
        part: 'gpu',
        short: 'Card memory',
        text: 'The picture is 10 KB: every card holds it, but a card with less than that would fall back to the CPU.',
      },
    ],
  },
  {
    id: 'saxpy',
    name: 'Contrast',
    cls: 'gpu',
    template: 'gpu.saxpy',
    level: 10,
    scale: 4,
    boost: 'GPU: about 5x faster',
    blurb:
      'Stretch the picture away from mid-grey: subtract the middle, multiply by a gain, add it back and clamp, with the gain growing from frame to frame.',
    stresses: ['a GPU (lanes)', 'the multiplier'],
    footprint: 'no input: the picture is drawn from the element number',
    tips: [
      {
        part: 'gpu',
        short: 'More lanes',
        text: 'Every pixel is worked on its own with the same steps: twice the lanes draws the picture in about half the time.',
      },
      {
        part: 'gpu',
        short: 'No card, slow path',
        text: 'Without a card the same work runs on the CPU, slower, for the same pay.',
      },
      {
        part: 'clock',
        short: 'CPU only launches',
        text: 'On a card the CPU does nothing but copy the kernel in and launch each frame: a faster CPU shortens only that.',
      },
    ],
  },
  {
    id: 'thresh',
    name: 'Threshold',
    cls: 'gpu',
    template: 'gpu.thresh',
    level: 11,
    scale: 4,
    boost: 'GPU: about 4x faster',
    blurb:
      'A computer-vision step: turn each pixel white if it is brighter than a level and black if not, and raise the level frame by frame so the mask shrinks to the brightest shapes. An if and an else on every pixel.',
    stresses: ['a GPU (lanes)', 'branches'],
    footprint: 'no input: the picture is drawn from the element number',
    tips: [
      {
        part: 'gpu',
        short: 'Lanes take turns',
        text: 'On a card the lanes that took the if run first and the others wait for the else, so some lanes are idle at any moment: more lanes still help, but less than for a plain add.',
      },
      {
        part: 'gpu',
        short: 'No card, slow path',
        text: 'Without a card the CPU tests the pixels one after another, for the same pay.',
      },
      {
        part: 'clock',
        short: 'CPU launches only',
        text: 'The CPU only copies the kernel in and starts each frame: a faster CPU shortens just that.',
      },
    ],
  },
  {
    id: 'blur3',
    name: 'Blur',
    cls: 'gpu',
    template: 'gpu.blur3',
    level: 11,
    scale: 4,
    boost: 'GPU: about 8x faster',
    blurb:
      'Soften the picture: every pixel becomes the average of the pixels a few steps either side of it, and the blur widens frame by frame. Three shaded reads and a multiply for each one.',
    stresses: ['a GPU (lanes)', 'card memory banks'],
    footprint: 'no input: the picture is drawn from the element number',
    tips: [
      {
        part: 'gpu',
        short: 'More lanes',
        text: 'Every pixel is worked on its own with the same steps: twice the lanes draws the picture in about half the time.',
      },
      {
        part: 'gpu',
        short: 'Heavy on the CPU',
        text: 'Each pixel takes three evaluations of the scene, so without a card this is the slowest of the picture jobs on the CPU.',
      },
      {
        part: 'bank',
        short: 'Card memory banks',
        text: 'Neighbouring lanes read neighbouring words: a card with more memory banks serves them in the same cycle.',
      },
    ],
  },
  {
    id: 'poly',
    name: 'Tone curve',
    cls: 'gpu',
    template: 'gpu.poly',
    level: 12,
    scale: 4,
    boost: 'GPU: about 5x faster',
    blurb:
      'Bend the brightness of the picture along a curve: blend each pixel with its own square, darkening the midtones more and more over the frames.',
    stresses: ['a GPU (lanes)', 'the multiplier'],
    footprint: 'no input: the picture is drawn from the element number',
    tips: [
      {
        part: 'gpu',
        short: 'More lanes',
        text: 'Every pixel is worked on its own with the same steps: twice the lanes draws the picture in about half the time.',
      },
      {
        part: 'gpu',
        short: 'No card, slow path',
        text: 'Without a card the same work runs on the CPU, slower, for the same pay.',
      },
      {
        part: 'clock',
        short: 'A higher card clock',
        text: "Every lane runs the same chain of multiplies: the card's own clock speeds the whole chain, and a card overclock pays here.",
      },
    ],
  },
  {
    id: 'mandel',
    name: 'Mandelbrot',
    cls: 'gpu',
    template: 'gpu.mandel',
    level: 13,
    scale: 4,
    boost: 'GPU: about 15x faster',
    blurb:
      "Colour each point of the plane by how long it takes to escape, and let the iteration budget grow frame by frame so the set's edge fills in: some points leave at once and some never do, so lanes finish at very different times.",
    stresses: ['a GPU (lanes)', 'divergence'],
    footprint: 'no input: the points come from the element number',
    tips: [
      {
        part: 'gpu',
        short: 'Card is a must',
        text: 'Without a card this runs the whole loop on the CPU, many times slower: the clients will take it back long before it is done.',
      },
      {
        part: 'gpu',
        short: 'More lanes',
        text: 'Many points run at once, but a chunk of lanes waits for its slowest point: more lanes still finish the picture sooner.',
      },
      {
        part: 'clock',
        short: 'A higher card clock',
        text: 'The card spends nearly all its time in the inner loop: its clock speeds that directly.',
      },
    ],
  },
  {
    id: 'sphere',
    name: 'Spinning balls',
    cls: 'gpu',
    template: 'gpu.sphere',
    level: 14,
    scale: 4,
    boost: 'GPU: about 7x faster',
    blurb:
      'Shade two rows of four checkered balls, one point at a time, and spin them over several frames (the display plays them as they are drawn): where each point sits on a ball decides how bright it is and which square it lands on. Every job has the balls turned a different way.',
    stresses: ['a GPU (lanes)', 'the multiplier'],
    footprint: 'no input: the picture comes from the element number',
    tips: [
      {
        part: 'gpu',
        short: 'More lanes',
        text: 'Every point is shaded on its own with the same steps, so lanes never wait for each other: twice the lanes draws the picture in about half the time.',
      },
      {
        part: 'gpu',
        short: 'Card is a must',
        text: 'Without a card the CPU shades the points one after another, many times slower, for the same pay.',
      },
      {
        part: 'clock',
        short: 'A higher card clock',
        text: "It is all multiplies and shifts, one after the other: the card's own clock speeds every step.",
      },
    ],
  },
  {
    id: 'npu',
    name: 'Inference',
    cls: 'npu',
    template: 'npu.infer',
    legacy: true,
    boost: 'NPU: about 8x faster',
    blurb: 'A few dense layers over a small batch with seeded weights.',
    stresses: ['an NPU (array size)', 'else a GPU', 'else the CPU'],
    footprint: 'a few hundred bytes to a few K of weights',
    tips: [
      {
        part: 'npu',
        short: 'NPU, GPU, then CPU',
        text: 'The program takes the best path it finds: the NPU, then a GPU (one launch per layer), then the CPU (a loop per layer). Each step down is much slower at the same pay.',
      },
      {
        part: 'npu',
        short: 'Grid fits the batch',
        text: "An NPU's grid has to divide the batch size and its memory has to hold the weights, or the job falls through to the next path.",
      },
    ],
  },
  {
    id: 'perceptron',
    name: 'Perceptron',
    cls: 'npu',
    template: 'npu.perceptron',
    level: 12,
    scale: 1,
    boost: 'NPU: about 4x faster',
    blurb: 'One dense layer over a small batch: 512 multiply-adds, the simplest thing a network does.',
    stresses: ['an NPU (array size)', 'else a GPU', 'else the CPU'],
    footprint: 'a few hundred bytes of weights',
    tips: [
      {
        part: 'npu',
        short: 'NPU, GPU, then CPU',
        text: 'The program takes the best path it finds: the NPU, then a GPU, then the CPU. A single layer is the job where the CPU path loses least (about four times slower than the NPU).',
      },
      {
        part: 'npu',
        short: 'Grid fits the batch',
        text: 'An NPU grid has to divide the batch size and its memory has to hold the weights, or the job falls through to the next path.',
      },
    ],
  },
  {
    id: 'deep',
    name: 'Deep network',
    cls: 'npu',
    template: 'npu.deep',
    level: 14,
    scale: 4,
    boost: 'NPU: about 9x faster',
    blurb: "Six dense layers one after the other: each needs the last one's answer, so nothing can start early.",
    stresses: ['an NPU (array size)', 'else a GPU', 'else the CPU'],
    footprint: 'a few K of weights',
    tips: [
      {
        part: 'npu',
        short: 'NPU, GPU, then CPU',
        text: 'The program takes the best path it finds. Each step down is much slower at the same pay: about nine times for the NPU against the CPU on six layers.',
      },
      {
        part: 'gpu',
        short: 'A launch per layer',
        text: 'On a GPU every layer is a separate launch, with the copy and the wait that come with it: an NPU runs all six from one list of descriptors.',
      },
      {
        part: 'npu',
        short: 'Grid fits the batch',
        text: 'An NPU grid has to divide the batch size and its memory has to hold all six layers of weights, or the job falls through to the next path.',
      },
    ],
  },
];
