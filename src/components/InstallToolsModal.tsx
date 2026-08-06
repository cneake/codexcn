import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface Props {
  open: boolean;
  notInstalled: string[];
  onClose: () => void;
  onToast: (msg: string) => void;
  onRefresh: () => void;
}

const TOOL_INFO: Record<string, { name: string; icon: string; pkg: string }> = {
  'claude-code': { name: 'Claude Code', icon: '🔤', pkg: '@anthropic-ai/claude-code' },
  'codex': { name: 'Codex', icon: '🔬', pkg: '@openai/codex' },
  'gemini-cli': { name: 'Gemini CLI', icon: '🌟', pkg: '@google/gemini-cli' },
  'hermes-agent': { name: 'Hermes Agent', icon: '🏛️', pkg: 'hermes-agent' },
  'openclaw': { name: 'OpenClaw', icon: '🦞', pkg: '' },
  'opencode': { name: 'OpenCode', icon: '💻', pkg: 'opencode-ai' },
};

export default function InstallToolsModal({ open, notInstalled, onClose, onToast, onRefresh }: Props) {
  const [selected, setSelected] = useState<string[]>([]);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState('');
  const [results, setResults] = useState<Record<string, 'ok' | 'fail' | 'skip'>>({});

  useEffect(() => {
    if (open) {
      setSelected(notInstalled);
      setInstalling(false);
      setProgress('');
      setResults({});
    }
  }, [open, notInstalled]);

  const toggle = (id: string) => {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };
  const selectAll = () => setSelected([...notInstalled]);
  const selectNone = () => setSelected([]);

  const handleInstall = async () => {
    if (selected.length === 0) return;
    setInstalling(true);
    setResults({});
    const res: Record<string, 'ok' | 'fail' | 'skip'> = {};

    for (const id of selected) {
      const info = TOOL_INFO[id];
      if (!info) continue;
      setProgress(`正在安装 ${info.name}...`);

      if (id === 'openclaw') {
        res[id] = 'skip';
        onToast(`${info.name} 不是 npm 包，请前往官网下载`);
        setResults({ ...res });
        continue;
      }

      try {
        await invoke('install_tool', { toolId: id });
        res[id] = 'ok';
        onToast(`${info.name} 安装成功`);
      } catch (e: any) {
        res[id] = 'fail';
        onToast(`${info.name} 安装失败: ${e}`);
      }
      setResults({ ...res });
    }

    setProgress('');
    setInstalling(false);
    const ok = Object.values(res).filter(v => v === 'ok').length;
    onToast(`安装完成：${ok}/${selected.length} 成功`);
    onRefresh(); // 刷新工具检测状态
    onClose();
  };

  if (!open) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-box" style={{ minWidth: 420 }}>
        <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>🔧 一键安装工具</h2>
          <button className="btn-close" onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text2)', fontSize: 20, cursor: 'pointer' }}>×</button>
        </div>

        {installing && progress && (
          <div style={{ padding: '8px 12px', background: 'rgba(0,240,255,0.1)', borderRadius: 6, marginBottom: 12, fontSize: 13, color: 'var(--primary)' }}>
            ⏳ {progress}
          </div>
        )}

        <div className="tool-list">
          {notInstalled.map(id => {
            const info = TOOL_INFO[id] || { name: id, icon: '📦', pkg: '' };
            const r = results[id];
            return (
              <div
                key={id}
                className={`tool-item ${selected.includes(id) ? 'selected' : ''}`}
                onClick={() => toggle(id)}
                style={{ opacity: installing ? 0.6 : 1 }}
              >
                <span className="tool-icon">{info.icon}</span>
                <span className="tool-name">{info.name}</span>
                {r === 'ok' && <span style={{ color: '#4ade80', fontSize: 12 }}>✓ 成功</span>}
                {r === 'fail' && <span style={{ color: '#f87171', fontSize: 12 }}>✗ 失败</span>}
                {r === 'skip' && <span style={{ color: '#fbbf24', fontSize: 12 }}>⏭ 跳过</span>}
                {!r && selected.includes(id) && <span style={{ fontSize: 12, color: 'var(--primary)' }}>✓</span>}
              </div>
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button className="btn-sm" onClick={selectAll} disabled={installing}>全选</button>
          <button className="btn-sm" onClick={selectNone} disabled={installing}>取消全选</button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16, gap: 8 }}>
          <button className="btn-secondary" onClick={onClose} disabled={installing}>关闭</button>
          <button className="btn-primary" onClick={handleInstall} disabled={installing || selected.length === 0}>
            {installing ? '安装中...' : `安装选中 (${selected.length})`}
          </button>
        </div>
      </div>
    </div>
  );
}