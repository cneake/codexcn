import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface Provider {
  id: string;
  name: string;
  base_url: string;
  api_key: string;
  icon: string;
  category: string;
  enabled: boolean;
  sort_order: number;
  api_key_signup_url: string;
  input_price: number | null;
  output_price: number | null;
}

interface QuickConfigModalProps {
  open: boolean;
  toolId: string;
  onClose: () => void;
  onToast: (msg: string) => void;
}

const PRESET_PROVIDERS = [
  { id: 'api-eake-cn', name: 'Token 购买（推荐）', base_url: 'https://api.eake.cn/v1', model: 'gpt-4o-mini', icon: '⚡', category: 'domestic', signup_url: 'https://api.eake.cn' },
  { id: 'volcengine', name: '火山引擎', base_url: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-seed-evolving', icon: '🔥', category: 'domestic' },
  { id: 'siliconflow', name: '硅基流动', base_url: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen2.5-7B-Instruct', icon: '💧', category: 'domestic' },
  { id: 'deepseek', name: 'DeepSeek', base_url: 'https://api.deepseek.com/v1', model: 'deepseek-chat', icon: '🔵', category: 'domestic' },
  { id: 'zhipu', name: '智谱 GLM', base_url: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', icon: '🟣', category: 'domestic' },
  { id: 'qwen', name: '通义千问', base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', icon: '💜', category: 'domestic' },
  { id: 'kimi', name: 'Kimi', base_url: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k', icon: '🌙', category: 'domestic' },
  { id: 'openai', name: 'OpenAI', base_url: 'https://api.openai.com/v1', model: 'gpt-4o-mini', icon: '🤖', category: 'overseas' },
  { id: 'anthropic', name: 'Anthropic', base_url: 'https://api.anthropic.com/v1', model: 'claude-3-5-haiku-20241022', icon: '🟤', category: 'overseas' },
];

export default function QuickConfigModal({ open, toolId, onClose, onToast }: QuickConfigModalProps) {
  const [tab, setTab] = useState<'preset' | 'custom'>('preset');
  const [preset, setPreset] = useState<typeof PRESET_PROVIDERS[0] | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [inputPrice, setInputPrice] = useState<string>('');
  const [outputPrice, setOutputPrice] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [dbProviders, setDbProviders] = useState<Provider[]>([]);

  useEffect(() => {
    if (!open) return;
    invoke('get_providers').then((data: unknown) => setDbProviders(data as Provider[])).catch(() => setDbProviders([]));
  }, [open]);

  const selectPreset = (p: typeof PRESET_PROVIDERS[0]) => {
    setPreset(p);
    setModel(p.model);
    const existing = dbProviders.find(dp => dp.id === p.id);
    setApiKey(existing?.api_key || '');
    setInputPrice(existing?.input_price?.toString() || '');
    setOutputPrice(existing?.output_price?.toString() || '');
    // 如果是 api.eake-cn，弹出指引
    if (p.id === 'api-eake-cn') {
      onToast('点击下方「购买 Token」跳转购买页面');
    }
  };

  const openBuyPage = () => {
    window.open('https://api.eake.cn', '_blank');
  };

  const handleSave = async () => {
    if (!preset || !apiKey.trim()) {
      onToast('请输入 API Key');
      return;
    }
    setSaving(true);
    try {
      await invoke('add_provider', {
        id: preset.id,
        name: preset.name,
        baseUrl: preset.base_url,
        icon: preset.icon,
        category: preset.category,
      });
      await invoke('set_provider_api_key', { providerId: preset.id, apiKey: apiKey.trim() });
      // 保存单价
      const inPrice = inputPrice.trim() ? parseFloat(inputPrice) : null;
      const outPrice = outputPrice.trim() ? parseFloat(outputPrice) : null;
      if (inPrice !== null || outPrice !== null) {
        await invoke('set_provider_pricing', { providerId: preset.id, inputPrice: inPrice, outputPrice: outPrice });
      }
      await invoke('activate_provider_for_tool', { toolId, providerId: preset.id });
      await invoke('set_tool_provider_model', { toolId, providerId: preset.id, model: model.trim() || preset.model });
      onToast(`已保存 ${preset.name} 配置并激活`);
      setTimeout(() => onToast(''), 5000);
      onClose();
    } catch (e: any) {
      onToast('保存失败: ' + (e?.message || e));
      setTimeout(() => onToast(''), 5000);
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ minWidth: 520, maxWidth: 640 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: 16 }}>
          <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--accent)' }}>一键配置</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div style={{ display:'flex', gap: 8, marginBottom: 16 }}>
          <button className={`tab-btn ${tab === 'preset' ? 'active' : ''}`} onClick={() => setTab('preset')}>快速填充预设</button>
          <button className={`tab-btn ${tab === 'custom' ? 'active' : ''}`} onClick={() => setTab('custom')}>自定义配置</button>
        </div>

        {tab === 'preset' && (
          <div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap: 8, marginBottom: 16, maxHeight: 240, overflowY:'auto' }}>
              {PRESET_PROVIDERS.map(p => (
                <div
                  key={p.id}
                  onClick={() => selectPreset(p)}
                  style={{
                    padding: '10px 12px',
                    border: preset?.id === p.id ? '2px solid var(--accent)' : '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 8,
                    cursor: 'pointer',
                    background: preset?.id === p.id ? 'rgba(0,240,255,0.08)' : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 13,
                  }}
                >
                  <span style={{ fontSize: 18 }}>{p.icon}</span>
                  <span>{p.name}</span>
                </div>
              ))}
            </div>

            {preset && (
              <div style={{ display:'flex', flexDirection:'column', gap: 10 }}>
                {preset.id === 'api-eake-cn' && (
                  <div style={{ padding: 12, background:'rgba(0,240,255,0.08)', borderRadius: 8, border:'1px solid var(--accent)' }}>
                    <div style={{ fontSize: 13, marginBottom: 8 }}>👋 首次使用？先申请 API Key，再购买 Token</div>
                    <div style={{ display:'flex', gap: 8, marginBottom: 8 }}>
                      <button
                        onClick={() => window.open('https://api.eake.cn', '_blank')}
                        style={{ flex: 1, padding: '10px', background: 'var(--accent)', color: '#000', border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
                      >
                        🔑 申请 API Key
                      </button>
                      <button
                        onClick={openBuyPage}
                        style={{ flex: 1, padding: '10px', background: 'rgba(0,240,255,0.15)', color: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
                      >
                        ⚡ 购买 Token
                      </button>
                    </div>
                    <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>申请成功后填写 API Key，再购买 Token 即可使用</div>
                  </div>
                )}
                <div style={{ display:'flex', alignItems:'center', gap: 8, padding:'8px 12px', background:'rgba(255,255,255,0.04)', borderRadius: 8, fontSize: 12, color:'#aaa' }}>
                  <span>接口地址：</span>
                  <span style={{ color: '#888', wordBreak:'break-all' }}>{preset.base_url}</span>
                </div>
                <div>
                  <label style={{ fontSize: 12, color: '#aaa', display:'block', marginBottom: 4 }}>API Key *</label>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={e => setApiKey(e.target.value)}
                    placeholder="输入 API Key"
                    style={{ width: '100%', padding:'8px 12px', background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.15)', borderRadius: 6, color:'#fff', fontSize: 13, boxSizing:'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: '#aaa', display:'block', marginBottom: 4 }}>Model（留空使用默认）</label>
                  <input
                    type="text"
                    value={model}
                    onChange={e => setModel(e.target.value)}
                    placeholder={preset.model}
                    style={{ width: '100%', padding:'8px 12px', background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.15)', borderRadius: 6, color:'#fff', fontSize: 13, boxSizing:'border-box' }}
                  />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: 12, color: '#aaa', display:'block', marginBottom: 4 }}>输入单价（¥/万tokens）</label>
                    <input
                      type="number"
                      step="0.01"
                      value={inputPrice}
                      onChange={e => setInputPrice(e.target.value)}
                      placeholder="留空用默认"
                      style={{ width: '100%', padding:'8px 12px', background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.15)', borderRadius: 6, color:'#fff', fontSize: 13, boxSizing:'border-box' }}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: 12, color: '#aaa', display:'block', marginBottom: 4 }}>输出单价（¥/万tokens）</label>
                    <input
                      type="number"
                      step="0.01"
                      value={outputPrice}
                      onChange={e => setOutputPrice(e.target.value)}
                      placeholder="留空用默认"
                      style={{ width: '100%', padding:'8px 12px', background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.15)', borderRadius: 6, color:'#fff', fontSize: 13, boxSizing:'border-box' }}
                    />
                  </div>
                </div>
                <button
                  onClick={handleSave}
                  disabled={saving || !apiKey.trim()}
                  style={{
                    padding: '10px',
                    background: apiKey.trim() ? 'var(--accent)' : 'rgba(255,255,255,0.1)',
                    color: apiKey.trim() ? '#000' : '#666',
                    border: 'none',
                    borderRadius: 8,
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: apiKey.trim() ? 'pointer' : 'not-allowed',
                    marginTop: 4,
                  }}
                >
                  {saving ? '保存中...' : `保存 ${preset.name} 配置`}
                </button>
              </div>
            )}
          </div>
        )}

        {tab === 'custom' && (
          <CustomConfigForm toolId={toolId} onClose={onClose} onToast={onToast} dbProviders={dbProviders} />
        )}
      </div>
    </div>
  );
}

function CustomConfigForm({ toolId, onClose, onToast, dbProviders }: {
  toolId: string;
  onClose: () => void;
  onToast: (msg: string) => void;
  dbProviders: Provider[];
}) {
  const [providerId, setProviderId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [saving, setSaving] = useState(false);

  return (
    <div style={{ display:'flex', flexDirection:'column', gap: 12 }}>
      <div>
        <label style={{ fontSize: 12, color: '#aaa', display:'block', marginBottom: 4 }}>选择已有 Provider 或新建</label>
        <select
          value={providerId}
          onChange={e => {
            setProviderId(e.target.value);
            const p = dbProviders.find(p => p.id === e.target.value);
            if (p) { setBaseUrl(p.base_url); setApiKey(p.api_key || ''); }
          }}
          style={{ width: '100%', padding:'8px 12px', background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.15)', borderRadius: 6, color:'#fff', fontSize: 13, boxSizing:'border-box' }}
        >
          <option value="">— 选择 Provider —</option>
          {dbProviders.map(p => (
            <option key={p.id} value={p.id}>{p.name} ({p.id})</option>
          ))}
        </select>
      </div>
      <div>
        <label style={{ fontSize: 12, color: '#aaa', display:'block', marginBottom: 4 }}>接口地址</label>
        <input type="text" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="https://api.example.com/v1"
          style={{ width: '100%', padding:'8px 12px', background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.15)', borderRadius: 6, color:'#fff', fontSize: 13, boxSizing:'border-box' }}
        />
      </div>
      <div>
        <label style={{ fontSize: 12, color: '#aaa', display:'block', marginBottom: 4 }}>API Key *</label>
        <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-..."
          style={{ width: '100%', padding:'8px 12px', background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.15)', borderRadius: 6, color:'#fff', fontSize: 13, boxSizing:'border-box' }}
        />
      </div>
      <div>
        <label style={{ fontSize: 12, color: '#aaa', display:'block', marginBottom: 4 }}>模型</label>
        <input type="text" value={model} onChange={e => setModel(e.target.value)} placeholder="gpt-4o-mini"
          style={{ width: '100%', padding:'8px 12px', background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.15)', borderRadius: 6, color:'#fff', fontSize: 13, boxSizing:'border-box' }}
        />
      </div>
      <button
        onClick={async () => {
          if (!providerId || !apiKey.trim() || !baseUrl.trim()) { onToast('请填写必填项'); return; }
          setSaving(true);
          try {
            await invoke('add_provider', { id: providerId, name: providerId, baseUrl: baseUrl.trim(), icon: '⚙️', category: 'custom' });
            await invoke('set_provider_api_key', { providerId, apiKey: apiKey.trim() });
            await invoke('activate_provider_for_tool', { toolId, providerId });
            if (model.trim()) await invoke('set_tool_provider_model', { toolId, providerId, model: model.trim() });
            onToast('自定义配置已保存');
            setTimeout(() => onToast(''), 5000);
            onClose();
          } catch(e: any) { onToast('保存失败: ' + (e?.message || e)); setTimeout(() => onToast(''), 5000); }
          finally { setSaving(false); }
        }}
        disabled={saving || !providerId || !apiKey.trim() || !baseUrl.trim()}
        style={{
          padding: '10px',
          background: providerId && apiKey.trim() && baseUrl.trim() ? 'var(--accent)' : 'rgba(255,255,255,0.1)',
          color: providerId && apiKey.trim() && baseUrl.trim() ? '#000' : '#666',
          border: 'none',
          borderRadius: 8,
          fontSize: 14,
          fontWeight: 600,
          cursor: providerId && apiKey.trim() && baseUrl.trim() ? 'pointer' : 'not-allowed',
        }}
      >
        {saving ? '保存中...' : '保存自定义配置'}
      </button>
    </div>
  );
}
