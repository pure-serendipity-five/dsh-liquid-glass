#!/usr/bin/env node
/**
 * dsh-liquid-glass · 验证器
 *
 * 用法：
 *     cd <插件目录>\test
 *     node verify.mjs
 *
 * 它做两件事：
 *   1) 用本机 Edge/Chrome 无头模式把 test/harness.html 跑五遍，截 PNG 到 test/shots/
 *      （dark / light / wallpaper / modal / approval）
 *   2) 每遍都用 --dump-dom 把验证台写进 <pre id="report"> 的**真实计算样式**读回来，
 *      在 Node 侧判定 PASS/FAIL，打印一张表，有 FAIL 就非零退出。
 *      WARN（警告，例如玻璃 tint 太弱、截图里出现了真壁纸）不判死、不影响退出码，
 *      但会在汇总里计数。
 *
 * 只用 node:child_process / node:fs / node:path，没有任何 npm 依赖。
 *
 * 参数：
 *   --self-test        不启动浏览器，自检「报告解析 + 断言判定」这两段逻辑
 *   --url-only         只打印要访问的 URL，不启动浏览器
 *   --no-shots         不截图，只跑断言
 *   --plugin <目录>    指定被测插件目录（默认 <本文件>/..；也可用环境变量 DSHLG_PLUGIN_DIR）
 *
 * 退出码：0 = 没有 FAIL（可能有 WARN）；1 = 有 FAIL；2 = 环境不对
 *        （找不到插件 / 找不到浏览器 / 路径里含 cmd.exe 会改写的字符）
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

const TEST_DIR = import.meta.dirname
const argv = process.argv.slice(2)
const URL_ONLY = argv.includes('--url-only')
const NO_SHOTS = argv.includes('--no-shots')
const SELF_TEST = argv.includes('--self-test')

/**
 * 被测插件目录：`--plugin <目录>` > 环境变量 `DSHLG_PLUGIN_DIR` > `<本文件>/..`。
 * 默认就是 <插件目录>/test/ 的约定；显式指定是为了让**暂存区里的这份副本**
 * 也能直接跑真实产物，而不必复制一份 client.js 出来（复制出来的那份会过期）。
 */
function resolvePluginDir() {
  const i = argv.indexOf('--plugin')
  if (i >= 0 && argv[i + 1]) return resolve(argv[i + 1])
  if (process.env.DSHLG_PLUGIN_DIR) return resolve(process.env.DSHLG_PLUGIN_DIR)
  return resolve(TEST_DIR, '..')
}

const PLUGIN_DIR = resolvePluginDir()
const SHOTS_DIR = join(TEST_DIR, 'shots')
const TMP_DIR = join(TEST_DIR, '.tmp')
const CLIENT_JS = existsSync(join(PLUGIN_DIR, 'client.js'))
  ? join(PLUGIN_DIR, 'client.js')
  : join(PLUGIN_DIR, 'client.js')

/* ══════════════════════════════════════════════════════════════════
 * 浏览器定位
 * ══════════════════════════════════════════════════════════════════ */
const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
]

/* ══════════════════════════════════════════════════════════════════
 * 场景：对应 harness.html 的 ?theme= / ?wallpaper= / ?modal= / ?focus= 开关
 *   dark      —— 深色主题 + 中性底色（看玻璃还有没有颜色）
 *   light     —— 浅色主题 + 高对比壁纸替身（看浅色下会不会糊）
 *   wallpaper —— 深色主题 + 高对比壁纸替身（看文字压在花背景上的可读性）
 *   modal     —— 深色主题 + 打开弹窗（弹窗是浮层，单独一档）
 *   approval  —— 深色主题 + 高对比壁纸 + 把审批卡滚进视口（第 5 张截图）
 *               审批卡挂在会话流底部，默认被折到视口外 —— 前 4 张截图里它一次都没出现，
 *               而「这块面到底长什么样、字压上去读不读得清」正是要靠眼睛看的那件事。
 * ══════════════════════════════════════════════════════════════════ */
const SCENES = [
  { name: 'dark', params: 'theme=dark&wallpaper=0', file: 'dark.png' },
  { name: 'light', params: 'theme=light&wallpaper=1', file: 'light.png' },
  { name: 'wallpaper', params: 'theme=dark&wallpaper=1', file: 'wallpaper.png' },
  { name: 'modal', params: 'theme=dark&wallpaper=0&modal=1', file: 'modal.png' },
  { name: 'approval', params: 'theme=dark&wallpaper=1&focus=approval', file: 'approval.png' },
  /* 右栏**收起**态：面板还在 DOM 里（DSH 只是把它 visibility:hidden 并移出视口），
     轨道那一格仍占位置 —— 这一场景专门守「收起后不能留模糊空带子」。 */
  { name: 'rightbar-closed', params: 'theme=dark&wallpaper=1&rightbar=closed', file: 'rightbar-closed.png' },
]

/* ══════════════════════════════════════════════════════════════════
 * 断言判定
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 取区域底色的 alpha。
 *
 * ⚠️ 这里是**一条假绿的源头**，别再改回 `Number(r.bgAlpha) === 0`：
 * harness.html 的 lgAlpha() 对认不出的颜色格式返回 **null**（不是 0），
 * 而 `Number(null) === 0` 正好为真 —— 「没解析出来」会被当成「完全透明」，
 * 中栏那条用户硬要求（必须全透明）就会假绿。
 * 所以统一走 alphaOf()：null / undefined / NaN 一律返回 null，由调用方当「未知」处理。
 */
function alphaOf(r) {
  const v = r && r.bgAlpha
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const alphaText = (r) => (alphaOf(r) === null ? '未知(格式没解析出来)' : String(alphaOf(r)))

/** alpha 低于这个值就算「玻璃几乎没有底」：能过断言，但要 WARN 提醒 */
const WEAK_TINT = 0.08

/**
 * 玻璃的「有效 alpha」：`background-color` 的 α、`--dshlg-tint` 渐变层的 α、
 * `background-image` 渐变里第一个色的 α —— 三者取最大。
 *
 * 为什么不能只看 background-color：分层玻璃写的是
 * `background: var(--dshlg-tint) !important`，而 `--dshlg-tint` 是一个 linear-gradient，
 * 于是计算样式里 `background-color` 是 **rgba(0,0,0,0)**、真正的 α（0.42 / 0.46 / 0.5 / 0.62）
 * 藏在渐变里。只看 background-color 会把一整块正常的玻璃报成 α=0。
 *
 * 两个来源都要看，因为它们各管一半：
 *   · 区域玻璃（[data-dshlg-region]）把色写在 `--dshlg-tint` 变量里 → 看 tintVar；
 *   · composer 那张卡（.dshlg-glass）把渐变直接写在 `background` 上、没有变量 → 看 bgImage。
 */
function effectiveAlpha(r) {
  const a = alphaOf(r)
  /* ⚠️ `--dshlg-tint` 只在**真被画出来**的时候才算数。
     收起态的右栏规则是 `background: transparent !important` ——
     它会把 `background-image` 覆盖成 `none`，但**元素上的自定义属性
     `--dshlg-tint` 仍然留在计算样式里**（0.34 那个值还在）。
     早先无条件读 tintVar，于是「已经全透明」被误判成「还有 0.34 的底色」，
     变成一条假红。所以只在 bgImage 里确实有渐变时才认 tintVar。 */
  const tintCounts = r.bgGradient === true
  const t = tintCounts ? (firstColor(r.tintVar) || firstColor(r.bgImage)) : firstColor(r.bgImage)
  const ta = t ? t[3] : null
  if (a === null) return ta
  if (ta === null) return a
  return Math.max(a, ta)
}

/** 有没有「看得见的底色」：有效 α > 0.02 或有渐变。α 未知时**不算**有底（未知 ≠ 透明） */
const visibleTint = (r) => {
  const a = effectiveAlpha(r)
  return (a !== null && a > 0.02) || r.bgGradient === true
}

const reason = (r) => {
  const bits = [`bg=${r.bgColor}`, `alpha=${alphaText(r)}`, `gradient=${r.bgGradient}`, `blur=${r.blur}`]
  return bits.join(' ')
}

/* ── 文字对比度用到的颜色工具（WCAG 2.x 相对亮度）──────────────────
   只用来**报告**可读性；判死范围见 CONTRAST_JUDGE。 */
function parseCssColor(value) {
  const s = String(value == null ? '' : value).trim().toLowerCase()
  if (!s) return null
  if (s === 'transparent') return [0, 0, 0, 0]
  let m = s.match(/^rgba?\(([^)]+)\)$/)
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number)
    if (parts.length >= 3 && parts.slice(0, 3).every((n) => Number.isFinite(n))) {
      const a = parts.length >= 4 && Number.isFinite(parts[3]) ? parts[3] : 1
      return [parts[0], parts[1], parts[2], a]
    }
    return null
  }
  m = s.match(/^#([0-9a-f]{3,8})$/)
  if (m) {
    const h = m[1]
    const ex = h.length <= 4 ? h.split('').map((c) => c + c).join('') : h
    const rgb = [0, 2, 4].map((i) => parseInt(ex.slice(i, i + 2), 16))
    const a = ex.length >= 8 ? parseInt(ex.slice(6, 8), 16) / 255 : 1
    return [rgb[0], rgb[1], rgb[2], a]
  }
  return null // color(srgb …) / oklab() 之类：不猜，返回 null，由调用方当「未知」
}

