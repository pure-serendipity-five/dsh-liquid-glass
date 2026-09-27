# 12 · 同源项目可借鉴技术清单

> 需求方：`D:\AI应用\dsh-liquid-glass`（DSH 全透明玻璃 + 壁纸插件）
> 证据来源：`D:\dev-cache\temp\prior-art\` 下已 clone 的仓库（只读；本轮只做 3 个）
> 状态：分节落盘（A 已完成）

## 目录
- [A. 自适应对比度（dsh-ui-enhancer）](#a-自适应对比度dsh-ui-enhancer)
- [B. 壁纸域能力（dsh-WallpaperAndCost）](#b-壁纸域能力dsh-wallpaperandcost)
- [C. 跨 Shadow DOM 注入（dsh-screen-translator）](#c-跨-shadow-dom-注入dsh-screen-translator)
- [D. 许可证合规（三个仓库）](#d-许可证合规三个仓库)
- [E. 待补：其余 5 个仓库 + 1500 插件索引](#e-待补其余-5-个仓库--1500-插件索引下一轮)

---

## A. 自适应对比度（dsh-ui-enhancer）

仓库 `D:\dev-cache\temp\prior-art\dsh-ui-enhancer`（v0.2.0，MIT），核心文件只有一个：
`src/client/wallpaper.ts`（648 行）。它把「壁纸明暗」做成一个 **light/dark 二元色调 → 11 个表面令牌** 的派生器。

### A.1 它到底怎么测背景明暗（可照抄的算法）

**三步：几何对齐 → 像素统计 → 双信号判定。**

**① 几何对齐：先在「视口形状的小画布」上复现 CSS `background-size/position` 的裁剪结果**
`src/client/wallpaper.ts:243-284`（`wallpaperSampleRect`）：
```ts
const sampleScale = Math.min(48 / containerWidth, 48 / containerHeight);   // 画布最长边 48px
const canvasWidth  = Math.max(1, Math.round(containerWidth  * sampleScale));
const canvasHeight = Math.max(1, Math.round(containerHeight * sampleScale));
const imageScale = fit === 'fill' ? undefined
  : fit === 'cover'   ? Math.max(containerWidth / sourceWidth, containerHeight / sourceHeight)
  : fit === 'contain' ? Math.min(containerWidth / sourceWidth, containerHeight / sourceHeight)
  : 1;
// 再由 position 决定 offset（center/top/bottom/left/right，见 samplePosition 213-231）
return { canvasWidth, canvasHeight, x: offset.x * scaleX, y: offset.y * scaleY,
         width: renderedWidth * scaleX, height: renderedHeight * scaleY };
```
**要点**：它不统计整张原图，而是统计**窗口里真正看得见的那块裁剪区**（`cover` 会把上下或左右裁掉）。画布上限 48px —— 够估亮度，又便宜。

**② 像素统计：sRGB 线性化 + Rec.709 亮度 + 透明度过滤 + 暗像素计数**
`src/client/wallpaper.ts:110-138`（`inferWallpaperTone`）：
```ts
function linearChannel(channel: number): number {
  const normalized = channel / 255
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
}
export function inferWallpaperTone(pixels, fallback = 'light') {
  let luminance = 0, darkPixels = 0, count = 0
  for (let index = 0; index + 3 < pixels.length; index += 4) {
    const opacity = pixels[index + 3] ?? 0
    if (opacity < 32) continue                                   // 透明像素不计
    const value = 0.2126 * linearChannel(pixels[index])
                + 0.7152 * linearChannel(pixels[index + 1])
                + 0.0722 * linearChannel(pixels[index + 2])
    luminance += value
    if (value < 0.24) darkPixels += 1                            // 暗像素阈值 0.24
    count += 1
  }
  if (count === 0) return fallback
  return luminance / count < 0.36 || darkPixels / count >= 0.48 ? 'dark' : 'light'
  //     ↑ 信号一：平均亮度          ↑ 信号二：暗像素占比
}
```
**两个信号是与关系（命中任一即判 dark）**，注释（:117）写明第二个信号的用途：
`/** Infer a surface tone from RGBA pixels, biasing mixed/high-contrast art dark. */`
即：**高对比/明暗混杂的图，光看均值会误判成"中等亮度"→ 它靠"暗像素占比"把它拉回 dark 一侧**。

**③ 取像素：crossOrigin + try/catch + 主题兜底**
`src/client/wallpaper.ts:286-321`（`detectTone`）：
```ts
const image = new Image()
if (!url.startsWith('blob:')) image.crossOrigin = 'anonymous'    // 跨源图不污染画布
image.onload = () => { try {
    const geometry = wallpaperSampleRect(fit, position, innerWidth, innerHeight,
                                         image.naturalWidth, image.naturalHeight)
    const canvas = document.createElement('canvas')
    canvas.width = geometry.canvasWidth; canvas.height = geometry.canvasHeight
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (context === null) return resolve(fallbackTone())
    context.drawImage(image, geometry.x, geometry.y, geometry.width, geometry.height)
    resolve(inferWallpaperTone(context.getImageData(0,0,canvas.width,canvas.height).data,
                               fallbackTone()))
  } catch { resolve(fallbackTone()) } }                          // 画布污染 → 兜底
