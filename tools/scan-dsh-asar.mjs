/* 从 DSH 的 app.asar 里挖**真实类名**（改 DSH 自己的界面之前必做的一步）。
 *
 * 为什么需要：DSH 的类名是「模块哈希 + 语义后缀」（如 LdcXKW_panel / y7bFDa_overlay /
 * _material_ri079_21），哈希会随版本变 —— 所以插件里只认**语义后缀**
 * （[class*='_panel']），而确认后缀是否存在、结构是父子还是兄弟，只能查真身。
 * 本轮就是靠它挖出：设置浮层 = y7bFDa_overlay > y7bFDa_panel；
 * 菜单 = data-menu-material > .material{background:var(--dsw-menu-surface-fill)}。
 *
 * 用法：
 *   node tools/scan-dsh-asar.mjs                       # 默认找 overlay/scrim/panel/menu/material
 *   node tools/scan-dsh-asar.mjs menu dropdown popup   # 自定义语义后缀
 *   DSH_ASAR="D:\\path\\app.asar" node tools/scan-dsh-asar.mjs
 *
 * 中文/源码是 UTF-8：要按文字反查（如「退出登录」）时，改用 Buffer.from(str,'utf8') + indexOf，
 * 直接把整包按 latin1 读会漏掉中文。
 */
import { open } from 'node:fs/promises';

const P = process.env.DSH_ASAR
  || 'D:\\deepseek harness\\resources\\app.asar';
const SEMS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['overlay', 'scrim', 'panel', 'menu', 'material', 'surface'];
const found = new Map();
/* DSH 的类名形如 ZTP-Xa_frame / LdcXKW_panel / n_2Q3W_brand / _material_ri079_21
   —— 「哈希或下划线前缀 + 语义名」，不是 CSS-modules 常见的 name__hash。 */
const CLASS_RE = new RegExp('[A-Za-z0-9_][A-Za-z0-9_-]{2,14}_(?:' + SEMS.join('|') + ')\\b', 'g');

const fh = await open(P, 'r');
const size = (await fh.stat()).size;
console.log('app.asar 大小：' + (size / 1024 / 1024).toFixed(1) + ' MB');

const CHUNK = 8 * 1024 * 1024;
const OVERLAP = 4096;
let pos = 0;
let tail = '';
while (pos < size) {
  const len = Math.min(CHUNK, size - pos);
  const buf = Buffer.allocUnsafe(len);
  await fh.read(buf, 0, len, pos);
  const text = tail + buf.toString('latin1');
  let m;
  while ((m = CLASS_RE.exec(text))) found.set(m[0], (found.get(m[0]) || 0) + 1);
  tail = text.slice(-OVERLAP);
  pos += len;
}
await fh.close();

console.log(`\n按语义后缀 ${SEMS.join(' / ')} 挖到的候选类名：`);
const list = [...found.keys()].sort();
if (!list.length) console.log('  （没挖到 —— 换语义后缀，或确认 app.asar 路径对不对）');
for (const s of list) console.log('  ' + s + (found.get(s) > 1 ? '  ×' + found.get(s) : ''));
console.log('\n提示：拿到类名后，用同一个 asar 搜该类的 CSS 规则（形如 .<类名>{...}），');
console.log('      就能看出结构（父子/兄弟）与它吃的是哪个 --dsw-* 令牌 —— 别猜。');
