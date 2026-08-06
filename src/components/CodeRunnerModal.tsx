import React, { useState, useEffect, useRef, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import type { OnMount } from '@monaco-editor/react';
import { invoke } from '@tauri-apps/api/core';
import './CodeRunnerModal.css';
import { useDraggable } from './useDraggable';

/* ── Types ── */
type Lang = 'html' | 'css' | 'javascript' | 'typescript' | 'python' | 'shell' | 'rust' | 'go' | 'json' | 'markdown';

interface EditorFile {
  id: string;
  name: string;
  language: Lang;
  content: string;
  dirty: boolean;
  path: string;
  isRealFile?: boolean; // 真实文件标记
}

interface TreeNode {
  id: string;
  name: string;
  type: 'file' | 'folder';
  lang?: Lang;
  defaultContent?: string;
  savedPath?: string; // 已保存到磁盘的完整路径
  children?: TreeNode[];
  expanded?: boolean;
  parentId?: string | null;
}

const LANG_LABELS: Record<Lang, string> = {
  html: 'HTML', css: 'CSS', javascript: 'JS',
  typescript: 'TS', python: 'Python', shell: 'Shell',
  rust: 'Rust', go: 'Go', json: 'JSON', markdown: 'Markdown',
};

const menuItemStyle: React.CSSProperties = {
  padding: '8px 16px',
  cursor: 'pointer',
  fontSize: 13,
  color: '#aaa',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
};

// 文件图标 - 使用 VS Code 风格的颜色编码
const FILE_ICONS: Record<string, { icon: string; color: string }> = {
  folder: { icon: '📁', color: '#dcb67a' },
  folderOpen: { icon: '📂', color: '#dcb67a' },
  file: { icon: '📄', color: '#a9a9a9' },
  python: { icon: '🐍', color: '#4b8bbe' },      // Python 蓝
  javascript: { icon: '𝗝𝗦', color: '#f7df1e' },   // JS 黄
  typescript: { icon: '𝗧𝗦', color: '#3178c6' },   // TS 蓝
  html: { icon: '𝗛𝗧𝗠𝗟', color: '#e34c26' },      // HTML 橙红
  css: { icon: '𝗖𝗦𝗦', color: '#264de4' },        // CSS 蓝
  rust: { icon: '⚙️', color: '#dea584' },         // Rust 棕
  go: { icon: '𝗚𝗼', color: '#00add8' },           // Go 青
  json: { icon: '{ }', color: '#c9c9c9' },        // JSON 灰
  markdown: { icon: '𝗠𝗗', color: '#083fa1' },    // MD 深蓝
  shell: { icon: '⌘', color: '#89e051' },         // Shell 绿
};

const SAMPLE_CODE: Record<string, string> = {
  python: `# Python 示例
name = "小明"
age = 18
print(f"你好 {name}，你 {age} 岁了！")

# 简单计算
nums = [1, 2, 3, 4, 5]
print(f"列表求和: {sum(nums)}")
print(f"最大值: {max(nums)}")`,
  javascript: `// JavaScript 示例
const name = prompt("请输入姓名:");
const age = prompt("请输入年龄:");
console.log(\`你好 \${name}，你 \${age} 岁了！\`);

// 简单计算
const nums = [1, 2, 3, 4, 5];
console.log("数组求和:", nums.reduce((a, b) => a + b, 0));
console.log("最大值:", Math.max(...nums));`,
  shell: `# Shell 示例
echo "请输入姓名:"
read name
echo "请输入年龄:"
read age
echo "你好 $name，你 $age 岁了！"

# 简单计算
nums=(1 2 3 4 5)
sum=0
for n in "\${nums[@]}"; do
  sum=$((sum + n))
done
echo "数组求和: $sum"
echo "最大值: 5"`,
  html: `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>GenHub Demo</title>
  <style>
    body { font-family: system-ui; padding: 40px; background: #1a1a2e; color: #fff; }
    h1 { color: #00f0ff; }
  </style>
</head>
<body>
  <h1>Hello GenHub!</h1>
  <p>编辑此文件查看实时预览。</p>
</body>
</html>`,
  css: `/* CSS 示例 */
body {
  font-family: system-ui, sans-serif;
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
  color: #fff;
  padding: 40px;
}

h1 {
  color: #00f0ff;
  text-shadow: 0 0 20px rgba(0, 240, 255, 0.5);
}`,
  typescript: `// TypeScript 示例
interface Person {
  name: string;
  age: number;
}

const person: Person = {
  name: "GenHub",
  age: 1
};

console.log(\`\${person.name} 已经 \${person.age} 岁了！\`);

// 泛型示例
function identity<T>(arg: T): T {
  return arg;
}

console.log(identity<string>("Hello TypeScript"));`,
  rust: `// Rust 示例
fn main() {
    let name = "GenHub";
    let age = 1;
    println!("你好 {}，你 {} 岁了！", name, age);
    
    // 向量操作
    let nums = vec![1, 2, 3, 4, 5];
    let sum: i32 = nums.iter().sum();
    let max = nums.iter().max().unwrap();
    println!("求和: {}", sum);
    println!("最大值: {}", max);
}`,
  go: `// Go 示例
package main

import (
	"fmt"
)

func main() {
	name := "GenHub"
	age := 1
	fmt.Printf("你好 %s，你 %d 岁了！\\n", name, age)
	
	// 切片操作
	nums := []int{1, 2, 3, 4, 5}
	sum := 0
	max := nums[0]
	for _, n := range nums {
		sum += n
		if n > max {
			max = n
		}
	}
	fmt.Printf("求和: %d\\n", sum)
	fmt.Printf("最大值: %d\\n", max)
}`,
  json: `{
  "name": "GenHub",
  "version": "0.1.3",
  "description": "AI CLI 配置管理器",
  "features": [
    "多工具管理",
    "Token 计量",
    "代码运行器",
    "MCP 服务"
  ],
  "author": "Yalan Tech"
}`,
  markdown: `# GenHub

## 简介

GenHub 是一款 AI CLI 配置管理器，帮助你统一管理多个 AI 命令行工具。

## 功能

- 多工具统一管理
- Token 使用计量
- 代码运行器
- MCP 服务管理

## 开始使用

1. 安装 GenHub
2. 配置你的 API Key
3. 启动你喜欢的 AI 工具`,
};

function genId() {
  return Math.random().toString(36).slice(2);
}

function detectLanguage(filename: string, code: string): Lang {
  if (filename.endsWith('.py')) return 'python';
  if (filename.endsWith('.sh') || filename.endsWith('.bash')) return 'shell';
  if (filename.endsWith('.js')) return 'javascript';
  if (filename.endsWith('.ts')) return 'typescript';
  if (filename.endsWith('.html') || filename.endsWith('.htm')) return 'html';
  if (filename.endsWith('.css')) return 'css';
  if (filename.endsWith('.rs')) return 'rust';
  if (filename.endsWith('.go')) return 'go';
  if (filename.endsWith('.json')) return 'json';
  if (filename.endsWith('.md') || filename.endsWith('.markdown')) return 'markdown';
  if (code.includes('function') || code.includes('const') || code.includes('let')) return 'javascript';
  if (code.includes('def ') || code.includes('import ') || code.includes('print(')) return 'python';
  return 'python';
}

function getFileIcon(node: TreeNode): React.ReactNode {
  if (node.type === 'folder') {
    const icon = node.expanded ? FILE_ICONS.folderOpen : FILE_ICONS.folder;
    return <span style={{ color: icon.color }}>{icon.icon}</span>;
  }
  const icon = FILE_ICONS[node.lang || 'file'] || FILE_ICONS.file;
  return (
    <span style={{ 
      color: icon.color,
      fontSize: node.lang === 'javascript' || node.lang === 'typescript' || node.lang === 'html' || node.lang === 'css' || node.lang === 'go' || node.lang === 'markdown' ? 10 : 14,
      fontWeight: node.lang === 'javascript' || node.lang === 'typescript' || node.lang === 'html' || node.lang === 'css' || node.lang === 'go' || node.lang === 'markdown' ? 700 : 'normal',
      fontFamily: node.lang === 'javascript' || node.lang === 'typescript' || node.lang === 'html' || node.lang === 'css' || node.lang === 'go' || node.lang === 'markdown' ? 'system-ui, sans-serif' : 'inherit',
    }}>
      {icon.icon}
    </span>
  );
}

function getFileLang(filename: string): Lang | undefined {
  if (filename.endsWith('.py')) return 'python';
  if (filename.endsWith('.js')) return 'javascript';
  if (filename.endsWith('.ts')) return 'typescript';
  if (filename.endsWith('.html')) return 'html';
  if (filename.endsWith('.css')) return 'css';
  if (filename.endsWith('.rs')) return 'rust';
  if (filename.endsWith('.go')) return 'go';
  if (filename.endsWith('.json')) return 'json';
  if (filename.endsWith('.md')) return 'markdown';
  if (filename.endsWith('.sh')) return 'shell';
  return undefined;
}

function buildSrcdoc(html: string, css: string, js: string, isDark: boolean): string {
  const h = html || '<div id="root"></div>';
  const c = css ? `<style>${css}</style>` : '';
  const j = js ? `<script>${js}</script>` : '';
  const bgColor = isDark ? '#1e1e1e' : '#ffffff';
  const textColor = isDark ? '#e0e0e0' : '#333333';
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
html,body{margin:0;padding:0;font-family:system-ui, sans-serif;background:${bgColor};color:${textColor};min-height:100vh;}
</style>
${c}
</head>
<body>
${h}
${j}
<script>
(function(){
  const origLog = console.log;
  const origErr = console.error;
  const origWarn = console.warn;
  function append(type, args) {
    const el = document.getElementById('__log__');
    if (!el) return;
    const line = document.createElement('div');
    line.style.cssText = 'padding:2px 8px;border-bottom:1px solid #222;color:'+(type==='err'?'#ff6b6b':type==='warn'?'#ffd93d':'#00f0ff')+';font-size:12px;';
    line.textContent = (type==='err'?'[error] ':type==='warn'?'[warn] ':'[log] ') + Array.from(args).map(a=>typeof a==='object'?JSON.stringify(a):String(a)).join(' ');
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
  }
  console.log=function(){origLog.apply(console,arguments);append('log',arguments);};
  console.error=function(){origErr.apply(console,arguments);append('err',arguments);};
  console.warn=function(){origWarn.apply(console,arguments);append('warn',arguments);};
  window.onerror=function(msg){append('err',[msg]);return false;};
})();
${js}
</script>
<div id="__log__" style="position:fixed;bottom:0;left:0;right:0;max-height:120px;overflow-y:auto;background:#0a0a0a;font-family:monospace;font-size:12px;z-index:9999;border-top:1px solid #333;display:block;"></div>
</body></html>`;
}

function parseErrorLine(output: string): { line: number; col: number; message: string } | null {
  const pyMatch = output.match(/File "[^"]+",\s*line\s*(\d+)/);
  if (pyMatch) {
    const line = parseInt(pyMatch[1]);
    const lines = output.split('\n');
    const msg = lines.find(l => l.trim()) || 'Error';
    return { line, col: 1, message: msg.slice(0, 120) };
  }
  const shMatch = output.match(/script\.bat:(\d+):/);
  if (shMatch) {
    return { line: parseInt(shMatch[1]), col: 1, message: output.split('\n')[0].slice(0, 120) };
  }
  const genMatch = output.match(/line[:\s]+(\d+)/i);
  if (genMatch) {
    return { line: parseInt(genMatch[1]), col: 1, message: output.split('\n')[0].slice(0, 120) };
  }
  return null;
}

interface CodeRunnerModalProps {
  open: boolean;
  initialCode: string;
  initialLanguage: string;
  onClose: () => void;
  // 真实文件支持
  realFilePath?: string; // 完整路径
  realFileContent?: string; // 文件内容
}

// 初始文件树结构
const INITIAL_FILE_TREE: TreeNode[] = [
  {
    id: 'root',
    name: '示例目录',
    type: 'folder',
    expanded: true, // 默认展开，让用户能看到示例
    parentId: null,
    children: [
      {
        id: genId(),
        name: '示例代码',
        type: 'folder',
        expanded: false,
        parentId: 'root',
        children: [
          { id: genId(), name: 'app.py', type: 'file', lang: 'python', defaultContent: SAMPLE_CODE.python, parentId: '' },
          { id: genId(), name: 'script.sh', type: 'file', lang: 'shell', defaultContent: SAMPLE_CODE.shell, parentId: '' },
          { id: genId(), name: 'main.js', type: 'file', lang: 'javascript', defaultContent: SAMPLE_CODE.javascript, parentId: '' },
          { id: genId(), name: 'index.html', type: 'file', lang: 'html', defaultContent: SAMPLE_CODE.html, parentId: '' },
          { id: genId(), name: 'style.css', type: 'file', lang: 'css', defaultContent: SAMPLE_CODE.css, parentId: '' },
          { id: genId(), name: 'main.ts', type: 'file', lang: 'typescript', defaultContent: SAMPLE_CODE.typescript, parentId: '' },
          { id: genId(), name: 'main.rs', type: 'file', lang: 'rust', defaultContent: SAMPLE_CODE.rust, parentId: '' },
          { id: genId(), name: 'main.go', type: 'file', lang: 'go', defaultContent: SAMPLE_CODE.go, parentId: '' },
          { id: genId(), name: 'data.json', type: 'file', lang: 'json', defaultContent: SAMPLE_CODE.json, parentId: '' },
          { id: genId(), name: 'README.md', type: 'file', lang: 'markdown', defaultContent: SAMPLE_CODE.markdown, parentId: '' },
        ],
      },
    ],
  },
];

export default function CodeRunnerModal({ open, initialCode, initialLanguage, onClose, realFilePath, realFileContent }: CodeRunnerModalProps) {
  const [files, setFiles] = useState<EditorFile[]>(() => [{
    id: genId(), name: 'app.py', language: 'python',
    content: SAMPLE_CODE.python, dirty: false, path: 'examples/app.py',
  }]);
  const [activeId, setActiveId] = useState<string>('');

  // 当传入真实文件时，打开新标签
  useEffect(() => {
    if (open && realFilePath && realFileContent !== undefined) {
      const fileName = realFilePath.split(/[\\\/]/).pop() || realFilePath;
      const lang = detectLanguage(fileName, realFileContent);
      const existing = files.find(f => f.path === realFilePath && f.isRealFile);
      if (existing) {
        setActiveId(existing.id);
      } else {
        const newFile: EditorFile = {
          id: genId(),
          name: fileName,
          language: lang,
          content: realFileContent,
          dirty: false,
          path: realFilePath,
          isRealFile: true,
        };
        setFiles(prev => [...prev, newFile]);
        setActiveId(newFile.id);
      }
    }
  }, [open, realFilePath, realFileContent]);
  const [output, setOutput] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [previewKey, setPreviewKey] = useState(0);
  const [isMaximized, setIsMaximized] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const dragContainerRef = useRef<HTMLDivElement>(null);
  const dragHandleRef = useRef<HTMLDivElement>(null);
  useDraggable(dragHandleRef, dragContainerRef);
  const [fileTree, setFileTree] = useState<TreeNode[]>(() => {
    const saved = localStorage.getItem('genhub_filetree');
    return saved ? JSON.parse(saved) : INITIAL_FILE_TREE;
  });
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId: string | null } | null>(null);
  const [renamingNode, setRenamingNode] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [creatingInFolder, setCreatingInFolder] = useState<{
    folderId: string | null;
    type: 'file' | 'folder';
    location?: 'inside' | 'outside';
    trigger?: 'folder-inside' | 'folder-outside' | 'file' | 'explorer-blank' | 'top-button' | null;
  } | null>(null);

  const [theme, setTheme] = useState<'vs-dark' | 'light'>('vs-dark');
  // 关闭确认对话框
  const [closeConfirm, setCloseConfirm] = useState<{ type: 'tab' | 'modal'; fileId?: string } | null>(null);
  
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const monacoRef = useRef<Parameters<OnMount>[1] | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const openFileNodeIdRef = useRef<string | null>(null); // 当前打开的文件的树节点 ID
  // 用 ref 同步跟踪右键菜单的 nodeId，避免 React state batching 导致下次点击读到就值
  const contextNodeIdRef = useRef<string | null>(null);
  // 右键位置上下文：'inside'=子区域空白（创建到文件夹内）|'outside'=节点上（创建到文件夹外）
  const contextLocationRef = useRef<'inside' | 'outside' | undefined>(undefined);
  // 触发源类型（更细的下游调试用）
  const contextTriggerRef = useRef<'folder-inside' | 'folder-outside' | 'file' | 'explorer-blank' | 'top-button' | null>(null);
  // 用 ref 同步跟踪当前 fileTree，confirmCreate 中读取最新值（不受闭包限制）
  const fileTreeRef = useRef<TreeNode[]>(fileTree);
  useEffect(() => { fileTreeRef.current = fileTree; }, [fileTree]);

  const activeFile = files.find(f => f.id === activeId) || files[0];
  const isPreviewMode = ['html', 'css', 'javascript'].includes(activeFile?.language);

  useEffect(() => {
    if (activeId === '' && files.length > 0) setActiveId(files[0].id);
  }, [files, activeId]);

  // 监听 GenHub 主题变化
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const updateTheme = () => setTheme(mediaQuery.matches ? 'vs-dark' : 'light');
    updateTheme();
    mediaQuery.addEventListener('change', updateTheme);
    return () => mediaQuery.removeEventListener('change', updateTheme);
  }, []);

  // 点击外部关闭右键菜单
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
  };

  const clearMarkers = useCallback(() => {
    if (!editorRef.current || !monacoRef.current) return;
    monacoRef.current.editor.setModelMarkers(
      editorRef.current.getModel(),
      'genhub-error',
      []
    );
  }, []);

  const setErrorMarkers = useCallback((outputText: string) => {
    if (!editorRef.current || !monacoRef.current) return;
    const err = parseErrorLine(outputText);
    if (err) {
      const model = editorRef.current.getModel();
      const maxCol = model && err.line <= model.getLineCount()
        ? model.getLineMaxColumn(err.line)
        : err.col + 1;
      monacoRef.current.editor.setModelMarkers(
        model,
        'genhub-error',
        [{
          severity: monacoRef.current.MarkerSeverity.Error,
          message: err.message,
          startLineNumber: err.line,
          startColumn: 1,
          endLineNumber: err.line,
          endColumn: maxCol,
        }]
      );
      editorRef.current.revealLineInCenter(err.line);
      editorRef.current.setPosition({ lineNumber: err.line, column: err.col });
    }
  }, []);

  // 递归查找节点
  const findNode = (nodes: TreeNode[], id: string): TreeNode | null => {
    for (const node of nodes) {
      if (node.id === id) return node;
      if (node.children) {
        const found = findNode(node.children, id);
        if (found) return found;
      }
    }
    return null;
  };

  // 递归更新节点
  const updateNode = (nodes: TreeNode[], id: string, updater: (n: TreeNode) => TreeNode): TreeNode[] => {
    return nodes.map(node => {
      if (node.id === id) return updater(node);
      if (node.children) {
        return { ...node, children: updateNode(node.children, id, updater) };
      }
      return node;
    });
  };

  // 递归删除节点
  const deleteNode = (nodes: TreeNode[], id: string): TreeNode[] => {
    return nodes.filter(n => n.id !== id).map(node => {
      if (node.children) {
        return { ...node, children: deleteNode(node.children, id) };
      }
      return node;
    });
  };

  // 递归添加子节点
  const addChildNode = (nodes: TreeNode[], parentId: string, newNode: TreeNode): TreeNode[] => {
    return nodes.map(node => {
      // 命中目标文件夹：插入 newNode 为子节点，强制展开
      if (node.id === parentId && node.type === 'folder') {
        return { ...node, expanded: true, children: [...(node.children || []), newNode] };
      }
      // 没命中但有 children：递归到 children
      if (node.children) {
        return { ...node, children: addChildNode(node.children, parentId, newNode) };
      }
      // 叶子节点或没匹配：原样返回
      return node;
    });
  };

  // 获取节点路径
  const getNodePath = (nodes: TreeNode[], targetId: string, currentPath = ''): string => {
    for (const node of nodes) {
      const newPath = currentPath ? `${currentPath}/${node.name}` : node.name;
      if (node.id === targetId) return newPath;
      if (node.children) {
        const found = getNodePath(node.children, targetId, newPath);
        if (found) return found;
      }
    }
    return '';
  };

  const openFile = useCallback(async (node: TreeNode) => {
    if (node.type !== 'file') return;
    const existing = files.find(f => f.name === node.name && f.path === getNodePath(fileTree, node.id));
    if (existing) { setActiveId(existing.id); return; }
    
    const path = getNodePath(fileTree, node.id);
    // 如果有已保存的路径，从磁盘读取最新内容
    let content = node.defaultContent || '';
    if (node.savedPath) {
      try {
        content = await invoke('read_file_content', { path: node.savedPath }) as string;
      } catch (_) {}
    }
    const newFile: EditorFile = {
      id: genId(),
      name: node.name,
      language: node.lang || 'html',
      content: content,
      dirty: false,
      path: node.savedPath || path,
      isRealFile: !!node.savedPath,
    };
    setFiles(prev => [...prev, newFile]);
    setActiveId(newFile.id);
    openFileNodeIdRef.current = node.id; // 记录当前打开的树节点 ID
    setOutput('');
    setError('');
    clearMarkers();
  }, [files, fileTree, clearMarkers]);

  const toggleFolder = (nodeId: string) => {
    setFileTree(prev => {
      const next = updateNode(prev, nodeId, n => ({ ...n, expanded: !n.expanded }));
      localStorage.setItem('genhub_filetree', JSON.stringify(next));
      return next;
    });
  };

  const handleContextMenu = (e: React.MouseEvent, nodeId: string | null, location?: 'inside' | 'outside', trigger?: 'folder-inside' | 'folder-outside' | 'file' | 'explorer-blank') => {
    e.preventDefault();
    e.stopPropagation();
    // 防止事件冒泡到 overlay 导致关闭
    e.nativeEvent.stopImmediatePropagation();
    contextNodeIdRef.current = nodeId; // 同步存入 ref，点击时即使 contextMenu state 延迟也读到这个值
    contextLocationRef.current = location; // 'inside'=子区域空白右键（创建到文件夹内）；'outside' 或 undefined=节点本身（创建到外）
    contextTriggerRef.current = trigger || null;
    setContextMenu({ x: e.clientX, y: e.clientY, nodeId });
  };

  const getContextMenuOptions = () => {
    if (!contextMenu?.nodeId) {
      // 空白处右键 → 新建文件/文件夹
      return ['new-file', 'new-folder'];
    }
    const node = findNode(fileTree, contextMenu.nodeId);
    if (!node) return ['new-file', 'new-folder'];
    if (node.type === 'folder') {
      // 文件夹右键 → 新建文件/文件夹 + 重命名/删除
      return ['new-file', 'new-folder', 'rename', 'delete'];
    }
    // 文件右键 → 重命名/删除
    return ['rename', 'delete'];
  };

  const handleCreateNew = (type: 'file' | 'folder', nodeId?: string | null, trigger?: 'top-button' | null) => {
    // 优先级：传入参数 > ref 中保存的右键 nodeId
    const sourceNodeId = nodeId !== undefined ? nodeId : contextNodeIdRef.current;
    const sourceLocation = contextLocationRef.current; // 'inside' | 'outside' | undefined
    const sourceTrigger = trigger || contextTriggerRef.current;
    setCreatingInFolder({
      folderId: (sourceNodeId ?? null) as string | null,
      type,
      location: sourceLocation,
      trigger: sourceTrigger,
    });
    setNewName(type === 'folder' ? 'new-folder' : 'new-file.txt');
    setContextMenu(null);
  };

  const confirmCreate = () => {
    if (!creatingInFolder || !newName.trim()) return;

    const newNode: TreeNode = {
      id: genId(),
      name: newName.trim(),
      type: creatingInFolder.type,
      parentId: null, // 实际 parentId 在下面根据位置计算
      ...(creatingInFolder.type === 'folder' ? { expanded: true, children: [] } : { lang: getFileLang(newName.trim()) }),
    };

    // 用 ref 获取最新 fileTree（避开闭包问题）
    const sourceNodeId = creatingInFolder.folderId; // 这里保存的是右键源的 nodeId（可能是文件/文件夹 id，也可能是 null）
    const location = creatingInFolder.location; // 'inside' | 'outside' | undefined
    let resolvedFolderId: string | null = null; // null = 顶层
    let resolvedFolderName: string = '顶层';

    if (sourceNodeId) {
      const targetNode = findNode(fileTreeRef.current, sourceNodeId);
      if (targetNode) {
        if (targetNode.type === 'folder') {
          if (location === 'inside') {
            // 子区域空白右键 → 创建到该文件夹内
            resolvedFolderId = targetNode.id;
            resolvedFolderName = targetNode.name + ' 内';
          } else {
            // 节点本身右键（outside 或 undefined）→ 创建到该文件夹的外部（同层）
            resolvedFolderId = targetNode.parentId || null; // parentId 为 null 表示顶层
            resolvedFolderName = (targetNode.parentId && findNode(fileTreeRef.current, targetNode.parentId)?.name) || '顶层';
          }
        } else {
          // 文件右键 → 创建到该文件所在目录
          resolvedFolderId = targetNode.parentId || null;
          const parent = targetNode.parentId ? findNode(fileTreeRef.current, targetNode.parentId) : null;
          resolvedFolderName = parent?.name ? parent.name + ' 内' : '顶层';
        }
      }
    }
    newNode.parentId = resolvedFolderId;
    const createdName = newNode.name;
    const createdAction = creatingInFolder.type === 'folder' ? '建目录' : '建文件';

    setFileTree(prev => {
      const next = resolvedFolderId === null
        ? [...prev, newNode]
        : addChildNode(prev, resolvedFolderId, newNode);
      localStorage.setItem('genhub_filetree', JSON.stringify(next));
      return next;
    });
    setCreatingInFolder(null);
    setNewName('');
  };

  const handleRename = () => {
    if (!contextMenu?.nodeId) return;
    const node = findNode(fileTree, contextMenu.nodeId);
    if (node) {
      setRenamingNode(node.id);
      setNewName(node.name);
    }
    setContextMenu(null);
  };

  const confirmRename = () => {
    if (!renamingNode || !newName.trim()) return;
    setFileTree(prev => {
      const next = updateNode(prev, renamingNode, n => ({
        ...n,
        name: newName.trim(),
        ...(n.type === 'file' ? { lang: getFileLang(newName.trim()) } : {}),
      }));
      localStorage.setItem('genhub_filetree', JSON.stringify(next));
      return next;
    });
    setRenamingNode(null);
    setNewName('');
  };

  const handleDelete = () => {
    if (!contextMenu?.nodeId) return;
    const node = findNode(fileTree, contextMenu.nodeId);
    if (node && confirm(`确定要删除 "${node.name}" 吗？`)) {
      setFileTree(prev => {
        const next = deleteNode(prev, contextMenu.nodeId!);
        localStorage.setItem('genhub_filetree', JSON.stringify(next));
        return next;
      });
      // 关闭已打开的文件
      setFiles(prev => prev.filter(f => f.name !== node.name));
    }
    setContextMenu(null);
  };

  const handleCodeChange = useCallback((v: string | undefined) => {
    const val = v || '';
    setFiles(prev => prev.map(f => f.id === activeId ? { ...f, content: val, dirty: true } : f));
    clearMarkers();
    if (isPreviewMode) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => setPreviewKey(k => k + 1), 400);
    }
  }, [activeId, isPreviewMode, clearMarkers]);

  // 关闭标签：仅「未保存的内部文件且有内容」时弹确认，其余直接关闭
  const closeTab = useCallback((fileId: string) => {
    const file = files.find(f => f.id === fileId);
    if (!file) return;
    if (!file.isRealFile && file.content !== '') {
      setCloseConfirm({ type: 'tab', fileId });
      return;
    }
    setFiles(prev => prev.filter(x => x.id !== fileId));
    if (activeId === fileId) {
      setActiveId(files.find(x => x.id !== fileId)?.id || '');
    }
  }, [files, activeId]);

  // 新建空标签
  const handleNewTab = useCallback(() => {
    let n = 1;
    while (files.some(f => f.name === `untitled-${n}.py`)) n++;
    const newFile: EditorFile = {
      id: genId(),
      name: `untitled-${n}.py`,
      language: 'python',
      content: '',
      dirty: false,
      path: `untitled-${n}.py`,
      isRealFile: false,
    };
    setFiles(prev => [...prev, newFile]);
    setActiveId(newFile.id);
    setOutput('');
    setError('');
    clearMarkers();
  }, [files, clearMarkers]);

  const handleRun = async () => {
    if (!activeFile || running) return;

    setRunning(true);
    setOutput('');
    setError('');
    clearMarkers();
    try {
      const result = await invoke('execute_code', {
        language: activeFile.language,
        code: activeFile.content,
        timeoutSecs: 30,
      }) as any;
      // 后端返回的是字符串，直接显示
      const out = typeof result === 'string' ? result : JSON.stringify(result);
      setOutput(out || '(无输出)');
      // 如果有 STDERR 标记或错误关键词，标为错误
      if (out.includes('STDERR:') || out.includes('Traceback') || out.includes('Error:')) {
        setError('执行出错');
        setErrorMarkers(out);
      }
    } catch (err: any) {
      const msg = err?.message || String(err);
      setOutput(msg);
      setError('执行失败');
      setErrorMarkers(msg);
    } finally {
      setRunning(false);
    }
  };

  const handleSave = async () => {
    if (!activeFile) return;
    try {
      // 真实文件写回磁盘
      if (activeFile.isRealFile) {
        await invoke('write_file_content', { path: activeFile.path, content: activeFile.content });
        // 更新树节点的 savedPath
        if (openFileNodeIdRef.current) {
          setFileTree(prev => {
            const updated = updateNode(prev, openFileNodeIdRef.current!, n => ({
              ...n,
              savedPath: activeFile.path,
              defaultContent: undefined, // 清除示例内容
            }));
            localStorage.setItem('genhub_filetree', JSON.stringify(updated));
            return updated;
          });
        }
      } else {
        // 新建文件保存到工作目录
        const savedPath = await invoke('save_editor_file', { name: activeFile.name, content: activeFile.content }) as string;
        // 保存成功后，标记为真实文件并更新路径
        if (savedPath && savedPath.length > 0) {
          setFiles(prev => prev.map(f => f.id === activeId ? { ...f, path: savedPath, isRealFile: true, dirty: false } : f));
          
          // 更新树节点
          const newNodeOrUpdate = (nodes: TreeNode[]): TreeNode[] => {
            // 如果已有 openFileNodeIdRef，直接更新
            if (openFileNodeIdRef.current) {
              return updateNode(nodes, openFileNodeIdRef.current!, n => ({
                ...n,
                savedPath,
                defaultContent: undefined,
              }));
            }
            // 否则作为新节点添加到 'root'
            const newFileNode: TreeNode = {
              id: genId(),
              name: activeFile.name,
              type: 'file',
              lang: activeFile.language,
              parentId: 'root',
              savedPath,
            };
            openFileNodeIdRef.current = newFileNode.id;
            return nodes.map(node =>
              node.id === 'root'
                ? { ...node, children: [...(node.children || []), newFileNode] }
                : node
            );
          };
          setFileTree(prev => {
            const updated = newNodeOrUpdate(prev);
            localStorage.setItem('genhub_filetree', JSON.stringify(updated));
            return updated;
          });
          return;
        }
      }
    } catch (err) {
      console.error('Save failed:', err);
      setOutput('保存失败: ' + String(err));
    }
    setFiles(prev => prev.map(f => f.id === activeId ? { ...f, dirty: false } : f));
  };

  const toggleFullscreen = useCallback(async () => {
    try {
      if (!isMaximized) {
        await invoke('maximize_window');
        setIsMaximized(true);
      } else {
        await invoke('unmaximize_window');
        setIsMaximized(false);
      }
    } catch (e) {
      console.error('toggleFullscreen failed:', e);
    }
  }, [isMaximized]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); handleSave(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); handleRun(); }
      if (e.key === 'Escape' && isMaximized) { toggleFullscreen(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, handleSave, isMaximized, toggleFullscreen]);

  useEffect(() => {
    if (open && initialCode) {
      const lang = detectLanguage(initialLanguage || 'app.py', initialCode);
      const newFile: EditorFile = {
        id: genId(),
        name: 'untitled.' + (lang === 'javascript' ? 'js' : lang === 'typescript' ? 'ts' : lang === 'markdown' ? 'md' : lang),
        language: lang,
        content: initialCode,
        dirty: false,
        path: 'untitled',
      };
      setFiles([newFile]);
      setActiveId(newFile.id);
      setOutput('');
      setError('');
      clearMarkers();
    }
  }, [open, initialCode, initialLanguage, clearMarkers]);

  // 递归渲染文件树 - VS Code 风格
  const renderTree = (nodes: TreeNode[], depth = 0): React.ReactNode => {
    return nodes.map(node => {
      const isOpen = files.some(f => f.name === node.name);
      const isSelected = activeFile?.name === node.name;
      
      return (
        <div key={node.id}>
          {/* 节点行 */}
          <div
            onClick={() => node.type === 'folder' ? toggleFolder(node.id) : openFile(node)}
            onContextMenu={(e) => {
              e.stopPropagation();
              const trigger: 'folder-outside' | 'file' = node.type === 'folder' ? 'folder-outside' : 'file';
              handleContextMenu(e, node.id, 'outside', trigger);
            }}
            style={{
              padding: '3px 8px',
              paddingLeft: 4 + depth * 12,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 13,
              color: node.type === 'folder' ? '#ccc' : isOpen ? '#fff' : '#aaa',
              background: isSelected ? '#37373d' : 'transparent',
              borderRadius: 3,
              userSelect: 'none',
              margin: '1px 4px',
              transition: 'background 0.1s',
            }}
            onMouseEnter={(e) => {
              if (!isSelected) e.currentTarget.style.background = '#2a2d2e';
            }}
            onMouseLeave={(e) => {
              if (!isSelected) e.currentTarget.style.background = 'transparent';
            }}
          >
            {/* 展开箭头 */}
            {node.type === 'folder' ? (
              <span style={{ 
                fontSize: 10, 
                color: '#858585',
                width: 16,
                height: 16,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transform: node.expanded ? 'rotate(90deg)' : 'rotate(0deg)',
                transition: 'transform 0.15s ease',
              }}>▶</span>
            ) : (
              <span style={{ width: 16 }} />  // 占位对齐
            )}
            
            {/* 图标 */}
            <span style={{ fontSize: 14 }}>{getFileIcon(node)}</span>
            
            {/* 名称 */}
            {renamingNode === node.id ? (
              <input
                autoFocus
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') confirmRename(); if (e.key === 'Escape') { setRenamingNode(null); setNewName(''); }}}
                onBlur={confirmRename}
                style={{
                  background: '#1a1a2e',
                  border: '1px solid #00f0ff',
                  color: '#fff',
                  fontSize: 13,
                  padding: '1px 4px',
                  borderRadius: 3,
                  outline: 'none',
                  width: 100,
                }}
              />
            ) : (
              <span style={{ 
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>{node.name}</span>
            )}
          </div>
          
          {/* 子节点容器 */}
          {node.type === 'folder' && node.expanded && (
            <div 
              onContextMenu={(e) => handleContextMenu(e, node.id, 'inside', 'folder-inside')}
              style={{ 
                position: 'relative',
                paddingLeft: 12 + depth * 12,
              }}
            >
              {/* 缩进引导线 */}
              <div style={{
                position: 'absolute',
                left: 10 + depth * 12,
                top: 0,
                bottom: 0,
                width: 1,
                background: '#2a2d2e',
              }} />
              {node.children && renderTree(node.children, depth + 1)}
            </div>
          )}
        </div>
      );
    });
  };

  if (!open) return null;

  const srcdoc = isPreviewMode ? buildSrcdoc(
    activeFile.language === 'css' ? '' : activeFile.content,
    activeFile.language === 'html' ? '' : activeFile.content,
    activeFile.content,
    theme === 'vs-dark',
  ) : '';

  const LAYOUT = {
    sidebar: sidebarOpen ? 240 : 0,
    output: 360,
  };

  return (
    <>
    <div className="overlay" onClick={() => {
      // 点击遮罩层时检查未保存文件
      const hasDirty = files.some(f => f.dirty);
      if (hasDirty) {
        setCloseConfirm({ type: 'modal' });
      } else {
        onClose();
      }
    }}>
      <div
        ref={dragContainerRef}
        onClick={e => e.stopPropagation()}
        style={{
          width: '96vw', height: '90vh', maxWidth: 1600, maxHeight: 950,
          display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden',
          background: '#1a1a2e', borderRadius: 12, border: '1px solid #333',
        }}
      >
        {/* Header */}
        <div
          ref={dragHandleRef}
          className="drag-handle"
          style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px',
            borderBottom: '1px solid #2a2a4a', flexShrink: 0, background: '#12122a',
            cursor: 'move',
          }}
        >
          <button
            onClick={() => setSidebarOpen(v => !v)}
            title="Toggle file tree"
            style={{
              background: 'none', border: '1px solid #333', borderRadius: 6,
              color: sidebarOpen ? '#00f0ff' : '#666', cursor: 'pointer',
              padding: '4px 8px', fontSize: 13,
            }}
          >📁</button>

          {isMaximized && (
            <button
              onClick={toggleFullscreen}
              title="Exit fullscreen"
              style={{
                background: 'none', border: '1px solid #333', borderRadius: 6,
                color: '#00f0ff', cursor: 'pointer', padding: '4px 8px', fontSize: 13,
              }}
            >⬇ 退出全屏</button>
          )}

          <span style={{ color: '#00f0ff', fontSize: 15 }}>▶</span>
          <span style={{ color: '#fff', fontWeight: 600, fontSize: 14 }}>GenHub Code Runner</span>

          <select
            value={activeFile?.language || 'python'}
            onChange={e => {
              const lang = e.target.value as Lang;
              const newName = activeFile?.name.replace(/\.\w+$/, '') + '.' + (lang === 'javascript' ? 'js' : lang === 'typescript' ? 'ts' : lang === 'markdown' ? 'md' : lang);
              setFiles(prev => prev.map(f => f.id === activeId ? { ...f, language: lang, name: newName } : f));
              clearMarkers();
            }}
            style={{
              background: '#1a1a2e', color: '#00f0ff', border: '1px solid #333',
              borderRadius: 6, padding: '3px 8px', fontSize: 12, cursor: 'pointer',
            }}
          >
            {Object.entries(LANG_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>

          {!isMaximized && (
            <button
              onClick={toggleFullscreen}
              title="Fullscreen"
              style={{
                background: 'none', border: '1px solid #333', borderRadius: 6,
                color: '#a855f7', cursor: 'pointer', padding: '3px 10px', fontSize: 12,
              }}
            >⛶ 全屏</button>
          )}

          <div style={{ flex: 1 }} />

          <span style={{
            fontSize: 11, color: '#555', fontFamily: 'monospace',
          }}>{LANG_LABELS[activeFile?.language || 'python']} · {activeFile?.content.length || 0} chars</span>

          <button onClick={handleRun} disabled={running}
            style={{
              background: running ? '#1a3a2a' : '#00f0ff22',
              color: running ? '#666' : '#00f0ff',
              border: '1px solid #00f0ff55',
              borderRadius: 8, cursor: running ? 'default' : 'pointer',
              padding: '5px 20px', fontSize: 13, fontWeight: 600,
              minWidth: 90,
            }}
          >
            {running ? '⏳ 运行中' : '▶ 运行'}
          </button>

          <button onClick={handleSave}
            style={{
              background: 'none', color: '#00f0ff', border: '1px solid #00f0ff55',
              borderRadius: 8, cursor: 'pointer', padding: '5px 14px', fontSize: 13,
            }}
          >💾 保存</button>

          <button onClick={() => {
            // 检查是否有未保存的文件
            const hasDirty = files.some(f => f.dirty);
            if (hasDirty) {
              setCloseConfirm({ type: 'modal' });
              return;
            }
            onClose();
          }}
            style={{
              background: 'none', color: '#666', border: '1px solid #333',
              borderRadius: 8, cursor: 'pointer', padding: '5px 12px', fontSize: 13,
            }}
          >✕ 关闭</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* Sidebar - File Tree */}
          {sidebarOpen && (
            <div style={{
              width: LAYOUT.sidebar, flexShrink: 0, borderRight: '1px solid #2a2a4a',
              background: '#0f0f23', display: 'flex', flexDirection: 'column', overflow: 'hidden',
            }}>
              <div style={{ 
                padding: '10px 12px', 
                borderBottom: '1px solid #2a2a4a', 
                fontSize: 11, 
                color: '#666', 
                fontWeight: 600,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}>
                <span>EXPLORER</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => { contextTriggerRef.current = 'top-button'; handleCreateNew('file', null, 'top-button'); }}
                    title="新建文件"
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      fontSize: 14, color: '#666', padding: '2px 4px',
                    }}
                    onMouseEnter={e => e.currentTarget.style.color = '#00f0ff'}
                    onMouseLeave={e => e.currentTarget.style.color = '#666'}
                  >📄+</button>
                  <button
                    onClick={() => { contextTriggerRef.current = 'top-button'; handleCreateNew('folder', null, 'top-button'); }}
                    title="新建文件夹"
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      fontSize: 14, color: '#666', padding: '2px 4px',
                    }}
                  >📁+</button>
                </div>
              </div>

              <div 
                style={{ flex: 1, overflow: 'auto', padding: 8 }}
                onContextMenu={(e) => handleContextMenu(e, null, undefined, 'explorer-blank')}
              >
                {renderTree(fileTree)}
                
                {/* 新建输入框 */}
                {creatingInFolder && (
                  <div style={{ padding: '4px 8px', paddingLeft: 24, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>{creatingInFolder.type === 'folder' ? '📁' : '📄'}</span>
                    <input
                      autoFocus
                      value={newName}
                      onChange={e => setNewName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') confirmCreate(); if (e.key === 'Escape') { setCreatingInFolder(null); setNewName(''); }}}
                      onBlur={confirmCreate}
                      style={{
                        background: '#1a1a2e',
                        border: '1px solid #00f0ff',
                        color: '#fff',
                        fontSize: 13,
                        padding: '2px 4px',
                        borderRadius: 3,
                        outline: 'none',
                        width: 120,
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Editor */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
            {/* Tab Bar - VS Code 风格 */}
            <div className="crm-tab-bar">
              {files.map(f => (
                <div
                  key={f.id}
                  className={`crm-tab${f.id === activeId ? ' active' : ''}`}
                  onClick={() => setActiveId(f.id)}
                  title={f.name}
                >
                  <span className="crm-tab-name">{f.name}</span>
                  {f.dirty && <span className="crm-tab-dirty">●</span>}
                  <span
                    className="crm-tab-close"
                    onClick={e => { e.stopPropagation(); closeTab(f.id); }}
                    title="关闭"
                  >×</span>
                </div>
              ))}
              <button className="crm-tab-add" onClick={handleNewTab} title="新建标签">+</button>
            </div>

            {/* Monaco */}
            <div style={{ flex: 1, overflow: 'hidden', background: '#1e1e1e' }}>
              <Editor
                key={activeFile?.id || 'empty'}
                height="100%"
                language={activeFile?.language || 'python'}
                value={activeFile?.content || ''}
                onChange={handleCodeChange}
                onMount={handleEditorMount}
                theme="vs-dark"
                options={{
                  fontSize: 14,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  padding: { top: 16 },
                  lineNumbers: 'on',
                  renderLineHighlight: 'all',
                }}
              />
            </div>

            {/* Status bar */}
            <div style={{
              padding: '4px 12px', borderTop: '1px solid #2a2a4a',
              fontSize: 11, color: '#555', display: 'flex', gap: 16,
              background: '#0f0f23', alignItems: 'center',
            }}>
              <span>{LANG_LABELS[activeFile?.language || 'python']}</span>
              <span>{activeFile?.content.length || 0} chars</span>
              <span style={{ marginLeft: 'auto' }}>Ctrl+Enter 运行 · Ctrl+S 保存 · Esc 退出全屏</span>
            </div>
          </div>

          {/* Output / Preview */}
          <div style={{
            width: LAYOUT.output, flexShrink: 0, borderLeft: '1px solid #2a2a4a',
            background: '#0f0f23', display: 'flex', flexDirection: 'column', overflow: 'hidden',
          }}>
            <div style={{ padding: '10px 12px', borderBottom: '1px solid #2a2a4a', fontSize: 11, color: '#666', fontWeight: 600 }}>
              {isPreviewMode ? 'Live Preview' : '输出'}
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
              {isPreviewMode ? (
                <iframe
                  key={previewKey}
                  srcDoc={srcdoc}
                  style={{ width: '100%', height: '100%', border: 'none', background: theme === 'vs-dark' ? '#1e1e1e' : '#fff', borderRadius: 4 }}
                  sandbox="allow-scripts"
                  title="preview"
                />
              ) : (
                <pre style={{ margin: 0, fontSize: 12, color: output.includes('Error') || error ? '#ff6b6b' : '#00f0ff', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {output || '点击「运行」执行代码'}
                </pre>
              )}
            </div>

          </div>
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu && (() => {
        const options = getContextMenuOptions();
        return (
          <div
            ref={contextMenuRef}
            style={{
              position: 'fixed',
              left: Math.min(contextMenu.x, window.innerWidth - 180),
              top: Math.min(contextMenu.y, window.innerHeight - 200),
              background: '#1a1a2e',
              border: '1px solid #333',
              borderRadius: 6,
              padding: '4px 0',
              minWidth: 160,
              zIndex: 10000,
              boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            }}
          >
            {options.map(opt => {
              const isDelete = opt === 'delete';
              const isNew = opt === 'new-file' || opt === 'new-folder';
              return (
                <div
                  key={opt}
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    const currentNodeId = contextMenu?.nodeId;
                    if (opt === 'new-file') handleCreateNew('file', currentNodeId);
                    else if (opt === 'new-folder') handleCreateNew('folder', currentNodeId);
                    else if (opt === 'rename') handleRename();
                    else if (opt === 'delete') handleDelete();
                    setContextMenu(null);
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = isDelete ? '#ff6b6b22' : '#00f0ff22'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  style={{
                    padding: '8px 16px',
                    cursor: 'pointer',
                    fontSize: 13,
                    color: isDelete ? '#ff6b6b' : '#aaa',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                  }}
                >
                  <span style={{ fontSize: 14 }}>
                    {opt === 'new-file' ? '📄' : opt === 'new-folder' ? '📁' : opt === 'rename' ? '✏️' : '🗑️'}
                  </span>
                  {opt === 'new-file' ? '新建文件' : opt === 'new-folder' ? '新建文件夹' : opt === 'rename' ? '重命名' : '删除'}
                </div>
              );
            })}
          </div>
        );
      })()}

    </div>

    {/* 关闭确认对话框 - 在overlay外部渲染 */}
    {closeConfirm && (
      <div
        style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 20000,
        }}
        onClick={() => setCloseConfirm(null)}
      >
        <div
          style={{
            background: '#1a1a2e',
            border: '1px solid #333',
            borderRadius: 12,
            padding: 24,
            minWidth: 320,
            maxWidth: 400,
          }}
          onClick={e => e.stopPropagation()}
        >
          <h3 style={{ margin: '0 0 12px', color: '#fff', fontSize: 16 }}>
            {closeConfirm.type === 'tab' ? '关闭未保存的文件？' : '关闭窗口？'}
          </h3>
          <p style={{ margin: '0 0 20px', color: '#aaa', fontSize: 13, lineHeight: 1.5 }}>
            {closeConfirm.type === 'tab'
              ? '此文件有未保存的更改，关闭将丢失这些更改。'
              : '有未保存的文件，关闭窗口将丢失所有更改。'}
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button
              onClick={() => setCloseConfirm(null)}
              style={{
                background: 'none',
                border: '1px solid #333',
                color: '#aaa',
                padding: '8px 16px',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 13,
              }}
            >取消</button>
            <button
              onClick={() => {
                if (closeConfirm.type === 'tab' && closeConfirm.fileId) {
                  setFiles(prev => prev.filter(x => x.id !== closeConfirm.fileId));
                  if (activeId === closeConfirm.fileId) {
                    setActiveId(files.find(x => x.id !== closeConfirm.fileId)?.id || '');
                  }
                } else {
                  onClose();
                }
                setCloseConfirm(null);
              }}
              style={{
                background: '#ff6b6b22',
                border: '1px solid #ff6b6b55',
                color: '#ff6b6b',
                padding: '8px 16px',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 13,
              }}
            >不保存关闭</button>
            <button
              onClick={async () => {
                if (closeConfirm.type === 'tab' && closeConfirm.fileId) {
                  const file = files.find(f => f.id === closeConfirm.fileId);
                  if (file) {
                    try {
                      if (file.isRealFile) {
                        await invoke('write_file_content', { path: file.path, content: file.content });
                      } else {
                        await invoke('save_editor_file', { name: file.name, content: file.content });
                      }
                      setFiles(prev => prev.map(f => f.id === closeConfirm.fileId ? { ...f, dirty: false } : f));
                    } catch (err) {
                      console.error('Save failed:', err);
                    }
                  }
                  setFiles(prev => prev.filter(x => x.id !== closeConfirm.fileId));
                  if (activeId === closeConfirm.fileId) {
                    setActiveId(files.find(x => x.id !== closeConfirm.fileId)?.id || '');
                  }
                } else {
                  for (const file of files.filter(f => f.dirty)) {
                    try {
                      if (file.isRealFile) {
                        await invoke('write_file_content', { path: file.path, content: file.content });
                      } else {
                        await invoke('save_editor_file', { name: file.name, content: file.content });
                      }
                    } catch (err) {
                      console.error('Save failed:', err);
                    }
                  }
                  onClose();
                }
                setCloseConfirm(null);
              }}
              style={{
                background: '#00f0ff22',
                border: '1px solid #00f0ff55',
                color: '#00f0ff',
                padding: '8px 16px',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 13,
              }}
            >保存并关闭</button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
