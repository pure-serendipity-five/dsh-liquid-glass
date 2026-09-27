/**
 * dsh-liquid-glass · Host 半体
 *
 * 起一个**只监听 127.0.0.1 的只读静态服务**，把本包 `wallpapers/` 下的
 * 壁纸文件（大体积 .webm / .mp3）用 HTTP 暴露给客户端半体。
 *
 * 为什么不复用 DSH 的 webServer 服务：
 *   实测发现，插件被 patch 插在最外层时 `ctx.get('webServer')` 拿不到该服务
 *   （Cordis 的服务查找是「子→父」单向的，插在外层就看不到内层提供的服务）。
 *   后来又验证过一次：连模块级 `export const inject = ['webServer']` 也无效，
 *   重启后 `http://127.0.0.1:19387/dshlg-control/health` 依然 404。
 *   所以控制中心 API 也走这个服务，**不再依赖任何拿不到的服务**。
 *
 * 接口（全部挂在同一个只绑 127.0.0.1 的服务上）：
 *   /__alive                        存活探针（挑端口 + 判断能力，features 含 'control'）
 *   /__wallpapers                   壁纸清单（每项带 previewExt）
 *   /__preview?id=<item.id>         预览图字节（客户端画缩略图）
 *   /__video?src=<相对路径>          视频壁纸的包装页
 *   /dshlg-control/health           控制中心：能力探测（degraded 列不可用的官方服务）
 *   /dshlg-control/workspaces       控制中心：工作区列表
 *   /dshlg-control/workspace/*      控制中心：create / rename / pin / archive（无删除）
 *   /dshlg-control/sessions/inspect 控制中心：会话只读巡检（前后哈希一致）
 *
 * 安全：壁纸只读、控制面只读 + 少量可逆写；限定在已知壁纸目录内（路径穿越校验）、
 *       不列目录、只绑回环地址；CORS 只回显本机来源（见 corsHeaders 的取舍说明）。
 */

import { createReadStream } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 壁纸根目录。 */
const ROOT = fileURLToPath(new URL('./wallpapers/', import.meta.url));

/** 候选端口，与 client.js 里的列表保持一致。 */
const PORTS = [39321, 39322, 39323, 39324];

/* ── 壁纸来源 ────────────────────────────────────────────────
 * 除了本包的 wallpapers/，还可以直接挂载 Wallpaper Engine 的目录，
 * 这样下拉框里就能直接列出工坊订阅的壁纸，不用手工建 junction。
 *
 * 想加路径就在这里加；不存在的路径会自动跳过。
 */
const WORKSHOP_APPID = '431960'; // Wallpaper Engine

/**
 * 视频壁纸的填充方式。
 *   'cover'   —— 铺满窗口，超出部分裁掉（壁纸的常规做法，默认）
 *   'contain' —— 完整显示整帧，但比例不匹配时会留黑边
 * 如果某张视频壁纸「显示不全」（画面被裁掉了），把这里改成 'contain'。
 */
const VIDEO_FIT = 'cover';

/** Steam 可能装在这些地方（第一个存在的生效）。 */
const STEAM_CANDIDATES = [
  'C:\\Program Files (x86)\\Steam',
  'C:\\Program Files\\Steam',
  'D:\\Program Files (x86)\\Steam',
  'D:\\Steam',
  'D:\\SteamLibrary',
  'E:\\Program Files (x86)\\Steam',
  'E:\\Steam',
  'E:\\SteamLibrary',
];

/**
 * 探测所有可扫描的壁纸来源。
 * 返回 [{ key, label, dir, local }]，dir 不存在的会被过滤掉。
 */
async function detectSources() {
  const sources = [{ key: 'local', label: '本地', dir: ROOT, local: true }];

  const tryAdd = async (key, label, dir) => {
    if (!dir) return;
    try {
      const info = await stat(dir);
      if (info.isDirectory()) sources.push({ key, label, dir });
    } catch {
      /* 不存在，跳过 */
    }
  };

  for (const steam of STEAM_CANDIDATES) {
    await tryAdd(
      'ws',
      'Steam 工坊',
      join(steam, 'steamapps', 'workshop', 'content', WORKSHOP_APPID),
    );
    await tryAdd('proj', 'WE 我的项目', join(steam, 'steamapps', 'common', 'wallpaper_engine', 'projects', 'myprojects'));
    await tryAdd('proj', 'WE 内置项目', join(steam, 'steamapps', 'common', 'wallpaper_engine', 'projects', 'defaultprojects'));
  }

  return sources;
}

/* ── 挂载表 ──────────────────────────────────────────────────
 * key → 绝对目录。URL 形如 /@w/<key>/<相对路径>。
 * 每次扫描壁纸时重建。
 */
const MOUNTS = new Map();

/* ── 预览图注册表 ────────────────────────────────────────────
 * item.id → 预览图绝对路径。和 MOUNTS 一样，每次扫描壁纸时重建。
 *
 * /__preview 只查这张表：调用方给的是 id，不是路径；
 * 表里的值全是扫描时在「已知壁纸目录」里 stat 到的真实文件，
 * 所以穿不到目录外，也不需要再做路径拼接校验。
 */
const PREVIEWS = new Map();

/** 预览图候选扩展名，按这个顺序探测（WE 的产物以 jpg 为主，也见过 gif）。 */
const PREVIEW_EXTS = ['gif', 'jpg', 'jpeg', 'png', 'webp'];

/** 是否已经完整扫过一次清单；/__preview 用它决定要不要补扫。 */
let scanned = false;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.ogv': 'video/ogg',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

/* ── CORS ────────────────────────────────────────────────────
 * 本服务的定位是「**本机插件服务**」：只绑 127.0.0.1，只服务这台机器上的界面。
 * 这个定位带来一组有意的取舍，写在这里免得以后有人「顺手放开」：
 *
 *   1) 收紧来源。以前这里是 `Access-Control-Allow-Origin: *`，等于**任何网站**
 *      都能读走壁纸清单；现在控制中心还带 POST（建工作区/改名/置顶/归档），
 *      全开就太危险了。所以只在 Origin 是本机 http(s) 时回显它，其它来源**不发** ACAO。
 *   2) 这一版**刻意不引入 token**。本机绑定 + 来源校验已经挡住「别的网站偷偷调」，
 *      再加 token 只会让客户端变复杂（要传、要存、要轮换），收益不成正比。
 *      等真有「跨机访问」的需求再加，那时也应该顺带换成本机以外的鉴权方案。
 *   3) 只绑 127.0.0.1 这一条是硬底线，不要改成 0.0.0.0。
 */
const ALLOWED_ORIGIN = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;

/** 已经记过日志的被拒来源，避免同一条日志刷屏。 */
const rejectedOrigins = new Set();

/**
 * 按请求的 Origin 生成 CORS 头。传 req 或 res 都行（res.req 就是这条响应对应的请求）。
 * 来源不在白名单里就不发 Access-Control-Allow-Origin —— 浏览器会因此拦住读取，
 * 而日志里会留下唯一一次线索，便于排查「界面被 CORS 挡住」。
 */
function corsHeaders(source) {
  const req = source && source.headers ? source : source?.req;
  const headers = {
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Range, Content-Type',
    'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
    Vary: 'Origin',
  };
  const origin = req?.headers?.origin;
  if (typeof origin === 'string' && origin) {
    if (ALLOWED_ORIGIN.test(origin)) {
      headers['Access-Control-Allow-Origin'] = origin;
    } else if (!rejectedOrigins.has(origin)) {
      rejectedOrigins.add(origin);
      console.info(`[dsh-liquid-glass] 拒绝跨源来源 ${origin}（本服务只服务本机界面）`);
    }
  }
  return headers;
}

