import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface Provider {
  id: string;
  name: string;
  base_url: string;
  icon: string;
  category: string;
  enabled: boolean;
}

interface Tool {
  id: string;
  name: string;
}

interface ActiveProviderMap {
  [toolId: string]: string;
}

interface QuickSwitchModalProps {
  open: boolean;
  onClose: () => void;
  onToast: (msg: string) => void;
}

export default function QuickSwitchModal({ open, onClose, onToast }: QuickSwitchModalProps) {
  const [tab, setTab] = useState<'all' | 'single'>('all');
  const [providers, setProviders] = useState<Provider[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [activeProviders, setActiveProviders] = useState<ActiveProviderMap>({});
  const [selectedAll, setSelectedAll] = useState('');
  const [selectedTool, setSelectedTool] = useState('');
  const [selectedSingle, setSelectedSingle] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    Promise.all([
      invoke('get_providers').then((data: unknown) => data as Provider[]),
      invoke('get_cli_tools_with_installed').then((data: unknown) => {
        // 返回 Vec<(CliTool, bool)>，解构为 {id, name, installed}
        const rows = data as [any, boolean][];
        return rows.map(([t, installed]) => ({ id: t.id, name: t.name, installed } as Tool));
      }),
      invoke('get_all_active_providers').then((data: unknown) => data as ActiveProviderMap),
    ]).then(([ps, ts, apMap]) => {
      setProviders(ps);
      setTools(ts);
      setActiveProviders(apMap);
    }).catch(() => {});
  }, [open]);

  if (!open) return null;

  const renderAllPreview = () => {
    if (!selectedAll) return null;
    return (
      <div style={{ marginTop: 12, padding: '10px 12px', background: 'rgba(255,255,255,0.04)', borderRadius: 8, fontSize: 12 }}>
        <div style={{ color: '#aaa', marginBottom: 6 }}>⚠️ 切换预览</div>
        {tools.map(t => (
          <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span>{t.name}</span>
            <span style={{ color: 'var(--accent)' }}>
              {activeProviders[t.id] || '未设置'} → {selectedAll}
            </span>
          </div>
        ))}
      </div>
    );
  };

  const renderSinglePreview = () => {
    if (!selectedTool) return null;
    const tool = tools.find(t => t.id === selectedTool);
    return (
      <div style={{ marginTop: 12, padding: '10px 12px', background: 'rgba(255,255,255,0.04)', borderRadius: 8, fontSize: 12 }}>
        <div style={{ color: '#aaa', marginBottom: 6 }}>📍 {tool?.name} 当前使用</div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>服务商</span>
          <span style={{ color: 'var(--accent)' }}>{activeProviders[selectedTool] || '未设置'}</span>
        </div>
      </div>
    );
  };

  const handleSwitchAll = async () => {
    if (!selectedAll) return;
    setSaving(true);
    try {
      for (const tool of tools) {
        await invoke('activate_provider_for_tool', { toolId: tool.id, providerId: selectedAll });
      }
      const msg = `已将 ${tools.length} 个工具全部切换到 ${providers.find(p => p.id === selectedAll)?.name}`;
      onToast(msg);
      setTimeout(() => onToast(''), 5000);
      onClose();
    } catch (e: any) {
      onToast('切换失败: ' + (e?.message || e));
      setTimeout(() => onToast(''), 5000);
    } finally {
      setSaving(false);
    }
  };

  const handleSwitchSingle = async () => {
    if (!selectedTool || !selectedSingle) return;
    setSaving(true);
    try {
      await invoke('activate_provider_for_tool', { toolId: selectedTool, providerId: selectedSingle });
      onToast(`已将 ${tools.find(t => t.id === selectedTool)?.name} 切换到 ${providers.find(p => p.id === selectedSingle)?.name}`);
      setTimeout(() => onToast(''), 5000);
      onClose();
    } catch (e: any) {
      onToast('切换失败: ' + (e?.message || e));
      setTimeout(() => onToast(''), 5000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ minWidth: 480, maxWidth: 580 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: 16 }}>
          <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--accent)' }}>一键切换</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div style={{ display:'flex', gap: 8, marginBottom: 16 }}>
          <button className={`tab-btn ${tab === 'all' ? 'active' : ''}`} onClick={() => setTab('all')}>
            全部切换
          </button>
          <button className={`tab-btn ${tab === 'single' ? 'active' : ''}`} onClick={() => setTab('single')}>
            单独切换
          </button>
        </div>

        {tab === 'all' && (
          <div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap: 8, marginBottom: 8, maxHeight: 280, overflowY:'auto' }}>
              {providers.map(p => (
                <div
                  key={p.id}
                  onClick={() => setSelectedAll(p.id)}
                  style={{
                    padding: '10px 12px',
                    border: selectedAll === p.id ? '2px solid var(--accent)' : '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 8,
                    cursor: 'pointer',
                    background: selectedAll === p.id ? 'rgba(0,240,255,0.08)' : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 13,
                  }}
                >
                  <span style={{ fontSize: 16 }}>{p.icon || '⚙️'}</span>
                  <span>{p.name}</span>
                </div>
              ))}
            </div>
            {renderAllPreview()}
            <button
              onClick={handleSwitchAll}
              disabled={saving || !selectedAll}
              style={{
                width: '100%',
                marginTop: 12,
                padding: '10px',
                background: selectedAll ? 'var(--accent)' : 'rgba(255,255,255,0.1)',
                color: selectedAll ? '#000' : '#666',
                border: 'none',
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 600,
                cursor: selectedAll ? 'pointer' : 'not-allowed',
              }}
            >
              {saving ? '切换中...' : `切换全部 ${tools.length} 个工具到 ${providers.find(p => p.id === selectedAll)?.name || '?'}`}
            </button>
          </div>
        )}

        {tab === 'single' && (
          <div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: '#aaa', display:'block', marginBottom: 4 }}>选择工具</label>
              <select
                value={selectedTool}
                onChange={e => setSelectedTool(e.target.value)}
                style={{ width: '100%', padding:'8px 12px', background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.15)', borderRadius: 6, color:'#fff', fontSize: 13, boxSizing:'border-box' }}
              >
                <option value="">— 选择工具 —</option>
                {tools.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            {renderSinglePreview()}

            {selectedTool && (
              <div style={{ marginTop: 12 }}>
                <label style={{ fontSize: 12, color: '#aaa', display:'block', marginBottom: 4 }}>选择提供商</label>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap: 8, maxHeight: 200, overflowY:'auto' }}>
                  {providers.map(p => (
                    <div
                      key={p.id}
                      onClick={() => setSelectedSingle(p.id)}
                      style={{
                        padding: '8px 10px',
                        border: selectedSingle === p.id ? '2px solid var(--accent)' : '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 8,
                        cursor: 'pointer',
                        background: selectedSingle === p.id ? 'rgba(0,240,255,0.08)' : 'transparent',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        fontSize: 12,
                      }}
                    >
                      <span>{p.icon || '⚙️'}</span>
                      <span>{p.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={handleSwitchSingle}
              disabled={saving || !selectedTool || !selectedSingle}
              style={{
                width: '100%',
                marginTop: 12,
                padding: '10px',
                background: selectedTool && selectedSingle ? 'var(--accent)' : 'rgba(255,255,255,0.1)',
                color: selectedTool && selectedSingle ? '#000' : '#666',
                border: 'none',
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 600,
                cursor: selectedTool && selectedSingle ? 'pointer' : 'not-allowed',
              }}
            >
              {saving ? '切换中...' : '确认切换'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
