const fs = require('fs');
const path = 'D:/codexhubcn/cc-switch-clone/src/components/ChatMain.tsx';
let c = fs.readFileSync(path, 'utf8');

const operations = [];

// ========== 1. Add CronIntent import ==========
const importLine = "import { calculateCost, fmtCost, fmtCostCNY } from '../pricing';";
const newImport = `import { calculateCost, fmtCost, fmtCostCNY } from '../pricing';
import { isCronIntent, parseChineseTime, extractCronMessage, genCronName } from './CronIntent';`;
if (!c.includes("from './CronIntent'")) {
    operations.push(['Replace import', c.indexOf(importLine)]);
    c = c.replace(importLine, newImport);
    operations[operations.length-1][0] += ' OK';
}

// ========== 2. handleSend signature + overrideText + remove Mode A/B ==========
// Find handleSend
const hsStart = c.indexOf('const handleSend = async');
const setInputPos = c.indexOf("setInput('');", hsStart);
const modeAStart = c.indexOf('/* ── 模式 A', hsStart);
const modeBStart = c.indexOf('/* ── 模式 B', hsStart);
console.log('handleSend at:', hsStart, 'setInput at:', setInputPos, 'ModeA at:', modeAStart, 'ModeB at:', modeBStart);

// Remove Mode A and Mode B blocks
const blockToRemove = c.substring(modeAStart, setInputPos);
console.log('Removing Mode A+B block (' + blockToRemove.length + ' chars)');
c = c.substring(0, modeAStart) + 
    '    /* 定时任务由 AI 决策：通过 function calling 自动建任务 */\n    ' +
    c.substring(setInputPos);

// Now fix handleSend signature (it should now have 'const text = (overrideText ?? input).trim()' in the block above)
// Actually the block starts with the if guard, we need to add overrideText param
const hsNew = c.substring(0, hsStart) + 
    'const handleSend = async (overrideText?: string) => {\n' +
    c.substring(hsStart + 'const handleSend = async () => {'.length);

if (!c.includes('overrideText')) {
    c = c.replace('const handleSend = async () => {', 'const handleSend = async (overrideText?: string) => {');
    operations.push(['handleSend overrideText OK']);
}
if (!c.includes('overrideText ??')) {
    c = c.replace('const text = input.trim()', 'const text = (overrideText ?? input).trim()');
    operations.push(['input overrideText OK']);
}

// ========== 3. Add messagesEndRef ==========
if (!c.includes('messagesEndRef')) {
    c = c.replace(
        'const isFirstLoadRef = useRef(true);',
        'const isFirstLoadRef = useRef(true);\n  const messagesEndRef = useRef<HTMLDivElement>(null);'
    );
    operations.push(['messagesEndRef OK']);
}

// ========== 4. cron_trigger useEffect ==========
const unlistenRefEnd = 'unlistenRef.current = [];';
if (!c.includes('cron_trigger')) {
    const cronEffect = `
  // 监听 cron_trigger 事件（定时任务触发）
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    (async () => {
      unlisten = await listen<{ job_id: string; tool_id: string; message: string }>('cron_trigger', (event) => {
        const { message } = event.payload;
        console.log('[CronTrigger] Received:', message);
        handleSend(message);
      });
    })();
    return () => { if (unlisten) unlisten(); };
  }, []);

`;
    c = c.replace(unlistenRefEnd, unlistenRefEnd + cronEffect);
    operations.push(['cron_trigger useEffect OK']);
}

// ========== 5. Scroll useEffect ==========
if (!c.includes('scrollIntoView')) {
    const scrollEffect = `
  /* ── 自动滚动 ── */
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: isFirstLoadRef.current ? 'instant' : 'smooth' });
      isFirstLoadRef.current = false;
    }
  }, [messages]);
`;
    // Find a good place to insert - after the cron_trigger useEffect
    c = c.replace(
        "/* ── 自动滚动 ── */\n  useEffect(() => {\n    if (messagesEndRef.current) {",
        scrollEffect + '\n  useEffect(() => {\n    if (messagesEndRef.current) {'
    );
    operations.push(['scroll useEffect OK']);
}

// ========== 6. messagesEndRef div ==========
if (!c.includes('ref={messagesEndRef}')) {
    c = c.replace(
        '<div ref={isFirstLoadRef ? undefined : messagesEndRef} />',
        '<div ref={messagesEndRef} />'
    );
    operations.push(['messagesEndRef div OK']);
}

// ========== 7. send button onClick ==========
if (!c.includes("onClick={() => handleSend()}")) {
    c = c.replace("onClick={handleSend}", "onClick={() => handleSend()}");
    operations.push(['send button onClick OK']);
}

fs.writeFileSync(path, c, 'utf8');
console.log('\nOperations:', operations.join(', '));
console.log('Done! New length:', c.length);
