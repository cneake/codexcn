import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import './MemoryPanel.css';

/* ── 简易 Diff ── */
function simpleDiff(oldText: string, newText: string) {
  if (oldText === newText) return '(无变更)';
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const added = newLines.length - oldLines.length;
  let changed = 0;
  for (let i = 0; i < Math.min(oldLines.length, newLines.length); i++) {
    if (oldLines[i] !== newLines[i]) changed++;
  }
  const parts: string[] = [];
  if (changed > 0) parts.push(`${changed} 行修改`);
  if (added > 0) parts.push(`+${added} 行`);
  else if (added < 0) parts.push(`${added} 行`);
  return parts.join(', ') || '(有变更)';
}

interface MemoryFile {
  name: string;
  path: string;
  content: string;
  modified: string;
  size: number;
}

interface Props {
  toolId: string;
  sessionId?: string;
  onClose: () => void;
}

/* ── 各工具的记忆文件路径映射 ── */
const MEMORY_PATHS: Record<string, { base: string; files: string[] }> = {
  'claude-code': {
    base: 'claude-code',
    files: ['CLAUDE.md', 'MEMORY.md'],
  },
  'openclaw': {
    base: 'openclaw',
    files: ['AGENTS.md', 'SOUL.md', 'MEMORY.md', 'USER.md', 'TOOLS.md'],
  },
  'hermes-agent': {
    base: 'hermes-agent',
    files: ['AGENTS.md', 'SOUL.md', 'MEMORY.md', 'USER.md'],
  },
};

