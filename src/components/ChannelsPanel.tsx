// ChannelsPanel.tsx - 渠道管理面板（集成 OpenClaw 渠道/插件管理）
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';

// Types
interface GatewayStatus {
  running: boolean;
  port: number;
  token: string | null;
  version: string;
  channels: ChannelInfo[];
  error: string | null;
}

interface ChannelInfo {
  name: string;
  plugin_id: string;
  enabled: boolean;
  status: string;
  accounts: string[];
}

interface PluginInfo {
  name: string;
  plugin_id: string;
  enabled: boolean;
  version: string;
  description: string;
}

// 渠道 Logo（SVG inline）
const CHANNEL_LOGOS: Record<string, React.ReactElement> = {
  'wechat-access': (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="none">
      <path d="M8.5 11a1.5 1.5 0 100-3 1.5 1.5 0 000 3zm7 0a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" fill="#07C160"/>
      <path d="M12 2C6.477 2 2 6.145 2 11.243c0 2.936 1.526 5.55 3.926 7.227l-.926 2.781 3.425-2.223c1.023.282 2.098.434 3.2.434h.375c4.206 0 7.8-2.994 8.926-7.218C22 6.145 17.523 2 12 2zm-5.5 7.5c-.828 0-1.5.672-1.5 1.5s.672 1.5 1.5 1.5 1.5-.672 1.5-1.5-.672-1.5-1.5-1.5zm7 0c-.828 0-1.5.672-1.5 1.5s.672 1.5 1.5 1.5 1.5-.672 1.5-1.5-.672-1.5-1.5-1.5z" fill="#07C160"/>
    </svg>
  ),
  'wechat': (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="#07C160">
      <path d="M8.5 11a1.5 1.5 0 100-3 1.5 1.5 0 000 3zm7 0a1.5 1.5 0 100-3 1.5 1.5 0 000 3z"/>
      <path d="M12 2C6.477 2 2 6.145 2 11.243c0 2.936 1.526 5.55 3.926 7.227l-.926 2.781 3.425-2.223c1.023.282 2.098.434 3.2.434h.375c4.206 0 7.8-2.994 8.926-7.218C22 6.145 17.523 2 12 2z"/>
    </svg>
  ),
  'feishu': (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="#3370FF">
      <path d="M12 2L2 7v10l10 5 10-5V7L12 2zm0 2.18l6.9 3.45L12 11.09 5.1 7.63 12 4.18zM4 8.82l7 3.5v6.86l-7-3.5V8.82zm9 10.36v-6.86l7-3.5v6.86l-7 3.5z"/>
    </svg>
  ),
  'dingtalk': (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="#1677FF">
      <circle cx="12" cy="12" r="10" fill="#1677FF"/>
      <text x="12" y="16" textAnchor="middle" fill="white" fontSize="10" fontWeight="bold">钉</text>
    </svg>
  ),
  'wecom': (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="#07C160">
      <path d="M12 2C6.48 2 2 6.03 2 11c0 2.76 1.36 5.22 3.5 6.83V22l4.33-2.4c.85.24 1.75.38 2.67.38 5.52 0 10-4.03 10-9s-4.48-9-10-9zm-1 13H9v2h2v-2zm0-4H9v2h2V11zm4 4h-2v2h2v-2zm0-4h-2v2h2v-2z"/>
    </svg>
  ),
  'telegram': (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="#0088CC">
      <path d="M11.944 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0a12 12 0 00-.056 0zm4.162 7.27a.74.74 0 00.033.12c3.402 6.886 3.402 6.886 3.87 7.71l-.51 1.94-2.12-.88a.75.75 0 00-.87.27l-.72 1.4-1.4-4.47c-.14-.45-.52-.58-.9-.43l-2.38.95-1.8-1.72a.56.56 0 00-.35-.13c-.06.01-.12.04-.17.08l-.04.02-.03.01c-.04.02-.08.05-.11.09l0 0c-.03.03-.06.07-.08.12a.26.26 0 00-.02.11c.01.05.04.1.08.14l.03.03c.04.03.09.06.15.08l.11.02.04.01c.03 0 .06.01.09 0h.02l2.9-1.18 1.02 1.54c.19.28.58.37.87.19l2.2-1.61 4.37 3.2c.36.26.85.19 1.09-.18l.03-.04c.24-.37.02-.87-.44-1.03l-6.56-2.44a.45.45 0 00-.17-.03z"/>
    </svg>
  ),
  'slack': (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="#4A154B">
      <path d="M5.042 15.165a2.528 2.528 0 01-2.52 2.523A2.528 2.528 0 010 15.165a2.527 2.527 0 012.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 012.521-2.52 2.527 2.527 0 012.521 2.52v6.313A2.528 2.528 0 018.834 24a2.528 2.528 0 01-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 01-2.521-2.52A2.528 2.528 0 018.834 0a2.528 2.528 0 012.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 012.521 2.521 2.528 2.528 0 01-2.521 2.521H2.522A2.528 2.528 0 010 8.834a2.528 2.528 0 012.522-2.521h6.312zm10.122 2.521a2.528 2.528 0 012.522-2.521A2.528 2.528 0 0124 8.834a2.528 2.528 0 01-2.522 2.521h-2.522V8.834zm-1.268 0a2.528 2.528 0 01-2.523 2.521 2.527 2.527 0 01-2.52-2.521V2.522A2.527 2.527 0 0115.165 0a2.528 2.528 0 012.523 2.522v6.312zm-2.523 10.122a2.528 2.528 0 012.523 2.522A2.528 2.528 0 0115.165 24a2.527 2.527 0 01-2.52-2.522v-2.522h2.52zm0-1.268a2.527 2.527 0 01-2.52-2.523 2.526 2.526 0 012.52-2.52h6.313A2.527 2.527 0 0124 15.165a2.528 2.528 0 01-2.522 2.523h-6.313z"/>
    </svg>
  ),
};

