import { ArrowDown, ArrowUp, Check, ImagePlus, Trash2 } from 'lucide-react';
import { copilotApi } from '../../api';
import type { DesignProject, ReferenceAsset } from '../../types';
import { Dropdown } from '../shared/ui';

type Run = (task: () => Promise<DesignProject>, options: { label: string }) => Promise<DesignProject | undefined>;

export function ReferenceWorkbench({ project, busy, run }: { project: DesignProject; busy: boolean; run: Run }) {
  const references = project.reference_assets || [];
  const pack = project.artifacts.referencePack;
  const manage = (input: Parameters<typeof copilotApi.manageReference>[1]) => run(() => copilotApi.manageReference(project.id, input), { label: '更新参考图清单' });
  const saveDetails = (asset: ReferenceAsset, field: string, value: string) => manage({
    id: asset.id, action: 'details', screenType: field === 'screenType' ? value : asset.screen_type,
    contains: field === 'contains' ? value.split(/[、,，]/).map((item) => item.trim()).filter(Boolean) : asset.contains,
    baseline: field === 'baseline' ? value : asset.baseline, notes: field === 'notes' ? value : asset.notes
  });
  return <section className="reference-workbench" data-testid="reference-workbench">
    <header><div><span>REFERENCE INVENTORY / PACK</span><h3>参考图清单与实际附件顺序</h3><p>逐张声明用途并批准；生成服务只会收到 Pack 中按序列出的附件。</p></div><button className="button button--secondary" data-testid="reference-import" disabled={busy} onClick={() => run(() => copilotApi.importFile(project.id, 'reference'), { label: '添加风格参考' })}><ImagePlus size={15} />批量添加</button></header>
    <div className="reference-workbench-grid">{references.map((asset, index) => <article key={asset.id} className={asset.approved ? 'is-approved' : ''}>
      <img src={asset.preview} alt={asset.name} />
      <div className="reference-fields"><b title={asset.name}>{asset.name}</b><small>{asset.metadata ? `${asset.metadata.width}×${asset.metadata.height}` : '图片参考'} · {asset.approved ? '已批准' : '待批准'}</small>
        <label><span>角色</span><Dropdown ariaLabel={`选择参考图角色（${asset.name}）`} disabled={busy} value={asset.role} onChange={(next) => manage({ id: asset.id, action: 'role', role: next })} options={[{ value: 'primary', label: '主参考' }, { value: 'component', label: '组件' }, { value: 'material', label: '材质' }, { value: 'composition', label: '构图' }, { value: 'supporting', label: '辅助' }]} /></label>
        <label><span>页面类型</span><input defaultValue={asset.screen_type === 'unspecified' ? '' : asset.screen_type || ''} placeholder="未指定" onBlur={(event) => saveDetails(asset, 'screenType', event.target.value)} /></label>
        <label><span>包含内容</span><input defaultValue={(asset.contains || []).join('、')} placeholder="按钮、页签、材质" onBlur={(event) => saveDetails(asset, 'contains', event.target.value)} /></label>
        <label><span>基线说明</span><input defaultValue={asset.baseline || ''} onBlur={(event) => saveDetails(asset, 'baseline', event.target.value)} /></label>
        <label><span>备注</span><input defaultValue={asset.notes || ''} onBlur={(event) => saveDetails(asset, 'notes', event.target.value)} /></label>
      </div>
      <nav><button title="前移" disabled={busy || index === 0} onClick={() => manage({ id: asset.id, action: 'move', direction: 'up' })}><ArrowUp size={13} /></button><button title="后移" disabled={busy || index === references.length - 1} onClick={() => manage({ id: asset.id, action: 'move', direction: 'down' })}><ArrowDown size={13} /></button><button className={asset.approved ? 'is-approved' : ''} title={asset.approved ? '撤销批准' : '批准参考图'} disabled={busy} onClick={() => manage({ id: asset.id, action: 'approval', approved: !asset.approved })}><Check size={13} /></button><button title="移出参考集" disabled={busy} onClick={() => manage({ id: asset.id, action: 'remove' })}><Trash2 size={13} /></button></nav>
    </article>)}</div>
    {pack && <div className="reference-pack-preview"><header><b>附件容量 {String((pack.capacity_decision as Record<string, unknown>)?.used || 0)} / {String(pack.provider_limit || 0)}</b><span className={pack.status === 'approved' ? 'is-approved' : ''}>{pack.status === 'approved' ? '附件顺序已确认' : '等待确认省略项'}</span></header>{Number((pack.capacity_decision as Record<string, unknown>)?.used || 0) >= Number(pack.provider_limit || Number.MAX_SAFE_INTEGER) && <p className="capacity-warning" role="alert" data-testid="reference-capacity-warning">附件容量已达上限，超出的参考图已被省略，生成前必须确认。</p>}<ol>{((pack.attachment_order as Array<Record<string, unknown>>) || []).map((item) => <li key={String(item.id)}><b>附件 {String(item.index)}</b><span>{String(item.description)}</span></li>)}</ol>{Array.isArray(pack.omitted) && pack.omitted.length > 0 && <details open><summary>省略 {pack.omitted.length} 张（生成前必须确认）</summary>{(pack.omitted as Array<Record<string, unknown>>).map((item) => <p key={String(item.id)}>{String(item.name || item.id)} · {String(item.reason)}</p>)}</details>}</div>}
    {references.length > 0 && <footer><button className="button button--primary" data-testid="reference-approve" disabled={busy || !references.some((asset) => asset.approved)} onClick={() => run(() => copilotApi.approveArtifact(project.id, 'reference-inventory'), { label: '批准参考图清单' })}><Check size={15} />批准参考图清单</button></footer>}
  </section>;
}
