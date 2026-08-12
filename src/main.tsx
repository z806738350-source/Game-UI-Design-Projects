import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles.css';

class RenderBoundary extends React.Component<React.PropsWithChildren, { error: string }> {
  state = { error: '' };

  static getDerivedStateFromError(cause: unknown) {
    return { error: cause instanceof Error ? cause.message : String(cause) };
  }

  componentDidCatch(cause: unknown, info: React.ErrorInfo) {
    console.error('Renderer recovered from a fatal view error', cause, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <main className="fatal-screen">
      <div>
        <span>界面恢复保护</span>
        <h1>这条项目数据暂时无法显示</h1>
        <p>应用没有退出，原始项目文件也不会被修改。请重新加载；若问题持续，可将下方信息交给开发人员排查。</p>
        <code>{this.state.error}</code>
        <button onClick={() => window.location.reload()}>重新加载界面</button>
      </div>
    </main>;
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RenderBoundary><App /></RenderBoundary>
  </React.StrictMode>
);
