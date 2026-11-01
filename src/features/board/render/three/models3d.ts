// The parts that wear a glTF model (`core/render/three/gltf.ts`), by the spec's `visual` or else its kind: a file under `public/models/` (written by
// a tool script), served at `./models/<file>`. `stretch`: the model fills its socket's rect in x and y. A part not listed is built from
// primitives (machine3d.ts), and a model that fails to load changes nothing.
export const MODEL_FILES: Readonly<Record<string, { file: string; stretch?: boolean }>> = {
};

/** The model for a part, or null. */
export const modelOf = (visual: string, kind: string): { url: string; stretch: boolean } | null => {
  const m = MODEL_FILES[visual] ?? MODEL_FILES[kind];
  return m ? { url: `${import.meta.env.BASE_URL}models/${m.file}`, stretch: !!m.stretch } : null;
};
