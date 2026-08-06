import React, { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import './ChatView.css';

/* ── 类型定义 ── */
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  tool_calls?: { id: string; name: string; input: any; result?: string }[];
}

interface ChatSession {
  id: string;
  tool_id: string;
  title: string;
  created_at: number;
  updated_at: number;
  message_count: number;
}

/* ── Markdown 解析器（返回 ReactNode[]）── */
function parseMarkdown(text: string): React.ReactNode[] {
  const esc = (s: string) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  const nodes: React.ReactNode[] = [];
  let remaining = text;

  // 分割：代码块 vs 普通文本
  const codeBlockRe = /(```(\w*)\n?)([\s\S]*?)(\```)/g;
  let lastIndex = 0;
  let match;

  while ((match = codeBlockRe.exec(text)) !== null) {
    // 普通文本
    if (match.index > lastIndex) {
      const plain = text.slice(lastIndex, match.index);
      nodes.push(...parseInline(plain, esc));
    }
    // 代码块
    const lang = match[2] || '';
    const code = match[3].trimEnd();
    nodes.push(
      <CodeBlock key={`code-${match.index}`} lang={lang} code={code} />
    );
    lastIndex = codeBlockRe.lastIndex;
  }

  // 剩余普通文本
  if (lastIndex < text.length) {
    nodes.push(...parseInline(text.slice(lastIndex), esc));
  }

  return nodes;
}

/* ── 内联解析 ── */
function parseInline(text: string, esc: (s: string) => string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // 逐行处理
  const lines = text.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 表格（支持 |---| 样式）
    if (line.match(/^\|.+\|$/)) {
      const tableLines = [line];
      while (i + 1 < lines.length && lines[i + 1].match(/^\|[\s-|]+\|$/)) {
        i++;
        tableLines.push(lines[i]);
      }
      nodes.push(
        <TableBlock key={`table-${i}`} lines={tableLines} esc={esc} />
      );
      i++;
      continue;
    }

    // 有序列表
    if (line.match(/^\s*\d+\.\s+/)) {
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^\s*\d+\.\s+/)) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      nodes.push(
        <ol key={`ol-${i}`} className="md-ol">
          {items.map((item, idx) => (
            <li key={idx}>{parseInlineSingle(item, esc)}</li>
          ))}
        </ol>
      );
      continue;
    }

    // 无序列表
    if (line.match(/^\s*[-*]\s+/)) {
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^\s*[-*]\s+/)) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ''));
        i++;
      }
      nodes.push(
        <ul key={`ul-${i}`} className="md-ul">
          {items.map((item, idx) => (
            <li key={idx}>{parseInlineSingle(item, esc)}</li>
          ))}
        </ul>
      );
      continue;
    }

    // 标题 ### text
    const h3 = line.match(/^### (.+)$/);
    if (h3) { nodes.push(<h4 key={`h3-${i}`} className="md-h3">{parseInlineSingle(h3[1], esc)}</h4>); i++; continue; }
    // 标题 ## text
    const h2 = line.match(/^## (.+)$/);
    if (h2) { nodes.push(<h3 key={`h2-${i}`} className="md-h2">{parseInlineSingle(h2[1], esc)}</h3>); i++; continue; }
    // 标题 # text
    const h1 = line.match(/^# (.+)$/);
    if (h1) { nodes.push(<h2 key={`h1-${i}`} className="md-h1">{parseInlineSingle(h1[1], esc)}</h2>); i++; continue; }

    // 分割线
    if (line.match(/^---+$/)) { nodes.push(<hr key={`hr-${i}`} className="md-hr" />); i++; continue; }

    // 空行
    if (line.trim() === '') { nodes.push(<br key={`br-${i}`} />); i++; continue; }

    // 普通段落
    if (line.trim()) {
      nodes.push(<p key={`p-${i}`} className="md-p">{parseInlineSingle(line, esc)}</p>);
    }
    i++;
  }

  return nodes;
}

/* ── 单行内联解析 ── */
function parseInlineSingle(text: string, esc: (s: string) => string): React.ReactNode[] {
  if (!text) return [];
  const nodes: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // 图片 ![alt](url)
    const imgM = remaining.match(/^!\[([^\]]*)\]\(([^)]+)\)/);
    if (imgM) {
      nodes.push(<img key={key++} src={imgM[2]} alt={imgM[1]} className="md-img" />);
      remaining = remaining.slice(imgM[0].length);
      continue;
    }
    // 链接 [text](url)
    const linkM = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
    if (linkM) {
      nodes.push(<a key={key++} href={linkM[2]} target="_blank" rel="noopener noreferrer" className="md-link">{linkM[1]}</a>);
      remaining = remaining.slice(linkM[0].length);
      continue;
    }
    // 行内代码 `code`
    const codeM = remaining.match(/^`([^`]+)`/);
    if (codeM) {
      nodes.push(<code key={key++} className="inline-code">{codeM[1]}</code>);
      remaining = remaining.slice(codeM[0].length);
      continue;
    }
    // 粗体 **text**
    const boldM = remaining.match(/^\*\*([^*]+)\*\*/);
    if (boldM) {
      nodes.push(<strong key={key++}>{boldM[1]}</strong>);
      remaining = remaining.slice(boldM[0].length);
      continue;
    }
    // 斜体 *text*（但不是 ** 开头）
    const italicM = remaining.match(/^\*(?!\*)([^*\n]+)\*/);
    if (italicM) {
      nodes.push(<em key={key++}>{italicM[1]}</em>);
      remaining = remaining.slice(italicM[0].length);
      continue;
    }
    // 引用 > text
    const quoteM = remaining.match(/^>\s*(.+)/);
    if (quoteM) {
      nodes.push(<blockquote key={key++} className="md-blockquote">{quoteM[1]}</blockquote>);
      remaining = remaining.slice(quoteM[0].length);
      continue;
    }

    // 普通字符：找下一个特殊字符
    let nextSpecial = remaining.length;
    const patterns = [/^!\[/, /^\[/, /^`/, /^\*\*/, /^\*/, /^>/];
    for (const pat of patterns) {
      const m = remaining.match(pat);
      if (m && m.index! < nextSpecial) nextSpecial = m.index!;
    }

    if (nextSpecial === 0) {
      // 单独一个特殊字符，跳过
      nodes.push(remaining[0]);
      remaining = remaining.slice(1);
    } else {
      nodes.push(esc(remaining.slice(0, nextSpecial)));
      remaining = remaining.slice(nextSpecial);
    }
  }

  return nodes;
}

/* ── 表格组件 ── */
function TableBlock({ lines, esc }: { lines: string[]; esc: (s: string) => string }) {
  if (lines.length < 2) return null;
  const headers = lines[0].split('|').filter((_, i, a) => i > 0 && i < a.length - 1).map(h => h.trim());
  const rows = lines.slice(2).map(row =>
    row.split('|').filter((_, i, a) => i > 0 && i < a.length - 1).map(c => c.trim())
  );

  return (
    <div className="md-table-wrap">
      <table className="md-table">
        <thead>
          <tr>{headers.map((h, i) => <th key={i}>{parseInlineSingle(h, esc)}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>{row.map((cell, ci) => <td key={ci}>{parseInlineSingle(cell, esc)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── 代码块组件（带复制按钮）── */
function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
      const ta = document.createElement('textarea');
      ta.value = code;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [code]);

  return (
    <div className="code-block-wrap">
      <div className="code-block-header">
        <span className="code-lang">{lang || 'code'}</span>
        <button className={`code-copy-btn ${copied ? 'copied' : ''}`} onClick={handleCopy} title="复制代码">
          {copied ? '✓ 已复制' : '📋 复制'}
        </button>
      </div>
      <pre className="code-block"><code>{code}</code></pre>
    </div>
  );
}

/* ── 可折叠消息组件 ── */
const COLLAPSE_THRESHOLD = 600; // 字符数超过此值则折叠

function CollapsibleContent({ content, role }: { content: string; role: string }) {
  const [expanded, setExpanded] = useState(false);

  if (content.length <= COLLAPSE_THRESHOLD) {
    return <>{parseMarkdown(content)}</>;
  }

  const preview = content.slice(0, COLLAPSE_THRESHOLD);
  return (
    <div className="md-collapsible">
      <div className={`md-content ${expanded ? 'expanded' : 'collapsed'}`}>
        {expanded ? parseMarkdown(content) : parseMarkdown(preview + '…')}
      </div>
      <button
        className="md-toggle-btn"
        onClick={() => setExpanded(e => !e)}
      >
        {expanded ? '🔼 收起' : `🔽 展开全文（${content.length} 字符）`}
      </button>
    </div>
  );
}

interface Props {
  toolId: string;
  onBack?: () => void;
}

export default function ChatView({ toolId, onBack }: Props) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSession, setActiveSession] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const toolName: Record<string,string> = {
    'hermes-agent': 'Hermes Agent',
    'openclaw': 'OpenClaw',
    'claude-code': 'Claude Code',
    'codex': 'Codex',
    'gemini-cli': 'Gemini CLI',
    'opencode': 'OpenCode',
  };
  const displayName = toolName[toolId] || toolId;

  /* ── 加载会话列表 ── */
  const loadSessions = async () => {
    try {
      const s = await invoke('get_chat_sessions', { toolId }) as ChatSession[];
      setSessions(s.sort((a,b) => b.updated_at - a.updated_at));
    } catch(e) { console.error(e); }
  };

  useEffect(() => { loadSessions(); }, [toolId]);

  /* ── 加载消息 ── */
  const loadMessages = async (sessionId: string) => {
    try {
      const msgs = await invoke('get_chat_messages', { sessionId }) as ChatMessage[];
      setMessages(msgs);
    } catch(e) { console.error(e); }
  };

  /* ── 切换会话 ── */
  const selectSession = async (s: ChatSession) => {
    setActiveSession(s);
    await loadMessages(s.id);
  };

  /* ── 新建会话 ── */
  const newSession = async () => {
    try {
      const s = await invoke('create_chat_session', { toolId }) as ChatSession;
      setActiveSession(s);
      setMessages([]);
      await loadSessions();
    } catch(e) { console.error(e); }
  };

  /* ── 删除会话 ── */
  const delSession = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    if (!confirm('删除此对话？')) return;
    await invoke('delete_chat_session', { session_id: sessionId, tool_id: toolId });
    if (activeSession?.id === sessionId) { setActiveSession(null); setMessages([]); }
    await loadSessions();
  };

  /* ── 监听流式事件 ── */
  const assistantMsgIdRef = useRef<string | null>(null);

  useEffect(() => {
    const unlisteners: (() => void)[] = [];

    listen<{token: string; content: string}>('chat_token', (event) => {
      const { content } = event.payload;
      setStreaming(true);
      setMessages(prev => prev.map(m =>
        m.id === assistantMsgIdRef.current ? { ...m, content } : m
      ));
    }).then(fn => unlisteners.push(fn));

    listen<{content: string}>('chat_done', (_event) => {
      setLoading(false);
      setStreaming(false);
      assistantMsgIdRef.current = null;
      loadSessions();
    }).then(fn => unlisteners.push(fn));

    listen<{error: string}>('chat_error', (evt) => {
      setLoading(false);
      setStreaming(false);
      assistantMsgIdRef.current = null;
      setError(evt.payload.error);
    }).then(fn => unlisteners.push(fn));

    return () => { unlisteners.forEach(fn => fn()); };
  }, []);

  /* ── 发送消息 ── */
  const handleSend = async () => {
    if (!input.trim() || !activeSession || loading) return;
    const text = input.trim();
    setInput('');
    setLoading(true);
    setError(null);

    const userMsgId = `user_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    const userMsg: ChatMessage = {
      id: userMsgId,
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, userMsg]);

    const asstMsgId = `asst_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    assistantMsgIdRef.current = asstMsgId;
    const asstMsg: ChatMessage = {
      id: asstMsgId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, asstMsg]);

    invoke('stream_chat', {
      sessionId: activeSession.id,
      toolId,
      newMessage: text,
    }).catch((e: any) => {
      if (assistantMsgIdRef.current) {
        setMessages(prev => prev.map(m =>
          m.id === assistantMsgIdRef.current
            ? { ...m, content: `❌ 请求失败: ${e}` }
            : m
        ));
        assistantMsgIdRef.current = null;
      }
      setLoading(false);
      setStreaming(false);
    });
  };

  /* ── 自动滚动 ── */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming]);

  /* ── 输入框自动高度 ── */
  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 150) + 'px';
  };

  /* ── 回车发送（Shift+Enter 换行） ── */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts * 1000);
    return `${d.getMonth()+1}/${d.getDate()} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
  };

  return (
    <div className="chat-view">
      {/* ── 左侧会话列表 ── */}
      <aside className="chat-sidebar">
        <div className="chat-sidebar-header">
          <span className="chat-sidebar-title">💬 {displayName}</span>
          <button className="chat-btn-new" onClick={newSession} title="新建对话">+</button>
        </div>
        <div className="chat-session-list">
          {sessions.length === 0 && (
            <div className="chat-empty-hint">暂无对话，点 + 新建</div>
          )}
          {sessions.map(s => (
            <div
              key={s.id}
              className={`chat-session-item ${activeSession?.id === s.id ? 'active' : ''}`}
              onClick={() => selectSession(s)}
            >
              <div className="chat-session-info">
                <div className="chat-session-title">{s.title}</div>
                <div className="chat-session-meta">{formatTime(s.updated_at)} · {s.message_count}条</div>
              </div>
              <button className="chat-session-del" onClick={(e) => delSession(e, s.id)} title="删除">✕</button>
            </div>
          ))}
        </div>
        {onBack && (
          <div className="chat-sidebar-footer">
            <button className="chat-btn-back" onClick={onBack}>← 返回工具</button>
          </div>
        )}
      </aside>

      {/* ── 右侧聊天区 ── */}
      <main className="chat-main">
        {!activeSession ? (
          <div className="chat-welcome">
            <div className="chat-welcome-icon">💬</div>
            <h2>与 {displayName} 对话</h2>
            <p>选择一个会话或新建对话开始聊天</p>
            <button className="chat-btn-primary" onClick={newSession}>+ 新建对话</button>
          </div>
        ) : (
          <>
            <div className="chat-header">
              <span className="chat-header-title">{activeSession.title}</span>
              <button className="chat-btn-new-msg" onClick={newSession}>+ 新对话</button>
            </div>

            <div className="chat-messages">
              {messages.length === 0 && (
                <div className="chat-empty-msg">发送消息开始对话…</div>
              )}
              {messages.map(msg => (
                <div key={msg.id} className={`chat-message ${msg.role}`}>
                  <div className="chat-msg-avatar">
                    {msg.role === 'user' ? '👤' : '🤖'}
                  </div>
                  <div className="chat-msg-body">
                    <div className="chat-msg-content">
                      <CollapsibleContent content={msg.content} role={msg.role} />
                      {streaming && msg.id === assistantMsgIdRef.current && (
                        <span className="typing-cursor" />
                      )}
                    </div>
                    {msg.tool_calls && msg.tool_calls.length > 0 && (
                      <div className="chat-tool-calls">
                        {msg.tool_calls.map(tc => (
                          <div key={tc.id} className="chat-tool-call">
                            <span className="tool-call-name">🔧 {tc.name}</span>
                            <pre className="tool-call-input">{JSON.stringify(tc.input, null, 2)}</pre>
                            {tc.result && <pre className="tool-call-result">{tc.result}</pre>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {loading && !streaming && (
                <div className="chat-message assistant">
                  <div className="chat-msg-avatar">🤖</div>
                  <div className="chat-msg-body">
                    <div className="chat-typing">
                      <span></span><span></span><span></span>
                    </div>
                  </div>
                </div>
              )}
              {error && (
                <div className="chat-message assistant">
                  <div className="chat-msg-avatar">🤖</div>
                  <div className="chat-msg-body">
                    <div className="chat-error">❌ {error}</div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="chat-input-area">
              <textarea
                ref={textareaRef}
                className="chat-input"
                value={input}
                onChange={handleInput}
                onKeyDown={handleKeyDown}
                placeholder={`向 ${displayName} 发送消息… (Enter 发送，Shift+Enter 换行)`}
                rows={1}
                disabled={loading}
              />
              <button className="chat-btn-send" onClick={handleSend} disabled={!input.trim() || loading}>
                {loading ? '...' : '↑'}
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
