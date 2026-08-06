const { DatabaseSync } = require('node:sqlite');
const path = process.env.APPDATA + '\\com.genhub.app\\codexhub.db';
try {
    const db = new DatabaseSync(path, { readOnly: true });
    console.log('--- tool_provider_configs (all) ---');
    const all = db.prepare('SELECT tool_id, provider_id, model_mapping, active FROM tool_provider_configs').all();
    all.forEach(r => console.log(JSON.stringify(r)));
    db.close();
} catch (e) {
    console.log('ERR:', e.message);
}