image.onerror = () => resolve(fallbackTone())
```
兜底来源是 **DSH 自己的主题属性**（:200-202）：
```ts
function fallbackTone(): 'light' | 'dark' {
  return document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light'
}
```

### A.2 它改动的是「壁纸」还是「内容衬底」？—— 两者都改，但**主改内容衬底**

| 改动对象 | 做法 | 出处 |
|---|---|---|
| **内容衬底（主力）** | 由 tone 派生 **11 个表面令牌** `surface/sidebar/panel/raised/muted/input/border/hover/active/mask/shadow`，写到 `document.body` 上 | `wallpaper.ts:73-108`（`createWallpaperPalette`）、`:643-645`（`style.setProperty('--ui-enhancer-' + name, value)`） |
| 壁纸本身（辅助） | 一个**全屏遮罩层** `mask`（0~0.8，默认 0.22）：dark 主题用 `rgba(0,0,0,mask)`、light 用 `rgba(255,255,255,mask)` | `wallpaper.ts:91` / `:105`（palette.mask）、`:323-328`（`createLayer('mask')` 挂到 body 首位） |
| 官方设计令牌 | **没有直接改 `--dsw-*`**；它写自己的 `--ui-enhancer-*`，靠自建外壳消费 | 全文件无 `--dsw-` 写入（grep 无命中） |
| 重采样时机 | 视口 resize（rAF 合并）+ `data-ds-dark-theme` 变化 | `:603-612`（`onViewportResize`）、`:359-362`（`themeObserver`） |

**它的运行纪律（比算法更值得抄）**
- `dispose()`（`:449-485`）：断两个 observer、取消两个 rAF、`URL.revokeObjectURL`、删两层 DOM、删 body 属性、**并逐个 `removeProperty` 清掉 11 个令牌 + `--ui-enhancer-blur`**（`:469-484`）。
- 异步竞态用**单调计数器**挡：`localOperation` / `toneOperation`（`:415`、`:615`、`:619`），每次 await 后比对编号，过期结果直接丢弃。
- MutationObserver **不做全量查询**（`:506-519`）：只有 `markedFrame` 掉线、或变更目标就是 frame 本身时才重扫；注释写明"流式输出时会话树高频变动，其子变更不可能改变三列结构"。
- IndexedDB 存本地壁纸 blob（`:160-198`），上限 24MB（`:411-414`），写入用 Promise 串行化（`enqueueStorageWrite` `:570-574`）。

### A.3 与我们已实现的方案逐项对比

我们的实现在 `D:\AI应用\dsh-liquid-glass\client.js`：`measureWallpaperLuminance()` `:3264-3299`、`dimForLuminance()` `:3307-3314`、`applyWallLuminance()` `:3317-3325`、调用点 `:4477-4493`。

| 维度 | 我们（liquid-glass） | dsh-ui-enhancer | 结论 |
|---|---|---|---|
| 像素来源 | 宿主 `/__preview` **预览缩略图**（壁纸本体是跨源 iframe，读不到像素） | 壁纸本体（它是 CSS background，能直接读） | **我们的限制是硬的**，不能照搬"读壁纸像素" |
| 采样几何 | 整图直接缩放成 32×32（`client.js:3274-3278`） | 按 cover/contain/position 复现**可见裁剪区**再取 48px（`wallpaper.ts:243-284`） | 可借：预览图与窗口比例差得远时，整图均值会掺进"屏幕上根本看不到"的部分 |
| 线性化 | `x<=0.03928 ? x/12.92 : ((x+0.055)/1.055)^2.4`（`:3280`） | `x<=0.04045 ? x/12.92 : ((x+0.055)/1.055)^2.4`（`:110-115`） | **同一个公式**（0.03928 是 WCAG 取值，0.04045 是 sRGB 规范取值，差异可忽略）→ **不用改** |
| 判定信号 | **单信号**：全图平均亮度 L（`:3281-3288`） | **双信号**：均值<0.36 **或** 暗像素占比≥0.48（`:137`） | **这是最值得借的一条**（见 A.4） |
| 输出 | 5 档标量压暗 0.05/0.18/0.32/0.45/0.55（`:3309-3313`），写进 `CONFIG.wallpaper.dim` → `#dshlg-wall` 的 `::after` 黑纱 | light/dark 二元 → 11 个表面令牌 + 全屏遮罩 | 我们是"压暗壁纸"，它是"改衬底色板" |
| 兜底 | 测不到 → 0.15（`:3308`） | 测不到 → 读 `data-ds-dark-theme` 当 tone（`:200-202`） | **保留我们的**：壁纸亮度与主题明暗无关，用主题当先验反而会错 |
| 重测时机 | **只按壁纸 id 缓存**（`wallLum.id`，`:3266`、`:4480`） | id/URL/几何变化 + **视口 resize**都重测（`:603-612`） | 可借：窗口变化会改变 cover 的可见区域 |
| 手动覆盖 | `dataset.dshlgDimManual === '1'` 时不再自动改（`:4484`） | 设置面板显式开关 `adaptive`（`:153`） | **我们的做法更好**（用户手动调过就不抢），保留 |

### A.4 结论：我们的做法**不改方案、只补两个信号**（照它改 3 处，10 行以内）

**结论先行：不要改成它那套。** 理由是硬的 —— 我们的壁纸是**跨源 iframe**（`#dshlg-wall > iframe`），永远拿不到真实像素；它那套"读壁纸本体像素 + 改 11 个衬底色板"在我们这里只能半途而废。而"全透明 + 压暗壁纸"也正是用户的定稿方向（`client.js:3251-3255` 的注释已把理由写清）。

**要照它改的三处（按价值排序）**：

**① 把「单均值」升级为「均值 + 亮区占比」双信号（最高价值）**
它用「暗像素占比」救高对比度图；我们是**白字压壁纸**，风险方向相反 —— 真正吃掉白字的是**亮区面积**。照它的结构镜像一下即可：
```js
/* client.js:3281-3288 循环内补一个亮区计数 */
let sum = 0, n = 0, bright = 0;
for (let i = 0; i < d.length; i += 4) {
  if (d[i + 3] < 8) continue;                       // 与我们现有 alpha<8 一致
  const L = 0.2126 * f(d[i]) + 0.7152 * f(d[i + 1]) + 0.0722 * f(d[i + 2]);
  sum += L; n += 1;
  if (L > 0.5) bright += 1;                        // 对应它的 darkPixels（:133）
}
const mean = n ? sum / n : null;
const brightRatio = n ? bright / n : 0;
/* 双信号取"更狠"的一档：均值走原逻辑，亮区占比≥0.25 直接顶到最高档 */
function dimForLuminance(L, brightRatio) {
  if (L === null) return 0.15;
  const byMean = L > 0.7 ? 0.55 : L > 0.55 ? 0.45 : L > 0.4 ? 0.32 : L > 0.25 ? 0.18 : 0.05;
  const byBright = brightRatio >= 0.25 ? 0.55 : brightRatio >= 0.12 ? 0.32 : 0;
  return Math.max(byMean, byBright);
}
```
为什么需要：一张「上半是过曝天空、下半是深色山体」的壁纸，整图均值可能只有 0.45 → 我们只压 0.32，但上半屏的白字仍然糊在亮天空里。亮区占比能把它顶到 0.55。
（对应它的 `:137` 写法 `luminance / count < 0.36 || darkPixels / count >= 0.48`；只是把 dark 换成 bright、把"判 tone"换成"取更狠的压暗档"。）

**② 缓存失效补上「窗口尺寸变化」**
`client.js:3266` 的缓存只认 `id`；`cover` 语义下窗口一变形，可见区域就变了（它专门为此在 resize 时重采样：`wallpaper.ts:603-612`）。
最小改法：在已有的 `onResize()` 里加一行 `wallLum.id = null;`（下次 pass 自然重测），不必新增监听。