const DEFAULT_CHANNEL_ICON = (
  <svg viewBox="0 0 24 24" width="28" height="28" fill="#666">
    <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V6h16v12zM4 0h16v2H4zm0 22h16v2H4zm8-10a2.5 2.5 0 000-5 2.5 2.5 0 000 5zm0 1c-1.67 0-5 .83-5 2.5V17h10v-1.5c0-1.67-3.33-2.5-5-2.5z"/>
  </svg>
);

// 渠道中文名
const CHANNEL_NAMES: Record<string, string> = {
  'wechat-access': '微信（腾讯通路）',
  'wechat': '微信',
  'feishu': '飞书',
  'dingtalk': '钉钉',
  'wecom': '企业微信',
  'telegram': 'Telegram',
  'slack': 'Slack',
};

function getChannelLogo(name: string): React.ReactElement {
  return CHANNEL_LOGOS[name] || DEFAULT_CHANNEL_ICON;
}

function getChannelLabel(name: string): string {
  return CHANNEL_NAMES[name] || name;
}

function getPluginCategory(pluginId: string): string {
  if (['wechat-access', 'wechat', 'wecom'].includes(pluginId)) return '通讯';
  if (['feishu', 'dingtalk', 'lark'].includes(pluginId)) return '办公';
  if (['telegram', 'slack', 'discord'].includes(pluginId)) return '社区';
  if (['browser', 'copilot-proxy'].includes(pluginId)) return '工具';
  return '其他';
}

// 状态颜色
function StatusBadge({ running, text }: { running: boolean; text: string }) {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '4px',
      padding: '2px 8px',
      borderRadius: '12px',
      fontSize: '12px',
      fontWeight: 500,
      background: running ? 'rgba(0,245,135,0.15)' : 'rgba(255,107,107,0.15)',
      color: running ? '#00f587' : '#ff6b6b',
      border: `1px solid ${running ? 'rgba(0,245,135,0.3)' : 'rgba(255,107,107,0.3)'}`,
    }}>
      <span style={{
        width: '6px', height: '6px', borderRadius: '50%',
        background: running ? '#00f587' : '#ff6b6b',
      }} />
      {text}
    </span>
  );
}

