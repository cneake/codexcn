// 模拟 stream_chat 的两轮请求流程，验证第二轮能否拿到自然语言回复
const https = require('https');
const API_KEY = '0f929b81-c9a6-4996-86b3-e9cc78423687';
const BASE = 'https://ark.cn-beijing.volces.com/api/v3';

function call(body) {
    return new Promise((resolve, reject) => {
        const req = https.request(BASE + '/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + API_KEY },
            timeout: 60000
        }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); } catch (e) { reject(new Error(data.slice(0, 200))); }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        req.write(JSON.stringify(body));
        req.end();
    });
}

(async () => {
    // 第一轮：用户要求建定时任务
    console.log('=== 第一轮请求 ===');
    const r1 = await call({
        model: 'doubao-1-5-pro-32k-250115',
        messages: [{ role: 'system', content: '你是 GenHub AI 助手。用户请求创建定时任务时调用 create_cron_job 函数。' },
                   { role: 'user', content: '每5分钟提醒我喝水' }],
        tools: [{ type: 'function', function: { name: 'create_cron_job', description: '创建定时任务',
            parameters: { type: 'object', properties: {
                id: { type: 'string' }, name: { type: 'string' },
                cron_expr: { type: 'string', description: '5字段cron：分 时 日 月 周' },
                message: { type: 'string' } }, required: ['id', 'name', 'cron_expr', 'message'] } } }],
        max_tokens: 100, stream: false
    });
    const tc = r1.choices?.[0]?.message?.tool_calls?.[0];
    console.log('tool_call name:', tc?.function?.name);
    console.log('arguments:', tc?.function?.arguments);

    // 模拟执行成功，回传 tool result
    console.log('\n=== 第二轮请求（tool result 回传） ===');
    const r2 = await call({
        model: 'doubao-1-5-pro-32k-250115',
        messages: [
            { role: 'system', content: '你是 GenHub AI 助手。用户请求创建定时任务时调用 create_cron_job 函数。' },
            { role: 'user', content: '每5分钟提醒我喝水' },
            { role: 'assistant', content: null, tool_calls: r1.choices[0].message.tool_calls },
            { role: 'tool', tool_call_id: tc.id, content: '定时任务已创建成功：名称=喝水提醒，表达式=*/5 * * * *，消息=该喝水了！' }
        ],
        max_tokens: 300, stream: false
    });
    const reply = r2.choices?.[0]?.message?.content;
    console.log('第二轮回复:', JSON.stringify(reply));
    console.log(reply ? '\n✅ 完整闭环验证通过！' : '\n❌ 第二轮无回复');
})().catch(e => console.log('ERR:', e.message));
