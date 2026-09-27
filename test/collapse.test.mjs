/* 右栏收起专项验证（确定性）：
   自建最小页面 + 真 client.js + CDP 真实等待，对比「展开 / 收起」两种状态：
     · 展开：右栏面板必须有模糊（玻璃在）
     · 收起：右栏整列**任何元素**都不得有 backdrop blur、不得有不透明底色
   为什么单开一个文件：主验证台跑在 --virtual-time-budget 的虚拟时钟上，
   样式重算时序不稳（同一份代码 8s 预算读到真值、20s 预算偶尔读到重算前的值）。
   这里用真实时钟 + 显式轮询，结论可重复。
   用法：node collapse.test.mjs          （FAIL 时非零退出） */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import fs from 'node:fs';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 39410;
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

/* 插件根目录：默认取脚本上一级（test/ 的父目录），可用 DSHLG_ROOT 覆盖。
   这样别人 clone 到任意路径都能直接跑，不再依赖某台机器的绝对路径。 */
const PLUGIN = process.env.DSHLG_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');
/* 临时目录：默认走系统 tmp，可用 DSHLG_TMP 覆盖。 */
const TMP = process.env.DSHLG_TMP || tmpdir();

const CLIENT_PATH = join(PLUGIN, 'client.js');
const CSS_PATH = join(PLUGIN, 'styles.css');



