const fs = require('fs');
const path = 'D:/codexhubcn/cc-switch-clone/src/components/ChatMain.tsx';
let c = fs.readFileSync(path, 'utf8');
const ops = [];

// ========== 1. Add CronIntent import ==========
if (!c.includes("from './CronIntent'")) {
    c = c.replace(
        "import { calculateCost, fmtCost, fmtCostCNY } from '../pricing';",
        "import { calculateCost, fmtCost, fmtCostCNY } from '../pricing';\nimport { isCronIntent, parseChineseTime, extractCronMessage, genCronName } from './CronIntent';"
    );
    ops.push('CronIntent import');
}

// ========== 2. Add overrideText to handleSend ==========
// Change: "const handleSend = async () => { const text = input.trim();"
// To:      "const handleSend = async (overrideText?: string) => { const text = (overrideText ?? input).trim();"
if (!c.includes('overrideText')) {
    c = c.replace(
        'const handleSend = async () => {\n    const text = input.trim();',
        'const handleSend = async (overrideText?: string) => {\n    const text = (overrideText ?? input).trim();'
    );
    ops.push('overrideText param');
}

// ========== 3. Add cron_trigger useEffect ==========
if (!c.includes('cron_trigger')) {
    const unlistenEnd = 'unlistenRef.current = [];';
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
    c = c.replace(unlistenEnd, unlistenEnd + cronEffect);
    ops.push('cron_trigger useEffect');
}

// ========== 4. Update send button onClick ==========
if (!c.includes("onClick={() => handleSend()}")) {
    c = c.replace("onClick={handleSend}", "onClick={() => handleSend()}");
    ops.push('send button onClick');
}

fs.writeFileSync(path, c, 'utf8');
console.log('Ops:', ops.join(', '));
console.log('Done! Length:', c.length);

// Verify key things
console.log('overrideText:', c.includes('overrideText'));
console.log('cron_trigger:', c.includes('cron_trigger'));
console.log('CronIntent import:', c.includes("from './CronIntent'"));
console.log('send button onClick:', c.includes("onClick={() => handleSend()}"));
