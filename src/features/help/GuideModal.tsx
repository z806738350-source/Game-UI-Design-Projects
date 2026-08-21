import { ExternalLink, X } from 'lucide-react';

// 使用说明书弹窗：iframe 内嵌 docs/user/quick-start-guide.html
// （开发态由 Vite 中间件伺服，构建期拷贝进 dist/guide/，见 vite.config.ts 的 guideAsset 插件）。
// 说明书保持独立 HTML 单一事实来源，其样式与标签页脚本在 frame 文档内自治，
// 与应用样式互不污染；「在系统浏览器中打开」作为打印/分享与失败兜底的降级路径保留。
export function GuideModal({ onClose, onOpenExternal }: { onClose: () => void; onOpenExternal: () => void }) {
  return <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="utility-dialog utility-dialog--guide" role="dialog" aria-modal="true" aria-label="使用说明书">
      <header>
        <div><h2>使用说明书</h2><p>快速上手、路线选择、五阶段详解、资产与绑定、概念边界与常见问题。</p></div>
        <div className="guide-dialog-actions">
          <button className="icon-button" title="在系统浏览器中打开" aria-label="在系统浏览器中打开" onClick={onOpenExternal}><ExternalLink size={16} /></button>
          <button className="icon-button" onClick={onClose} aria-label="关闭"><X size={18} /></button>
        </div>
      </header>
      <iframe className="guide-frame" src="./guide/quick-start-guide.html" title="使用说明书内容" />
    </section>
  </div>;
}
