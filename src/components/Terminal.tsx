import { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import 'xterm/css/xterm.css';
import './Terminal.css';

interface TerminalPanelProps {
  toolId: string;
  toolName: string;
  onClose: () => void;
}

export default function TerminalPanel({ toolId, toolName, onClose }: TerminalPanelProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string>('');
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!terminalRef.current) return;

    // 初始化 xterm
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
        black: '#000000',
        red: '#ef4444',
        green: '#22c55e',
        yellow: '#f59e0b',
        blue: '#3b82f6',
        magenta: '#a855f7',
        cyan: '#00f0ff',
        white: '#e4e4ed',
        brightBlack: '#7a7a96',
        brightRed: '#f87171',
        brightGreen: '#4ade80',
        brightYellow: '#fbbf24',
        brightBlue: '#60a5fa',
        brightMagenta: '#c084fc',
        brightCyan: '#22d3ee',
        brightWhite: '#ffffff',
      },
      allowProposedApi: true,
      scrollback: 10000,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);

    term.open(terminalRef.current);
    fitAddon.fit();

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // 启动后端终端会话
    async function startSession() {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const sid = await invoke('create_terminal_session', { toolId }) as string;
        sessionIdRef.current = sid;
        setConnected(true);
        term.writeln('\x1b[36m[GenHub] 终端已连接...\x1b[0m');

        // 监听后端输出
        const { listen } = await import('@tauri-apps/api/event');
        const unlisten = await listen('terminal_output', (event: any) => {
          if (event.payload.session_id === sid) {
            term.write(event.payload.data);
          }
        });

        // 监听进程退出
        listen('terminal_exit', (event: any) => {
          if (event.payload.session_id === sid) {
            term.writeln('\r\n\x1b[33m[进程已退出]\x1b[0m');
            setConnected(false);
          }
        });

        return unlisten;
      } catch (e) {
        term.writeln(`\r\n\x1b[31m[错误] 启动失败: ${e}\x1b[0m`);
        return () => {};
      }
    }

    let unlistenPromise = startSession();

    // 用户输入 → 后端
    const handleData = async (data: string) => {
      if (!sessionIdRef.current) return;
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('write_terminal', { sessionId: sessionIdRef.current, data });
      } catch (_) {}
    };
    term.onData(handleData);

    // 窗口大小变化时自适应
    const observer = new ResizeObserver(() => {
      try { fitAddon.fit(); } catch(_) {}
    });
    if (terminalRef.current) observer.observe(terminalRef.current);

    return () => {
      unlistenPromise.then(u => u());
      term.dispose();
      observer.disconnect();
      // 关闭后端会话
      if (sessionIdRef.current) {
        import('@tauri-apps/api/core').then(({ invoke }) => {
          invoke('close_terminal', { sessionId: sessionIdRef.current }).catch(() => {});
        });
      }
    };
  }, [toolId]);

  return (
    <div className="terminal-panel">
      <div className="terminal-header">
        <div className="terminal-header-left">
          <span className="terminal-dot" style={{background: connected ? '#22c55e' : '#ef4444'}} />
          <span className="terminal-title">{toolName}</span>
          <span className="terminal-status">{connected ? '已连接' : '未连接'}</span>
        </div>
        <div className="terminal-header-right">
          <button className="terminal-btn" onClick={onClose} title="关闭">✕</button>
        </div>
      </div>
      <div ref={terminalRef} className="terminal-body" />
    </div>
  );
}
