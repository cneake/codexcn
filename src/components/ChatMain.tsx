import React, { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { open as openExternal } from '@tauri-apps/plugin-shell';
import { getCurrentWindow } from '@tauri-apps/api/window';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import codexhubAvatar from '../assets/codexhub-avatar.svg';
import hermesAvatar from '../assets/hermes-avatar.png';
import './ChatMain.css';

const TOOL_AVATARS: Record<string, string> = {
  'hermes-agent': hermesAvatar,
  'openclaw': '/icons/openclaw.png',
  'claude-code': '/icons/claude-code.png',
  'codex': '/icons/codex.png',
  'deepseek-cli': '/icons/deepseek-cli.png',
  'gemini-cli': '/icons/gemini-cli.png',
  'grok-build': '/icons/grok-build.png',
  'opencode': '/icons/opencode.png',
  'qoder': '/icons/qoder.png',
};
import CodeRunnerModal from './CodeRunnerModal';
import GitPanel from './GitPanel';
import { calculateCost, fmtCost, fmtCostCNY } from '../pricing';
import { isCronIntent, parseChineseTime, extractCronMessage, genCronName, hasTimeHint } from './CronIntent';

/* ── 每工具斜杠命令 ── */
const TOOL_COMMANDS: Record<string, Array<{ cmd: string; desc: string; action?: string }>> = {
  'claude-code': [
    { cmd: '/model', desc: '切换 Claude 模型', action: 'providers' },
    { cmd: '/skills', desc: '查看/安装技能', action: 'skills' },
    { cmd: '/memory', desc: '项目管理记忆', action: 'memory' },
    { cmd: '/schedule', desc: '定时执行任务', action: 'cron' },
    { cmd: '/plan', desc: '生成执行计划' },
    { cmd: '/status', desc: '当前会话状态' },
    { cmd: '/cost', desc: 'Token 用量统计' },
    { cmd: '/compact', desc: '压缩上下文' },
    { cmd: '/clear', desc: '清除当前对话' },
    { cmd: '/init', desc: '初始化项目配置' },
  ],
  'claude-desktop': [
    { cmd: '/model', desc: '切换模型', action: 'providers' },
    { cmd: '/help', desc: '查看帮助' },
  ],
  'codex': [
    { cmd: '/model', desc: '切换模型', action: 'providers' },
    { cmd: '/goal', desc: '设定长期目标', action: 'cron' },
    { cmd: '/init', desc: '初始化项目' },
    { cmd: '/plan', desc: '生成执行计划' },
    { cmd: '/skills', desc: '技能市场', action: 'skills' },
    { cmd: '/help', desc: '查看帮助' },
  ],
  'gemini-cli': [
    { cmd: '/model', desc: '切换模型', action: 'providers' },
    { cmd: '/skills', desc: '扩展/Skills', action: 'skills' },
    { cmd: '/init', desc: '初始化 GEMINI.md' },
    { cmd: '/help', desc: '查看帮助' },
  ],
  'opencode': [
    { cmd: '/model', desc: '切换模型/提供商', action: 'providers' },
    { cmd: '/init', desc: '初始化项目', action: 'agent-management' },
    { cmd: '/connect', desc: '配置 API 提供商' },
    { cmd: '/docs', desc: '搜索文档' },
    { cmd: '/skills', desc: 'Code Skills', action: 'skills' },
    { cmd: '/help', desc: '查看帮助' },
  ],
  'deepseek-cli': [
    { cmd: '/model', desc: '切换模型', action: 'providers' },
    { cmd: '/help', desc: '查看帮助' },
    { cmd: '/clear', desc: '清除对话' },
  ],
  'openclaw': [
    { cmd: '/model', desc: '切换模型', action: 'providers' },
    { cmd: '/skills', desc: '技能市场', action: 'skills' },
    { cmd: '/memory', desc: '记忆库管理', action: 'memory' },
    { cmd: '/cron', desc: '定时任务', action: 'cron' },
    { cmd: '/agent', desc: '子Agent 管理', action: 'agent-management' },
    { cmd: '/help', desc: '查看帮助' },
    { cmd: '/status', desc: '运行时状态' },
  ],
  'hermes-agent': [
    { cmd: '/model', desc: '切换模型', action: 'providers' },
    { cmd: '/skill', desc: '自动生成技能', action: 'skills' },
    { cmd: '/memory', desc: '三层记忆管理', action: 'memory' },
    { cmd: '/cron', desc: '定时任务', action: 'cron' },
    { cmd: '/agent', desc: '子Agent 协作', action: 'agent-management' },
    { cmd: '/help', desc: '查看帮助' },
  ],
};

/* ── 工具快捷入口（每工具差异化，内容对应其真实官方功能）── */
const TOOL_SHORTCUTS: Record<string, Array<{ id: string; label: string; desc: string }>> = {
  /* Claude Code — CLI: /model /skills /memory /context /stats /schedule /plan */
  'claude-code': [
    { id: 'quick-switch', label: '一键切换', desc: '/model 切换 Claude 模型' },
    { id: 'sandbox', label: '沙箱', desc: '代码沙箱' },
    { id: 'cron', label: '定时任务', desc: '/schedule 定时执行' },
    { id: 'terminal', label: '终端', desc: '调用 Claude Code CLI' },
    { id: 'skills', label: '技能', desc: '/skills 查看安装' },
    { id: 'memory', label: '记忆', desc: '/memory 项目管理' },
  ],
  /* Claude Desktop — GUI 桌面应用，侧重模型+设置 */
  'claude-desktop': [
    { id: 'quick-switch', label: '一键切换', desc: '模型选择' },
    { id: 'terminal', label: '终端', desc: 'CLI 调用' },
    { id: 'memory', label: '知识库', desc: '项目知识' },
  ],
  /* Codex — 桌面端: 多Agent/技能市场/定时任务/插件/内部浏览器 */
  'codex': [
    { id: 'quick-switch', label: '一键切换', desc: 'Codex 模型选择' },
    { id: 'sandbox', label: '沙箱', desc: '代码沙箱' },
    { id: 'terminal', label: '终端', desc: '调用 Codex CLI' },
    { id: 'skills', label: '技能市场', desc: 'Skills 插件市场' },
    { id: 'cron', label: '定时任务', desc: '/goal 长期目标' },
    { id: 'orchestrator', label: '多Agent', desc: '并行子Agent' },
  ],
  /* Gemini CLI — 子Agent / MCP / Skills / GEMINI.md / 自动化 */
  'gemini-cli': [
    { id: 'quick-switch', label: '一键切换', desc: 'Gemini 模型选择' },
    { id: 'terminal', label: '终端', desc: '调用 Gemini CLI' },
    { id: 'skills', label: '技能', desc: 'Ext/Skills' },
    { id: 'orchestrator', label: '子Agent', desc: '任务委派' },
  ],
  /* OpenCode — /init /connect /子Agent /skills /多Provider /会话管理 */
  'opencode': [
    { id: 'quick-switch', label: '一键切换', desc: '多提供商切换' },
    { id: 'terminal', label: '终端', desc: '调用 OpenCode CLI' },
    { id: 'skills', label: '技能', desc: 'Code Skills' },
    { id: 'orchestrator', label: '子Agent', desc: '并行子任务' },
  ],
  /* DeepSeek CLI — 简洁工具，模型+终端为主 */
  'deepseek-cli': [
    { id: 'quick-switch', label: '一键切换', desc: 'DeepSeek R1/V3' },
    { id: 'terminal', label: '终端', desc: '调用 DeepSeek CLI' },
  ],
  /* OpenClaw — 技能/记忆/定时任务/子Agent */
  'openclaw': [
    { id: 'quick-switch', label: '一键切换', desc: '模型选择' },
    { id: 'sandbox', label: '沙箱', desc: '代码沙箱' },
    { id: 'terminal', label: '终端', desc: 'OpenClaw 终端' },
    { id: 'skills', label: '技能', desc: '技能市场' },
    { id: 'memory', label: '记忆', desc: '记忆库管理' },
    { id: 'cron', label: '定时任务', desc: 'Cron 调度' },
    { id: 'orchestrator', label: '子Agent', desc: '多Agent协作' },
  ],
  /* Hermes Agent — 自动Skill/三层记忆/定时/子Agent/工具链 */
  'hermes-agent': [
    { id: 'quick-switch', label: '一键切换', desc: '200+模型' },
    { id: 'sandbox', label: '沙箱', desc: '代码沙箱' },
    { id: 'skills', label: '技能', desc: '自动生成Skill' },
    { id: 'memory', label: '记忆', desc: '三层持久记忆' },
    { id: 'cron', label: '定时任务', desc: '自动执行' },
    { id: 'orchestrator', label: '子Agent', desc: '协作执行' },
    { id: 'terminal', label: '工具链', desc: '调用链终端' },
  ],
  /* Qoder CLI — 阿里云通义千问，Auto模型/技能/MCP/终端 */
  'qoder-cli': [
    { id: 'quick-switch', label: '一键切换', desc: '通义千问 Auto' },
    { id: 'terminal', label: '终端', desc: '调用 Qoder CLI' },
    { id: 'skills', label: '技能', desc: 'MCP Skills' },
    { id: 'orchestrator', label: '子Agent', desc: '任务委派' },
  ],
};

/* ── 类型 ── */
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  kind?: 'skill-invocation';
  skill?: { slug: string; name: string };
  tool_calls?: { id: string; name: string; input: any; result?: string }[];
  files?: Array<{ name: string; kind: 'image' | 'text' | 'binary'; chars?: number; truncated?: boolean; originalChars?: number }>;
}

interface ChatSession {
  id: string;
  tool_id: string;
  title: string;
  created_at: number;
  updated_at: number;
  message_count: number;
  preview: string;
}

interface Props {
  toolId: string;
  session: ChatSession | null;
  sessions?: ChatSession[];
  onSessionChange: (session: ChatSession) => void;
  onNewSession: () => void;
  onBack?: () => void;
  onToast: (msg: string) => void;
  activeView?: string;
  onViewChange?: (view: string) => void;
  onBundledSkillsOpen?: () => void;
  user?: { id: number; name: string; avatar_url?: string } | null;
  onLogin?: () => void;
  onLogout?: () => void;
  onOpenQuickSwitch?: () => void;
}

