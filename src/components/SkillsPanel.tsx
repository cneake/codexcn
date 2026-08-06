import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-shell';
import { open as dialogOpen } from '@tauri-apps/plugin-dialog';
import './SkillsPanel.css';

interface ToolSkill {
  name: string;
  slug: string;
  description: string;
  source: string;
}

interface MarketSkill {
  id: number;
  slug: string;
  name: string;
  description: string;
  category: string;
  author: string;
  version: string;
  download_url: string;
  tags: string[];
  date: string;
  link: string;
  downloadable?: boolean;
  npm_package?: string;
}

interface SkillsResponse {
  total: number;
  pages: number;
  skills: MarketSkill[];
}

interface Props {
  toolId: string;
  onToast: (msg: string) => void;
  onClose: () => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  'all': '全部',
  'efficiency': '效率工具',
  'coding': 'AI编程',
  'writing': '写作助手',
  'agent': 'Agent开发',
  'prompt': '提示词工程',
  'system': '系统',
  'document': '文档',
  'browser': '浏览器',
  'search': '搜索'
};

export default function SkillsPanel({ toolId, onToast, onClose }: Props) {
  const [builtinSkills, setBuiltinSkills] = useState<ToolSkill[]>([]);
  const [marketSkills, setMarketSkills] = useState<MarketSkill[]>([]);
  const [total, setTotal] = useState(0);
  const [category, setCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);
  const [installedSlugs, setInstalledSlugs] = useState<string[]>([]);
  const [activeSlugs, setActiveSlugs] = useState<Set<string>>(new Set());
  const [showGitHubModal, setShowGitHubModal] = useState(false);
  const [gitHubSkills, setGitHubSkills] = useState<MarketSkill[]>([]);
  const [gitHubLoading, setGitHubLoading] = useState(false);
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);

  // 已安装技能视图
  const [installedSkills, setInstalledSkills] = useState<{ slug: string; name: string; readme: string; savedOnly: boolean }[]>([]);
  const [installedLoading, setInstalledLoading] = useState(false);
  const [exportingSlug, setExportingSlug] = useState<string | null>(null);

  // 上传技能弹窗
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadFilePath, setUploadFilePath] = useState('');
  const [uploadName, setUploadName] = useState('');
  const [uploadSlug, setUploadSlug] = useState('');
  const [uploadTool, setUploadTool] = useState(toolId);
  const [uploadPreview, setUploadPreview] = useState<{ name: string; description: string } | null>(null);
  const [uploadError, setUploadError] = useState('');
  const [uploadingSkill, setUploadingSkill] = useState(false);

  // 工具选项
  const TOOL_OPTIONS = [
    { value: 'claude-code', label: 'Claude Code' },
    { value: 'claude-desktop', label: 'Claude Desktop' },
    { value: 'codex', label: 'Codex' },
    { value: 'gemini-cli', label: 'Gemini CLI' },
    { value: 'opencode', label: 'OpenCode' },
    { value: 'openclaw', label: 'OpenClaw' },
    { value: 'hermes-agent', label: 'Hermes Agent' },
    { value: 'qoder-cli', label: 'Qoder CLI' },
    { value: 'deepseek-cli', label: 'DeepSeek CLI' },
  ];

  const handlePickZip = async () => {
    try {
      const selected = await dialogOpen({
        multiple: false,
        filters: [{ name: 'Skill Package', extensions: ['zip'] }],
      });
      if (!selected) return;
      const path = typeof selected === 'string' ? selected : selected;
      setUploadFilePath(path);
      setUploadError('');

      // 预览：解析 ZIP 提取技能信息
      const info = await invoke('preview_local_skill', { zipPath: path }) as any;
      setUploadPreview({ name: info.name, description: info.description });
      setUploadName(info.name);
      setUploadSlug(info.slug);
      setUploadTool(toolId);
    } catch (e: any) {
      setUploadError(e?.message || String(e));
      setUploadPreview(null);
      setUploadName('');
      setUploadSlug('');
    }
  };

  const handleUploadOnly = async () => {
    if (!uploadFilePath || !uploadName.trim() || !uploadSlug.trim()) {
      setUploadError('请填写完整信息');
      return;
    }
    setUploadingSkill(true);
    setUploadError('');
    try {
      await invoke('upload_skill_local', {
        zipPath: uploadFilePath,
        slug: uploadSlug.trim(),
      });
      onToast(`📁 技能 "${uploadName}" 已保存`);
      setShowUploadModal(false);
      setUploadFilePath('');
      setUploadName('');
      setUploadSlug('');
      setUploadPreview(null);
    } catch (e: any) {
      setUploadError(e?.message || String(e));
    } finally {
      setUploadingSkill(false);
    }
  };

  const handleUploadConfirm = async () => {
    if (!uploadFilePath || !uploadName.trim() || !uploadSlug.trim()) {
      setUploadError('请填写完整信息');
      return;
    }
    setUploadingSkill(true);
    setUploadError('');
    try {
      await invoke('install_local_skill', {
        zipPath: uploadFilePath,
        slug: uploadSlug.trim(),
      });
      onToast(`✅ 技能 "${uploadName}" 安装成功`);
      // 刷新已安装列表
      const list = await invoke('get_installed_skills') as { slug: string; savedOnly: boolean }[];
      setInstalledSlugs(list.map(s => s.slug));
      // 刷新内置技能
      const skills = await invoke('get_tool_skills', { toolId: uploadTool }) as ToolSkill[];
      setBuiltinSkills(skills);
      setShowUploadModal(false);
      setUploadFilePath('');
      setUploadName('');
      setUploadSlug('');
      setUploadPreview(null);
    } catch (e: any) {
      setUploadError(e?.message || String(e));
    } finally {
      setUploadingSkill(false);
    }
  };

  // 加载工具自带 skills
  useEffect(() => {
    invoke('get_tool_skills', { toolId })
      .then((skills) => setBuiltinSkills(skills as ToolSkill[]))
      .catch(() => setBuiltinSkills([]));
  }, [toolId]);

  // 加载已安装技能（详情 + slug 列表）
  useEffect(() => {
    loadInstalledSkills();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 监听 skill-invoked 事件：调用中高亮（不设超时，chat-finished 才清除）
  useEffect(() => {
    const unlistenP = listen<{ skill_slug: string; tool_id: string }>('skill-invoked', (event) => {
      const slug = event.payload?.skill_slug;
      if (!slug) return;
      setActiveSlugs(prev => {
        const next = new Set(prev);
        next.add(slug);
        return next;
      });
    });
    // chat-finished：清除所有高亮状态
    const unlistenDone = listen<{ tool_id: string }>('chat-finished', () => {
      setActiveSlugs(new Set());
    });
    return () => {
      unlistenP.then(fn => fn());
      unlistenDone.then(fn => fn());
    };
  }, []);

  // 加载市场技能
  useEffect(() => {
    loadMarketSkills();
  }, [category]);

  const loadMarketSkills = async (search?: string) => {
    setLoading(true);
    try {
      let url = `https://agent.eake.cn/wp-json/ylan/v1/skills?per_page=50`;
      if (category && category !== 'all') {
        url += `&category=${category}`;
      }
      if (search) {
        url += `&search=${encodeURIComponent(search)}`;
      }

      const res = await fetch(url);
      const data = await res.json() as SkillsResponse;
      // download_url 为空 → downloadable=false（技能 ZIP 未上传到服务器）
      // npm_package 存在 → downloadable=true（优先走 npm 安装）
      const normalized = (data.skills || []).map((s: MarketSkill) => ({
        ...s,
        downloadable: !!(s.npm_package) || !!(s.download_url && s.download_url.startsWith('http'))
      }));
      // 去重：按 slug 合并，优先保留 downloadable=true
      const uniqueMap = new Map<string, MarketSkill>();
      normalized.forEach(s => {
        const existing = uniqueMap.get(s.slug);
        if (!existing || (s.downloadable && !existing.downloadable)) {
          uniqueMap.set(s.slug, s);
        }
      });
      const unique = Array.from(uniqueMap.values());
      setMarketSkills(unique);
      setTotal(data.total || 0);
    } catch (e) {
      console.error('Failed to load market skills:', e);
      onToast('❌ 加载技能市场失败');
    } finally {
      setLoading(false);
    }
  };

  const loadGitHubSkills = async () => {
    setGitHubLoading(true);
    setShowGitHubModal(true);
    try {
      const res = await fetch(`https://agent.eake.cn/wp-json/ylan/v1/skills?all=1&per_page=300`);
      const data = await res.json() as SkillsResponse;
      // Only show skills without npm_package (Claude Code style skills)
      const gh = (data.skills || []).filter(s => !s.npm_package && !s.download_url);
      setGitHubSkills(gh);
    } catch (e) {
      console.error('Failed to load GitHub skills:', e);
      onToast('❌ 加载开源技能失败');
    } finally {
      setGitHubLoading(false);
    }
  };

  const copyToClipboard = async (cmd: string, slug: string) => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopiedSlug(slug);
      setTimeout(() => setCopiedSlug(null), 2000);
    } catch {
      onToast('❌ 复制失败');
    }
  };

  const handleSearch = async () => {
    if (searchQuery.trim()) {
      // 搜索模式：调用 Rust 命令，从 lightmake.site 获取
      setLoading(true);
      try {
        const skills = await invoke('search_skills', { 
          query: searchQuery.trim(),
          limit: 50
        }) as MarketSkill[];
        // search_skills 返回的技能已有 downloadable=true
        const mapped = skills.map(s => ({ ...s, downloadable: true }));
        // 去重：按 slug 合并，优先保留 downloadable=true
        const uniqueMap = new Map<string, MarketSkill>();
        mapped.forEach(s => {
          const existing = uniqueMap.get(s.slug);
          if (!existing || (s.downloadable && !existing.downloadable)) {
            uniqueMap.set(s.slug, s);
          }
        });
        const unique = Array.from(uniqueMap.values());
        setMarketSkills(unique);
        setTotal(unique.length);
      } catch (e: any) {
        console.error('Search failed:', e);
        onToast(`❌ 搜索失败: ${e?.message || e}`);
      } finally {
        setLoading(false);
      }
    } else {
      // 清空搜索词 → 恢复 WordPress 市场列表
      loadMarketSkills();
    }
  };

  const handleInstall = async (skill: MarketSkill) => {
    const slug = skill.slug;
    setInstalling(slug);
    try {
      if (skill.npm_package) {
        // 方案B：npm install -g（优先）
        await invoke('install_skill_via_npm', {
          packageName: skill.npm_package,
          name: skill.name,
          slug: skill.slug,
        });
        logInvoke(skill.slug, skill.name);
        onToast(`✅ ${skill.name} 安装成功`);
      } else {
        // 方案A：ZIP 下载（降级）
        await invoke('install_skill_from_market', {
          slug,
          name: skill.name,
          downloadUrl: skill.download_url || skill.link
        });
        logInvoke(skill.slug, skill.name);
        onToast(`✅ ${skill.name} 安装成功`);
      }
      setInstalledSlugs(prev => [...prev, slug]);
      // 刷新内置 skills
      const skills = await invoke('get_tool_skills', { toolId }) as ToolSkill[];
      setBuiltinSkills(skills);
    } catch (e: any) {
      onToast(`❌ 安装失败: ${e?.message || e}`);
    } finally {
      setInstalling(null);
    }
  };

  const handleUninstall = async (slug: string) => {
    setInstalling(slug);
    try {
      await invoke('uninstall_skill', { slug });
      onToast(`✅ ${slug} 已卸载`);
      setInstalledSlugs(prev => prev.filter(s => s !== slug));
    } catch (e: any) {
      onToast(`❌ 卸载失败: ${e?.message || e}`);
    } finally {
      setInstalling(null);
    }
  };

  const isInstalled = (slug: string) => installedSlugs.includes(slug);

  // 加载已安装技能详情（slug + 从 SKILL.md 读取 name）
  const loadInstalledSkills = async () => {
    setInstalledLoading(true);
    try {
      const list = await invoke('get_installed_skills') as { slug: string; savedOnly: boolean }[];
      setInstalledSlugs(list.map(s => s.slug));
      const details = await Promise.all(list.map(async (item) => {
        try {
          const readme = await invoke('get_skill_readme', { slug: item.slug }) as string;
          const nameMatch = readme.match(/^name:\s*(.+)$/m);
          const name = nameMatch ? nameMatch[1].trim().replace(/^["']|["']$/g, '') : item.slug;
          return { slug: item.slug, name, readme, savedOnly: item.savedOnly };
        } catch {
          return { slug: item.slug, name: item.slug, readme: '', savedOnly: item.savedOnly };
        }
      }));
      setInstalledSkills(details);
    } catch (e: any) {
      onToast(`❌ 加载已安装技能失败: ${e?.message || e}`);
    } finally {
      setInstalledLoading(false);
    }
  };

  const handleInstallSaved = async (slug: string) => {
    try {
      setInstalling(slug);
      await invoke('install_saved_skill', { slug });
      onToast(`✅ ${slug} 安装成功`);
      loadInstalledSkills();
    } catch (e: any) {
      onToast(`❌ 安装失败: ${e?.message || e}`);
    } finally {
      setInstalling(null);
    }
  };

  const handleExport = async (slug: string) => {
    try {
      const save = await dialogOpen({
        multiple: false,
        filters: [{ name: 'ZIP', extensions: ['zip'] }],
      });
      if (!save) return;
      const savePath = typeof save === 'string' ? save : save;
      const finalPath = savePath.endsWith('.zip') ? savePath : `${savePath}.zip`;
      setExportingSlug(slug);
      await invoke('export_skill_zip', { slug, savePath: finalPath });
      onToast(`📦 ${slug} 已导出`);
    } catch (e: any) {
      onToast(`❌ 导出失败: ${e?.message || e}`);
    } finally {
      setExportingSlug(null);
    }
  };

  const logInvoke = (slug: string, name: string) => {
    invoke('log_skill_invoke', { toolId, skillSlug: slug, skillName: name }).catch(() => {});
  };

  return (
    <div className="skills-panel-root">
      <div className="sp-header">
        <h2 className="sp-header-title">🧩 技能市场</h2>
        <button className="sp-close-btn" onClick={onClose} title="关闭">✕</button>
      </div>
      {/* 已安装技能 */}
      <div className="sp-section">
        <div className="sp-section-title">
          <span>📦 已安装技能 ({installedSkills.length})</span>
        </div>
        {installedSkills.length > 0 ? (
          <div className="sp-grid">
            {installedSkills.map(s => {
              const isActive = activeSlugs.has(s.slug);
              // 已安装 + 未调用 = inactive(灰色)，调用后 = active(七彩跑马灯)
              const cls = `sp-card builtin ${s.savedOnly ? 'saved-only' : ''} ${isActive ? 'active' : 'inactive'}`;
              return (
              <div key={s.slug} className={cls}>
                <div className="sp-card-name">{s.name}</div>
                <div className="sp-card-desc">@{s.slug}</div>
                {isActive && <span className="sp-badge" style={{background:'rgba(255,107,107,0.15)',color:'#ff6b6b'}}>⚡ 调用中</span>}
                {s.savedOnly && !isActive && (
                  <span className="sp-badge saved">仅保存</span>
                )}
                {s.savedOnly ? (
                  <button
                    className="sp-btn-install"
                    onClick={() => handleInstallSaved(s.slug)}
                    disabled={installing === s.slug}
                  >
                    {installing === s.slug ? '...' : '🚀 去安装'}
                  </button>
                ) : (
                  <button
                    className="sp-btn-install"
                    onClick={() => handleExport(s.slug)}
                    disabled={exportingSlug === s.slug}
                  >
                    {exportingSlug === s.slug ? '⏳ 导出中...' : '⬇ 下载'}
                  </button>
                )}
                <button
                  className="sp-btn-uninstall"
                  onClick={() => handleUninstall(s.slug)}
                  disabled={installing === s.slug}
                >
                  {installing === s.slug ? '...' : '卸载'}
                </button>
              </div>
              );
            })}
          </div>
        ) : (
          <div className="sp-empty">暂无已安装技能（可在「技能市场」上传或安装）</div>
        )}
      </div>

      {/* 技能市场 */}
      <div className="sp-section sp-market">
        <div className="sp-section-title">
          🌐 技能市场 ({total})
        </div>

        {/* 分类筛选 */}
        <div className="sp-tabs">
          {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
            <button
              key={key}
              className={`sp-tab ${category === key ? 'active' : ''}`}
              onClick={() => setCategory(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {/* 搜索框 + 更多技能 */}
        <div className="sp-search-row">
          <input
            className="sp-search-input"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            placeholder="搜索技能..."
          />
          <button className="sp-btn-search" onClick={handleSearch} disabled={loading}>
            {loading ? '...' : '搜索'}
          </button>
          <button className="sp-btn-more" onClick={loadGitHubSkills}>
            更多技能
          </button>
          <button className="sp-btn-upload" onClick={() => { setShowUploadModal(true); setUploadFilePath(''); setUploadName(''); setUploadSlug(''); setUploadPreview(null); setUploadError(''); }}>
            📤 上传技能
          </button>
        </div>

        {/* 技能列表 */}
        <div className="sp-grid market">
          {loading ? (
            <div className="sp-loading">加载中...</div>
          ) : marketSkills.length === 0 ? (
            <div className="sp-empty">无结果</div>
          ) : (
            marketSkills.map(skill => {
              const installed = isInstalled(skill.slug);
              const isActive = activeSlugs.has(skill.slug);
              // active 优先高亮；未调用时 installed 表现
              const statusClass = isActive ? 'active' : (installed ? 'installed' : '');
              return (
                <div key={skill.slug} className={`sp-card ${statusClass}`}>
                  <div className="sp-card-header">
                    <div className="sp-card-name">{skill.name}</div>
                    <span className="sp-card-cat">{CATEGORY_LABELS[skill.category] || skill.category}</span>
                  </div>
                  <div className="sp-card-desc">{skill.description}</div>
                  <div className="sp-card-footer">
                    <span className="sp-card-author">{skill.author}</span>
                    <span className="sp-card-version">v{skill.version}</span>
                  </div>
                  {installed ? (
                    <button
                      className="sp-btn-uninstall"
                      onClick={() => handleUninstall(skill.slug)}
                      disabled={installing === skill.slug}
                    >
                      {installing === skill.slug ? '...' : '已安装'}
                    </button>
                  ) : skill.downloadable ? (
                    <button
                      className="sp-btn-install"
                      onClick={() => handleInstall(skill)}
                      disabled={installing === skill.slug}
                    >
                      {installing === skill.slug ? '安装中...' : '安装'}
                    </button>
                  ) : (
                    <button className="sp-btn-install" disabled style={{opacity: 0.35, cursor: 'default', fontSize: '11px'}}>
                      纯展示
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>



      {/* GitHub 技能弹窗 */}
      {showGitHubModal && (
        <div className="sp-modal-overlay" onClick={() => setShowGitHubModal(false)}>
          <div className="sp-modal-content" onClick={e => e.stopPropagation()}>
            <div className="sp-modal-header">
              <h3>🐙 GitHub 开源技能</h3>
            </div>
            <div className="sp-modal-body">
              <p className="sp-modal-desc">
                以下技能来自社区仓库，可在终端中运行安装命令。
                打开 <strong>GenHub 终端</strong>，粘贴命令即可安装。
              </p>
              <p className="sp-modal-link">
                📖 <button className="sp-modal-link-btn" onClick={() => open('https://agent.eake.cn/skills/')}>访问 eaKe 技能中心查看完整介绍 →</button>
              </p>
              
              <div className="sp-github-list">
                {gitHubLoading ? (
                  <div className="sp-loading">加载中...</div>
                ) : gitHubSkills.length === 0 ? (
                  <div className="sp-empty">暂无 GitHub 技能</div>
                ) : (
                  gitHubSkills.map(skill => (
                    <div key={skill.slug} className="sp-github-item" onClick={() => logInvoke(skill.slug, skill.name)}>
                      <div className="sp-github-info">
                        <div className="sp-github-name">{skill.name}</div>
                        <div className="sp-github-desc">{skill.description}</div>
                      </div>
                      <button
                        className={`sp-btn-copy ${copiedSlug === skill.slug ? 'copied' : ''}`}
                        onClick={(e) => { e.stopPropagation(); copyToClipboard(`npx skills add ${skill.slug} -g`, skill.slug); }}
                      >
                        {copiedSlug === skill.slug ? '✅ 已复制' : '📋 复制命令'}
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 上传技能弹窗 */}
      {showUploadModal && (
        <div className="sp-modal-overlay" onClick={() => setShowUploadModal(false)}>
          <div className="sp-modal-content" onClick={e => e.stopPropagation()}>
            <div className="sp-modal-header">
              <h3>📤 上传本地技能</h3>
            </div>
            <div className="sp-modal-body">
              <p className="sp-modal-desc">
                选择本地的技能 ZIP 包（必须包含 SKILL.md），解压安装到本地。
              </p>

              {/* 文件选择 */}
              <div className="sp-upload-zone">
                <button className="sp-btn-upload-zone" onClick={handlePickZip} disabled={uploadingSkill}>
                  📁 选择 ZIP 文件
                </button>
                {uploadFilePath && (
                  <div className="sp-upload-filename">
                    已选: <span>{uploadFilePath.split(/[/\\]/).pop()}</span>
                  </div>
                )}
              </div>

              {/* 预览信息 */}
              {uploadPreview && (
                <div className="sp-upload-preview">
                  <div className="sp-upload-preview-name">📦 {uploadPreview.name}</div>
                  {uploadPreview.description && (
                    <div className="sp-upload-preview-desc">{uploadPreview.description}</div>
                  )}
                </div>
              )}

              {/* 填写信息 */}
              {uploadPreview && (
                <div className="sp-upload-form">
                  <div className="sp-form-group">
                    <label>技能名称</label>
                    <input
                      className="sp-form-input"
                      value={uploadName}
                      onChange={e => {
                        setUploadName(e.target.value);
                        setUploadSlug(
                          e.target.value
                            .toLowerCase()
                            .replace(/[^a-z0-9\u4e00-\u9fa5]/g, '-')
                            .replace(/-+/g, '-')
                            .replace(/^-|-$/g, '')
                        );
                      }}
                      placeholder="技能名称"
                      disabled={uploadingSkill}
                    />
                  </div>
                  <div className="sp-form-group">
                    <label>Slug（目录名）</label>
                    <input
                      className="sp-form-input"
                      value={uploadSlug}
                      onChange={e => setUploadSlug(e.target.value
                        .toLowerCase()
                        .replace(/[^a-z0-9-_]/g, '-')
                        .replace(/-+/g, '-')
                      )}
                      placeholder="my-skill"
                      disabled={uploadingSkill}
                    />
                  </div>
                  <div className="sp-form-group">
                    <label>归属工具</label>
                    <div className="sp-upload-tool-badge">
                      {TOOL_OPTIONS.find(t => t.value === uploadTool)?.label ?? uploadTool}
                    </div>
                  </div>
                </div>
              )}

              {/* 错误提示 */}
              {uploadError && (
                <div className="sp-upload-error">❌ {uploadError}</div>
              )}

              {/* 确认按钮 */}
              {uploadPreview && (
                <div className="sp-upload-actions">
                  <button
                    className="sp-btn-upload-only"
                    onClick={handleUploadOnly}
                    disabled={uploadingSkill || !uploadName.trim() || !uploadSlug.trim()}
                  >
                    {uploadingSkill ? '上传中...' : '📁 仅保存'}
                  </button>
                  <button
                    className="sp-btn-upload-confirm"
                    onClick={handleUploadConfirm}
                    disabled={uploadingSkill || !uploadName.trim() || !uploadSlug.trim()}
                  >
                    {uploadingSkill ? '安装中...' : '✅ 安装技能'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
