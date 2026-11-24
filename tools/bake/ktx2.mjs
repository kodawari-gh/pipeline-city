// A lightmap's bytes (RGBA8: RGBM, `rgbm.ts`) as a KTX2 file, for `bake.mjs` and `lightmaps.mjs` (`npm run bake:lm`). The Basis encoder is wasm
// (`ktx2-encoder`): no system tool. The file holds data, not a picture: linear, no mips, no flip (row 0 is the atlas's top, as the PNG's).
//   etc1s  (the default) 150 KB a map, a fifth of the PNG: the light is smooth, and a room shot differs from the PNG's by 0.2 of 255 (docs/render/load.md)
//   uastc  400 KB a map, a half of the PNG: the same shot differs by the same; for a light with hard edges, if a bake ever has one
// Both are one byte a texel on the GPU (BC7 or ASTC; ETC2 on a GPU with neither), a quarter of the PNG's.
import { encodeToKTX2 } from 'ktx2-encoder';

/** The options of each mode (`ktx2-encoder`'s names). */
const MODES = {
  uastc: { isUASTC: true, uastcLDRQualityLevel: 2, needSupercompression: true },
  etc1s: { isUASTC: false, qualityLevel: 255, compressionLevel: 3 },
};

/** The KTX2 file of `rgba` (width x height, 8 bits a channel, not premultiplied). */
export async function ktx2Of(rgba, width, height, mode = 'etc1s') {
  const say = console.log;
  console.log = () => {}; // (the encoder prints each slice)
  try {
    return await encodeToKTX2(new Uint8Array(4), {
      imageDecoder: async () => ({ width, height, data: rgba }),
      isKTX2File: true,
      generateMipmap: false,
      isYFlip: false,
      enableDebug: false,
      isPerceptual: false,
      isSetKTX2SRGBTransferFunc: false,
      ...MODES[mode],
    });
  } finally {
    console.log = say;
  }
}
