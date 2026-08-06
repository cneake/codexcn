import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

interface ConflictItem {
  source: string;
  path: string;
  version: string;
  isDefault: boolean;
  runnable: boolean;
}

interface DiagnoseResult {
  hasConflict: boolean;
  items: ConflictItem[];
  defaultPath: string | null;
}

interface AgentTool {
  id: string;
  name: string;
  command: string;
  npmPkg: string;
  icon: string;
  type?: 'npm' | 'download';
  installUrl?: string;
  installed: boolean;
  localVersion: string | null;
  npmVersion: string | null;
  canUpgrade: boolean;
  upgrading: boolean;
  installing: boolean;
  checking: boolean;
  diagnosing: boolean;
  diagnoseResult: DiagnoseResult | null;
  showDiagnose: boolean;
}

const TOOLS: { id: string; name: string; command: string; npmPkg: string; icon: string; type?: 'npm' | 'download'; installUrl?: string }[] = [
  { id: 'claude-code', name: 'Claude Code', command: 'claude', npmPkg: '@anthropic-ai/claude-code', icon: '/icons/claude-code.png' },
  { id: 'claude-desktop', name: 'Claude Desktop', command: 'claude-desktop', npmPkg: '', icon: '/icons/claude-desktop.png' },
  { id: 'codex', name: 'Codex', command: 'codex', npmPkg: '@openai/codex', icon: '/icons/codex.png' },
  { id: 'gemini-cli', name: 'Gemini CLI', command: 'gemini', npmPkg: '@google/gemini-cli', icon: '/icons/gemini-cli.png' },
  { id: 'opencode', name: 'OpenCode', command: 'opencode', npmPkg: 'opencode', icon: '/icons/opencode.png' },
  { id: 'deepseek-cli', name: 'DeepSeek CLI', command: 'deepseek', npmPkg: '@sluisr/deepseek-cli', icon: '/icons/deepseek-cli.png' },
  { id: 'openclaw', name: 'OpenClaw', command: 'openclaw', npmPkg: 'openclaw', icon: '/icons/openclaw.png' },
  { id: 'hermes-agent', name: 'Hermes', command: 'hermes', npmPkg: 'hermes-agent', icon: '/icons/hermes.png' },
  { id: 'grok-build', name: 'Grok Build', command: 'grok', npmPkg: '', icon: '/icons/grok-build.png', type: 'download', installUrl: 'https://x.ai/cli' },
  { id: 'qoder-cli', name: 'Qoder CLI', command: 'qodercli', npmPkg: '@qoder-ai/qodercli', icon: '/icons/qoder.png' },
];

