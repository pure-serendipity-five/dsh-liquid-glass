/* 控制中心「点击无反应」真机复现台（真时钟 + 真 Edge + CDP **真实鼠标事件**）
 *
 * 为什么必须单开一个：
 *   项目现有的 collapse / settings 测试全部用 `el.click()`（合成 click），
 *   合成 click **不产生 pointerdown**，于是 makeDraggable 里的
 *   setPointerCapture 永远不会发生 —— 而它正是「点任何位置都没反应」的根因。
 *   所以现有测试一路全绿，真机上却点不动。这份用 Input.dispatchMouseEvent
 *   发真实鼠标事件（mousePressed → mouseReleased），走完整的
 *   pointerdown / pointerup / click 链路。
 *
 * 用法：node cc-click.test.mjs      （FAIL 时非零退出）
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const EDGE = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync);
if (!EDGE) { console.error('找不到 msedge.exe'); process.exit(2); }

/* 插件根目录：默认取脚本上一级（test/ 的父目录），可用 DSHLG_ROOT 覆盖。 */
const PLUGIN = process.env.DSHLG_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');
/* 临时目录：默认走系统 tmp，可用 DSHLG_TMP 覆盖。 */
const TMP = process.env.DSHLG_TMP || tmpdir();
const CLIENT_PATH = join(PLUGIN, 'client.js');
const PORT = 39412;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── 宿主假体：返回**和真宿主一模一样**的包一层形状 ────────────────
   真机 index.js:1330 → controlJson(res, 200, { ok, version, currentCwd, count, workspaces })
   这里逐字照抄形状，才能验出客户端「当纯数组用」的 bug。 */
