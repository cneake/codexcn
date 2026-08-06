// 测试 doubao-1-5-pro-32k-250115 是否支持 function calling
const https = require('https');
const API_KEY = '0f929b81-c9a6-4996-86b3-e9cc78423687';
const BASE = 'https://ark.cn-beijing.volces.com/api/v3';

const body = JSON.stringify({
    model: 'doubao-1-5-pro-32k-250115',
    messages: [
        { role: 'user', content: '每5分钟提醒我喝水' }
    ],
    tools: [{
        type: 'function',
        function: {
            name: 'create_cron_job',
            description: '创建定时任务',
            parameters: {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    cron_expr: { type: 'string' },
                    message: { type: 'string' }
                },
                required: ['id', 'name', 'cron_expr', 'message']
            }
        }
    }],
    max_tokens: 100,
    stream: false
});

const start = Date.now();
const req = https.request(BASE + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + API_KEY },
    timeout: 30000
}, (res) => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
        const dur = Date.now() - start;
        try {
            const j = JSON.parse(data);
            if (j.error) { console.log('❌', j.error.message); return; }
            const msg = j.choices?.[0]?.message;
            console.log(`耗时 ${dur}ms`);
            console.log('content:', JSON.stringify(msg?.content));
            console.log('tool_calls:', JSON.stringify(msg?.tool_calls, null, 1));
            if (msg?.tool_calls?.length) {
                console.log('✅ 支持 function calling!');
            } else {
                console.log('⚠️ 未返回 tool_calls（可能不支持或没触发）');
            }
        } catch (e) { console.log('parse err:', data.slice(0, 200)); }
    });
});
req.on('error', e => console.log('ERR:', e.message));
req.on('timeout', () => { console.log('TIMEOUT'); req.destroy(); });
req.write(body);
req.end();
