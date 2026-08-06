import { useState, useEffect } from 'react';

interface SubItem {
  id: string;
  label: string;
  icon: string;
  desc?: string; // 简短说明
}

interface MenuGroup {
  id: string;
  label: string;
  icon: string;
  children: SubItem[];
}

/* ── SVG 图标 ── */
const Icons: Record<string, React.ReactNode> = {
  context: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="5" height="18" rx="1"/><rect x="10" y="3" width="5" height="12" rx="1"/><rect x="17" y="3" width="5" height="18" rx="1"/></svg>,
  usage: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="12" width="4" height="9" rx="1"/><rect x="10" y="7" width="4" height="14" rx="1"/><rect x="17" y="3" width="4" height="18" rx="1"/></svg>,
  git: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/></svg>,
  model: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>,
  init: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>,
  search: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m20 20-3.5-3.5"/></svg>,
  diff: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
  directory: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>,
  cron: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  subagents: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  skills: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>,
  memory: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/></svg>,
  toolchain: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>,
  research: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m20 20-3.5-3.5"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>,
  gem: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 2 17 12 22 22 17 22 7 12 2"/><line x1="12" y1="22" x2="12" y2="12"/><line x1="2" y1="7" x2="12" y2="12"/><line x1="22" y1="7" x2="12" y2="12"/></svg>,
  agents: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  multiModel: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>,
};

/* ── 各工具独有功能（与第一栏完全不重复） ── */
const TOOL_MENUS: Record<string, MenuGroup[]> = {
  /* Claude Code */
  'claude-code': [
    { id: 'cc-exclusive', label: 'Claude Code', icon: 'agents', children: [
      { id: 'context-strategy', label: '上下文策略', icon: 'context', desc: '/context /compact' },
      { id: 'usage-stats', label: '用量统计', icon: 'usage', desc: '/cost /usage' },
      { id: 'git-log', label: 'Git 日志', icon: 'git', desc: '/git' },
    ]},
  ],

  /* Claude Desktop */
  'claude-desktop': [
    { id: 'cd-exclusive', label: 'Claude Desktop', icon: 'agents', children: [
      { id: 'context-window', label: '上下文窗口', icon: 'context', desc: '当前窗口大小' },
      { id: 'usage-stats', label: '用量统计', icon: 'usage', desc: 'Token 消耗' },
    ]},
  ],

  /* Codex CLI */
  'codex': [
    { id: 'cx-exclusive', label: 'Codex CLI', icon: 'agents', children: [
      { id: 'model-select', label: '模型选择', icon: 'model', desc: '/model o3/o4-mini' },
      { id: 'context-window', label: '上下文窗口', icon: 'context', desc: '/status 状态' },
      { id: 'project-init', label: '项目初始化', icon: 'init', desc: '/init 生成 AGENTS.md' },
    ]},
  ],

  /* Gemini CLI */
  'gemini-cli': [
    { id: 'gc-exclusive', label: 'Gemini CLI', icon: 'agents', children: [
      { id: 'context-window', label: '上下文窗口', icon: 'context', desc: '100万 token' },
      { id: 'deep-research', label: '深度研究', icon: 'research', desc: 'Gemini 深度搜索' },
      { id: 'gems', label: 'Gems 专家', icon: 'gem', desc: '自定义 AI 专家' },
      { id: 'usage-stats', label: '用量统计', icon: 'usage', desc: 'API 消耗' },
    ]},
  ],

  /* OpenCode */
  'opencode': [
    { id: 'oc-exclusive', label: 'OpenCode', icon: 'agents', children: [
      { id: 'multi-model', label: '多模型支持', icon: 'multiModel', desc: '75+ 提供商' },
      { id: 'code-search', label: '代码搜索', icon: 'search', desc: '语义搜索代码' },
      { id: 'diff-view', label: 'Diff 视图', icon: 'diff', desc: '变更对比' },
      { id: 'project-index', label: '项目索引', icon: 'directory', desc: 'AGENTS.md 索引' },
    ]},
  ],

  /* OpenClaw */
  'openclaw': [
    { id: 'ocw-exclusive', label: 'OpenClaw', icon: 'agents', children: [
      { id: 'cron-tasks', label: '定时任务', icon: 'cron', desc: 'Cron 调度' },
      { id: 'subagents', label: '子 Agent', icon: 'subagents', desc: '多 Agent 协作' },
    ]},
  ],

  /* Hermes Agent */
  'hermes-agent': [
    { id: 'ha-exclusive', label: 'Hermes Agent', icon: 'agents', children: [
      { id: 'skills-manager', label: '技能管理', icon: 'skills', desc: 'Skill 编排' },
      { id: 'memory', label: '记忆库', icon: 'memory', desc: '持久化记忆' },
      { id: 'toolchain', label: '工具链', icon: 'toolchain', desc: '工具调用链' },
      { id: 'cron-tasks', label: '定时任务', icon: 'cron', desc: 'Cron 调度' },
      { id: 'subagents', label: '子 Agent', icon: 'subagents', desc: '多 Agent 协作' },
    ]},
  ],
};