export default function MemoryPanel({ toolId, sessionId, onClose }: Props) {
  const [files, setFiles] = useState<MemoryFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<MemoryFile | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ file: string; line: number; text: string }[]>([]);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const [summarizing, setSummarizing] = useState(false);
  const [summaryTarget, setSummaryTarget] = useState<string | null>(null);

  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    loadMemoryFiles();
  }, [toolId]);

  const loadMemoryFiles = async () => {
    setLoading(true);
    try {
      const result = await invoke<MemoryFile[]>('get_memory_files', { toolId });
      setFiles(result);
      if (result.length > 0) setSelectedFile(result[0]);
    } catch (e: any) {
      console.error('Failed to load memory files:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!selectedFile) return;
    const diff = simpleDiff(selectedFile.content, editContent);
    if (diff === '(无变更)') {
      setSaveMsg('⚠️ 内容无变化，已跳过保存');
      setEditing(false);
      return;
    }
    setSaving(true);
    setSaveMsg(null);
    try {
      await invoke('save_memory_file', { path: selectedFile.path, content: editContent });
      // 更新本地状态
      setSelectedFile({ ...selectedFile, content: editContent });
      setFiles(prev => prev.map(f =>
        f.path === selectedFile.path ? { ...f, content: editContent } : f
      ));
      setSaveMsg(`✅ 保存成功（${diff}）`);
      setEditing(false);
    } catch (e: any) {
      setSaveMsg(`❌ 保存失败: ${e}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (file: MemoryFile) => {
    if (deleting) return;
    const ok = window.confirm(`确定删除记忆文件「${file.name}」吗？\n\n该操作不可恢复！`);
    if (!ok) return;
    setDeleting(file.name);
    setSaveMsg(null);
    try {
      await invoke('delete_memory_file', { path: file.path });
      // 刷新列表
      await loadMemoryFiles();
      setSaveMsg(`✅ 已删除 ${file.name}`);
    } catch (e: any) {
      setSaveMsg(`❌ 删除失败: ${e}`);
    } finally {
      setDeleting(null);
    }
  };

  const handleSearch = () => {
    if (!searchQuery.trim()) { setSearchResults([]); return; }
    const results: { file: string; line: number; text: string }[] = [];
    const query = searchQuery.toLowerCase();
    for (const file of files) {
      const lines = file.content.split('\n');
      lines.forEach((line, idx) => {
        if (line.toLowerCase().includes(query)) {
          results.push({ file: file.name, line: idx + 1, text: line.trim() });
        }
      });
    }
    setSearchResults(results);
  };

  const config = MEMORY_PATHS[toolId];
  if (!config) {
    return (
      <div className="modal-box memory-panel" onClick={e => e.stopPropagation()} style={{ width: '1000px', maxWidth: '95vw', height: '680px', maxHeight: '85vh' }}>
        <div className="modal-header">
          <h3>🧠 记忆管理</h3>
        </div>
        <div className="modal-body" style={{ textAlign: 'center', padding: 40, color: 'var(--text2)' }}>
          该工具暂不支持记忆管理
        </div>
      </div>
    );
  }

  return (
    <div className="modal-box memory-panel" onClick={e => e.stopPropagation()} style={{ width: '1000px', maxWidth: '95vw', height: '680px', maxHeight: '85vh' }}>
      <div className="modal-header">
        <h3>🧠 记忆管理 — {toolId}</h3>
      </div>
        <div className="memory-layout">
          {/* 左侧文件列表 */}
          <div className="memory-sidebar">
            <div className="memory-search">
              <input
                type="text"
                placeholder="搜索记忆内容..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
              />
              <button className="btn-sm" onClick={handleSearch}>🔍</button>
            </div>
            {searchResults.length > 0 && (
              <div className="search-results">
                {searchResults.map((r, i) => (
                  <div key={i} className="search-result-item" onClick={() => {
                    const f = files.find(f => f.name === r.file);
                    if (f) setSelectedFile(f);
                  }}>
                    <span className="search-file">{r.file}:{r.line}</span>
                    <span className="search-text">{r.text}</span>
                  </div>
                ))}
              </div>
            )}
            {loading ? (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--text2)' }}>加载中...</div>
            ) : (
              files.map(f => (
                <div
                  key={f.name}
                  className={`memory-file-item${selectedFile?.name === f.name ? ' active' : ''}`}
                  onClick={() => setSelectedFile(f)}
                >
                  <span className="file-icon">📄</span>
                  <div className="file-info">
                    <span className="file-name">{f.name}</span>
                    <span className="file-meta">{f.size}B · {f.modified}</span>
                  </div>
                  <button
                    className="memory-file-delete"
                    title={`删除 ${f.name}`}
                    disabled={deleting === f.name}
                    onClick={e => { e.stopPropagation(); handleDelete(f); }}
                  >
                    {deleting === f.name ? '⏳ 删除中' : '🗑 删除'}
                  </button>
                </div>
              ))
            )}
          </div>
          {/* 右侧内容区 */}
          <div className="memory-content">
            {selectedFile ? (
              <>
                <div className="content-header">
                  <span>{selectedFile.name}</span>
                  <span className="content-meta">{selectedFile.path}</span>
                  <div className="content-actions">
                    {!editing ? (
                      <>
                        <button className="btn-sm" onClick={async () => {
                          if (!selectedFile) return;
                          setSummarizing(true);
                          setSummaryTarget(selectedFile.name);
                          setSaveMsg(null);
                          try {
                            const summarized = await invoke<string>('summarize_memory_file', {
                              fileContent: selectedFile.content,
                              toolId: toolId
                            });
                            setEditContent(summarized);
                            setEditing(true);
                            setSaveMsg('🤖 AI 总结完成，请确认后保存');
                          } catch (e: any) {
                            setSaveMsg('❌ AI 总结失败: ' + (e?.message || e));
                          } finally {
                            setSummarizing(false);
                            setSummaryTarget(null);
                          }
                        }} disabled={summarizing} title="AI 智能总结重写">
                          {summarizing ? '⏳ AI 总结中...' : '🤖 AI 总结'}
                        </button>
                        <button className="btn-sm" onClick={() => { setEditing(true); setEditContent(selectedFile.content); setSaveMsg(null); }} title="编辑">
                          ✏️ 编辑
                        </button>
                      </>
                    ) : (
                      <>
                        <button className="btn-sm" onClick={() => { setEditing(false); setEditContent(''); setSaveMsg(null); }} title="取消">
                          取消
                        </button>
                        <button className="btn-sm btn-primary" onClick={handleSave} disabled={saving} title="保存">
                          {saving ? '保存中…' : '💾 保存'}
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {saveMsg && (
                  <div className={`save-msg ${saveMsg.startsWith('✅') ? 'success' : 'error'}`}>
                    {saveMsg}
                    <button className="btn-close-msg" onClick={() => setSaveMsg(null)}>✕</button>
                  </div>
                )}
                {editing ? (
                  <textarea
                    className="memory-editor"
                    value={editContent}
                    onChange={e => setEditContent(e.target.value)}
                    spellCheck={false}
                  />
                ) : (
                  <pre className="content-body">{selectedFile.content || '(空文件)'}</pre>
                )}
              </>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text2)' }}>
                选择左侧文件查看内容
              </div>
            )}
          </div>
        </div>
      </div>
  );
}
