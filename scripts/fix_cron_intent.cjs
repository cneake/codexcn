const fs = require('fs');
const c = fs.readFileSync('D:/codexhubcn/cc-switch-clone/src/components/ChatMain.tsx', 'utf8');

// Find Mode A (before handleSend)
const markerA = '/* ── 模式 A';
// Find Mode B check block end: look for "return; // 不继续发 LLM"
const returnLine = 'return; // 不继续发 LLM';
// Find where normal flow begins: setInput(''); after Mode B
const setInputLine = "setInput('');";

const idxA = c.indexOf(markerA);
const returnPos = c.indexOf(returnLine);
const setInputPos = c.indexOf(setInputLine);

console.log('Mode A at:', idxA);
console.log('return at:', returnPos);
console.log('setInput at:', setInputPos);

// The block to remove: from Mode A start to the closing } before setInput('')
// The closing } of Mode B is just before the return
// Mode A block ends, Mode B block (hasTimeWord check) runs, then return
// Remove: Mode A comment → Mode B return; → closing } of Mode B if
// Keep: setInput(''); (normal flow starts here)

// We need to remove from idxA to (setInputPos - 1)
// But actually there's extra } between return and setInput. Let me check.
const charBeforeSetInput = c[setInputPos - 1];
const charBeforeThat = c[setInputPos - 2];
console.log('Chars before setInput:', JSON.stringify(c.substring(setInputPos - 10, setInputPos + 10)));

// The block to remove: idxA through the line before setInput('')
// setInput(''); starts at setInputPos, we want to remove everything up to (but not including) it
const blockToRemove = c.substring(idxA, setInputPos);
console.log('\nBlock to remove (' + blockToRemove.length + ' chars):');
console.log(blockToRemove);

// Replace with a simple comment
const newBlock = '    /* 定时任务由 AI 决策：通过 function calling 自动建任务 */\n    ';
const newContent = c.substring(0, idxA) + newBlock + c.substring(setInputPos);

fs.writeFileSync('D:/codexhubcn/cc-switch-clone/src/components/ChatMain.tsx', newContent, 'utf8');
console.log('\nDone! New length:', newContent.length);
console.log('Saved to ChatMain.tsx');