const TOOL_LABELS: Record<string, string> = {
  'claude-code': 'Claude Code',
  'claude-desktop': 'Claude Desktop',
  'codex': 'Codex CLI',
  'gemini-cli': 'Gemini CLI',
  'opencode': 'OpenCode',
  'openclaw': 'OpenClaw',
  'hermes-agent': 'Hermes Agent',
};

/* ── Props ── */
export interface ToolSidebarProps {
  toolId: string;
  open: boolean;
  onClose: () => void;
  activeView: string;
  onViewChange: (view: string) => void;
  onOpenQuickConfig: () => void;
  onOpenQuickSwitch: () => void;
  onOpenMcp: () => void;
  onOpenSkills: () => void;
  onOpenInstallTools: () => void;
  onOpenTerminal: () => void;
  onOpenAgent: () => void;
  onOpenData: () => void;
  onOpenTheme: () => void;
  onOpenUpdate: () => void;
  onOpenDonate: () => void;
  onOpenAbout: () => void;
  onOpenFeedback: () => void;
  onOpenGuide: () => void;
  onClearCache: () => void;
  onNewChat: () => void;
  isUpdateAvailable?: boolean;
}

export default function ToolSidebar({
  toolId, open, onClose, activeView, onViewChange,
  isUpdateAvailable,
}: ToolSidebarProps) {
  const [groupCollapsed, setGroupCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setGroupCollapsed({});
  }, [toolId]);

  const toggleGroup = (id: string) => {
    setGroupCollapsed(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const getIcon = (name: string) => Icons[name] || Icons.agents;

  const groups = TOOL_MENUS[toolId] || [];
  const toolLabel = TOOL_LABELS[toolId] || toolId;

  const handleSubClick = (subId: string) => {
    // 全部跳转到 activeView，由主视图决定渲染什么
    onViewChange(subId);
    onClose();
  };

  if (!open) return null;

  return (
    <div className="tool-sidebar">
      <div className="ts-header">
        <span className="ts-title">{toolLabel}</span>
        <button className="ts-close" onClick={onClose} title="收起">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
      </div>

      <nav className="ts-nav">
        {groups.map(group => (
          <div key={group.id} className="ts-group">
            <div className="ts-group-header" onClick={() => toggleGroup(group.id)}>
              {getIcon(group.icon)}
              <span className="ts-group-label">{group.label}</span>
              <svg className={`ts-arrow${groupCollapsed[group.id] ? ' collapsed' : ''}`} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </div>
            {!groupCollapsed[group.id] && (
              <div className="ts-group-items">
                {group.children.map(sub => (
                  <div
                    key={sub.id}
                    className={`ts-item${activeView === sub.id ? ' active' : ''}`}
                    onClick={() => handleSubClick(sub.id)}
                    title={sub.desc || sub.label}
                  >
                    {getIcon(sub.icon)}
                    <span className="ts-item-label">{sub.label}</span>
                    {sub.desc && <span className="ts-item-desc">{sub.desc}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </nav>
    </div>
  );
}
