import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import donateWechatImg from '../assets/donate-wechat.jpg';
import donateAlipayImg from '../assets/donate-alipay.jpg';

interface CleanupStats {
  deleted_files: number;
  freed_bytes: number;
  kept_checkpoints: number;
  removed_checkpoints: number;
  removed_deleted: number;
  removed_bak: number;
  removed_lock: number;
  current_session_size_mb: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onOpenAbout: () => void;
  onOpenTheme: () => void;
  onOpenUpdate: () => void;
  onOpenRiskNotice: () => void;
}

export default function SettingsModal({ open, onClose, onOpenAbout, onOpenTheme, onOpenUpdate, onOpenRiskNotice }: Props) {
  const [tab, setTab] = useState<'general' | 'data' | 'donate' | 'account'>('general');
  const [autoStart, setAutoStart] = useState(false);
  const [minToTray, setMinToTray] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState('');
  const [cleanupStats, setCleanupStats] = useState<CleanupStats | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const [estimating, setEstimating] = useState(false);
  // GenHub 亚蓝账户
  const ghUserRef = useRef<HTMLInputElement>(null);
  const ghPassRef = useRef<HTMLInputElement>(null);
  const [ghUsername, setGhUsername] = useState<string | null>(localStorage.getItem('genhub_username'));
  const [ghLogging, setGhLogging] = useState(false);
  const [ghErr, setGhErr] = useState<string | null>(null);
  const [ghMsg, setGhMsg] = useState<string | null>(null);

  const handleGhLogin = async () => {
    const u = ghUserRef.current?.value;
    const p = ghPassRef.current?.value;
    if (!u || !p) { setGhErr('请填写用户名和密码'); return; }
    setGhLogging(true); setGhErr(null); setGhMsg(null);
    try {
      const raw = await invoke<string>('genhub_login', { username: u, password: p });
      const data = JSON.parse(raw);
      if (data.success) {
        localStorage.setItem('genhub_username', data.username);
        localStorage.setItem('genhub_report_token', data.report_token);
        setGhUsername(data.username);
        setGhMsg('✅ 登录成功，已开始定时上报用量');
        // 首次上报
        invoke('genhub_report_usage', { reportToken: data.report_token }).catch(() => {});
      } else {
        setGhErr(JSON.stringify(data));
      }
    } catch (e: unknown) {
      setGhErr(String(e));
    } finally {
      setGhLogging(false);
    }
  };

  const handleGhLogout = () => {
    localStorage.removeItem('genhub_username');
    localStorage.removeItem('genhub_report_token');
    setGhUsername(null);
    setGhMsg(null);
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 5000);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const data = await invoke('export_all_configs') as string;
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `genhub_config_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('✅ 配置已导出');
    } catch (e: any) {
      showToast('❌ 导出失败: ' + (e.message || e));
    } finally {
      setExporting(false);
    }
  };

  // 加载时自动估算可清理空间
  useEffect(() => {
    if (!open) return;
    setEstimating(true);
    invoke('estimate_cleanable_space').then((s: any) => {
      setCleanupStats(s as CleanupStats);
    }).catch(() => {}).finally(() => setEstimating(false));
  }, [open]);

  const fmtBytes = (bytes: number) => {
    if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + ' GB';
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
    if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return bytes + ' B';
  };

  const handleCleanup = async () => {
    const msg = cleanupStats && cleanupStats.freed_bytes > 0
      ? `可释放 ${fmtBytes(cleanupStats.freed_bytes)}。删除后 session 缓存将从 ${cleanupStats.current_session_size_mb.toFixed(1)} MB 降至约 ${(cleanupStats.current_session_size_mb - cleanupStats.freed_bytes / 1048576).toFixed(1)} MB。\n\n确定继续？`
      : '当前无可清理空间，确定继续？';
    if (!confirm(msg)) return;
    setCleaning(true);
    try {
      const result = await invoke('cleanup_sessions_cache', { keepCheckpoints: 1 }) as CleanupStats;
      setCleanupStats(result);
      setToast(`✅ 清理完成：删了 ${result.deleted_files} 个文件，释放 ${fmtBytes(result.freed_bytes)}`);
    } catch (e: any) {
      setToast('❌ 清理失败: ' + (e.message || e));
    } finally {
      setCleaning(false);
    }
  };

  const handleImport = async () => {
    setImporting(true);
    try {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = async (e: any) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const text = await file.text();
        try {
          await invoke('import_all_configs', { data: JSON.parse(text), merge: false });
          showToast('✅ 配置已导入，部分设置需重启生效');
        } catch (err: any) {
          showToast('❌ 导入失败: ' + (err.message || err));
        }
      };
      input.click();
    } finally {
      setImporting(false);
    }
  };

  if (!open) return null;

  const tabs = [
    { id: 'general' as const, label: '⚙️ 通用', },
    { id: 'data' as const, label: '💾 数据', },
    { id: 'donate' as const, label: '💝 赞助', },
    { id: 'account' as const, label: '👤 账户', },
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ width: 520, maxWidth: '90vw' }}>
        <h3 style={{ marginTop: 0, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          ⚙️ 软件设置
        </h3>

        {/* Tab 切换 */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '1px solid var(--border, #333)' }}>
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                padding: '8px 18px',
                background: tab === t.id ? 'linear-gradient(135deg, #00f0ff22, #a855f722)' : 'transparent',
                border: 'none',
                borderBottom: tab === t.id ? '2px solid #00f0ff' : '2px solid transparent',
                color: tab === t.id ? '#00f0ff' : 'var(--text2, #888)',
                cursor: 'pointer',
                fontSize: 14,
                fontWeight: tab === t.id ? 600 : 400,
                transition: 'all 0.2s',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* 通用 */}
        {tab === 'general' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0' }}>
              <span>🖥️ 开机自动启动</span>
              <input type="checkbox" checked={autoStart} onChange={e => setAutoStart(e.target.checked)} />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0' }}>
              <span>🔻 关闭时最小化到托盘</span>
              <input type="checkbox" checked={minToTray} onChange={e => setMinToTray(e.target.checked)} />
            </label>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="btn-sm" onClick={onOpenTheme} style={{ flex: 1 }}>🎨 外观设置</button>
              <button className="btn-sm" onClick={onOpenUpdate} style={{ flex: 1 }}>🔄 检查更新</button>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-sm" onClick={onOpenAbout} style={{ flex: 1 }}>ℹ️ 关于</button>
              <button className="btn-sm" onClick={onOpenRiskNotice} style={{ flex: 1, borderColor: '#e74c3c', color: '#e74c3c' }}>⚠️ 风险提示</button>
            </div>
          </div>
        )}

        {/* 数据 */}
        {tab === 'data' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p style={{ color: 'var(--text2, #888)', fontSize: 13, margin: 0 }}>
              导出当前所有配置（Provider、工具设置、MCP 配置等）为 JSON 文件，可导入到其他设备。
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-accent" onClick={handleExport} disabled={exporting} style={{ flex: 1 }}>
                {exporting ? '⏳ 导出中…' : '📤 导出配置'}
              </button>
              <button className="btn-sm" onClick={handleImport} disabled={importing} style={{ flex: 1 }}>
                {importing ? '⏳ 导入中…' : '📥 导入配置'}
              </button>
            </div>
            {/* QClaw 缓存清理 */}
            <div style={{ borderTop: '1px solid var(--border, #333)', paddingTop: 16, marginTop: 4 }}>
              <p style={{ color: '#ff6b6b', fontSize: 13, margin: '0 0 8px' }}>⚠️ 危险操作</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button
                  className="btn-sm"
                  style={{ borderColor: '#ff6b6b', color: '#ff6b6b' }}
                  onClick={async () => {
                    if (confirm('确定要清除所有聊天记录？此操作不可恢复！')) {
                      try {
                        await invoke('clear_all_chat_data');
                        showToast('✅ 聊天记录已清除');
                      } catch (e: any) {
                        showToast('❌ 清除失败: ' + (e.message || e));
                      }
                    }
                  }}
                >
                  🗑️ 清除聊天记录
                </button>
                <button
                  className="btn-sm"
                  style={{ borderColor: '#e67e22', color: '#e67e22' }}
                  onClick={handleCleanup}
                  disabled={cleaning}
                >
                  {cleaning ? '⏳ 清理中…' : '🧹 清理存储空间'}
                  {estimating
                    ? ' (估算中…)'
                    : cleanupStats && cleanupStats.freed_bytes > 0
                      ? ` (可清理 ${fmtBytes(cleanupStats.freed_bytes)})`
                      : cleanupStats
                        ? ' (无需清理)'
                        : ''
                  }
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 账户 */}
        {tab === 'account' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p style={{ color: 'var(--text2, #888)', fontSize: 13, margin: 0 }}>
              登录网站会员后，软件用量将自动关联到你的「用户中心 → 使用统计」，可在网站后台查看。
            </p>
            {ghUsername ? (
              <>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#00f587' }}>
                  ✅ 已登录 · {ghUsername}
                </div>
                <p style={{ color: 'var(--text2, #888)', fontSize: 13, margin: 0 }}>
                  用量每 5 分钟自动上报。
                </p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn-sm" onClick={() => {
                    const token = localStorage.getItem('genhub_report_token');
                    if (!token) return;
                    invoke('genhub_report_usage', { reportToken: token }).then(() => setGhMsg('✅ 上报成功')).catch(() => setGhErr('上报失败'));
                  }} style={{ flex: 1 }}>📡 立即上报</button>
                  <button className="btn-sm" onClick={handleGhLogout} style={{ flex: 1, borderColor: '#ff6b6b', color: '#ff6b6b' }}>🔒 退出登录</button>
                </div>
                {ghMsg && <div style={{ fontSize: 13, color: '#00f587' }}>{ghMsg}</div>}
              </>
            ) : (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <input ref={ghUserRef} placeholder="用户名 (网站会员)" style={{
                    padding: '10px 12px', borderRadius: 6, border: '1px solid var(--border, #333)',
                    background: 'var(--bg2, #1a1a2e)', color: '#e0e0e0', fontSize: 14, outline: 'none',
                  }} />
                  <input ref={ghPassRef} placeholder="密码" type="password" style={{
                    padding: '10px 12px', borderRadius: 6, border: '1px solid var(--border, #333)',
                    background: 'var(--bg2, #1a1a2e)', color: '#e0e0e0', fontSize: 14, outline: 'none',
                  }} />
                </div>
                {ghErr && <div style={{ fontSize: 13, color: '#ff6b6b' }}>{ghErr}</div>}
                <button className="btn-accent" onClick={handleGhLogin} disabled={ghLogging}>
                  {ghLogging ? '登录中...' : '🔑 登录亚蓝账户'}
                </button>
              </>
            )}
          </div>
        )}

        {/* 赞助 */}
        {tab === 'donate' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center' }}>
            <p style={{ color: 'var(--text2, #888)', fontSize: 13, margin: 0, textAlign: 'center' }}>
              如果 GenHub 对你有帮助，欢迎赞助支持我们持续开发 🙏
            </p>
            <div style={{ display: 'flex', gap: 20, justifyContent: 'center' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ width: 180, height: 180, background: '#fff', borderRadius: 8, padding: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <img src={donateWechatImg} alt="微信支付" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                </div>
                <span style={{ fontSize: 12, color: 'var(--text2, #888)', marginTop: 4, display: 'block' }}>微信支付</span>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ width: 180, height: 180, background: '#fff', borderRadius: 8, padding: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <img src={donateAlipayImg} alt="支付宝" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                </div>
                <span style={{ fontSize: 12, color: 'var(--text2, #888)', marginTop: 4, display: 'block' }}>支付宝</span>
              </div>
            </div>
          </div>
        )}

        {/* Toast */}
        {toast && <div className="toast" style={{ marginTop: 12 }}>{toast}</div>}

        {/* 底部按钮 */}
        <div className="modal-btns" style={{ marginTop: 20 }}>
          <button className="btn-accent" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}