export default function AgentManager({ onToast, onClose }: { onToast: (msg: string) => void; onClose?: () => void }) {
  const [tools, setTools] = useState<AgentTool[]>([]);
  const [loading, setLoading] = useState(true);
  const [showRoute, setShowRoute] = useState(false);
  // 环境安装管理
  const [activeTab, setActiveTab] = useState<'agents'|'envs'>('agents');
  const [envs, setEnvs] = useState<{id:string,name:string,icon:string,url:string,installed:boolean}[]>([]);
  const [envLoading, setEnvLoading] = useState(false);
  // 实时安装进度（tool_id → 最近一条消息）
  const [installProgress, setInstallProgress] = useState<Record<string, string>>({});
  // 追踪当前弹窗对应的 toolId（ref 避免闭包陷阱）
  const modalToolIdRef = useRef<string>('');

  // 加载环境安装状态
  const loadEnvs = async () => {
    setEnvLoading(true);
    try {
      const det = await invoke('detect_tools_detail') as any[];
      const envList = [
        { id: 'node', name: 'Node.js', icon: '⬢', url: 'https://nodejs.org/' },
        { id: 'npm', name: 'npm', icon: '📦', url: 'https://docs.npmjs.com/' },
        { id: 'pnpm', name: 'pnpm', icon: '🚀', url: 'https://pnpm.io/' },
        { id: 'yarn', name: 'Yarn', icon: '🧶', url: 'https://yarnpkg.com/' },
        { id: 'python', name: 'Python', icon: '🐍', url: 'https://www.python.org/' },
        { id: 'git', name: 'Git', icon: '🌲', url: 'https://git-scm.com/' },
        { id: 'docker', name: 'Docker', icon: '🐳', url: 'https://www.docker.com/products/docker-desktop' },
      ];
      setEnvs(envList.map(e => {
        const d = det.find((x: any) => x.tool_id === `env-${e.id}`);
        return { ...e, installed: !!(d?.installed) };
      }));
    } catch { setEnvs([]); }
    setEnvLoading(false);
  };

  // 安装/升级弹窗
  const [progressModal, setProgressModal] = useState<{
    open: boolean;
    toolName: string;
    action: 'install' | 'upgrade';
    step: string;
    progress: number; // 0-100
    logs: string[];
    error: string | null;
    done: boolean;
  }>({ open: false, toolName: '', action: 'install', step: '准备中...', progress: 0, logs: [], error: null, done: false });

  // 听 Rust 端 progress 事件 → 更新弹窗
  useEffect(() => {
    const unlistenP = listen<{ tool_id: string; step: string; message: string }>(
      'tool_install_progress',
      (e) => {
        const { tool_id, step, message } = e.payload;
        setInstallProgress(prev => ({ ...prev, [tool_id]: message }));
        // 只更新当前操作的弹窗
        if (tool_id !== modalToolIdRef.current) return;
        const pct = step === 'start' ? 5
          : step === 'resolving' ? 25
          : step === 'downloading' ? 60
          : step === 'auditing' ? 85
          : step === 'done' ? 100
          : step === 'error' ? 0
          : 50;
        setProgressModal(prev => {
          if (!prev.open) return prev;
          return {
            ...prev,
            step: step === 'error' ? '❌ 失败' : message || prev.step,
            progress: pct,
            logs: [...prev.logs.slice(-49), `[${step}] ${message}`],
            error: step === 'error' ? message : prev.error,
            done: step === 'done' || step === 'error',
          };
        });
      }
    );
    return () => { unlistenP.then(fn => fn()); };
  }, []);

  const loadAll = async () => {
    setLoading(true);
    let installedIds: string[] = [];
    try {
      const det = await invoke('detect_tools_detail') as any[];
      installedIds = det.filter((d: any) => d.installed).map((d: any) => d.tool_id);
    } catch (_) {}

    const items: AgentTool[] = TOOLS.map(t => ({
      ...t,
      installed: installedIds.includes(t.id),
      localVersion: null,
      npmVersion: null,
      canUpgrade: false,
      upgrading: false,
      installing: false,
      checking: true,
      diagnosing: false,
      diagnoseResult: null,
      showDiagnose: false,
    }));
    setTools(items);

    const promises = items.map(async (item) => {
      try {
        const result = await invoke('check_tool_upgrade', { toolId: item.id }) as [string, string, boolean];
        return { id: item.id, localVersion: result[0] || null, npmVersion: result[1] || null, canUpgrade: result[2] };
      } catch {
        let localVer: string | null = null;
        let npmVer: string | null = null;
        if (item.installed) {
          try { localVer = await invoke('get_tool_local_version', { toolId: item.id }) as string; } catch {}
        }
        try { npmVer = await invoke('get_tool_npm_version', { toolId: item.id }) as string; } catch {}
        return { id: item.id, localVersion: localVer, npmVersion: npmVer, canUpgrade: false };
      }
    });

    const results = await Promise.all(promises);
    setTools(prev => prev.map(t => {
      const r = results.find(x => x.id === t.id);
      if (!r) return t;
      return { ...t, localVersion: r.localVersion, npmVersion: r.npmVersion, canUpgrade: r.canUpgrade, checking: false };
    }));
    setLoading(false);
  };

  useEffect(() => { loadAll(); }, []);

  const handleDiagnose = async (id: string) => {
    const tool = tools.find(t => t.id === id);
    if (tool?.showDiagnose) {
      setTools(prev => prev.map(t => t.id === id ? { ...t, showDiagnose: false } : t));
      return;
    }
    setTools(prev => prev.map(t => t.id === id ? { ...t, diagnosing: true, showDiagnose: true } : t));
    try {
      const result = await invoke('diagnose_tool_conflicts', { toolId: id }) as DiagnoseResult;
      setTools(prev => prev.map(t => t.id === id ? { ...t, diagnoseResult: result, diagnosing: false } : t));
    } catch (e: any) {
      onToast(`❌ 诊断失败: ${e?.message || e}`);
      setTools(prev => prev.map(t => t.id === id ? { ...t, diagnosing: false } : t));
    }
  };

  const handleInstall = async (id: string) => {
    const tool = TOOLS.find(t => t.id === id);
    if (!tool) return;
    if (tool.type === 'download' && tool.installUrl) {
      // download 类型：通过 PowerShell 静默安装
      modalToolIdRef.current = id;
      setProgressModal({ open: true, toolName: tool.name, action: 'install', step: '准备中...', progress: 5, logs: [], error: null, done: false });
      setTools(prev => prev.map(t => t.id === id ? { ...t, installing: true } : t));
      try {
        const result = await invoke('install_download_tool', { toolId: id, installUrl: tool.installUrl }) as string;
        setProgressModal(prev => ({ ...prev, step: '✅ 安装完成', progress: 100, done: true }));
        onToast(`✅ ${tool.name} 安装成功！请刷新页面使命令生效`);
        setTools(prev => prev.map(t => t.id === id ? { ...t, installed: true, installing: false } : t));
        setTimeout(() => setProgressModal(prev => ({ ...prev, open: false })), 2000);
      } catch (e: any) {
        setProgressModal(prev => ({ ...prev, step: '❌ 安装失败', progress: 0, error: e?.message || String(e), done: true }));
        onToast(`❌ ${tool.name} 安装失败: ${e?.message || e}`);
        setTools(prev => prev.map(t => t.id === id ? { ...t, installing: false } : t));
        setTimeout(() => setProgressModal(prev => ({ ...prev, open: false })), 3000);
      }
      return;
    }
    if (!tool.npmPkg) {
      onToast(`❌ ${tool.name} 不支持自动安装，请手动安装`);
      return;
    }
    modalToolIdRef.current = id;
    setProgressModal({ open: true, toolName: tool.name, action: 'install', step: '准备中...', progress: 5, logs: [], error: null, done: false });
    setTools(prev => prev.map(t => t.id === id ? { ...t, installing: true } : t));
    // 心跳兜底：npm 缓沖 stdout 时，进度条仍向前走（80% 后停）
    const heartbeat = setInterval(() => {
      setProgressModal(prev => prev.open && !prev.done && prev.progress < 80
        ? { ...prev, progress: Math.min(prev.progress + 5, 80) }
        : prev);
    }, 1500);
    try {
      const msg = await invoke('install_npm_tool_with_progress', { toolId: id, npmPackage: tool.npmPkg }) as string;
      clearInterval(heartbeat);
      setProgressModal(prev => ({ ...prev, step: '✅ 安装完成', progress: 100, done: true }));
      onToast(`✅ ${tool.name} 安装成功！请刷新页面使命令生效`);
      setTools(prev => prev.map(t => t.id === id ? { ...t, installed: true, installing: false } : t));
      setTimeout(() => setProgressModal(prev => ({ ...prev, open: false })), 1500);
    } catch (e: any) {
      clearInterval(heartbeat);
      const errMsg = e?.message || String(e);
      setProgressModal(prev => ({ ...prev, step: '❌ 安装失败', error: errMsg, done: true }));
      onToast(`❌ ${tool.name} 安装失败: ${errMsg}`);
      setTools(prev => prev.map(t => t.id === id ? { ...t, installing: false } : t));
    }
  };

  const handleUpgrade = async (id: string) => {
    const tool = TOOLS.find(t => t.id === id);
    modalToolIdRef.current = id;
    setProgressModal({ open: true, toolName: tool?.name || id, action: 'upgrade', step: '准备中...', progress: 5, logs: [], error: null, done: false });
    setTools(prev => prev.map(t => t.id === id ? { ...t, upgrading: true } : t));
    // 心跳兜底
    const heartbeat = setInterval(() => {
      setProgressModal(prev => prev.open && !prev.done && prev.progress < 80
        ? { ...prev, progress: Math.min(prev.progress + 5, 80) }
        : prev);
    }, 1500);
    try {
      const msg = await invoke('upgrade_npm_tool_with_progress', { toolId: id }) as string;
      clearInterval(heartbeat);
      setProgressModal(prev => ({ ...prev, step: '✅ 升级完成', progress: 100, done: true }));
      onToast(`✅ ${TOOLS.find(t => t.id === id)?.name} ${msg}`);
      let localVer: string | null = null;
      let npmVer: string | null = null;
      let canUpgrade = false;
      try {
        const result = await invoke('check_tool_upgrade', { toolId: id }) as [string, string, boolean];
        localVer = result[0] || null;
        npmVer = result[1] || null;
        canUpgrade = result[2];
      } catch {}
      setTools(prev => prev.map(t =>
        t.id === id ? { ...t, localVersion: localVer, npmVersion: npmVer, canUpgrade, upgrading: false } : t
      ));
      setTimeout(() => setProgressModal(prev => ({ ...prev, open: false })), 1500);
    } catch (e: any) {
      clearInterval(heartbeat);
      const errMsg = e?.message || String(e);
      setProgressModal(prev => ({ ...prev, step: '❌ 升级失败', error: errMsg, done: true }));
      onToast(`❌ 升级失败: ${errMsg}`);
      setTools(prev => prev.map(t => t.id === id ? { ...t, upgrading: false } : t));
    }
  };

  // 串行全部升级：共用一个进度弹窗，逐个升级
  const handleUpgradeAll = async () => {
    const upgradeList = tools.filter(t => t.canUpgrade);
    if (upgradeList.length === 0) return;
    const total = upgradeList.length;
    let current = 0;
    // 初始化弹窗（第一个工具）
    modalToolIdRef.current = upgradeList[0].id;
    setProgressModal({
      open: true,
      toolName: `${upgradeList[0].name} (1/${total})`,
      action: 'upgrade',
      step: '准备中...',
      progress: 5,
      logs: [],
      error: null,
      done: false,
    });
    setTools(prev => prev.map(t => t.id === upgradeList[0].id ? { ...t, upgrading: true } : t));
    for (const tool of upgradeList) {
      const heartbeat = setInterval(() => {
        setProgressModal(prev => prev.open && !prev.done && prev.progress < 90
          ? { ...prev, progress: Math.min(prev.progress + 3, 90) }
          : prev);
      }, 1500);
      try {
        const msg = await invoke('upgrade_npm_tool_with_progress', { toolId: tool.id }) as string;
        clearInterval(heartbeat);
        current++;
        if (current < total) {
          // 还有下一个工具，更新弹窗标题
          const next = upgradeList[current];
          modalToolIdRef.current = next.id;
          setProgressModal(prev => ({
            ...prev,
            toolName: `${next.name} (${current + 1}/${total})`,
            step: '准备中...',
            progress: 5,
            logs: [],
            done: false,
          }));
          setTools(prev => prev.map(t => t.id === next.id ? { ...t, upgrading: true } : t));
        } else {
          // 全部完成
          setProgressModal(prev => ({ ...prev, step: `✅ 全部升级完成 (${total}个)`, progress: 100, done: true }));
          onToast(`✅ ${total}个工具全部升级完成`);
        }
        // 刷新当前工具状态
        let localVer: string | null = null;
        let npmVer: string | null = null;
        let canUpgrade = false;
        try {
          const result = await invoke('check_tool_upgrade', { toolId: tool.id }) as [string, string, boolean];
          localVer = result[0] || null;
          npmVer = result[1] || null;
          canUpgrade = result[2];
        } catch {}
        setTools(prev => prev.map(t =>
          t.id === tool.id ? { ...t, localVersion: localVer, npmVersion: npmVer, canUpgrade, upgrading: false } : t
        ));
      } catch (e: any) {
        clearInterval(heartbeat);
        const errMsg = e?.message || String(e);
        setProgressModal(prev => ({ ...prev, step: `❌ ${tool.name} 升级失败`, error: errMsg, done: true }));
        onToast(`❌ ${tool.name} 升级失败: ${errMsg}`);
        setTools(prev => prev.map(t => t.id === tool.id ? { ...t, upgrading: false } : t));
        break; // 失败后停止
      }
    }
    // 2秒后关闭弹窗
    setTimeout(() => setProgressModal(prev => ({ ...prev, open: false })), 2000);
  };

  const handleUninstall = async (id: string) => {
    if (!confirm(`确定要卸载 ${TOOLS.find(t => t.id === id)?.name} 吗？`)) return;
    try {
      const msg = await invoke('uninstall_npm_tool', { toolId: id }) as string;
      onToast(`✅ ${TOOLS.find(t => t.id === id)?.name} ${msg}`);
      loadAll();
    } catch (e: any) {
      onToast(`❌ 卸载失败: ${e?.message || e}`);
    }
  };

  const updateCount = tools.filter(t => t.canUpgrade).length;

  const cardStyle: React.CSSProperties = {
    background: 'var(--card, #1a1a2e)',
    border: '1px solid var(--border, #2a2a3e)',
    borderRadius: 12,
    padding: 20,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  };

  const rowStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: 13,
  };

  const btnPrimary: React.CSSProperties = {
    padding: '8px 16px',
    borderRadius: 6,
    fontSize: 12,
    border: 'none',
    background: 'var(--cyan, #00d4aa)',
    color: '#000',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  };

  const btnSecondary: React.CSSProperties = {
    padding: '8px 16px',
    borderRadius: 6,
    fontSize: 12,
    border: '1px solid var(--border, #2a2a3e)',
    background: 'var(--bg2, #252538)',
    color: 'var(--text, #fff)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  };

  const tagYellow: React.CSSProperties = {
    background: '#d4a017',
    color: '#000',
    fontSize: 11,
    padding: '2px 8px',
    borderRadius: 4,
    fontWeight: 600,
  };

  const tagBlue: React.CSSProperties = {
    background: '#2563eb',
    color: '#fff',
    fontSize: 10,
    padding: '2px 6px',
    borderRadius: 4,
  };

  const tagCyan: React.CSSProperties = {
    background: 'var(--cyan, #00d4aa)',
    color: '#000',
    fontSize: 10,
    padding: '2px 6px',
    borderRadius: 4,
    fontWeight: 600,
  };

  const tagRed: React.CSSProperties = {
    background: '#dc2626',
    color: '#fff',
    fontSize: 10,
    padding: '2px 6px',
    borderRadius: 4,
    fontWeight: 600,
  };

  return (
    <div style={{ padding: 24, width: '100%', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text, #fff)', marginBottom: 4 }}>
            一键管理
          </div>
        <div style={{ fontSize: 13, color: 'var(--text2, #888)' }}>
          检测版本 · 诊断冲突 · 一键升级
        </div>
        </div>
        <button
          onClick={onClose}
          title="返回聊天"
          style={{
            background: 'transparent',
            border: '1px solid var(--border, #333)',
            borderRadius: 8,
            color: 'var(--text2, #888)',
            fontSize: 18,
            width: 36,
            height: 36,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          ×
        </button>
      </div>

      {/* Tab 切换 · Agent 工具 / 环境工具 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, borderBottom: '1px solid var(--border, #1e3a5f)', paddingBottom: 8 }}>
        <button
          onClick={() => setActiveTab('agents')}
          style={{
            padding: '8px 16px',
            borderRadius: 6,
            border: 'none',
            background: activeTab === 'agents' ? 'linear-gradient(135deg, #00f0ff, #a855f7)' : 'transparent',
            color: activeTab === 'agents' ? '#000' : 'var(--text2, #888)',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          🤖 Agent 工具
        </button>
        <button
          onClick={() => { setActiveTab('envs'); if (envs.length === 0) loadEnvs(); }}
          style={{
            padding: '8px 16px',
            borderRadius: 6,
            border: 'none',
            background: activeTab === 'envs' ? 'linear-gradient(135deg, #00f0ff, #a855f7)' : 'transparent',
            color: activeTab === 'envs' ? '#000' : 'var(--text2, #888)',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          ⚙️ 环境工具 {envs.length > 0 ? `(${envs.filter(e => e.installed).length}/${envs.length})` : ''}
        </button>
      </div>

      {/* 环境工具面板 */}
      {activeTab === 'envs' && (
        <div style={{ marginBottom: 16 }}>
          {envLoading ? <div style={{ color: 'var(--text2, #888)', fontSize: 12 }}>检测中...</div> : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
              {envs.map(e => (
                <div key={e.id} style={{ background: 'var(--card, #0a1224)', border: '1px solid var(--border, #1e3a5f)', borderRadius: 10, padding: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 24 }}>{e.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{e.name}</div>
                    <div style={{ fontSize: 11, color: e.installed ? '#4ade80' : 'var(--text2, #888)', marginTop: 2 }}>
                      {e.installed ? '✓ 已安装' : '✗ 未安装'}
                    </div>
                  </div>
                  {!e.installed && (
                    <button
                      onClick={() => invoke('open_url', { url: e.url })}
                      style={{ fontSize: 12, padding: '4px 12px', borderRadius: 6, border: 'none', background: 'linear-gradient(135deg, #00f0ff, #a855f7)', color: '#000', cursor: 'pointer', fontWeight: 600 }}
                    >安装</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Agent 工具面板 */}
      {activeTab === 'agents' && (
      <>
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <button onClick={loadAll} disabled={loading} style={btnSecondary}>
          ↻ {loading ? '刷新中...' : '刷新'}
        </button>
        <button onClick={() => setShowRoute(!showRoute)} style={btnSecondary}>
          🛣 路由 {showRoute ? '▲' : '▼'}
        </button>
        <button onClick={() => tools.filter(t => t.installed).forEach(t => handleDiagnose(t.id))} disabled={loading} style={btnSecondary}>
          🔍 诊断全部
        </button>
        <button onClick={handleUpgradeAll} disabled={updateCount === 0 || loading} style={{...btnPrimary, opacity: updateCount === 0 ? 0.5 : 1}}>
          🔄 全部升级 ({updateCount})
        </button>
        <button onClick={loadAll} disabled={loading} style={{...btnSecondary, background: 'var(--cyan, #00d4aa)', color: '#000', border: 'none'}}>
          🔎 一键检测
        </button>
      </div>

      {showRoute && (
        <div style={{marginBottom:20, padding:12, background:'var(--bg2)', borderRadius:8, fontSize:12, color:'var(--text2)'}}>
          <div style={{fontWeight:600, marginBottom:8}}>默认路由顺序</div>
          <div>1. Claude Code → 2. Codex → 3. Gemini CLI → 4. OpenCode → 5. DeepSeek CLI → 6. OpenClaw → 7. Hermes Agent</div>
        </div>
      )}

      {loading ? (
        <div style={{textAlign:'center', padding:40, color:'var(--text2)', fontSize:14}}>
          <div style={{marginBottom:8}}>⚙️ 工具组件加载中，请稍后</div>
          <div className="loading-dots" style={{fontSize:18}}>
            <span style={{color:'#ff0000'}}>.</span>
            <span style={{color:'#ff7f00'}}>.</span>
            <span style={{color:'#ffff00'}}>.</span>
            <span style={{color:'#00ff00'}}>.</span>
            <span style={{color:'#0000ff'}}>.</span>
            <span style={{color:'#4b0082'}}>.</span>
            <span style={{color:'#9400d3'}}>.</span>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
          {tools.map(t => (
            <div key={t.id} style={cardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                <img src={t.icon} alt={t.name} width="48" height="48" style={{ borderRadius: 12, background:'#fff', padding:4, boxShadow:'0 2px 8px rgba(0,0,0,0.3)' }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--text, #fff)' }}>{t.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>{t.command}</div>
                </div>
                {t.installed ? (
                  <span style={{...tagCyan, fontSize:11}}>✓ 已安装</span>
                ) : (
                  <span style={{...tagRed, fontSize:11}}>未安装</span>
                )}
              </div>

              <div style={{ fontSize: 12, color: 'var(--text2)', display:'flex', flexDirection:'column', gap:4 }}>
                <div style={rowStyle}>
                  <span>本地版本</span>
                  {t.checking ? (
                    <span style={{color:'var(--text3)'}}>检测中...</span>
                  ) : t.localVersion ? (
                    <span style={{color:'var(--text)'}}>{t.localVersion}</span>
                  ) : t.installed ? (
                    <span style={{...tagRed, fontSize:10}} title="无法读取版本号，可能命令不在 PATH 中">读取失败</span>
                  ) : (
                    <span style={{color:'var(--text3)'}}>—</span>
                  )}
                </div>
                <div style={rowStyle}>
                  <span>最新版本</span>
                  {t.type === 'download' ? (
                    <span style={{...tagCyan, fontSize:10}} title={t.installUrl || '通过下载安装'}>下载安装</span>
                  ) : t.npmVersion ? (
                    <span style={{color:'var(--cyan)'}}>{t.npmVersion}</span>
                  ) : (
                    <span style={{...tagRed, fontSize:10}} title="无法获取最新版本，可能网络问题或包名错误">获取失败</span>
                  )}
                </div>
                <div style={rowStyle}>
                  <span>状态</span>
                  {t.type === 'download' ? (
                    t.installed ? (
                      <span style={{...tagCyan}}>正常</span>
                    ) : (
                      <span style={{...tagCyan, fontSize:10}}>通过下载安装</span>
                    )
                  ) : t.canUpgrade ? (
                    <span style={{...tagYellow}}>可升级</span>
                  ) : t.installed && !t.localVersion ? (
                    <span style={{...tagRed, fontSize:10}} title="无法读取版本号，可能命令不在 PATH 中">读取失败</span>
                  ) : !t.npmVersion ? (
                    <span style={{...tagRed, fontSize:10}} title="无法获取最新版本，可能网络问题或包名错误">获取失败</span>
                  ) : t.installed ? (
                    <span style={{...tagCyan}}>正常</span>
                  ) : (
                    <span style={{color:'var(--text3)'}}>—</span>
                  )}
                </div>
              </div>

              {t.diagnoseResult && t.showDiagnose && (
                <div style={{marginTop:8, padding:8, background:'var(--bg)', borderRadius:6, fontSize:11, color:'var(--text2)', maxHeight:150, overflowY:'auto'}}>
                  <div style={{fontWeight:600, marginBottom:4}}>诊断结果：</div>
                  {t.diagnoseResult.hasConflict ? (
                    <div>
                      <div style={{color:'var(--red)'}}>⚠️ 发现冲突：</div>
                      {t.diagnoseResult.items.map((item, idx) => (
                        <div key={idx} style={{marginLeft:8, marginTop:2}}>
                          {item.source} → {item.path} ({item.version})
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{color:'var(--cyan)'}}>✅ 无冲突</div>
                  )}
                  {t.diagnoseResult.defaultPath && (
                    <div style={{marginTop:4}}>默认：{t.diagnoseResult.defaultPath}</div>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, marginTop: 'auto', flexWrap: 'wrap' }}>
                {!t.installed ? (
                  <button onClick={() => handleInstall(t.id)} disabled={t.installing} style={{...btnSecondary, opacity: 0.5, cursor:'pointer'}}>
                    {t.installing ? '安装中...' : '📥 安装'}
                  </button>
                ) : (
                  <button disabled={t.diagnosing} onClick={() => handleDiagnose(t.id)} style={btnSecondary}>
                    {t.diagnosing ? '诊断中...' : t.showDiagnose ? '收起诊断' : '🔍 诊断'}
                  </button>
                )}
                {!t.installed ? null : (
                  <button disabled={!t.canUpgrade || t.upgrading} onClick={() => handleUpgrade(t.id)} style={btnPrimary}>
                    {t.upgrading ? '升级中...' : '🔄 升级'}
                  </button>
                )}
                {t.installed && (
                  <button onClick={() => handleUninstall(t.id)} style={{...btnSecondary, borderColor:'var(--red)', color:'var(--red)'}}>
                    🗑️ 卸载
                  </button>
                )}
              </div>
              {(t.installing && installProgress[t.id]) && (
                <div style={{
                  fontSize: 11, color: 'var(--cyan)', marginTop: 6,
                  fontFamily: 'Consolas, monospace', wordBreak: 'break-all',
                  opacity: 0.9,
                }}>
                  ▸ {installProgress[t.id]}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {progressModal.open && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 9999,
        }}>
          <div style={{
            background: '#1a1a2e', border: '1px solid #00f0ff40',
            borderRadius: 12, padding: 28, width: 480, maxWidth: '92vw',
            boxShadow: '0 0 40px #00f0ff30',
          }}>
            {/* 标题 */}
            <div style={{ fontSize: 17, fontWeight: 600, color: '#fff', marginBottom: 6 }}>
              {progressModal.action === 'install' ? '📥 正在安装' : '🔄 正在升级'} {progressModal.toolName}
            </div>
            {/* 进度条 */}
            <div style={{ background: '#0d0d1a', borderRadius: 6, height: 10, margin: '14px 0 10px', overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: `${progressModal.progress}%`,
                background: progressModal.done
                  ? (progressModal.error ? '#ff4d6d' : '#00f0ff')
                  : 'linear-gradient(90deg, #00f0ff, #a855f7)',
                borderRadius: 6,
                transition: 'width 0.4s ease',
              }} />
            </div>
            {/* 百分比 + 状态 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: progressModal.error ? '#ff4d6d' : '#a0a0c0' }}>
                {progressModal.step}
              </span>
              <span style={{ fontSize: 12, color: '#a0a0c0' }}>
                {progressModal.progress}%
              </span>
            </div>
            {/* 日志区 */}
            {progressModal.logs.length > 0 && (
              <div style={{
                background: '#0d0d1a', borderRadius: 6, padding: '8px 10px',
                maxHeight: 140, overflowY: 'auto', fontSize: 11,
                fontFamily: 'Consolas, monospace', color: '#6ee7b7',
                marginBottom: 12, lineHeight: 1.6,
              }}>
                {progressModal.logs.map((l, i) => (
                  <div key={i} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{l}</div>
                ))}
              </div>
            )}
            {/* 错误信息 */}
            {progressModal.error && (
              <div style={{
                background: '#ff4d6d20', border: '1px solid #ff4d6d40',
                borderRadius: 6, padding: '6px 10px', fontSize: 11,
                color: '#ff8099', fontFamily: 'Consolas, monospace',
                marginBottom: 12, wordBreak: 'break-all',
              }}>
                {progressModal.error}
              </div>
            )}
            {/* 按钮 */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              {!progressModal.done && (
                <span style={{ fontSize: 11, color: '#606080', alignSelf: 'center' }}>执行中，请稍候...</span>
              )}
              {progressModal.done && (
                <button
                  onClick={() => setProgressModal(prev => ({ ...prev, open: false }))}
                  style={{
                    padding: '7px 20px', borderRadius: 6,
                    border: 'none', cursor: 'pointer', fontSize: 13,
                    background: '#00f0ff', color: '#000', fontWeight: 600,
                  }}
                >
                  确定
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      </>
      )}
    </div>
  );
}
