const fs = require('fs');
const path = 'D:/codexhubcn/cc-switch-clone/src/components/ChatMain.tsx';
let c = fs.readFileSync(path, 'utf8');

const oldBlock = `const handleSend = async () => {
    if ((!input.trim() && pendingImages.length === 0) || !session || loading) return;
    const text = input.trim();`;

const newBlock = `const handleSend = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if ((!text && pendingImages.length === 0) || !session || loading) return;`;

if (!c.includes(oldBlock)) {
    console.log('Pattern NOT found. Trying to find it...');
    const hs = c.indexOf('const handleSend = async');
    console.log('handleSend at:', hs);
    console.log('Context:', JSON.stringify(c.substring(hs, hs+300)));
} else {
    c = c.replace(oldBlock, newBlock);
    console.log('overrideText applied!');
}

fs.writeFileSync(path, c, 'utf8');
console.log('Done. Length:', c.length);

// Verify
const content = fs.readFileSync(path, 'utf8');
console.log('Has overrideText:', content.includes('overrideText'));
const hs = content.indexOf('const handleSend = async');
console.log('New handleSend:', JSON.stringify(content.substring(hs, hs+250)));
