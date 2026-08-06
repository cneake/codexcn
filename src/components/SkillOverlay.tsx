import { useState, useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import './SkillOverlay.css';

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
  onClose: () => void;
}

export default function SkillOverlay({ onClose }: Props) {
  const [skills, setSkills] = useState<SkillInvoke[]>([]);
  // activeIds：调用中的 skill id 集合（不设超时，只有 chat-finished 才会清除）
  const [activeIds, setActiveIds] = useState<Set<number>>(new Set());
  const [listEl, setListEl] = useState<HTMLDivElement | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const overlayW = 200; // 与 Rust 端保持一致

  useEffect(() => {
    invoke('get_recent_skill_invokes', { limit: 50 }).then((data: any) => {
      if (data) setSkills(data);
    }).catch(() => {});
    // 清理历史重复记录（保留每个 tool+slug 最新一条）
    invoke('dedup_skill_invoke_log_all', {}).then((deleted: any) => {
      console.log('[skill-overlay] deduped:', deleted, 'rows');
      if (deleted > 0) {
        // 重新拉取去重后的列表
        invoke('get_recent_skill_invokes', { limit: 50 }).then((data: any) => {
          if (data) setSkills(data);
        }).catch(() => {});
      }
    }).catch(() => {});

    // 收到 skill-invoked：追加到列表 + 加入 activeIds（一直高亮直到 chat-finished）
    const unlistenInvoke = listen<SkillInvoke>('skill-invoked', (event) => {
      setSkills(prev => {
        if (prev.some(x => x.id === event.payload.id)) return prev;
        return [event.payload, ...prev].slice(0, 100);
      });
      setActiveIds(prev => {
        const next = new Set(prev);
        next.add(event.payload.id);
        return next;
      });
    });

    // 收到 chat-finished：清空 activeIds（所有高亮变灰）
    const unlistenDone = listen<{ tool_id: string }>('chat-finished', () => {
      setActiveIds(new Set());
    });

    return () => {
      unlistenInvoke.then(fn => fn());
      unlistenDone.then(fn => fn());
    };
  }, []);

  // 浮窗获得焦点
  useEffect(() => {
    getCurrentWindow().setFocus().catch(() => {});
  }, []);

  useEffect(() => {
    if (listEl) listEl.scrollTop = 0;
  }, [skills.length, listEl]);

  const onHeaderMouseDown = async (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    // 按钮区域不触发拖动
    if (target.closest('.skill-overlay-btn')) return;
    e.preventDefault();
    try {
      await getCurrentWindow().startDragging();
    } catch (err) {
      console.error('startDragging failed:', err);
    }
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

  return (
    <div className="skill-overlay">
      <div
        className="skill-overlay-header"
        onMouseDown={onHeaderMouseDown}
      >
        <span className="skill-overlay-title">技能调用记录</span>
        <div className="skill-overlay-actions">
          <button className="skill-overlay-btn skill-overlay-btn-close"
            onClick={onClose} title="关闭">&times;</button>
        </div>
      </div>
      <div className="skill-overlay-body" ref={setListEl}>
        {skills.length === 0 ? (
          <div className="skill-overlay-empty">暂无调用记录</div>
        ) : (
          skills.map((s, i) => {
            const isActive = activeIds.has(s.id);
            const cls = `skill-overlay-item ${isActive ? 'active' : 'inactive'}`;
            return (
            <div key={s.id || i} className={cls}>
              <div className="skill-overlay-item-header">
                <span
                  className="skill-overlay-tool-tag"
                  style={{ background: TOOL_COLORS[s.tool_id] || '#666', color: '#fff' }}
                >
                  {TOOL_NAMES[s.tool_id] || s.tool_id}
                </span>
                <span className="skill-overlay-time">{fmtTime(s.created_at)}</span>
                {isActive && <span className="skill-overlay-pulse">⚡</span>}
              </div>
              <div className="skill-overlay-item-name">{s.skill_name || s.skill_slug}</div>
            </div>
            );
          })
        )}
      </div>
    </div>
  );
}