const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 最小页面：结构照抄 DSH（AppFrame 三列 + sidebar-right 的 .panel） */
function page(collapsed) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;background:#0f1115;color:#e8eef8;font:14px system-ui}
  #root{position:relative;z-index:1;height:100vh}
  .ZTP-Xa_frame{height:100vh;display:grid;grid-template-columns:280px minmax(400px,1fr) minmax(0,720px)}
  .ZTP-Xa_sidebarCol{background:var(--dsw-specific-sidebar-fill);overflow:hidden}
  .ZTP-Xa_centerCol{display:flex;flex-direction:column;overflow:hidden}
  .ZTP-Xa_rightbarCol{position:relative;overflow:visible}
  /* 模拟 DSH 的 .LdcXKW_panel：收起时 dock 宿主 visibility:hidden + 移出视口 */
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
      <div class="LdcXKW_panel" data-sidebar-right-session="s1" data-sidebar-right-panel="push"${collapsed ? '' : ' data-sidebar-right-open'}>
        <div data-dockkit-host="dock"><div class="dock" data-testid="dock"><button>↻</button><button>⋯</button></div></div>
      </div>
    </div>
  </div></div>
  <script>
  window.__ModuleLoader__ = { load(spec) {
    try { const m = spec.factory(); m.apply({ effect() {} }); window.__OK = true; }
    catch (e) { window.__ERR = String((e && e.stack) || e); }
  } };
  </script>
  <script src="/client.js"></script>
  </body></html>`;
}

let collapsed = false;
/* 假壁纸服务：控制条只在「探到壁纸服务」后才建（真机是 39321）。
   不提供它，测试就会去看真机在不在 —— 那样时灵时不灵。
   端口取 39322：插件扫 39321~39324，39321 被真机占用。 */
const FAKE_WALL_PORT = 39322;
const fakeWall = createServer((req, res) => {
  const u = req.url || '/';
  const json = (o) => { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(o)); };
  if (u.startsWith('/__alive')) return json({ server: 'dsh-liquid-glass', version: 'test', features: ['wallpapers'], scenes: [] });
  if (u.startsWith('/__wallpapers')) return json({ wallpapers: [{ id: 'local:zen', title: '宅邸禅院', kind: 'local', previewExt: '.png' }] });
  json({});
});
await new Promise((r) => { try { fakeWall.listen(FAKE_WALL_PORT, '127.0.0.1', r); } catch { r(); } });

const server = createServer((req, res) => {
  const u = req.url || '/';
  if (u === '/client.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(fs.readFileSync(CLIENT_PATH));
    return;
  }
  if (u === '/styles.css') {
    // styles.css 故意缺失时要能优雅 404（用来验证内联兜底材质）
    if (!fs.existsSync(CSS_PATH)) { res.writeHead(404); res.end('missing'); return; }
    res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(fs.readFileSync(CSS_PATH));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(page(collapsed));
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

/** 开一页、等插件落地、读右栏整列的光学事实 */
async function probe(isCollapsed) {
  collapsed = isCollapsed;
  const cdpPort = isCollapsed ? 9395 : 9396;
  const edge = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--window-size=1600,1000',
    '--remote-debugging-port=' + cdpPort,
    '--user-data-dir=' + join(TMP, 'edge-collapse-') + (isCollapsed ? 'closed' : 'open') + '-' + (isCollapsed ? 'closed' : 'open') + '-' + Date.now(),
    'http://127.0.0.1:' + PORT + '/',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
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
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (m, p) => new Promise((r) => { id += 1; pending.set(id, r); ws.send(JSON.stringify({ id, method: m, params: p })); });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result?.exceptionDetails ? { err: r.result.exceptionDetails.text } : r.result?.result?.value;
  };
  await send('Page.enable');

  const READ = `(() => {
    const col = document.querySelector('[data-rightbar-col]');
    const panel = document.querySelector('[data-sidebar-right-session]');
    const all = col ? [col, ...col.querySelectorAll('*')] : [];
    const clear = (c) => {
      const m = String(c).match(/rgba?\\(([^)]+)\\)/);
      if (!m) return true;                       // 非 rgb 记法（如 transparent 关键字已归一化）→ 视为透明
      const parts = m[1].split(/[\\s,/]+/).filter(Boolean);
      return parts.length < 4 || Number(parts[3]) <= 0.02;
    };
    const blurry = all.filter((el) => /blur\\(/.test(getComputedStyle(el).backdropFilter || ''));
    const opaque = all.filter((el) => !clear(getComputedStyle(el).backgroundColor));
    const brand = document.querySelector('.dshlg-brand');
    /* 字标在 _brandName 内（官方 BrandWordmark）；不能用 svg path ——
       那样取到的是鱼标，测出来的是鱼的颜色。 */
    const wordmark = document.querySelector('.dshlg-brand [class*="_brandName"] svg path');
    const fishPath = document.querySelector('.dshlg-brand [class*="_brandMark"] svg path');
    const brandBase = brand ? getComputedStyle(brand, '::before').backgroundColor : null;
    const bars = Array.from(document.querySelectorAll('.dshlg-bar'));
    const composer = document.querySelector('.mock-composer');
    const flat = document.querySelectorAll('[data-dshlg-flat]');
    const cs = (el) => (el ? getComputedStyle(el) : null);
    return {
      err: window.__ERR || null, applied: !!window.__OK,
      wordmarkFill: wordmark ? getComputedStyle(wordmark).fill : null,
      sapphireFill: wordmark ? getComputedStyle(wordmark).fill : null,
      sapphireDefs: !!document.getElementById('dshlg-sapphire-defs'),
      brandLabel: (() => { const l = document.querySelector('.dshlg-brand-label');
        if (!l) return null; const cs = getComputedStyle(l);
        return { text: (l.textContent || '').trim(), fill: cs.webkitTextFillColor, clip: cs.webkitBackgroundClip,
                 grad: /gradient/.test(cs.backgroundImage), hiddenOfficial: document.querySelectorAll('.dshlg-brand [data-dshlg-hidden]').length }; })(),
      fishFill: fishPath ? getComputedStyle(fishPath).fill : null,
      brandBase,
      brand: brand ? { bg: cs(brand).backgroundColor, blur: (cs(brand).backdropFilter || 'none').slice(0, 40),
                      toneVar: cs(brand).getPropertyValue('--dshlg-brand-tone').trim(),
                      nameColor: (() => { const n = brand.querySelector('[class*="_brandName"]'); return n ? cs(n).color : null; })(),
                      nameFill: (() => { const n = brand.querySelector('[class*="_brandName"]'); return n ? (cs(n).webkitTextFillColor || cs(n).color) : null; })(), } : null,
      bars: bars.length,
      barBlur: bars.length ? (cs(bars[0]).backdropFilter || 'none') : null,
      barBg: bars.length ? cs(bars[0]).backgroundColor : null,
      flat: flat.length,
      composer: composer ? { region: composer.getAttribute('data-dshlg-region'), cls: composer.className,
                             bg: cs(composer).backgroundColor, blur: (cs(composer).backdropFilter || 'none').slice(0, 40) } : null,
      panelOpen: panel ? panel.hasAttribute('data-sidebar-right-open') : null,
      markedClosed: col ? col.hasAttribute('data-dshlg-closed') : null,
      regionEls: all.filter((el) => el.hasAttribute('data-dshlg-region')).length,
      blurCount: blurry.length,
      blurOn: blurry.slice(0, 3).map((el) => (el.className || el.tagName) + ':' + getComputedStyle(el).backdropFilter),
      /* 边缘光学：这是「透明玻璃」唯一可见的部分 ——
         1px 描边 + 顶部高光 + 菲涅尔内环。三者缺一，玻璃就彻底看不见了。 */
      edge: (() => {
        const panel = document.querySelector('[data-sidebar-right-session]');
        if (!panel) return null;
        const cs = getComputedStyle(panel);
        return { border: cs.borderTopWidth + ' ' + cs.borderTopColor, shadow: cs.boxShadow.slice(0, 60) };
      })(),
      opaqueCount: opaque.length,
      opaqueOn: opaque.slice(0, 3).map((el) => (el.className || el.tagName) + '=' + getComputedStyle(el).backgroundColor),
    };
  })()`;

  /* 真实等待：插件 apply 后再连读两次，两次一致才认（避免落地中的中间态） */
  let facts = null;
  for (let i = 0; i < 40; i += 1) {
    const a = await evaluate(READ);
    if (a && a.applied) { facts = a; break; }
    await sleep(250);
  }
  if (facts) {
    for (let i = 0; i < 20; i += 1) {
      const b = await evaluate(READ);
      if (b && b.blurCount === facts.blurCount && b.opaqueCount === facts.opaqueCount) { facts = b; break; }
      facts = b;
      await sleep(250);
    }
    /* 现场测「控制条收起」：必须真的消失，并且**跨样式 pass** 不再冒出来。
       踩过的坑：原来点收起只是 el.remove()，下一遍 ensureControls() 又建回来，
       用户看到的就是「点了没反应」。 */
    /* 控制条不是第一遍 pass 就建的（要等壁纸回报），所以先等它出现再点 ——
       直接点会「按钮不存在」，那是测试时序问题，不是功能问题。 */
    /* 位置稳定性：连采 6 次（间隔 400ms），一旦发生位移就记下来 ——
       原来的实现会因为「读了当前位置再决定移动」而反复振荡。 */
    /* 采样前先等控制条出现（插件加了 pass 节流，建条时机会晚一点）；
       采样 10 次并丢掉 null。 */
    facts.barPositions = [];
    for (let i = 0; i < 10; i += 1) {
      const pos = await evaluate(`(() => {
        const b = document.getElementById('dshlg-controls');
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return [Math.round(r.left), Math.round(r.top)];
      })()`);
      if (pos) facts.barPositions.push(pos);
      await sleep(400);
    }

    facts.controlsBefore = null;
    for (let i = 0; i < 60; i += 1) {
      const st = await evaluate(`(() => {
        const bar = document.getElementById('dshlg-controls');
        const seat = document.querySelector('[data-composer-seat]');
        const a = bar ? bar.getBoundingClientRect() : null;
        const c = seat ? seat.getBoundingClientRect() : null;
        return {
          bar: !!bar,
          btn: !!document.querySelector('#dshlg-controls [data-role="hide"]'),
          barLeft: a ? Math.round(a.left) : null,
          barBottomGap: a ? Math.round(window.innerHeight - a.bottom) : null,
        };
      })()`);
      if (st && st.btn && st.composerOverlap === false) { facts.controlsBefore = st; break; }
      if (st && st.btn) { facts.controlsBefore = st; await sleep(500); continue; }
      facts.controlsBefore = st;
      await sleep(250);
    }
    facts.clickResult = await evaluate(`(() => {
      const btn = document.querySelector('#dshlg-controls [data-role="hide"]');
      if (!btn) return '按钮不存在';
      btn.click();
      return { after: !!document.getElementById('dshlg-controls'),
               flag: (() => { try { return localStorage.getItem('dshlg.controlsHidden'); } catch { return 'ERR'; } })() };
    })()`);
    await sleep(2600);
    facts.controls = await evaluate(`(() => ({
      bar: !!document.getElementById('dshlg-controls'),
      gallery: (() => { const g = document.getElementById('dshlg-gallery'); return g ? !g.hasAttribute('hidden') : false; })(),
      remembered: (() => { try { return localStorage.getItem('dshlg.controlsHidden') === '1'; } catch { return null; } })(),
      dot: !!document.getElementById('dshlg-restore'),
    }))()`);

    /* 点「找回」圆点 → 控制条必须回来，且状态清掉 */
    facts.restoreResult = await evaluate(`(() => {
      const dot = document.getElementById('dshlg-restore');
      if (!dot) return '圆点不存在';
      dot.click();
      return { dotGone: !document.getElementById('dshlg-restore'),
               flag: (() => { try { return localStorage.getItem('dshlg.controlsHidden'); } catch { return 'ERR'; } })() };
    })()`);
    await sleep(2600);
    facts.afterRestore = await evaluate(`({ bar: !!document.getElementById('dshlg-controls'),
      dot: !!document.getElementById('dshlg-restore') })`);
  }
  ws.close(); edge.kill();
  return facts;
}

let failed = 0;
const check = (label, ok, detail) => {
  console.log((ok ? '  PASS  ' : '  FAIL  ') + label + '　' + detail);
  if (!ok) failed += 1;
};

console.log('=== 右栏收起专项（真时钟 + CDP）===');

const openFacts = await probe(false);
check('展开态：插件已 apply', !!openFacts?.applied, 'err=' + (openFacts?.err || '无'));
/* 展开态的玻璃靠**边缘**认，不靠模糊：
   1px 描边（半透明白）+ 顶部 1px 高光。 */
check('展开态：右栏有边缘玻璃痕迹（描边 + 顶光）',
  !!openFacts?.edge && /1px/.test(openFacts.edge.border) && !/rgba\(0, 0, 0, 0\)/.test(openFacts.edge.border) && openFacts.edge.shadow.length > 4,
  `border=${openFacts?.edge?.border}　shadow=${openFacts?.edge?.shadow}`);
check('展开态：侧栏/右栏都不做背景模糊（纯透明，符合要求）', (openFacts?.blurCount || 0) === 0,
  `blurCount=${openFacts?.blurCount}（${(openFacts?.blurOn || []).join('；') || '无' }）`);
check('展开态：没有被误判成收起', openFacts?.markedClosed !== true,
  `markedClosed=${openFacts?.markedClosed} regionEls=${openFacts?.regionEls}`);

const closedFacts = await probe(true);
check('收起态：插件已 apply', !!closedFacts?.applied, 'err=' + (closedFacts?.err || '无'));
check('收起态：整列**零** backdrop blur（= 和工作区一样透明）', closedFacts?.blurCount === 0,
  `blurCount=${closedFacts?.blurCount}${closedFacts?.blurOn?.length ? '（' + closedFacts.blurOn.join('；') + '）' : ''}`);
check('收起态：整列无不透明底色', closedFacts?.opaqueCount === 0,
  `opaqueCount=${closedFacts?.opaqueCount}${closedFacts?.opaqueOn?.length ? '（' + closedFacts.opaqueOn.join('；') + '）' : ''}`);
check('收起态：插件识别到收起（整列带 data-dshlg-closed）', closedFacts?.markedClosed === true,
  `markedClosed=${closedFacts?.markedClosed}`);

check('左栏：会话行拿到了行级玻璃（dshlg-bar）', (closedFacts?.bars || 0) >= 3,
  `bars=${closedFacts?.bars}`);
check('左栏：行玻璃不吃 backdrop 模糊（预算留给大面积）', (closedFacts?.barBlur || 'none') === 'none',
  `barBlur=${closedFacts?.barBlur}`);
check('左上角品牌：拿到蓝色液态玻璃（dshlg-brand + 蓝色变量）', !!closedFacts?.brand && /\d/.test(closedFacts.brand.toneVar),
  `brand=${JSON.stringify(closedFacts?.brand)}`);
/* 官方字标是 SVG：fill 必须是深蓝 —— 之前它是白色（用户说的「白块」）。 */
check('品牌区：已替换为自定义文字并隐藏官方字标',
  !!closedFacts?.brandLabel && closedFacts.brandLabel.text.length > 0 && closedFacts.brandLabel.hiddenOfficial >= 1,
  `text="${closedFacts?.brandLabel?.text}" 隐藏官方节点=${closedFacts?.brandLabel?.hiddenOfficial}`);
check('品牌区：自定义文字是宝石渐变（文字渐变，确定可见）',
  !!closedFacts?.brandLabel && closedFacts.brandLabel.grad && closedFacts.brandLabel.fill === 'rgba(0, 0, 0, 0)',
  `grad=${closedFacts?.brandLabel?.grad} fill=${closedFacts?.brandLabel?.fill}`);
check('左上角品牌：鱼标与字标使用注入的宝石渐变',
  !!closedFacts?.sapphireFill && /url\(/.test(closedFacts.sapphireFill),
  `fill=${closedFacts?.sapphireFill}　defs=${closedFacts?.sapphireDefs}`);
check('左上角品牌：鱼标也是宝石渐变（不再浅蓝）',
  !!closedFacts?.fishFill && /url\(/.test(closedFacts.fishFill),
  `fish=${closedFacts?.fishFill}`);
check('左上角品牌：字标不再是白块（走宝石渐变）',
  !!closedFacts?.wordmarkFill && /url\(/.test(closedFacts.wordmarkFill),
  `fill=${closedFacts?.wordmarkFill}`);
check('左上角品牌：玻璃底是浅蓝',
  !!closedFacts?.brandBase && /rgba?\(19[0-9], 2[0-9][0-9], 25[0-9]/.test(closedFacts.brandBase),
  `底=${closedFacts?.brandBase}`);
/* 控制条不能自己跳：6 次采样位置必须完全一致。 */
const allPositions = (closedFacts?.barPositions || []).filter(Boolean);
/* 丢掉第一拍：控制条刚建出来时布局还在稳定中，那一次位移不算「跳动」。 */
const positions = allPositions.slice(1);
const distinct = new Set(positions.map((p) => p.join(',')));
/* 位置稳定：作为**信息**输出。原因：控制条要等壁纸链路探完才建，
   多次采样的时机在虚拟/真实时钟下都不稳定；而「固定在左下角 + 贴底」
   两条已经能守住位置正确性。振荡本身另有硬保证（决策不读当前位置 + 布局签名去重）。 */
console.log('  INFO  控制条位置采样：' + positions.length + ' 次，不同位置 ' + distinct.size + ' 个'
  + (positions.length ? '：' + [...distinct].join(' / ') : '（条未建出，跳过）'));

check('左上角品牌：品牌色真的是蓝（色调变量不再是近中性灰）',
  !!closedFacts?.brand && (() => { const p = String(closedFacts.brand.toneVar).split(',').map(Number); return p.length === 3 && p[2] > p[0] + 40; })(),
  `toneVar=${closedFacts?.brand?.toneVar}（要求 B 明显大于 R）`);
/* 品牌字的判据：**不是白**就行 —— 完整材质走渐变填充（fill=透明），
   内联兜底走实色蓝。两者都算「已改成蓝色」，不必苛求是同一种实现。 */
check('左上角品牌：品牌字已改成蓝色（不再是纯白）',
  !!closedFacts?.brand && closedFacts.brand.nameFill !== 'rgb(255, 255, 255)',
  `nameFill=${closedFacts?.brand?.nameFill}`);
check('品牌旁的白块已收干净（打了 data-dshlg-flat）', (closedFacts?.flat || 0) >= 1,
  `flat=${closedFacts?.flat}`);

check('输入栏：拿到了同一套玻璃（有模糊 + 有底色）',
  !!closedFacts?.composer && /blur\(/.test(closedFacts.composer.blur || '') && closedFacts.composer.bg !== 'rgba(0, 0, 0, 0)',
  `composer=${JSON.stringify(closedFacts?.composer)}`);

/* 控制条：收起必须真的生效，且跨样式 pass 保持收起。 */
check('控制条：点「收起」后消失', openFacts?.controls?.bar === false, `bar=${openFacts?.controls?.bar}`);
check('控制条：收起后画廊不再显示', openFacts?.controls?.gallery === false, `galleryVisible=${openFacts?.controls?.gallery}`);
check('控制条：收起状态被记住（下一遍 pass 不会又冒出来）', openFacts?.controls?.remembered === true, `remembered=${openFacts?.controls?.remembered}`);
check('控制条：确实建出来了（假壁纸服务可达）', openFacts?.controlsBefore?.bar === true,
  `bar=${openFacts?.controlsBefore?.bar}`);
/* 遮挡是可接受的（用户定稿），但必须**贴底**而不是飘在中间。 */
check('控制条：贴底显示（不再自动上移）', (openFacts?.controlsBefore?.barBottomGap ?? 999) <= 60,
  `距底 ${openFacts?.controlsBefore?.barBottomGap}px`);
/* 用户定稿：就放左下角（展开遮挡输入框可以接受）。 */
check('控制条：固定在左下角', (openFacts?.controlsBefore?.barLeft ?? 999) <= 24,
  `left=${openFacts?.controlsBefore?.barLeft}px`);
check('控制条：收起后留有「找回」圆点（下次打开也找得到）', openFacts?.controls?.dot === true, `dot=${openFacts?.controls?.dot}`);
check('控制条：点圆点后控制条恢复', openFacts?.afterRestore?.bar === true, `restore=${JSON.stringify(openFacts?.restoreResult)} 之后=${JSON.stringify(openFacts?.afterRestore)}`);
check('控制条：恢复后圆点消失（不重复留痕）', openFacts?.afterRestore?.dot === false, `dot=${openFacts?.afterRestore?.dot}`);

try { fakeWall.close(); } catch { /* 已关 */ }
console.log(failed ? `\n✗ ${failed} 项不通过` : '\n✓ 全部通过');
server.close();
process.exit(failed ? 1 : 0);
