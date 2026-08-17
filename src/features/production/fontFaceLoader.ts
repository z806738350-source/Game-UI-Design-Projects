import { copilotApi } from '../../api';
import type { DesignProject } from '../../types';

type FontAsset = { id?: unknown; family_name?: unknown };
type FontRole = { font_id?: unknown; fidelity_mode?: unknown; identity_critical?: unknown };

export async function loadProjectExactFonts(project: DesignProject) {
  if (typeof FontFace === 'undefined' || !document.fonts) throw new Error('当前运行环境不支持 FontFace，不能生成 Final PNG。');
  const manifest = project.artifacts.fontManifest;
  const fonts = (manifest?.fonts as FontAsset[] | undefined) || [];
  const roles = (manifest?.roles as Record<string, FontRole> | undefined) || {};
  const loaded: Array<{ role: string; fontId: string; family: string; status: FontFaceLoadStatus }> = [];
  for (const [role, binding] of Object.entries(roles)) {
    if (binding.fidelity_mode !== 'exact') continue;
    const fontId = String(binding.font_id || '');
    const font = fonts.find((item) => String(item.id) === fontId);
    const family = String(font?.family_name || '').trim();
    if (!fontId || !family) throw new Error(`字体角色 ${role} 缺少可验证的字体身份。`);
    const bytes = await copilotApi.loadFontBytes(project.id, fontId);
    const face = new FontFace(family, bytes);
    await face.load();
    document.fonts.add(face);
    await document.fonts.ready;
    if (face.status !== 'loaded' || !document.fonts.check(`16px "${family.replaceAll('"', '\\"')}"`)) {
      throw new Error(`字体 ${family} 未被浏览器实际加载，不能生成 Final PNG。`);
    }
    loaded.push({ role, fontId, family, status: face.status });
  }
  if (!loaded.length) throw new Error('没有可实际加载的 exact 字体角色，不能生成 Final PNG。');
  return loaded;
}
