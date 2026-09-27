/* 决定性实验：setPointerCapture(pointerdown) 会不会把后续 click 的 target
   重定向到「捕获元素」上？
   如果会 —— 那么 makeDraggable 装在 #dshlg-cc 上时，
   面板内所有按钮的 click 都会以 **面板本身** 为 target，
   `event.target.closest('[data-cc-act]')` 直接是 null → 「点任何位置都没反应」。
   用真 Edge + CDP 的真实鼠标事件（Input.dispatchMouseEvent）测，不用合成 click。 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const EDGE = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync);
if (!EDGE) { console.error('找不到 msedge.exe'); process.exit(2); }
const PORT = 39411;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
 html,body{margin:0;height:100vh;font:14px system-ui}
 .wrap{width:400px;margin:40px;padding:20px;border:2px solid #333}
 button{display:block;width:200px;height:40px;margin:8px 0}
 </style></head><body>
 <div class="wrap" id="wA"><button id="bA" data-act="alpha">A: 捕获指针的容器里的按钮</button></div>
 <div class="wrap" id="wB"><button id="bB" data-act="beta">B: 不捕获的容器里的按钮</button></div>
 <script>
  window.__LOG = [];
  const log = (s) => { window.__LOG.push(s); };
  function wire(wrapId, capture) {
    const wrap = document.getElementById(wrapId);
    wrap.addEventListener('pointerdown', (e) => {
      log(wrapId + ' pointerdown target=' + (e.target.id || e.target.tagName));
      if (capture) { try { wrap.setPointerCapture(e.pointerId); log(wrapId + ' → setPointerCapture OK'); }
                     catch (err) { log(wrapId + ' → setPointerCapture 抛错: ' + err.message); } }
    });
    /* 委托式 click（和插件里 ccOnClick / 控制条 click 完全同构） */
    wrap.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      log(wrapId + ' click target=' + (e.target.id || e.target.tagName)
          + ' closest(button)=' + (btn ? btn.id : 'null')
          + ' closest([data-act])=' + (e.target.closest('[data-act]') ? 'yes' : 'null'));
    });
  }
  wire('wA', true);
  wire('wB', false);
  /* 再挂一个 document 捕获，看 target 有没有被改 */
  document.addEventListener('click', (e) => {
    log('document(capture) click target=' + (e.target.id || e.target.tagName));
  }, true);
  /* 按钮自己的监听（直接挂） */
  for (const id of ['bA','bB']) {
    document.getElementById(id).addEventListener('click', () => log(id + ' 自己的 click 监听 fired'));
  }
 </script></body></html>`;

const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(PAGE);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const cdpPort = 9401;
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--window-size=800,600',
  '--remote-debugging-port=' + cdpPort,
  '--user-data-dir=' + join(tmpdir(), 'edge-clickprobe-' + Date.now()),
  'http://127.0.0.1:' + PORT + '/'], { stdio: ['ignore', 'pipe', 'pipe'] });
edge.stdout.on('data', () => {}); edge.stderr.on('data', () => {});

let target = null;
for (let i = 0; i < 60; i += 1) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
    target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (target) break;
  } catch { /* 等 */ }
  await sleep(250);
}
if (!target) { console.error('CDP 没起来'); edge.kill(); server.close(); process.exit(2); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (m, p) => new Promise((r) => { id += 1; pending.set(id, r); ws.send(JSON.stringify({ id, method: m, params: p })); });
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) return { err: r.result.exceptionDetails.text };
  return r.result?.result?.value;
};
await send('Page.enable');
await send('Runtime.enable');
await sleep(400);

/** 真实鼠标点击（按下 + 抬起），会产生完整 pointerdown/pointerup/click 序列 */
async function realClick(sel) {
  const box = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(30);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(120);
}

await evaluate('window.__LOG = []');
await realClick('#bA');
const afterA = await evaluate('JSON.stringify(window.__LOG)');
await evaluate('window.__LOG = []');
await realClick('#bB');
const afterB = await evaluate('JSON.stringify(window.__LOG)');

console.log('── A：容器在 pointerdown 里 setPointerCapture（= 插件 makeDraggable 的做法）──');
for (const l of JSON.parse(afterA)) console.log('   ' + l);
console.log('\n── B：容器不捕获（对照组）──');
for (const l of JSON.parse(afterB)) console.log('   ' + l);

const aRetargeted = JSON.parse(afterA).some((l) => /^wA click target=wA /.test(l));
const bOk = JSON.parse(afterB).some((l) => /closest\(button\)=bB/.test(l));
console.log('\n结论：');
console.log('  A 组 click 的 target 被重定向到捕获元素 wA 本身 → ' + (aRetargeted ? '是 ✅ 假设成立' : '否 ❌ 假设不成立'));
console.log('  B 组对照（未捕获）click 正常命中按钮 → ' + (bOk ? '是（说明差异确实来自 setPointerCapture）' : '否（实验本身有问题）'));

ws.close(); edge.kill(); server.close();
process.exit(0);
