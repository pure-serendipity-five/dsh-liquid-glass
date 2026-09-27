/* 设置项 UI 专项测试（独立于 collapse.test.mjs，避免再改大文件的文本锚点）
   流程：假壁纸服务 → 真实 client.js/styles.css → CDP 真实等待
        → 齿轮存在 → 点开有 6 条 → 点「白纱 3%」→ 持久化 + 侧栏 alpha 真的变 0.138 → 关闭
   用法：node settings.test.mjs */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN = process.env.DSHLG_ROOT || join(HERE, '..');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 39580;
const DEBUG_PORT = 9550;
const TMP = process.env.DSHLG_TMP || tmpdir();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 测试页：复用 collapse 测试里的最小 DSH 结构 */
const src = fs.readFileSync(join(HERE, 'collapse.test.mjs'), 'utf8');
const body = src.slice(src.indexOf('function page(collapsed) {'), src.indexOf('let collapsed = false;'));
const page = new Function('collapsed', body.replace('function page(collapsed) {', '').replace(/\}\s*$/, ''));
const html = page(false);

const JSONH = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
const fakeWall = createServer((req, res) => {
  const u = req.url || '/';
  if (u.startsWith('/__alive')) { res.writeHead(200, JSONH); res.end(JSON.stringify({ server: 'dsh-liquid-glass', version: 'test', features: ['wallpapers'], scenes: [] })); return; }
  if (u.startsWith('/__wallpapers')) { res.writeHead(200, JSONH); res.end(JSON.stringify({ wallpapers: [{ id: 'local:zen', title: '宅邸禅院', kind: 'local' }] })); return; }
  res.writeHead(404); res.end();
});
await new Promise((r) => { try { fakeWall.listen(39323, '127.0.0.1', r); } catch { r(); } });

const srv = createServer((req, res) => {
  const u = req.url || '/'; const h = { 'Cache-Control': 'no-store' };
  if (u.startsWith('/client.js')) { res.writeHead(200, { ...h, 'Content-Type': 'text/javascript; charset=utf-8' }); res.end(fs.readFileSync(join(PLUGIN, 'client.js'))); return; }
  if (u.startsWith('/styles.css')) { res.writeHead(200, { ...h, 'Content-Type': 'text/css; charset=utf-8' }); res.end(fs.readFileSync(join(PLUGIN, 'styles.css'))); return; }
  res.writeHead(200, { ...h, 'Content-Type': 'text/html; charset=utf-8' }); res.end(html);
});
await new Promise((r) => srv.listen(PORT, '127.0.0.1', r));

const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--window-size=1280,900',
  `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${join(TMP, 'edge-settings-' + Date.now())}`,
  `http://127.0.0.1:${PORT}/`], { stdio: ['ignore', 'pipe', 'pipe'] });
edge.stdout.on('data', () => {}); edge.stderr.on('data', () => {});

let target = null;
for (let i = 0; i < 80; i += 1) {
  try { const l = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json(); target = l.find((x) => x.type === 'page' && x.webSocketDebuggerUrl); if (target) break; } catch { /* 等 */ }
  await sleep(250);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (m, q) => new Promise((r) => { id += 1; pending.set(id, r); ws.send(JSON.stringify({ id, method: m, params: q })); });
const ev = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  return r.result?.exceptionDetails ? { err: r.result.exceptionDetails.text } : r.result?.result?.value;
};
await send('Page.enable');

let failed = 0;
const check = (label, ok, detail) => {
  console.log((ok ? '  PASS  ' : '  FAIL  ') + label + '　' + detail);
  if (!ok) failed += 1;
};

console.log('=== 设置项 UI 专项（真时钟 + CDP）===');

/* 等齿轮出现（插件要等壁纸探完才建 UI） */
let gear = false;
for (let i = 0; i < 60; i += 1) { gear = await ev(`!!document.getElementById('dshlg-gear')`); if (gear) break; await sleep(500); }
check('齿轮按钮存在', gear === true, `gear=${gear}`);
const errText = await ev(`window.__DSHLG_ERR || null`);
check('插件无异常', errText === null, `err=${errText || '无'}`);