**③ （可选，低优先）按窗口比例裁剪采样区**
`/__preview` 若是 16:9、窗口是 3:2 竖屏，整图均值会掺进屏幕上被裁掉的部分。照 `wallpaperSampleRect` 的思路，居中按窗口比例裁一块再统计即可（约 10 行）。只有在实测发现"预览图与实际观感亮度对不上"时才做。

**不要抄的**：
- 它的 `fallbackTone()`（用主题明暗当壁纸亮度）—— 壁纸亮度与 UI 主题无关，抄了会在"深色主题 + 亮壁纸"下给出错误先验。
- 它的 11 个表面令牌色板 —— 我们的 `readTheme()` + `buildBaseCss()`（`client.js:476-510`、`:1245-1378`）已经从 DSH 令牌派生颜色，另起一套等于两份真相。
- `mask` 全屏遮罩当主手段 —— 我们已经有等价的 `#dshlg-wall::after` 黑纱（`buildWallpaperCss`，`client.js:1400-1405`），再叠一层只会更糊。

**但有一个更大的思路值得记下来**：它把 tone 用在**衬底**上，我们目前只把亮度用在**壁纸**上。我们其实已经在 `:3321` 打了 `data-dshlg-bright-wall` 标记 —— 可以顺手让它也抬高玻璃档位（亮壁纸时把 `--dshlg-alpha` 的档位从 off 提到 thin/regular），那才是"改内容衬底"那条路，而且是可选的、不动现有全透明定稿。本轮不建议动，记入下一轮候选。

---

## B. 壁纸域能力（dsh-WallpaperAndCost）

仓库 `D:\dev-cache\temp\prior-art\dsh-WallpaperAndCost`（v1.0.0，**无 LICENSE 文件、package.json 无 license 字段** → 见 D 节）。
体量：`lib/client.js` 2384 行、`lib/index.js` 1080+ 行、`scripts/extract_scene_pkg.py` 506 行。

### B.1 ㈠ 左/中/右**分区独立不透明度**：三条不同的落点，不是一个统一档位

它没有"给每块面调 alpha"，而是**按区域各自的 DOM 事实，用三种不同手段**落到三个选择器上：

| 区域 | 手段 | 选择器 / 令牌 | 出处 |
|---|---|---|---|
| **左**侧边栏 | 改 **DSH 自己的令牌** | `--dsw-specific-sidebar-fill` → `rgba(236,239,246,α)` / 深色 `rgba(8,10,16,α)` | `lib/client.js:193-200`（`buildTokens`），α 来自 `opLeft`（默认 60，`:194`） |
| **中**间对话列 | 改**结构选择器**的背景色 | `#root > div[data-slot="root"] > div > div:nth-child(2)` | `lib/client.js:202-212`（`buildMidRule`），α 来自 `opMid`（默认 50，`:203`） |
| **右**侧栏 | 改**几何/属性钩子**，且**运行时探测后追加** | `[class*="detailsCol"]` +（装了 better-sidebar 时）`.nArs4W_panel,.nArs4W_bottomPanel` + `[data-dsh-panel-host] > [class*="_panel"]` +（官方右栏存在时）`[data-sidebar-right-panel]` | `lib/client.js:161-191`（`buildRightRule`） |

三种手段的关键差别：
- **左侧走令牌**（`:198`）：令牌是 DSH 自己消费的，文字/图标对比度由 DSH 保证，是最稳的一种 —— 这和我们在 `buildBaseCss()`（`client.js:1370-1376`）里改 `--dsw-alias-bg-layer-*` / `--dsw-specific-sidebar-fill` 是**同一路线，我们已经在做**。
- **中间走 nth-child 结构选择器**（`:207`）：脆弱（注释自己写了 `sidebarCol=1, centerCol=2, detailsCol=3` 依赖列序），但它**只用来给中栏铺一个背景色**，坏了最多是"中栏没底色"，不会连带别的区域 —— 这是**故障隔离**的写法，值得学。
- **右侧走"属性钩子优先 + 类名兜底 + 实时探测"**（`:96-109`、`:168-174`）：官方右栏用 `[data-sidebar-right-panel]`（注释 `:92-95` 写明"未打开时靠 transform 移出视口，节点仍在 DOM 里，所以属性存在 = 官方右栏可用"），另加 `[data-sidebar-right-expand],[data-sidebar-right-toggle]` 作为**面板节点尚未挂载时的辅助信号**；better-sidebar 用 `.nArs4W_panel`（哈希前缀类名，注释标为兜底）。
- **探测结果进入"壁纸指纹"**（`:107-109`、`:294-306`）：`sidebarDetectionKey()` 把 `R`/`O` 两位并进指纹，检测状态一变就自动重建样式。**这是"区域集合变化 → 重算"的正确做法**，可直接对应我们 `paintRegions()` 返回的 `sig`（`client.js:4154-4157`）。

**透明度写法**：不是 `opacity` 属性，而是 `background:rgba(r,g,b,α) !important` + 深浅主题各一套（`:177-179`），zero 时改 `background:transparent!important`（`:166-175`）。**没有用 `opacity` 属性**——这是对的：`opacity` 会把子元素（文字）一起变淡，`rgba` 背景只影响底。

**对我们的用法**：我们的六个玻璃面目前共享 `CONFIG.glassTier × REGION_MULT`（`client.js:402-409`、`:435-455`）。如果要分区独立，最省事且最稳的是**沿用它左侧那条路**：新增设置项 → 直接计算 `--dshlg-alpha` 写进 `[data-dshlg-region="side"|"right"]` 的动态 CSS（我们已有这套变量管线，`buildRegionCss()` `client.js:2026-2059`）。**不要**照抄它的 nth-child 中栏选择器 —— 我们已经用几何探测拿到了 `found.sidebar/right`，不需要退回结构选择器。
**可复用度：高**（左侧令牌路线我们已在用；右侧"属性优先 + 辅助信号"的探测增强值得并进 `resolveRightPanel()`，我们目前只用 `[data-sidebar-right-session]`，**没有** `[data-sidebar-right-expand]/[data-sidebar-right-toggle]` 这两个辅助信号）。

### B.2 ㈡ MP4/WebM 动态壁纸：**裸 `<video>` 元素铺底，不是 iframe**

