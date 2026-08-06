import { useState, useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import './SkillOverlayPanel.css';

interface SkillInvoke {
  id: number;
  tool_id: string;
  skill_slug: string;
  skill_name: string;
  created_at: string;
}

const TOOL_NAMES: Record<string, string> = {
  'claude-code': 'Claude Code',
  'claude-desktop': 'Claude Desktop',
  'codex': 'Codex',
  'gemini-cli': 'Gemini CLI',
  'opencode': 'OpenCode',
  'openclaw': 'OpenClaw',
  'hermes-agent': 'Hermes',
  'qoder-cli': 'Qoder',
  'deepseek-cli': 'DeepSeek',
};

const TOOL_COLORS: Record<string, string> = {
  'claude-code': '#d97706',
  'claude-desktop': '#f59e0b',
  'codex': '#00f0ff',
  'gemini-cli': '#4285f4',
  'opencode': '#22c55e',
  'openclaw': '#a855f7',
  'hermes-agent': '#ef4444',
  'qoder-cli': '#06b6d4',
  'deepseek-cli': '#64748b',
};

interface Props {
  visible: boolean;
  onClose: () => void;
  width: number;
  onWidthChange: (w: number) => void;
}

export default function SkillOverlayPanel({ visible, onClose, width, onWidthChange }: Props) {
  const [skills, setSkills] = useState<SkillInvoke[]>([]);
  const [activeSkillId, setActiveSkillId] = useState<number | null>(null); // 当前正在调用的 skill
  const [listEl, setListEl] = useState<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 }); // 面板位置
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    invoke('get_recent_skill_invokes', { limit: 50 }).then((data: any) => {
      if (data) setSkills(data);
    }).catch(() => {});

    // 监听 skill 调用事件
    const unlisten = listen<SkillInvoke>('skill-invoked', (event) => {
      const newSkill = event.payload;
      setSkills(prev => [newSkill, ...prev].slice(0, 100));
      setActiveSkillId(newSkill.id); // 高亮当前调用的 skill
      // 3秒后取消高亮
      setTimeout(() => setActiveSkillId(null), 3000);
    });

    return () => { unlisten.then(fn => fn()); };
  }, []);

  useEffect(() => {
    if (listEl) listEl.scrollTop = 0;
  }, [skills.length, listEl]);

  // 拖动整个面板
  const handlePanelDragStart = (e: React.MouseEvent) => {
    // 只有点击标题栏才能拖动
    if ((e.target as HTMLElement).closest('.skill-overlay-panel-header')) {
      e.preventDefault();
      setIsDragging(true);
      setDragOffset({
        x: e.clientX - position.x,
        y: e.clientY - position.y
      });
    }
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      setPosition({
        x: e.clientX - dragOffset.x,
        y: e.clientY - dragOffset.y
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragOffset]);

  // 拖拽调整宽度（左边缘）
  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = width;

    const handleResizeMove = (e: MouseEvent) => {
      const delta = startX - e.clientX;
      const newWidth = Math.max(200, Math.min(500, startWidth + delta));
      onWidthChange(newWidth);
    };

    const handleResizeEnd = () => {
      document.removeEventListener('mousemove', handleResizeMove);
      document.removeEventListener('mouseup', handleResizeEnd);
    };

    document.addEventListener('mousemove', handleResizeMove);
    document.addEventListener('mouseup', handleResizeEnd);
  };

  const fmtTime = (iso: string): string => {
    try {
      const d = new Date(iso);
      const now = new Date();
      const diff = now.getTime() - d.getTime();
      if (diff < 60000) return '刚刚';
      if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
      if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
      return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) + ' ' +
        d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return iso;
    }
  };

  if (!visible) return null;

  return (
    <div
      ref={panelRef}
      className="skill-overlay-panel"
      style={{
        width,
        transform: `translate(${position.x}px, ${position.y}px)`,
        right: position.x === 0 && position.y === 0 ? 0 : 'auto',
        left: position.x !== 0 || position.y !== 0 ? position.x : 'auto',
        top: position.y !== 0 ? position.y : 44,
      }}
      onMouseDown={handlePanelDragStart}
    >
      {/* 拖拽手柄 - 左边缘调整宽度 */}
      <div
        className="skill-overlay-resize-handle"
        onMouseDown={handleResizeStart}
      />
      
      {/* 标题栏 */}
      <div className="skill-overlay-panel-header">
        <span className="skill-overlay-panel-title">技能调用记录</span>
        <button className="skill-overlay-panel-close" onClick={onClose} title="关闭">×</button>
      </div>
      
      {/* 内容区 */}
      <div className="skill-overlay-panel-body" ref={setListEl}>
        {skills.length === 0 ? (
          <div className="skill-overlay-panel-empty">暂无调用记录</div>
        ) : (
          skills.map((s, i) => (
            <div
              key={s.id || i}
              className={`skill-overlay-panel-item ${activeSkillId === s.id ? 'active' : ''}`}
            >
              <div className="skill-overlay-panel-item-header">
                <span
                  className="skill-overlay-panel-tool-tag"
                  style={{ background: TOOL_COLORS[s.tool_id] || '#666', color: '#fff' }}
                >
                  {TOOL_NAMES[s.tool_id] || s.tool_id}
                </span>
                <span className="skill-overlay-panel-time">{fmtTime(s.created_at)}</span>
              </div>
              <div className="skill-overlay-panel-item-name">{s.skill_name || s.skill_slug}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
