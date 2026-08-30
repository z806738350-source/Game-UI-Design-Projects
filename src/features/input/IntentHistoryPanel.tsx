import { useState } from 'react';
import { History, RotateCcw, Trash2 } from 'lucide-react';
import type { IntentHistoryEntry } from '../../types';
import { historyReasonLabel } from './intentModel';

// v1.4 §10.7：历史列表。恢复前必须二次确认（恢复后需要重新确认）；
// 删除同样二次确认；列表只包含过去版本，当前版本不在其中。

export function IntentHistoryPanel({ entries, busy, onRestore, onDelete }: {
  entries: IntentHistoryEntry[];
  busy: boolean;
  onRestore: (entry: IntentHistoryEntry) => void;
  onDelete: (entry: IntentHistoryEntry) => void;
}) {
  const [pending, setPending] = useState<{ id: string; action: 'restore' | 'delete' } | null>(null);
  return (
    <section className="intent-history" aria-label="Intent 历史">
      <header><h3><History size={15} />历史版本<em>{entries.length} 条</em></h3><small>恢复历史后需要重新确认；当前版本不进入历史列表。</small></header>
      {entries.length === 0 && <p className="intent-empty">还没有历史版本；保存、采用或恢复时会自动留档。</p>}
      <ul className="intent-history-list">
        {entries.map((entry) => {
          const pendingRestore = pending?.id === entry.history_id && pending.action === 'restore';
          const pendingDelete = pending?.id === entry.history_id && pending.action === 'delete';
          return (
            <li key={entry.history_id} className="intent-history-entry">
              <div className="intent-history-meta">
                <i className="intent-badge intent-badge--muted">{historyReasonLabel(entry.reason)}</i>
                {entry.was_confirmed && <i className="intent-badge intent-badge--ok">曾确认</i>}
                <span>UE v{entry.wireframe_revision ?? 0} · {entry.created_at ? new Date(entry.created_at).toLocaleString() : '未知时间'}</span>
              </div>
              {pendingRestore && <p className="intent-history-warn" role="alert">恢复后当前版本会先留档，且恢复的版本需要重新确认。继续？</p>}
              {pendingDelete && <p className="intent-history-warn" role="alert">删除后该版本无法恢复。继续？</p>}
              <div className="intent-history-actions">
                {!pending && <>
                  <button type="button" className="button button--ghost button--small" disabled={busy} aria-label={`恢复到 ${historyReasonLabel(entry.reason)}`} onClick={() => setPending({ id: entry.history_id, action: 'restore' })}><RotateCcw size={13} />恢复</button>
                  <button type="button" className="button button--ghost button--small" disabled={busy} aria-label={`删除 ${historyReasonLabel(entry.reason)}`} onClick={() => setPending({ id: entry.history_id, action: 'delete' })}><Trash2 size={13} />删除</button>
                </>}
                {pendingRestore && <>
                  <button type="button" className="button button--primary button--small" disabled={busy} onClick={() => { setPending(null); onRestore(entry); }}>确认恢复</button>
                  <button type="button" className="button button--ghost button--small" disabled={busy} onClick={() => setPending(null)}>取消</button>
                </>}
                {pendingDelete && <>
                  <button type="button" className="button button--danger button--small" disabled={busy} onClick={() => { setPending(null); onDelete(entry); }}>确认删除</button>
                  <button type="button" className="button button--ghost button--small" disabled={busy} onClick={() => setPending(null)}>取消</button>
                </>}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