function send(res, status, body, extra) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...corsHeaders(res),
    ...(extra ?? {}),
  });
  res.end(body);
}

/**
 * 请求路径 → 真实文件；越界返回 undefined。
 *
 * 两种形态：
 *   /zen/videos/庭院.webm        → 本包 wallpapers/ 内（相对路径）
 *   /@w/ws-3803012159/index.html → 挂载的 WE 目录（Steam 工坊 / WE 项目）
 *
 * 两条路径都做「解析后必须仍在根目录内」的校验，防止 ../ 穿越。
 */
function resolveTarget(urlPath) {
  let rel;
  try {
    // 关键：壁纸里的文件名带中文（庭院.webm），必须正确解码
    rel = decodeURIComponent(urlPath);
  } catch {
    return undefined;
  }
  if (rel === '/' || rel === '') rel = '/index.html';

  // 挂载路径：/@w/<key>/<相对路径>
  if (rel.startsWith('/@w/')) {
    const rest = rel.slice(4);
    const slash = rest.indexOf('/');
    if (slash < 0) return undefined;
    const key = rest.slice(0, slash);
    const sub = rest.slice(slash + 1);
    const dir = MOUNTS.get(key);
    if (!dir) return undefined;
    return insideDir(dir, sub);
  }

  return insideDir(ROOT, rel);
}

/** 把相对路径解析到 dir 内；解析结果越界则返回 undefined。 */
function insideDir(dir, rel) {
  const base = dir.endsWith(sep) ? dir : dir + sep;
  const target = resolve(dir, '.' + (rel.startsWith('/') ? rel : '/' + rel));
  if (target !== resolve(dir) && !target.startsWith(base)) return undefined;
  return target;
}

/* ── 视频壁纸包装页 ──────────────────────────────────────────
 * video 类型的壁纸如果把裸 .mp4 塞进 iframe，浏览器会显示自带的播放器
 * 控件、也不铺满。所以包一层：全屏、循环、无控件。
 *
 * 页面里放了三个「和宅邸禅院同款」的隐藏元素（#sceneRow / #audioBtn /
 * #volSlider），这样宿主注入的控制桥能**原样**驱动它 —— 不必为视频壁纸
 * 单独写一套控制协议：
 *   #audioBtn  → 切换静音（对应控制条的「松风」）
 *   #volSlider → 音量（对应控制条的音量条）
 */
