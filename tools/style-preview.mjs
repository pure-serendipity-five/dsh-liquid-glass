/* 材质预览台：把插件自制的几块面放在**真实壁纸**上截图，自己先看一遍再下结论。
 *
 * 为什么需要它：材质问题（深/透/字色）靠读 CSS 是判不出来的 ——
 * 本轮就栽过：**预览搭的结构不对，显示"已修好"，真机其实没变**。
 * 所以这里刻意照抄真身结构（DSH 的 portal、内部材质层、令牌），见文件里的 ⚠️ 注释。
 *
 * 用法：
 *   node tools/style-preview.mjs [壁纸png]        # 默认 preview/zen-courtyard.png
 *   LG_ALPHAS=0.72,0.82,0.9 node tools/style-preview.mjs   # 一次出多档对比图
 * 产物：preview-1..4-*.png（控制中心 / 设置面板 / DSH 设置浮层 / 浮层菜单）
 * 注意：这是**最小复现台**，不是 DSH 真机；只用来判材质。
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const EDGE = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync);
if (!EDGE) { console.error('找不到 msedge.exe'); process.exit(2); }

/* 插件根目录：默认取脚本上一级（tools/ 的父目录），可用 DSHLG_ROOT 覆盖。 */
const PLUGIN = process.env.DSHLG_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');
const WALL = process.argv[2] || join(PLUGIN, 'preview', 'zen-courtyard.png');
/* 截图输出目录：默认放系统临时目录 —— **不要写进仓库**（否则 git status 一堆 PNG）。
   想固定位置就设 DSHLG_OUT。 */
const OUT = process.env.DSHLG_OUT || join(tmpdir(), 'dshlg-preview');
mkdirSync(OUT, { recursive: true });
const PORT = 39413;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FAKE = {
  alive: { server: 'dsh-liquid-glass', version: 'test', features: ['wallpapers', 'control'], scenes: [] },
  wallpapers: { wallpapers: [{ id: 'local:zen', title: '宅邸禅院', kind: 'local', previewExt: '.png' }] },
  control: {
    health: { ok: true, version: 'test', services: { workspaces: true }, degraded: [], carrier: '39321' },
    workspaces: {
      ok: true, count: 2, currentCwd: 'D:\\Documents\\deepseek-harness\\default-workspace',
      workspaces: [
        { id: 'ws-a', name: 'AI应用', path: 'D:\\AI应用', sessionCount: 3, status: 'ok' },
        { id: 'ws-b', name: '默认工作区', path: 'D:\\Documents\\deepseek-harness\\default-workspace', isCurrent: true, sessionCount: 1, status: 'ok' },
      ],
    },
    'sessions/inspect': { ok: true, count: 1, sessions: [{ id: 's-1', severity: 'ok', title: '会话巡检示例' }] },
  },
};

