import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// 使用说明书（docs/user/quick-start-guide.html）是随仓库分发的单一事实来源，
// 应用内帮助弹窗通过 iframe 以 ./guide/quick-start-guide.html 加载它：
// 开发态由 dev server 中间件实时伺服，构建期原样拷贝进 dist/guide/。
function guideAsset(): Plugin {
  const sourcePath = () => path.resolve('docs/user/quick-start-guide.html');
  return {
    name: 'guide-asset',
    configureServer(server) {
      server.middlewares.use('/guide/quick-start-guide.html', (_req, res) => {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        fs.createReadStream(sourcePath()).pipe(res);
      });
    },
    closeBundle() {
      const outDir = path.resolve('dist/guide');
      fs.mkdirSync(outDir, { recursive: true });
      fs.copyFileSync(sourcePath(), path.join(outDir, 'quick-start-guide.html'));
    }
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), guideAsset()],
  server: {
    port: 5174,
    strictPort: true
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
