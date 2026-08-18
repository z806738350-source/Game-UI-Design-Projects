import { Archive, Copy, Plus, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { copilotApi } from '../../api';
import type { DesignProject } from '../../types';
import { friendlyError } from '../shared/ui';

// Screen isolation manager: multi-screen create/switch/rename/archive with its
// own error slot — screen operations never go through the stage run() banner.
export function ScreenManager({ project, busy, onProject }: { project: DesignProject; busy: boolean; onProject: (project: DesignProject) => void }) {
  const [name, setName] = useState('');
  const [rename, setRename] = useState('');
  const [archiveTarget, setArchiveTarget] = useState('');
  const [error, setError] = useState('');
  const screens = (project.screens || []).filter((screen) => screen.status !== 'archived');
  const active = screens.find((screen) => screen.id === project.screen_id);
  const archiveCandidates = screens.filter((screen) => screen.id !== project.screen_id);
  useEffect(() => { setRename(active?.name || ''); setArchiveTarget(archiveCandidates[0]?.id || ''); }, [project.screen_id, active?.name, screens.length]);
  const perform = async (task: () => Promise<unknown>, refresh = true) => {
    setError('');
    try {
      await task();
      if (refresh) onProject(await copilotApi.openProject(project.id));
    } catch (cause) { setError(friendlyError(cause)); }
  };
  return <section className="screen-manager" data-testid="screen-manager"><div><span>ACTIVE SCREEN</span><b>{active?.name || project.screen_id}</b><small>{screens.length} 个页面 · {project.requirement ? '独立需求已配置' : '等待独立需求'}</small></div>{error && <span className="inline-error" role="alert" data-testid="screen-manager-error">{error}</span>}<select disabled={busy} value={project.screen_id} onChange={(event) => perform(() => copilotApi.setActiveScreen(project.id, event.target.value), false).then(() => copilotApi.openProject(project.id).then(onProject))}>{screens.map((screen) => <option key={screen.id} value={screen.id}>{screen.name}</option>)}</select><input value={rename} onChange={(event) => setRename(event.target.value)} aria-label="当前页面名称" /><button disabled={busy || !rename.trim() || rename === active?.name} title="重命名当前页面" onClick={() => perform(() => copilotApi.updateScreen(project.id, project.screen_id, { name: rename }))}><Save size={14} /></button><input value={name} onChange={(event) => setName(event.target.value)} placeholder="新页面名称" /><button disabled={busy || !name.trim()} data-testid="screen-manager-create" title="创建独立页面" onClick={() => perform(() => copilotApi.createScreen(project.id, { name })).then(() => setName(''))}><Plus size={14} /></button><button disabled={busy} title="复制当前页面及全部产物" onClick={() => perform(() => copilotApi.duplicateScreen(project.id, project.screen_id))}><Copy size={14} /></button>{archiveCandidates.length > 0 && <><select aria-label="要归档的非当前页面" value={archiveTarget} onChange={(event) => setArchiveTarget(event.target.value)}>{archiveCandidates.map((screen) => <option key={screen.id} value={screen.id}>{screen.name}</option>)}</select><button disabled={busy || !archiveTarget} title="归档选中的非当前页面" onClick={() => perform(() => copilotApi.updateScreen(project.id, archiveTarget, { status: 'archived' }))}><Archive size={14} /></button></>}</section>;
}
