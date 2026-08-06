import React, { useState, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import { invoke } from '@tauri-apps/api/core';

interface GitDiffProps {
  visible: boolean;
  workspaceDir: string;
  filePath: string;
  onClose: () => void;
}

interface GitDiffResult {
  success: boolean;
  diff: string;
  message: string;
}

export default function GitDiffModal({ visible, workspaceDir, filePath, onClose }: GitDiffProps) {
  const [diff, setDiff] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible && filePath) {
      setLoading(true);
      setError(null);
      invoke<GitDiffResult>('git_diff_file', { dir: workspaceDir, path: filePath })
        .then(res => {
          if (res.success) {
            setDiff(res.diff);
          } else {
            setError(res.message);
          }
        })
        .catch(e => setError(String(e)))
        .finally(() => setLoading(false));
    }
  }, [visible, filePath, workspaceDir]);

  if (!visible) return null;

  return (
    <div className="git-diff-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="git-diff-modal">
        <div className="git-diff-header">
          <div className="git-diff-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00f0ff" strokeWidth="2">
              <path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/>
            </svg>
            <span>文件对比</span>
          </div>
          <div className="git-diff-file-path">{filePath}</div>
          <button className="git-diff-close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div className="git-diff-content">
          {loading ? (
            <div className="git-diff-loading">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#00f0ff" strokeWidth="2" className="git-spin">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
              </svg>
              <span>正在加载差异...</span>
            </div>
          ) : error ? (
            <div className="git-diff-error">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
              </svg>
              <p>{error}</p>
            </div>
          ) : diff ? (
            <Editor
              height="100%"
              language="diff"
              value={diff}
              theme="vs-dark"
              options={{
                readOnly: true,
                minimap: { enabled: false },
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
                fontSize: 13,
                fontFamily: 'JetBrains Mono, Consolas, monospace',
              }}
            />
          ) : (
            <div className="git-diff-empty">
              <p>无差异</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
