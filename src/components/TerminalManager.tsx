import { useState, useRef, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import 'xterm/css/xterm.css';
import './TerminalManager.css';

const TOOLS = [
  { id: 'claude-code', name: 'Claude Code', icon: '/claude-code-logo.png', cmd: 'claude' },
  { id: 'claude-desktop', name: 'Claude Desktop', icon: '/claude-code-logo.png', cmd: 'claude-desktop' },
  { id: 'codex', name: 'Codex CLI', icon: '/codex.svg', cmd: 'codex' },
  { id: 'gemini-cli', name: 'Gemini CLI', icon: '/gemini-logo.png', cmd: 'gemini' },
  { id: 'hermes-agent', name: 'Hermes Agent', icon: '/hermes-agent-logo.png', cmd: 'hermes' },
  { id: 'openclaw', name: 'OpenClaw', icon: '/openclaw-logo.png', cmd: 'openclaw' },
  { id: 'opencode', name: 'OpenCode', icon: '/opencode-logo.png', cmd: 'opencode' },
  { id: 'qoder-cli', name: 'Qoder CLI', icon: '/opencode-logo.png', cmd: 'qoder' },
];

function getToolCommand(toolId: string): string | undefined {
  return TOOLS.find(t => t.id === toolId)?.cmd;
}

// GUI 工具（无命令行入口），不自动发送命令
const GUI_TOOLS = new Set(['claude-desktop', 'qoder-cli']);

interface ActiveTerm {
  sessionId: string;
  toolId: string;
  toolName: string;
}

export default function TerminalManager() {
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [activeTerm, setActiveTerm] = useState<ActiveTerm | null>(null);
  const [connected, setConnected] = useState(false);
  const [activeSessions, setActiveSessions] = useState<Set<string>>(new Set());
  const [terminalCwd, setTerminalCwd] = useState<string>(''); // 用户自定义工作目录
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string>('');
  const unlistenRef = useRef<Array<() => void>>([]);

  // 清理函数（只清理前端，不杀后端进程）
  const cleanup = useCallback(() => {
    unlistenRef.current.forEach(u => u());
    unlistenRef.current = [];
    if (xtermRef.current) {
      xtermRef.current.dispose();
      xtermRef.current = null;
    }
    // 不调 close_terminal，保留后端进程
    sessionIdRef.current = '';
    setConnected(false);
  }, []);

  // 刷新活跃会话列表
  const refreshSessions = useCallback(async () => {
    try {
      const list = await invoke<Array<{ session_id: string; tool_id: string; tool_name: string }>>('list_terminals');
      const ids = new Set(list.map(t => t.tool_id));
      setActiveSessions(ids);
    } catch (_) {}
  }, []);

  useEffect(() => {
    refreshSessions();
    const timer = setInterval(refreshSessions, 3000);
    return () => { clearInterval(timer); cleanup(); };
  }, [refreshSessions, cleanup]);

  // 初始化 xterm 实例（公共逻辑）
  const initXterm = useCallback(() => {
    if (!terminalRef.current) return null;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "'Cascadia Code', 'JetBrains Mono', Consolas, monospace",
      theme: {
        background: '#0a0a0f',
        foreground: '#e4e4ed',
        cursor: '#00f0ff',
        cursorAccent: '#0a0a0f',
        selectionBackground: 'rgba(0,240,255,0.25)',
        black: '#000000', red: '#ef4444', green: '#22c55e', yellow: '#f59e0b',
        blue: '#3b82f6', magenta: '#a855f7', cyan: '#00f0ff', white: '#e4e4ed',
        brightBlack: '#7a7a96', brightRed: '#f87171', brightGreen: '#4ade80',
        brightYellow: '#fbbf24', brightBlue: '#60a5fa', brightMagenta: '#c084fc',
        brightCyan: '#22d3ee', brightWhite: '#ffffff',
      },
      allowProposedApi: true,
      scrollback: 10000,
    });

    const fitAddon = new FitAddon();
    const webLinks = new WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(webLinks);
    term.open(terminalRef.current);
    fitAddon.fit();

    xtermRef.current = term;
    fitRef.current = fitAddon;

    // 自适应大小
    const observer = new ResizeObserver(() => {
      try { fitAddon.fit(); } catch(_) {}
    });
    if (terminalRef.current) observer.observe(terminalRef.current);
    unlistenRef.current.push(() => observer.disconnect());

    // 用户输入 → 后端
    term.onData(async (data: string) => {
      if (sessionIdRef.current) {
        try {
          await invoke('write_terminal', { sessionId: sessionIdRef.current, data });
        } catch (_) {}
      }
    });

    return term;
  }, []);

  // attach 到已有 session（重连）
  const attachSession = useCallback(async (term: Terminal, sid: string, toolId: string, toolName: string) => {
    sessionIdRef.current = sid;
    setActiveTerm({ sessionId: sid, toolId, toolName });
    setConnected(true);
    term.writeln(`\x1b[32m[GenHub] 重连到 ${toolName} (session: ${sid.substring(0, 20)}...)\x1b[0m\r\n`);

    // 监听输出
    const u1 = await listen('terminal_output', (e: any) => {
      if (e.payload.session_id === sid) {
        term.write(e.payload.data);
      }
    });
    unlistenRef.current.push(u1);

    // 监听退出
    const u2 = await listen('terminal_exit', (e: any) => {
      if (e.payload.session_id === sid) {
        term.writeln(`\r\n\x1b[33m[${toolName} 进程已退出]\x1b[0m`);
        setConnected(false);
        setActiveSessions(prev => {
          const next = new Set(prev);
          next.delete(toolId);
          return next;
        });
      }
    });
    unlistenRef.current.push(u2);
  }, []);

  // 启动工具终端
  const startTool = useCallback(async (toolId: string) => {
    // 先清理旧前端（不杀后端）
    cleanup();

    const tool = TOOLS.find(t => t.id === toolId);
    if (!tool) return;

    setActiveTool(toolId);
    setConnected(false);

    // 等待 DOM 渲染
    await new Promise(r => setTimeout(r, 50));

    // 检查是否已有活跃 session
    let existingSid: string | null = null;
    try {
      const list = await invoke<Array<{ session_id: string; tool_id: string; tool_name: string }>>('list_terminals');
      const found = list.find(t => t.tool_id === toolId);
      if (found) existingSid = found.session_id;
    } catch (_) {}

    const term = initXterm();
    if (!term) return;

    if (existingSid) {
      // 重连已有 session
      await attachSession(term, existingSid, toolId, tool.name);
      refreshSessions();
      return;
    }

    // 新建 session
    term.writeln(`\x1b[36m[GenHub] 正在启动 ${tool.name}...\x1b[0m`);
    if (terminalCwd) {
      term.writeln(`\x1b[90m[GenHub] 工作目录: ${terminalCwd}\x1b[0m`);
    }

    try {
      const sid = await invoke<string>('create_terminal_session', { 
        toolId,
        cwd: terminalCwd || null
      });
      sessionIdRef.current = sid;
      setActiveTerm({ sessionId: sid, toolId, toolName: tool.name });
      setConnected(true);
      term.writeln(`\x1b[32m[GenHub] ${tool.name} 已连接\x1b[0m\r\n`);

      // 自动发送工具启动命令到 shell
      const cmd = getToolCommand(toolId);
      if (GUI_TOOLS.has(toolId)) {
        term.writeln(`\x1b[33m[GenHub] ${tool.name} 是 GUI 应用，请在系统程序列表中启动\x1b[0m`);
        term.writeln(`\x1b[90m[GenHub] 提示: 可在下方终端手动执行 CLI 命令（如 npm 命令）\x1b[0m\r\n`);
      } else if (cmd) {
        try {
          await invoke('write_terminal', { sessionId: sid, data: `${cmd}\r\n` });
        } catch (_) {}
      }

      // 监听输出
      const u1 = await listen('terminal_output', (e: any) => {
        if (e.payload.session_id === sid) {
          term.write(e.payload.data);
        }
      });
      unlistenRef.current.push(u1);

      // 监听退出
      const u2 = await listen('terminal_exit', (e: any) => {
        if (e.payload.session_id === sid) {
          term.writeln(`\r\n\x1b[33m[${tool.name} 进程已退出]\x1b[0m`);
          setConnected(false);
          setActiveSessions(prev => {
            const next = new Set(prev);
            next.delete(toolId);
            return next;
          });
        }
      });
      unlistenRef.current.push(u2);

      refreshSessions();
      setActiveSessions(prev => new Set(prev).add(toolId));
    } catch (e: any) {
      term.writeln(`\r\n\x1b[31m[错误] 启动失败: ${e}\x1b[0m`);
    }
  }, [cleanup, refreshSessions, initXterm, attachSession]);

  // 停止当前工具（真正杀后端进程）
  const stopCurrent = useCallback(async () => {
    if (!activeTool) return;
    const sid = sessionIdRef.current;
    // 先清理前端
    cleanup();
    // 杀后端进程
    if (sid) {
      try { await invoke('close_terminal', { sessionId: sid }); } catch (_) {}
    }
    setActiveTool(null);
    setActiveTerm(null);
    refreshSessions();
  }, [activeTool, cleanup, refreshSessions]);

  return (
    <div className="tm-container">
      <div className="tm-header">
        <h2 className="tm-title">终端管理</h2>
        <span className="tm-subtitle">在 GenHub 内嵌启动 AI CLI 工具</span>
        <button className="tm-refresh-btn" onClick={refreshSessions} title="刷新状态">↻</button>
      </div>

      {/* 工作目录设置 */}
      <div className="tm-cwd-bar">
        <label className="tm-cwd-label">工作目录:</label>
        <input
          type="text"
          className="tm-cwd-input"
          placeholder="留空则使用用户主目录"
          value={terminalCwd}
          onChange={(e) => setTerminalCwd(e.target.value)}
          title="设置终端启动时的工作目录"
        />
        {terminalCwd && (
          <button 
            className="tm-cwd-clear" 
            onClick={() => setTerminalCwd('')}
            title="清空，使用默认目录"
          >
            ✕
          </button>
        )}
      </div>

      <div className="tm-body">
        {/* 左侧工具列表 */}
        <div className="tm-sidebar">
          {TOOLS.map(tool => {
            const isActive = activeTool === tool.id;
            const isRunning = activeSessions.has(tool.id);
            return (
              <div
                key={tool.id}
                className={`tm-tool-item${isActive ? ' active' : ''}`}
                onClick={() => isActive ? stopCurrent() : startTool(tool.id)}
              >
                <img className="tm-tool-icon" src={tool.icon} alt={tool.name} />
                <div className="tm-tool-info">
                  <span className="tm-tool-name">{tool.name}</span>
                  <span className="tm-tool-id">{tool.id}</span>
                </div>
                <span className={`tm-dot ${isRunning ? 'on' : 'off'}`} />
                <span className={`tm-action ${isActive ? 'stop' : (isRunning ? 'running' : 'start')}`}>
                  {isActive ? '⏹' : (isRunning ? '●' : '▶')}
                </span>
              </div>
            );
          })}
        </div>

        {/* 右侧终端区域 */}
        <div className="tm-terminal-area">
          {activeTool ? (
            <div className="tm-terminal-wrapper">
              <div className="tm-terminal-header">
                <span className={`tm-dot ${connected ? 'on' : 'off'}`} />
                <span className="tm-terminal-name">
                  {TOOLS.find(t => t.id === activeTool)?.name || activeTool}
                </span>
                <span className="tm-terminal-status">
                  {connected ? '运行中' : '已断开'}
                </span>
                <button className="tm-terminal-close" onClick={stopCurrent} title="关闭终端">✕</button>
              </div>
              <div ref={terminalRef} className="tm-xterm-host" />
            </div>
          ) : (
            <div className="tm-placeholder">
              <div className="tm-placeholder-icon">⚡</div>
              <p className="tm-placeholder-text">选择左侧工具启动终端</p>
              <p className="tm-placeholder-sub">点击工具卡片即可在 GenHub 内嵌运行</p>
            </div>
          )}
        </div>
      </div>

      <div className="tm-footer">
        <span>共 {activeSessions.size}/{TOOLS.length} 运行中</span>
      </div>
    </div>
  );
}