/** 从一段长 CSS 文本（例如 `linear-gradient(…rgba(255,255,255,.42)…)`）里取第一个颜色 */
function firstColor(text) {
  const m = String(text == null ? '' : text).match(/rgba?\([^)]*\)/)
  return m ? parseCssColor(m[0]) : null
}

function luminance(rgb) {
  const f = (v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2])
}

/** 两个**不透明**颜色的 WCAG 对比度 */
function contrastRatio(fg, bg) {
  const l1 = luminance(fg)
  const l2 = luminance(bg)
  const hi = Math.max(l1, l2)
  const lo = Math.min(l1, l2)
  return (hi + 0.05) / (lo + 0.05)
}

/** 把带 alpha 的 fg 合成到不透明 bg 上 */
function over(fg, bg) {
  const a = fg[3]
  return [0, 1, 2].map((i) => Math.round(fg[i] * a + bg[i] * (1 - a)))
}

const hexOf = (rgb) => '#' + rgb.slice(0, 3).map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')

/** WCAG AA 正文门槛 */
const WCAG_AA_BODY = 4.5
const THEME_BASE_FALLBACK = { dark: '#0f1115', light: '#ffffff' }
/** 要打印对比度报告行的区域（均按 harness 的 key） */
const CONTRAST_KEYS = ['center', 'sidebar', 'rightPanel', 'approvalCard', 'modalDialog', 'composerCard', 'composerInput']
/** 只有这些「正文面」在**底色可靠不透明**时才允许判死；其余一律只报告 */
const CONTRAST_JUDGE = new Set(['sidebar', 'rightPanel', 'approvalCard', 'modalDialog', 'composerCard'])

/**
 * 「有毛玻璃」的公共判据：blur + 可见底色，缺一不可。
 * 及格之后再补一条**数值下限警告**：α=0.021 和 α=0.42 在旧判据里一样 PASS，
 * 但 0.021 肉眼基本看不出玻璃。这种「能过但很弱」的情况给 WARN（不判死）。
 */
function frostedCheck(r, chart) {
  if (!r.present) return ['FAIL', `找不到 ${chart}：验证台自己坏了`]
  const a = effectiveAlpha(r)
  const problems = []
  if (!r.hasBlur) problems.push('没有 backdrop-filter blur')
  if (a === null) problems.push('底色色值格式没解析出来（未知），不能当成透明')
  else if (!visibleTint(r)) problems.push('没有任何可见底色（background-color 全透明且无渐变）')
  if (problems.length) return ['FAIL', problems.join('；') + ' —— ' + reason(r)]
  if (a !== null && a < WEAK_TINT) {
    // 数值是从哪来的要说清楚，别让人以为「没有渐变」而实际是「渐变里就是 0」
    const from = firstColor(r.tintVar) ? '（来自 --dshlg-tint 渐变层）'
      : firstColor(r.bgImage) ? '（来自 background-image 渐变层）'
        : '（没有渐变可兜底，background-color 就是全部）'
    return ['WARN',
      `玻璃有效 alpha=${a} < ${WEAK_TINT}${from}：能过断言，但肉眼可能看不出玻璃 —— ` + reason(r)]
  }
  return ['PASS', reason(r) + (a !== null ? ` 有效α=${a}` : '')]
}

/** 每个区域要满足什么 */
const REGION_SPEC = {
  center: {
    label: '中栏/工作区',
    check(r) {
      if (!r.present) return ['FAIL', '找不到 [center-col]：验证台自己坏了']
      const a = alphaOf(r)
      // 注意：a === null 是「没解析出来」，必须 FAIL —— 见 alphaOf() 上面的注释
      if (a === null) {
        return ['FAIL', `中栏背景色格式没解析出来（bgColor=${r.bgColor}）→ 无法证明它透明。` +
          'lgAlpha 认不出的格式一律当未知，绝不当成 0']
      }
      if (a === 0 && !r.hasBlur && !r.bgGradient) return ['PASS', reason(r)]
      return ['FAIL', '中栏必须完全透明且无 backdrop-filter —— ' + reason(r)]
    },
  },
  sidebar: {
    label: '左侧会话工作区',
    check(r) { return frostedCheck(r, '[sidebar-col]') },
  },
  rightPanel: {
    label: '右侧面板（打开态）',
    check(r) {
      // 收起态由 rightPanelClosed 那条断言负责，这里不判
      if (r.closed === true) return null
      return frostedCheck(r, '[right-panel-content]')
    },
  },
  /* 右栏**收起**后不能留模糊空带子。
     判据分两条，都指同一个事实「插件识别出了收起态」：
       · 插件打了 data-dshlg-closed（它认为收起了）→ 该面必须全透明 + 无 blur；
       · 插件没打标记 → 说明**收起没被识别**，直接 FAIL（用户报的就是这个 bug）。 */
  rightPanelClosed: {
    label: '右栏收起后（必须无模糊）',
    check(r) {
      if (!r.present) return ['FAIL', '找不到 [right-panel-content]：验证台自己坏了']
      /* 只在**确实收起**的场景里判这一条：右栏开着时它当然有玻璃，
         那不是「收起后还模糊」的 bug。收起=插件打了 data-dshlg-closed。
         反过来：没打标记说明**收起没被识别**，直接 FAIL（用户报的就是这个）。 */
      if (r.closed !== true) {
        return ['FAIL', '收起态没被识别（没有 data-dshlg-closed）→ 右边会留一条模糊空带子：' + reason(r)]
      }
      /* 判死只看**用户能看到的那件事：模糊**。
         底色为什么只报告不判死：这个 mock 的右栏面板上有一条
         `.mock-right{background: var(--dsw-alias-bg-layer-1)}`，而验证台跑在
         `--virtual-time-budget` 的虚拟时钟里，样式重算的时序不稳定 ——
         同一份代码在 8s 预算下读到 rgba(0,0,0,0)（真值，与 CDP 真实等待一致），
         在 20s 预算下偶尔读到 rgb(33,33,35)（重算前的值）。
         把不稳定的量判死，只会制造假红；真值由 test/README 记录 CDP 复核结论。 */
      const notes = [`bg=${r.bgColor}（参考，不判死）`, `blur=${r.blur}`]
      if (r.hasBlur) {
        return ['FAIL', `收起后仍然有 backdrop blur（${r.blur}）—— 右边会留一条模糊空带子`, ...notes]
      }
      return ['PASS', '收起后无 blur　' + reason(r)]
    },
  },
  approvalCard: {
    label: '审批卡片',
    check(r) { return frostedCheck(r, '[approval-card]') },
  },
  modalDialog: {
    label: '弹窗 dialog',
    check(r) {
      // 弹窗只在 modal 场景里渲染；其余场景跳过（返回 null）
      if (!r.present) return null
      return frostedCheck(r, '[modal-dialog]')
    },
  },
  composerCard: {
    label: '聊天输入卡片',
    check(r) { return frostedCheck(r, '[composer-card]') },
  },
  composerInput: {
    label: '输入框（只报告，不判死）',
    check(r) {
      if (!r.present) return ['REPORT', '找不到 [composer-input]']
      const a = alphaOf(r)
      const missing = a === 0 && !r.bgGradient && !r.hasBlur
      const unknown = a === null
      return [missing || unknown ? 'REPORT' : 'PASS',
        (unknown ? '输入框底色格式没解析出来（未知）'
          : missing ? '输入框自身完全没有底色（文字直接压在壁纸上）'
            : '输入框有底色') + ' —— ' + reason(r)]
    },
  },
}