const PAGE = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
 html,body{margin:0;height:100%;font:14px "Segoe UI",system-ui,"Microsoft YaHei",sans-serif;
   background:#111 url('/wall.png') center/cover no-repeat fixed; color:#e8eef8}
 #root{position:relative;z-index:1;height:100vh}
 .ZTP-Xa_frame{height:100vh;display:grid;grid-template-columns:280px minmax(400px,1fr) minmax(0,720px)}
 .ZTP-Xa_sidebarCol{overflow:hidden}
 .ZTP-Xa_centerCol{display:flex;flex-direction:column;overflow:hidden}
 .ZTP-Xa_rightbarCol{position:relative;overflow:visible}
 .LdcXKW_panel{position:absolute;top:0;bottom:0;right:0;display:flex;flex-direction:column;pointer-events:none}
 .LdcXKW_panel [data-dockkit-host]{transform:translateX(100%);visibility:hidden}
 .LdcXKW_panel[data-sidebar-right-open] [data-dockkit-host]{transform:none;visibility:visible}
 .dock{flex:1}
 .mock-composer{border-radius:14px;padding:10px}
 /* DSH 设置浮层的真身类名（从 app.asar 里挖出来的）：哈希 + 语义后缀 */
 :root { --dsw-radius-lg: 16px; --dsw-alias-bg-module-platform: #ffffff; }
 .y7bFDa_overlay{position:fixed;inset:0;display:none;z-index:50}
 .y7bFDa_overlay.is-on{display:block}
 .y7bFDa_panel{position:absolute;left:22%;top:12%;width:900px;height:620px;padding:18px;
   display:flex;flex-direction:column;gap:12px}
 .y7bFDa_header{display:flex;align-items:center;gap:10px;font-size:18px;font-weight:600}
 .y7bFDa_nav{display:flex;gap:16px;opacity:.85}
 .y7bFDa_content{font-size:14px;line-height:1.9}
 /* 模型页那张「添加模型提供商」卡的真身：background 吃 --dsw-alias-bg-module-platform。
    预览里必须照抄这一层，否则又会给出「已经修好了」的假信号（本项目踩过）。 */
 .e9d1Wa_editor{border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-module-platform);
   flex-direction:column;gap:14px;padding:14px 16px;display:flex;margin-top:10px}
 .e9d1Wa_tabs{display:flex;gap:8px;margin-bottom:6px}
 </style></head><body>
 <div id="root"><div class="ZTP-Xa_frame">
  <div class="ZTP-Xa_sidebarCol"><div class="n_2Q3W_root">
    <div class="n_2Q3W_logoRow"><span class="n_2Q3W_brand"><span class="n_2Q3W_brandIdentity"><span class="n_2Q3W_brandMark"><svg width="24" height="18" viewBox="0 0 23.16 17.04" fill="none" aria-hidden="true"><path d="M2 8 L20 8 L20 16 Z" fill="currentColor"/></svg></span><span class="n_2Q3W_brandName"><svg width="156" height="24" viewBox="26 0 156 24" fill="none" aria-hidden="true" data-dshlg-wordmark><path d="M68.4 18.2H67V16.1H68.4L80 6 L92 16 Z" fill="#ffffff"/></svg></span></span><button class="n_2Q3W_iconButton">+</button></span></div>
    <button class="n_2Q3W_sessionRow">会话一</button><button class="n_2Q3W_sessionRow">会话二</button>
  </div></div>
  <div class="ZTP-Xa_centerCol"><div style="flex:1"></div>
    <div class="mock-composer D_tfqW_composerSeat" data-composer-seat data-conversation-region><div contenteditable="true" style="min-height:36px;outline:none">壁纸透出来了吗</div></div>
  </div>
  <div class="ZTP-Xa_rightbarCol" data-rightbar-col>
    <div class="LdcXKW_panel" data-sidebar-right-session="s1" data-sidebar-right-panel="push" data-sidebar-right-open>
      <div data-dockkit-host="dock"><div class="dock" data-testid="dock"><button>↻</button></div></div>
    </div>
  </div>
 </div></div>
 <div class="y7bFDa_overlay" id="mock-settings"><div class="y7bFDa_panel">
   <div class="y7bFDa_header"><span>设置</span><span style="flex:1"></span><button>打开配置文件</button></div>
   <div class="y7bFDa_nav"><span>账号与余额</span><span>通用设置</span><span>模型</span><span>内置插件</span><span>Agent 预设</span></div>
   <div class="y7bFDa_content">
     枝星　182******50<br>充值余额　¥98.17<br>赠金余额　暂不可用赠金<br>
     <button>查询用量</button> <button style="background:#111;color:#fff">充值</button>
     <!-- 模型页那张卡（真身 .<hash>_editor + 令牌 --dsw-alias-bg-module-platform） -->
     <div class="e9d1Wa_editor">
       <div class="e9d1Wa_tabs"><button>第三方模型提供商</button><button>自定义模型 API</button></div>
       <div style="opacity:.8">从内置目录中选择 OpenAI、Anthropic、Kimi 等提供商，填入其 API 密钥即可使用。</div>
       <div>提供商</div>
       <select><option>amazon-bedrock</option></select>
       <div>API 密钥</div>
       <input type="text" placeholder="输入 API 密钥，或留空使用环境认证">
       <div style="display:flex;justify-content:flex-end;gap:8px"><button>取消</button><button>保存</button></div>
     </div>
   </div>
 </div></div>
 <script>
 window.__FAKE = ${JSON.stringify(FAKE)};
 const realFetch = window.fetch.bind(window);
 window.fetch = (input, init) => {
   const url = String(typeof input === 'string' ? input : ((input && input.url) || ''));
   const json = (o) => Promise.resolve(new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } }));
   if (/\\/__alive/.test(url)) return json(window.__FAKE.alive);
   if (/\\/__wallpapers/.test(url)) return json(window.__FAKE.wallpapers);
   const m = /\\/dshlg-control\\/(.+)$/.exec(url.split('?')[0]);
   if (m) return json(window.__FAKE.control[m[1]] || { ok: false, error: { code: 'not_found', message: 'x' } });
   return realFetch(input, init);
 };
 window.__ModuleLoader__ = { load(spec) {
   try { const m = spec.factory(); m.apply({ effect() {} }); window.__OK = true; }
   catch (e) { window.__ERR = String((e && e.stack) || e); }
 } };
 </script>
 <script src="/client.js"></script>
 </body></html>`;

const server = createServer((req, res) => {
  const u = (req.url || '/').split('?')[0];
  if (u === '/client.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(readFileSync(join(PLUGIN, 'client.js')));
    return;
  }
  if (u === '/wall.png') {
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
    res.end(readFileSync(WALL));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(PAGE);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const cdpPort = 9403;
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--window-size=1440,900',
  '--remote-debugging-port=' + cdpPort,
  '--user-data-dir=' + join(tmpdir(), 'edge-styleprev-' + Date.now()),
  '--force-device-scale-factor=1',
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
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) return { err: r.result.exceptionDetails.text };
  return r.result?.result?.value;
};
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const f = join(OUT, name);
  writeFileSync(f, Buffer.from(r.result.data, 'base64'));
  console.log('  截图 → ' + f);
};
async function realClick(sel) {
  const p = await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return {none:1};
    const r=e.getBoundingClientRect();if(!r.width)return {none:1};
    return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
  if (!p || p.none) { console.log('  ⚠ 点不到：' + sel); return false; }
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(40);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(300);
  return true;
}
await send('Page.enable'); await send('Runtime.enable');
for (let i = 0; i < 60; i += 1) { if (await ev('window.__OK===true||!!window.__ERR') === true) break; await sleep(250); }
await sleep(900);

console.log('=== 深色玻璃样式预览（壁纸：' + WALL + '）===');
console.log('err=' + JSON.stringify(await ev('window.__ERR || "无"')));

/* 在面板背后放几行「正文」，才能判「背景文字会不会穿透上来抢注意力」 */
await ev(`(()=>{const c=document.querySelector('.ZTP-Xa_centerCol');
  const d=document.createElement('div');
  d.style.cssText='position:absolute;left:16px;top:60px;width:760px;font:15px/2 system-ui;color:#eaf4ff;text-shadow:0 1px 2px #000';
  d.innerHTML='check the system tab renderer and land them:<br>修改了文件，已搜索代码，已读取文件<br>All 22 checks green (including the new system rows).<br>正在分析请求 —— 这一行是用来判「背景文字会不会穿透面板」的<br>把回归测试并入 test/ 并更新 HANDOFF.md';
  c.style.position='relative'; c.appendChild(d); return true;})()`);

/* 同一块面板扫几档 alpha，出一组对比图（用户要判「太透 / 太实」） */
const ALPHAS = (process.env.LG_ALPHAS || '0.72,0.82,0.90').split(',').map(Number);
await realClick('[data-role="control-center"]');
await sleep(800);
for (const a of ALPHAS) {
  await ev(`(()=>{let s=document.getElementById('alpha-override');
    if(!s){s=document.createElement('style');s.id='alpha-override';document.head.appendChild(s);}
    s.textContent="html body #dshlg-cc,html body #dshlg-settings,html body [class*='_overlay'] [class*='_panel']{background-color:rgba(10,14,20,${a}) !important;background-image:none !important;}";
    return true;})()`);
  await sleep(400);
  await shot('preview-alpha-' + String(a).replace('.', '') + '.png');
  console.log('  alpha=' + a + ' material = ' + await ev(`getComputedStyle(document.getElementById('dshlg-cc')).backgroundColor`));
}

await realClick('#dshlg-cc [data-cc-act="close"]');
await sleep(300);
await realClick('#dshlg-gear');
await sleep(800);
await shot('preview-2-settings.png');
console.log('  设置面板 material = ' + await ev(`(()=>{const p=document.getElementById('dshlg-settings');
  if(!p) return '(没打开)'; return getComputedStyle(p).backgroundColor;})()`));

/* DSH 官方设置浮层（真身类名 + 真身结构：overlay > mask + panel） */
await ev(`document.getElementById('dshlg-settings')?.setAttribute('hidden','')`);
await ev(`document.getElementById('mock-settings').classList.add('is-on')`);
await sleep(500);
await shot('preview-3-dsh-settings-overlay.png');
console.log('  DSH 浮层面板 material = ' + await ev(`(()=>{const p=document.querySelector('.y7bFDa_panel');
  const c=getComputedStyle(p); return c.backgroundColor+' / '+c.color;})()`));
/* 原生 <select> 的弹层底色改不动（浏览器画的），只能靠 color-scheme —— 量出来存证 */
console.log('  设置浮层 color-scheme = ' + await ev(`getComputedStyle(document.querySelector('.y7bFDa_panel')).colorScheme`));
console.log('  原生 select 的 color-scheme = ' + await ev(`(()=>{const s=document.querySelector('.y7bFDa_panel select');
  return s ? getComputedStyle(s).colorScheme + ' / option底色=' + getComputedStyle(s.querySelector('option')).backgroundColor : '(没有 select)';})()`));

/* ── 插件市场：先喂一份假清单（结构照抄社区清单 plugins.json 的真实形状）── */
await ev(`document.getElementById('mock-settings')?.classList.remove('is-on')`);
await ev(`(() => {
  const p = (o) => Object.assign({ owner:'', url:'', page:'', category:'ui', npm:null, version:null,
    stars:0, downloads:null, capabilities:[], capabilityRedLines:[], added:'2026-09-20' }, o);
  window.__MKT = { name:'awesome-dsh-plugin', count:6, updated:'2026-09-27',
    categories:{ ui:{zh:'UI 增强'}, dev:{zh:'开发与运行时'}, fun:{zh:'娱乐'} },
    plugins:[
      p({ name:'dsh-status-rotator', owner:'01Virex', url:'https://github.com/01Virex/dsh-status-rotator',
          page:'https://awesome-dsh-plugin.com/p/01Virex/dsh-status-rotator/', npm:'dsh-status-rotator',
          version:'0.27.4', stars:92, downloads:8006, capabilities:['fs-read','network'],
          install:'dsh plugin --profile web add dsh-status-rotator',
          description:{ zh:'把回合状态行换成 1059 条中英文案的轮播：打字机输出、流动彩虹渐变、弹幕、12 个可开关的主题词库包。' } }),
      p({ name:'dsh-better-sidebar', owner:'omdsh-dev', url:'https://github.com/omdsh-dev/DSH-better-sidebar',
          page:'https://awesome-dsh-plugin.com/p/omdsh-dev/DSH-better-sidebar/', npm:'dsh-better-sidebar',
          version:'0.21.1', stars:41, downloads:3120, capabilities:['fs-write','fs-read'],
          install:'dsh plugin --profile web add dsh-better-sidebar',
          description:{ zh:'侧栏增强：文件树、编辑器、变更、任务与会话内聊天合成一列，每个会话各自独立。' } }),
      p({ name:'dsh-screen-translator', owner:'mustakimabdullah25-tech',
          url:'https://github.com/mustakimabdullah25-tech/dsh-screen-translator', category:'ui',
          npm:'dsh-screen-translator', version:'3.0.3', stars:18, downloads:2044, capabilities:['network'],
          install:'dsh plugin --profile web add dsh-screen-translator',
          description:{ zh:'屏幕取词翻译：界面文字、属性、Shadow DOM 与 iframe 全覆盖，45+ 语言。' } }),
      p({ name:'dsh-quick-open', owner:'asxiuxiu', url:'https://github.com/asxiuxiu/dsh-quick-open',
          category:'dev', npm:'dsh-quick-open', version:'0.3.0', stars:0, downloads:592,
          capabilities:['fs-write','fs-read','network'], install:'dsh plugin --profile web add dsh-quick-open',
          description:{ zh:'Ctrl+P 快速打开：给会话工作区建内存索引，5.1 万条目、查询中位数 5ms。' } }),
      p({ name:'dsh-WallpaperAndCost', owner:'AppliedYuu', url:'https://github.com/AppliedYuu/dsh-WallpaperAndCost',
          page:'https://awesome-dsh-plugin.com/p/AppliedYuu/dsh-WallpaperAndCost/', category:'fun',
          stars:3, capabilities:['credentials','network'],
          capabilityRedLines:['reads credentials/secrets AND has network access'],
          install:'dsh plugin --profile web add github:AppliedYuu/dsh-WallpaperAndCost',
          description:{ zh:'壁纸定制＋Steam 创意工坊壁纸提取＋余额用量小组件。API key 由 host 从凭据库读取，不入源码。' } }),
      p({ name:'dsh-linghun', owner:'syyr1987', url:'https://github.com/syyr1987/dsh-linghun', category:'fun',
          npm:'dsh-linghun', version:'0.2.0', stars:2, downloads:416, capabilities:['fs-write','fs-read'],
          install:'dsh plugin --profile web add dsh-linghun',
          description:{ zh:'判断内核：认知循环让判断有来处，海马体把运行经历沉淀为可复用知识，人格卡可自定义。' } }),
    ] };
  const real = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = String(typeof input === 'string' ? input : ((input && input.url) || ''));
    if (/awesome-dsh-plugin\\.com\\/plugins\\.json/.test(url)) {
      return Promise.resolve(new Response(JSON.stringify(window.__MKT),
        { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    /* 第二条来源（自己仓库里的补充清单）也要拦 —— 不拦就会走真网络，
       预览会卡在「正在加载」，看起来像功能坏了（踩过一次）。 */
    if (/raw\\.githubusercontent\\.com.*market\\/index\\.json/.test(url)) {
      return Promise.resolve(new Response(JSON.stringify({ plugins: [] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    return real(input, init);
  };
  return true;
})()`);

await realClick('[data-role="control-center"]');            // 重新打开控制中心
await sleep(600);
await realClick('#dshlg-cc .cc-tabs button:nth-child(3)');   // 「插件」页签
await sleep(500);
await shot('preview-5-market-empty.png');                    // 首次进入：先给「加载清单」按钮
await realClick('#dshlg-cc [data-cc-act="mk-load"]');
await sleep(1000);
await shot('preview-6-market.png');                          // 清单加载后的市场
console.log('  市场正文：' + await ev(`(()=>{const b=document.querySelector('#dshlg-cc .cc-body');
  return (b?b.textContent:'').slice(0, 100);})()`));
await realClick('#dshlg-cc [data-cc-act="close"]');
await sleep(300);

/* 浮层菜单（头像菜单：设置 / 意见反馈 / 退出登录）。
   ⚠️ 两处必须照抄真身，否则预览会骗人：
     ① 菜单是 portal 到 **body** 的（不在 #root 里）；
     ② 真正的底色画在**内部 .material 层**（z-index:-1，用令牌 --dsw-menu-surface-fill），
        不是在 [data-menu-material] 元素上。 */
await ev(`(()=>{
  /* 模拟 DSH 浅色主题的菜单令牌：58% 近白 —— 就是那块「灰实底」的来源 */
  document.documentElement.style.setProperty('--dsw-menu-surface-fill','rgba(248,249,250,0.58)');
  const m=document.createElement('div'); m.id='mock-menu';
  m.setAttribute('data-menu-material','translucent');
  m.style.cssText='position:fixed;left:24px;bottom:150px;width:290px;padding:8px;border-radius:12px;font:14px system-ui;isolation:isolate';
  m.innerHTML='<div role="menuitem" style="padding:8px 10px;border-radius:8px">设置 <span style="float:right;opacity:.6">Ctrl+,</span></div>'
    +'<div role="menuitem" style="padding:8px 10px;border-radius:8px">意见反馈</div>'
    +'<div role="menuitem" style="padding:8px 10px;border-radius:8px">退出登录</div>';
  const mat=document.createElement('div');
  mat.style.cssText='position:absolute;inset:0;z-index:-1;border-radius:inherit;pointer-events:none;'
    +'background:var(--dsw-menu-surface-fill);backdrop-filter:blur(40px) saturate(150%)';
  m.appendChild(mat);
  document.body.appendChild(m); return true;})()`);
await sleep(450);
await shot('preview-4-menu.png');
console.log('  浮层菜单 material = ' + await ev(`(()=>{const m=document.getElementById('mock-menu');
  const c=getComputedStyle(m); return c.backgroundColor+' / '+c.color;})()`));
console.log('  菜单项字色 = ' + await ev(`getComputedStyle(document.querySelector('#mock-menu [role=menuitem]')).color`));

ws.close(); edge.kill(); server.close();
process.exit(0);