`lib/client.js:267-288`（`applyVideoWallpaper`）：
```js
const v = document.createElement('video');
v.id = 'dsh-wallpaper-video';
v.src = videoSource(u);
v.muted = true; v.loop = true; v.autoplay = true; v.playsInline = true;
v.setAttribute('playsinline', ''); v.setAttribute('preload', 'auto');
v.setAttribute('aria-hidden', 'true'); v.tabIndex = -1;
v.style.cssText = 'position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;'
  + 'object-fit:cover!important;z-index:-1!important;pointer-events:none!important;background:#000';
document.body.insertBefore(v, document.body.firstChild);
try { const p = v.play(); if (p && typeof p.catch === 'function') p.catch(() => {}); } catch (e) {}
```
配套三条纪律（这三条比 `createElement` 本身更值钱）：
1. **源用 Blob objectURL，不整包解码**（`:237-245` `videoSource`：`URL.createObjectURL(u.blob)` 优先，`u.dataUrl` 只是旧版回退）。
2. **释放要彻底**（`:225-235` `disposeWallpaperVideo`）：`pause()` → `removeAttribute('src')` → `load()` → `remove()`。**`load()` 那一步是关键**（清掉解码器与缓冲，只 remove 元素不释放媒体资源）。
3. **设置面板打开时暂停**（`:247-256`、`:257-264`、`:286`）：注释写明理由是"释放 GPU"；`resumeVideoWallpaper()` 在面板关闭时恢复。

**对我们的用法（这条是本轮最有价值的架构级建议之一）**：
我们的动态壁纸走的是 `/__video` 包装页 + **跨源 iframe**（`index.js:205-268`、`client.js:2133-2176`）。iframe 是**为了 WE `web`/`scene` 壁纸**（要跑它自己的 HTML/JS，只能隔离）—— 但对**纯 mp4/webm**，iframe 带来了三个纯损失：
- 拿不到像素 → 我们的亮度自适应（A 节）对视频壁纸永远只能吃 `preview.jpg`；
- `filter`/`backdrop-filter` 与独立的合成层交互导致的闪烁（我们已经在 `buildWallpaperCss` 注释里踩过，`client.js:321-322`）；
- 多一层 HTML/JS 与 postMessage 控制桥（`BRIDGE_SCRIPT`）。
**建议**：在 `index.js` 的 `/__wallpapers` 结果里已经有 `type` 字段（`web`/`video`）；对 `type === 'video'` 的条目**直接给裸文件 URL**（而不是 `__video?src=…` 包装页），客户端用 `document.createElement('video')` 铺底（照上面 4 行 CSS + 三条纪律）。`web`/`scene` 仍走 iframe。收益：视频壁纸零成本接入亮度自适应、少一层合成、少一套控制桥；代价：控制条的音量/静音改直接操作 `video` 元素（比 postMessage 更简单）。

### B.3 ㈢ 「原图不压缩」：原始字节进 IndexedDB，裁剪是**纯 CSS 数学**，只有缩略图被重编码

| 环节 | 做法 | 出处 |
|---|---|---|
| 读取 | `file.stream()` 分块读成 Blob（**原始字节**）；`needDataUrl` 时才额外拼 base64。回退分支才是 `FileReader.readAsDataURL` | `lib/client.js:692-708`（回退 `:699-707`） |
| 存储 | 原图进 **IndexedDB**：`IDB_NAME='dsw-wallpaper'`、store `'kv'`、键 `'uploads.v1'` | `:20-22`、`:385-408`（`idbGet/idbPut`）、`:424`（`idbPut(IDB_UPLOADS_KEY, clean)`） |
| 裁剪 | **不重写像素**：`zoom(1~4)`、`x/y(0~100)` 三个数 → 直接生成 CSS：`background-size:max(calc(100vw * z), calc(100vh * ratio * z))` + `background-position: x% y%` | `:152-159`（`buildUploadCss`）、`:155-157`（clamp） |
| 唯一重编码处 | **仅缩略图**：canvas 取视频首帧/降采样 → `cv.toDataURL('image/jpeg', 0.8)` | `:502`（注释）、`:548`、`:643` |
| 尺寸上限 | pkg 400MB / 媒体 800MB（注释说明"有 320MB 的直接 mp4"） | `:725-726` |

**对我们的用法**：我们的 `/__preview` 走的是**壁纸目录里的预览图**（`index.js:409-441` `findPreview`），本身没经过任何重编码 —— 所以"缩略图被压缩"这件事**在预览图这一路上不存在**；真正的问题是：
- `previewExt === ''`（没有预览图）时我们**完全没有亮度数据**（A.3 的 `L === null → 0.15`）；
- 视频壁纸（若按 B.2 改成裸 `<video>`）可以直接从视频元素取真实像素，比预览图更准。
**结论：不需要抄它的"不压缩"存储链路**（我们没有上传/编辑功能）。但它有两条可以直接借：
1. **裁剪用 CSS 数学而不是重写像素**（`:152-159`）—— 如果以后我们要做"壁纸构图微调"（用户嫌壁纸主体被裁掉），照这个做，零画质损失、零存储成本。
2. **原图/大文件进 IndexedDB 而不是 localStorage**（`:20-22`、`:385-408`）—— 与 `dsh-ui-enhancer` 的做法一致（`wallpaper.ts:160-198`，带 24MB 上限）。我们目前所有状态都塞在 `localStorage`（`dshlg.settings` / `dshlg.pos` / `dshlg.entry`），一旦以后要缓存 `/__preview` 的亮度结论或壁纸缩略图，应走 IndexedDB。

### B.4 ㈣ Steam 工坊 `scene.pkg` 解析：**容器格式很简单，能自己写；但它的脚本不能抄，而且它解决不了我们最想要的那类壁纸**

**两个实现都在这个仓库里**（重要：说明这件事不需要 Python）：
- 浏览器端 **纯 JS**：`lib/client.js:720-1000`（`sniffMediaKind` `:776-780`、PKG 目录解析 `:783-800`、`lz4Decode` `:747+`、`pkgTexPieces` `:886-887`）
- 宿主端 **Python 3**：`scripts/extract_scene_pkg.py`（506 行，由 `lib/index.js:608-616`、`:983-1060` 起子进程调用）

**容器格式（JS 版实现，可核对）**
```
PKGV 容器:  u32 magicLen | magicLen 字节 magic("PKGV00xx") | u32 count
            count × ( u32 nameLen | nameLen 字节 name(utf8) | u32 offset | u32 length )
            随后是数据区；文件内容 = data_start + offset 起 length 字节
```
出处：JS `lib/client.js:786-800`（`DataView.getUint32(p, true)`，小端）；Python 版等价实现 `scripts/extract_scene_pkg.py:89-109`。

