import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import './SandboxPanel.css';

interface Props {
  onClose: () => void;
}

const LANGUAGES = [
  { id: 'python', label: 'Python', ext: '.py' },
  { id: 'javascript', label: 'JavaScript', ext: '.js' },
  { id: 'shell', label: 'Shell', ext: '.bat' },
];

const TEMPLATES: Record<string, string> = {
  python: `# GenHub Sandbox — Python\nprint("Hello from GenHub!")\n\nfor i in range(5):\n    print(f"Count: {i}")`,
  javascript: `// GenHub Sandbox — JavaScript\nconsole.log("Hello from GenHub!");\n\nfor (let i = 0; i < 5; i++) {\n    console.log("Count:", i);\n}`,
  shell: `@echo off\necho Hello from GenHub!\nfor /l %%i in (1,1,5) do echo Count: %%i`,
};

export default function SandboxPanel({ onClose }: Props) {
  const [lang, setLang] = useState('python');
  const [code, setCode] = useState(TEMPLATES.python);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [output, setOutput] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [files, setFiles] = useState<Array<{ name: string; size: number }>>([]);
  const outputRef = useRef<HTMLDivElement>(null);

  // 创建/重置沙箱会话
  const resetSession = useCallback(async () => {
    const sid = await invoke<string>('create_sandbox_session');
    setSessionId(sid);
    setOutput([]);
    setExitCode(null);
    setFiles([]);
    return sid;
  }, []);

  // 初始化会话
  useEffect(() => {
    resetSession();
  }, [resetSession]);

  // 监听沙箱事件
  useEffect(() => {
    const unlistenOutput = listen<{ session_id: string; stream: string; text: string }>('sandbox_output', (e) => {
      if (e.payload.session_id === sessionId) {
        setOutput(prev => {
          const tag = e.payload.stream === 'stderr' ? '[stderr]' : '';
          return [...prev, tag ? `${tag} ${e.payload.text}` : e.payload.text];
        });
      }
    });
    const unlistenInfo = listen<{ session_id: string; script: string }>('sandbox_info', (e) => {
      if (e.payload.session_id === sessionId) {
        setOutput(prev => [...prev, `\$ 运行 ${e.payload.script}`]);
      }
    });
    const unlistenDone = listen<{ session_id: string; exit_code: number }>('sandbox_done', (e) => {
      if (e.payload.session_id === sessionId) {
        setRunning(false);
        setExitCode(e.payload.exit_code);
        setOutput(prev => [...prev, `\n\u2514\u2500\u2500 进程退出，代码: ${e.payload.exit_code}`]);
      }
    });
    return () => {
      unlistenOutput.then(f => f());
      unlistenInfo.then(f => f());
      unlistenDone.then(f => f());
    };
  }, [sessionId]);

  // 自动滚动到底部
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  // 切换语言
  const switchLang = (id: string) => {
    setLang(id);
    setCode(TEMPLATES[id]);
    setOutput([]);
    setExitCode(null);
  };

  // 运行
  const handleRun = async () => {
    if (!sessionId || running) return;
    setRunning(true);
    setOutput([]);
    setExitCode(null);
    try {
      await invoke('execute_sandbox_code', {
        sessionId,
        code,
        language: lang,
        timeoutSecs: 30,
      });
    } catch (err) {
      setOutput(prev => [...prev, `\n\u2716 执行失败: ${err}`]);
      setRunning(false);
    }
  };

  // 停止
  const handleStop = async () => {
    if (sessionId) {
      await invoke('stop_sandbox', { sessionId });
      setRunning(false);
    }
  };

  // 重置
  const handleReset = async () => {
    if (sessionId) await invoke('cleanup_sandbox', { sessionId });
    await resetSession();
  };

  // 清理
  useEffect(() => {
    return () => {
      if (sessionId) invoke('cleanup_sandbox', { sessionId });
    };
  }, [sessionId]);

  return (
    <div className="sandbox-panel">
      {/* 顶部栏 */}
      <div className="sandbox-header">
        <div className="sandbox-header-left">
          <span className="sandbox-icon">🧰</span>
          <span className="sandbox-title">代码沙箱</span>
        </div>
        <button className="sandbox-close" onClick={onClose}>✕</button>
      </div>

      {/* 语言选择 */}
      <div className="sandbox-lang-bar">
        {LANGUAGES.map(l => (
          <button
            key={l.id}
            className={`sandbox-lang-btn${lang === l.id ? ' active' : ''}`}
            onClick={() => switchLang(l.id)}
          >
            {l.label}
          </button>
        ))}
      </div>

      {/* 代码编辑器 */}
      <div className="sandbox-editor">
        <textarea
          className="sandbox-textarea"
          value={code}
          onChange={e => setCode(e.target.value)}
          placeholder="在这里编写代码..."
          spellCheck={false}
          disabled={running}
        />
      </div>

      {/* 控制按钮 */}
      <div className="sandbox-controls">
        {running ? (
          <button className="sandbox-btn sandbox-btn-stop" onClick={handleStop}>
            \u25a0\ufe0f 停止
          </button>
        ) : (
          <button className="sandbox-btn sandbox-btn-run" onClick={handleRun} disabled={!code.trim()}>
            ▶ 运行
          </button>
        )}
        <button className="sandbox-btn sandbox-btn-reset" onClick={handleReset} disabled={running}>
          🔄 重置
        </button>
      </div>

      {/* 输出 */}
      <div className="sandbox-output-wrap">
        <div className="sandbox-output-label">
          💬 输出
          {exitCode !== null && (
            <span className={`sandbox-exit-code ${exitCode === 0 ? 'ok' : 'err'}`}>
              退出码: {exitCode}
            </span>
          )}
        </div>
        <div className="sandbox-output" ref={outputRef}>
          {output.length === 0 ? (
            <span className="sandbox-output-empty">点击 ▶ 运行 执行代码</span>
          ) : (
            output.map((line, i) => (
              <div key={i} className="sandbox-output-line">
                {line}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
