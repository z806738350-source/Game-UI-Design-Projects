import { useEffect, useRef } from 'react';
import type { Artifact } from '../../types';

type Layer = Record<string, unknown> & { type: string; rect?: number[]; asset_path?: string; content?: string; typography?: Record<string, unknown> };

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error(`Unable to load composition asset: ${source}`)); image.src = source;
  });
}

export function CanvasCompositor({ manifest, resolveAsset, onRendered }: { manifest: Artifact; resolveAsset: (path: string) => string; onRendered?: (png: Blob) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false;
    const render = async () => {
      const canvas = ref.current; if (!canvas) return;
      const size = manifest.canvas as number[]; canvas.width = size[0]; canvas.height = size[1];
      const context = canvas.getContext('2d'); if (!context) return;
      const underlay = manifest.underlay as { image_url?: string; path?: string };
      const underlaySource = underlay.image_url || (underlay.path ? resolveAsset(underlay.path) : '');
      if (underlaySource) context.drawImage(await loadImage(underlaySource), 0, 0, canvas.width, canvas.height);
      for (const layer of manifest.layers as Layer[]) {
        if (cancelled) return;
        const [x, y, width, height] = (layer.rect || [0, 0, 1, 1]).map((value, index) => value * (index % 2 === 0 ? canvas.width : canvas.height));
        if (layer.type === 'component' && layer.asset_path) context.drawImage(await loadImage(resolveAsset(layer.asset_path)), x, y, width, height);
        if (layer.type === 'text' && layer.content) {
          const token = layer.typography || {}; const size = Number(token.size || 24); const weight = Number(token.weight || 400);
          context.font = `${weight} ${size}px ${String(token.family || 'sans-serif')}`; context.textAlign = 'center'; context.textBaseline = 'middle';
          const shadow = token.shadow as Record<string, unknown> | undefined;
          if (shadow) { context.shadowOffsetX = Number(shadow.offset_x || 0); context.shadowOffsetY = Number(shadow.offset_y || 0); context.shadowBlur = Number(shadow.blur || 0); context.shadowColor = String(shadow.color || 'transparent'); }
          const stroke = token.stroke as Record<string, unknown> | undefined;
          if (stroke && Number(stroke.width) > 0) { context.lineWidth = Number(stroke.width); context.strokeStyle = String(stroke.color || '#000'); context.strokeText(layer.content, x + width / 2, y + height / 2); }
          context.fillStyle = String(token.fill || '#fff'); context.fillText(layer.content, x + width / 2, y + height / 2);
          context.shadowColor = 'transparent';
        }
        if (layer.type === 'watermark') { context.fillStyle = 'rgba(180,0,0,.72)'; context.font = '700 18px sans-serif'; context.fillText(layer.content || 'PREVIEW', 20, canvas.height - 24); }
      }
      if (!cancelled && onRendered) canvas.toBlob((blob) => { if (blob) onRendered(blob); }, 'image/png');
    };
    void render(); return () => { cancelled = true; };
  }, [manifest, resolveAsset, onRendered]);
  return <canvas ref={ref} aria-label="确定性 UI 合成预览" />;
}
