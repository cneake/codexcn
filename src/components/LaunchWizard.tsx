// LaunchWizard.tsx - 启动引导：自动检测 + 一键安装 + 自动进聊天
import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface ToolDetectResult {
  tool_id: string;
  tool_name: string;
  installed: boolean;
  command: string;
}

const TOOL_INFO: Record<string, { name: string; logo: string; installTip: string }> = {
  'claude-code':  { name: 'Claude Code',      logo: '🤖', installTip: 'npm install -g @anthropic-ai/claude-code' },
  'codex':        { name: 'OpenAI Codex',     logo: '⚡', installTip: 'npm install -g openai-codex' },
  'gemini-cli':   { name: 'Gemini CLI',       logo: '🔮', installTip: 'npm install -g @google/gemini-cli' },
  'opencode':     { name: 'OpenCode',         logo: '💻', installTip: 'npm install -g @opencode-cli/core' },
  'openclaw':     { name: 'OpenClaw',         logo: '🦷', installTip: '随 QClaw 客户端自动安装' },
  'hermes-agent': { name: 'Hermes Agent',     logo: '🧠', installTip: 'npm install -g @ekkolab/hermes-agent' },
};

interface Props {
  onReady: (installedTools: string[]) => void;
}

export default function LaunchWizard({ onReady }: Props) {
  const [detecting, setDetecting] = useState(true);
  const [tools, setTools] = useState<ToolDetectResult[]>([]);
  const [installing, setInstalling] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // 自动检测
  useEffect(() => {
    const run = async () => {
      try {
        const results = await invoke<ToolDetectResult[]>('detect_installed_tools_cmd');
        setTools(results);
        const hasInstalled = results.some(t => t.installed);
        if (hasInstalled) {
          setDetecting(false);
          setDone(true);
          // 有已安装工具，1秒后自动进入主界面
          setTimeout(() => {
            onReady(results.filter(t => t.installed).map(t => t.tool_id));
          }, 1000);
        } else {
          setDetecting(false);
        }
      } catch (e) {
        console.error('检测失败', e);
        setDetecting(false);
      }
    };
    run();
  }, []);

  // 安装单个工具（一键安装）
  const handleInstall = async (toolId: string) => {
    setInstalling(toolId);
    try {
      const result = await invoke('install_tool', { toolId });
      alert(result);
      // 安装完成后刷新检测
      const results = await invoke<ToolDetectResult[]>('detect_tools');
      setTools(results);
      const hasInstalled = results.some(t => t.installed);
      if (hasInstalled) {
        setDone(true);
        setTimeout(() => onReady(results.filter(t => t.installed).map(t => t.tool_id)), 1000);
      }
    } catch (e: any) {
      alert('安装失败: ' + e);
    }
    setInstalling(null);
  };

  // 刷新检测（安装完成后重新检测）
  const handleRefresh = async () => {
    setDetecting(true);
    try {
      const results = await invoke<ToolDetectResult[]>('detect_installed_tools_cmd');
      setTools(results);
      const hasInstalled = results.some(t => t.installed);
      if (hasInstalled) {
        setDone(true);
        setTimeout(() => onReady(results.filter(t => t.installed).map(t => t.tool_id)), 1000);
      }
    } catch (e) {
      console.error(e);
    }
    setDetecting(false);
  };

  if (detecting) {
    return (
      <div className="launch-wizard">
        <div className="lw-center">
          <img src="/icon.png" alt="" className="lw-logo" />
          <h1 className="lw-title">GenHub</h1>
          <p className="lw-sub">AI CLI 工具统一配置管理器</p>
          <div className="lw-spinner">
            <div className="lw-dot" />
            <div className="lw-dot" />
            <div className="lw-dot" />
          </div>
          <p className="lw-hint">正在检测已安装的工具...</p>
        </div>
      </div>
    );
  }

  const hasInstalled = tools.some(t => t.installed);

  return (
    <div className="launch-wizard">
      <div className="lw-center">
        <img src="/icon.png" alt="" className="lw-logo" />
        <h1 className="lw-title">GenHub</h1>
        <p className="lw-sub">AI CLI 工具统一配置管理器</p>

        {done && hasInstalled && (
          <div className="lw-success">
            <div className="lw-success-icon">✅</div>
            <p className="lw-success-text">检测到已安装工具，正在进入...</p>
          </div>
        )}

        {!hasInstalled && (
          <>
            <div className="lw-desc">
              首次使用，请先安装一个 AI CLI 工具<br />
              <span style={{fontSize:12,color:'#888'}}>安装完成后刷新即可开始使用</span>
            </div>

            <div className="lw-grid">
              {tools.map(t => {
                const info = TOOL_INFO[t.tool_id] || { name: t.tool_name, logo: '❓', installTip: '' };
                return (
                  <div key={t.tool_id} className={`lw-card ${t.installed ? 'installed' : ''}`}>
                    <div className="lw-card-logo">{info.logo}</div>
                    <div className="lw-card-name">{info.name}</div>
                    {t.installed ? (
                      <div className="lw-card-status ok">✅ 已安装</div>
                    ) : (
                      <div className="lw-card-actions">
                        <div className="lw-card-tip">{info.installTip}</div>
                        <button
                          className="lw-btn-install"
                          onClick={() => handleInstall(t.tool_id)}
                          disabled={installing === t.tool_id}
                        >
                          {installing === t.tool_id ? '安装中...' : '📋 复制命令'}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <button className="lw-btn-refresh" onClick={handleRefresh}>
              🔄 刷新检测
            </button>

            <p className="lw-note">
              💡 复制命令后，在终端（PowerShell/CMD）中粘贴执行即可
            </p>
          </>
        )}
      </div>
    </div>
  );
}