**媒体识别（最有用的一段，5 行）** `lib/client.js:776-780`：
```js
function sniffMediaKind(u8) {
  if (u8.length >= 12 && u8[4] === 0x66 && u8[5] === 0x74 && u8[6] === 0x79 && u8[7] === 0x70) return 'mp4'; // ....ftyp
  if (u8.length >= 2 && u8[0] === 0xff && u8[1] === 0xd8) return 'jpg';
  if (u8.length >= 4 && u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47) return 'png';
  ...
}
```
Python 版另有 FreeImage 格式号表（`extract_scene_pkg.py:133-139`，注释标明"与 RePKG 一致"，其中 **35 = mp4**）与 DXT fourcc 表（`:140`）。

**`TEX` 是什么格式（Python 版最完整）**：`extract_scene_pkg.py:112-201`
- 两段魔数：`TEXV0005` + `TEXI0001`，随后 `struct.unpack_from("<7I")`（28 字节）= `format, flags, tex_w, tex_h, img_w, img_h, unk`（`:156-158`）
- `format` 取值：`0 RGBA8888 / 4 DXT5 / 6 DXT3 / 7 DXT1 / 8 RG88 / 9 R8`（`:118`）
- flags 位语义：`bit 0x20 = IsVideoTexture`、`bit 0x04 = IsGif`（`:125-130`）
- 图像容器 `TEXB0003/0004`：`img_count, image_format(,is_video)`；每个 image 有 `mip_count`，每个 mip 头 `w,h,is_lz4,dec_count,byte_count`（20 字节），`is_lz4` 时用 LZ4 block 解压到 `dec_count`（`:160-191`）
- 结论：**`.tex` 里能直接用的只有"本来就是 JPEG/PNG/MP4 的载荷"**；DXT1/3/5 解出来是 `.dds`，README 自己写明要"有 Pillow 转 .png"（`README.md:25`），且 DXT 场景壁纸在客户端会被判为不可用 —— 原文提示 `lib/client.js:992`：`未在 pkg 中找到可直接显示的图片/视频（多为 DXT 场景壁纸），可改用 preview.jpg 或直接文件`；Python 版同样有此分支（`extract_scene_pkg.py:429`）。

**能不能直接用？—— 分三问回答**
1. **能不能抄它的代码？不能。** 该仓库既无 `LICENSE` 文件、`package.json` 也无 `license` 字段（见 D 节），默认"保留所有权利"。它自带的 Python 脚本、JS 解析器都属于受版权保护的代码。
2. **值是值的？值一半。** 容器解析（PKGV）只有约 15 行（`:783-800`），`sniffMediaKind` 约 5 行 —— 这两段是**格式事实**（文件格式本身不受版权保护），自己按上面的字节布局重写即可，不需要许可。`lz4Decode`（约 40 行）、DXT 解码（数百行）才是重活，而 DXT 恰恰**在浏览器里也用不上**（要转 dds/png）。
3. **该不该做？该做"容器 + 嗅探"这一层，不碰 `.tex`/DXT/LZ4。** 理由：
   - 工坊壁纸里最常见的"动态壁纸"是**目录里直接放的 `*.mp4`/`*.webm`**（它的识别顺序第①条就是"直接 mp4/jpg"，`lib/client.js:722`；Python 版 `pick_best_media` 也是"视频优先，其次最大图片"，`extract_scene_pkg.py:373-374`）。我们 `index.js:474-485` 已经在扫顶层 `mp4|webm|ogv` —— **这一层我们已经有了**。
   - `scene.pkg` 里能直接用的载荷只有"内嵌的 jpg/png/mp4"（`sniffMediaKind` 三类）。**只做这一层，能在 Node 里 25 行搞定**（PKGV 目录 + 逐条目嗅探 magic），把 pkg 里内嵌的 mp4/png 提取成临时文件或直接以 Buffer 伺服。
   - 超过这一层（`.tex` + LZ4 + DXT）投入产出比极差：需要 LZ4 解压 + DXT 解码 + PNG 编码，而结果对"多数 DXT 场景壁纸"仍然不可渲染（它自己的兜底就是回退 `preview.jpg`）。
   - **绝对不要为了这个引入 Python 依赖**：它的 README 明说需要目标机装 Python 3（`README.md:14`：`需要运行 DSH 的机器装有 Python 3（脚本为纯 Python，Pillow 可选）`），而 Python 缺失时它的功能整体失效（`lib/index.js:1060` 的错误文案就是这条路径的失败出口）。我们的宿主半体是 Node，多一个 Python 依赖等于多一类"用户环境不同就坏"的静默失败。
   - **顺带值得抄的一条工程习惯**：`WS_MAX_PKG = 400MB`、`WS_MAX_MEDIA = 800MB` 的显式上限（`:725-726`），以及"先看扩展名/魔数再决定要不要整包读进内存"。我们的 `/__preview` 目前对任意大小的预览图直接 `createReadStream`，没有上限 —— 加一条尺寸上限符合这个习惯。

**建议的最小落地（下一轮可派工）**：`index.js` 的 `describeWallpaper()` 里，当既没有 `index.html` 也没有顶层视频、但存在 `scene.pkg` 时：读 pkg 目录 → 对每个条目读前 16 字节嗅探 → 命中 `mp4/jpg/png` 就登记为可用入口（`type: 'video'`/`'web'`）并写进 `PREVIEWS`/新映射；全不命中则沿用现有 `reason`（"依赖 WE 运行时"）。约 40 行 Node 代码，零新依赖。

### B.5 其它可直接借的小件（同仓库）

| 技术 | 出处 | 我们的用法 |
|---|---|---|
| 壁纸**指纹**：只有影响画面的状态变化才重建壁纸 | `lib/client.js:290-306`（`wallpaperFingerprint`，注释写明"修 bug: 打开设置/补缩略图等 commit 不再重载已有壁纸"） | 我们的 `ensureWallpaper()` 已按 `dataset.src` 比对（`client.js:2142`），等价；但**指纹里应加入 `type`**，否则 video→裸 `<video>` 改造后同 src 不同载体不会重建 |
| 显式样式上限/几何探测的顺序 | `lib/client.js:161-191`（右侧四类选择器按"装了没装"拼） | 并进我们 `resolveRightPanel()` 的辅助信号（见 B.1） |
| 探测状态变化并入指纹后自动重建 | `lib/client.js:107-109`、`:112-123`（`refreshSidebarDetection`） | 我们 `paintRegions()` 的 `sig` 已经是同一机制，无需改 |