const opened = await ev(`(() => {
  const g = document.getElementById('dshlg-gear');
  if (!g) return null;
  g.click();
  const p = document.getElementById('dshlg-settings');
  return { exists: !!p, visible: !!p && !p.hasAttribute('hidden'), rows: p ? p.querySelectorAll('.row').length : 0,
           labels: p ? Array.from(p.querySelectorAll('.label')).map((x) => x.textContent) : [] };
})()`);
check('点齿轮能打开面板', opened?.visible === true, `visible=${opened?.visible}`);
check('面板列出条目', (opened?.rows || 0) >= 5, `rows=${opened?.rows}：${(opened?.labels || []).join(' / ')}`);

/* 点「白纱 3%」：应持久化，并让侧栏 alpha 真的变成 0.138 */
const clicked = await ev(`(() => {
  const b = document.querySelector('#dshlg-settings button[data-set-key="glassTier"][data-set-val="regular"]');
  if (!b) return { clicked: false };
  b.click();
  return { clicked: true, saved: (() => { try { return localStorage.getItem('dshlg.settings'); } catch { return null; } })() };
})()`);
await sleep(1800);
const effect = await ev(`(() => {
  const el = document.querySelector('[data-dshlg-region="side"]');
  const cs = el ? getComputedStyle(el) : null;
  return { alpha: cs ? cs.getPropertyValue('--dshlg-alpha').trim() : null, bg: cs ? cs.backgroundColor : null };
})()`);
check('点档位会写入 localStorage', clicked?.clicked === true && /glassTier/.test(String(clicked?.saved)), `saved=${String(clicked?.saved).slice(0, 70)}`);
check('改动真的生效（侧栏 alpha ≈ 0.138）', Math.abs(Number(effect?.alpha) - 0.138) < 0.01, `alpha=${effect?.alpha} bg=${effect?.bg}`);

/* 品牌宝石色切换 */
const gem = await ev(`(() => {
  const b = document.querySelector('#dshlg-settings button[data-set-key="brandGem"][data-set-val="gold"]');
  if (!b) return null;
  b.click();
  return document.documentElement.dataset.dshlgGem;
})()`);
check('切宝石色会写到 html[data-dshlg-gem]', gem === 'gold', `gem=${gem}`);

/* 齿轮与控制条：同一条水平线（底边对齐）且不重叠 */
const geo = await ev(`(() => {
  const gear = document.getElementById('dshlg-gear');
  const bar = document.getElementById('dshlg-controls');
  if (!gear || !bar) return null;
  const g = gear.getBoundingClientRect();
  const b = bar.getBoundingClientRect();
  return {
    gear: [Math.round(g.left), Math.round(g.top), Math.round(g.right), Math.round(g.bottom)],
    bar: [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)],
    bottomGap: Math.round(Math.abs(g.bottom - b.bottom)),
    horizontalOverlap: g.left < b.right && g.right > b.left,
    verticalOverlap: g.top < b.bottom && g.bottom > b.top,
  };
})()`);
check('齿轮与控制条底边对齐（同一水平线）', (geo?.bottomGap ?? 99) <= 4, `底边差 ${geo?.bottomGap}px　齿轮=${JSON.stringify(geo?.gear)} 控制条=${JSON.stringify(geo?.bar)}`);
check('齿轮与控制条不重叠', geo?.horizontalOverlap === false, `水平重叠=${geo?.horizontalOverlap}`);

/* 拖动：合成指针事件把齿轮左上方向拖 80/40px，应落库并真的移动 */
const dragged = await ev(`(() => {
  const el = document.getElementById('dshlg-gear');
  if (!el) return null;
  const before = el.getBoundingClientRect();
  const mk = (type, x, y) => new PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', button: 0, clientX: x, clientY: y,
  });
  const x0 = before.left + 12; const y0 = before.top + 12;
  el.dispatchEvent(mk('pointerdown', x0, y0));
  el.dispatchEvent(mk('pointermove', x0 - 40, y0 - 20));
  el.dispatchEvent(mk('pointermove', x0 - 80, y0 - 40));
  el.dispatchEvent(mk('pointerup', x0 - 80, y0 - 40));
  const after = el.getBoundingClientRect();
  let saved = null;
  try { saved = localStorage.getItem('dshlg.pos'); } catch { /* 忽略 */ }
  return {
    dx: Math.round(after.left - before.left),
    dy: Math.round(after.top - before.top),
    moved: el.dataset.dshlgMoved === '1',
    saved,
  };
})()`);
check('拖动：元素真的移动了（≈ -80 / -40）',
  Math.abs((dragged?.dx ?? 0) + 80) <= 6 && Math.abs((dragged?.dy ?? 0) + 40) <= 6,
  `位移 dx=${dragged?.dx} dy=${dragged?.dy}`);
