/* DSH 液态玻璃 · 诊断脚本
 *
 * 目的：拿到**真实界面**上的事实，而不是靠猜 ——
 *   ① 插件的样式表/标记有没有挂上
 *   ② 左侧栏、输入栏、品牌区分别命中了哪些选择器（以及为什么没命中）
 *   ③ 把「所有候选元素」的几何与属性列出来，便于对照 DSH 的真实结构
 *
 * 用法（由 诊断-双击运行.bat 调用，也可以手敲）：
 *   node diagnose.mjs
 * 前置：DSH 以 --remote-debugging-port=9333 启动。
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 9333;
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'dsh-liquid-glass-diagnose.json');

const PROBE = `(() => {
  const q = (sel) => document.querySelector(sel);
  const rows = (sel) => Array.from(document.querySelectorAll(sel));
  const brief = (el) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      cls: String(el.className || '').slice(0, 90),
      attrs: el.getAttributeNames().filter((n) => n.startsWith('data-')),
      rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      bg: cs.backgroundColor,
      bgImage: cs.backgroundImage.slice(0, 60),
      blur: (cs.backdropFilter || 'none').slice(0, 46),
      alphaVar: cs.getPropertyValue('--dshlg-alpha').trim(),
      text: (el.textContent || '').trim().slice(0, 40),
    };
  };
  const styles = rows('style, link[rel=stylesheet]').map((el) => ({
    id: el.id || null,
    role: el.dataset ? (el.dataset.dshlgRole || null) : null,
    len: (el.textContent || '').length || (el.href ? 'link' : 0),
  }));

  /* 宿主注入的模块图清单 */
  const boot = (() => {
    try {
      const b = window.__DSH_BOOT__;
      if (!b) return { present: false };
      const text = JSON.stringify(b);
      const rows = [];
      const walk = (v) => {
        if (typeof v === 'string') { if (v.includes('client.js') || v.includes('plugins/')) rows.push(v); return; }
        if (Array.isArray(v)) { v.forEach(walk); return; }
        if (v && typeof v === 'object') { for (const k of Object.keys(v)) walk(v[k]); }
      };
      walk(b);
      return {
        present: true,
        mentionsLiquidGlass: text.includes('liquid-glass'),
        rowsSample: Array.from(new Set(rows)).slice(0, 40),
      };
    } catch (e) { return { present: false, error: String(e && e.message) }; }
  })();

  return {
    url: location.href,
    boot,
    viewport: [window.innerWidth, window.innerHeight],
    plugin: {
      styleTags: styles.filter((s) => s.id && s.id.startsWith('dshlg')),
      critical: !!q('#dshlg-critical'),
      dynamic: !!q('#dshlg-style'),
      external: !!q('#dshlg-stylesheet'),
      svgFilter: !!q('#dshlg-svg'),
      mask: !!q('#dshlg-refract-edge'),
      controls: !!q('#dshlg-controls'),
      gallery: !!q('#dshlg-gallery'),
      err: window.__DSHLG_ERR || null,
      /* 三个层次的证据：文件送到没有 / factory 跑没跑 / apply 跑没跑 */
      scriptLoaded: window.__DSHLG_LOAD__ || null,
      factoryRuns: window.__DSHLG_FACTORY__ || 0,
      applyDone: !!document.getElementById('dshlg-critical'),
    },
    // 品牌蓝变量有没有写到 :root
    brandVars: ['--dshlg-brand-tone', '--dshlg-brand-a', '--dshlg-brand-filter']
      .map((k) => k + '=' + getComputedStyle(document.documentElement).getPropertyValue(k).trim()),
    // 插件的标记
    tagged: rows('[data-dshlg-region], .dshlg-bar, .dshlg-brand').map(brief),
    bare: rows('[data-dshlg-flat]').length,
    /* 品牌区专项：逐层采集（行 / 文字 / 图标 / 伪元素），
       用来判断「蓝色玻璃」到底渲染出来没有。 */
    brandDetail: (() => {
      const row = q('.dshlg-brand');
      if (!row) return { marked: false };
      const cs = getComputedStyle(row);
      const name = row.querySelector('[class*="_brandName"], [class*="_fallbackBrandName"]');
      const mark = row.querySelector('[class*="_brandMark"]');
      const csName = name ? getComputedStyle(name) : null;
      const csMark = mark ? getComputedStyle(mark) : null;
      const before = getComputedStyle(row, '::before');
      const after = getComputedStyle(row, '::after');
      const svg = row.querySelector('svg');
      return {
        marked: true,
        row: {
          rect: (() => { const r = row.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; })(),
          bg: cs.backgroundColor,
          bgImage: cs.backgroundImage.slice(0, 70),
          border: cs.borderTopWidth + ' ' + cs.borderTopColor,
          borderRadius: cs.borderTopLeftRadius,
          boxShadow: cs.boxShadow.slice(0, 80),
          blur: (cs.backdropFilter || 'none').slice(0, 40),
          opacity: cs.opacity,
          display: cs.display,
          ariaHidden: row.getAttribute('aria-hidden'),
        },
        name: name ? {
          cls: String(name.className).slice(0, 40),
          color: csName.color,
          webkitFill: csName.webkitTextFillColor || null,
          bgImage: csName.backgroundImage.slice(0, 70),
          clip: csName.webkitBackgroundClip || csName.backgroundClip || null,
          text: (name.textContent || '').trim().slice(0, 30),
        } : null,
        mark: mark ? {
          cls: String(mark.className).slice(0, 40),
          color: csMark.color,
          filter: csMark.filter.slice(0, 60),
          size: (() => { const r = mark.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })(),
        } : null,
        svg: svg ? { color: getComputedStyle(svg).color, fill: getComputedStyle(svg).fill, w: Math.round(svg.getBoundingClientRect().width) } : null,
        pseudo: { before: before.content + ' | ' + before.backgroundImage.slice(0, 40), after: after.content },
      };
    })(),
    // 关键候选：DSH 真实类名
    hooks: {
      logoRow: brief(q('[class*="_logoRow"]')),
      brandMark: brief(q('[class*="_brandMark"]')),
      brandName: brief(q('[class*="_brandName"]')),
      brandIdentity: brief(q('[class*="_brandIdentity"]')),
      sidebarRoot: brief(q('[class*="_logoRow"]')?.closest('[class*="_root"]') || null),
      sidebarCol: brief(q('[class^="ZTP-Xa_sidebarCol"], [class*=" sidebarCol"], [class*="ZTP-Xa_sidebarCol"]')),
      rightbarCol: brief(q('[data-rightbar-col]')),
      rightPanel: brief(q('[data-sidebar-right-session]')),
      editor: brief(q('[contenteditable="true"], [contenteditable=""], textarea')),
      composer: brief(q('[class*="_composer"]')),
      inputArea: brief(q('[class*="_input"]')),
    },
    // 所有「疑似会话行」的候选（左栏里 20~80px 高的可点元素）
    rowCandidates: (() => {
      const col = q('[class*="_logoRow"]')?.closest('[class*="_root"]');
      if (!col) return [];
      const out = [];
      for (const el of col.querySelectorAll('button, a[href], [role="button"], [role="option"], li')) {
        const r = el.getBoundingClientRect();
        if (r.height < 18 || r.height > 90) continue;
        out.push({ cls: String(el.className || '').slice(0, 60), w: Math.round(r.width), h: Math.round(r.height) });
      }
      return out.slice(0, 30);
    })(),
    // 顶部 120px 内所有含产品名的元素（品牌行的兜底判据是否成立）
    topTextCandidates: (() => {
      const out = [];
      for (const el of document.querySelectorAll('div, span, header, h1')) {
        const r = el.getBoundingClientRect();
        if (r.top > window.innerHeight * 0.2 || r.height < 16 || r.height > 64 || r.width < 60 || r.width > 460) continue;
        const t = (el.textContent || '').trim();
        if (!/DeepSeek|Harness/i.test(t)) continue;
        out.push({ cls: String(el.className || '').slice(0, 60), rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], text: t.slice(0, 40) });
      }
      return out.slice(0, 12);
    })(),
  };
})()`;

function die(msg) {
  console.error(msg);
  process.exit(1);
}

/* 1) 找调试端点 */
let target = null;
try {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
} catch (error) {
  die(`连不上 127.0.0.1:${PORT}（${error.message}）。\n` +
      '请先用调试端口启动 DSH：\n' +
      '  "D:\\deepseek harness\\DeepSeek Harness.exe" --remote-debugging-port=9333');
}
if (!target) die('调试端点起来了，但没有找到页面目标。');

/* 2) 连上去、真实等待（不用虚拟时钟，避免读到落地前的值） */
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params) => new Promise((res) => {
  id += 1; pending.set(id, res); ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text);
  return r.result?.result?.value;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 截图辅助：把某个区域裁出来存成 PNG */
async function shoot(send, out, clip) {
  const params = { format: 'png' };
  if (clip) params.clip = { ...clip, scale: 2 };
  const r = await send('Page.captureScreenshot', params);
  const data = r.result?.data;
  if (!data) return false;
  writeFileSync(out, Buffer.from(data, 'base64'));
  return true;
}
let data = null;
for (let i = 0; i < 40; i += 1) {
  data = await evaluate(PROBE);
  if (data?.plugin?.critical) break;
  await sleep(500);
}
writeFileSync(OUT, JSON.stringify(data, null, 2), 'utf8');

/* 3) 人话摘要 */
const p = data.plugin;
console.log('=== dsh-liquid-glass 诊断 ===');
console.log('页面：', data.url, '视口', data.viewport.join('×'));
console.log('样式：critical=' + p.critical, 'dynamic=' + p.dynamic, 'external=' + p.external,
            'svg=' + p.svgFilter, 'mask=' + p.mask, 'controls=' + p.controls);
console.log('品牌变量：', data.brandVars.join('　'));
console.log('插件标记：', data.tagged.length ? data.tagged.map((t) => (t.cls || '') + '[' + (t.attrs.includes('data-dshlg-region') ? 'region' : '') + ']').join(', ') : '（一个都没有！）');
console.log('左栏品牌钩子：logoRow=' + !!data.hooks.logoRow, 'brandMark=' + !!data.hooks.brandMark,
            'sidebarRoot=' + !!data.hooks.sidebarRoot, 'sidebarCol=' + !!data.hooks.sidebarCol);
console.log('输入栏钩子：editor=' + !!data.hooks.editor, 'composer=' + !!data.hooks.composer);
console.log('会话行候选：', data.rowCandidates.length, '个');
console.log('顶部产品名候选：', data.topTextCandidates.length, '个');
/* 截图：整体 + 左上角品牌区（放大 2 倍，便于看清蓝色玻璃是否真的出现） */
await send('Page.enable');
const shotAll = join(HERE, 'dsh-liquid-glass-shot-full.png');
const shotBrand = join(HERE, 'dsh-liquid-glass-shot-brand.png');
const okAll = await shoot(send, shotAll);
const okBrand = await shoot(send, shotBrand, { x: 0, y: 32, width: 300, height: 84 });
console.log('截图：整窗 ' + (okAll ? shotAll : '失败') + '　品牌区 ' + (okBrand ? shotBrand : '失败'));

/* 品牌区的结论摘要：一眼看出「有没有蓝色玻璃」 */
const bd = data.brandDetail;
if (bd?.marked) {
  console.log('\n=== 品牌区实测 ===');
  console.log('行     :', JSON.stringify(bd.row.bg), bd.row.border, 'radius=' + bd.row.borderRadius);
  console.log('行背景图:', bd.row.bgImage);
  console.log('文字   :', bd.name ? (bd.name.color + ' / fill=' + bd.name.webkitFill + ' / clip=' + bd.name.clip) : '（没找到 _brandName）');
  console.log('图标   :', bd.mark ? (bd.mark.color + ' / filter=' + bd.mark.filter) : '（没找到 _brandMark）');
} else {
  console.log('\n品牌区：**没有** .dshlg-brand 标记');
}

console.log('\n完整报告 →', OUT);
ws.close();
process.exit(0);