---

## C. 跨 Shadow DOM 注入（dsh-screen-translator）

仓库 `D:\dev-cache\temp\prior-art\dsh-screen-translator`（v3.0.3，MIT），单文件 `client.js` 1441 行 / 约 70KB。

### C.1 先回答"它到底怎么进 shadow root 的"——**不是猴子补丁，是遍历**

**仓库级 grep 结论（可复核）**：在整个仓库里搜 `attachShadow|adoptedStyleSheets|shadowRoot|ShadowRoot|.host` **只有 3 处命中，全部在 `client.js`**：
```
client.js:894           const shadowRoots = [];
client.js:905                 if (el.shadowRoot) shadowRoots.push(el.shadowRoot);
client.js:941             for (const sr of shadowRoots.slice(0, 200)) {
```
即：**没有 patch `Element.prototype.attachShadow`，也没有用 `adoptedStyleSheets`。** 它自己的文件头注释（`client.js:9`）也如实写着范围是 **"Open Shadow DOM roots"**（只支持 open root —— `el.shadowRoot` 对 `mode:'closed'` 恒为 `null`，这是无法绕过的）。

### C.2 完整机制：三段式遍历 + 上限 + 空闲分片 + 只处理增量

**① 三段式遍历（一个 root 内）** `client.js:886-946`（`walkAndQueue(root, depth)`）：
```js
// Pass 1: 属性 + 收集 shadow root
const ew = doc.createTreeWalker(root, showEl, null);       // showEl = NodeFilter.SHOW_ELEMENT
while ((el = ew.nextNode())) {
  if (seen++ > SCAN_EL_CAP) break;
  if (!isElementExcludedFromAttrs(el)) this.translateAttrs(el, lang);
  try { if (el.shadowRoot) shadowRoots.push(el.shadowRoot); } catch (e) {}   // :904-907
}
// Pass 2: 文本节点（NodeFilter.SHOW_TEXT）
const tw = doc.createTreeWalker(root, showText, null); ...
// Pass 3: 递归进 shadow root
if ((depth || 0) < 3) {                                     // :940  深度上限 3
  for (const sr of shadowRoots.slice(0, 200)) {             // :941  每层最多 200 个 root
    try { this.walkAndQueue(sr, (depth || 0) + 1); } catch (e) {}
  }
}
```
**关键点**：`createTreeWalker` 的一个 walk 就同时拿到"要处理的元素/文本"和"这一层的 shadow root 列表"，**不需要对每个元素 `querySelectorAll('*')`**；shadow root 的递归走的是同一个函数（天然支持 shadow 套 shadow）。

**② 三个硬上限（防跑飞）** `client.js:108-109`、`:900`、`:917`、`:941`
```js
const SCAN_NODE_CAP = 3000;   // :108  文本节点上限
const SCAN_EL_CAP   = 3000;   // :109  元素上限
if (seen++ > SCAN_EL_CAP) break;                 // 元素遍历熔断
if (seen++ > SCAN_NODE_CAP) { capped = true; break; }
for (const sr of shadowRoots.slice(0, 200))      // 单层 root 数上限
```
我们在 `client.js` 里对 DOM 做大范围遍历（`discover()` 的 `root.querySelectorAll('*')`，`client.js:769`、`:803`、`:999`、`:1014`）——**没有任何上限**。这两个 `CAP` 常量是可以直接借的护栏形式。

**③ 空闲分片** `client.js:32-40`、`:740`：
```js
function onIdle(fn, fallbackMs) {
  try { if (typeof requestIdleCallback !== 'undefined') { requestIdleCallback(fn, { timeout: 2000 }); return; } } catch (e) {}
  setTimeout(fn, fallbackMs == null ? 300 : fallbackMs);        // 无 rIC 的环境回退
}
// :740  首次全量扫描走空闲
onIdle(() => this.scheduleScan(0), 250);
```

**④ MutationObserver：`{childList, subtree}` + **只处理新增节点**，防抖 flush** `client.js:826-851`：
```js
observer = new MutationObserver((records) => {
  let dirty = false;
  for (const record of records) {
    for (const node of record.addedNodes) {          // ← 只看 added，不重扫全文档
      if (node.nodeType === 1) {
        if (node.tagName.toLowerCase() === 'iframe') { this.scanIframe(node, 0, true); dirty = true; }
        else {
          this.walkAndQueue(node, 0);                 // 新子树整体走一遍（含其中新增的 shadow root）
          for (const f of node.querySelectorAll('iframe')) this.scanIframe(f, 0, true);
          dirty = true;
        }
      } else if (node.nodeType === 3) { /* 新增文本节点 → 只 walk 它的父元素 */ }
    }
  }
  if (dirty) this.scheduleFlush(20);                  // :848  合并到 20ms 一次
});
observer.observe(doc.body, { childList: true, subtree: true });   // :850
this.disposers.push(() => { try { observer.disconnect(); } catch (e) {} });   // :851 注册进 disposer 列表
```
**这一段是最值得抄的**：`subtree:true` 但**回调里不做全量查询**，只对 `addedNodes` 做局部遍历。对照我们 `client.js`：我们的 MutationObserver 每次触发都会在 300ms 后跑一整轮 `pass()`（`client.js:4417-4424`），而 `passInner → discover()` 里是多个 `querySelectorAll('*')` 全文档扫描 —— 同一个"高频变动"问题上，它的做法是增量的，我们的是全量的。

**⑤ 同源 iframe（含嵌套）** `client.js:855-875`（`scanIframe`）：
```js
scanIframe(iframe, depth, fromObserver) {
  if (!iframe || depth > 2) return;                              // 嵌套深度上限 2
  const run = () => {
    let frameDoc = null;
    try { frameDoc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document); } catch (e) {}
    if (frameDoc && frameDoc.body) {                             // 跨源 → contentDocument 为 null / 抛错，静默跳过
      this.attachDoc(frameDoc);
      this.walkAndQueue(frameDoc.body, depth + 1);
      for (const f of frameDoc.querySelectorAll('iframe')) this.scanIframe(f, depth + 1, false);
      this.scheduleFlush(20);
    }
  };
  if (fromObserver) {                                            // 观察者路径：等 iframe ready 再进
    const ready = iframe.contentDocument && iframe.contentDocument.readyState === 'complete';
    if (ready) run(); else iframe.addEventListener('load', run, { once: true });
  }
  ...
}
```
**注意**：它进的是**同源** iframe。我们的壁纸 iframe 是**跨源**（`http://127.0.0.1:PORT` vs `dsh-app://app`），`contentDocument` 必为 `null` —— 这条路对我们**不适用**（我们的跨源控制已经用 postMessage 桥解决了，`index.js:283-377`）。