function videoPage(videoPath) {
  const src = '/' + String(videoPath).replace(/^\/+/, '');
  const safe = src.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>video wallpaper</title>
<style>
  html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #000; }
  video { display: block; width: 100vw; height: 100vh; object-fit: ${VIDEO_FIT}; }
  .hidden { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
</style>
</head>
<body>
<video id="v" src="${safe}" autoplay loop muted playsinline
       disablepictureinpicture controlslist="nodownload noplaybackrate noremoteplayback"></video>

<!-- 这三个是给控制桥用的接口元素，本身不可见 -->
<div id="sceneRow" class="hidden"></div>
<button id="audioBtn" class="hidden" aria-pressed="false" type="button"></button>
<input id="volSlider" class="hidden" type="range" min="0" max="100" value="100">

<script>
(function () {
  var v = document.getElementById('v');
  var audioBtn = document.getElementById('audioBtn');
  var vol = document.getElementById('volSlider');
  document.body.setAttribute('data-scene', 'video');

  // 默认静音：浏览器不允许自动播放带声音的视频。
  // 点控制条上的「松风」等于给出一次交互，之后就能带声音。
  var unlocked = false;
  v.volume = Number(vol.value) / 100;

  function tryPlay() {
    var p = v.play();
    if (p && p.catch) p.catch(function () {});
  }
  tryPlay();
  // 万一被暂停就再拉起来（加载完成时、从后台切回来时）
  v.addEventListener('pause', function () { if (!document.hidden) tryPlay(); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) tryPlay(); });

  // 控制桥点这个按钮 = 切换声音
  audioBtn.addEventListener('click', function () {
    var next = audioBtn.getAttribute('aria-pressed') !== 'true';
    audioBtn.setAttribute('aria-pressed', next ? 'true' : 'false');
    v.muted = !next;
    if (next) { unlocked = true; tryPlay(); }
  });

  vol.addEventListener('input', function () {
    v.volume = Math.max(0, Math.min(1, Number(vol.value) / 100));
    if (v.volume > 0 && v.muted && unlocked) {
      v.muted = false;
      audioBtn.setAttribute('aria-pressed', 'true');
    }
  });
})();
</script>
</body>
</html>`;
}

/* ── 注入到壁纸页面的控制桥 ──────────────────────────────────
 *
 * 为什么需要它：壁纸 iframe 是**跨源**的（壁纸在 http://127.0.0.1:PORT，
 * 界面在 dsh-app://app），父页面读不到 iframe.contentDocument，
 * 没法直接调壁纸的 DOM 或函数。
 *
 * 所以由宿主在伺服 HTML 时注入这段脚本 —— 它跑在**壁纸自己的源**里，
 * 能操作壁纸 DOM，再通过 postMessage 跟外面双向通信。
 *
 * 控制方式刻意选择「点它自己的按钮」而不是调内部函数：
 * 壁纸的播放器是 IIFE 封闭的，但按钮上的事件监听是完整的，
 * 点按钮等于走它自己的正规流程（含淡化过渡、存档、UI 状态同步）。
 */
const BRIDGE_SCRIPT = `<script data-dshlg-bridge="1">
(function () {
  var MAGIC = 'dshlg';
  try { if (window.__DSHLG_BRIDGE__) return; window.__DSHLG_BRIDGE__ = true; } catch (e) {}

  function post(msg) {
    var payload = { __dshlg: MAGIC };
    for (var k in msg) if (Object.prototype.hasOwnProperty.call(msg, k)) payload[k] = msg[k];
    try { parent.postMessage(payload, '*'); } catch (e) {}
  }

  function sceneButtons() {
    return Array.prototype.slice.call(document.querySelectorAll('#sceneRow [data-scene]'));
  }

  function readState() {
    var audioBtn = document.getElementById('audioBtn');
    var vol = document.getElementById('volSlider');
    var pressed = audioBtn ? audioBtn.getAttribute('aria-pressed') : null;
    return {
      type: 'state',
      scene: document.body ? document.body.getAttribute('data-scene') : null,
      audioOn: pressed === 'true',
      volume: vol ? Number(vol.value) : null,
      scenes: sceneButtons().map(function (b) {
        return { id: b.getAttribute('data-scene'), label: (b.textContent || '').trim() };
      })
    };
  }

  function pushState() { post(readState()); }

  function setScene(id) {
    if (!id) return;
    var btn = sceneButtons().filter(function (b) { return b.getAttribute('data-scene') === id; })[0];
    if (btn) btn.click();
  }

  function setAudio(on) {
    var btn = document.getElementById('audioBtn');
    if (!btn) return;
    var now = btn.getAttribute('aria-pressed') === 'true';
    if (typeof on === 'boolean' ? on !== now : true) btn.click();
  }

  function setVolume(v) {
    var s = document.getElementById('volSlider');
    if (!s) return;
    s.value = String(Math.max(0, Math.min(100, Math.round(Number(v) || 0))));
    s.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /**
   * 隐藏壁纸自带的 HUD。
   * 用 WE 官方的属性协议（这张壁纸实现了 wallpaperPropertyListener），
   * 比直接改 DOM 更稳 —— 它内部会维护状态。
   */
  function setHud(show) {
    var L = window.wallpaperPropertyListener;
    if (L && typeof L.applyUserProperties === 'function') {
      try { L.applyUserProperties({ showui: { value: !!show } }); return; } catch (e) {}
    }
    var hud = document.getElementById('hud');
    if (hud) hud.style.display = show ? '' : 'none';
  }

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.__dshlg !== MAGIC) return;
    if (d.cmd === 'scene') setScene(d.value);
    else if (d.cmd === 'audio') setAudio(d.value);
    else if (d.cmd === 'volume') setVolume(d.value);
    else if (d.cmd === 'hud') setHud(d.value);
    else if (d.cmd === 'state') pushState();
    // 任何命令之后都回报一次状态（延迟一点，等壁纸自己的状态更新完）
    if (d.cmd !== 'state') setTimeout(pushState, 150);
  });

  function boot() {
    // 场景变化时自动回报（点按钮、或外部改 localStorage 都会触发）
    if (document.body && window.MutationObserver) {
      new MutationObserver(pushState).observe(document.body, {
        attributes: true,
        attributeFilter: ['data-scene']
      });
    }
    // 壁纸脚本在 DOMContentLoaded 里 boot()，这里再等一拍确保按钮已绑定
    setTimeout(pushState, 60);
    setTimeout(function () { post({ type: 'ready' }); }, 260);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 0); });
  else setTimeout(boot, 0);
})();
</script>`;

/** 把控制桥注入到 </body> 之前（此时壁纸自己的脚本已在 DOM 里）。 */
function injectBridge(html) {
  if (html.includes('data-dshlg-bridge')) return html;
  const at = html.toLowerCase().lastIndexOf('</body>');
  if (at >= 0) return html.slice(0, at) + BRIDGE_SCRIPT + html.slice(at);
  return html + BRIDGE_SCRIPT;
}

/** 超过这个大小的 HTML 不做注入。 */
const HTML_INJECT_MAX_BYTES = 2 * 1024 * 1024;

/* ── 壁纸自动发现 ────────────────────────────────────────────
 * 扫 wallpapers/ 下的子目录，认出可用的入口。
 * 换壁纸只需要「往 wallpapers/ 放目录或 junction」，不用改 client.js 配置。
 *
 * 识别顺序：
 *   1. project.json 的 type/file   （WE 壁纸标准）
 *   2. index.html                  → web
 *   3. 顶层 .mp4 / .webm           → video
 * 另外可选 wallpapers/manifest.json 补标题等元信息。
 */
/**
 * 探测一个壁纸目录的预览图，返回 { file, ext }，找不到返回 null。
 *
 * 顺序（契约冻结）：
 *   1) project.json 的 preview 字段（相对该目录，实测多为 preview.jpg）
 *   2) 顶层 preview.(gif|jpg|jpeg|png|webp)
 *   3) 顶层 thumbnail.(gif|jpg|jpeg|png|webp)
 * 第 1 步写的是相对路径，同样做「必须落在该壁纸目录内」的校验。
 */
async function findPreview(dir, declared) {
  const rootAbs = resolve(dir);
  const base = dir.endsWith(sep) ? dir : dir + sep;

  if (typeof declared === 'string' && declared.trim()) {
    const rel = declared.trim().replace(/^[\\/]+/, '').split('\\').join('/');
    const abs = resolve(dir, rel);
    const inside = abs === rootAbs || abs.startsWith(base);
    const ext = extname(abs).toLowerCase().slice(1);
    if (inside && !rel.split('/').includes('..') && PREVIEW_EXTS.includes(ext)) {
      try {
        const info = await stat(abs);
        if (info.isFile()) return { file: abs, ext };
      } catch {
        /* 声明了但文件不在，继续往下探 */
      }
    }
  }

  for (const stem of ['preview', 'thumbnail']) {
    for (const ext of PREVIEW_EXTS) {
      const abs = join(dir, `${stem}.${ext}`);
      try {
        const info = await stat(abs);
        if (info.isFile()) return { file: abs, ext };
      } catch {
        /* 这个组合不存在，试下一个 */
      }
    }
  }

  return null;
}

/** 单个壁纸目录 → 描述对象；认不出入口返回 null。 */
async function describeWallpaper(dir, name, src, manifest) {
  let title = name;
  let type = null;
  let file = null;
  /** project.json 里声明的预览图（相对该壁纸目录）。 */
  let previewDeclared = null;

  // 1) WE 的 project.json（最权威：标题、类型、入口都在这）
  try {
    const pj = JSON.parse(await readFile(join(dir, 'project.json'), 'utf8'));
    if (typeof pj.title === 'string' && pj.title) title = pj.title;
    if (typeof pj.type === 'string' && pj.type) type = pj.type.toLowerCase();
    if (typeof pj.file === 'string' && pj.file) file = pj.file;
    if (typeof pj.preview === 'string' && pj.preview) previewDeclared = pj.preview;
  } catch {
    /* 没有或不合法 */
  }

  // 2) index.html → web
  if (!file || !type) {
    try {
      await stat(join(dir, 'index.html'));
      file = file ?? 'index.html';
      type = type ?? 'web';
    } catch {
      /* 没有 */
    }
  }

  // 3) 顶层视频 → video
  if (!file || !type) {
    try {
      const files = await readdir(dir);
      const vid = files.find((f) => /\.(mp4|webm|ogv)$/i.test(f));
      if (vid) {
        file = file ?? vid;
        type = type ?? 'video';
      }
    } catch {
      /* 忽略 */
    }
  }

  if (!file) return null;

  // WE 的入口可能是 "index.html" 也可能带子目录，统一取相对路径
  const rel = String(file).replace(/^[\\/]+/, '').split('\\').join('/');

  // 类型统一小写：project.json 里 'Web' / 'Video' / 'Scene' 各种写法都有，
  // 比较只认小写，否则「大写 Web」会被判成不支持。
  const normType = type === null ? null : String(type).toLowerCase();

  const mountKey = `${src.key}-${name.replace(/[^A-Za-z0-9_-]/g, '_')}`;
  // 视频走包装页（全屏循环无控件），所以 entry 指到 /__video 而不是裸文件
  const filePath = src.local ? `${name}/${rel}` : `@w/${mountKey}/${rel}`;
  const item = {
    id: `${src.key}:${name}`,
    title,
    type: normType,
    source: src.label,
    supported: false,
    reason: '',
    entry: '',
    // 预览图扩展名；没有预览图时是空串，客户端据此决定要不要画缩略图
    previewExt: '',
  };

  // 本地目录支持 manifest.json 覆盖（类型同样统一小写）
  if (src.local) {
    const m = manifest?.[name];
    if (m && typeof m === 'object') {
      if (m.title) item.title = m.title;
      if (m.entry) item.entry = m.entry;
      if (m.type) item.type = String(m.type).toLowerCase();
    }
  }

  // 只有 web 和 video 能在 iframe 里跑；scene / application / text 依赖 WE 的 DirectX 运行时。
  // 放在 manifest 覆盖之后算，避免 manifest 改了 type 而 supported 还是旧的。
  item.supported = item.type === 'web' || item.type === 'video';
  item.reason =
    item.type === null
      ? '认不出类型'
      : item.supported
        ? ''
        : `${item.type} 类型依赖 Wallpaper Engine 运行时，无法在浏览器里渲染`;
  // manifest 显式给了 entry 就用它，否则按类型生成
  if (!item.entry) {
    item.entry = item.type === 'video' ? `__video?src=${encodeURIComponent(filePath)}` : filePath;
  }

  // 预览图：project.json 的 preview → preview.* → thumbnail.*
  const preview = await findPreview(dir, previewDeclared);
  if (preview) {
    item.previewExt = preview.ext;
    PREVIEWS.set(item.id, preview.file);
  }

  if (!src.local) MOUNTS.set(mountKey, dir);
  return item;
}

/**
 * 扫描所有来源，返回壁纸清单。
 *
 * 来源包括：本包 wallpapers/、Steam 工坊 431960、WE 的 projects/。
 * 每次调用会重建挂载表，所以新增/删除壁纸后重新拉一次清单就同步了。
 */
async function listWallpapers() {
  const out = [];
  MOUNTS.clear();
  PREVIEWS.clear();

  let manifest = {};
  try {
    manifest = JSON.parse(await readFile(join(ROOT, 'manifest.json'), 'utf8'));
  } catch {
    /* 没有就算了 */
  }

  const sources = await detectSources();
  const seenTitles = new Set();

  for (const src of sources) {
    let entries = [];
    try {
      entries = await readdir(src.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const dir = join(src.dir, entry.name);

      // junction / 符号链接的 isDirectory() 不可靠，用 stat（跟随链接）判断
      let info;
      try {
        info = await stat(dir);
      } catch {
        continue;
      }
      if (!info.isDirectory()) continue;

      let item;
      try {
        item = await describeWallpaper(dir, entry.name, src, manifest);
      } catch {
        continue;
      }
      if (!item) continue;

      // 去重：同一个壁纸可能既在工坊又在本地 junction 过来，标题+类型相同只留第一个
      const dedup = `${item.title}\u0000${item.type}`;
      if (seenTitles.has(dedup)) continue;
      seenTitles.add(dedup);

      out.push(item);
    }
  }

  // 清单里额外声明、但目录没被认出的条目也带上
  for (const [id, m] of Object.entries(manifest)) {
    if (out.some((x) => x.id === `local:${id}`)) continue;
    if (!m || typeof m !== 'object' || !m.entry) continue;
    // 类型统一小写：manifest 里可能写成 'Web' / 'Video'
    const type = String(m.type || 'web').toLowerCase();
    const supported = type === 'web' || type === 'video';
    out.push({
      id: `local:${id}`,
      title: m.title || id,
      type,
      source: '本地',
      supported,
      reason: supported ? '' : `${type} 类型依赖 Wallpaper Engine 运行时，无法在浏览器里渲染`,
      entry: m.entry,
      previewExt: '',
    });
  }

  // 本地优先，然后按来源分组、标题排序
  const sourceRank = (s) => (s === '本地' ? 0 : s === 'Steam 工坊' ? 1 : 2);
  out.sort((a, b) => {
    const r = sourceRank(a.source) - sourceRank(b.source);
    if (r !== 0) return r;
    return String(a.title).localeCompare(String(b.title), 'zh-CN');
  });

  scanned = true;
  return out;
}

async function serve(req, res) {
  if (req.method === 'OPTIONS') {
    // 预检：控制中心有 POST（application/json 会触发预检），必须正确回 Methods/Headers
    res.writeHead(204, corsHeaders(req));
    res.end();
    return;
  }

  // 显式拒绝含 .. 的原始路径。
  // new URL() 会把 ../ 折叠掉（所以其实穿不出去），但直接拒绝更清楚，
  // 也避免以后有人改动这里时把防线弄丢。
  const rawPath = String(req.url ?? '/').split('?')[0];
  let decodedRaw;
  try {
    decodedRaw = decodeURIComponent(rawPath);
  } catch {
    send(res, 403, 'forbidden');
    return;
  }
  if (decodedRaw.split(/[\\/]/).includes('..')) {
    send(res, 403, 'forbidden');
    return;
  }

  const url = new URL(req.url ?? '/', 'http://127.0.0.1');

  // 控制中心 API：和壁纸接口**同一个服务、同一套安全边界**（只绑 127.0.0.1）。
  // 它有 POST，所以必须在下面「只允许 GET/HEAD」那道闸门**之前**分流。
  if (url.pathname === '/dshlg-control' || url.pathname.startsWith(CONTROL_PREFIX)) {
    await handleControl(req, res);
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, 'method not allowed');
    return;
  }

  // 存活探针：客户端用它找出实际端口
  if (url.pathname === '/__alive') {
    send(
      res,
      200,
      JSON.stringify({
        ok: true,
        server: 'dsh-liquid-glass',
        version: '1.9.3',
        // 客户端据此优先挑「功能更全」的那个实例，并判断控制中心能力
        features: ['wallpapers', 'control'],
        // 控制中心 API 的版本；客户端只在 features 含 'control' 时才看它
        controlVersion: CONTROL_VERSION,
      }),
      { 'Content-Type': 'application/json; charset=utf-8' },
    );
    return;
  }

  // 壁纸清单：客户端用它渲染切换器
  if (url.pathname === '/__wallpapers') {
    let list = [];
    try {
      list = await listWallpapers();
    } catch (error) {
      console.error('[dsh-liquid-glass] 扫描壁纸失败:', error);
    }
    send(res, 200, JSON.stringify({ root: ROOT, wallpapers: list }), {
      'Content-Type': 'application/json; charset=utf-8',
    });
    return;
  }

  // 预览图：/__preview?id=<item.id>，客户端拿它画缩略图。
  // id 只用来查 PREVIEWS 表（表里全是扫描时认定过的壁纸目录内文件），
  // 调用方给不了路径，所以天然不越界；未知 id 一律 403。
  if (url.pathname === '/__preview') {
    // 表还没建（服务刚起来、还没人拉过清单）时补扫一次
    if (!scanned) {
      try {
        await listWallpapers();
      } catch (error) {
        console.error('[dsh-liquid-glass] 补扫壁纸失败:', error);
      }
    }

    const id = url.searchParams.get('id') ?? '';
    if (!id || id.includes('..') || id.includes('/') || id.includes('\\')) {
      send(res, 403, 'forbidden');
      return;
    }
    const file = PREVIEWS.get(id);
    if (!file) {
      send(res, 403, 'forbidden');
      return;
    }

    let info;
    try {
      info = await stat(file);
    } catch {
      send(res, 404, 'not found');
      return;
    }
    if (!info.isFile()) {
      send(res, 404, 'not found');
      return;
    }

    res.writeHead(200, {
      'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Content-Length': String(info.size),
      ...corsHeaders(res),
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(file).pipe(res);
    return;
  }

  // 视频壁纸的包装页（把裸 mp4 变成全屏循环的壁纸）
  if (url.pathname === '/__video') {
    const src = url.searchParams.get('src') ?? '';
    // 挂载表是扫描时建的；服务刚起来还没人拉过清单时，这里补扫一次
    if (MOUNTS.size === 0) {
      try {
        await listWallpapers();
      } catch (error) {
        console.error('[dsh-liquid-glass] 补扫壁纸失败:', error);
      }
    }
    const target = resolveTarget('/' + src.replace(/^\/+/, ''));
    if (!target) {
      send(res, 403, 'forbidden');
      return;
    }
    try {
      const info = await stat(target);
      if (!info.isFile()) {
        send(res, 404, 'not found');
        return;
      }
    } catch {
      send(res, 404, 'not found');
      return;
    }
    send(res, 200, injectBridge(videoPage(src)), {
      'Content-Type': 'text/html; charset=utf-8',
      'X-DSHLG-Bridge': '1',
    });
    return;
  }

  // manifest.json 属于内部元信息，不通过静态路由暴露（已经由上面的接口读掉）
  if (url.pathname === '/manifest.json') {
    send(res, 403, 'forbidden');
    return;
  }

  const target = resolveTarget(url.pathname);
  if (target === undefined) {
    send(res, 403, 'forbidden');
    return;
  }

  let info;
  try {
    info = await stat(target);
  } catch {
    send(res, 404, 'not found');
    return;
  }
  if (info.isDirectory()) {
    send(res, 403, 'directory listing is disabled');
    return;
  }

  const type = MIME[extname(target).toLowerCase()] ?? 'application/octet-stream';
  const headers = {
    'Content-Type': type,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Accept-Ranges': 'bytes',
    ...corsHeaders(res),
  };

  // Range：大视频必须支持，否则无法 seek / 分段加载
  const range = req.headers.range;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (m) {
      const start = m[1] === '' ? 0 : Number(m[1]);
      const end = m[2] === '' ? info.size - 1 : Number(m[2]);
      if (Number.isFinite(start) && Number.isFinite(end) && start <= end && end < info.size) {
        res.writeHead(206, {
          ...headers,
          'Content-Range': `bytes ${start}-${end}/${info.size}`,
          'Content-Length': String(end - start + 1),
        });
        if (req.method === 'HEAD') {
          res.end();
          return;
        }
        createReadStream(target, { start, end }).pipe(res);
        return;
      }
    }
  }

  // HTML：注入控制桥后再发（壁纸页面需要它才能被外部控制）
  if (type.startsWith('text/html') && info.size <= HTML_INJECT_MAX_BYTES) {
    let html;
    try {
      html = await readFile(target, 'utf8');
    } catch {
      send(res, 500, 'read failed');
      return;
    }
    const buf = Buffer.from(injectBridge(html), 'utf8');
    res.writeHead(200, {
      ...headers,
      'Content-Length': String(buf.byteLength),
      'X-DSHLG-Bridge': '1',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    res.end(buf);
    return;
  }

  res.writeHead(200, { ...headers, 'Content-Length': String(info.size) });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(target).pipe(res);
}

/* ── 控制中心 API（挂在 DSH 自己的 web server 上） ─────────────
 * M0：工作区管理 + 会话巡检，全部同源。
 *
 * 为什么走 webServer：DSH 的 web server 本来就在跑，注册一条命名路由即可同源访问 ——
 * 免端口发现、免 token、免 CORS（也就不必再开 ACAO:*）。
 * 现有 39321-39324 的壁纸静态服务保持不动，两者并存。
 *
 * 三条硬要求（都是本项目翻过车的点）：
 *   1) register 冲突会 throw → 必须 try/catch，绝不能让注册失败拖垮插件激活；
 *   2) 拿不到 webServer 就记日志跳过，壁纸服务等其余功能照常；
 *   3) 巡检端点绝对只读：只调 list/stat/inspect，不写任何会话文件。
 */
const CONTROL_PREFIX = '/dshlg-control/';
const CONTROL_VERSION = '1.10.0';
const CONTROL_TITLE_MAX = 60;
const CONTROL_BODY_MAX = 64 * 1024;
const CONTROL_SESSION_LIMIT = 30;
const CONTROL_SESSION_LIMIT_MAX = 100;
const CONTROL_SHORT_TIMEOUT_MS = 2500;

/**
 * 取一个**可选**服务。拿不到、或形状不对，一律返回 null，由调用方降级。
 * 先走 ctx.get(name)（官方可选访问方式），再退回 ctx[name]（组合里声明了 inject 时的形态）。
 */
function controlService(ctx, name) {
  try {
    if (typeof ctx?.get === 'function') {
      const svc = ctx.get(name);
      if (svc && typeof svc === 'object') return svc;
    }
  } catch (error) {
    console.error(`[dsh-liquid-glass] 读取服务 ${name} 失败:`, error);
    return null;
  }
  try {
    const direct = ctx?.[name];
    if (direct && typeof direct === 'object') return direct;
  } catch {
    /* 没有 inject 过就访问不到，属正常情况 */
  }
  return null;
}

function controlServices(ctx) {
  return {
    webServer: controlService(ctx, 'webServer'),
    workspaceRegistry: controlService(ctx, 'workspaceRegistry'),
    workspaceController: controlService(ctx, 'workspaceController'),
    sessionController: controlService(ctx, 'sessionController'),
    sessionPersistence: controlService(ctx, 'sessionPersistence'),
  };
}

/** Node 异常 → 人话。只取 message，绝不外抛堆栈。 */
const CONTROL_ERROR_HINTS = [
  [/ENOENT|no such file|not found|不存在/i, '这个路径不存在，检查一下拼写'],
  [/ENOTDIR|not a directory/i, '这个路径不是目录'],
  [/EEXIST|already exists|duplicate|unique/i, '名字重复了，换一个再试'],
  [/EACCES|EPERM|permission denied|拒绝访问/i, '没有权限访问这个路径'],
  [/ENOSPC|no space/i, '磁盘空间不够了'],
  [/cancelled|aborted|abort/i, '操作被取消了'],
  [/invalid|blank|empty|required|missing/i, '参数不合法，检查一下再提交'],
];

function controlHumanMessage(error) {
  const raw = error && typeof error.message === 'string' ? error.message : String(error ?? '');
  const code = error && typeof error.code === 'string' ? error.code : '';
  if (code === 'session/not-found') return '找不到这个会话，可能已经被删掉了';
  if (/session\/not-found/.test(raw)) return '找不到这个会话，可能已经被删掉了';
  for (const [pattern, human] of CONTROL_ERROR_HINTS) {
    if (pattern.test(code) || pattern.test(raw)) return human;
  }
  const firstLine = raw.split('\n')[0].trim().slice(0, 160);
  return firstLine || '操作失败，请稍后再试';
}

/** 人话错误配一个合适的 HTTP 状态码。 */
function controlStatusFor(error) {
  const text = `${error?.code ?? ''} ${error?.message ?? ''}`;
  if (/active|busy|running|正在运行/i.test(text)) return 409;
  if (/ENOENT|ENOTDIR|EEXIST|EACCES|EPERM|invalid|blank|empty|required|not-found|not found/i.test(text)) {
    return 400;
  }
  return 500;
}

/**
 * 统一的 JSON 响应。
 * 同源调用不需要 CORS 头 —— 这里刻意**不**写 Access-Control-Allow-Origin，
 * 免得把控制面又变成第二个 `ACAO:*`。
 */
function controlJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(body.byteLength),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

function controlOk(res, body) {
  controlJson(res, 200, { ok: true, ...body });
}

function controlFail(res, status, code, message) {
  controlJson(res, status, { ok: false, error: { code, message } });
}

/** 读 JSON 请求体（有大小上限，避免被塞爆内存）。 */
async function controlReadBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > CONTROL_BODY_MAX) throw new Error('请求体太大了');
    chunks.push(chunk);
  }
  if (total === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('请求体不是合法的 JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('请求体必须是 JSON 对象');
  return parsed;
}

/** id 只允许当标识符用：空、超长、带 .. 或路径分隔符一律拒绝。 */
function controlIsSafeId(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 200 &&
    !value.includes('..') &&
    !value.includes('/') &&
    !value.includes('\\')
  );
}

/** 工作区路径：必须是绝对路径，且不能含 .. 段。 */
function controlSafePath(value) {
  if (typeof value !== 'string') return null;
  const path = value.trim();
  if (!path || path.length > 1024) return null;
  if (path.split(/[\\/]/).includes('..')) return null;
  if (!/^[A-Za-z]:[\\/]|^\\\\|^\//.test(path)) return null;
  return path;
}

function controlCleanTitle(value) {
  if (typeof value !== 'string') return null;
  const title = value.trim();
  if (!title || title.length > 120) return null;
  return title;
}

/** 标题一律截到 60 字符，且压掉换行 —— 返回体里不许出现整段文本。 */
function controlTruncateTitle(text) {
  if (typeof text !== 'string') return '';
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= CONTROL_TITLE_MAX ? flat : `${flat.slice(0, CONTROL_TITLE_MAX)}…`;
}

/** 路径比较键：统一分隔符、统一小写、去掉结尾斜杠。 */
function controlPathKey(value) {
  return String(value ?? '')
    .replace(/\//g, '\\')
    .replace(/\\+$/, '')
    .toLowerCase();
}

/** Workspace（durable 实体）→ 面向前端的投影。 */
function controlWorkspaceView(ws) {
  return {
    id: String(ws?.id ?? ''),
    name: controlTruncateTitle(String(ws?.title ?? '')),
    path: String(ws?.path ?? ''),
    sessionIds: Array.isArray(ws?.sessionIds) ? ws.sessionIds.map(String) : [],
    createdAt: ws?.createdAt ?? null,
    updatedAt: ws?.updatedAt ?? null,
  };
}

/**
 * 置顶/归档是「全局会话集合」，官方只在 workspaceController.follow() 的 baseline 帧里给出。
 * 这里只读第一帧就断开；拿不到就退回空集合，不影响其余字段。
 */
async function controlReadFlags(ctx) {
  const empty = { pinned: new Set(), archived: new Set(), available: false };
  const controller = controlService(ctx, 'workspaceController');
  if (!controller || typeof controller.follow !== 'function') return empty;
  try {
    const stream = controller.follow(AbortSignal.timeout(CONTROL_SHORT_TIMEOUT_MS));
    for await (const frame of stream) {
      const baseline = frame && frame.type === 'baseline' ? frame.value : null;
      return {
        pinned: new Set((baseline?.pinnedSessionIds ?? []).map(String)),
        archived: new Set((baseline?.archivedSessionIds ?? []).map(String)),
        available: !!baseline,
      };
    }
  } catch (error) {
    console.info('[dsh-liquid-glass] 读取置顶/归档状态失败（已忽略）:', controlHumanMessage(error));
  }
  return empty;
}

/**
 * 「当前工作区」官方没有这个字段。这里用「最近活跃会话的 cwd」当判据，
 * 并把判据本身回给客户端（currentBasis），免得它变成说不清的黑盒。
 */
async function controlCurrentCwd(ctx) {
  const missing = { cwd: null, key: null, basis: 'unavailable' };
  const controller = controlService(ctx, 'sessionController');
  if (!controller || typeof controller.list !== 'function') return missing;
  try {
    const value = await controller.list({}, AbortSignal.timeout(CONTROL_SHORT_TIMEOUT_MS));
    const items = Array.isArray(value?.items) ? value.items : [];
    const hit = items.find((item) => item && typeof item.cwd === 'string' && item.cwd);
    if (!hit) return missing;
    return { cwd: hit.cwd, key: controlPathKey(hit.cwd), basis: '最近活跃会话的 cwd' };
  } catch (error) {
    console.info('[dsh-liquid-glass] 读取当前工作区失败（已忽略）:', controlHumanMessage(error));
    return missing;
  }
}

/** 正在运行的会话 id 集合（拿不到就当空集，不影响巡检主流程）。 */
async function controlRunningSessions(ctx) {
  const running = new Set();
  const controller = controlService(ctx, 'sessionController');
  if (!controller || typeof controller.list !== 'function') return running;
  try {
    const value = await controller.list({}, AbortSignal.timeout(CONTROL_SHORT_TIMEOUT_MS));
    for (const item of value?.items ?? []) {
      if (item?.running && item.sessionId) running.add(String(item.sessionId));
    }
  } catch {
    /* 拿不到就当作都不知道 */
  }
  return running;
}

/**
 * 从 inspect() 的事件里取标题：只认 `session/title` 事件的 title 字段。
 * **绝不把事件本身、更不把消息正文回传** —— 这是本端点的红线。
 */
function controlSessionTitle(inspection) {
  const events = inspection?.events;
  if (!Array.isArray(events)) return '';
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event && event.type === 'session/title' && event.data && typeof event.data.title === 'string') {
      return event.data.title;
    }
  }
  return '';
}

/** 没有标题事件时的兜底标签：cwd 最后一段，或会话 id 前 8 位。 */
function controlSessionLabel(cwd, id) {
  if (typeof cwd === 'string' && cwd.trim()) {
    const parts = cwd.replace(/[\\/]+$/, '').split(/[\\/]/);
    const last = parts[parts.length - 1];
    if (last) return last;
  }
  return `会话 ${String(id).slice(0, 8)}`;
}

function controlSessionRow(id, inspection, header, snapshot, override, running) {
  const meta = inspection?.meta ?? header ?? null;
  const fromTitle = controlSessionTitle(inspection);
  const title = controlTruncateTitle(fromTitle || controlSessionLabel(meta?.cwd, id));
  const eventCount =
    typeof snapshot?.eventCount === 'number'
      ? snapshot.eventCount
      : Array.isArray(inspection?.events)
        ? inspection.events.length
        : null;
  const sizeBytes = typeof snapshot?.sizeBytes === 'number' ? snapshot.sizeBytes : null;

  let severity = 'ok';
  let symptom = '正常';
  let suggestion = '';
  if (override) {
    severity = override.severity;
    symptom = override.symptom;
    suggestion = override.suggestion;
  } else if (!meta) {
    severity = 'error';
    symptom = '读不到会话头';
    suggestion = '这个会话的记录可能损坏了，建议先导出备份再处理';
  } else if (eventCount === 0) {
    severity = 'info';
    symptom = '空会话，没有任何事件';
    suggestion = '可以归档掉，不影响别的会话';
  } else if (sizeBytes !== null && sizeBytes > 20 * 1024 * 1024) {
    severity = 'warn';
    symptom = `日志体积偏大（约 ${Math.round(sizeBytes / 1048576)} MB）`;
    suggestion = '考虑归档这个会话，或者开个新会话继续';
  } else if (running) {
    severity = 'info';
    symptom = '正在运行';
  }

  return {
    id,
    title,
    severity,
    symptom,
    suggestion,
    cwd: typeof meta?.cwd === 'string' ? meta.cwd : null,
    running: !!running,
    eventCount,
    sizeBytes,
    createdAt: typeof meta?.createdAt === 'number' ? new Date(meta.createdAt).toISOString() : null,
    titleSource: fromTitle ? 'session/title 事件' : 'cwd 兜底（没有标题事件）',
  };
}

/* ── 各个端点 ─────────────────────────────────────────────── */

function controlHealth(ctx, res) {
  const svc = controlServices(ctx);
  // services 只报**官方数据服务**：客户端会把每一项渲染成「可用 ✓ / 不可用 ✗」，
  // 所以不能把载体塞进来 —— webServer 拿不到是本机常态，塞进去只会多一条误导的红叉。
  const services = {
    workspaceRegistry: typeof svc.workspaceRegistry?.list === 'function',
    workspaceController: typeof svc.workspaceController?.rename === 'function',
    sessionController: typeof svc.sessionController?.inspect === 'function',
    sessionPersistence: typeof svc.sessionPersistence?.list === 'function',
  };
  const degraded = Object.keys(services).filter((name) => !services[name]);
  controlJson(res, 200, {
    ok: true,
    version: CONTROL_VERSION,
    route: CONTROL_PREFIX,
    // 载体：主载体恒为「与壁纸接口同一个 127.0.0.1 服务」；webServer 只是备用，可见与否都正常
    carrier: 'local-http-127.0.0.1',
    carriers: { localHttp: true, webServer: typeof svc.webServer?.register === 'function' },
    services,
    degraded,
  });
}

async function controlWorkspaces(ctx, res) {
  const registry = controlService(ctx, 'workspaceRegistry');
  if (!registry || typeof registry.list !== 'function') {
    return controlFail(res, 503, 'service-unavailable', '工作区服务暂时不可用，稍后再试');
  }
  let list = [];
  try {
    list = registry.list();
  } catch (error) {
    return controlFail(res, 500, 'list-failed', controlHumanMessage(error));
  }
  if (!Array.isArray(list)) list = [];

  const flags = await controlReadFlags(ctx);
  const current = await controlCurrentCwd(ctx);
  const workspaces = [];

  for (const ws of list) {
    if (!ws) continue;
    let status = 'unknown';
    try {
      const value = await ws.status();
      if (value === 'ok' || value === 'missing-dir') status = value;
    } catch {
      /* 保持 unknown */
    }
    const sessionIds = Array.isArray(ws.sessionIds) ? ws.sessionIds.map(String) : [];
    workspaces.push({
      id: String(ws.id ?? ''),
      name: controlTruncateTitle(String(ws.title ?? '')),
      path: String(ws.path ?? ''),
      isCurrent: !!current.key && controlPathKey(ws.path) === current.key,
      sessionCount: sessionIds.length,
      pinnedCount: sessionIds.filter((id) => flags.pinned.has(id)).length,
      archivedCount: sessionIds.filter((id) => flags.archived.has(id)).length,
      status,
      createdAt: ws.createdAt ?? null,
      updatedAt: ws.updatedAt ?? null,
    });
  }

  controlOk(res, {
    count: workspaces.length,
    currentCwd: current.cwd,
    currentBasis: current.basis,
    flagsAvailable: flags.available,
    workspaces,
  });
}

async function controlWorkspaceCreate(ctx, req, res) {
  let body;
  try {
    body = await controlReadBody(req);
  } catch (error) {
    return controlFail(res, 400, 'bad-body', controlHumanMessage(error));
  }
  const path = controlSafePath(body.path);
  if (!path) {
    return controlFail(res, 400, 'bad-path', '请填一个存在的目录的完整路径，例如 D:\\我的项目');
  }
  let name = null;
  if (body.name !== undefined && body.name !== null && body.name !== '') {
    name = controlCleanTitle(body.name);
    if (!name) return controlFail(res, 400, 'bad-name', '名字不能为空，也不要超过 120 个字');
  }

  const controller = controlService(ctx, 'workspaceController');
  const registry = controlService(ctx, 'workspaceRegistry');
  try {
    if (controller && typeof controller.create === 'function') {
      const value = await controller.create({ path });
      let workspace = value?.workspace ?? null;
      const created = value?.created === true;
      if (name && workspace && workspace.title !== name) {
        const renamed = await controller.rename({ workspaceId: workspace.workspaceId, title: name });
        workspace = renamed?.workspace ?? workspace;
      }
      return controlOk(res, { created, workspace });
    }
    if (registry && typeof registry.create === 'function') {
      const ws = await registry.create(path, name ?? undefined);
      return controlOk(res, { created: true, workspace: controlWorkspaceView(ws) });
    }
    return controlFail(res, 503, 'service-unavailable', '工作区服务暂时不可用，稍后再试');
  } catch (error) {
    return controlFail(res, controlStatusFor(error), 'create-failed', controlHumanMessage(error));
  }
}

async function controlWorkspaceRename(ctx, req, res) {
  let body;
  try {
    body = await controlReadBody(req);
  } catch (error) {
    return controlFail(res, 400, 'bad-body', controlHumanMessage(error));
  }
  const id = body.id ?? body.workspaceId;
  if (!controlIsSafeId(id)) return controlFail(res, 400, 'bad-id', '缺少工作区 id');
  const name = controlCleanTitle(body.name ?? body.title);
  if (!name) return controlFail(res, 400, 'bad-name', '名字不能为空，也不要超过 120 个字');

  const controller = controlService(ctx, 'workspaceController');
  const registry = controlService(ctx, 'workspaceRegistry');
  try {
    if (controller && typeof controller.rename === 'function') {
      const value = await controller.rename({ workspaceId: id, title: name });
      return controlOk(res, { workspace: value?.workspace ?? null });
    }
    if (registry && typeof registry.get === 'function') {
      const ws = registry.get(id);
      if (!ws) return controlFail(res, 404, 'not-found', '找不到这个工作区');
      await ws.setTitle(name);
      return controlOk(res, { workspace: controlWorkspaceView(ws) });
    }
    return controlFail(res, 503, 'service-unavailable', '工作区服务暂时不可用，稍后再试');
  } catch (error) {
    return controlFail(res, controlStatusFor(error), 'rename-failed', controlHumanMessage(error));
  }
}

async function controlWorkspacePin(ctx, req, res) {
  let body;
  try {
    body = await controlReadBody(req);
  } catch (error) {
    return controlFail(res, 400, 'bad-body', controlHumanMessage(error));
  }
  const id = body.id ?? body.sessionId;
  if (!controlIsSafeId(id)) return controlFail(res, 400, 'bad-id', '缺少会话 id');
  const pinned = body.pinned !== false;
  const method = pinned ? 'pinSession' : 'unpinSession';

  const controller = controlService(ctx, 'workspaceController');
  const registry = controlService(ctx, 'workspaceRegistry');
  try {
    let value = null;
    if (controller && typeof controller[method] === 'function') {
      value = await controller[method]({ sessionId: id });
    } else if (registry && typeof registry[method] === 'function') {
      await registry[method](id);
    } else {
      return controlFail(res, 503, 'service-unavailable', '工作区服务暂时不可用，稍后再试');
    }
    controlOk(res, {
      pinned,
      scope: 'session',
      pinnedSessionIds: (value?.pinnedSessionIds ?? []).map(String),
      note: '置顶作用在会话上：官方只提供会话级置顶/取消置顶',
    });
  } catch (error) {
    return controlFail(res, controlStatusFor(error), 'pin-failed', controlHumanMessage(error));
  }
}

async function controlWorkspaceArchive(ctx, req, res) {
  let body;
  try {
    body = await controlReadBody(req);
  } catch (error) {
    return controlFail(res, 400, 'bad-body', controlHumanMessage(error));
  }
  // 明确不提供删除：归档可撤销，删除不可撤销
  if (body.delete === true || body.hard === true || body.permanent === true) {
    return controlFail(
      res,
      400,
      'delete-not-supported',
      '这里只做归档，不提供删除：归档可以撤销，删除不能',
    );
  }
  const id = body.id ?? body.sessionId;
  if (!controlIsSafeId(id)) return controlFail(res, 400, 'bad-id', '缺少会话 id');
  const stopActivity = body.stopActivity === true;

  const controller = controlService(ctx, 'workspaceController');
  const registry = controlService(ctx, 'workspaceRegistry');
  try {
    let archivedSessionIds = null;
    if (controller && typeof controller.archiveSession === 'function') {
      const value = await controller.archiveSession({ sessionId: id, stopActivity });
      archivedSessionIds = (value?.archivedSessionIds ?? []).map(String);
    } else if (registry && typeof registry.archiveSession === 'function') {
      await registry.archiveSession(id, { stopActivity });
    } else {
      return controlFail(res, 503, 'service-unavailable', '工作区服务暂时不可用，稍后再试');
    }
    controlOk(res, {
      archived: true,
      stoppedActivity: stopActivity,
      archivedSessionIds,
      note: '仅归档：会话文件与内容都保留，可以撤销',
    });
  } catch (error) {
    return controlFail(res, controlStatusFor(error), 'archive-failed', controlHumanMessage(error));
  }
}

async function controlSessionsInspect(ctx, url, res) {
  const persistence = controlService(ctx, 'sessionPersistence');
  const controller = controlService(ctx, 'sessionController');
  if (!persistence || typeof persistence.list !== 'function') {
    return controlFail(res, 503, 'service-unavailable', '会话存储服务暂时不可用，稍后再试');
  }

  const asked = Number(url.searchParams.get('limit'));
  const limit = Number.isFinite(asked)
    ? Math.min(Math.max(Math.trunc(asked), 1), CONTROL_SESSION_LIMIT_MAX)
    : CONTROL_SESSION_LIMIT;

  let snapshots = [];
  try {
    snapshots = await persistence.list({ signal: AbortSignal.timeout(8000) });
  } catch (error) {
    return controlFail(res, 500, 'list-failed', controlHumanMessage(error));
  }
  if (!Array.isArray(snapshots)) snapshots = [];

  const running = await controlRunningSessions(ctx);
  const canInspect = !!controller && typeof controller.inspect === 'function';
  const sessions = [];

  for (const snapshot of snapshots) {
    if (sessions.length >= limit) break;
    const header = snapshot?.header ?? null;
    const id = header?.id ? String(header.id) : '';
    if (!id) continue;

    let inspection = null;
    if (canInspect) {
      try {
        inspection = await controller.inspect(id, AbortSignal.timeout(4000));
      } catch (error) {
        sessions.push(
          controlSessionRow(id, null, header, snapshot, {
            severity: 'error',
            symptom: '这条会话的记录读不出来',
            suggestion: '可能损坏或被别的程序占用，先确认没有程序正在写它',
          }, running.has(id)),
        );
        continue;
      }
    }
    sessions.push(controlSessionRow(id, inspection, header, snapshot, null, running.has(id)));
  }

  controlJson(res, 200, {
    ok: true,
    version: CONTROL_VERSION,
    scannedAt: new Date().toISOString(),
    count: sessions.length,
    total: snapshots.length,
    truncated: snapshots.length > sessions.length,
    sessions,
  });
}

/* ── 路由分发与挂载 ───────────────────────────────────────── */

async function controlRoute(ctx, req, res) {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const path = url.pathname;
  const method = req.method === 'HEAD' ? 'GET' : req.method;

  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return controlFail(res, 403, 'bad-path', '路径不合法');
  }
  if (decoded.split(/[\\/]/).includes('..')) {
    return controlFail(res, 403, 'bad-path', '路径不合法');
  }

  if (method === 'OPTIONS') {
    res.writeHead(204, { Allow: 'GET, POST, OPTIONS' });
    res.end();
    return;
  }
  if (path === `${CONTROL_PREFIX}health` && method === 'GET') return controlHealth(ctx, res);
  if (path === `${CONTROL_PREFIX}workspaces` && method === 'GET') return controlWorkspaces(ctx, res);
  if (path === `${CONTROL_PREFIX}workspace/create` && method === 'POST') {
    return controlWorkspaceCreate(ctx, req, res);
  }
  if (path === `${CONTROL_PREFIX}workspace/rename` && method === 'POST') {
    return controlWorkspaceRename(ctx, req, res);
  }
  if (path === `${CONTROL_PREFIX}workspace/pin` && method === 'POST') {
    return controlWorkspacePin(ctx, req, res);
  }
  if (path === `${CONTROL_PREFIX}workspace/archive` && method === 'POST') {
    return controlWorkspaceArchive(ctx, req, res);
  }
  if (path === `${CONTROL_PREFIX}sessions/inspect` && method === 'GET') {
    return controlSessionsInspect(ctx, url, res);
  }
  return controlFail(res, 404, 'not-found', '没有这个接口');
}

/** 当前插件上下文：apply() 时赋值。控制中心的**两个载体共用**它来取官方服务。 */
let controlCtx = null;

/**
 * 载体无关的控制请求处理器 —— 3932x 本地服务与 webServer 备用路由**共用这一份**，
 * 不复制逻辑。任何异常都在这里转成人话 JSON，绝不上抛给调用方的 catch。
 */
function handleControl(req, res, ctx = controlCtx) {
  return Promise.resolve()
    .then(() => controlRoute(ctx, req, res))
    .catch((error) => {
      console.error('[dsh-liquid-glass] 控制中心接口失败:', error);
      try {
        if (!res.headersSent) controlFail(res, 500, 'internal', '服务器内部错误，请稍后再试');
        else res.end();
      } catch {
        /* 响应可能已经开始 */
      }
    });
}

/**
 * **备用**载体：webServer 可见时把同一条 prefix 路由也挂上去。
 *
 * 实测主路线走不通：本插件被 patch 在最外层，`ctx.get('webServer')` 拿不到该服务
 * （Cordis 服务查找是子→父单向的），连模块级 `export const inject = ['webServer']`
 * 也无效 —— 重启后 `/dshlg-control/health` 依然 404。
 * 因此**主载体是插件自己的 3932x 服务**（serve() 里按前缀分流），
 * 这里保留它只为「将来若可见就自动多一个载体」，注册失败只记日志、返回 null。
 */
function registerControlRoutes(ctx) {
  const webServer = controlService(ctx, 'webServer');
  if (!webServer || typeof webServer.register !== 'function') {
    console.info('[dsh-liquid-glass] webServer 不可见，控制中心只走 3932x 本地服务（本机既定路线）');
    return null;
  }
  try {
    const dispose = webServer.register({
      kind: 'prefix',
      path: CONTROL_PREFIX,
      handler: (req, res) => handleControl(req, res, ctx),
    });
    console.info(`[dsh-liquid-glass] 控制中心 API 额外挂到了 webServer: ${CONTROL_PREFIX}`);
    return typeof dispose === 'function' ? dispose : null;
  } catch (error) {
    console.error('[dsh-liquid-glass] 控制中心路由注册失败，插件其余功能照常:', error);
    return null;
  }
}

export function apply(ctx) {
  let server = null;

  const start = (index) => {
    if (index >= PORTS.length) {
      console.error('[dsh-liquid-glass] 所有候选端口都被占用，壁纸服务未启动');
      return;
    }
    const candidate = PORTS[index];
    const s = createServer((req, res) => {
      serve(req, res).catch((error) => {
        try {
          send(res, 500, 'internal error');
        } catch {
          /* 响应可能已开始 */
        }
        console.error('[dsh-liquid-glass] 伺服失败:', error);
      });
    });

    s.once('error', (error) => {
      if (error && error.code === 'EADDRINUSE') {
        start(index + 1);
      } else {
        console.error('[dsh-liquid-glass] 服务启动失败:', error);
      }
    });

    s.listen(candidate, '127.0.0.1', async () => {
      server = s;
      console.info(`[dsh-liquid-glass] 壁纸服务已启动: http://127.0.0.1:${candidate}/`);
      // 启动时先扫一遍：把 WE 目录挂上，并让日志里能看到发现了多少张
      try {
        const list = await listWallpapers();
        const usable = list.filter((w) => w.supported !== false);
        console.info(
          `[dsh-liquid-glass] 壁纸 ${list.length} 张（可用 ${usable.length}）：` +
            usable.map((w) => `${w.title}[${w.type}]`).join('、'),
        );
      } catch (error) {
        console.error('[dsh-liquid-glass] 启动扫描壁纸失败:', error);
      }
    });
  };

  try {
    start(0);
  } catch (error) {
    console.error('[dsh-liquid-glass] 启动抛错:', error);
  }

  // 控制中心：主载体就是上面这个 3932x 本地服务（serve() 里按前缀分流），
  // 所以只要能连上本机端口，控制 API 就一定在，不依赖任何拿不到的服务。
  // 这里记下 ctx 供两个载体共用，并顺手试一次 webServer 备用载体（失败不影响）。
  controlCtx = ctx;
  let disposeControl = null;
  try {
    disposeControl = registerControlRoutes(ctx);
  } catch (error) {
    console.error('[dsh-liquid-glass] 控制中心初始化异常（已忽略）:', error);
  }

  const stop = () => {
    try {
      disposeControl?.();
    } catch {
      /* 忽略 */
    }
    disposeControl = null;
    try {
      server?.close();
      server = null;
    } catch {
      /* 忽略 */
    }
  };

  if (typeof ctx?.effect === 'function') ctx.effect(() => stop);
  else if (typeof ctx?.on === 'function') ctx.on('dispose', stop);
}
