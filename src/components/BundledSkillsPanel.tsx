import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import './BundledSkillsPanel.css';

interface BundledSkill {
  name: string;
  slug: string;
  description: string;
  category: string;
  author: string;
  version: string;
}

interface Props {
  toolId: string;
  onClose: () => void;
  onToast: (msg: string, type?: 'success' | 'error') => void;
  onSkillInvoked?: () => void;
}

const CATEGORY_COLORS: Record<string, string> = {
  '邮件': '#00bcd4',
  '文档': '#4caf50',
  '表格': '#8bc34a',
  '系统': '#ff9800',
  '搜索': '#2196f3',
  '浏览器': '#9c27b0',
  '信息': '#e91e63',
};

export default function BundledSkillsPanel({ toolId, onClose, onToast, onSkillInvoked }: Props) {
  const [skills, setSkills] = useState<BundledSkill[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    invoke<BundledSkill[]>('get_bundled_skills')
      .then(setSkills)
      .catch(err => {
        console.error('加载内置技能失败:', err);
        onToast('加载内置技能失败', 'error');
      })
      .finally(() => setLoading(false));
  }, []);

  const handleInvoke = async (slug: string, name: string) => {
    try {
      await invoke('log_skill_invoke', { toolId, skillSlug: slug, skillName: name });
      onToast(`已调用 ${name}`, 'success');
      onClose();
      onSkillInvoked?.();
    } catch (err) {
      console.error('调用技能失败:', err);
      onToast('调用技能失败', 'error');
    }
  };

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text2)' }}>加载中...</div>;
  }

  return (
    <div className="bundled-skills-panel" style={{ padding: '16px 0', background: '#111119' }}>
      <div style={{ marginBottom: 16, padding: '0 16px', color: 'var(--text2)', fontSize: 13 }}>
        GenHub 出厂自带的 11 个核心技能，开箱即用，无需安装。
      </div>
      
      <div className="sp-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, padding: '0 16px' }}>
        {skills.map(skill => (
          <div
            key={skill.slug}
            className="sp-card"
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: 12,
              cursor: 'pointer',
              transition: 'transform 0.15s, box-shadow 0.15s',
            }}
            onClick={() => handleInvoke(skill.slug, skill.name)}
            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = ''; }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span
                className="sp-badge"
                style={{
                  fontSize: 11,
                  padding: '2px 8px',
                  borderRadius: 4,
                  background: (CATEGORY_COLORS[skill.category] || '#666') + '22',
                  color: CATEGORY_COLORS[skill.category] || '#fff',
                  fontWeight: 600,
                }}
              >
                {skill.category}
              </span>
              <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>{skill.name}</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.5, marginBottom: 8 }}>
              {skill.description}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text3)' }}>
              <span>{skill.author}</span>
              <span>v{skill.version}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
