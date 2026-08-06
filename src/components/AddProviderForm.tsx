import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

const CATEGORIES = [
  { value: 'domestic', label: '国内厂商' },
  { value: 'overseas', label: '海外厂商' },
  { value: 'relay', label: '中转服务' },
  { value: 'official', label: '官方API' },
];

export default function AddProviderForm({ onAdded, onCancel }: {
  onAdded: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [icon, setIcon] = useState('🏢');
  const [category, setCategory] = useState('domestic');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim() || !baseUrl.trim()) return;
    setSaving(true);
    try {
      const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      await invoke('add_provider', {
        id: id || `custom-${Date.now()}`,
        name: name.trim(),
        baseUrl: baseUrl.trim(),
        icon,
        category,
      });
      if (apiKey.trim()) {
        await invoke('set_provider_api_key', { providerId: id || `custom-${Date.now()}`, apiKey: apiKey.trim() });
      }
      onAdded();
    } catch (e: any) {
      alert(`添加失败: ${e?.message || e}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      <div>
        <label style={{fontSize:12,fontWeight:600,color:'var(--text2)',display:'block',marginBottom:4}}>名称 *</label>
        <input className="form-input" value={name} onChange={e => setName(e.target.value)} placeholder="例如：DeepSeek" style={{width:'100%',boxSizing:'border-box'}} />
      </div>
      <div>
        <label style={{fontSize:12,fontWeight:600,color:'var(--text2)',display:'block',marginBottom:4}}>Base URL *</label>
        <input className="form-input" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="https://api.deepseek.com" style={{width:'100%',boxSizing:'border-box'}} />
      </div>
      <div>
        <label style={{fontSize:12,fontWeight:600,color:'var(--text2)',display:'block',marginBottom:4}}>API Key（可选）</label>
        <input className="form-input" type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-..." style={{width:'100%',boxSizing:'border-box'}} />
      </div>
      <div style={{display:'flex',gap:12}}>
        <div style={{flex:1}}>
          <label style={{fontSize:12,fontWeight:600,color:'var(--text2)',display:'block',marginBottom:4}}>图标</label>
          <input className="form-input" value={icon} onChange={e => setIcon(e.target.value)} placeholder="🏢" style={{width:'100%',boxSizing:'border-box'}} />
        </div>
        <div style={{flex:1}}>
          <label style={{fontSize:12,fontWeight:600,color:'var(--text2)',display:'block',marginBottom:4}}>分类</label>
          <select className="form-input" value={category} onChange={e => setCategory(e.target.value)} style={{width:'100%',boxSizing:'border-box'}}>
            {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
      </div>
      <div style={{display:'flex',justifyContent:'flex-end',gap:8,marginTop:4}}>
        <button className="btn" onClick={onCancel}>取消</button>
        <button className="btn-accent" onClick={handleSubmit} disabled={saving || !name.trim() || !baseUrl.trim()}>
          {saving ? '添加中...' : '添加'}
        </button>
      </div>
    </div>
  );
}
