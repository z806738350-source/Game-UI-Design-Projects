import type { Artifact } from '../../types';

type CompositionOutputReference = {
  path?: string;
  hash?: string;
  width?: number;
  height?: number;
};

/**
 * Displays the authoritative PNG produced by the main-process renderer.
 * Pixel production deliberately does not run a second time in the browser:
 * exact, nine-slice, and vector-token dispatch live in compositionRenderer.cjs,
 * where the saved file and its hash are generated together.
 */
export function CanvasCompositor({ manifest, resolveAsset }: { manifest: Artifact; resolveAsset: (path: string) => string }) {
  const output = (manifest.output || {}) as CompositionOutputReference;
  if (!output.path) return <p role="status">Composition Manifest 尚未产生可验证的 PNG 输出。</p>;
  return <figure className="composition-output">
    <img
      src={resolveAsset(output.path)}
      width={output.width}
      height={output.height}
      alt="确定性 UI 合成输出"
    />
    <figcaption><code>{output.hash}</code></figcaption>
  </figure>;
}