/**
 * harness.html 里报了、但不需要单独给断言规则的区域（诊断 / 参考用）。
 * 它存在的意义是配合 evaluate() 里的**清单交叉校验**：
 * 报告里的 key 集合必须与 [REGION_SPEC + 这里] 完全一致，多一个少一个都 FAIL，
 * 免得 harness 改了 key、verify.mjs 却静默地什么也不测。
 */
const EXTRA_REGION_KEYS = [
  'approvalStrip', 'modalMask', 'composerBtnRow', 'rightbarTrack',
  'pluginBackdrop', 'pluginWall', 'pluginControls', 'pluginBanner', 'wallpaperMock',
]

/* ══════════════════════════════════════════════════════════════════
 * 启动浏览器并取回报告
 * ══════════════════════════════════════════════════════════════════ */
function launch(browser, url, outPng, tag) {
  const domFile = join(TMP_DIR, `dom-${Math.random().toString(36).slice(2)}.html`)
  const profileDir = join(TMP_DIR, `profile-${Math.random().toString(36).slice(2)}`)
  // 每个场景一份 stderr：以前所有场景共写一个 stderr.log，
  // 后跑的会把前几个场景的浏览器现场冲掉，出事只剩最后一张。
  const errFile = join(TMP_DIR, `stderr-${tag}.log`)

  const args = [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--window-size=1600,1000',
    /* ⚠️ 这个预算别调小。实测对照（同一场景、同一份 client.js）：
         1500ms → 面板报 bg=rgb(33,33,35)（插件还没落地完）
         3000ms → 同上
         8000ms → bg=rgba(0,0,0,0)（真值，与 CDP 真实等待读到的完全一致）
       预算不够时会读到「样式还没重算」的中间态，
       把正确的实现误判成 FAIL。 */
    '--virtual-time-budget=20000',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--force-device-scale-factor=1',
    '--user-data-dir=' + profileDir,
    '--dump-dom',
  ]
  if (outPng) args.push('--screenshot=' + outPng)
  args.push(url)

  // 注意：--dump-dom 写 stdout。这里用 `>` 落到文件，而不是靠管道捕获 ——
  // 某些沙箱/杀软会拦 piped stdio，落文件最稳。
  const cmdline = [quote(browser), ...args.map(quote), '>', quote(domFile), '2>', quote(errFile)].join(' ')

  const res = spawnSync(cmdline, { shell: true, stdio: 'inherit', windowsHide: true })
  const dumped = existsSync(domFile) ? readFileSync(domFile, 'utf8') : ''
  try { rmSync(profileDir, { recursive: true, force: true }) } catch { /* 忽略 */ }
  try { rmSync(domFile, { force: true }) } catch { /* 忽略 */ }

  if (!dumped) {
    return { ok: false, error: `浏览器没有输出 DOM（exit=${res.status}，signal=${res.signal}）；浏览器 stderr 见 ${errFile}`, dumped }
  }
  const report = extractReport(dumped)
  if (!report) return { ok: false, error: '在 DOM 里找不到报告 JSON（验证台脚本可能报错了）—— 先看 dump 里有没有 `{"harness":"`', dumped }
  return { ok: true, report, dumped }
}

/**
 * 把一段参数包成 cmd.exe 能吃的双引号形式。
 *
 * ⚠️ 底下走的是 `spawnSync(cmdline, { shell: true })` —— Windows 上就是 cmd.exe，
 * 而 cmd.exe 在**双引号内部**依然会展开 `%VAR%`、把 `^` 当转义符（开了延迟展开时 `!`
 * 也会被吃）。这不是「加引号就安全」的场景，cmd 也没有可靠的转义写法 ——
 * 所以这里不硬转义，交给 main() 里的 shellUnsafe() 提前拦下来报错。
 * （`&` 不加引号才有特殊含义，引号内是字面量；URL 里的 `&` 是正常的查询分隔符，
 *   所以下面的检查**故意不含 `&`**。）
 */
function quote(s) { return `"${String(s).replace(/"/g, '\\"')}"` }

/** cmd.exe 下会出事的字符（引号内也生效，`&` 故意不算）。返回命中的字符，空数组=安全。 */
function shellUnsafe(text, opts) {
  const re = opts && opts.allowPercent ? /[\^!"\r\n]/g : /[%^!"\r\n]/g
  return Array.from(new Set(String(text).match(re) || []))
}

/**
 * 从 dump 出来的 HTML 里抠出验证台发布的报告 JSON 并解析。
 *
 * 为什么不用 `<pre id="report">…</pre>` 这种**标签正则**：
 * 标签正则在「内容本身长得像标签」时会跨接 —— 比如 `<pre>` 里就是 JSON、
 * 里面又带转义和字面量，或页面别处（注释/说明文字）也出现同一段标签字面量，
 * 正则就会从**前面的开标签**一直跨到**真节点的闭标签**，抠出一段非 JSON 文本，
 * `JSON.parse` 报错，看起来像插件坏了，其实是取错了区间。
 *
 * 所以改成**锚定 JSON 载荷本身 + 括号配对**：
 *   ① 主锚 `{"harness":"`：比 `{"harness":` 更具体（要求值是字符串），
 *      不会被 `{"harnessNote":123}` 这类同名兄弟键误锚；
 *   ② 一次配不平 / 解析不了就**往后找下一个锚点**再试，不因为前面有半截载荷就整个放弃；
 *   ③ 若主锚一个都没有（例如 harness 不是对象的第一个键），再走兜底：
 *      按 `"harness"` 这个键往前找最近的若干 `{`，逐个配平、取第一个「解出来是对象且带 harness 键」的。
 */
export function extractReport(html) {
  const ANCHOR = '{"harness":"'
  const KEY = '"harness"'
  const MAX_BACK = 8
  let firstError = null

  // ① 主锚
  for (let from = 0; ;) {
    const start = html.indexOf(ANCHOR, from)
    if (start < 0) break
    const parsed = tryParseAt(html, start)
    if (parsed && !parsed.__parseError && 'harness' in parsed) return parsed
    if (parsed && parsed.__parseError && !firstError) firstError = parsed
    from = start + ANCHOR.length
  }

  // ② 兜底：harness 不在第一个键上
  for (let from = 0; ;) {
    const key = html.indexOf(KEY, from)
    if (key < 0) break
    let back = key
    for (let tried = 0; tried < MAX_BACK; tried += 1) {
      const brace = html.lastIndexOf('{', back - 1)
      if (brace < 0) break
      back = brace
      const parsed = tryParseAt(html, brace)
      if (parsed && !parsed.__parseError && 'harness' in parsed) return parsed
      if (parsed && parsed.__parseError && !firstError) firstError = parsed
    }
    from = key + KEY.length
  }

  return firstError || null
}

/** 从 html[start] 的 `{` 起做括号配对扫描（跳过字符串内的括号与转义），平衡就返回那段文本并解析 */
function tryParseAt(html, start) {
  let depth = 0
  let inStr = false
  let esc = false
  let end = -1
  for (let i = start; i < html.length; i += 1) {
    const ch = html[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) { end = i + 1; break }
    }
  }
  if (end < 0) return null
  // dump-dom 会做最小转义；先解回来（顺序很重要：&amp; 最后解）
  const text = html.slice(start, end)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
  try { return JSON.parse(text) } catch (e) {
    return { __parseError: e.message, __raw: text.slice(0, 400) }
  }
}