**⑥ 导航变化也要重扫** `client.js:743-758`：`popstate` / `hashchange` 用捕获阶段监听 → `scheduleScan(120)`，并在 disposer 里 `removeEventListener`。DSH 是 SPA，路由切换会整体换 DOM，单靠 MutationObserver 容易漏掉"大块替换"的场景。

### C.3 可直接照抄的最小实现（为我们的用途改写：把样式注入 shadow root）

它做的是"翻译"，所以**遍历到就够了**；我们要的是**改样式**，必须再加一步"把样式塞进去"。另外注意一个对我们极为有利的事实：**CSS 自定义属性会穿透 shadow 边界继承**，而我们的材质几乎全靠 `--dshlg-*` 变量（`client.js:2002-2019` `glassVars()` 里 18 个变量）。所以在 shadow root 里**只需要一条最小规则集**去消费同名变量，不必把整份 CRITICAL_CSS 复制进去。

```js
/* 建议新增：client.js 模块级 —— 跨 Shadow DOM 材质注入（~40 行）
   依据：dsh-screen-translator/client.js:886-946（遍历+上限）、:826-851（增量 observer） */
const SHADOW_STYLE_ATTR = 'data-dshlg-shadow-style';
const SHADOW_EL_CAP = 3000;      // 抄它的 SCAN_EL_CAP（:109）
const SHADOW_ROOT_CAP = 200;     // 抄它的 slice(0,200)（:941）
const SHADOW_DEPTH_CAP = 3;      // 抄它的 depth < 3（:940）

/** 一条只消费我们变量的规则集：变量从 :root 继承进来，规则本身不会。 */
const SHADOW_CSS = `
  :host([data-dshlg-region]) {
    background-color: rgba(var(--dshlg-tone, 255,255,255), var(--dshlg-alpha, 0)) !important;
    border: var(--dshlg-border, 1px) solid rgba(255,255,255, var(--dshlg-border-a, .18)) !important;
    border-radius: var(--dshlg-radius, 20px) !important;
    backdrop-filter: var(--dshlg-filter, none);
    -webkit-backdrop-filter: var(--dshlg-filter, none);
  }
`;
function injectShadowStyles(root, depth = 0) {
  if (!root || depth > SHADOW_DEPTH_CAP) return 0;
  let n = 0;
  const roots = [];
  try {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
    let seen = 0, el;
    while ((el = w.nextNode())) {
      if (seen++ > SHADOW_EL_CAP) break;                 // 熔断
      let sr = null;
      try { sr = el.shadowRoot; } catch { /* 忽略 */ }    // 只覆盖 open root（与它一致）
      if (sr) roots.push(sr);
    }
  } catch { /* 忽略 */ }
  for (const sr of roots.slice(0, SHADOW_ROOT_CAP)) {
    try {
      /* ① 优先 Constructable Stylesheet：不产生 DOM，随 shadow root 一起被回收，
            重新渲染内部内容也不会丢。 */
      if ('adoptedStyleSheets' in sr && typeof CSSStyleSheet === 'function') {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(SHADOW_CSS);
        if (!sr.__dshlgSheet) { sr.__dshlgSheet = sheet; sr.adoptedStyleSheets = [...sr.adoptedStyleSheets, sheet]; n++; }
      } else if (!sr.querySelector('style[' + SHADOW_STYLE_ATTR + ']')) {
        /* ② 回退：塞一个 <style> 元素，并做幂等判断 */
        const st = document.createElement('style');
        st.setAttribute(SHADOW_STYLE_ATTR, '1');
        st.textContent = SHADOW_CSS;
        (sr.head || sr).appendChild(st); n++;
      }
      n += injectShadowStyles(sr, depth + 1);            // 递归：shadow 套 shadow
    } catch { /* 单个 root 失败不影响其它 */ }
  }
  /* 顺带把宿主元素本身登记成可选中的目标：querySelector 不穿 shadow 边界，
     我们现有的 paintRegions()/enforceGlassBudget() 都靠 document.querySelectorAll，
     永远看不到 shadow 里的面 —— 这是当前探测盲区（见 C.4）。 */
  return n;
}
```
把它挂到已有的 `pass()` 里（`client.js` 的 `passInner`，例如 `ensureFades()` 旁边 `client.js:4474` 一行调用），并让 MutationObserver 的回调**优先走增量**：对 `record.addedNodes` 逐个 `injectShadowStyles(node, 0)`，全量只在 `pass(true)` 时做一次。

**两种注入方式的取舍（我给的实现里都保留了）**
| 方式 | 优点 | 代价 |
|---|---|---|
| `adoptedStyleSheets`（Constructable Stylesheet） | 无 DOM 节点、可复用同一个 sheet 实例、shadow 内部重渲染不会丢 | 需要 Chromium 73+（Electron 全满足）；不能用 `document.createElement('style')` 那种"看得见"的调试方式 |
| 塞 `<style>` 元素 | 兼容性最好、DevTools 里可见、和我们现有 `STYLE_ID` 套路一致 | 会被 shadow 内部框架的 `innerHTML = ...` 清掉（所以要靠 observer 重新注入） |
| **猴子补丁 `attachShadow`**（它**没有**用） | 唯一能覆盖 `mode:'closed'` 的办法 | 全局改写原型、与别的插件互踩、在 `attachShadow` 里同步注入样式有 CSP/顺序风险。**除非确实遇到 closed root，不要上** —— 本条是我的推论，不在该仓库的证据范围内 |

### C.4 对我们的两处具体收益（含一个当前盲区）