check('拖动：位置写入 localStorage',
  /"gear"/.test(String(dragged?.saved)) && dragged?.moved === true,
  `saved=${String(dragged?.saved).slice(0, 80)}`);


/* 画廊按钮必须能用（拖动带来的点击抑制曾经把它吞掉） */
const gallery = await ev(`(() => {
  const btn = document.querySelector('#dshlg-controls button[data-role="gallery"]');
  if (!btn) return { btn: false };
  btn.click();
  const g = document.getElementById('dshlg-gallery');
  const open = !!g && !g.hasAttribute('hidden');
  return { btn: true, open, visible: g ? !g.hasAttribute('hidden') : null };
})()`);
check('点「画廊」按钮能打开画廊', gallery?.btn === true && gallery?.open === true,
  `按钮=${gallery?.btn} 打开=${gallery?.open}`);

/* 画廊里的壁纸卡片可点（切换动作不报错） */
const pick = await ev(`(() => {
  const card = document.querySelector('#dshlg-gallery .card');
  if (!card) return { card: false };
  const before = window.__DSHLG_ERR || null;
  card.click();
  return { card: true, errBefore: before, errAfter: window.__DSHLG_ERR || null };
})()`);
check('画廊里能点选壁纸且不报错', pick?.card === true && !pick?.errAfter,
  `卡片=${pick?.card} err=${pick?.errAfter || '无'}`);

/* 自适应可读性：面板应把「玻璃厚度 + 字色」写成内联变量，且对比度达标 */
const fit = await ev(`(() => {
  const p = document.getElementById('dshlg-settings');
  if (!p || p.hasAttribute('hidden')) return { open: false };
  const cs = getComputedStyle(p);
  const lum = (r, g, b) => {
    const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const parse = (s) => { const m = String(s).match(/rgba?\\(([^)]+)\\)/); return m ? m[1].split(/[\\s,/]+/).filter(Boolean).map(Number) : null; };
  const ink = parse(cs.color);
  const veil = parse(cs.backgroundColor);
  if (!ink || !veil) return { open: true, ink: cs.color, veil: cs.backgroundColor };
  /* 面板落在「页面底色」上：用 body 背景近似（自适应时已按实测亮度算过） */
  const bodyBg = parse(getComputedStyle(document.body).backgroundColor) || [255, 255, 255, 1];
  const a = veil.length > 3 ? veil[3] : 1;
  const mix = [0, 1, 2].map((i) => veil[i] * a + bodyBg[i] * (1 - a));
  const L1 = lum(mix[0], mix[1], mix[2]);
  const L2 = lum(ink[0], ink[1], ink[2]);
  const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
  return { open: true, veil: cs.backgroundColor, ink: cs.color, ratio: Number(ratio.toFixed(2)),
           fit: p.dataset.dshlgPanelFit, bg: p.dataset.dshlgPanelBg };
})()`);
check('面板自适应：已写入玻璃厚度与字色',
  !!fit?.veil && !!fit?.ink && !!fit?.fit,
  `fit=${fit?.fit} veil=${fit?.veil} ink=${fit?.ink} 背后=${fit?.bg}`);
check('面板自适应：对比度 ≥ 4.5:1', Number(fit?.ratio) >= 4.5, `对比度=${fit?.ratio}:1`);

const closed = await ev(`(() => {
  const p = document.getElementById('dshlg-settings');
  const b = p && p.querySelector('button[data-role="close"]');
  if (!b) return null;
  b.click();
  return !document.getElementById('dshlg-settings').hasAttribute('hidden') ? 'still-open' : 'closed';
})()`);
check('点关闭能收起面板', closed === 'closed', `状态=${closed}`);

try { fakeWall.close(); } catch { /* 已关 */ }
srv.close(); ws.close(); edge.kill();
console.log(failed ? `\n✗ ${failed} 项不通过` : '\n✓ 设置项 UI 全部通过');
process.exit(failed ? 1 : 0);