const FAKE = {
  alive: { server: 'dsh-liquid-glass', version: 'test', features: ['wallpapers', 'control'], scenes: [] },
  wallpapers: { wallpapers: [{ id: 'local:zen', title: '宅邸禅院', kind: 'local', previewExt: '.png' }] },
  control: {
    health: { ok: true, version: 'test', services: { workspaces: true, sessions: true }, degraded: [], carrier: '39321' },
    workspaces: {
      ok: true, version: 'test',
      currentCwd: 'D:\\Documents\\deepseek-harness\\default-workspace',
      currentBasis: '最近活跃会话的 cwd', flagsAvailable: true, count: 2,
      workspaces: [
        { id: 'ws-a', name: '回归空间A', path: 'D:\\AI应用', isCurrent: false, sessionCount: 3, pinnedCount: 0, archivedCount: 0, status: 'ok', createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-02T00:00:00Z' },
        { id: 'ws-b', name: '回归空间B', path: 'D:\\Documents\\deepseek-harness\\default-workspace', isCurrent: true, sessionCount: 1, pinnedCount: 0, archivedCount: 0, status: 'ok', createdAt: '2026-09-03T00:00:00Z', updatedAt: '2026-09-04T00:00:00Z' },
      ],
    },
    'sessions/inspect': {
      ok: true, version: 'test', count: 1,
      sessions: [{ id: 's-1', severity: 'ok', title: '回归会话标题' }],
    },
  },
};

function page() {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;background:#0f1115;color:#e8eef8;font:14px system-ui}
  #root{position:relative;z-index:1;height:100vh}
  .ZTP-Xa_frame{height:100vh;display:grid;grid-template-columns:280px minmax(400px,1fr) minmax(0,720px)}
  .ZTP-Xa_sidebarCol{background:var(--dsw-specific-sidebar-fill);overflow:hidden}
  .ZTP-Xa_centerCol{display:flex;flex-direction:column;overflow:hidden}
  .ZTP-Xa_rightbarCol{position:relative;overflow:visible}
  .LdcXKW_panel{position:absolute;top:0;bottom:0;right:0;display:flex;flex-direction:column;pointer-events:none}
  .LdcXKW_panel [data-dockkit-host]{transform:translateX(100%);visibility:hidden}
  .LdcXKW_panel[data-sidebar-right-open] [data-dockkit-host]{transform:none;visibility:visible}
  .dock{flex:1;background:var(--dsw-alias-bg-layer-1)}
  .mock-composer{border-radius:14px;padding:10px}
  </style></head><body>
  <div id="root"><div class="ZTP-Xa_frame">
    <div class="ZTP-Xa_sidebarCol">
      <div class="n_2Q3W_root"><div class="n_2Q3W_logoRow"><span class="n_2Q3W_brand"><span class="n_2Q3W_brandIdentity"><span class="n_2Q3W_brandMark"><svg width="24" height="18" viewBox="0 0 23.16 17.04" fill="none" aria-hidden="true"><path d="M2 8 L20 8 L20 16 Z" fill="currentColor"/></svg></span><span class="n_2Q3W_brandName"><svg width="156" height="24" viewBox="26 0 156 24" fill="none" aria-hidden="true" data-dshlg-wordmark><path d="M68.4 18.2H67V16.1H68.4L80 6 L92 16 Z" fill="#ffffff"/></svg></span></span><button class="n_2Q3W_iconButton">+</button></span></div>
        <button class="n_2Q3W_sessionRow">会话一</button><button class="n_2Q3W_sessionRow">会话二</button><button class="n_2Q3W_sessionRow">会话三</button>
      </div>
    </div>
    <div class="ZTP-Xa_centerCol">
      <div style="flex:1"></div>
      <div class="mock-composer D_tfqW_composerSeat" data-composer-seat data-conversation-region><div contenteditable="true" style="min-height:36px;outline:none">测试</div>
        <div><button>+</button><button>@</button><button>发送</button></div></div>
    </div>
    <div class="ZTP-Xa_rightbarCol" data-rightbar-col>
      <div class="LdcXKW_panel" data-sidebar-right-session="s1" data-sidebar-right-panel="push" data-sidebar-right-open>
        <div data-dockkit-host="dock"><div class="dock" data-testid="dock"><button>↻</button><button>⋯</button></div></div>
      </div>
    </div>
  </div></div>
  <script>
  window.__FAKE = ${JSON.stringify(FAKE)};
  /* 确定性：宿主的探测端点与控制 API 全部本地应答，不受真机端口占用影响。
     只拦这几类 URL，其余照走原生 fetch。 */
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = String(typeof input === 'string' ? input : ((input && input.url) || ''));
    const json = (o) => Promise.resolve(new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    if (/\\/__alive/.test(url)) return json(window.__FAKE.alive);
    if (/\\/__wallpapers/.test(url)) return json(window.__FAKE.wallpapers);
    const m = /\\/dshlg-control\\/(.+)$/.exec(url.split('?')[0]);
    if (m) {
      const k = m[1];
      return json(window.__FAKE.control[k] || { ok: false, error: { code: 'not_found', message: 'no route ' + k } });
    }
    return realFetch(input, init);
  };
  /* 记录每一次 click 的真实 target —— 用来直接看清「被重定向到容器」这件事 */
  window.__CLICKS = [];
  document.addEventListener('click', (e) => {
    const t = e.target;
    window.__CLICKS.push((t && t.id ? '#' + t.id : '') + (t && t.tagName ? '<' + t.tagName + '>' : '?')
      + (t && t.dataset && t.dataset.ccAct ? '[act=' + t.dataset.ccAct + ']' : ''));
  }, true);
  window.__ModuleLoader__ = { load(spec) {
    try { const m = spec.factory(); m.apply({ effect() {} }); window.__OK = true; }
    catch (e) { window.__ERR = String((e && e.stack) || e); }
  } };
  </script>
  <script src="/client.js"></script>
  </body></html>`;
}

const server = createServer((req, res) => {
  const u = req.url || '/';
  if (u === '/client.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(readFileSync(CLIENT_PATH));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(page());
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const cdpPort = 9402;
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--window-size=1280,800',
  '--remote-debugging-port=' + cdpPort,
  '--user-data-dir=' + join(TMP, 'edge-ccclick-' + Date.now()),
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

let bad = 0;
const t = (name, pass, detail) => {
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '　' + detail : ''}`);
  if (!pass) bad += 1;
};
const info = (s) => console.log('  INFO  ' + s);

