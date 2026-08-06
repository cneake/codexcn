import React, { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import './OrchestratorPanel.css';
import { useDraggable } from './useDraggable';

interface Agent {
  id: string;
  name: string;
  color: string;
  icon: string;
}

interface MultiAgentSession {
  id: string;
  task: string;
  main_tool_id: string;
  created_at: number;
  updated_at: number;
}

interface MultiAgentResult {
  id: string;
  session_id: string;
  tool_id: string;
  agent_name: string;
  content: string;
  error: string | null;
  is_summary: boolean;
  created_at: number;
}

interface SubAgentResult {
  tool_id: string;
  agent_name: string;
  content: string;
  error: string | null;
}

const AVAILABLE_AGENTS: Agent[] = [
  { id: 'claude-code', name: 'Claude Code', color: '#ff6b6b', icon: '🤖' },
  { id: 'codex', name: 'Codex', color: '#4ecdc4', icon: '💻' },
  { id: 'gemini-cli', name: 'Gemini', color: '#45b7d1', icon: '🌟' },
  { id: 'deepseek-cli', name: 'DeepSeek', color: '#96ceb4', icon: '🔍' },
  { id: 'openclaw', name: 'OpenClaw', color: '#dda0dd', icon: '🦀' },
  { id: 'hermes-agent', name: 'Hermes', color: '#f7dc6f', icon: '⚡' },
  { id: 'qoder-cli', name: 'Qoder', color: '#ff9ff3', icon: '🐦' },
  { id: 'opencode', name: 'OpenCode', color: '#54a0ff', icon: '🔓' },
];

interface OrchestratorPanelProps {
  onClose: () => void;
  onToast?: (msg: string, type?: 'info' | 'error' | 'success') => void;
}

const OrchestratorPanel: React.FC<OrchestratorPanelProps> = ({ onClose, onToast }) => {
  const [task, setTask] = useState('');
  const dragContainerRef = useRef<HTMLDivElement>(null);
  const dragHandleRef = useRef<HTMLDivElement>(null);
  useDraggable(dragHandleRef, dragContainerRef);
  const [selectedAgents, setSelectedAgents] = useState<string[]>(['claude-code', 'codex', 'gemini-cli']);
  const [results, setResults] = useState<SubAgentResult[]>([]);
  const [summary, setSummary] = useState('');
  const [mainAgent, setMainAgent] = useState('claude-code');
  const [isDispatching, setIsDispatching] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [activeTab, setActiveTab] = useState<'new' | 'history'>('new');
  const [historySessions, setHistorySessions] = useState<MultiAgentSession[]>([]);
  const [selectedHistory, setSelectedHistory] = useState<MultiAgentSession | null>(null);
  const [historyResults, setHistoryResults] = useState<MultiAgentResult[]>([]);
  const resultsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    resultsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [results, summary]);

  // 加载历史记录
  useEffect(() => {
    if (activeTab === 'history') {
      loadHistory();
    }
  }, [activeTab]);

  const loadHistory = async () => {
    try {
      const sessions = await invoke<MultiAgentSession[]>('get_multiagent_sessions', { limit: 20 });
      setHistorySessions(sessions);
    } catch (e) {
      onToast?.(`加载历史失败: ${String(e)}`, 'error');
    }
  };

  const loadHistoryDetail = async (sessionId: string) => {
    try {
      const results = await invoke<MultiAgentResult[]>('get_multiagent_results', { sessionId });
      setHistoryResults(results);
    } catch (e) {
      onToast?.(`加载详情失败: ${String(e)}`, 'error');
    }
  };

  const deleteHistory = async (sessionId: string) => {
    try {
      await invoke('delete_multiagent_session', { sessionId });
      loadHistory();
      if (selectedHistory?.id === sessionId) {
        setSelectedHistory(null);
        setHistoryResults([]);
      }
      onToast?.('已删除', 'success');
    } catch (e) {
      onToast?.(`删除失败: ${String(e)}`, 'error');
    }
  };

  const toggleAgent = (agentId: string) => {
    setSelectedAgents(prev =>
      prev.includes(agentId)
        ? prev.filter(id => id !== agentId)
        : [...prev, agentId]
    );
  };

  const handleDispatch = async () => {
    if (!task.trim()) {
      onToast?.('请输入任务', 'error');
      return;
    }
    if (selectedAgents.length < 2) {
      onToast?.('至少选择 2 个 Agent', 'error');
      return;
    }

    setIsDispatching(true);
    setResults([]);
    setSummary('');
    try {
      const res = await invoke<SubAgentResult[]>('run_subagents', {
        task: task.trim(),
        toolIds: selectedAgents,
      });
      setResults(res);
      onToast?.('子Agent 已全部返回', 'success');
    } catch (e) {
      onToast?.(`派发失败: ${String(e)}`, 'error');
    } finally {
      setIsDispatching(false);
    }
  };

  const handleSummarize = async () => {
    if (results.length === 0) {
      onToast?.('暂无子Agent结果可汇总', 'error');
      return;
    }
    if (!selectedAgents.includes(mainAgent)) {
      onToast?.('主Agent 必须是已选中的 Agent 之一', 'error');
      return;
    }

    setIsSummarizing(true);
    setSummary('');
    try {
      const sum = await invoke<string>('summarize_discussion', {
        task: task.trim(),
        results,
        mainToolId: mainAgent,
      });
      setSummary(sum);

      // 自动保存到数据库
      try {
        const sessionId = `ma_${Date.now()}`;
        const now = Math.floor(Date.now() / 1000);
        const session: MultiAgentSession = {
          id: sessionId,
          task: task.trim(),
          main_tool_id: mainAgent,
          created_at: now,
          updated_at: now,
        };
        const dbResults: MultiAgentResult[] = [
          ...results.map((r, i) => ({
            id: `${sessionId}_r${i}`,
            session_id: sessionId,
            tool_id: r.tool_id,
            agent_name: r.agent_name,
            content: r.content,
            error: r.error,
            is_summary: false,
            created_at: now,
          })),
          {
            id: `${sessionId}_sum`,
            session_id: sessionId,
            tool_id: mainAgent,
            agent_name: '主Agent',
            content: sum,
            error: null,
            is_summary: true,
            created_at: now,
          },
        ];
        await invoke('save_multiagent_session', { session, results: dbResults });
        onToast?.('已保存到历史记录', 'success');
      } catch (e) {
        console.error('保存失败:', e);
      }

      onToast?.('汇总完成', 'success');
    } catch (e) {
      onToast?.(`汇总失败: ${String(e)}`, 'error');
    } finally {
      setIsSummarizing(false);
    }
  };

  return (
    <div className="orchestrator-panel" ref={dragContainerRef}>
      <div className="or-header drag-handle" ref={dragHandleRef} style={{ cursor: 'move' }}>
        <h2>🎯 多Agent 协作</h2>
        <button className="or-close-btn" onClick={onClose}>✕</button>
      </div>

      {/* Tab 切换 */}
      <div className="or-tabs">
        <button
          className={`or-tab ${activeTab === 'new' ? 'active' : ''}`}
          onClick={() => setActiveTab('new')}
        >
          新任务
        </button>
        <button
          className={`or-tab ${activeTab === 'history' ? 'active' : ''}`}
          onClick={() => setActiveTab('history')}
        >
          历史记录
        </button>
      </div>

      <div className="or-body">
        {activeTab === 'new' ? (
          <>
        {/* Agent 选择 */}
        <section className="or-section">
          <h3>参与 Agent（子Agent）</h3>
          <div className="or-agent-grid">
            {AVAILABLE_AGENTS.map(agent => (
              <label
                key={agent.id}
                className={`or-agent-chip ${selectedAgents.includes(agent.id) ? 'selected' : ''}`}
                style={{ borderColor: selectedAgents.includes(agent.id) ? agent.color : '#333' }}
              >
                <input
                  type="checkbox"
                  checked={selectedAgents.includes(agent.id)}
                  onChange={() => toggleAgent(agent.id)}
                />
                <span className="or-agent-icon">{agent.icon}</span>
                <span className="or-agent-name">{agent.name}</span>
              </label>
            ))}
          </div>
        </section>

        {/* 任务输入 */}
        <section className="or-section">
          <h3>任务</h3>
          <textarea
            placeholder="输入要派发给各 Agent 的任务..."
            value={task}
            onChange={(e) => setTask(e.target.value)}
            rows={3}
          />
          <div className="or-actions">
            <button
              className="or-dispatch-btn"
              onClick={handleDispatch}
              disabled={isDispatching || selectedAgents.length < 2}
            >
              {isDispatching ? '派发中...' : '派发任务'}
            </button>
          </div>
        </section>

        {/* 子Agent 结果 */}
        <section className="or-section">
          <h3>子Agent 独立回答（互不看见）</h3>
          <div className="or-results">
            {results.length === 0 ? (
              <div className="or-empty">派发任务后，各 Agent 的回答将在此并行展示</div>
            ) : (
              results.map((r, i) => {
                const agent = AVAILABLE_AGENTS.find(a => a.id === r.tool_id);
                return (
                  <div key={i} className="or-result-card" style={{ borderLeftColor: agent?.color || '#555' }}>
                    <div className="or-result-head">
                      <span className="or-result-icon">{agent?.icon || '👤'}</span>
                      <span className="or-result-name">{r.agent_name}</span>
                      {r.error && <span className="or-result-err">⚠ {r.error}</span>}
                    </div>
                    <div className="or-result-content">{r.content || '（无内容）'}</div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* 汇总 */}
        <section className="or-section">
          <h3>主Agent 汇总</h3>
          <div className="or-summary-controls">
            <label>主Agent：</label>
            <select value={mainAgent} onChange={(e) => setMainAgent(e.target.value)}>
              {selectedAgents.map(id => (
                <option key={id} value={id}>
                  {AVAILABLE_AGENTS.find(a => a.id === id)?.name || id}
                </option>
              ))}
            </select>
            <button
              className="or-summary-btn"
              onClick={handleSummarize}
              disabled={isSummarizing || results.length === 0}
            >
              {isSummarizing ? '汇总中...' : '生成最终汇总'}
            </button>
          </div>
          {summary && (
            <div className="or-summary-box">
              {summary}
            </div>
          )}
        </section>

        <div ref={resultsEndRef} />
          </>
        ) : (
          // 历史记录 Tab
          <>
            <section className="or-section">
              <h3>协作历史</h3>
              {historySessions.length === 0 ? (
                <div className="or-empty">暂无历史记录</div>
              ) : (
                <div className="or-history-list">
                  {historySessions.map(s => (
                    <div
                      key={s.id}
                      className={`or-history-item ${selectedHistory?.id === s.id ? 'selected' : ''}`}
                      onClick={() => {
                        setSelectedHistory(s);
                        loadHistoryDetail(s.id);
                      }}
                    >
                      <div className="or-history-task">{s.task}</div>
                      <div className="or-history-meta">
                        {new Date(s.created_at * 1000).toLocaleString('zh-CN')} · {s.main_tool_id}
                      </div>
                      <button
                        className="or-history-delete"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteHistory(s.id);
                        }}
                      >
                        删除
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {selectedHistory && historyResults.length > 0 && (
              <section className="or-section">
                <h3>历史详情：{selectedHistory.task}</h3>
                <div className="or-results">
                  {historyResults.filter(r => !r.is_summary).map((r, i) => {
                    const agent = AVAILABLE_AGENTS.find(a => a.id === r.tool_id);
                    return (
                      <div key={i} className="or-result-card" style={{ borderLeftColor: agent?.color || '#555' }}>
                        <div className="or-result-head">
                          <span className="or-result-icon">{agent?.icon || '👤'}</span>
                          <span className="or-result-name">{r.agent_name}</span>
                        </div>
                        <div className="or-result-content">{r.content || '（无内容）'}</div>
                      </div>
                    );
                  })}
                </div>
                {historyResults.find(r => r.is_summary) && (
                  <div className="or-summary-box" style={{ marginTop: 16 }}>
                    {historyResults.find(r => r.is_summary)?.content}
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default OrchestratorPanel;
