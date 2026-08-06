// 把 9 个工具的 model_mapping 改成 doubao-1-5-pro-32k-250115
const { DatabaseSync } = require('node:sqlite');
const path = process.env.APPDATA + '\\com.genhub.app\\codexhub.db';
const NEW_MODEL = 'doubao-1-5-pro-32k-250115';

try {
    const db = new DatabaseSync(path);
    const tools = ['claude-code', 'claude-desktop', 'codex', 'deepseek-cli', 'gemini-cli',
        'hermes-agent', 'openclaw', 'opencode', 'qoder-cli'];
    let updated = 0;
    for (const t of tools) {
        const r = db.prepare('UPDATE tool_provider_configs SET model_mapping = ? WHERE tool_id = ? AND provider_id = ?')
            .run(JSON.stringify({ default: NEW_MODEL }), t, 'volcengine');
        if (r.changes > 0) updated++;
    }
    console.log(`Updated ${updated}/${tools.length} tools to ${NEW_MODEL}`);
    // 验证
    const rows = db.prepare('SELECT tool_id, model_mapping FROM tool_provider_configs').all();
    rows.forEach(r => console.log(r.tool_id, '→', r.model_mapping));
    db.close();
} catch (e) {
    console.log('ERR:', e.message);
}