1. **能改到 shadow 里的第三方件**：DSH Dock 的悬浮胶囊、`dockkit` 面板、以及未来任何 `attachShadow` 的插件表面。做法就是上面 40 行 —— 我们已经有全套 `--dshlg-*` 变量（`glassVars()`，`client.js:2002-2019`），shadow 内只需要 `:host` 规则消费它们。
2. **揭示一个现存盲区（重要）**：我们所有的区域探测与预算都基于 `document.querySelectorAll`：
   - `paintRegions()` / `discover()`（`client.js:769`、`803`、`999`、`1014`）
   - `enforceGlassBudget()`（`client.js:4348`，选择器 `[data-dshlg-region], .dshlg-glass`）
   - `untagAll()`（`client.js:1154`，选择器 `[data-dshlg]`）
   **`querySelectorAll` 不穿透 shadow 边界**，所以任何被渲染进 shadow root 的玻璃面/浮层，我们既探测不到、也打不上标记、更不会被 `untagAll` 清掉（清理也会漏）。这不一定是 P0（取决于 DSH 有没有 shadow 化的面板），但它是"看着像没生效"这类难查问题的来源 —— 建议在 C 节落地时，顺手在 `discover()` 的 notes 里加一条"shadow root 数量"的诊断计数（照我们现有的 `found.notes` 机制，`client.js:1028`）。

---

## D. 许可证合规（三个仓库）

**先说我们自己的状况**：`D:\AI应用\dsh-liquid-glass\package.json` 有 `"private": true`（`:4`）但**没有 `license` 字段**，仓库里也没有 `LICENSE`/`NOTICE` 文件。这意味着**一旦直接复制了下面任何一段 MIT 代码，就必须补一份声明**，不能只靠"反正是本地插件"。

| 仓库 | 许可证 | 证据 | 直接复制代码要做什么 |
|---|---|---|---|
| `dsh-ui-enhancer` | **MIT** | `LICENSE:1` `MIT License`、`LICENSE:3` `Copyright (c) 2026 dsh-ui-enhancer contributors`；`package.json:8` `"license": "MIT"` | 可以复制（含修改、商用、闭源分发），但**必须在副本或实质部分中保留版权声明与许可声明**。本报告 A.4 给的那段「均值 + 亮区占比」是改写而非复制，风险更低；若照抄它的 `inferWallpaperTone` 函数体，则需在文件头注明出处与 MIT 声明 |
| `dsh-screen-translator` | **MIT** | `LICENSE:1` `MIT License`、`LICENSE:3` `Copyright (c) 2026 Mustakim Abdullah`；`package.json:61` `"license": "MIT"`；`:32` 作者字段 | 同上。C.3 那段最小实现是**按它的机制重写**的（结构相似、代码不同）；若整段照搬 `walkAndQueue`，需附 MIT 声明。**MIT 不含专利授权**，用于本地私有插件风险可忽略 |
| `dsh-WallpaperAndCost` | **⚠️ 无许可证（默认保留所有权利）** | 仓库根**没有 `LICENSE` 文件**（对 `D:\dev-cache\temp\prior-art` 全仓 glob `**/LICENSE*` 命中 7 个仓库，**不含**它）；`package.json` 只有 `name`/`version`（`:2-3`），**无 `license` 字段** | **不能复制它的任何代码** —— 包括 `scripts/extract_scene_pkg.py`（506 行）与 `lib/client.js` 里的 PKG/`.tex`/LZ4 解析器。B.4 里我给的做法是**照格式事实重写**（PKGV 容器字节布局、`sniffMediaKind` 的 4 个魔数判断），这属于格式/事实层面、不构成复制；**不要在注释里声称"来自 dsh-WallpaperAndCost"**，也不要摘抄它的中文注释与函数名 |

**通用结论**：
1. **本轮三个仓库里，两个可借鉴（MIT，需附声明），一个只能"看思路、不能抄代码"（无许可证）。**
2. 如果决定直接复制 MIT 代码，最小合规动作：在项目里新增 `THIRD-PARTY-NOTICES.md`，逐条写「仓库 / 版本 / 版权行 / MIT 全文」，并在被复制的源文件顶部加一行 `/* Portions from <repo> (MIT, Copyright (c) <year> <holder>) */`。
3. 只借鉴**算法思想、字节格式、API 形状**（本报告 A/B/C 的绝大部分内容）**不触发**上述义务 —— 但"照抄函数体"就触发。**分界线是"是否逐行复制"，不是"是否理解"。**
4. 我们自己的 `package.json` 建议补一个 `"license": "MIT"`（或 `"UNLICENSED"`）以消除歧义：现在是 `private: true` + 无 license，别人（包括未来的我们自己）无法判断能否复用我们的代码。
5. 下一轮要看的 `dock-flash` 是 **Apache-2.0**（`LICENSE:1` `Apache License`、`package.json:5` `"license": "Apache-2.0"`），比 MIT 多两条硬要求：**保留 `NOTICE`（若有）**、**声明你修改过哪些文件**；其余 4 个（`dock` / `DSH-better-sidebar` / `dsh-market` / `widget-dock`）均为 MIT（各自 `LICENSE:1`、`package.json` 的 `license` 字段已核对）。

---

## E. 待补：其余 5 个仓库 + 1500 插件索引（下一轮）

本轮不做。已确认可下轮复用的一手线索（本轮 grep 所得，含文件:行号）：
- `dock`（MIT，dock-base 0.2.2）：`ctx.workbench` 开放注册表的**完整接口**在 `dock/lib/types/client/contract.d.ts:200-299`（registerActivityBarItem / registerPanel / registerEditorView / registerStatusBarItem / registerCommand / registerSetting / openView / clampFloatingWindowsIntoView），每个 register* 返回 disposer。
- `dock-flash`（Apache-2.0，1.6.0）：`quickControl` 服务 + **双重发现模式**（`INTEGRATION.md:40-76`），以及"系统告警"三路轮询（内存/网络/会话上下文，自适应间隔 `BASE×(1−ratio)^POWER+MIN`）。
- `DSH-better-sidebar`（MIT，0.21.1）：`ctx.betterSidebar.registerTab` 契约 + `docs/external-plugin-guide.md`。
- `dsh-market`（MIT，1.66.2）：**不该重造**（见下轮 A 节结论雏形）；对外只暴露 `GET /dsh-market/api/v1/capabilities`（`src/routes.ts:1606`）+ `settings.section` 槽（`src/client/index.ts:158-172`）。
- 宿主 HTTP 安全：`DSH-better-sidebar/docs/plans/2026-08-17-edge151-origin-portless-fence.md:37-40` 记录了 DSH `/api` 网关的信任栅栏语义（Host 必须 loopback/受信 + Origin 的 **hostname** 与 Host 的 hostname 相同 + `sec-fetch-site: cross-site` 一律拒绝）—— 直接对应我们的 `ACAO:*` 安全债。
