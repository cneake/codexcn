const fs = require('fs');
const path = 'D:/codexhubcn/cc-switch-clone/src/components/ChatMain.tsx';
let c = fs.readFileSync(path, 'utf8');

// ========== 1. 加 CronIntent import ==========
if (!c.includes("from './CronIntent'")) {
    c = c.replace(
        "import { calculateCost, fmtCost, fmtCostCNY } from '../pricing';",
        "import { calculateCost, fmtCost, fmtCostCNY } from '../pricing';\nimport CodeRunnerModal from './CodeRunnerModal';"
    );
}
if (!c.includes("import CodeRunnerModal from './CodeRunnerModal'")) {
    c = c.replace(
        "import { calculateCost, fmtCost, fmtCostCNY } from '../pricing';",
        "import { calculateCost, fmtCost, fmtCostCNY } from '../pricing';"
    );
}
// Add CodeRunnerModal import if missing
if (!c.includes("import CodeRunnerModal from './CodeRunnerModal'")) {
    c = c.replace(
        "import { calculateCost, fmtCost, fmtCostCNY } from '../pricing';",
        "import { calculateCost, fmtCost, fmtCostCNY } from '../pricing';\nimport CodeRunnerModal from './CodeRunnerModal';"
    );
}
// Add CronIntent import
if (!c.includes("from './CronIntent'")) {
    c = c.replace(
        "import { calculateCost, fmtCost, fmtCostCNY } from '../pricing';",
        "import { calculateCost, fmtCost, fmtCostCNY } from '../pricing';\nimport { isCronIntent, parseChineseTime, extractCronMessage, genCronName } from './CronIntent';"
    );
}

// ========== 2. CodeRunnerModal import ==========
if (!c.includes("import CodeRunnerModal from './CodeRunnerModal'")) {
    c = c.replace(
        "import { calculateCost, fmtCost, fmtCostCNY } from '../pricing';",
        "import { calculateCost, fmtCost, fmtCostCNY } from '../pricing';\nimport CodeRunnerModal from './CodeRunnerModal';"
    );
}

// ========== 3. 删 Mode A/B 拦截（保留 setInput(''); 后的正常流程） ==========
// Find handleSend and remove Mode A/B blocks before setInput('')
const handleSendIdx = c.indexOf('const handleSend = async');
if (handleSendIdx < 0) {
    console.log('ERROR: handleSend not found at expected position');
    process.exit(1);
}

const setInputLine = "setInput('');";
const setInputPos = c.indexOf(setInputLine, handleSendIdx);
if (setInputPos < 0) {
    console.log('ERROR: setInput not found in handleSend');
    process.exit(1);
}

// Remove from handleSend start to setInput('') - replace with comment
const blockToRemove = c.substring(handleSendIdx, setInputPos);
console.log('Removing block (' + blockToRemove.length + ' chars) before setInput');
c = c.substring(0, handleSendIdx) + 
    '    /* 定时任务由 AI 决策：通过 function calling 自动建任务 */\n    ' +
    c.substring(setInputPos);

console.log('After removal, file length:', c.length);

// ========== 4. handleSend 加 overrideText 参数 ==========
const handleSendNew = `const handleSend = async (overrideText?: string) => {\n    const text = (overrideText ?? input).trim();`;
c = c.replace(
    'const handleSend = async () => {\n    const text = input.trim();',
    handleSendNew
);
if (!c.includes('overrideText')) {
    console.log('ERROR: overrideText not applied');
    process.exit(1);
}

// ========== 5. 删 onToast prop（备份里没有这个参数） ==========
// Backup didn't have onToast prop, so skip this

// ========== 6. 加 messagesEndRef（backup 没有） ==========
if (!c.includes('messagesEndRef')) {
    c = c.replace(
        'const isFirstLoadRef = useRef(true);',
        'const isFirstLoadRef = useRef(true);\n  const messagesEndRef = useRef<HTMLDivElement>(null);'
    );
}

// ========== 7. 加 cron_trigger useEffect ==========
// Find after unlistenRef definition
if (!c.includes('cron_trigger')) {
    const marker = "unlistenRef.current = [];";
    const cronEffect = `\n  // 监听 cron_trigger 事件（定时任务触发）\n  useEffect(() => {\n    let unlisten: UnlistenFn | null = null;\n    (async () => {\n      unlisten = await listen<{ job_id: string; tool_id: string; message: string; log?: string }>('cron_trigger', (event) => {\n        const { tool_id, message } = event.payload;\n        console.log('[CronTrigger] Received:', { tool_id, message });\n        handleSend(message);\n      });\n    })();\n    return () => { if (unlisten) unlisten(); };\n  }, []);\n`;
    c = c.replace(marker, marker + cronEffect);
}

// ========== 8. 加 messagesEndRef div ==========
if (!c.includes('ref={messagesEndRef}')) {
    c = c.replace(
        '<div ref={isFirstLoadRef ? undefined : messagesEndRef} />',
        '<div ref={messagesEndRef} />'
    );
}

// ========== 9. 滚动到底部 useEffect ==========
if (!c.includes('scrollIntoView.*messagesEndRef')) {
    const scrollEffect = `\n  useEffect(() => {\n    if (messagesEndRef.current) {\n      messagesEndRef.current.scrollIntoView({ behavior: isFirstLoadRef.current ? 'instant' : 'smooth' });\n      isFirstLoadRef.current = false;\n    }\n  }, [messages]);\n`;
    if (!c.includes('scrollIntoView')) {
        // Find a good place - after the auto-scroll comment
        c = c.replace(
            '/* ── 自动滚动 ── */\n  useEffect(() => {\n    if (messagesEndRef.current) {',
            '/* ── 自动滚动 ── */' + scrollEffect + '\n  useEffect(() => {\n    if (messagesEndRef.current) {'
        );
    }
}

// ========== 10. send 按钮 onClick ==========
// Update send button onClick to () => handleSend()
if (c.includes("onClick={() => handleSend()}")) {
    // Already updated
} else if (c.includes("onClick={handleSend}")) {
    c = c.replace("onClick={handleSend}", "onClick={() => handleSend()}");
}

fs.writeFileSync(path, c, 'utf8');
console.log('Done! New length:', c.length);