for (let i = 0; i < 60; i += 1) {
  const ok = await evaluate('window.__OK === true || !!window.__ERR');
  if (ok === true) break;
  await sleep(250);
}
await sleep(800);

/** 真实鼠标点击：按下 → 抬起（== 用户用鼠标点一下）。
    返回 {ok, hit, reached}：hit = 坐标处实际最上层元素；reached = 该元素是否落在 sel 内 */
async function realClick(sel) {
  const probe = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});
    if(!e) return {none:true, why:'元素不存在'};
    const r=e.getBoundingClientRect();
    if(r.width===0&&r.height===0) return {none:true, why:'元素不可见(0×0)'};
    const x=r.left+r.width/2, y=r.top+r.height/2;
    const hit=document.elementFromPoint(x,y);
    const label=hit?((hit.id?'#'+hit.id:hit.tagName)+(hit.dataset&&hit.dataset.ccAct?'[act='+hit.dataset.ccAct+']':'')):'null';
    return {x,y,hit:label, reached: !!(hit && hit.closest && hit.closest(${JSON.stringify(sel)}))};})()`);
  if (!probe || probe.none) return { ok: false, why: probe ? probe.why : '探测失败' };
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: probe.x, y: probe.y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(40);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: probe.x, y: probe.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(220);
  return { ok: true, hit: probe.hit, reached: probe.reached, x: probe.x, y: probe.y };
}

const PANEL_STATE = `(()=>{const p=document.getElementById('dshlg-cc');
  if(!p) return { exists:false };
  return { exists:true, open:p.hasAttribute('data-dshlg-cc-open'), hidden:p.hasAttribute('hidden'),
    display:getComputedStyle(p).display,
    text:(p.querySelector('.cc-body')?.textContent||''),
    tab:(p.querySelector('.cc-tabs button[aria-selected="true"]')?.textContent)||'' };})()`;
const state = () => evaluate(PANEL_STATE);
const openPanel = async () => {
  let s = await state();
  if (!s || s.open !== true) { await realClick('[data-role="control-center"]'); await sleep(500); s = await state(); }
  return s;
};
const closePanel = async () => {
  let s = await state();
  if (s && s.open === true) { await realClick('#dshlg-cc [data-cc-act="close"]'); await sleep(300); s = await state(); }
  return s;
};
const clicks = () => evaluate('JSON.stringify(window.__CLICKS)');

console.log('=== 控制中心真实鼠标点击复现台 ===');
console.log('  目标 client.js：' + CLIENT_PATH);
t('插件已 apply 且无异常', (await evaluate('window.__OK === true')) === true,
  'err=' + JSON.stringify(await evaluate('window.__ERR || "无"')));

const entry = await evaluate(`(()=>{const b=document.querySelector('[data-role="control-center"]');
  return b? { found:true, text:b.textContent.trim() } : { found:false };})()`);
t('控制条上的「控制中心」入口存在', entry && entry.found === true, JSON.stringify(entry));

/* ① 入口：真实鼠标点击 → 面板打开 */
await evaluate('window.__CLICKS = []');
const c1 = await realClick('[data-role="control-center"]');
t('入口按钮：点击命中它自己', c1.ok && c1.reached === true, '命中=' + c1.hit + ' 坐标=' + c1.x + ',' + c1.y);
info('入口点击的 click target：' + (await clicks()));
let s = await state();
t('① 真实点击后控制中心面板打开', s.exists && s.open === true && s.hidden === false && s.display !== 'none',
  JSON.stringify({ open: s.open, hidden: s.hidden, display: s.display }));

/* ② 工作区页：宿主返回 { ok, count, workspaces:[...] }，客户端必须容错取数组 */
await sleep(600);
s = await openPanel();
t('② 工作区页显示真实条数（共 2 个）', /共\s*2\s*个/.test(s.text), '正文=' + JSON.stringify(s.text.slice(0, 90)));
t('② 渲染出宿主返回的两个空间名', /回归空间A/.test(s.text) && /回归空间B/.test(s.text));
t('② 没有落到「宿主没返回任何工作区」降级文案', !/宿主没返回任何工作区/.test(s.text));
t('② 没有「形状不认识」降级文案', !/形状不认识|找不到工作区数组/.test(s.text));

/* ③ 面板内动作按钮：委托必须仍然有效（这是根因的直接回归）
   注意必须留在「工作区」页点它 —— 切到别的页这个按钮就不存在了 */
const beforeSort = (await state()).text;
await evaluate('window.__CLICKS = []');
const c3 = await realClick('#dshlg-cc [data-cc-act="sort"]');
t('③「排序」按钮：点击命中它自己（没被重定向到面板）', c3.ok && c3.reached === true, '命中=' + c3.hit);
info('排序点击的 click target：' + (await clicks()));
await sleep(400);
t('③ 点「排序」真的改变了界面（列表顺序翻转）', (await state()).text !== beforeSort);

/* ④ 分页切换：真实鼠标点「会话」 */
await evaluate('window.__CLICKS = []');
const c4 = await realClick('#dshlg-cc .cc-tabs button:nth-child(2)');
t('④「会话」页签：点击命中它自己', c4.ok && c4.reached === true, '命中=' + c4.hit);
info('页签点击的 click target：' + (await clicks()));
await sleep(500);
s = await state();
t('④ 页签真的切到「会话」', s.tab === '会话', '当前页签=' + s.tab);
t('④ 会话页渲染出宿主返回的会话', /回归会话标题/.test(s.text), '正文=' + JSON.stringify(s.text.slice(0, 90)));

/* ⑤ 系统页：health 的 services / degraded / carrier 都要显示出来 */
await evaluate('window.__CLICKS = []');
const c5sys = await realClick('#dshlg-cc .cc-tabs button:nth-child(4)');
t('⑤「系统」页签：点击命中它自己', c5sys.ok && c5sys.reached === true, '命中=' + c5sys.hit);
await sleep(700);
s = await state();
t('⑤ 页签真的切到「系统」', s.tab === '系统', '当前页签=' + s.tab);
t('⑤ 系统页显示服务清单', /服务/.test(s.text) && /workspaces/.test(s.text), '正文=' + JSON.stringify(s.text.slice(0, 120)));
t('⑤ 系统页显示「不可用服务」与「接口载体」', /不可用服务/.test(s.text) && /接口载体/.test(s.text) && /无/.test(s.text));
t('⑤ 系统页没有渲染成错误边界', !/这个分页出错了/.test(s.text));

/* ⑥ 关闭按钮 */
await evaluate('window.__CLICKS = []');
const c5 = await realClick('#dshlg-cc [data-cc-act="close"]');
t('⑥「关闭」按钮：点击命中它自己（没被重定向到面板）', c5.ok && c5.reached === true, '命中=' + c5.hit);
const c5targets = await clicks();
info('关闭点击的 click target：' + c5targets);
t('⑥ click 的 target 带着 [act=close]（= 走的是按钮，不是面板本身）', /act=close/.test(c5targets));
s = await state();
t('⑥ 点「关闭」后面板真的关掉', s.open === false && s.hidden === true && s.display === 'none',
  JSON.stringify({ open: s.open, hidden: s.hidden, display: s.display }));

/* ⑦ 还能再打开、再关闭（不是一次性的） */
s = await openPanel();
t('⑦ 关掉后还能重新打开', s.open === true);
s = await closePanel();
t('⑦ 再关一次仍然有效', s.hidden === true && s.display === 'none');

/* ⑧ 埋点：正常路径不该记录任何错误 */
const errTrap = await evaluate('JSON.stringify(window.__DSHLG_CC_ERR || null)');
info('window.__DSHLG_CC_ERR = ' + errTrap);
t('⑧ 全程没有控制中心内部异常（埋点 count=0）',
  errTrap === 'null' || (JSON.parse(errTrap).count === 0), String(errTrap));

console.log(bad ? `\n✗ 控制中心真实点击：${bad} 项不通过` : '\n✓ 控制中心真实点击：全部通过');
ws.close(); edge.kill(); server.close();
process.exit(bad ? 1 : 0);
