/* 扫描：模板字符串内部的 CSS 注释里有没有反引号。
   这类反引号会把外层模板截断，报出与真正原因无关的 ReferenceError —
   本项目踩过两次（一次是 CSS 注释里写 blur(...)，一次是 [data-dshlg-region]）。 */
import fs from 'node:fs';

const file = process.argv[2] ?? '<插件目录>/client.js';
const s = fs.readFileSync(file, 'utf8');

let count = 0;         // 未配对的反引号数量（奇数 = 当前在模板字符串内）
const bad = [];
for (let i = 0; i < s.length; i += 1) {
  const ch = s[i];
  if (ch === '\\') { i += 1; continue; }
  if (ch === '`') { count += 1; continue; }
  if (ch === '/' && s[i + 1] === '*') {
    const end = s.indexOf('*/', i + 2);
    if (end < 0) break;
    const body = s.slice(i, end + 2);
    // 只看**未转义**的反引号：\` 在模板里是字面量，不会截断
    const hasBare = /(^|[^\\])`/.test(body);
    if (count % 2 === 1 && hasBare) {
      bad.push({ line: s.slice(0, i).split('\n').length, body: body.replace(/\s+/g, ' ').slice(0, 90) });
    }
    i = end + 1;
  }
}

if (bad.length === 0) console.log('✓ 模板内部的注释都不含反引号');
else {
  console.log('✗ 模板内部的注释含反引号（会把模板截断）：');
  for (const b of bad) console.log('   第 ' + b.line + ' 行: ' + b.body);
  process.exitCode = 1;
}
