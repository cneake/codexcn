import React, { useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import { invoke } from '@tauri-apps/api/core';
import './SessionList.css';

interface ChatSession {
  id: string;
  tool_id: string;
  title: string;
  created_at: number;
  updated_at: number;
  message_count: number;
}

export interface SessionListHandle {
  refresh: () => void;
}

interface Props {
  toolId: string;
  activeSessionId: string | null;
  onSelectSession: (session: ChatSession) => void;
  onNewSession: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

const SessionList = forwardRef<SessionListHandle, Props>(
  ({ toolId, activeSessionId, onSelectSession, onNewSession, collapsed = false, onToggleCollapse }, ref) => {
    const [sessions, setSessions] = useState<ChatSession[]>([]);

    const loadSessions = async () => {
      try {
        const s = await invoke('get_chat_sessions', { toolId }) as ChatSession[];
        setSessions(s.sort((a, b) => b.updated_at - a.updated_at));
      } catch (e) { console.error(e); }
    };

    useEffect(() => { loadSessions(); }, [toolId]);
    useImperativeHandle(ref, () => ({ refresh: loadSessions }), [toolId]);

    const delSession = async (e: React.MouseEvent, sessionId: string) => {
      e.stopPropagation();
      if (!confirm('删除此对话？')) return;
      await invoke('delete_chat_session', { sessionId, toolId });
      await loadSessions();
    };

    const formatTime = (ts: number) => {
      const d = new Date(ts * 1000);
      return `${d.getMonth()+1}/${d.getDate()} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
    };

    const formatDateKey = (ts: number): string => {
      const d = new Date(ts * 1000);
      const now = new Date();
      const isToday = d.toDateString() === now.toDateString();
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      if (isToday) return '今天';
      if (d.toDateString() === yesterday.toDateString()) return '昨天';
      return `${d.getMonth()+1}月${d.getDate()}日`;
    };

    // 按日期分组
    const grouped = sessions.reduce((groups, s) => {
      const key = formatDateKey(s.updated_at);
      if (!groups[key]) groups[key] = [];
      groups[key].push(s);
      return groups;
    }, {} as Record<string, ChatSession[]>);

    return (
      <aside className={`session-list ${collapsed ? 'collapsed' : ''}`}>
        <div className="sl-header">
          {!collapsed && <span className="sl-title">💬 对话</span>}
          {!collapsed && (
            <button className="sl-btn-new" onClick={onNewSession} title="新建对话">+</button>
          )}
          <button
            className="sl-collapse-btn"
            onClick={onToggleCollapse}
            title={collapsed ? '展开会话列表' : '收起会话列表'}
          >
            {collapsed ? '»' : '«'}
          </button>
        </div>

        {collapsed ? (
          <div className="sl-collapsed-hint">
            <span className="sl-collapsed-icon">💬</span>
            <span className="sl-collapsed-text">历史</span>
          </div>
        ) : (
        <div className="sl-body">
          {sessions.length === 0 ? (
            <div className="sl-empty">
              <span>暂无对话，点 + 新建</span>
            </div>
          ) : (
            Object.entries(grouped).map(([dateLabel, items]) => (
              <div key={dateLabel} className="sl-group">
                <div className="sl-group-label">{dateLabel}</div>
                {items.map(s => (
                  <div
                    key={s.id}
                    className={`sl-item ${activeSessionId === s.id ? 'active' : ''}`}
                    onClick={() => onSelectSession(s)}
                  >
                    <div className="sl-item-info">
                      <div className="sl-item-title">{s.title}</div>
                      <div className="sl-item-meta">
                        {formatTime(s.updated_at)} · {s.message_count}条
                      </div>
                    </div>
                    <button
                      className="sl-item-del"
                      onClick={(e) => delSession(e, s.id)}
                      title="删除"
                    >✕</button>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
        )}
      </aside>
    );
  }
);

export default SessionList;