export default function ChannelsPanel() {
  const [openclawAvailable, setOpenclawAvailable] = useState<string | null>(null);
  const [gatewayStatus, setGatewayStatus] = useState<GatewayStatus | null>(null);
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [tab, setTab] = useState<'channels' | 'plugins'>('channels');

  // GenHub 亚蓝账户状态
  const ghUserRef = useRef<HTMLInputElement>(null);
  const ghPassRef = useRef<HTMLInputElement>(null);
  const [genhubUsername, setGenhubUsername] = useState<string | null>(localStorage.getItem('genhub_username'));
  const [genhubReportToken, setGenhubReportToken] = useState<string | null>(localStorage.getItem('genhub_report_token'));
  const [genhubLogging, setGenhubLogging] = useState(false);
  const [genhubErr, setGenhubErr] = useState<string | null>(null);

  const handleGenhubLogin = async (username: string, password: string) => {
    setGenhubLogging(true);
    setGenhubErr(null);
    try {
      const raw = await invoke<string>('genhub_login', { username, password });
      const data = JSON.parse(raw);
      if (data.success) {
        localStorage.setItem('genhub_username', data.username);
        localStorage.setItem('genhub_report_token', data.report_token);
        setGenhubUsername(data.username);
        setGenhubReportToken(data.report_token);
      } else {
        setGenhubErr(JSON.stringify(data));
      }
    } catch (e: unknown) {
      setGenhubErr(String(e));
    } finally {
      setGenhubLogging(false);
    }
  };

  const handleGenhubLogout = () => {
    localStorage.removeItem('genhub_username');
    localStorage.removeItem('genhub_report_token');
    setGenhubUsername(null);
    setGenhubReportToken(null);
  };

  const handleGenhubReport = useCallback(async () => {
    const token = localStorage.getItem('genhub_report_token');
    if (!token) return;
    try {
      await invoke<string>('genhub_report_usage', { reportToken: token });
    } catch (_e: unknown) {
      // 静默失败
    }
  }, []);

  const showMsg = useCallback((type: 'ok' | 'err', text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 3000);
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [check, status, chList, plList] = await Promise.all([
        invoke<string>('openclaw_check').catch((_e: unknown) => String(_e)),
        invoke<GatewayStatus>('gateway_status').catch((_e: unknown) => null as unknown as GatewayStatus),
        invoke<ChannelInfo[]>('channels_list').catch(() => []),
        invoke<PluginInfo[]>('plugins_list').catch(() => []),
      ]);
      setOpenclawAvailable(check);
      setGatewayStatus(status);
      setChannels(chList);
      setPlugins(plList);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // 5 分钟定时上报 GenHub 用量
  useEffect(() => {
    if (!genhubUsername) return;
    const token = localStorage.getItem('genhub_report_token');
    if (!token) return;
    handleGenhubReport();
    const interval = setInterval(handleGenhubReport, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [genhubUsername, handleGenhubReport]);

  const handleGatewayStart = async () => {
    setLoading(true);
    try {
      const status = await invoke<GatewayStatus>('gateway_start');
      setGatewayStatus(status);
      if (status.error) {
        showMsg('err', status.error);
      } else {
        showMsg('ok', `Gateway 已启动 (端口 ${status.port})`);
      }
      await loadAll();
    } catch (e: unknown) {
      showMsg('err', String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleGatewayStop = async () => {
    setLoading(true);
    try {
      const r = await invoke<string>('gateway_stop');
      setGatewayStatus(prev => prev ? { ...prev, running: false } : null);
      showMsg('ok', r);
      await loadAll();
    } catch (e: unknown) {
      showMsg('err', String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleToggleChannel = async (channel: string, enabled: boolean) => {
    try {
      const r = await invoke<string>('channel_set_enabled', { channel, enabled });
      showMsg('ok', r);
      await loadAll();
    } catch (e: unknown) {
      showMsg('err', String(e));
    }
  };

  // 按分类分组插件
  const groupedPlugins = plugins.reduce<Record<string, PluginInfo[]>>((acc, p) => {
    const cat = getPluginCategory(p.plugin_id);
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(p);
    return acc;
  }, {});

  return (
    <div style={{ padding: '20px', height: '100%', overflowY: 'auto', color: '#e0e0e0' }}>
      {/* Header */}
      <div style={{ marginBottom: '20px' }}>
        <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#00f0ff' }}>
          渠道管理
        </h2>
        <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#888' }}>
          通过 OpenClaw 管理微信、飞书、钉钉等消息渠道
        </p>
      </div>

      {/* Message */}
      {msg && (
        <div style={{
          padding: '10px 14px', borderRadius: '8px', marginBottom: '16px',
          fontSize: '13px',
          background: msg.type === 'ok' ? 'rgba(0,245,135,0.1)' : 'rgba(255,107,107,0.1)',
          border: `1px solid ${msg.type === 'ok' ? 'rgba(0,245,135,0.3)' : 'rgba(255,107,107,0.3)'}`,
          color: msg.type === 'ok' ? '#00f587' : '#ff6b6b',
        }}>
          {msg.text}
        </div>
      )}

      {/* OpenClaw 检查 */}
      <div style={{
        padding: '14px', borderRadius: '10px',
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.06)',
        marginBottom: '16px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '13px', color: '#aaa' }}>OpenClaw CLI:</span>
          {openclawAvailable?.startsWith('OpenClaw') ? (
            <StatusBadge running text="已安装" />
          ) : (
            <StatusBadge running={false} text="未安装" />
          )}
          {loading && <span style={{ color: '#666', fontSize: '12px' }}>加载中...</span>}

        </div>
        {!openclawAvailable?.startsWith('OpenClaw') && (
          <div style={{ marginTop: '10px', fontSize: '13px', color: '#888' }}>
            <code style={{ background: 'rgba(0,240,255,0.1)', padding: '2px 6px', borderRadius: '4px', color: '#00f0ff' }}>
              npm install -g @openclaw/cli
            </code>
          </div>
        )}
      </div>

      {/* Gateway 状态卡片 */}
      <div style={{
        padding: '14px', borderRadius: '10px',
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.06)',
        marginBottom: '16px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <div>
            <span style={{ fontSize: '14px', fontWeight: 600 }}>Gateway 服务</span>
            {gatewayStatus && (
              <span style={{ marginLeft: '10px' }}>
                <StatusBadge running={gatewayStatus?.running} text={gatewayStatus?.running ? `运行中 (端口 ${gatewayStatus?.port})` : '未运行'} />
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={handleGatewayStart}
              disabled={loading || gatewayStatus?.running}
              style={{
                padding: '6px 14px', borderRadius: '6px', border: 'none',
                background: gatewayStatus?.running ? 'rgba(255,255,255,0.05)' : 'rgba(0,245,135,0.2)',
                color: gatewayStatus?.running ? '#666' : '#00f587',
                cursor: gatewayStatus?.running ? 'not-allowed' : 'pointer',
                fontSize: '13px', fontWeight: 500,
              }}
            >启动</button>
            <button
              onClick={handleGatewayStop}
              disabled={loading || !gatewayStatus?.running}
              style={{
                padding: '6px 14px', borderRadius: '6px', border: 'none',
                background: !gatewayStatus?.running ? 'rgba(255,255,255,0.05)' : 'rgba(255,107,107,0.15)',
                color: !gatewayStatus?.running ? '#666' : '#ff6b6b',
                cursor: !gatewayStatus?.running ? 'not-allowed' : 'pointer',
                fontSize: '13px', fontWeight: 500,
              }}
            >停止</button>
            <button
              onClick={loadAll}
              disabled={loading}
              style={{
                padding: '6px 14px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)',
                background: 'rgba(255,255,255,0.05)', color: '#aaa',
                cursor: loading ? 'not-allowed' : 'pointer',
                fontSize: '13px',
              }}
            >刷新</button>
          </div>
        </div>
        {gatewayStatus?.error && (
          <div style={{ fontSize: '12px', color: '#888', marginTop: '6px' }}>
            {gatewayStatus.error}
          </div>
        )}
        {gatewayStatus?.running && (
          <div style={{ fontSize: '12px', color: '#666' }}>
            版本: {gatewayStatus.version} · 端口: {gatewayStatus.port}
          </div>
        )}
      </div>

      {/* GenHub 亚蓝账户卡片 */}
      <div style={{
        padding: '14px', borderRadius: '10px',
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.06)',
        marginBottom: '16px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <span style={{ fontSize: '14px', fontWeight: 600 }}>亚蓝账户</span>
          {genhubUsername && (
            <button onClick={handleGenhubLogout} style={{
              padding: '5px 12px', borderRadius: '6px', border: 'none',
              background: 'rgba(255,107,107,0.15)', color: '#ff6b6b',
              cursor: 'pointer', fontSize: '12px', fontWeight: 500,
            }}>退出</button>
          )}
        </div>
        {genhubUsername ? (
          <div>
            <div style={{ fontSize: '13px', color: '#00f587', marginBottom: '8px' }}>
              ✅ 已登录 · {genhubUsername}
            </div>
            <p style={{ fontSize: '12px', color: '#888', margin: '0 0 10px' }}>
              用量将自动定时上报到网站「使用统计」页面。
            </p>
            <button onClick={() => handleGenhubReport()} style={{
              padding: '5px 12px', borderRadius: '6px', border: '1px solid rgba(0,240,255,0.3)',
              background: 'rgba(0,240,255,0.08)', color: '#00f0ff',
              cursor: 'pointer', fontSize: '12px', fontWeight: 500,
            }}>立即上报</button>
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
              <input ref={ghUserRef} placeholder="用户名 (网站会员)" style={{
                flex: 1, padding: '8px 10px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)',
                background: 'rgba(255,255,255,0.05)', color: '#e0e0e0', fontSize: '13px',
                outline: 'none',
              }} />
              <input ref={ghPassRef} placeholder="密码" type="password" style={{
                flex: 1, padding: '8px 10px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)',
                background: 'rgba(255,255,255,0.05)', color: '#e0e0e0', fontSize: '13px',
                outline: 'none',
              }} />
            </div>
            {genhubErr && (
              <div style={{ fontSize: '12px', color: '#ff6b6b', marginBottom: '8px' }}>{genhubErr}</div>
            )}
            <button
              onClick={() => {
                const u = ghUserRef.current?.value;
                const p = ghPassRef.current?.value;
                if (u && p) handleGenhubLogin(u, p);
              }}
              disabled={genhubLogging}
              style={{
                padding: '6px 14px', borderRadius: '6px', border: 'none',
                background: genhubLogging ? 'rgba(255,255,255,0.05)' : 'rgba(0,240,255,0.15)',
                color: genhubLogging ? '#666' : '#00f0ff',
                cursor: genhubLogging ? 'not-allowed' : 'pointer',
                fontSize: '13px', fontWeight: 500,
              }}
            >{genhubLogging ? '登录中...' : '登录'}</button>
          </div>
        )}
      </div>

      {/* Tab 切换 */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '16px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        {(['channels', 'plugins'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '8px 16px', border: 'none', borderBottom: tab === t ? '2px solid #00f0ff' : '2px solid transparent',
              background: 'transparent', color: tab === t ? '#00f0ff' : '#666',
              cursor: 'pointer', fontSize: '13px', fontWeight: 500,
              transition: 'all 0.2s',
            }}
          >
            {t === 'channels' ? '渠道' : '插件'}
            {t === 'channels' && channels.length > 0 && (
              <span style={{ marginLeft: '6px', background: 'rgba(0,240,255,0.15)', color: '#00f0ff', padding: '1px 6px', borderRadius: '10px', fontSize: '11px' }}>
                {channels.length}
              </span>
            )}
            {t === 'plugins' && plugins.length > 0 && (
              <span style={{ marginLeft: '6px', background: 'rgba(168,85,247,0.15)', color: '#a855f7', padding: '1px 6px', borderRadius: '10px', fontSize: '11px' }}>
                {plugins.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* 渠道列表 */}
      {tab === 'channels' && (
        <div>
          {channels.length === 0 && !loading && (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: '#666', fontSize: '13px' }}>
              {gatewayStatus?.running ? '暂无可用渠道' : '请先启动 Gateway'}
            </div>
          )}
          <div style={{ display: 'grid', gap: '10px' }}>
            {channels.map(ch => (
              <div key={ch.plugin_id} style={{
                display: 'flex', alignItems: 'center', gap: '12px',
                padding: '14px', borderRadius: '10px',
                background: 'rgba(255,255,255,0.03)',
                border: `1px solid ${ch.enabled ? 'rgba(0,245,135,0.15)' : 'rgba(255,255,255,0.06)'}`,
              }}>
                {getChannelLogo(ch.plugin_id)}
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '14px', fontWeight: 500, color: ch.enabled ? '#e0e0e0' : '#666' }}>
                    {getChannelLabel(ch.name)}
                  </div>
                  <div style={{ fontSize: '12px', color: '#555', marginTop: '2px' }}>
                    {ch.plugin_id} · {ch.status}
                  </div>
                </div>
                <button
                  onClick={() => handleToggleChannel(ch.plugin_id, !ch.enabled)}
                  style={{
                    padding: '5px 12px', borderRadius: '6px', border: 'none',
                    background: ch.enabled ? 'rgba(255,107,107,0.15)' : 'rgba(0,245,135,0.15)',
                    color: ch.enabled ? '#ff6b6b' : '#00f587',
                    cursor: 'pointer', fontSize: '12px', fontWeight: 500,
                  }}
                >
                  {ch.enabled ? '禁用' : '启用'}
                </button>
              </div>
            ))}
          </div>

          {/* 快速添加渠道 */}
          <div style={{ marginTop: '20px' }}>
            <div style={{ fontSize: '13px', color: '#666', marginBottom: '10px' }}>快速添加渠道</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {[
                { label: '添加微信', channel: 'wechat' },
                { label: '添加飞书', channel: 'feishu' },
                { label: '添加钉钉', channel: 'dingtalk' },
                { label: '添加企业微信', channel: 'wecom' },
              ].map(item => (
                <button
                  key={item.label}
                  onClick={async () => {
                    try {
                      const r = await invoke<string>('channels_add_channel', { channel: item.channel });
                      showMsg('ok', r);
                      await loadAll();
                    } catch (e: unknown) {
                      showMsg('err', String(e));
                    }
                  }}
                  disabled={!gatewayStatus?.running || loading}
                  title={!gatewayStatus?.running ? '请先启动 Gateway' : ''}
                  style={{
                    padding: '6px 12px', borderRadius: '6px',
                    border: '1px solid rgba(0,245,135,0.2)',
                    background: gatewayStatus?.running ? 'rgba(0,245,135,0.08)' : 'rgba(255,255,255,0.03)',
                    color: gatewayStatus?.running ? '#00f587' : '#444',
                    cursor: gatewayStatus?.running ? 'pointer' : 'not-allowed',
                    fontSize: '12px',
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div style={{ fontSize: '11px', color: '#555', marginTop: '8px' }}>
              点击按钮直接添加渠道，首次使用需在弹出的配置向导中填写 App ID 等信息
            </div>
          </div>
        </div>
      )}

      {/* 插件列表 */}
      {tab === 'plugins' && (
        <div>
          {Object.entries(groupedPlugins).map(([cat, pls]) => (
            <div key={cat} style={{ marginBottom: '20px' }}>
              <div style={{ fontSize: '12px', color: '#666', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {cat}
              </div>
              <div style={{ display: 'grid', gap: '8px' }}>
                {pls.map(pl => (
                  <div key={pl.plugin_id} style={{
                    display: 'flex', alignItems: 'center', gap: '10px',
                    padding: '12px', borderRadius: '8px',
                    background: 'rgba(255,255,255,0.03)',
                    border: `1px solid ${pl.enabled ? 'rgba(168,85,247,0.2)' : 'rgba(255,255,255,0.06)'}`,
                  }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '13px', fontWeight: 500, color: pl.enabled ? '#e0e0e0' : '#666' }}>
                        {pl.name}
                      </div>
                      <div style={{ fontSize: '11px', color: '#555', marginTop: '2px' }}>
                        {pl.plugin_id} · v{pl.version}
                      </div>
                      {pl.description && (
                        <div style={{ fontSize: '11px', color: '#555', marginTop: '4px', lineHeight: 1.4 }}>
                          {pl.description.length > 80 ? pl.description.slice(0, 80) + '...' : pl.description}
                        </div>
                      )}
                    </div>
                    <StatusBadge running={pl.enabled} text={pl.enabled ? '已启用' : '已禁用'} />
                  </div>
                ))}
              </div>
            </div>
          ))}
          {plugins.length === 0 && !loading && (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: '#666', fontSize: '13px' }}>
              {gatewayStatus?.running ? '暂无可用插件' : '请先启动 Gateway'}
            </div>
          )}
        </div>
      )}

      {/* 底部说明 */}
      <div style={{ marginTop: '24px', padding: '14px', borderRadius: '8px', background: 'rgba(0,240,255,0.03)', border: '1px solid rgba(0,240,255,0.08)' }}>
        <div style={{ fontSize: '12px', fontWeight: 600, color: '#00f0ff', marginBottom: '6px' }}>💡 说明</div>
        <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '12px', color: '#888', lineHeight: 1.8 }}>
          <li>渠道通过 OpenClaw Gateway 管理，需先安装 <code style={{ color: '#00f0ff' }}>@openclaw/cli</code></li>
          <li>微信通道使用腾讯官方 iLink 协议，支持企业微信和微信公众号</li>
          <li>飞书、钉钉等办公渠道支持多账号管理和消息收发</li>
          <li>启动 Gateway 后会自动读取已配置的渠道，变更后需重启 Gateway</li>
        </ul>
      </div>
    </div>
  );
}
