import { useState, useEffect, useCallback, useRef, memo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-shell';
import './GitPanel.css';
import GitDiffModal from './GitDiffModal';
import { useDraggable } from './useDraggable';

// GitHub 菜单项组件 - 用 memo 防止重渲染
const GitHubMenuItem = memo(({ label, onClick }: { label: string; onClick: () => void }) => (
  <button className="git-panel-menu-item" onClick={onClick}>
    {label}
  </button>
));

interface GitStatusEntry {
  index_status: string;
  worktree_status: string;
  path: string;
  is_untracked: boolean;
  is_staged: boolean;
  is_modified: boolean;
}

interface GitStatusResult {
  is_repo: boolean;
  branch: string | null;
  files: GitStatusEntry[];
  staged_count: number;
  modified_count: number;
  untracked_count: number;
  ahead: number;
  behind: number;
  workspace_dir: string;
}

interface GitLogEntry {
  hash: string;
  short_hash: string;
  message: string;
  author: string;
  date: string;
}

interface GitLogResult {
  success: boolean;
  commits: GitLogEntry[];
  stdout: string;
}

interface GitCommitResult {
  success: boolean;
  message: string;
  stdout: string;
  stderr: string;
}

interface GitPushResult {
  success: boolean;
  message: string;
}

interface GitPullResult {
  success: boolean;
  message: string;
}

interface GitPanelProps {
  visible: boolean;
  onClose: () => void;
  workspaceDir: string;
  onWorkspaceChange?: (dir: string) => void;
  onOpenFile?: (path: string, content: string) => void; // 打开真实文件回调
}

interface DirEntry {
  name: string;
  is_dir: boolean;
  is_file: boolean;
}

export default function GitPanel({ visible, onClose, workspaceDir, onWorkspaceChange, onOpenFile }: GitPanelProps) {
  const [status, setStatus] = useState<GitStatusResult | null>(null);
  const [logs, setLogs] = useState<GitLogResult | null>(null);
  const [commitMsg, setCommitMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [commitLoading, setCommitLoading] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [githubMenuOpen, setGithubMenuOpen] = useState(false);
  const [dirMenuOpen, setDirMenuOpen] = useState(false);
  const [pullLoading, setPullLoading] = useState(false);
  const githubMenuRef = useRef<HTMLDivElement>(null);
  const dirMenuRef = useRef<HTMLDivElement>(null);
  const dragContainerRef = useRef<HTMLDivElement>(null);
  const dragHandleRef = useRef<HTMLDivElement>(null);
  useDraggable(dragHandleRef, dragContainerRef);
  const menuClosingRef = useRef(false);

  // 点击外部关闭菜单
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      // 如果菜单项刚被点击过，跳过这次检查
      if (menuClosingRef.current) {
        menuClosingRef.current = false;
        return;
      }
      if (githubMenuRef.current && !githubMenuRef.current.contains(e.target as Node)) {
        setGithubMenuOpen(false);
      }
      if (dirMenuRef.current && !dirMenuRef.current.contains(e.target as Node)) {
        setDirMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 菜单项点击时标记，正在关闭菜单
  const closeGithubMenu = () => {
    menuClosingRef.current = true;
    setGithubMenuOpen(false);
  };
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [activeTab, setActiveTab] = useState<'files' | 'history'>('files');
  const [dirEntries, setDirEntries] = useState<DirEntry[] | null>(null);
  const [diffFile, setDiffFile] = useState<string | null>(null); // 当前查看 diff 的文件路径
  const [editFile, setEditFile] = useState<{ path: string; content: string } | null>(null); // 当前编辑的真实文件

  const showToast = useCallback((type: 'ok' | 'err', text: string) => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const fetchStatus = useCallback(async (dir?: string) => {
    const targetDir = dir || workspaceDir;
    if (!targetDir) return;
    
    // 先检查 .git 目录是否存在（避免在非Git目录执行git命令卡住）
    try {
      const entries = await invoke<DirEntry[]>('read_dir_entries', { dir: targetDir });
      const hasGit = entries.some(e => e.name === '.git' && e.is_dir);
      if (!hasGit) {
        // 非 Git 仓库，只显示目录文件
        setStatus({ is_repo: false, branch: null, files: [], staged_count: 0, modified_count: 0, untracked_count: 0, ahead: 0, behind: 0, workspace_dir: targetDir });
        setLogs({ success: true, commits: [], stdout: '' });
        setDirEntries(entries);
        setLoading(false);
        return;
      }
    } catch (e) {
      console.error('read_dir error:', e);
      setLoading(false);
      return;
    }
    
    setLoading(true);
    
    // 超时保护（5秒）
    const timeout = setTimeout(() => {
      setLoading(false);
      showToast('err', 'Git 操作超时');
    }, 5000);
    
    try {
      const [s, l] = await Promise.all([
        invoke<GitStatusResult>('get_git_status', { dir: targetDir }),
        invoke<GitLogResult>('get_git_log', { dir: targetDir, count: 10 }),
      ]);
      clearTimeout(timeout);
      setStatus(s);
      setLogs(l);
      // 如果不是 Git 仓库，读取目录文件列表
      if (!s.is_repo) {
        const entries = await invoke<DirEntry[]>('read_dir_entries', { dir: targetDir });
        setDirEntries(entries);
      } else {
        setDirEntries(null);
      }
    } catch (e) {
      clearTimeout(timeout);
      console.error('git status error', e);
    } finally {
      clearTimeout(timeout);
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (visible && workspaceDir) {
      fetchStatus(workspaceDir);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, workspaceDir]);

  const handleCommit = async () => {
    if (!commitMsg.trim()) {
      showToast('err', '提交信息不能为空');
      return;
    }
    setCommitLoading(true);
    try {
      const result = await invoke<GitCommitResult>('git_commit', {
        dir: workspaceDir,
        message: commitMsg,
      });
      if (result.success) {
        showToast('ok', '提交成功');
        setCommitMsg('');
        fetchStatus();
      } else {
        showToast('err', result.message || '提交失败');
      }
    } catch (e) {
      showToast('err', String(e));
    } finally {
      setCommitLoading(false);
    }
  };

  const handlePush = async () => {
    setPushLoading(true);
    try {
      const result = await invoke<GitPushResult>('git_push', { dir: workspaceDir });
      if (result.success) {
        showToast('ok', '推送成功');
        fetchStatus();
      } else {
        showToast('err', result.message || '推送失败');
      }
    } catch (e) {
      showToast('err', String(e));
    } finally {
      setPushLoading(false);
    }
  };

  const handlePull = async () => {
    setPullLoading(true);
    try {
      const result = await invoke<GitPullResult>('git_pull', { dir: workspaceDir });
      if (result.success) {
        showToast('ok', '拉取成功');
        fetchStatus();
      } else {
        showToast('err', result.message || '拉取失败');
      }
    } catch (e) {
      showToast('err', String(e));
    } finally {
      setPullLoading(false);
    }
  };

  const getFileIcon = (entry: GitStatusEntry) => {
    if (entry.is_untracked) return { color: '#9ca3af', symbol: '?' };
    if (entry.is_staged) return { color: '#22c55e', symbol: 'A' };
    if (entry.is_modified) return { color: '#f97316', symbol: 'M' };
    return { color: '#6b7280', symbol: '?' };
  };

  const handleFileClick = (entry: GitStatusEntry) => {
    // 修改的文件打开 diff 查看
    if (entry.is_modified || entry.is_staged) {
      setDiffFile(entry.path);
    }
  };

  if (!visible) return null;

  return (
    <div className="git-panel-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="git-panel" ref={dragContainerRef}>
        {/* Header - 合并分支信息 */}
        <div className="git-panel-header" ref={dragHandleRef} style={{ cursor: 'move' }}>
          <div className="git-panel-title-row">
            <div className="git-panel-title">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00f0ff" strokeWidth="2">
                <circle cx="12" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/>
                <path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9"/>
                <path d="M12 12v3"/>
              </svg>
              <span>Git</span>
            </div>
            {/* 分支信息整合到 header */}
            {status?.is_repo && (
              <div className="git-header-meta">
                <span className="git-header-branch">{status.branch === 'master' ? '主分支' : (status.branch || '主分支')}</span>
                {status.ahead > 0 && <span className="git-header-chip ahead">↑{status.ahead}</span>}
                {status.behind > 0 && <span className="git-header-chip behind">↓{status.behind}</span>}
                {status.ahead === 0 && status.behind === 0 && logs?.commits && logs.commits.length > 0 && (
                  <span className="git-header-chip synced">✓</span>
                )}
              </div>
            )}
          </div>
          <div className="git-panel-header-actions">
            <button
              className="git-panel-open-folder"
              onClick={async () => {
                try {
                  const selected = await invoke<string | null>('pick_folder');
                  if (selected) {
                    await invoke('set_workspace_dir', { dir: selected });
                    onWorkspaceChange?.(selected);
                    showToast('ok', '已切换工作目录');
                  }
                } catch (e) {
                  showToast('err', String(e));
                }
              }}
              title="打开文件夹"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              </svg>
              <span>打开</span>
            </button>
            {/* 普通目录 / GitHub 菜单 */}
            {status?.is_repo ? (
              /* GitHub 菜单 - Git 仓库时显示 */
              <div className="git-panel-menu-wrapper" ref={githubMenuRef}>
                <button
                  className="git-panel-menu-btn"
                  onClick={() => setGithubMenuOpen(!githubMenuOpen)}
                  title="GitHub"
                >
                  <svg width="14" height="14" viewBox="0 0 32 32" fill="currentColor"><path d="M16 0C7.16 0 0 7.16 0 16C0 23.08 4.58 29.06 10.94 31.18C11.74 31.32 12.04 30.84 12.04 30.42C12.04 30.04 12.02 28.78 12.02 27.44C8 28.18 6.96 26.46 6.64 25.56C6.46 25.1 5.68 23.68 5 23.3C4.44 23 3.64 22.26 4.98 22.24C6.24 22.22 7.14 23.4 7.44 23.88C8.88 26.3 11.18 25.62 12.1 25.2C12.24 24.16 12.66 23.46 13.12 23.06C9.56 22.66 5.84 21.28 5.84 15.16C5.84 13.42 6.46 11.98 7.48 10.86C7.32 10.46 6.76 8.82 7.64 6.62C7.64 6.62 8.98 6.2 12.04 8.26C13.32 7.9 14.68 7.72 16.04 7.72C17.4 7.72 18.76 7.9 20.04 8.26C23.1 6.18 24.44 6.62 24.44 6.62C25.32 8.82 24.76 10.46 24.6 10.86C25.62 11.98 26.24 13.4 26.24 15.16C26.24 21.3 22.5 22.66 18.94 23.06C19.52 23.56 20.02 24.52 20.02 26.02C20.02 28.16 20 29.88 20 30.42C20 30.84 20.3 31.34 21.1 31.18C27.42 29.06 32 23.06 32 16C32 7.16 24.84 0 16 0Z"/></svg>
                  <span>GitHub</span>
                  <span style={{ fontSize: '10px' }}>▼</span>
                </button>
                {githubMenuOpen && (
                  <div className="git-panel-menu">
                    <GitHubMenuItem
                      label="克隆仓库"
                      onClick={async () => {
                        closeGithubMenu();
                        try {
                          const selected = await invoke<string | null>('pick_folder');
                          if (!selected) return;
                          const url = window.prompt('输入 GitHub 仓库地址 (https://github.com/user/repo.git)');
                          if (!url) return;
                          await invoke('git_clone', { url, dir: selected });
                          await invoke('set_workspace_dir', { dir: `${selected}/${url.split('/').pop()?.replace('.git', '')}` });
                          onWorkspaceChange?.(`${selected}/${url.split('/').pop()?.replace('.git', '')}`);
                          showToast('ok', '克隆成功');
                        } catch (e) {
                          showToast('err', String(e));
                        }
                      }}
                    />
                    <GitHubMenuItem
                      label="创建仓库"
                      onClick={() => { closeGithubMenu(); open('https://github.com/new'); }}
                    />
                    <GitHubMenuItem
                      label="在 GitHub 上查看"
                      onClick={() => {
                        closeGithubMenu();
                        invoke<string>('get_github_url', { dir: workspaceDir })
                          .then(url => open(url))
                          .catch(() => open('https://github.com'));
                      }}
                    />
                    <div className="git-panel-menu-divider"/>
                    <GitHubMenuItem
                      label="设置 Token"
                      onClick={() => { closeGithubMenu(); open('https://github.com/settings/tokens'); }}
                    />
                  </div>
                )}
              </div>
            ) : (
              /* 普通目录菜单 - 非 Git 仓库时显示 */
              <div className="git-panel-menu-wrapper" ref={dirMenuRef}>
                <button
                  className="git-panel-menu-btn"
                  onClick={() => setDirMenuOpen(!dirMenuOpen)}
                  title="普通目录"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                  </svg>
                  <span>普通目录</span>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginLeft: 2 }}>
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
                </button>
                {dirMenuOpen && (
                  <div className="git-panel-menu">
                    <button
                      className="git-panel-menu-item"
                      onClick={async () => {
                        setDirMenuOpen(false);
                        try {
                          await invoke('git_init', { dir: workspaceDir });
                          showToast('ok', 'Git 仓库初始化成功');
                          fetchStatus();
                        } catch (e) {
                          showToast('err', String(e));
                        }
                      }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/>
                        <path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9"/>
                        <path d="M12 12v3"/>
                      </svg>
                      初始化 Git 仓库
                    </button>
                  </div>
                )}
              </div>
            )}
            <button className="git-panel-close" onClick={onClose}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="git-panel-tabs">
          <button className={`git-tab ${activeTab === 'files' ? 'active' : ''}`} onClick={() => setActiveTab('files')}>
            文件 ({status?.is_repo ? (status?.files.length ?? 0) : (dirEntries?.length ?? 0)})
          </button>
          <button className={`git-tab ${activeTab === 'history' ? 'active' : ''}`} onClick={() => setActiveTab('history')}>
            历史
          </button>
        </div>

        {/* Content */}
        <div className="git-panel-content">
          {activeTab === 'files' ? (
            <>
              {!status?.is_repo ? (
                // 非 Git 仓库：显示文件列表
                <div className="git-dir-list">
                  <div className="git-dir-header">
                    <span className="git-dir-path">{workspaceDir}</span>
                    <span className="git-dir-count">{dirEntries?.length ?? 0} 项</span>
                  </div>
                  {loading && dirEntries === null ? (
                    <div className="git-loading">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#00f0ff" strokeWidth="2" className="git-spin">
                        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                      </svg>
                      <span>正在加载文件，请稍后……</span>
                    </div>
                  ) : dirEntries && dirEntries.length > 0 ? (
                    <>
                      {/* 返回上一级按钮 */}
                      <div
                        className="git-dir-entry git-dir-back"
                        onClick={async () => {
                          const parentDir = workspaceDir.split(/[\\\/]/).slice(0, -1).join('\\');
                          if (parentDir) {
                            try {
                              await invoke('set_workspace_dir', { dir: parentDir });
                              onWorkspaceChange?.(parentDir);
                            } catch (e) {
                              showToast('err', String(e));
                            }
                          }
                        }}
                        style={{ cursor: 'pointer' }}
                      >
                        <span className="git-dir-icon">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00f0ff" strokeWidth="2">
                            <path d="M19 12H5M12 19l-7-7 7-7"/>
                          </svg>
                        </span>
                        <span className="git-dir-name" style={{ color: '#00f0ff' }}>返回上一级</span>
                      </div>
                      {/* 目录列表 */}
                      {dirEntries.map((entry, i) => (
                      <div
                        key={i}
                        className="git-dir-entry"
                        onClick={() => {
                          if (entry.is_dir) {
                            const newPath = `${workspaceDir}\\${entry.name}`;
                            invoke('set_workspace_dir', { dir: newPath })
                              .then(() => onWorkspaceChange?.(newPath))
                              .catch(e => showToast('err', String(e)));
                          }
                        }}
                        title={entry.is_dir ? '点击进入' : ''}
                        style={{ cursor: entry.is_dir ? 'pointer' : 'default' }}
                      >
                        <span className="git-dir-icon">
                          {entry.is_dir ? (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#e3b341" strokeWidth="2">
                              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                            </svg>
                          ) : (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2">
                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                              <polyline points="14 2 14 8 20 8"/>
                            </svg>
                          )}
                        </span>
                        <span className="git-dir-name">{entry.name}</span>
                        {entry.is_dir && <span className="git-dir-arrow">›</span>}
                      </div>
                    ))}
                    </>
                  ) : (
                    <div className="git-empty">
                      <p>空目录</p>
                    </div>
                  )}
                </div>
              ) : status.files.length === 0 ? (
                <div className="git-empty">
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="1.5">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  <p>工作区干净</p>
                </div>
              ) : (
                <div className="git-file-list">
                  {status.files.map((entry, i) => {
                    const icon = getFileIcon(entry);
                    const statusClass = entry.is_staged ? 'staged' : entry.is_modified ? 'modified' : entry.is_untracked ? 'untracked' : '';
                    return (
                      <div
                        key={i}
                        className={`git-file-entry ${statusClass}`}
                        onClick={async () => {
                          // 点击文件 → 读取内容 → 打开编辑器
                          if (onOpenFile) {
                            const fullPath = `${workspaceDir}\\${entry.path}`;
                            try {
                              const content = await invoke<string>('read_file_content', { path: fullPath });
                              onOpenFile(fullPath, content);
                            } catch (e) {
                              console.error('Failed to read file:', e);
                            }
                          }
                        }}
                        style={{ cursor: 'pointer' }}
                        title="点击打开文件"
                      >
                        <span className="git-file-status" style={{ color: icon.color }}>{icon.symbol}</span>
                        <span className="git-file-path" title={entry.path}>{entry.path}</span>
                        <button
                          className="git-file-diff-btn"
                          onClick={e => { e.stopPropagation(); setDiffFile(entry.path); }}
                          title="查看差异"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/>
                          </svg>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <>
              {!logs?.success || logs.commits.length === 0 ? (
                <div className="git-empty">
                  <p>无提交历史</p>
                </div>
              ) : (
                <div className="git-log-list">
                  {logs.commits.map((entry, i) => (
                    <div key={i} className="git-log-entry">
                      <div className="git-log-hash">{entry.short_hash}</div>
                      <div className="git-log-info">
                        <div className="git-log-msg">{entry.message}</div>
                        <div className="git-log-meta">
                          <span>{entry.author}</span>
                          <span>{entry.date}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Commit input & actions */}
        {status?.is_repo && (
          <div className="git-panel-footer">
            <div className="git-commit-row">
              <input
                className="git-commit-input"
                placeholder="提交信息..."
                value={commitMsg}
                onChange={(e) => setCommitMsg(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleCommit(); } }}
              />
              <button
                className="git-btn git-btn-commit"
                onClick={handleCommit}
                disabled={commitLoading || !commitMsg.trim()}
              >
                {commitLoading ? '...' : '提交'}
              </button>
            </div>
            <div className="git-action-row">
              <button className="git-btn git-btn-pull" onClick={handlePull} disabled={pullLoading}>
                {pullLoading ? '拉取中...' : '拉取'}
              </button>
              <button className="git-btn git-btn-push" onClick={handlePush} disabled={pushLoading}>
                {pushLoading ? '推送中...' : '推送'}
              </button>
              <button className="git-btn git-btn-refresh" onClick={() => fetchStatus()} disabled={loading}>
                {loading ? '...' : '↻'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className={`git-toast ${toast.type === 'ok' ? 'git-toast-ok' : 'git-toast-err'}`}>
          {toast.text}
        </div>
      )}

      {/* Diff Modal */}
      <GitDiffModal
        visible={diffFile !== null}
        workspaceDir={workspaceDir}
        filePath={diffFile || ''}
        onClose={() => setDiffFile(null)}
      />
    </div>
  );
}