export default function ChatMain({ toolId, session, sessions = [], onSessionChange, onNewSession, onToast, activeView, onViewChange, onBundledSkillsOpen, user, onLogin, onLogout, onOpenQuickSwitch }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [cmdOpen, setCmdOpen] = useState(false);
  const [cmdIdx, setCmdIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiConfig, setApiConfig] = useState<{ api_key: string; base_url: string; model: string } | null>(null);
  const [providerPricing, setProviderPricing] = useState<{ inputPrice: number | null; outputPrice: number | null } | null>(null);
  const [tokenUsage, setTokenUsage] = useState<{ input: number; output: number } | null>(null);
  const [totalUsage, setTotalUsage] = useState<{ input: number; output: number } | null>(null);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [dailyUsage, setDailyUsage] = useState<{date:string;input:number;output:number}[] | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isFirstLoadRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [pendingImages, setPendingImages] = useState<Array<{ id: string; url: string; kind?: 'image' | 'text' | 'binary'; name?: string }>>([]);
  const [voiceActive, setVoiceActive] = useState(false);
  const voiceRecognitionRef = useRef<any>(null);
  const [sessionSwitchOpen, setSessionSwitchOpen] = useState(false);
  const resizeDragRef = useRef<{ startY: number; startH: number } | null>(null);
  const unlistenRef = useRef<UnlistenFn[]>([]);
  // 定时任务触发：保持 handleSend / loading 的最新引用，供事件监听调用
  const loadingRef = useRef(loading);
  useEffect(() => { loadingRef.current = loading; }, [loading]);
  const handleSendRef = useRef<(overrideText?: string, skipCronCheck?: boolean) => Promise<void>>(async () => {});
  // CodeRunner
  const [codeRunnerOpen, setCodeRunnerOpen] = useState(false);
  const [codeRunnerCode, setCodeRunnerCode] = useState('');
  const [codeRunnerLang, setCodeRunnerLang] = useState('');
  const [realFilePath, setRealFilePath] = useState<string | undefined>(undefined);
  const [realFileContent, setRealFileContent] = useState<string | undefined>(undefined);
  const [gitPanelOpen, setGitPanelOpen] = useState(false);
  const [gitWorkspaceDir, setGitWorkspaceDir] = useState('');
  // 公告
  const [announcement, setAnnouncement] = useState<{ enabled: boolean; id?: number; title?: string; content: string; link: string; external_link?: string; level: string; updated_at: string; category?: string; start_date?: string; end_date?: string } | null>(null);
  const [announcementModalOpen, setAnnouncementModalOpen] = useState(false);
  const [announcementDismissed, setAnnouncementDismissed] = useState<string>('');
  // 已安装技能列表（用于关键词检测弹窗）
  const installedSkillsRef = useRef<{slug: string; name?: string}[]>([]);

  // 内置硬编码技能映射（不依赖 skills/ 目录是否有文件）
  // 用户输入消息中出现这些 slug → 立即触发浮窗
  const BUILTIN_SKILLS: {slug: string; name: string; patterns: string[]}[] = [
    { slug: 'polymarket', name: 'Polymarket 预测市场', patterns: ['polymarket'] },
    { slug: 'test-hello-agent', name: '测试 Hello Agent', patterns: ['test-hello-agent', 'test', 'hello'] },
    { slug: 'email-skill', name: '邮件发送', patterns: ['邮件', 'email', 'mail'] },
    { slug: 'cloud-upload', name: '云上传', patterns: ['上传', 'upload', '备份'] },
    { slug: 'find-skills', name: '找技能', patterns: ['找技能', 'find skills', '发现'] },
  ];

  /* ── 加载已安装技能列表（合并内置） ── */
  useEffect(() => {
    const load = async () => {
      try {
        const list: any = await invoke('get_installed_skills');
        if (Array.isArray(list)) {
          installedSkillsRef.current = list.filter((s: any) => !s.savedOnly);
        }
      } catch {}
    };
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  /* ── 拉取公告 ── */
  useEffect(() => {
    const loadAnnouncement = async () => {
      try {
        const data: any = await invoke('get_announcement');
        if (data && typeof data === 'object') {
          setAnnouncement(data);
          // 读取已关闭的 updated_at
          const dismissed = localStorage.getItem('codexhub-announcement-dismissed') || '';
          setAnnouncementDismissed(dismissed);
        }
      } catch {}
    };
    loadAnnouncement();
  }, []);

  const dismissAnnouncement = () => {
    if (!announcement) return;
    localStorage.setItem('codexhub-announcement-dismissed', announcement.updated_at || '');
    setAnnouncementDismissed(announcement.updated_at || '');
  };

  const openAnnouncementModal = () => {
    if (!announcement) return;
    setAnnouncementModalOpen(true);
  };

  /* ── 加载 API 配置 ── */
  useEffect(() => {
    let cancelled = false;
    setError(null);
    invoke('get_tool_api_config', { toolId }).then((config: any) => {
      if (!cancelled) setApiConfig(config);
    }).catch((e: any) => {
      console.error('[ChatMain] get_tool_api_config failed:', e);
      setApiConfig(null);
      setError(`API 配置加载失败: ${e}`);
    });
    return () => { cancelled = true; };
  }, [toolId]);

  /* ── 加载 Provider 单价 ── */
  useEffect(() => {
    let cancelled = false;
    invoke('get_active_provider_for_tool', { toolId }).then((provider: any) => {
      if (!cancelled && provider) {
        setProviderPricing({
          inputPrice: provider.input_price ?? null,
          outputPrice: provider.output_price ?? null,
        });
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [toolId]);

  /* ── 加载 Token 用量 ── */
  useEffect(() => {
    let cancelled = false;
    invoke('get_usage_stats').then((data: any) => {
      if (cancelled) return;
      const arr = Array.isArray(data) ? data : [];
      const found = arr.find((u: any) => u.tool_id === toolId);
      if (found) {
        setTokenUsage({
          input: Number(found.total_input_tokens || 0),
          output: Number(found.total_output_tokens || 0),
        });
      } else {
        setTokenUsage(null);
      }
    }).catch(() => { if (!cancelled) setTokenUsage(null); });
    return () => { cancelled = true; };
  }, [toolId]);

  /* ── 加载总用量 ── */
  useEffect(() => {
    let cancelled = false;
    invoke('get_total_usage').then((data: any) => {
      if (!cancelled && data) {
        setTotalUsage({
          input: Number(data.total_input_tokens || 0),
          output: Number(data.total_output_tokens || 0),
        });
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  /* 打开账本时加载 7 日趋势 + 费用明细 */
  useEffect(() => {
    if (!ledgerOpen) return;
    let cancelled = false;
    setDailyUsage(null);
    loadCostBreakdown();
    invoke('get_daily_usage', { toolId, days: 7 }).then((data: any) => {
      if (!cancelled && data) {
        setDailyUsage(data.map((row: any[]) => ({
          date: row[0] as string,
          input: Number(row[1] || 0),
          output: Number(row[2] || 0),
        })));
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [ledgerOpen, toolId]);

  const fmtTokens = (n: number): string => {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
    return String(n);
  };

  const [costBreakdown, setCostBreakdown] = useState<Array<{tool_id:string;model:string;input_tokens:number;output_tokens:number}>>([]);

  const getCost = (): string => {
    if (!tokenUsage || !apiConfig?.model) return '—';
    const { costUsd, costCny } = calculateCost(
      apiConfig.model,
      tokenUsage.input,
      tokenUsage.output,
      providerPricing?.inputPrice,
      providerPricing?.outputPrice
    );
    return fmtCost(costUsd, costCny);
  };

  /** 计算某工具的累计费用 */
  const calcToolCost = (toolId: string): { costUsd: number; costCny: number; input: number; output: number } => {
    const breakdowns = costBreakdown.filter(b => b.tool_id === toolId);
    let costUsd = 0, costCny = 0, input = 0, output = 0;
    if (breakdowns.length > 0) {
      // 有模型明细：按模型累加费用
      for (const b of breakdowns) {
        input += b.input_tokens;
        output += b.output_tokens;
        const c = calculateCost(b.model, b.input_tokens, b.output_tokens);
        costUsd += c.costUsd;
        costCny += c.costCny;
      }
    } else {
      // 无模型明细：从 tokenUsage/totalUsage 拿数据，并用当前工具默认模型定价
      const usage = (tokenUsage && toolId === toolId ? tokenUsage : null) || totalUsage;
      input = usage?.input || 0;
      output = usage?.output || 0;
      // 尝试从当前模型的默认定价计算
      if (usage) {
        const c = calculateCost(apiConfig?.model || toolId, input, output);
        costUsd = c.costUsd;
        costCny = c.costCny;
      }
    }
    return { costUsd, costCny, input, output };
  };

  /** 加载费用明细 */
  const loadCostBreakdown = () => {
    invoke('get_cost_breakdown').then((data: any) => {
      if (Array.isArray(data)) setCostBreakdown(data);
    }).catch(() => {});
  };

  const toolName: Record<string,string> = {
    'hermes-agent': 'Hermes Agent',
    'openclaw': 'OpenClaw',
    'claude-code': 'Claude Code',
    'codex': 'Codex',
    'gemini-cli': 'Gemini CLI',
    'opencode': 'OpenCode',
  };
  const displayName = toolName[toolId] || toolId;

  /* ── 加载消息 ── */
  const loadMessages = async (sessionId: string) => {
    try {
      const msgs = await invoke('get_chat_messages', { sessionId }) as ChatMessage[];
      setMessages(msgs);
    } catch(e) { console.error('[ChatMain] 消息加载失败:', e); }
  };

  useEffect(() => {
    if (session) loadMessages(session.id);
    else setMessages([]);
  }, [session?.id]);

  // 点击外部关闭会话切换下拉菜单
  useEffect(() => {
    if (!sessionSwitchOpen) return;
    const handler = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (!el.closest('.cm-session-switcher')) setSessionSwitchOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [sessionSwitchOpen]);

  /* ── 新建会话 ── */
  const handleNewSession = () => {
    onNewSession();
  };

  /* ── 会话标题编辑 (D) ── */
  const startEditTitle = () => {
    if (!session) return;
    setTitleDraft(session.title);
    setEditingTitle(true);
  };
  const saveTitle = async () => {
    if (!session || !titleDraft.trim()) { setEditingTitle(false); return; }
    try {
      await invoke('rename_chat_session', { sessionId: session.id, title: titleDraft.trim() });
      onSessionChange({ ...session, title: titleDraft.trim() });
      onToast('会话已重命名');
      setTimeout(() => onToast(''), 3000);
    } catch (e: any) { onToast('重命名失败'); }
    setEditingTitle(false);
  };

  /* ── 删除会话 (D) ── */
  const handleDeleteSession = async () => {
    if (!session) return;
    try {
      await invoke('delete_chat_session', { sessionId: session.id });
      onNewSession();
      onToast('会话已删除');
      setTimeout(() => onToast(''), 3000);
    } catch (e: any) { onToast('删除失败'); }
  };

  /* ── 代码复制 (B) ── */
  const copyCode = useCallback((code: string) => {
    navigator.clipboard.writeText(code).then(() => onToast('已复制代码')).catch(() => onToast('复制失败'));
    setTimeout(() => onToast(''), 2000);
  }, [onToast]);

  /* ── CodeRunner 打开函数 ── */
  const openCodeRunner = useCallback((code: string, lang: string) => {
    setCodeRunnerCode(code);
    setCodeRunnerLang(lang);
    setRealFilePath(undefined); // 清空真实文件
    setRealFileContent(undefined);
    setCodeRunnerOpen(true);
  }, [setCodeRunnerCode, setCodeRunnerLang, setRealFilePath, setRealFileContent, setCodeRunnerOpen]);

  /* ── CodeRunner 打开真实文件 ── */
  const openRealFile = useCallback((path: string, content: string) => {
    setRealFilePath(path);
    setRealFileContent(content);
    setCodeRunnerOpen(true);
  }, []);

  /* ── Markdown 自定义渲染 (B) ── */
  const renderPre = useCallback(({ children, node, ...props }: any) => {
    // 优先从 AST node 取 raw text（最可靠，不依赖 react-markdown children 结构）
    let plainCode = '';
    let lang = '';
    if (node?.children?.[0]) {
      const codeNode = node.children[0];
      lang = (codeNode.properties?.className?.[0] || '').replace('language-', '');
      // textNode 可能是单个或多个
      const textParts = (codeNode.children || [])
        .filter((c: any) => c.type === 'text' || c.tagName === undefined)
        .map((c: any) => c.value || '');
      plainCode = textParts.join('');
    }
    // Fallback: 从 children prop 提取
    if (!plainCode) {
      const codeChild = Array.isArray(children) ? children[0] : children;
      const cp: any = codeChild && typeof codeChild === 'object' && 'props' in codeChild
        ? codeChild.props : null;
      if (cp) {
        if (!lang) lang = (cp.className || '').replace('language-', '');
        const c = cp.children;
        if (typeof c === 'string') plainCode = c;
        else if (Array.isArray(c)) plainCode = c.join('');
        else if (c && typeof c === 'object' && 'props' in c) {
          const cc = (c as any).props?.children;
          if (typeof cc === 'string') plainCode = cc;
          else if (Array.isArray(cc)) plainCode = cc.join('');
        }
      }
    }
    return (
      <pre {...props}>
        <div className="cm-code-header">
          <span className="cm-code-lang">{lang || 'code'}</span>
          <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
            <button
              className="cm-copy-btn"
              style={{ background: '#0f2a1e', color: '#00ff88', borderColor: '#00ff88' }}
              onClick={() => openCodeRunner(plainCode, lang || 'text')}
            >▶ 运行</button>
            <button className="cm-copy-btn" onClick={() => copyCode(plainCode)}>复制</button>
          </div>
        </div>
        {children}
      </pre>
    );
  }, [copyCode, openCodeRunner]);

  const [imgPreview, setImgPreview] = useState<string | null>(null);
  const renderImg = useCallback(({ src, alt, ...props }: any) => (
    <img
      className="cm-msg-img"
      src={src}
      alt={alt || '图片'}
      title="点击查看大图"
      onClick={() => setImgPreview(src)}
    />
  ), []);

  // 消息内容渲染：先提取 data:image 图片独立渲染，剩下的用 ReactMarkdown
  const renderMessageBody = (content: string, role: string, files?: ChatMessage['files']) => {
    if (role === 'assistant' && !content.trim()) {
      return (
        <div className="cm-thinking">
          <span className="cm-thinking-text">正在思考…</span>
          <span className="cm-thinking-dots"><i></i><i></i><i></i></span>
        </div>
      );
    }
    // 文件卡片（非图片文件，文本/二进制）
    const fileCards = (files && files.length > 0) ? (
      <div className="cm-msg-files">
        {files.map((f, i) => {
          if (f.kind === 'image') return null;
          return (
            <div key={i} className="cm-msg-file-card" title={f.kind === 'text' ? '文本文件' : '二进制附件'}>
              <span className="cm-msg-file-icon">{f.kind === 'text' ? '📄' : '📎'}</span>
              <div className="cm-msg-file-info">
                <div className="cm-msg-file-name">{f.name}</div>
                <div className="cm-msg-file-meta">
                  {f.kind === 'text' && (
                    f.truncated
                      ? `截断发送 · ${f.chars} / ${f.originalChars} 字`
                      : `${f.chars ?? 0} 字`
                  )}
                  {f.kind === 'binary' && '附件 · 不会发送给 AI'}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    ) : null;
    // 从显示内容中剥离文件原始内容（卡片代替）
    let displayContent = content;
    if (files && files.length > 0) {
      files.forEach(f => {
        if (f.kind === 'text' && f.name) {
          const escapedName = f.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const fileBlock = new RegExp(`\\n*\\n*--- 文件 ${escapedName} ---\\n[\\s\\S]*?(?=\\n\\n(?!\\n)|$)`, 'g');
          displayContent = displayContent.replace(fileBlock, '');
          const truncMarker = /\n*\n*\[\u2026 已截断[^\]]*\]/g;
          displayContent = displayContent.replace(truncMarker, '');
        } else if (f.kind === 'binary' && f.name) {
          const escapedName = f.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const binary = new RegExp(`\\[文件: ${escapedName}\\]`, 'g');
          displayContent = displayContent.replace(binary, '');
        }
      });
      displayContent = displayContent.trim();
    }
    const imgRegex = /!\[([^\]]*)\]\((data:image\/[^)]+)\)/g;
    const parts: Array<{ type: 'img' | 'text'; val: string; alt?: string }> = [];
    let lastIdx = 0;
    let m: RegExpExecArray | null;
    while ((m = imgRegex.exec(displayContent)) !== null) {
      if (m.index > lastIdx) parts.push({ type: 'text', val: displayContent.slice(lastIdx, m.index) });
      parts.push({ type: 'img', val: m[2], alt: m[1] });
      lastIdx = m.index + m[0].length;
    }
    if (lastIdx < displayContent.length) parts.push({ type: 'text', val: displayContent.slice(lastIdx) });
    if (parts.length === 0) parts.push({ type: 'text', val: displayContent });
    return (
      <>
        {fileCards}
        {parts.map((p, i) => p.type === 'img' ? (
          <img
            key={i}
            className="cm-msg-img"
            src={p.val}
            alt={p.alt || '图片'}
            title="点击查看大图"
            onClick={() => setImgPreview(p.val)}
          />
        ) : (
          <ReactMarkdown
            key={i}
            remarkPlugins={[remarkGfm]}
            components={{ pre: renderPre }}
          >
            {p.val}
          </ReactMarkdown>
        ))}
      </>
    );
  };
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        e.preventDefault();
        onToast('图片暂不支持发送，请发送文字');
        setTimeout(() => onToast(''), 3000);
        return;
      }
    }
  };

  /* DEBUG_SCREENSHOT_ENABLED_V1 */
  const [fullScreenshotData, setFullScreenshotData] = useState<string | null>(null);
  const [selStart, setSelStart] = useState<{x: number, y: number} | null>(null);
  const [selEnd, setSelEnd] = useState<{x: number, y: number} | null>(null);
  // 选区交互状态机：idle(无选区) → drawing(正在画) → selected(已选，可拖/缩放) → dragging/resizing(交互中)
  const [ssMode, setSsMode] = useState<'idle' | 'drawing' | 'selected' | 'dragging' | 'resizing'>('idle');
  // 当前正在缩放的把手：nw/n/ne/e/se/s/sw/w
  const [activeHandle, setActiveHandle] = useState<string | null>(null);
  // 拖动时，鼠标到选区左上角的偏移
  const [dragOffset, setDragOffset] = useState<{dx: number, dy: number} | null>(null);
  // 选区形状：矩形 / 自由套索 / 窗口识别
  const [ssShape, setSsShape] = useState<'rect' | 'free' | 'window'>('rect');
  // 自由套索路径（viewport 坐标）
  const [freePath, setFreePath] = useState<{x: number, y: number}[]>([]);
  // 窗口识别：可见窗口列表
  const [windowList, setWindowList] = useState<{hwnd: string, title: string, left: number, top: number, right: number, bottom: number}[]>([]);
  const overlayImgRef = useRef<HTMLImageElement>(null);

  const handleScreenshot = async () => {
    try {
      onToast('正在截图…');
      // capture_immediate：直接截全屏（包含 App 自身），让用户在 overlay 里选要哪部分
      const result = await invoke<string>('capture_immediate');
      if (!result || result.length < 100) {
        onToast('截图失败');
        setTimeout(() => onToast(''), 3000);
        return;
      }
      setFullScreenshotData(result);
      setSsMode('idle');
      setActiveHandle(null);
      setDragOffset(null);
      setFreePath([]);
      onToast('');
    } catch (e) {
      onToast('截图失败，请重试');
      setTimeout(() => onToast(''), 3000);
    }
  };

  // canvas 裁剪
  const doCrop = (x: number, y: number, w: number, h: number) => {
    if (w < 10 || h < 10) { cancelCrop(); return; }
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/png');
      const id = `ss_${Date.now()}`;
      setPendingImages(prev => [...prev, { id, url: dataUrl }]);
      cancelCrop();
      onToast('截图已添加');
      setTimeout(() => onToast(''), 2000);
    };
    img.onerror = () => { onToast('裁剪失败'); setTimeout(() => onToast(''), 3000); };
    img.src = fullScreenshotData!;
  };

  // 按显示坐标裁剪（用于矩形选区与窗口识别）
  const cropFromRect = (left: number, top: number, w: number, h: number) => {
    if (!fullScreenshotData || !overlayImgRef.current) return;
    const img = overlayImgRef.current;
    const sx = img.naturalWidth / img.clientWidth;
    const sy = img.naturalHeight / img.clientHeight;
    const x = Math.round(left * sx);
    const y = Math.round(top * sy);
    const cw = Math.max(1, Math.round(w * sx));
    const ch = Math.max(1, Math.round(h * sy));
    doCrop(x, y, cw, ch);
  };

  const confirmCrop = () => {
    if (!fullScreenshotData || !overlayImgRef.current) return;
    const img = overlayImgRef.current;
    const sx = img.naturalWidth / img.clientWidth;
    const sy = img.naturalHeight / img.clientHeight;
    if (ssShape === 'free') {
      if (freePath.length < 3) return;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of freePath) {
        if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
      }
      const bx = Math.round(minX * sx);
      const by = Math.round(minY * sy);
      const bw = Math.max(1, Math.round((maxX - minX) * sx));
      const bh = Math.max(1, Math.round((maxY - minY) * sy));
      const canvas = document.createElement('canvas');
      canvas.width = bw; canvas.height = bh;
      const ctx = canvas.getContext('2d')!;
      const full = new Image();
      full.onload = () => {
        ctx.save();
        ctx.beginPath();
        freePath.forEach((p, i) => {
          const px = Math.round(p.x * sx) - bx;
          const py = Math.round(p.y * sy) - by;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        });
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(full, bx, by, bw, bh, 0, 0, bw, bh);
        ctx.restore();
        const dataUrl = canvas.toDataURL('image/png');
        const id = `ss_${Date.now()}`;
        setPendingImages(prev => [...prev, { id, url: dataUrl }]);
        cancelCrop();
        onToast('截图已添加');
        setTimeout(() => onToast(''), 2000);
      };
      full.onerror = () => { onToast('裁剪失败'); setTimeout(() => onToast(''), 3000); };
      full.src = fullScreenshotData;
      return;
    }
    if (!selStart || !selEnd) return;
    const left = Math.min(selStart.x, selEnd.x);
    const top = Math.min(selStart.y, selEnd.y);
    const w = Math.abs(selEnd.x - selStart.x);
    const h = Math.abs(selEnd.y - selStart.y);
    cropFromRect(left, top, w, h);
  };

  const cancelCrop = () => {
    setFullScreenshotData(null);
    setSelStart(null);
    setSelEnd(null);
    setSsMode('idle');
    setActiveHandle(null);
    setDragOffset(null);
    setFreePath([]);
  };

  // 切换选区形状（矩形 / 自由套索 / 窗口识别），切换时重置选区
  const switchShape = async (shape: 'rect' | 'free' | 'window') => {
    setSsShape(shape);
    setSelStart(null);
    setSelEnd(null);
    setFreePath([]);
    setSsMode('idle');
    setActiveHandle(null);
    setDragOffset(null);
    if (shape === 'window') {
      try {
        const wins = await invoke('get_visible_windows') as {hwnd: string, title: string, left: number, top: number, right: number, bottom: number}[];
        setWindowList(wins);
      } catch (e) {
        console.error('枚举窗口失败', e);
        setWindowList([]);
      }
    } else {
      setWindowList([]);
    }
  };

  // 选区几何工具
  const getSelRect = () => {
    if (ssShape === 'free' && freePath.length >= 2) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of freePath) {
        if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
      }
      return { left: minX, top: minY, w: maxX - minX, h: maxY - minY };
    }
    if (!selStart || !selEnd) return null;
    const left = Math.min(selStart.x, selEnd.x);
    const top = Math.min(selStart.y, selEnd.y);
    return { left, top, w: Math.abs(selEnd.x - selStart.x), h: Math.abs(selEnd.y - selStart.y) };
  };
  const pointInSel = (x: number, y: number) => {
    const r = getSelRect();
    if (!r) return false;
    return x >= r.left && x <= r.left + r.w && y >= r.top && y <= r.top + r.h;
  };

  // 鼠标事件（坐标系 = viewport，因 .cm-ss-interact 占满全屏）
  const onOverlayMouseDown = (e: React.MouseEvent) => {
    if (!fullScreenshotData) return;
    if (e.button !== 0) return; // 只处理左键
    const target = e.target as HTMLElement;
    if (ssShape === 'rect') {
      // 1) 点了 8 个把手之一 → 进入缩放
      const handle = target.getAttribute('data-handle');
      if (handle) {
        setActiveHandle(handle);
        setSsMode('resizing');
        e.preventDefault();
        return;
      }
      // 2) 选区内部（不是把手）→ 进入拖动
      if (pointInSel(e.clientX, e.clientY) && selStart && selEnd) {
        const r = getSelRect()!;
        setDragOffset({ dx: e.clientX - r.left, dy: e.clientY - r.top });
        setSsMode('dragging');
        e.preventDefault();
        return;
      }
      // 3) 其它区域 → 重新画矩形选区
      setSelStart({ x: e.clientX, y: e.clientY });
      setSelEnd({ x: e.clientX, y: e.clientY });
    } else {
      // 自由套索：起点
      setFreePath([{ x: e.clientX, y: e.clientY }]);
    }
    setSsMode('drawing');
    setActiveHandle(null);
    setDragOffset(null);
  };
  const onOverlayMouseMove = (e: React.MouseEvent) => {
    if (!fullScreenshotData) return;
    if ((e.buttons & 1) === 0) return; // 鼠标左键没按住 → 不更新选区
    if (ssShape === 'free' && ssMode === 'drawing') {
      setFreePath(prev => {
        const last = prev[prev.length - 1];
        if (!last || Math.hypot(e.clientX - last.x, e.clientY - last.y) > 3) {
          return [...prev, { x: e.clientX, y: e.clientY }];
        }
        return prev;
      });
      return;
    }
    if (ssShape === 'rect' && ssMode === 'drawing' && selStart) {
      setSelEnd({ x: e.clientX, y: e.clientY });
      return;
    }
    if (ssMode === 'dragging' && selStart && selEnd && dragOffset) {
      const r = getSelRect()!;
      const maxX = Math.max(0, window.innerWidth - r.w);
      const maxY = Math.max(0, window.innerHeight - r.h);
      const newLeft = Math.max(0, Math.min(maxX, e.clientX - dragOffset.dx));
      const newTop = Math.max(0, Math.min(maxY, e.clientY - dragOffset.dy));
      setSelStart({ x: newLeft, y: newTop });
      setSelEnd({ x: newLeft + r.w, y: newTop + r.h });
      return;
    }
    if (ssMode === 'resizing' && selStart && selEnd && activeHandle) {
      const minX = Math.min(selStart.x, selEnd.x);
      const maxX = Math.max(selStart.x, selEnd.x);
      const minY = Math.min(selStart.y, selEnd.y);
      const maxY = Math.max(selStart.y, selEnd.y);
      const MIN = 10;
      let nMinX = minX, nMaxX = maxX, nMinY = minY, nMaxY = maxY;
      if (activeHandle.includes('w')) nMinX = Math.max(0, Math.min(e.clientX, maxX - MIN));
      if (activeHandle.includes('e')) nMaxX = Math.min(window.innerWidth, Math.max(e.clientX, minX + MIN));
      if (activeHandle.includes('n')) nMinY = Math.max(0, Math.min(e.clientY, maxY - MIN));
      if (activeHandle.includes('s')) nMaxY = Math.min(window.innerHeight, Math.max(e.clientY, minY + MIN));
      setSelStart({ x: nMinX, y: nMinY });
      setSelEnd({ x: nMaxX, y: nMaxY });
      return;
    }
  };
  const onOverlayMouseUp = (e: React.MouseEvent) => {
    if (!fullScreenshotData) return;
    if (ssShape === 'free' && ssMode === 'drawing') {
      setFreePath(prev => (prev.length >= 3 ? [...prev, prev[0]] : prev));
      setSsMode('selected');
      return;
    }
    if (ssShape === 'rect' && ssMode === 'drawing' && selStart) {
      const dx = Math.abs(e.clientX - selStart.x);
      const dy = Math.abs(e.clientY - selStart.y);
      if (dx < 5 && dy < 5) { cancelCrop(); return; } // 当成点击 → 取消
      setSelEnd({ x: e.clientX, y: e.clientY });
      setSsMode('selected');
      return;
    }
    if (ssMode === 'dragging') {
      setSsMode('selected');
      setDragOffset(null);
      return;
    }
    if (ssMode === 'resizing') {
      setSsMode('selected');
      setActiveHandle(null);
      return;
    }
  };

  // 拖动/缩放过程中强制光标（防止鼠标甩出把手/选区时掉成默认箭头）
  useEffect(() => {
    if (ssMode === 'dragging') {
      const prev = document.body.style.cursor;
      document.body.style.cursor = 'move';
      return () => { document.body.style.cursor = prev; };
    }
    if (ssMode === 'resizing' && activeHandle) {
      const cursors: Record<string, string> = {
        nw: 'nwse-resize', n: 'ns-resize', ne: 'nesw-resize', e: 'ew-resize',
        se: 'nwse-resize', s: 'ns-resize', sw: 'nesw-resize', w: 'ew-resize',
      };
      const prev = document.body.style.cursor;
      document.body.style.cursor = cursors[activeHandle] || 'default';
      return () => { document.body.style.cursor = prev; };
    }
  }, [ssMode, activeHandle]);

  // 代码保存 → 追加到输入框 + 聚焦
  useEffect(() => {
    const onCodeSave = (e: Event) => {
      const { code, language } = (e as CustomEvent).detail as { code: string; language: string };
      const langTag = language === 'javascript' ? 'javascript' : language;
      const wrapped = `\`\`\`${langTag}\n${code}\n\`\`\``;
      setInput(prev => (prev ? prev + '\n\n' + wrapped : wrapped));
      textareaRef.current?.focus();
    };
    window.addEventListener('genhub-code-save', onCodeSave);
    return () => window.removeEventListener('genhub-code-save', onCodeSave);
  }, []);

  // 输入框拖动调整高度
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizeDragRef.current || !textareaRef.current) return;
      const { startY, startH } = resizeDragRef.current;
      const delta = startY - e.clientY; // 鼠标往上移 = 高度增加
      const newH = Math.max(38, Math.min(500, startH + delta));
      textareaRef.current.style.height = newH + 'px';
    };
    const onUp = () => { resizeDragRef.current = null; };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, []);

  // ESC 取消
  useEffect(() => {
    if (!fullScreenshotData) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') cancelCrop(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullScreenshotData]);

  /* ── 语音输入 ── */
  const handleVoice = () => {
    if (voiceActive) {
      voiceRecognitionRef.current?.stop();
      setVoiceActive(false);
      return;
    }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { onToast('当前浏览器不支持语音输入'); setTimeout(() => onToast(''), 3000); return; }
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'zh-CN';
    rec.onresult = (e: any) => {
      let text = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) text += e.results[i][0].transcript;
      }
      if (text) setInput(prev => prev + text);
    };
    rec.onend = () => setVoiceActive(false);
    rec.onerror = () => setVoiceActive(false);
    rec.start();
    voiceRecognitionRef.current = rec;
    setVoiceActive(true);
    onToast('正在聆听…');
    setTimeout(() => onToast(''), 2000);
  };

  /* ── 文件上传（Tauri dialog + plugin-fs，绕开 WebView File API 限制） ── */
  /** 处理一组文件路径（共用逻辑：对话框和拖拽都用） */
  const processFilePaths = async (paths: string[]) => {
    const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp)$/i;
    const TEXT_EXT = /\.(txt|md|markdown|json|csv|log|yml|yaml|xml|js|ts|tsx|jsx|py|rs|go|java|c|cpp|h|hpp|html|css|scss|less|toml|ini|env|gitignore|sql|sh|bat|ps1|lock)$/i;
    const PARSEABLE_EXT = /\.(pdf|docx|pptx|pptm|xlsx|xlsm)$/i;
    const newItems: Array<{ id: string; url: string; kind?: 'image' | 'text' | 'binary'; name?: string }> = [];
    for (const p of paths) {
      const name = p.split(/[\\/]/).pop() || 'file';
      const id = 'fi_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
      if (IMAGE_EXT.test(name)) {
        const b64: string = await invoke('read_file_base64', { path: p });
        const ext = (name.match(/\.(png|jpe?g|gif|webp|bmp)$/i)?.[1] || 'png').toLowerCase();
        const mime = ext === 'jpg' ? 'image/jpeg' : 'image/' + ext;
        newItems.push({ id, url: 'data:' + mime + ';base64,' + b64, kind: 'image', name });
      } else if (TEXT_EXT.test(name)) {
        const content: string = await invoke('read_file_text', { path: p });
        const MAX = 4000;
        if (content.length > MAX) {
          const truncated = content.slice(0, MAX);
          const marker = '\n\n[… 已截断，原文件共 ' + content.length + ' 字，仅发送前 ' + MAX + ' 字给 AI]';
          newItems.push({ id, url: truncated + marker, kind: 'text', name });
        } else {
          newItems.push({ id, url: content, kind: 'text', name });
        }
      } else if (PARSEABLE_EXT.test(name)) {
        try {
          const content: string = await invoke('parse_binary_file', { path: p });
          newItems.push({ id, url: content, kind: 'text', name });
        } catch (e) {
          newItems.push({ id, url: '[文件: ' + name + ' — 解析失败: ' + (e as Error).message + ']', kind: 'binary', name });
        }
      } else {
        newItems.push({ id, url: '[文件: ' + name + ']', kind: 'binary', name });
      }
    }
    if (newItems.length > 0) {
      setPendingImages(prev => [...prev, ...newItems]);
      onToast(newItems.length === 1 ? '已添加附件' : '已添加 ' + newItems.length + ' 个附件');
      setTimeout(() => onToast(''), 2000);
    }
  };

  const handleFileClick = async () => {
    try {
      const selected = await openDialog({
        multiple: true,
        filters: [
          { name: '图片与文档', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'pdf', 'docx', 'pptx', 'xlsx', 'txt', 'md', 'json', 'csv'] },
          { name: '所有文件', extensions: ['*'] },
        ],
      });
      if (!selected) return;
      await processFilePaths(Array.isArray(selected) ? selected : [selected]);
    } catch (e) {
      onToast('文件读取失败: ' + (e as Error).message);
      setTimeout(() => onToast(''), 3000);
    }
  };

  /* ── 拖拽上件监听 ── */
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    (async () => {
      try {
        unlisten = await getCurrentWindow().onDragDropEvent((event) => {
          if (event.payload.type === 'drop') {
            processFilePaths(event.payload.paths);
          }
        });
      } catch (_) { /* drag-drop not available */ }
    })();
    return () => { if (unlisten) unlisten(); };
  }, []);
  /* ── 发送消息 ── */
  const handleSend = async (overrideText?: string, skipCronCheck = false) => {
    const text = (overrideText !== undefined ? overrideText : input).trim();
    if ((!text && pendingImages.length === 0) || !session || loading) return;
    setInput('');
    if (overrideText === undefined) setInput('');
    setPendingImages([]);
    setLoading(true);
    setError(null);

    // 关键词检测：用户消息中提到已安装 skill 的名字或 slug → 自动触发 log_skill_invoke 弹窗
    // （豆包 lite 端点不响应 function calling，所以只能前端做关键词匹配）
    try {
      const lower = text.toLowerCase();
      const matched = new Map<string, string>(); // slug -> name

      // 1) 匹配内置硬编码列表（不依赖 skills/ 目录）
      for (const s of BUILTIN_SKILLS) {
        for (const p of s.patterns) {
          if (lower.includes(p.toLowerCase())) {
            if (!matched.has(s.slug)) matched.set(s.slug, s.name);
            break;
          }
        }
      }

      // 2) 匹配后端已安装列表（如果有的话）
      for (const s of installedSkillsRef.current) {
        const slug = s.slug.toLowerCase();
        if (lower.includes(slug)) {
          if (!matched.has(s.slug)) matched.set(s.slug, s.name || s.slug);
        }
      }

      console.log('[ChatMain] keyword match: text=', text, 'matched=', Array.from(matched.entries()));

      // 3) Fallback: 如果两个源都为空，同步拉取后端
      if (installedSkillsRef.current.length === 0 && matched.size === 0) {
        try {
          const list: any = await invoke('get_installed_skills');
          if (Array.isArray(list)) {
            installedSkillsRef.current = list.filter((s: any) => !s.savedOnly);
            for (const s of installedSkillsRef.current) {
              const slug = s.slug.toLowerCase();
              if (lower.includes(slug)) {
                matched.set(s.slug, s.name || s.slug);
              }
            }
          }
        } catch (e) {
          console.error('[ChatMain] lazy get_installed_skills failed:', e);
        }
      }

      // 4) 触发 invoke 并收集到数组
      const matchedList: Array<{ slug: string; name: string }> = [];
      for (const [slug, name] of matched.entries()) {
        console.log('[ChatMain] triggering log_skill_invoke for', slug);
        matchedList.push({ slug, name });
        invoke('log_skill_invoke', { toolId, skillSlug: slug, skillName: name })
          .then((id: any) => console.log('[ChatMain] log_skill_invoke returned id:', id))
          .catch((e: any) => console.error('[ChatMain] log_skill_invoke failed:', e));
      }
      (window as any).__pendingSkills = matchedList;
    } catch (e) {
      console.error('[ChatMain] keyword detect error:', e);
    }

    const userMsg: ChatMessage = {
      id: `opt_${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: Date.now() / 1000,
    };
    // 追加截图/文件到消息内容
    if (pendingImages.length > 0) {
      const attachments = pendingImages.map(img => {
        if (img.kind === 'image' || img.url.startsWith('data:image')) return `![截图](${img.url})`;
        if (img.kind === 'text') return `\n\n--- 文件 ${img.name || ''} ---\n${img.url}`;
        return img.url;
      }).join('\n');
      userMsg.content = text ? `${text}\n\n${attachments}` : attachments;
      // 文件元数据用于卡片式渲染（仅显示文件名/大小，不暴露内容）
      userMsg.files = pendingImages.map(img => {
        if (img.kind === 'image' || img.url.startsWith('data:image')) {
          return { name: img.name || '图片', kind: 'image' as const };
        }
        if (img.kind === 'text') {
          const originalChars = img.url.length;
          const MAX = 4000;
          return {
            name: img.name || '文本文件',
            kind: 'text' as const,
            chars: Math.min(originalChars, MAX),
            truncated: originalChars > MAX,
            originalChars: originalChars > MAX ? originalChars : undefined,
          };
        }
        return { name: img.name || '文件', kind: 'binary' as const };
      });
    }
    // ── 定时任务 ──
    try {
      if (!skipCronCheck) {
      const cronParse = parseChineseTime(text);
      if (cronParse && cronParse.confidence >= 0.8) {
        // 模式 A：明确定时意图 → 自动建任务，直接返回
        if (isCronIntent(text)) {
          const msg = extractCronMessage(text, cronParse.humanReadable) || text;
          const name = genCronName(cronParse.humanReadable, msg);
          const jobId = `cron_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          await invoke('add_cron_job', {
            id: jobId,
            toolId,
            name,
            cronExpr: cronParse.cron,
            message: msg,
          });
          const confirmMsg: ChatMessage = {
            id: `cron_${Date.now()}`,
            role: 'assistant',
            content: `✉️ 定时任务已建立\n\n• 规则：${cronParse.humanReadable}\n• 表达式：${cronParse.cron}\n• 名称：${name}\n• 内容：${msg}\n\n到时间后我会自动把内容发到当前会话并触发回复。`,
            timestamp: Date.now() / 1000,
          };
          setMessages(prev => [...prev, userMsg, confirmMsg]);
          setLoading(false);
          return;
        }
        // 模式 B：含时间词但非明确定时意图 → 弹窗询问，用户拒绝则消息继续发给 LLM
        if (hasTimeHint(text)) {
          const msg = extractCronMessage(text, cronParse.humanReadable) || text;
          const name = genCronName(cronParse.humanReadable, msg);
          const jobId = `cron_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const ok = window.confirm(
            `检测到时间表达「${cronParse.humanReadable}」，是否建立定时任务？\n\n` +
            `任务：${msg}\n` +
            `规则：${cronParse.humanReadable}（${cronParse.cron}）\n\n` +
            `点击「确定」建任务并发送，点击「取消」只发送消息。`
          );
          if (ok) {
            await invoke('add_cron_job', {
              id: jobId,
              toolId,
              name,
              cronExpr: cronParse.cron,
              message: msg,
            });
            const confirmMsg: ChatMessage = {
              id: `cron_${Date.now()}`,
              role: 'assistant',
              content: `✉️ 定时任务已建立\n\n• 规则：${cronParse.humanReadable}\n• 表达式：${cronParse.cron}\n• 名称：${name}\n• 内容：${msg}\n\n到时间后我会自动把内容发到当前会话并触发回复。`,
              timestamp: Date.now() / 1000,
            };
            setMessages(prev => [...prev, userMsg, confirmMsg]);
            setLoading(false);
            return;
          }
          // 用户拒绝 → 消息正常发给 LLM（不 return，不建任务）
        }
      }
      } // end if (!skipCronCheck)
    } catch (e) {
      console.error('[ChatMain] cron auto-create error:', e);
    }

    setMessages(prev => [...prev, userMsg]);

    if (!apiConfig) {
      const errMsg = `未配置 API Provider（toolId=${toolId}）。请先在"模型"标签页中为该工具激活一个 Provider。`;
      setError(errMsg);
      onToast(errMsg);
      setLoading(false);
      setMessages(prev => prev.filter(m => m.id !== userMsg.id));
      return;
    }

    const astMsg: ChatMessage = {
      id: `ast_${Date.now()}`,
      role: 'assistant',
      content: '',
      timestamp: Date.now() / 1000,
    };
    setMessages(prev => {
      const next = [...prev, astMsg];
      // 紧接着插入技能调用消息（作为 AI 回复的附加信息，贴在 AI 消息下方）
      const pending = ((window as any).__pendingSkills as Array<{ slug: string; name: string }> | undefined) || [];
      for (const s of pending) {
        next.push({
          id: `skill_${Date.now()}_${s.slug}`,
          role: 'assistant',
          content: '',
          timestamp: Date.now() / 1000,
          kind: 'skill-invocation',
          skill: { slug: s.slug, name: s.name },
        });
      }
      if (pending.length > 0) (window as any).__pendingSkills = [];
      return next;
    });

    // 清理旧监听器
    unlistenRef.current.forEach(fn => fn());
    unlistenRef.current = [];

    try {
      // 监听 token 事件（流式内容更新）
      const unlistenToken = await listen<{ content: string }>('chat_token', (event) => {
        setMessages(prev => prev.map(m =>
          m.id === astMsg.id ? { ...m, content: event.payload.content } : m
        ));
      });

      // 监听错误事件
      const unlistenError = await listen<{ error: string }>('chat_error', (event) => {
        setError(event.payload.error);
        const errMsg: ChatMessage = {
          id: `err_${Date.now()}`,
          role: 'assistant',
          content: `❌ 发送失败: ${event.payload.error}\n\nProvider: ${apiConfig.base_url}\nModel: ${apiConfig.model}\n\n请检查:\n• API Key 是否有效\n• 模型名是否正确\n• 网络是否通畅`,
          timestamp: Date.now() / 1000,
        };
        setMessages(prev => prev.filter(m => m.id !== astMsg.id));
        setMessages(prev => [...prev, errMsg]);
      });

      // 监听完成事件
      const unlistenDone = await listen('chat_done', async () => {
        // 刷新 Token 用量
        try {
          const data: any = await invoke('get_usage_stats');
          const arr = Array.isArray(data) ? data : [];
          const found = arr.find((u: any) => u.tool_id === toolId);
          if (found) {
            setTokenUsage({
              input: Number(found.total_input_tokens || 0),
              output: Number(found.total_output_tokens || 0),
            });
          }
        } catch { /* ignore */ }
      });

      unlistenRef.current = [unlistenToken, unlistenError, unlistenDone];

      // 通过 Rust 后端代理请求（自动记录 Token 用量）
      await invoke('stream_chat', {
        sessionId: session.id,
        toolId,
        newMessage: userMsg.content,
      });

    } catch(e: any) {
      const errDetail = e.message || JSON.stringify(e);
      console.error('[ChatMain] stream_chat failed:', e);
      setError(errDetail);
      setMessages(prev => prev.filter(m => m.id !== astMsg.id));
      const errMsg: ChatMessage = {
        id: `err_${Date.now()}`,
        role: 'assistant',
        content: `❌ 发送失败: ${errDetail}`,
        timestamp: Date.now() / 1000,
      };
      setMessages(prev => [...prev, errMsg]);
    } finally {
      setLoading(false);
      // 清理监听器
      unlistenRef.current.forEach(fn => fn());
      unlistenRef.current = [];
    }
  };
  handleSendRef.current = handleSend;

  /* ── 定时任务触发监听（cron_trigger）→ 自动把任务内容注入对话并发送 ── */
  const processedCronJobs = useRef<Set<string>>(new Set());
  const lastCronTrigger = useRef<number>(0);
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    (async () => {
      try {
        unlisten = await listen<{ job_id?: string; tool_id?: string; message?: string; log?: string }>('cron_trigger', (evt) => {
          const payload = evt.payload || {};
          const msg = (payload.message || '').trim();
          const jobId = payload.job_id || '';
          if (!msg) return;
          // 防重触发 1：同一 job_id 只处理一次
          if (jobId && processedCronJobs.current.has(jobId)) {
            console.warn('[CronTrigger] duplicate job ignored:', jobId);
            return;
          }
          if (jobId) processedCronJobs.current.add(jobId);
          // 防重触发 2：5 秒内相同内容只处理一次（防止调度器快速重发）
          const now = Date.now();
          if (now - lastCronTrigger.current < 5000) {
            console.warn('[CronTrigger] too frequent, ignored:', msg);
            return;
          }
          lastCronTrigger.current = now;
          let tries = 0;
          const fire = () => {
            if (tries++ > 10) { console.warn('[CronTrigger] dropped after retries:', msg); return; }
            if (loadingRef.current) { setTimeout(fire, 1500); return; }
            // 方案 B：定时任务触发 → 直接显示用户消息 + AI 提醒回复（不经过 LLM）
            const ts = now / 1000;
            const userMsg: ChatMessage = {
              id: `cron_user_${now}`,
              role: 'user',
              content: msg,
              timestamp: ts,
            };
            const reminderMsg: ChatMessage = {
              id: `cron_reminder_${now}`,
              role: 'assistant',
              content: `⏰ **定时提醒**\n\n${msg}\n\n---\n*这是您的定时任务触发提醒*`,
              timestamp: ts + 1,
            };
            setMessages(prev => [...prev, userMsg, reminderMsg]);
          };
          fire();
        });
      } catch (err) {
        console.error('[ChatMain] cron_trigger listen failed:', err);
      }
    })();
    return () => { if (unlisten) unlisten(); };
  }, []);

  /* ── 自动滚动 ── */
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: isFirstLoadRef.current ? 'instant' : 'smooth' });
      isFirstLoadRef.current = false;
    }
  }, [messages]);

  /* ── 输入框自动高度 ── */
  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    setInput(v);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 150) + 'px';
    /* 检测斜杠命令 */
    const cmds = TOOL_COMMANDS[toolId];
    if (cmds && v.startsWith('/') && !v.includes(' ')) {
      setCmdOpen(true);
      setCmdIdx(0);
    } else {
      setCmdOpen(false);
    }
  };

  const execCmd = (c: typeof TOOL_COMMANDS[string][number]) => {
    setInput('');
    setCmdOpen(false);
    if (c.action) onViewChange?.(c.action);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (cmdOpen) {
      const cmds = TOOL_COMMANDS[toolId];
      if (!cmds) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); setCmdIdx(i => Math.min(i + 1, cmds.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setCmdIdx(i => Math.max(i - 1, 0)); return; }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        execCmd(cmds[cmdIdx]);
        return;
      }
      if (e.key === 'Escape') { setCmdOpen(false); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };
  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      onToast('已复制');
      setTimeout(() => onToast(''), 2000);
    } catch { onToast('复制失败'); }
  };
  const handleEdit = (content: string) => {
    setInput(content);
    textareaRef.current?.focus();
  };
  const handleShare = (content: string) => {
    onToast('分享功能开发中');
    setTimeout(() => onToast(''), 2000);
  };


  const formatTime = (ts: number) => {
    const d = new Date(ts * 1000);
    return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
  };

  /* ── 工具栏渲染（两个分支共用） ── */
  const renderToolbar = (showLedgerClick: boolean = false) => (
    <div className="cm-toolbar">
      {TOOL_SHORTCUTS[toolId]?.map(item => (
        <button
          key={item.id}
          className={`cm-tb-btn${activeView === item.id ? ' active' : ''}`}
          onClick={() => {
            if (item.id === 'quick-switch') onOpenQuickSwitch?.();
            else onViewChange?.(item.id);
          }}
          title={item.desc || item.label}
        >
          {item.label}
        </button>
      ))}
      <button
        className="cm-tb-btn"
        onClick={(e) => { e.stopPropagation(); console.log('[编辑器按钮] 点击'); openCodeRunner('', 'html'); }}
        title="打开代码编辑器"
        style={{ color: '#a855f7', position: 'relative', zIndex: 10 }}
      >
        💻 编辑器
      </button>
      <button
        className="cm-tb-btn"
        onClick={async () => {
          try {
            const dir = await invoke<string>('get_workspace_dir_config');
            setGitWorkspaceDir(dir);
            setGitPanelOpen(true);
          } catch(e) { console.error(e); }
        }}
        title="Git 操作面板"
        style={{ color: '#f97316' }}
      >
        ⌥ Git
      </button>
      {/* 登录按钮 */}
      {tokenUsage && (
        <span
          className="cm-tb-usage"
          title={showLedgerClick ? "点击查看账本详情" : `累计 Token 用量（${toolId}）`}
          onClick={showLedgerClick ? () => setLedgerOpen(true) : undefined}
          style={{ cursor: showLedgerClick ? 'pointer' : 'default' }}
        >
          <span className="cm-tb-usage-num">↑{fmtTokens(tokenUsage.input)}</span>
          <span className="cm-tb-usage-num">↓{fmtTokens(tokenUsage.output)}</span>
          <span className="cm-tb-usage-cost">{getCost()}</span>
        </span>
      )}
    </div>
  );

  /* ── 渲染 ── */
  if (!session) {
    return (
      <main className="cm-welcome-wrap">
        <main className="cm-welcome">
          <div className="cm-welcome-icon">💬</div>
          <h2>与 {displayName} 对话</h2>
          <p>选择历史会话或点击下方按钮开始聊天</p>
          <button className="cm-btn-primary" onClick={handleNewSession}>+ 新建对话</button>
          {sessions.length > 0 && (
            <div className="cm-session-list">
              <div className="cm-session-list-title">历史会话</div>
              {sessions.map(s => (
                <div key={s.id} className="cm-session-item" onClick={() => onSessionChange(s)}>
                  <span className="cm-session-title">{s.title || '未命名会话'}</span>
                  {s.preview && <span className="cm-session-preview">{s.preview}</span>}
                  <span className="cm-session-meta">{s.message_count || 0} 条 · {formatTime(s.updated_at)}</span>
                </div>
              ))}
            </div>
          )}
        </main>
        {renderToolbar(false)}
      </main>
    );
  }

  return (
    <main className="cm-main">
      {/* 顶部标题栏 */}
      <div className="cm-header">
        <span className="cm-header-title">
          {editingTitle ? (
            <input
              className="cm-header-edit-input"
              value={titleDraft}
              onChange={e => setTitleDraft(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={e => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') setEditingTitle(false); }}
              autoFocus
            />
          ) : (
            <span onDoubleClick={startEditTitle} style={{ cursor: 'pointer' }}>{session.title}</span>
          )}
        </span>
        {announcement && announcement.enabled && announcement.content && announcement.updated_at !== announcementDismissed && (
          <div className={`cm-announcement cm-announcement-${announcement.level || 'info'}`} onClick={openAnnouncementModal} style={{ cursor: 'pointer' }}>
            <span className="cm-announcement-icon">小主：</span>
            <span className="cm-announcement-text">{announcement.title || announcement.content}</span>
            <button className="cm-announcement-close" onClick={(e) => { e.stopPropagation(); dismissAnnouncement(); }} title="关闭">×</button>
          </div>
        )}
        <div className="cm-header-actions">
          <div className="cm-session-switcher" style={{position:'relative',display:'inline-block'}}>
            <button className="cm-btn-new" onClick={() => setSessionSwitchOpen(v => !v)}>+ 新对话 ▾</button>
            {sessionSwitchOpen && (
              <div className="cm-session-dropdown" style={{position:'absolute',top:'100%',left:0,zIndex:999,background:'#1e1e1e',border:'1px solid #3c3c3c',borderRadius:6,minWidth:200,maxHeight:300,overflowY:'auto',marginTop:4}}>
                {sessions.length > 0 && sessions.map(s => (
                  <div key={s.id} className="cm-session-dropdown-item" style={{padding:'8px 12px',cursor:'pointer',color: s.id === session?.id ? '#00f0ff' : '#ccc',fontSize:13,borderBottom:'1px solid #2a2a2a',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}} onClick={() => { onSessionChange(s); setSessionSwitchOpen(false); }} title={s.title || s.id}>
                    {s.title || '无标题'}
                  </div>
                ))}
                <div className="cm-session-dropdown-item" style={{padding:'8px 12px',cursor:'pointer',color:'#00f0ff',fontSize:13,fontWeight:600,borderTop: sessions.length > 0 ? '1px solid #3c3c3c' : 'none'}} onClick={() => { handleNewSession(); setSessionSwitchOpen(false); }}>
                  + 新建对话
                </div>
              </div>
            )}
          </div>
          <button className="cm-btn-header" onClick={startEditTitle}>✏️ 重命名</button>
          <button className="cm-btn-header bundled" onClick={onBundledSkillsOpen} title="查看 CodexHub 出厂内置技能">📦 内置技能</button>
          <button className="cm-btn-header danger" onClick={handleDeleteSession}>🗑️ 删除</button>
        </div>
      </div>

      {/* 消息区 */}
      <div className="cm-messages">
        {messages.length === 0 && !loading && (
          <div className="cm-empty">发送消息开始对话…</div>
        )}

        {messages.map((msg, index) => (
          <div key={msg.id} className={`cm-message ${msg.role} ${msg.kind === 'skill-invocation' ? 'skill-card' : ''}`}>
            {msg.kind === 'skill-invocation' ? null : (
            <div className="cm-msg-row">
              <div className={`cm-msg-avatar ${msg.role === 'assistant' ? 'assistant-avatar' : 'user-avatar'}`}>
                {msg.role === 'user'
                  ? (user?.avatar_url
                    ? <img src={user.avatar_url} alt={user.name} onError={(e) => { const t = e.target as HTMLImageElement; t.style.display = 'none'; t.nextElementSibling && ((t.nextElementSibling as HTMLElement).style.display = 'flex'); }} />
                    : null)
                  : <img src={TOOL_AVATARS[toolId] || codexhubAvatar} alt={displayName} />}
                {msg.role === 'user' && <span className="cm-user-initial" style={{display: user?.avatar_url ? 'none' : 'flex'}}>{user?.name?.charAt(0)?.toUpperCase() || '?'}</span>}
              </div>
              <div className="cm-msg-wrap">
                <div className="cm-msg-body">
                  <div className="cm-msg-content">{renderMessageBody(msg.content, msg.role, msg.files)}</div>
                  {msg.tool_calls && msg.tool_calls.length > 0 && (
                    <div className="cm-tool-calls">
                      {msg.tool_calls.map(tc => (
                        <div key={tc.id} className="cm-tool-call">
                          <span className="cm-tool-name">🔧 {tc.name}</span>
                          <pre className="cm-tool-input">{JSON.stringify(tc.input, null, 2)}</pre>
                          {tc.result && <pre className="cm-tool-result">{tc.result}</pre>}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="cm-msg-meta">
                    <span className="cm-msg-time">{formatTime(msg.timestamp)}</span>
                    {msg.role === 'assistant' && messages[index + 1]?.kind === 'skill-invocation' && (
                      <span className="cm-msg-skill-tag">
                        ⚡ {messages[index + 1].skill?.name}
                      </span>
                    )}
                  </div>
                </div>
                <div className="cm-msg-actions">
              <button className="cm-icon-btn" onClick={() => handleCopy(msg.content)} title="复制">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              </button>
              <button className="cm-icon-btn" onClick={() => handleEdit(msg.content)} title="重新编辑">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <button className="cm-icon-btn" onClick={() => handleShare(msg.content)} title="分享">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
              </button>
                </div>
              </div>
            </div>
            )}
          </div>
        ))}

        {/* 错误提示 */}
        {error && (
          <div className="cm-message assistant">
            <div className="cm-msg-avatar assistant-avatar"><img src={TOOL_AVATARS[toolId] || codexhubAvatar} alt={displayName} /></div>
            <div className="cm-msg-body">
              <div className="cm-error">❌ {error}</div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

        {imgPreview && (
          <div className="cm-img-overlay" onClick={() => setImgPreview(null)}>
            <img className="cm-img-overlay-img" src={imgPreview} alt="预览大图" />
          </div>
        )}

      {/* 输入区 */}
      <div className="cm-input-area">
        <div className="cm-input-row">
          <div className="cm-input-wrap">
            {/* 附件预览（输入框内） */}
            {pendingImages.length > 0 && (
              <div className="cm-pending-images">
                {pendingImages.map(img => (
                  <div key={img.id} className="cm-pending-img-wrap">
                    {img.kind === 'image' || img.url.startsWith('data:image/') ? (
                      <img src={img.url} className="cm-pending-img" alt="截图预览" />
                    ) : (
                      <span className="cm-pending-file">{img.name || img.url}</span>
                    )}
                    <button
                      className="cm-pending-img-remove"
                      onClick={() => setPendingImages(prev => prev.filter(p => p.id !== img.id))}
                    >×</button>
                  </div>
                ))}
              </div>
            )}
            {cmdOpen && (
              <div className="cm-cmd-popup">
                {TOOL_COMMANDS[toolId]?.map((c, i) => (
                  <div
                    key={c.cmd}
                    className={`cm-cmd-item${i === cmdIdx ? ' active' : ''}`}
                    onMouseDown={e => { e.preventDefault(); execCmd(c); }}
                    onMouseEnter={() => setCmdIdx(i)}
                  >
                    <span className="cm-cmd-key">{c.cmd}</span>
                    <span className="cm-cmd-desc">{c.desc}</span>
                  </div>
                ))}
              </div>
            )}
            <textarea
              ref={textareaRef}
              className={`cm-input${pendingImages.length > 0 ? ' has-attachments' : ''}`}
              value={input}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={`向 ${displayName} 发送消息… 输入 / 查看命令`}
              rows={1}
              disabled={loading}
            />
            <div
              className="cm-input-resize"
              onMouseDown={e => {
                e.preventDefault();
                const el = textareaRef.current;
                if (!el) return;
                resizeDragRef.current = { startY: e.clientY, startH: el.offsetHeight };
              }}
            />
          </div>
          <button
            className="cm-btn-send"
            onClick={() => handleSend()}
            disabled={(!input.trim() && pendingImages.length === 0) || loading}
          >
            {loading ? '...' : '↑'}
          </button>
          {/* 截图/语音/文件 图标按钮，发送按钮右侧 */}
          <div className="cm-input-tools">
            <button className="cm-input-tool-btn" onClick={handleScreenshot} title="截图发送给AI-MAP-TEST">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            </button>
            <button
              className={`cm-input-tool-btn${voiceActive ? ' active' : ''}`}
              onClick={handleVoice}
              title="语音输入"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
            </button>
            <button className="cm-input-tool-btn" onClick={handleFileClick} title="上传文件">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
            </button>
          </div>
        </div>
        <div className="cm-input-disclaimer">内容由 AI 生成，请仔细甄别</div>
      </div>
      {/* ── 截图全屏 overlay ── */}
      {fullScreenshotData && (
        <div className="cm-ss-overlay">
          <img
            ref={overlayImgRef}
            className="cm-ss-bg-img"
            src={fullScreenshotData}
            alt="全屏截图"
            draggable={false}
          />
          <div
            className="cm-ss-interact"
            onMouseDown={onOverlayMouseDown}
            onMouseMove={onOverlayMouseMove}
            onMouseUp={onOverlayMouseUp}
          >
            {(ssShape === 'rect' && selStart && selEnd) && (
              <div
                className="cm-ss-selection"
                style={{
                  left: Math.min(selStart.x, selEnd.x),
                  top: Math.min(selStart.y, selEnd.y),
                  width: Math.abs(selEnd.x - selStart.x),
                  height: Math.abs(selEnd.y - selStart.y),
                  cursor: ssMode === 'selected' ? 'pointer' : 'default',
                }}
                data-selection="true"
                onDoubleClick={() => { if (ssMode === 'selected') confirmCrop(); }}
              >
                {ssMode === 'selected' && (
                  <>
                    <div className="cm-ss-handle nw" data-handle="nw" />
                    <div className="cm-ss-handle n"  data-handle="n"  />
                    <div className="cm-ss-handle ne" data-handle="ne" />
                    <div className="cm-ss-handle e"  data-handle="e"  />
                    <div className="cm-ss-handle se" data-handle="se" />
                    <div className="cm-ss-handle s"  data-handle="s"  />
                    <div className="cm-ss-handle sw" data-handle="sw" />
                    <div className="cm-ss-handle w"  data-handle="w"  />
                  </>
                )}
              </div>
            )}
          </div>
          {ssShape === 'free' && freePath.length > 0 && (() => {
            const W = window.innerWidth, H = window.innerHeight;
            const poly = freePath.map(p => `${p.x},${p.y}`).join(' ');
            const maskD = `M0,0 L${W},0 L${W},${H} L0,${H} Z M${poly} Z`;
            return (
              <svg className="cm-ss-free" width={W} height={H}>
                <path d={maskD} fill="rgba(0,0,0,0.55)" fillRule="evenodd" />
                <polygon points={poly} fill="rgba(0,240,255,0.08)" stroke="#00f0ff" strokeWidth={2} />
              </svg>
            );
          })()}
          {ssShape === 'window' && fullScreenshotData && overlayImgRef.current && windowList.map((win, idx) => {
            const nat = overlayImgRef.current!;
            const scX = (nat.clientWidth || window.innerWidth) / (nat.naturalWidth || 1);
            const scY = (nat.clientHeight || window.innerHeight) / (nat.naturalHeight || 1);
            const wl = win.left * scX, wt = win.top * scY;
            const ww = (win.right - win.left) * scX, wh = (win.bottom - win.top) * scY;
            return (
              <div
                key={win.hwnd + '_' + idx}
                className="cm-ss-win"
                style={{ left: wl, top: wt, width: ww, height: wh }}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => cropFromRect(wl, wt, ww, wh)}
                title={win.title}
              >
                <span className="cm-ss-win-label">{win.title}</span>
              </div>
            );
          })}
          <div className="cm-ss-modeswitch">
            <button className={ssShape === 'rect' ? 'active' : ''} onClick={() => switchShape('rect')}>矩形</button>
            <button className={ssShape === 'free' ? 'active' : ''} onClick={() => switchShape('free')}>自由</button>
            <button className={ssShape === 'window' ? 'active' : ''} onClick={() => switchShape('window')}>窗口</button>
          </div>
          <div
            className="cm-ss-toolbar"
            style={(() => {
              const sr = getSelRect();
              const TB_W = 240, TB_H = 50;
              let cx = window.innerWidth / 2;
              let ty = window.innerHeight - 60;
              if (sr) {
                cx = sr.left + sr.w / 2;
                const below = sr.top + sr.h + 10;
                const above = sr.top - TB_H - 10;
                if (below + TB_H <= window.innerHeight) ty = below;
                else if (above >= 0) ty = above;
                else ty = Math.max(10, below);
                cx = Math.max(TB_W / 2 + 8, Math.min(window.innerWidth - TB_W / 2 - 8, cx));
                ty = Math.max(10, Math.min(window.innerHeight - TB_H - 10, ty));
              }
              return { left: cx, top: ty, bottom: 'auto', transform: 'translateX(-50%)' };
            })()}
          >
            <button className="cm-ss-btn confirm" onClick={confirmCrop} disabled={!selStart || !selEnd}>
              ✓ 确认 ({selStart && selEnd ? `${Math.abs(selEnd.x-selStart.x)}×${Math.abs(selEnd.y-selStart.y)}` : '—'})
            </button>
            <button className="cm-ss-btn cancel" onClick={cancelCrop}>✕ 取消 (Esc)</button>
          </div>
        </div>
      )}

      {/* ── 公告弹窗 ── */}
      {announcementModalOpen && announcement && (
        <div className="cm-ann-modal-backdrop" onClick={() => setAnnouncementModalOpen(false)}>
          <div className="cm-ann-modal" onClick={e => e.stopPropagation()}>
            <div className="cm-ann-modal-header">
              <div className="cm-ann-modal-title">
                <span className="cm-ann-modal-icon">小主：</span>
                <span className="cm-ann-modal-maintitle">{announcement.title || '公告'}</span>
                {announcement.category && <span className="cm-ann-modal-cat">{announcement.category}</span>}
                <span className={`cm-ann-modal-badge cm-ann-badge-${announcement.level || 'info'}`}>{announcement.level === 'success' ? '提醒' : announcement.level === 'warning' ? '警告' : announcement.level === 'error' ? '紧急' : '信息'}</span>
              </div>
              <button className="cm-ann-modal-close" onClick={() => setAnnouncementModalOpen(false)}>×</button>
            </div>
            <div className="cm-ann-modal-body" dangerouslySetInnerHTML={{ __html: announcement.content || '' }} />
            <div className="cm-ann-modal-footer">
              {(announcement.external_link || announcement.link) && (
                <button
                  className="cm-ann-modal-link-btn"
                  onClick={() => openExternal(announcement.external_link || announcement.link).catch((err) => console.error('open link failed:', err))}
                >
                  查看原文 →
                </button>
              )}
              <span className="cm-ann-modal-time">{announcement.updated_at}</span>
            </div>
          </div>
        </div>
      )}

      {/* 工具专属快捷入口 */}
      {renderToolbar(true)}

      {/* 账本详情弹窗 */}
      {ledgerOpen && (
        <div className="cm-modal-overlay" onClick={() => setLedgerOpen(false)}>
          <div className="cm-modal" style={{width:520}} onClick={e => e.stopPropagation()}>
            <div className="cm-modal-header">
              <h3>账本详情</h3>
              <button className="cm-modal-close" onClick={() => setLedgerOpen(false)}>×</button>
            </div>
            <div className="cm-modal-body">
              {/* 当前工具用量 */}
              <div className="cm-ledger-section">
                <h4>当前工具（{displayName}）</h4>
                {(() => {
                  const tc = calcToolCost(toolId);
                  return (
                    <>
                      <div className="cm-ledger-row">
                        <span>输入 Tokens</span>
                        <span>{fmtTokens(tc.input)}</span>
                      </div>
                      <div className="cm-ledger-row">
                        <span>输出 Tokens</span>
                        <span>{fmtTokens(tc.output)}</span>
                      </div>
                      <div className="cm-ledger-row cost">
                        <span>费用（¥）</span>
                        <span>{fmtCostCNY(tc.costCny)}</span>
                      </div>
                      <div className="cm-ledger-row">
                        <span>费用（$）</span>
                        <span>{tc.costUsd < 0.01 ? '<$0.01' : '$' + tc.costUsd.toFixed(4)}</span>
                      </div>
                    </>
                  );
                })()}
              </div>
              {/* 全工具汇总 */}
              {(() => {
                const toolIds = ['claude-code','claude-desktop','codex','gemini-cli','opencode','openclaw','hermes-agent','qoder-cli','deepseek-cli'];
                let totalIn = 0, totalOut = 0, totalCostCny = 0, totalCostUsd = 0;
                const toolRows = toolIds.map(id => {
                  const c = calcToolCost(id);
                  totalIn += c.input;
                  totalOut += c.output;
                  totalCostCny += c.costCny;
                  totalCostUsd += c.costUsd;
                  return { id, name: toolName[id] || id, ...c };
                }).filter(r => r.input > 0 || r.output > 0);
                return (
                  <div className="cm-ledger-section">
                    <h4>全工具汇总</h4>
                    {toolRows.length > 0 ? toolRows.map(r => (
                      <div key={r.id} className="cm-ledger-row tool-cost-row">
                        <span>{r.name}</span>
                        <span style={{fontSize:11,color:'var(--text2)'}}>
                          {fmtTokens(r.input)} / {fmtTokens(r.output)}
                        </span>
                        <span style={{fontSize:11,color: r.costCny > 0 ? '#f59e0b' : '#666'}}>
                          {fmtCostCNY(r.costCny)}
                        </span>
                      </div>
                    )) : (
                      <p style={{fontSize:12,color:'#666',margin:'4px 0'}}>暂无费用数据</p>
                    )}
                    <div className="cm-ledger-row cost" style={{marginTop:6}}>
                      <span>总计（¥）</span>
                      <span>{fmtCostCNY(totalCostCny)}</span>
                    </div>
                    <div className="cm-ledger-row">
                      <span>总计（$）</span>
                      <span>{totalCostUsd < 0.01 ? '<$0.01' : '$' + totalCostUsd.toFixed(4)}</span>
                    </div>
                  </div>
                );
              })()}
              {/* 7日趋势图 */}
              {dailyUsage && dailyUsage.length > 0 && (
                <div className="cm-ledger-section">
                  <h4>近7日趋势</h4>
                  <div style={{marginTop:8}}>
                    <svg width="100%" height="160" viewBox="0 0 440 160">
                      {(() => {
                        // 每日费用（用当前工具模型大致估算）
                        const dailyCost = dailyUsage.map(d => {
                          const c = calculateCost(apiConfig?.model || toolId, d.input, d.output);
                          return c.costCny;
                        });
                        const maxVal = Math.max(1, ...dailyUsage.map(d => Math.max(d.input, d.output)));
                        const maxCost = Math.max(0.001, ...dailyCost);
                        const w = 440, h = 160, padL = 35, padR = 5, padT = 10, padB = 22;
                        const cw = (w - padL - padR) / dailyUsage.length;
                        return dailyUsage.map((d, i) => {
                          const x = padL + i * cw;
                          const ih = (d.input / maxVal) * (h - padT - padB) * 0.75;
                          const oh = (d.output / maxVal) * (h - padT - padB) * 0.75;
                          const colW = Math.max(3, cw * 0.22);
                          const gap = Math.max(1, cw * 0.03);
                          return (
                            <g key={i}>
                              {/* 费用折线点 */}
                              <circle cx={x + cw * 0.5} cy={h - padB - (dailyCost[i] / maxCost) * (h - padT - padB) * 0.75}
                                r={3} fill="#f59e0b" />
                              {/* 输入柱（青色） */}
                              <rect x={x + gap} y={h - padB - ih} width={colW} height={ih} rx={2}
                                fill="#00f0ff" opacity={0.7}>
                                <title>{d.date} 输入: {d.input.toLocaleString()}</title>
                              </rect>
                              {/* 输出柱（紫色） */}
                              <rect x={x + gap + colW + gap} y={h - padB - oh} width={colW} height={oh} rx={2}
                                fill="#a855f7" opacity={0.7}>
                                <title>{d.date} 输出: {d.output.toLocaleString()}</title>
                              </rect>
                              {/* 日期标签 */}
                              <text x={x + cw / 2} y={h - 3} textAnchor="middle" fontSize="9" fill="#666">
                                {d.date.slice(5)}
                              </text>
                            </g>
                          );
                        });
                      })()}
                    </svg>
                    <div style={{display:'flex',justifyContent:'center',gap:16,fontSize:11,color:'#888',marginTop:2}}>
                      <span><span style={{color:'#00f0ff'}}>■</span> 输入</span>
                      <span><span style={{color:'#a855f7'}}>■</span> 输出</span>
                      <span><span style={{color:'#f59e0b'}}>●</span> 费用（¥）</span>
                    </div>
                  </div>
                </div>
              )}
              {dailyUsage && dailyUsage.length === 0 && (
                <div className="cm-ledger-section">
                  <h4>近7日趋势</h4>
                  <p style={{fontSize:12,color:'#666',margin:'8px 0 0'}}>暂无 Token 用量记录</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {/* CodeRunner 弹窗 */}
      <CodeRunnerModal
        open={codeRunnerOpen}
        initialCode={codeRunnerCode}
        initialLanguage={codeRunnerLang}
        onClose={() => setCodeRunnerOpen(false)}
        realFilePath={realFilePath}
        realFileContent={realFileContent}
      />
      <GitPanel
        visible={gitPanelOpen}
        workspaceDir={gitWorkspaceDir}
        onClose={() => setGitPanelOpen(false)}
        onWorkspaceChange={(dir) => {
          setGitWorkspaceDir(dir);
          // 重新获取 Git 状态
          setTimeout(() => {
            const refreshBtn = document.querySelector('.git-btn-refresh') as HTMLButtonElement;
            refreshBtn?.click();
          }, 100);
        }}
        onOpenFile={(path, content) => openRealFile(path, content)}
      />
    </main>
  );
}
