// 测试火山引擎各模型可用性 + 速度
const https = require('https');

const API_KEY = '0f929b81-c9a6-4996-86b3-e9cc78423687';
const BASE = 'https://ark.cn-beijing.volces.com/api/v3';

const candidates = [
    'doubao-seed-2-0-code-preview-260215',  // 当前，慢
    'doubao-seed-2-0-pro-260428',            // 新 pro
    'doubao-seed-2-0-flash-260428',          // 新 flash
    'doubao-seed-1-6-flash-250715',          // 1.6 flash
    'doubao-seed-1-6-250615',                // 1.6 pro
    'doubao-seed-1-6-thinking-250715',       // thinking
    'doubao-1-5-pro-32k-250115',             // 老款
];

function test(model) {
    return new Promise((resolve) => {
        const body = JSON.stringify({
            model,
            messages: [{ role: 'user', content: 'hi' }],
            max_tokens: 10,
            stream: false
        });
        const start = Date.now();
        const req = https.request(BASE + '/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + API_KEY
            },
            timeout: 20000
        }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                const dur = Date.now() - start;
                let info = '';
                try {
                    const j = JSON.parse(data);
                    if (j.error) info = '❌ ' + j.error.message;
                    else info = '✅ ' + (j.choices?.[0]?.message?.content || '').slice(0, 30);
                } catch (e) { info = '❌ parse: ' + data.slice(0, 80); }
                console.log(`${dur}ms  ${model}  ${info}`);
                resolve();
            });
        });
        req.on('error', (e) => { console.log(`ERR ${model}: ${e.message}`); resolve(); });
        req.on('timeout', () => { console.log(`TIMEOUT ${model}`); req.destroy(); resolve(); });
        req.write(body);
        req.end();
    });
}

(async () => {
    for (const m of candidates) await test(m);
    console.log('--- done ---');
})();
