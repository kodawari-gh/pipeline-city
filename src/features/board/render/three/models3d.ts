// The parts that wear a glTF model (`core/render/three/gltf.ts`), by the spec's `visual` or else its kind: a file under `public/models/`, served at
// `./models/<name>.glb`. Empty: every part is built from primitives (machine3d.ts) until a model is added here, and a model that fails to load changes nothing.
export const MODEL_FILES: Readonly<Record<string, string>> = {};

/** The url of the model for a part, or null. */
export const modelUrl = (visual: string, kind: string): string | null => {
  const f = MODEL_FILES[visual] ?? MODEL_FILES[kind];
  return f ? `${import.meta.env.BASE_URL}models/${f}` : null;
};
