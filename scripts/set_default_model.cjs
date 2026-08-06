// 验证 doubao-seed-1-6-flash 在 fcKws 列表里
const fcKws = ['functioncall', 'r1', 'seed-evolving', 'seed-2-0-pro',
    'seed-2-1', 'seed-1-6-thinking', 'deepseek-r1', 'claude-3', 'claude-3.5',
    'claude-sonnet', 'claude-opus', 'claude-haiku', 'gpt-4o', 'gpt-4-turbo',
    'gemini-1.5', 'gemini-2', 'qwen-vl', 'qwen2-vl', 'qwen2.5-vl', 'glm-4v',
    'seed-2-0-code', 'seed-2-0-mini', 'seed-1-6-flash'];

const candidates = [
    'doubao-seed-1-6-flash-250715',     // Flash ✅ 支持 FC，速度最快
    'doubao-seed-1-6-250615',           // Pro ✅ 支持 FC
    'doubao-seed-1-6-thinking-250715',  // Thinking ✅ 支持 FC
    'doubao-1-5-pro-32k-250115',        // 老款 Pro ✅
    'doubao-seed-2-0-flash',            // 新 Flash（待确认）
    'doubao-seed-2-0-pro',              // 新 Pro（待确认）
];

candidates.forEach(id => {
    const n = id.toLowerCase();
    const isLite = n.includes('lite');
    const isFC = fcKws.some(k => n.includes(k));
    console.log(`${id} → lite=${isLite}, fc=${isFC}, 可用=${!isLite}`);
});