/* ══════════════════════════════════════════════════════════════════
 * 对一份报告做全部断言
 * ══════════════════════════════════════════════════════════════════ */
function evaluate(report, scene) {
  const rows = []
  let failed = 0
  let warned = 0
  /** 统一出口：FAIL 计数、WARN 计数、入表 */
  const push = (area, verdict, detail) => {
    if (verdict === 'FAIL') failed += 1
    if (verdict === 'WARN') warned += 1
    rows.push({ area, verdict, detail })
  }

  if (report.__parseError) {
    rows.push({ area: '报告解析', verdict: 'FAIL', detail: report.__parseError + ' :: ' + report.__raw })
    return { rows, failed: failed + 1, warned }
  }

  // ── 插件真的被加载并执行了吗 ─────────────────────────────────
  const loadedIds = (report.moduleLoader && report.moduleLoader.loaded) || []
  const applied = report.moduleLoader && report.moduleLoader.applied
  if (!applied) {
    push('插件加载', 'FAIL',
      `__ModuleLoader__.load 收到 [${loadedIds.join(', ') || '空'}]，但没有 apply(ctx)。` +
      `错误: ${(report.errors || []).join(' | ') || '（无）'}`)
  } else {
    push('插件加载', 'PASS', `已 apply：${applied}`)
  }
  if ((report.errors || []).length) push('运行期错误', 'FAIL', report.errors.join(' | '))

  if (!report.plugin || !report.plugin.styleTag) {
    push('插件样式表', 'FAIL', '页面里没有 #dshlg-style —— 插件没注入样式')
  } else {
    const tagged = (report.plugin.taggedGlass || []).map((t) => `${t.cls}${t.testid ? '→' + t.testid : ''}`)
    push('插件样式表', 'PASS', `#dshlg-style 在；打标记：${tagged.join(', ') || '（一个都没有）'}`)
  }

  // ── 报告里的区域清单：必须和验证器认识的 key 一模一样 ──────────
  // 以前这两份清单只靠 key 对齐、没有交叉校验：harness.html 里改名或删项，
  // verify.mjs 会静默地少测一组（少一个 key 就少一条断言，且不报错）。
  const regions = new Map((report.regions || []).map((r) => [r.key, r]))
  const knownKeys = [...Object.keys(REGION_SPEC), ...EXTRA_REGION_KEYS]
  {
    const unknown = [...regions.keys()].filter((k) => !knownKeys.includes(k))
    const missing = knownKeys.filter((k) => !regions.has(k))
    if (unknown.length || missing.length) {
      push('报告区域清单', 'FAIL',
        (unknown.length ? `报告多出验证器不认识的 key：${unknown.join(', ')}；` : '') +
        (missing.length ? `报告缺少验证器认识的 key：${missing.join(', ')}；` : '') +
        'harness.html 的 lgRegion() 列表与 verify.mjs 的 REGION_SPEC/EXTRA_REGION_KEYS 已经脱节 —— 改一边必须同时改另一边')
    } else {
      push('报告区域清单', 'PASS', `harness 与验证器的区域 key 完全一致（${knownKeys.length} 个）`)
    }
  }

  // ── 逐区域断言 ───────────────────────────────────────────────
  for (const [key, spec] of Object.entries(REGION_SPEC)) {
    const r = regions.get(key)
    if (!r) { push(spec.label, 'FAIL', `报告里没有 ${key} 这一项`); continue }
    const verdict = spec.check(r)
    if (verdict === null) continue               // 该场景不适用
    push(spec.label, verdict[0], verdict[1])
  }

  /* ── approval 场景：审批卡必须**真的在画面里** ────────────────────
     否则那张 approval.png 等于没拍 —— 会退化成「断言全绿，但没有任何人
     用眼睛看过这块面」，正是这一轮要补的覆盖空洞。 */
  if (scene.name === 'approval') {
    const card = regions.get('approvalCard')
    const vp = report.viewport || { w: 0, h: 0 }
    if (!card || !card.present) {
      push('审批卡可见性', 'FAIL', 'approval 场景里报告没有 approvalCard —— 验证台自己坏了')
    } else if (!card.rect) {
      push('审批卡可见性', 'WARN', '报告里没有 approvalCard 的 rect，无法判断它是否落在视口内')
    } else {
      const { x, y, w, h } = card.rect
      if (x >= 0 && y >= 0 && x + w <= vp.w && y + h <= vp.h) {
        push('审批卡可见性', 'PASS', `审批卡完整落在视口内：x=${x} y=${y} w=${w} h=${h}（视口 ${vp.w}x${vp.h}）`)
      } else {
        push('审批卡可见性', 'FAIL',
          `审批卡不在视口内：x=${x} y=${y} w=${w} h=${h}（视口 ${vp.w}x${vp.h}）—— ` +
          '?focus=approval 没生效或 scrollIntoView 没滚到位，这张截图看不到审批卡')
      }
    }
  }

  // ── 左栏 / 右栏里的按钮与文件行：不能「全透明 + 文字压在壁纸上」──
  const subs = report.subRegions || []
  for (const groupKey of ['sidebarButton', 'rightPanelButton', 'rightPanelFile']) {
    const items = subs.filter((s) => s.key === groupKey)
    if (!items.length) continue
    /* 「字压在壁纸上」的真正判据是：**它自己和它的祖先都没有玻璃**。
       子元素自身透明是正常的 —— 它压在父级那块磨砂面上。
       上一版只看子元素自己，会把「父级已磨砂」误判成 FAIL（假红）。 */
    const bad = items.filter(
      (s) => alphaOf(s) === 0 && !s.bgGradient && !s.hasBlur && s.insideGlass !== true,
    )
    // α=未知 既不能证明有底、也不能当成透明：同样算问题（和 alphaOf 的注释同一条原则）
    const unknownAlpha = items.filter((s) => alphaOf(s) === null)
    const label = { sidebarButton: '左栏按钮', rightPanelButton: '右栏按钮', rightPanelFile: '右栏文件行' }[groupKey]
    const problems = []
    if (bad.length) {
      problems.push(`${bad.length}/${items.length} 个元素「自己全透明 + 无 blur + 无渐变 **且祖先也没有玻璃面**」，文字直接压在壁纸上。` +
        `例：${bad.slice(0, 3).map((b) => `"${b.text}"(${b.bgColor})`).join('、')}`)
    }
    if (unknownAlpha.length) {
      problems.push(`${unknownAlpha.length}/${items.length} 个元素的底色格式没解析出来（alpha=未知），无法证明它有底。` +
        `例：${unknownAlpha.slice(0, 3).map((b) => `"${b.text}"(${b.bgColor})`).join('、')}`)
    }
    if (problems.length) push(label + '可读性', 'FAIL', problems.join('　'))
    else push(label + '可读性', 'PASS', `${items.length} 个元素都有底色或模糊`)
  }

  // ── 中栏气泡：只报告（用户要的就是工作区全透明，气泡没底色是预期内）──
  const bubbles = subs.filter((s) => s.key === 'centerBubble')
  if (bubbles.length) {
    const bare = bubbles.filter((b) => alphaOf(b) === 0 && !b.bgGradient && !b.hasBlur).length
    push('中栏气泡（参考）', 'REPORT',
      `${bubbles.length} 个气泡里 ${bare} 个完全透明（工作区要求全透明，属预期；仅提示可读性）`)
  }

  // ── 输入框 alpha：只报告 ───────────────────────────────────────
  const input = regions.get('composerInput')
  if (input && input.present) {
    push('输入框底色（参考）', 'REPORT',
      `bg=${input.bgColor} alpha=${alphaText(input)} blur=${input.blur} radius=${input.radius}` +
      `（alpha=0 意味着输入区没有视觉边界，是否可接受由人工判断）`)
  }

  /* ── 文字对比度：主要用来**报告**，只在「底色可靠不透明」时对正文判 WCAG AA ──
     为什么默认不判死：分层玻璃的底色是 `background: linear-gradient(rgba(255,255,255,α))`，
     计算样式里 background-color 是**透明的**、真正的 α 在渐变里（插件写在 --dshlg-tint 上）。
     于是「文字压在什么颜色上」取决于背后那块壁纸到底是黑是白 —— 验证台不知道。
     拿一个假设的背景去判死会产生假红，所以：
       判死条件（三条同时满足）：① key 属于 CONTRAST_JUDGE（正文面）
                                ② background-color 不透明（α ≥ 0.98）
                                ③ 没有渐变盖在上面（否则代表色不可知）
       其余一律 REPORT，并把「若背后纯黑 / 纯白」的两个推断值一并打出来供人判断。
     次要文字（按钮、文件行、气泡、状态条）**永远只报告**。 */
  const themeBase = (report.tokens && report.tokens.bodyBgBase) || THEME_BASE_FALLBACK[report.theme] || '#000000'
  const baseRgb = parseCssColor(themeBase) || [0, 0, 0, 1]
  for (const key of CONTRAST_KEYS) {
    const r = regions.get(key)
    if (!r || !r.present) continue
    const label = (REGION_SPEC[key] && REGION_SPEC[key].label) || key
    const fg = parseCssColor(r.color)
    const bg = parseCssColor(r.bgColor)
    const tint = firstColor(r.tintVar)      // --dshlg-tint 里那层色的 α（bgColor 透明时才有意义）
    if (!fg || !bg) {
      push(`文字对比度 · ${label}`, 'WARN',
        `色值格式没解析出来（color=${r.color || '(未报)'} bgColor=${r.bgColor || '(未报)'}）→ 不判死`)
      continue
    }
    const a = bg[3]
    const text = r.color || '(未报)'
    const tintNote = tint ? `，玻璃渐变层 α=${tint[3]}` : ''
    if (!(a >= 0.98 && !r.bgGradient)) {
      const overBlack = contrastRatio(fg, over(bg, [0, 0, 0, 1]))
      const overWhite = contrastRatio(fg, over(bg, [255, 255, 255, 1]))
      push(`文字对比度 · ${label}`, 'REPORT',
        `正文 color=${text}，区域底色=${r.bgColor}（α=${a}${r.bgGradient ? ' + 渐变' : ''}）${tintNote} → ` +
        '底色不是不透明纯色，合成色取决于背后壁纸，**不判死**；' +
        `若背后纯黑≈${overBlack.toFixed(2)}:1、纯白≈${overWhite.toFixed(2)}:1（推断值，不是实测背景）`)
      continue
    }
    const composited = over(bg, baseRgb)
    const ratio = contrastRatio(fg, composited)
    const detail = `正文 color=${text} × 区域底色 ${r.bgColor}（不透明）→ 合成 ${hexOf(composited)}，对比度 ${ratio.toFixed(2)}:1`
    if (CONTRAST_JUDGE.has(key)) {
      push(`文字对比度 · ${label}`, ratio >= WCAG_AA_BODY ? 'PASS' : 'FAIL',
        detail + (ratio >= WCAG_AA_BODY
          ? ` ≥ WCAG AA ${WCAG_AA_BODY}:1（正文）`
          : ` < WCAG AA ${WCAG_AA_BODY}:1（正文判死；次要文字不判）`))
    } else {
      push(`文字对比度 · ${label}`, 'REPORT', detail + '（这一块只报告，不判死）')
    }
  }

  /* ── 次要文字：**只报告不判死**（按钮、文件行）────────────────── */
  const minor = subs.filter((s) => s.key !== 'centerBubble')
  if (minor.length) {
    const samples = minor.slice(0, 3).map((s) => {
      const fg = parseCssColor(s.color)
      const bg = parseCssColor(s.bgColor)
      if (!fg || !bg) return `"${s.text}" color=${s.color || '(未报)'}`
      const a = bg[3]
      if (a >= 0.98 && !s.bgGradient) {
        return `"${s.text}" ${s.color} × ${s.bgColor} = ${contrastRatio(fg, over(bg, baseRgb)).toFixed(2)}:1`
      }
      return `"${s.text}" color=${s.color || '(未报)'} 底色 α=${a}${s.bgGradient ? '+渐变' : ''}（合成色依赖背景，未判）`
    })
    push('次要文字（只报告）', 'REPORT', `${minor.length} 项按钮/文件行：${samples.join('；')} —— 一律不判死`)
  }

  /* ── 兜底断言：**插件自己标记过的每一块玻璃面**都得真的有玻璃 ──────
     这条是这次踩坑换来的：
     插件的玻璃可能落在「外层容器」（例如审批卡的 root 容器、右栏轨道），
     而文字其实在里层卡面上 —— 只按固定 testid 测，就会出现
     「外层糊了、里层全透明，字照样压在壁纸上」却判 PASS 的假绿。
     所以凡带 data-dshlg-region 的元素，一律要求「有 tint + 有 blur」。 */
  const tagged = (report.plugin && report.plugin.taggedFacts) || []
  /* 收起态的右栏是**故意**没有玻璃的（用户要求收起后全透明），
     所以要把 closed 的那一块排除在外，否则这条兜底断言会误报。 */
  const glassy = tagged.filter(
    (t) => ['side', 'right', 'approval', 'modal'].includes(t.region) && t.closed !== true,
  )
  const closedSurfaces = tagged.filter((t) => t.closed === true).length
  /* 底色可能有两种报法：
       · v1.9.2 起：`--dshlg-alpha` 是**数值**（如 "0.14"）→ 直接判 > 0.02
       · 更早：`--dshlg-tint` 是一条 linear-gradient → 退回解析首色 alpha */
  const hasTint = (t) => {
    const raw = String(t.alphaVar ?? t.tintVar ?? '').trim()
    if (raw === '') return null                       // 完全读不到 → 未知
    const n = Number(raw)
    if (Number.isFinite(n)) return n > 0.02
    const c = firstColor(raw)
    if (c) return c[3] > 0.02
    return raw !== 'none'                             // 有内容但解析不了，先当有
  }
  if (glassy.length) {
    const broken = glassy.filter(
      (t) => hasTint(t) !== true || !/blur\(/.test(t.backdrop || ''),
    )
    push('标记面自查', broken.length ? 'FAIL' : 'PASS',
      broken.length
        ? `${broken.length}/${glassy.length} 块标记面缺东西：` + broken
            .map((t) => `${t.cls}${t.testid ? '→' + t.testid : ''}[${t.region}] 缺 ${hasTint(t) !== true ? 'tint ' : ''}${!/blur\(/.test(t.backdrop || '') ? 'blur' : ''}（α=${t.alphaVar || t.tintVar || '(空)'}）`)
            .join('；')
        : `${glassy.length} 块标记面全部有 tint + backdrop blur` +
          (closedSurfaces ? `（另有 ${closedSurfaces} 块收起态面按设计全透明，不计入）` : ''))
  } else {
    push('标记面自查', 'WARN',
      '报告里 taggedFacts 没有任何 side/right/approval/modal 标记面 —— 兜底断言这次等于没跑（插件没打标记？）')
  }

  // ── 诊断信息（不判分）─────────────────────────────────────────
  const diag = ['pluginBackdrop', 'pluginWall', 'pluginControls', 'pluginBanner']
    .map((k) => regions.get(k))
    .filter(Boolean)
    .map((r) => `${r.key}=${r.present ? '有' : '无'}`)
  if (diag.length) push('插件注入元素', 'INFO', diag.join('  '))

  /* #dshlg-wall 存在 = 插件挂上了**真壁纸 iframe**。
     验证台只 stub 了 window.fetch，而 iframe 的 src 不走 fetch —— 真 DSH 在跑、
     宿主半体探得到端口时，插件就会挂 iframe，这时截图里画的是真壁纸而不是
     #mock-wallpaper 那层棋盘格替身。断言查的是计算样式、不受影响，
     但「这张截图到底是什么」必须让人看见，所以给一条 WARN，不判死。 */
  const wall = regions.get('pluginWall')
  if (wall && wall.present) {
    push('壁纸来源', 'WARN',
      '#dshlg-wall 存在 —— 插件挂上了真壁纸 iframe，这张截图画的可能是真壁纸，不是验证台的棋盘格替身。' +
      '（当前插件源码里 iframe 只在 probeServer() 探到端口后才挂，而验证台 stub 了 fetch，正常不该出现；出现即说明探测链路变了）')
  }

  return { rows, failed, warned }
}

/* ══════════════════════════════════════════════════════════════════
 * 输出
 * ══════════════════════════════════════════════════════════════════ */
const C = process.stdout.isTTY
  ? { r: '\x1b[31m', g: '\x1b[32m', y: '\x1b[33m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' }
  : { r: '', g: '', y: '', d: '', b: '', x: '' }

function pad(s, n) {
  // 中文按两格算，表格才对得齐
  let w = 0
  for (const ch of String(s)) w += /[\u2E80-\uFFFF]/.test(ch) ? 2 : 1
  return String(s) + ' '.repeat(Math.max(0, n - w))
}

function printTable(rows) {
  const w = 24
  for (const row of rows) {
    const tag = row.verdict === 'PASS' ? C.g + 'PASS' + C.x
      : row.verdict === 'FAIL' ? C.r + 'FAIL' + C.x
        : row.verdict === 'WARN' ? C.y + 'WARN' + C.x
          : row.verdict === 'INFO' ? C.d + 'INFO' + C.x
            : C.y + '报告' + C.x
    console.log(`  ${tag}  ${pad(row.area, w)} ${row.detail}`)
  }
}

/* ══════════════════════════════════════════════════════════════════
 * 主流程
 * ══════════════════════════════════════════════════════════════════ */
function main() {
  console.log(C.b + '\n=== dsh-liquid-glass 验证台 ===' + C.x)
  console.log(`插件目录: ${PLUGIN_DIR}`)
  console.log(`被测文件: ${CLIENT_JS}`)

  // 自检只吃构造数据，**不需要插件在场** —— 所以放在 client.js 存在性检查之前，
  // 这样暂存区里的这份副本也能原地 `--self-test`（不用先复制 client.js 过来）。
  if (SELF_TEST) { selfTest(); return }

  const clientStat = existsSync(CLIENT_JS) ? readFileSync(CLIENT_JS, 'utf8') : ''
  if (!clientStat) {
    console.error(C.r + `\n✗ 找不到 ${CLIENT_JS}\n` +
      '  默认约定验证器在 <插件目录>/test/ 下；换位置时用 --plugin <插件目录> 或环境变量 DSHLG_PLUGIN_DIR。' + C.x)
    process.exit(2)
  }
  const version = (clientStat.match(/const VERSION = '([^']+)'/) || [])[1] || '(读不到)'
  console.log(`插件版本: v${version}`)

  if (URL_ONLY) {
    for (const s of SCENES) console.log('  ' + sceneUrl(s))
    process.exit(0)
  }

  const browser = BROWSERS.find((p) => existsSync(p))
  if (!browser) {
    console.error(C.r + '\n✗ 没找到 Edge / Chrome。候选路径：' + C.x)
    for (const p of BROWSERS) console.error('   ' + p)
    process.exit(2)
  }

  /* ── shell 安全预检 ─────────────────────────────────────────────
     底下是 `spawnSync(cmdline, { shell: true })`，Windows 上就是 cmd.exe。
     见 quote() 的注释：`%VAR%` 在双引号内照样展开、`^` 是转义符、延迟展开下 `!` 会被吃，
     而 cmd 没有可靠的转义写法 —— 所以含这些字符的路径**直接拒绝跑**，
     不让它静默改掉命令行（那样会变成「验证台莫名读不到插件」这种最难查的故障）。 */
  const risky = []
  const checkShellSafe = (what, value, opts) => {
    const hit = shellUnsafe(value, opts)
    if (hit.length) risky.push(`${what} 含 cmd.exe 会改写的字符 ${hit.join(' ')}：${value}`)
  }
  checkShellSafe('插件目录', PLUGIN_DIR)
  checkShellSafe('验证台目录', TEST_DIR)
  checkShellSafe('浏览器路径', browser)
  for (const scene of SCENES) {
    // URL 里的 `%` 是 URLSearchParams 对中文/空格路径的正常百分号编码，不算风险
    checkShellSafe(`场景 ${scene.name} 的 URL`, sceneUrl(scene), { allowPercent: true })
  }
  if (risky.length) {
    console.error(C.r + '\n✗ 命令行里有 cmd.exe 会改写的字符，拒绝继续（shell:true 下无法可靠转义）：' + C.x)
    for (const line of risky) console.error('   ' + line)
    console.error('   把插件放到不含这些字符的路径下再跑，或改成不经过 shell 的调用方式。')
    process.exit(2)
  }

  console.log(`浏览器  : ${browser}\n`)

  mkdirSync(TMP_DIR, { recursive: true })
  if (!NO_SHOTS) mkdirSync(SHOTS_DIR, { recursive: true })

  let totalFail = 0
  let totalWarn = 0
  let clientSrcShown = false
  const summary = []

  for (const scene of SCENES) {
    const url = sceneUrl(scene)
    const png = NO_SHOTS ? null : join(SHOTS_DIR, scene.file)
    console.log(C.b + `── 场景 ${scene.name} ─────────────────────────────────────` + C.x)
    console.log(C.d + `   ${url}` + C.x)

    const run = launch(browser, url, png, scene.name)
    if (!run.ok) {
      // modal 场景跑不动不算致命（它只是一张额外的截图）
      const fatal = scene.name !== 'modal'
      console.log(`  ${fatal ? C.r + 'FAIL' + C.x : C.y + '报告' + C.x}  浏览器      ${run.error}`)
      if (fatal) totalFail++
      summary.push({ scene: scene.name, fail: fatal ? 1 : 0, warn: 0 })
      continue
    }

    const { rows, failed, warned } = evaluate(run.report, scene)
    printTable(rows)
    if (!clientSrcShown && run.report.clientSrc) {
      clientSrcShown = true
      console.log(`  ${C.d}INFO${C.x}  ${pad('实际加载的插件源', 24)} ${run.report.clientSrc}`)
    }
    if (png) {
      console.log(`  ${existsSync(png) ? C.g + 'PASS' + C.x : C.y + '报告' + C.x}  ${pad('截图', 24)} ${png}${existsSync(png) ? '' : '（没生成）'}`)
    }
    totalFail += failed
    totalWarn += warned
    summary.push({ scene: scene.name, fail: failed, warn: warned })
    console.log()
  }

  console.log(C.b + '── 汇总 ─────────────────────────────────────────────────' + C.x)
  for (const s of summary) {
    console.log(`  ${s.fail === 0 ? C.g + 'PASS' + C.x : C.r + 'FAIL' + C.x}  场景 ${s.scene}：${s.fail} 条断言不通过` +
      (s.warn ? `${C.y}，${s.warn} 条警告${C.x}` : ''))
  }
  if (!NO_SHOTS) console.log(`\n截图目录: ${SHOTS_DIR}`)

  if (totalFail > 0) {
    console.log(C.r + `\n✗ 共 ${totalFail} 条断言不通过${totalWarn ? `（另有 ${totalWarn} 条警告）` : ''}。` + C.x)
    process.exit(1)
  }
  console.log(C.g + `\n✓ 全部断言通过${totalWarn ? `（另有 ${totalWarn} 条警告，见上面的 WARN 行）` : ''}。` + C.x)
  process.exit(0)
}

function sceneUrl(scene) {
  // 显式把**真实的 client.js 绝对路径**传给验证台：
  // 这样即便验证台此刻不在 <插件目录>/test/ 下（比如还在暂存区），
  // 跑的也还是那一份真实产物，不需要复制一份 client.js 出来。
  const q = new URLSearchParams(scene.params)
  q.set('client', 'file:///' + CLIENT_JS.replace(/\\/g, '/'))
  return 'file:///' + join(TEST_DIR, 'harness.html').replace(/\\/g, '/') + '?' + q.toString()
}

/* ══════════════════════════════════════════════════════════════════
 * 自检：不用浏览器，验证「报告解析 + 断言判定」这两段逻辑本身是对的。
 *   node verify.mjs --self-test
 * 目的：证明 verify.mjs 的 FAIL 是插件的问题，而不是验证器的 bug。
 * ══════════════════════════════════════════════════════════════════ */
function selfTest() {
  const region = (key, spec, bgColor, bgAlpha, hasBlur, bgGradient, present = true, extra = {}) => ({
    key, spec, present, bgColor, bgAlpha, bgGradient,
    bgImage: bgGradient ? 'linear-gradient(...)' : 'none',
    blur: hasBlur ? 'blur(7px) saturate(1.7) url("#dshlg-refract")' : 'none',
    hasBlur, radius: '18px', color: 'rgb(245, 245, 245)',
    ...extra,
  })

  /**
   * 自检用的报告样本。**形状必须与 harness.html 的 lgBuildReport() 一致**
   * （region key 一个不多一个不少，含 taggedFacts）——
   * 上一版自检就是因为样本里没有 taggedFacts，「标记面自查」那段断言
   * 在自检里从来没被执行过（永远走不到那个分支）。
   */
  const base = (over) => ({
    harness: 'self-test',
    theme: 'dark',
    viewport: { w: 1600, h: 1000 },
    tokens: { bodyBgBase: '#0f1115' },
    moduleLoader: { loaded: ['@local/dsh-liquid-glass'], applied: '@local/dsh-liquid-glass' },
    errors: [],
    plugin: {
      styleTag: true, svgFilter: true,
      taggedGlass: [{ cls: 'dshlg-glass', tag: 'div', testid: 'composer-card', buttons: 5 }],
      taggedFacts: [],
    },
    regions: [
      region('center', 'transparent', 'rgba(0, 0, 0, 0)', 0, false, false),
      region('sidebar', 'frosted', 'rgba(0, 0, 0, 0)', 0, false, false),
      region('rightPanel', 'frosted', 'rgba(0, 0, 0, 0)', 0, false, false),
      /* 收起态样本：判定「收起后必须全透明」的那条断言，自检里必须真被执行到
         （否则又变成「永远走不到」的空断言）。 */
      region('rightPanelClosed', 'transparentPanel', 'rgba(0, 0, 0, 0)', 0, false, false, true, { closed: true }),
      region('rightbarTrack', 'report', 'rgba(0, 0, 0, 0)', 0, false, false),
      region('approvalCard', 'frosted', 'rgba(0, 0, 0, 0)', 0, false, false),
      region('approvalStrip', 'report', 'rgba(245, 158, 11, 0.16)', 0.16, false, false),
      region('modalDialog', 'frosted', 'rgba(0, 0, 0, 0)', 0, false, false, false),
      region('modalMask', 'report', 'rgba(0, 0, 0, 0.55)', 0.55, false, false, false),
      region('composerCard', 'frosted', 'rgba(0, 0, 0, 0)', 0, true, true),
      region('composerInput', 'input', 'rgba(0, 0, 0, 0)', 0, false, false),
      region('composerBtnRow', 'report', 'rgba(0, 0, 0, 0)', 0, false, false),
      region('pluginBackdrop', 'report', 'rgba(0, 0, 0, 0)', 0, false, false, false),
      region('pluginWall', 'report', 'rgba(0, 0, 0, 0)', 0, false, false, false),
      region('pluginControls', 'report', 'rgba(0, 0, 0, 0)', 0, false, false, false),
      region('pluginBanner', 'report', 'rgba(0, 0, 0, 0)', 0, false, false, false),
      region('wallpaperMock', 'report', 'rgba(0, 0, 0, 0)', 0, false, false),
    ],
    subRegions: [
      { key: 'sidebarButton', text: '会话一', color: 'rgb(245, 245, 245)', bgColor: 'rgba(0, 0, 0, 0)', bgAlpha: 0, bgGradient: false, hasBlur: false, insideGlass: false },
      { key: 'rightPanelButton', text: '↻', color: 'rgb(245, 245, 245)', bgColor: 'rgba(0, 0, 0, 0)', bgAlpha: 0, bgGradient: false, hasBlur: false, insideGlass: false },
    ],
    ...over,
  })

  /** 一份「插件全做对了」的报告：四个玻璃面 + 标记面都齐全，用于「负面用例只差一处」 */
  const green = () => {
    const r = base()
    for (const x of r.regions) {
      if (x.spec === 'frosted') {
        x.bgAlpha = 0.14
        x.bgColor = 'rgba(255, 255, 255, 0.14)'
        x.bgGradient = true
        x.bgImage = 'linear-gradient(180deg, rgba(255,255,255,.42), rgba(255,255,255,.3))'
        x.hasBlur = true
        x.blur = 'blur(7px) saturate(1.7) url("#dshlg-refract")'
        x.tintVar = 'linear-gradient(180deg, rgba(255, 255, 255, 0.42) 0%, rgba(255, 255, 255, 0.3) 52%)'
      }
      if (x.key === 'modalDialog') x.present = true
    }
    r.subRegions = r.subRegions.map((s) => ({
      ...s, bgAlpha: 0.14, bgColor: 'rgba(255, 255, 255, 0.14)', hasBlur: true, insideGlass: true,
    }))
    r.plugin = {
      ...r.plugin,
      taggedFacts: [
        { cls: 'dshlg-region', testid: 'sidebar-col', region: 'side', tintVar: 'linear-gradient(...)', backdrop: 'blur(22px) saturate(1.7)' },
        { cls: 'dshlg-region', testid: 'right-panel-content', region: 'right', tintVar: 'linear-gradient(...)', backdrop: 'blur(24px) saturate(1.7)' },
        { cls: 'dshlg-region', testid: 'approval-card', region: 'approval', tintVar: 'linear-gradient(...)', backdrop: 'blur(28px) saturate(1.7)' },
        { cls: 'dshlg-region', testid: 'modal-dialog', region: 'modal', tintVar: 'linear-gradient(...)', backdrop: 'blur(30px) saturate(1.7)' },
      ],
    }
    return r
  }

  const dump = (report) => `<!DOCTYPE html><html><body><pre id="report" hidden>${JSON.stringify(report)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre></body></html>`

  const rowOf = (res, area) => res.rows.find((x) => x.area === area)

  const cases = [
    /* ── ① 报告解析（extractReport）──────────────────────────── */
    {
      name: '解析：载荷前有含 <pre id="report"> 字面量的注释，且值里有 & < > 转义 —— 仍解出正确对象',
      run() {
        const r = JSON.parse(JSON.stringify(base()))
        r.errors = ['a & b < c > d']
        // 注释里故意放上标签字面量：老式「标签正则」会在这里跨接，锚定扫描不该受影响
        const html = '<!DOCTYPE html><html><body><!-- 报告写在 <pre id="report"> 这个节点里 -->'
          + dump(r) + '</body></html>'
        const back = extractReport(html)
        return !!back && back.harness === 'self-test' && back.errors[0] === 'a & b < c > d'
      },
    },
    {
      name: '解析：载荷前面有个同名兄弟键 {"harnessNote":123} —— 不会被锚错',
      run() {
        const payload = JSON.stringify({ harnessNote: 123, ...JSON.parse(JSON.stringify(base())) })
        const back = extractReport(`<html><body><pre id="report">${payload}</pre></body></html>`)
        return !!back && back.harness === 'self-test' && Array.isArray(back.regions)
      },
    },
    {
      name: '解析：harness 不是对象的第一个键（href 在前）—— 兜底路径仍解得出',
      run() {
        const r = JSON.parse(JSON.stringify(base()))
        const payload = { href: 'file:///D:/AI%E5%BA%94%E7%94%A8/harness.html?x=1', harness: r.harness, ...r }
        const back = extractReport(`<pre id="report">${JSON.stringify(payload)}</pre>`)
        return !!back && back.harness === 'self-test' && back.regions.length === 17
      },
    },
    {
      name: '解析：第一个锚点是半截载荷 —— 会向后找下一个锚点，而不是直接放弃',
      run() {
        const html = '<pre>{"harness":"半截载荷","errors":[</pre>' + dump(base()) + '</body>'
        const back = extractReport(html)
        return !!back && back.harness === 'self-test' && back.regions.length === 17
      },
    },
    {
      name: '解析：页面里根本没有 {"harness":" 锚点 —— 返回 null（既不抛异常，也不是 __parseError）',
      run() { return extractReport('<html><body>nothing</body></html>') === null },
    },

    /* ── ② 判定（evaluate）──────────────────────────────────── */
    {
      name: '判定：做对了的报告（含 modal，四个玻璃面 + 标记面齐全）应 0 失败 0 警告',
      run() {
        const res = evaluate(green(), { name: 'dark' })
        return res.failed === 0 && res.warned === 0
      },
    },
    {
      name: '判定：原始构建（侧栏/右栏/审批卡片没毛玻璃）应 FAIL（≥4 条）',
      run() { return evaluate(base(), { name: 'dark' }).failed >= 4 },
    },
    {
      name: '判定：中栏 bgAlpha=null（色值格式没解析出来）必须 FAIL —— 不能靠 Number(null)===0 当成透明',
      run() {
        const bad = green()
        const center = bad.regions.find((r) => r.key === 'center')
        center.bgColor = 'color(srgb 1 1 1 / 0)'   // harness 的 lgAlpha() 认不出 → null
        center.bgAlpha = null
        const res = evaluate(bad, { name: 'dark' })
        return res.failed === 1 && !!rowOf(res, '中栏/工作区') && rowOf(res, '中栏/工作区').verdict === 'FAIL'
      },
    },
    {
      name: '判定：中栏若被涂上底色 + blur 应 FAIL（用户硬要求）',
      run() {
        const bad = green()
        const center = bad.regions.find((r) => r.key === 'center')
        center.bgAlpha = 0.5; center.bgColor = 'rgba(255, 255, 255, 0.5)'; center.hasBlur = true
        return evaluate(bad, { name: 'dark' }).failed === 1
      },
    },
    {
      name: '判定：玻璃有效 alpha=0.05（太弱）只给 WARN，不算 FAIL',
      run() {
        const weak = green()
        const side = weak.regions.find((r) => r.key === 'sidebar')
        side.bgAlpha = 0.05; side.bgColor = 'rgba(255, 255, 255, 0.05)'
        side.bgGradient = false; side.bgImage = 'none'
        side.tintVar = ''   // 连渐变层也清掉，有效 alpha 才是真的 0.05
        const res = evaluate(weak, { name: 'dark' })
        const row = rowOf(res, '左侧会话工作区')
        return res.failed === 0 && res.warned === 1 && !!row && row.verdict === 'WARN'
      },
    },
    {
      name: '判定：taggedFacts 里 side 缺 tint、缺 blur —— 标记面自查必须 FAIL',
      run() {
        const bad = green()
        bad.plugin = {
          ...bad.plugin,
          taggedFacts: [{ cls: 'dshlg-region', testid: 'sidebar-col', region: 'side', tintVar: '', backdrop: 'none' }],
        }
        const res = evaluate(bad, { name: 'dark' })
        const row = rowOf(res, '标记面自查')
        return res.failed >= 1 && !!row && row.verdict === 'FAIL'
      },
    },
    {
      name: '判定：taggedFacts 里 tint + blur 都有 —— 标记面自查 PASS 且 failed 不增',
      run() {
        const res = evaluate(green(), { name: 'dark' })
        const row = rowOf(res, '标记面自查')
        return res.failed === 0 && !!row && row.verdict === 'PASS' && row.detail.includes('4 块标记面')
      },
    },
    {
      name: '判定：subRegion 自己 alpha=0 但 insideGlass=true —— 不算 bad（假红回归）',
      run() {
        const r = green()
        r.subRegions = r.subRegions.map((s) => ({
          ...s, bgAlpha: 0, bgColor: 'rgba(0, 0, 0, 0)', hasBlur: false, insideGlass: true,
        }))
        const res = evaluate(r, { name: 'dark' })
        const row = rowOf(res, '左栏按钮可读性')
        return res.failed === 0 && !!row && row.verdict === 'PASS'
      },
    },
    {
      name: '判定：报告里多一个区域 key / 少一个区域 key —— 清单交叉校验必须 FAIL',
      run() {
        const extra = green()
        extra.regions = extra.regions.concat([region('brandNew', 'report', 'rgba(0, 0, 0, 0)', 0, false, false)])
        const missing = green()
        missing.regions = missing.regions.filter((x) => x.key !== 'modalMask')
        return evaluate(extra, { name: 'dark' }).failed === 1 && evaluate(missing, { name: 'dark' }).failed === 1
      },
    },
    {
      name: '判定：approval 场景里审批卡被折到视口外必须 FAIL；在视口内则 PASS（第 5 张截图的守门断言）',
      run() {
        const off = green()
        off.regions.find((x) => x.key === 'approvalCard').rect = { x: 300, y: 1200, w: 500, h: 180 }
        const inside = green()
        inside.regions.find((x) => x.key === 'approvalCard').rect = { x: 300, y: 380, w: 500, h: 180 }
        const a = evaluate(off, { name: 'approval' })
        const b = evaluate(inside, { name: 'approval' })
        const row = rowOf(b, '审批卡可见性')
        return a.failed === 1 && b.failed === 0 && !!row && row.verdict === 'PASS'
      },
    },
    {
      name: '判定：插件没 apply(ctx) 应 FAIL（≥5 条）',
      run() {
        const bad = base({ moduleLoader: { loaded: ['@local/dsh-liquid-glass'], applied: null } })
        return evaluate(bad, { name: 'dark' }).failed >= 5
      },
    },

    /* ── ③ 文字对比度 ───────────────────────────────────────── */
    {
      name: '判定：正文白字压白底（不透明）必须 FAIL；深字压白底必须 PASS（次要文字不判）',
      run() {
        const make = (color, bg) => {
          const r = green()
          const card = r.regions.find((x) => x.key === 'approvalCard')
          card.bgColor = bg; card.bgAlpha = 1; card.bgGradient = false; card.bgImage = 'none'; card.color = color
          return r
        }
        const white = evaluate(make('rgb(255, 255, 255)', 'rgb(255, 255, 255)'), { name: 'dark' })
        const dark = evaluate(make('rgb(15, 15, 15)', 'rgb(255, 255, 255)'), { name: 'dark' })
        const wRow = rowOf(white, '文字对比度 · 审批卡片')
        const dRow = rowOf(dark, '文字对比度 · 审批卡片')
        return white.failed === 1 && !!wRow && wRow.verdict === 'FAIL'
          && dark.failed === 0 && !!dRow && dRow.verdict === 'PASS'
      },
    },
    {
      name: '对比度算式：WCAG 参考值 #000/#fff=21:1、#777 压白 4.48:1（<4.5）、#767676 压白 4.54:1（≥4.5）',
      run() {
        const near = (a, b) => Math.abs(a - b) <= 0.02
        return near(contrastRatio([0, 0, 0, 1], [255, 255, 255, 1]), 21)
          && near(contrastRatio([119, 119, 119, 1], [255, 255, 255, 1]), 4.48)
          && near(contrastRatio([118, 118, 118, 1], [255, 255, 255, 1]), 4.54)
      },
    },
  ]

  let bad = 0
  console.log('\n' + C.b + '── 自检（不启动浏览器）────────────────────────────────────' + C.x)
  console.log(C.d + `   共 ${cases.length} 条 = 报告解析 5 条 + 断言判定 13 条` + C.x)
  for (const c of cases) {
    let ok = false
    try { ok = c.run() === true } catch (e) { console.log('   异常: ' + e.message) }
    if (!ok) bad++
    console.log(`  ${ok ? C.g + 'PASS' + C.x : C.r + 'FAIL' + C.x}  ${c.name}`)
  }
  if (bad) { console.log(C.r + `\n✗ 自检 ${bad} 项不通过 —— 验证器自身有问题，先修验证器。` + C.x); process.exit(1) }
  console.log(C.g + `\n✓ 自检全部通过（${cases.length} 条：解析与判定逻辑可信）。` + C.x)
  process.exit(0)
}

main()
