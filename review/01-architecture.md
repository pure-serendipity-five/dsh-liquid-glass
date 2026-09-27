# dsh-liquid-glass · 架构与健壮性审查（01-architecture）

- 审查对象：`D:\AI应用\dsh-liquid-glass`（client.js 4483 行 / index.js 929 行 / styles.css / test/）
- 审查人：arch-reviewer（task-3）
- 审查方式：**只读**全文精读 + 定向 grep 静态分析（对照历史 8 类坑逐条排查）；`node --check`、模板反引号扫描、`check-install.mjs` 由 Lead 代跑（本会话 pwsh 被沙箱 ACL 阻断，见文末「验证执行情况」）
- 结论：历史 8 类坑中 7 类已确认无残留，**坑④（模块级调用 applyGlass 内部 `pass()`）仍有 1 处活跃残留**（P0-1），另有 4 条 P1、16 条 P2。

---

## 一、问题总表（按严重度排序）

| # | 严重度 | 问题 | 文件:行 | 修法要点 |
|---|---|---|---|---|
| P0-1 | **P0** | 模块级 click 回调直接调用 `applyGlass` 内部局部函数 `pass()` → 每次点「找回」圆点必抛 `ReferenceError` | client.js:2622（lib/client.js:2622 同） | 改调 `requestPass(true)`；同步补 collapse.test.mjs 的 `__DSHLG_ERR` 断言 |
| P1-1 | P1 | `CRITICAL_CSS` 里 `@media (prefers-reduced-motion: reduce){}` 是**空规则体**，品牌流光 `dshlg-gem-shimmer` 5.5s infinite 关不掉 | client.js:1587-1589（动画定义 1551/1582） | 往空块里补 `animation: none !important` |
| P1-2 | P1 | `createReadStream(...).pipe(res)` 无 `error` 监听 → 文件在 stat 后消失时抛未捕获 `error` 事件（宿主进程级） | index.js:743、830、864 | 加 `stream.on('error', () => res.destroy())` 或改用 `pipeline()` |
| P1-3 | P1 | 品牌区的内联改写（`display:none !important`、`background:none !important`、`removeProperty`）**不可回滚**，cleanup 不还原 | client.js:3931-3934、3965-3969、4029-4039；cleanup 4430-4443 | cleanup 里按 `[data-dshlg-hidden]`/`[data-dshlg-saved]` 还原 |
| P1-4 | P1 | `lib/client.js` 是 4400 行**逐行重复副本**且被 `files` 发布；验证台的「lib 兜底」分支写成了同一个路径 | package.json:15；verify.mjs:54-56；lib/client.js:2622 | 删副本 + 移除 files 项；修正 verify.mjs 的兜底路径 |
| P2-1 | P2 | cleanup 其余遗漏：`untagAll` 漏摘 `dshlg-bar`/`dshlg-brand`；`composerRO` 从不 disconnect；`passTimer` 未清；`chroma/spec/flat/mx/my` 残留 | 1153-1161、2647、4163、4430-4443 | 见逐条修法（5 行补丁） |
| P2-2 | P2 | `watchComposer()` 只在**控制条已隐藏**时被调用 → `avoidComposer` 开启时可见态下没有 ResizeObserver | 2639（调用）vs 3259-3260（可见态提前 return） | `passInner` 的 `if (ctrl)` 分支里补 `watchComposer()` |
| P2-3 | P2 | 使用但从未声明的 CONFIG 键：`wallpaper.avoidComposer`、`brand.titleWords`；`glass.tint` 的注释还在但键已删 | 2675/2813/2828、3992、104-106 | 三个键补回 CONFIG 声明 |
| P2-4 | P2 | 「两个分支完全相同」×3 + 一个被静默丢弃的实参 | 2752、4252-4258、verify.mjs:54-56；2068 vs 435 | 见逐条修法 |
| P2-5 | P2 | 版本三元不一致：`package.json` 2.5.2 / `client.js` VERSION 1.9.2 / `/__alive` 1.9.2；且客户端从不校验该字段 | package.json:3、client.js:35、index.js:673、client.js:2102-2103 | 统一版本来源；或在 /__alive 用 version 兜底 |
| P2-6 | P2 | 定义了但从未使用：`hueShiftCssLinear`/`toHue`、`CONFIG.blur/saturate/radius/topbar`、`vol.dataset.dshlgVol` | 552/523、286/293/296/302、3342 | 删除（或把 legacy 键标 `@deprecated`） |
| P2-7 | P2 | `ensureStylesheet` 的第二个 `.catch` 是死路径 → styles.css 真失败时只剩「改用 link」日志，没有 warn | 1937-1952 | 合并为一个 catch / 给 link 挂 `onerror` |
| P2-8 | P2 | `window` 错误陷阱把**任何**未捕获异常都写进 `__DSHLG_ERR`（不判来源）→ 归因污染 | 3768-3778；受害判据 diagnose.mjs:79、settings.test.mjs:74/178 | 只在栈里含本插件时写入 |
| P2-9 | P2 | `if (wallList.length > 0)` 守卫让「0 张壁纸」时空提示**永不可达**，下拉框与画廊全空 | 4205-4208（提示在 3479-3484） | 去掉该守卫 |
| P2-10 | P2 | 玻璃预算只清 `unique` 集合内的旧标记 → 潜伏的坑⑧复发路径 | 4347-4362 | 重算前先全量清 `[data-dshlg-glass-over]` |
| P2-11 | P2 | 品牌行 CSS 双份自相矛盾（`flex-start` vs `center`），「居中」意图实际落空 | 1505-1510 vs 1554-1558、1544-1545 | 删掉前一份 |
| P2-12 | P2 | 宿主端口竞争/停用竞态：`listen` 回调与 EADDRINUSE 重试都不看停用状态 → 停用后仍监听 | index.js:870-925、918-928 | 加 `stopped` 标志并在回调/重试处判断 |
| P2-13 | P2 | 静态与预览路由用 `Cache-Control: no-cache` 且**无 ETag/Last-Modified** → 60 张预览图与视频每次全量重下 | index.js:734、807 | 补 `ETag`/`Last-Modified` + 304 |
| P2-14 | P2 | `Access-Control-Allow-Origin: *` + `/__wallpapers` 回传绝对路径 `root` → 任意网页可跨源读本机壁纸清单 | index.js:135-140、690 | 收紧 ACAO 到 `dsh-app://app`；响应去掉 `root` |
| P2-15 | P2 | `pass(true)` 完全绕过节流（`first` 分支不推进 `passDue`）→ 设置面板连点每次都跑整轮 | 4164-4181 | `first` 也推进 `passDue` |
| P2-16 | P2 | `PREVIEWS.clear()` 与 `/__preview` 查表竞态 → 并发时误 403（表现为缩略图退化成文字） | index.js:554-555、701-718 | 双缓冲 / 先建后换 |

---

## 二、逐条说明

### P0-1　模块级 `pass(false)` → 每次点「找回」圆点必抛 ReferenceError（坑④的活跃残留）

**问题**
`ensureRestoreDot()` 定义在 **factory 模块级作用域**（函数起于 client.js:2609，而 `applyGlass` 起于 3766），它的事件回调里直接调用了只存在于 `applyGlass` 内部的 `const pass = (first) => {...}`（4164）。`requestPass` 挂钩修的是「设置面板 / 拖动 / 重置位置」，**漏了这一处**。

**证据**
```js
// client.js:2609-2623（模块级函数）
function ensureRestoreDot() {
  ...
  el.addEventListener('click', (event) => {
    event.stopPropagation();
    setControlsHidden(false);
    el.remove();
    pass(false);          // ← 2622：pass 不在此作用域链上
  });
```
```js
// client.js:4164（applyGlass 内部，模块级看不到它）
const pass = (first) => { ... };
// client.js:4193
requestPass = (first) => pass(first);
```
全文核对（grep `\bpass\s*\(|requestPass`）结果：`pass(` 的调用点是 3817 / 3832 / 3838 / 4175 / 4403 / 4410 / 4421（**全部在 applyGlass 内，≥3766**）与 **2622（唯一的越界点）**；`requestPass` 只在 58 / 2839 / 2885 / 4193。同时逐个核对了 applyGlass 内定义的 29 个标识符（`disposed/observer/timer/wallPort/wallTried/pointerRaf/lastReportKey/wallList/findWallpaper/onWallpaperMessage/onControlCommand/paintBarRows/renderBrandLabel/stripBrandPaint/paintBrand/paintRegions/passDue/passTimer/pass/passInner/GLASS_BUDGET/STRUCTURAL/isStructural/rankOf/enforceGlassBudget/onPointerMove/onResize/start/cleanup`），**除 2622 外没有任何一处在 <3766 行被引用**。

**影响**
- 点一次「找回」圆点就抛一次未捕获 `ReferenceError: pass is not defined`；handler 在第 3 行中断，`pass(false)` 注释里写的「立刻重建控制条」**一次都没生效过**。
- 更糟的一种结局：如果页面里恰好存在全局 `pass`（别的插件/打包器泄漏），这里会**静默调用别人的函数**，不报错也没有控制条 —— 两种结局都错。
- 恢复目前完全依赖另一条机制：`el.remove()` 触发 MutationObserver（4417-4424）→ 300ms 后 `pass(false)` → `ensureControls()` 重建。该机制在 4425 行是被 `try/catch` 包住的（失败只 warn，`observer` 保持 `null`），且 `cleanup()` 后不再工作。**observer 一旦不存在，用户就永久失去控制条**（圆点已被自己删掉，正是这段代码当初要修的 bug）。
- 该异常会被 3768-3778 的 `error` 陷阱写进 `window.__DSHLG_ERR`，而 `test/diagnose.mjs:79`、`test/settings.test.mjs:74/178` 都把该字段当作「插件自身错误」——即「修好了的现象 + 一条谎报的健康状态」。

**为什么至今没暴露（可核对）**
`test/collapse.test.mjs:257-266` 确实点了圆点，但只断言结果：
```js
facts.restoreResult = await evaluate(`(() => { ...dot.click(); return { dotGone: ..., flag: ... }; })()`);
await sleep(2600);                       // ← 2600ms 足够让 MutationObserver 把控制条建回来
facts.afterRestore = await evaluate(`({ bar: !!document.getElementById('dshlg-controls'), ... })`);
// :365 check('控制条：点圆点后控制条恢复', openFacts?.afterRestore?.bar === true, ...)
```
断言的对象是**由 observer 恢复的结果**，不是**点击处理器本身是否成功**；而 `settings.test.mjs:178-183` 已经有现成的范式（交互前后比对 `__DSHLG_ERR`）却没用在圆点上。

**最小修法**
```diff
--- a/client.js                       （lib/client.js 同步，见 P1-4）
+++ b/client.js
@@ -2619,7 +2619,7 @@
         event.stopPropagation();
         setControlsHidden(false);
         el.remove();
-        pass(false);          // 立刻重建控制条
+        requestPass(true);    // 走模块级挂钩；applyGlass 未跑时降级为 no-op 而不是抛错
```
```diff
--- a/test/collapse.test.mjs
+++ b/test/collapse.test.mjs
@@ -261,7 +261,8 @@
       return { dotGone: !document.getElementById('dshlg-restore'),
+               err: window.__DSHLG_ERR || null,
                flag: (() => { try { return localStorage.getItem('dshlg.controlsHidden'); } catch { return 'ERR'; } })() };
@@ -365,7 +366,7 @@
-check('控制条：点圆点后控制条恢复', openFacts?.afterRestore?.bar === true, ...);
+check('控制条：点圆点后控制条恢复且不报错', openFacts?.afterRestore?.bar === true && !openFacts?.restoreResult?.err, ...);
```
> 这两条断言在**当前代码上会失败**，正好可以作为本条的回归证明。

---

### P1-1　`@media (prefers-reduced-motion: reduce){}` 空规则体 → 品牌流光关不掉

**问题**：注释声称「尊重『减少动态效果』：保留静态切面，不流光」，但规则体是空的（坑⑤「插了壳没插内容」的同类：只插了 `@media` 没插声明）。
**证据**
```css
/* client.js:1586-1589 */
/* 尊重「减少动态效果」：保留静态切面，不流光 */
@media (prefers-reduced-motion: reduce) {

}
```
被它「应该」关掉的动画在同文件的 1551 / 1582：
```css
/* client.js:1551 */  animation: dshlg-gem-shimmer 5.5s linear infinite;
/* client.js:1582 */  @keyframes dshlg-gem-shimmer { 0%{...} 100%{ background-position: 170% 50%, 0 0; } }
```
`styles.css` 全文**没有** `gem-shimmer`（grep 无命中），所以真机上没有任何一层能关掉它；而同一份 CRITICAL_CSS 里其它动画都老老实实关了：`#${BG_ID} i{animation:none}`（1200）、`#${GEAR_ID}`（2242-2244）、`#${CTRL_ID}`（2346-2348）、`#${RESTORE_ID}`（2448-2450）——**只有品牌这一个漏了**。
**影响**：开启「减少动态效果」的用户（前庭功能敏感）仍会看到字号 23px 的无限流光扫字；这是本项目其余部分已经遵守、唯独此处失效的无障碍承诺。
**为什么至今没暴露**：`test/README.md:358` 自己写着「**`prefers-reduced-transparency` / `prefers-reduced-motion` 没有模拟**」——测试明确不覆盖这条媒体查询。
**最小修法**（把空块填上，静态切面保留，与注释一致）
```css
@media (prefers-reduced-motion: reduce) {
  #root .dshlg-brand .dshlg-brand-label { animation: none !important; }
}
```

---

### P1-2　宿主半体 `createReadStream(...).pipe(res)` 无 error 监听

**问题**：`serve()` 先 `stat()` 再开流；两步之间文件被删除/改名、或读权限不足（工坊目录被 Steam 回收、junction 失效）时，`ReadStream` 会发出 `'error'`。`pipe()` **不转发** error，也没有任何监听器 → Node 把它当未捕获异常抛出。`serve()` 外层的 `.catch()`（876-885）只接住 Promise 拒绝，**接不住流事件**。
**证据**（三处同型）
```js
/* index.js:743  */  createReadStream(file).pipe(res);
/* index.js:830  */  createReadStream(target, { start, end }).pipe(res);
/* index.js:864  */  createReadStream(target).pipe(res);
```
grep 全文 `\.on\(` 只有 `index.js:928 ctx.on('dispose', stop)`、`s.once('error', ...)`（服务对象），三个流没有任何 error 监听。
**影响**：整个 DSH 宿主进程层面的未捕获异常风险（宿主半体与主进程同进程）；退一步也是请求悬挂 + 控制台噪声。属"静默/异步失败"类，一旦命中就是崩溃级。
**最小修法**（三处同样处理；或 `import { pipeline } from 'node:stream'` 后用 `pipeline(createReadStream(...), res, () => {})`）
```js
const stream = createReadStream(file);
stream.on('error', () => { try { res.destroy(); } catch { /* 已结束 */ } });
stream.pipe(res);
```

---

### P1-3　品牌区内联改写不可回滚（cleanup 不还原）

**问题**：`paintBrand()` 为了压掉 DSH 的「白块/蓝块」，直接对 **DSH 自己的节点**做不可逆改写，`cleanup()`（4430-4443）只删自己注入的 DOM 与样式表，**没有任何还原**。
**证据**
```js
/* client.js:3931-3934 —— 官方鱼标/字标被内联 !important 永久隐藏 */
el.dataset.dshlgHidden = '1';
el.style.setProperty('display', 'none', 'important');

/* client.js:3965-3969 —— 清掉后代的一切"画出来的底" */
el.style.setProperty('background', 'none', 'important');
el.style.setProperty('box-shadow', 'none', 'important');

/* client.js:4029-4039 —— 直接摘掉 DSH 自己写的内联属性（含 filter / backdrop-filter） */
for (const prop of ['background','background-color','background-image','background-blend-mode',
  'box-shadow','border-image','border-image-source','border-image-slice','filter','backdrop-filter']) {
  if (st.getPropertyValue(prop)) st.removeProperty(prop);
}
```
```js
/* client.js:4430-4443 cleanup：只有 untagAll + 删自己的节点，没有 restore */
```
React 重渲染不会还原「不是它写入的属性」，所以这些改写会一直留在 DOM 上。
**影响**：客户端插件 HMR 热重载（本环境默认开启）或停用插件后，官方鱼标/字标保持 `display:none`、品牌按钮丢失 DSH 自己写的 `filter/backdrop-filter`，直到整应用重启。即"停用插件反而把界面改坏"，且**没有任何入口能恢复**。
**最小修法**（先堵住最显眼的隐藏问题，3 行）
```js
/* 插到 cleanup() 的 untagAll() 之后 */
document.querySelectorAll('[data-dshlg-hidden]').forEach((el) => {
  el.style.removeProperty('display');
  delete el.dataset.dshlgHidden;
});
```
（彻底版：在 `renderBrandLabel`/`stripBrandPaint`/摘属性之前，先把 `el.getAttribute('style')` 存进 `el.dataset.dshlgSaved`，cleanup 里整体写回；`[data-dshlg-saved]` 不在 `keepList`（1314）里，不影响清理规则。）

---

### P1-4　`lib/client.js` 是 4400 行的重复副本，`files` 还把它发出去

**问题**：项目里有两份**逐行相同**的客户端半体。抽样比对（client.js 与 lib/client.js 的 2399-2410、2612-2627 完全一致，行数同为 4483，且 P0-1 的 bug 在两边是同一行 2622）。`package.json` 的 `files` 同时包含两者；真正被加载的只有根 `client.js`（`exports["./client"]`，check-install.mjs 已 PASS），所以 `lib/client.js` 是**发布出去但永不执行**的副本。
**证据**
```json
/* package.json:12-17 */
"files": ["index.js", "client.js", "lib/client.js", "styles.css"]
```
验证台里那句「lib 兜底」更是写坏了（两个分支相同 → 兜底恒等于正路）：
```js
/* test/verify.mjs:54-56 */
const CLIENT_JS = existsSync(join(PLUGIN_DIR, 'client.js'))
  ? join(PLUGIN_DIR, 'client.js')
  : join(PLUGIN_DIR, 'client.js');       // ← 本意应是 lib/client.js
```
（对照：`stylesheetUrls()` 里还专门为 lib/ 布局留了 `../styles.css` 候选，1874-1881 —— 说明 lib/ 布局是历史遗留。）
**影响**：本项目第一大失败模式就是「改了一处、漏了另一处 → 静默失效」（坑①③④⑤⑦全是这个形状）。4400 行的双真相是同类坑的最大温床：任何一次只改根文件的修复，都会在仓库里留下一份 200KB 的、看起来同样权威的旧副本。
**最小修法**
1. 删 `lib/client.js`；2. 从 `package.json` 的 `files` 删掉 `"lib/client.js"`；3. `verify.mjs:56` 若确实要兜底，改成 `join(PLUGIN_DIR, 'lib', 'client.js')`，否则删掉三元只留一行 `const CLIENT_JS = join(PLUGIN_DIR, 'client.js');`。
   建议顺带跑一次哈希确认现在是否逐字节相同：`Get-FileHash client.js, lib\client.js`（我无 shell，只做了 3 处抽样比对）。

---

### P2-1　cleanup 其余遗漏（5 行补丁）

| 遗漏 | 证据 | 影响 |
|---|---|---|
| `untagAll()` 只摘 6 个类，漏了 `dshlg-bar`/`dshlg-brand` | 1155 `el.classList.remove(CLS_GLASS, CLS_TOOLBAR, CLS_SIDE, CLS_RIGHT, CLS_APPROVAL, CLS_MODAL)`（`CLS_BAR`/`CLS_BRAND` 在 69-70 定义、3911/4016 使用） | 停用后 DSH 的会话行/品牌行仍挂着插件类名（当前样式表已删故无观感问题，但一旦有第二条样式来源就会重新生效） |
| `composerRO`（ResizeObserver）从不 disconnect | 声明 2647、创建 2654、cleanup 4430-4443 无 `disconnect` | 观察者与目标节点长期驻留（真泄漏）；停用后仍在跑回调 |
| `passTimer` 未清 | 4163 声明、4173 赋值、4437 只 `clearTimeout(timer)` | 停用后可能多跑一次 `pass(true)`（4155 有 `disposed` 保护，实际无害，但属清理不完整） |
| `data-dshlg-chroma/spec/flat` 与内联 `--dshlg-mx/my` 残留 | 4076-4086、4025/4247 | 属性留在应用节点上，后续版本规则一变就会命中 |
| `:root` 上的 `--dshlg-*` / `data-dshlg-gem` 残留 | 4235-4241、2811 | 全局变量污染，别的插件同名会被喂到脏值 |

**最小修法**
```diff
@@ untagAll()（1153-1161）
-        el.classList.remove(CLS_GLASS, CLS_TOOLBAR, CLS_SIDE, CLS_RIGHT, CLS_APPROVAL, CLS_MODAL);
+        el.classList.remove(CLS_GLASS, CLS_TOOLBAR, CLS_SIDE, CLS_RIGHT, CLS_APPROVAL, CLS_MODAL, CLS_BAR, CLS_BRAND);
+        delete el.dataset.dshlgRegion; delete el.dataset.dshlgChroma;
+        delete el.dataset.dshlgSpec;   delete el.dataset.dshlgFlat; delete el.dataset.dshlgHidden;
@@ cleanup()（4436 附近）
         if (observer) observer.disconnect();
+        composerRO?.disconnect(); composerRO = null;
         if (timer !== null) clearTimeout(timer);
+        if (passTimer !== null) clearTimeout(passTimer);
         untagAll();
+        document.querySelectorAll('[data-dshlg-region],[data-dshlg-spec],[data-dshlg-chroma]')
+          .forEach((el) => el.removeAttribute('style'));
```

---

### P2-2　`watchComposer()` 只在控制条「已隐藏」时安装

**问题**：`watchComposer()`（2648-2660）是唯一会建 ResizeObserver 的地方，而它只在 `ensureRestoreDot()`（2639）里被调用 —— 那条路径只在控制条**已收起**时走（3246-3252）。于是 `CONFIG.wallpaper.avoidComposer = true` 时，"输入框长高 → 控制条重定位"这套逻辑在**控制条可见**时完全没有观察者。
**证据**
```js
/* 2639 唯一调用点，在 ensureRestoreDot 内 */
watchComposer();
/* 3246-3252：ensureControls 走到这里时控制条根本不存在 */
if (controlsHidden()) { ...ensureRestoreDot(); return null; }
/* 3259-3260：可见态直接 return，没有 watchComposer() */
let el = document.getElementById(CTRL_ID);
if (el) return el;
```
**影响**：`avoidComposer` 打开后，输入框因附件/多行变高时控制条不会让位 —— 正是注释 2644-2646 声称要解决的问题；且 `avoidComposerOverlap` 默认被 2675 短路，问题被默认配置掩盖。
**最小修法**：`passInner` 里建/取到控制条之后补一次调用
```diff
/* client.js:4202-4203 */
             const ctrl = ensureControls(theme, onControlCommand);
-            if (ctrl) avoidComposerOverlap(ctrl);
+            if (ctrl) { avoidComposerOverlap(ctrl); watchComposer(); }
```

---

### P2-3　使用但从未声明 / 注释残留的 CONFIG 键

| 键 | 使用点 | 声明处 | 说明 |
|---|---|---|---|
| `CONFIG.wallpaper.avoidComposer` | 2675、2813（由设置 `barAvoid` 写入）、2828 | **无**（wallpaper 块 314-335 没有它） | 靠 `undefined` 恰好取到「不让开」的默认值；设置面板却会写它 —— 契约不完整 |
| `CONFIG.brand.titleWords` | 3992 `String(CONFIG.brand?.titleWords ?? 'DeepSeek Harness')` | **无**（brand 块 198-211） | 同型；用户想改「按标题找品牌行」的关键词时无处可改 |
| `CONFIG.glass.tint` | 417-419（`g('tint')` 回落 `GLASS_TIERS`） | 键已删，**注释还在** | 104-106 行的注释「半透明白叠层的不透明度。0.08 = 规格值」下面紧跟着空行，描述的就是被删掉的 `tint`；读代码的人会以为有这个键 |

**最小修法**：`wallpaper` 块补 `avoidComposer: false,`；`brand` 块补 `titleWords: 'DeepSeek Harness',`；`glass` 块把 104-106 的注释改成 `/* tint 不在这里：由 glassTier → GLASS_TIERS 派生（见 g()）。 */`。

---

### P2-4　「两个分支完全相同」×3 + 一个被静默丢弃的实参

同一形状反复出现，说明是**批量改代码时的遗留**（坑⑤同族：改动只落了一半）：

```js
/* ① client.js:2752 —— 三元两边相同；且 stop 先被 append 到 defs，随后被 grad.appendChild 挪走 */
defs.appendChild(stop.parentNode ? stop : stop); // 占位，下面统一 append
grad.appendChild(stop);

/* ② client.js:4252-4258 —— 内层三元两个分支一字不差，refractRegions 判断是空转 */
ensureFilter(
  CONFIG.overlayMode === 'clear' ? 0
    : (CONFIG.refractRegions === true ? num(g('edgeRefract', 10), 10)
                                      : num(g('edgeRefract', 10), 10)),
);

/* ③ test/verify.mjs:54-56（见 P1-4） */

/* ④ client.js:2068 vs 435 —— layer() 只接受 2 个参数，第三参 24 被静默丢弃 */
const overlay = layer('overlayGlass', 0.9, 24);
function layer(name, fallbackAlpha) { ... }   // 435：没有第三个形参
```
补充 ④ 的后果：`buildOverlayCss`（2066-2084）**只读 `overlay.alpha`**，从不读 `frost`，所以「浮层模糊 24px」这个意图在两处都不存在（实际由 DSH 自己的 `--dsw-menu-backdrop-filter` 提供）。
**最小修法**：① 删掉 2752 整行（`grad.appendChild(stop)` 已足够，DOM 结果不变）；② 内层三元换成 `if (CONFIG.overlayMode !== 'clear' && CONFIG.refractRegions === true) ... ` 或直接 `: num(g('edgeRefract', 10), 10)`；④ 改成 `layer('overlayGlass', 0.9)`，若确实要给浮层单独模糊则在 `buildOverlayCss` 里用 `overlay.frost` 输出 `backdrop-filter`。

---

### P2-5　版本三元不一致

```json
/* package.json:3 */        "version": "2.5.2",
/* client.js:35 */          const VERSION = '1.9.2';
/* index.js:673 */          version: '1.9.2',   // /__alive 应答
```
且客户端拿到 `/__alive` 后**只校验 `server` 与 `features`，从不比对版本**（2102-2103），所以 `version` 目前是纯装饰字段。副作用：`report()` 横幅打的是 `v1.9.2`（4285），`test/diagnose.mjs` 采集到的也是 1.9.2 —— 排查问题时版本号对不上包版本，而 `/__alive` 里这个字段的设计初衷（678 行注释「客户端据此优先挑功能更全的那个实例」）在改用 `features` 后已经悬空。
**最小修法**：把 `VERSION` 与 `/__alive.version` 都改成从 `package.json` 单点取值（client 侧没有 import 机制，可让宿主在 `/__alive` 里返回真实版本、客户端只打日志）；短期至少把两个 `1.9.2` 与 `package.json` 对齐，否则删掉 `/__alive.version` 以免误导。

---

### P2-6　声明了但从未使用

- `hueShiftCssLinear`（552）**没有任何调用点**；`toHue`（523）只被前者调用 → 两个函数整体是死代码（品牌配色在 569-589 已改成写死 `base`/`ink`，`CONFIG.brand.hue` 也随之失效：`buildBrandVars` 只读 `alpha/base/ink`，`hue` 在 566 行的注释里还活着）。
- `CONFIG.blur`（293）、`CONFIG.saturate`（296）、`CONFIG.radius`（302）—— 与 `CONFIG.glass.*` 同名的 legacy 键，grep `CONFIG\.` 82 处命中里**没有一处**读它们（实际用的是 `g('blur')/g('saturate')/g('radius')`）。它们紧挨着 `CONFIG.topbar`（286，也从未被读）并与 `refract`（299，**有用**，3613/4409）混在一起，极易被当成有效开关去改。
- `vol.dataset.dshlgVol = vol.value;`（3342）注释说「paintControls 里值没变就不写 DOM」，但 `paintControls` 用的是 `el.dataset.dshlgState`（3355）—— 写入后无处读取。
**最小修法**：删除 `hueShiftCssLinear`/`toHue`/`CONFIG.blur`/`CONFIG.saturate`/`CONFIG.radius`/`CONFIG.topbar`/`vol.dataset.dshlgVol`；`CONFIG.brand.hue` 与 566 行注释一并删（或真的把 hue 接回 toHue，二选一，别留着两套）。

---

### P2-7　`ensureStylesheet` 的第二个 `.catch` 永不执行（styles.css 诊断盲区）

```js
/* client.js:1910-1952 */
(async () => { ...for (const url of urls) { ... } throw lastError ?? new Error('没有候选 URL'); })()
  .then(({ text, url }) => { ...el.textContent = text; console.info('styles.css 已加载…'); })
  .catch(() => {                       // ← 取不到时的兜底
    try { ...createElement('link')...; console.info('改用 <link> 加载…'); } catch { /* 都不行就只靠内联 */ }
  })
  .catch((error) => {                  // ← 永远到不了：前一个 catch 整体被 try 包住，不会抛
    console.warn('[dsh-liquid-glass] styles.css 没取到，使用内联兜底材质：', error && error.message);
  });
```
**影响**：真机上 styles.css 取不到（这是项目已知场景）时，Console 只会看到「改用 `<link>` 加载」（一句**乐观**的话），而 `link` 自己失败是静默的 —— 于是"外置材质丢了"这件事在日志里没有任何一条负面记录，只剩 `CRITICAL_CSS` 在默默兜底。这与坑⑤「静默失败」同类，属于**排障时最贵的盲区**（`test/collapse.test.mjs:83-84` 还专门测过"styles.css 缺失时优雅 404"）。
**最小修法**：合并为单个 catch，并在 `link` 上加 onerror：
```js
.catch((error) => {
  const link = document.createElement('link');
  link.id = STYLE_LINK_ID; link.rel = 'stylesheet'; link.href = urls[0];
  link.dataset.dshlgRole = 'styles';
  link.addEventListener('error', () => console.warn('[dsh-liquid-glass] styles.css 彻底取不到，只用内联兜底材质：', error && error.message));
  document.head.appendChild(link);
});
```

---

### P2-8　错误陷阱把别人的错误算到自己头上

```js
/* client.js:3768-3778 */
if (!window.__DSHLG_TRAP__) {
  window.__DSHLG_TRAP__ = true;
  const trap = (label) => (event) => {
    const err = event?.error ?? event?.reason ?? event;
    const text = (err && (err.stack || err.message)) || String(err);
    if (!window.__DSHLG_ERR) window.__DSHLG_ERR = label + ': ' + text;   // ← 不判来源
    console.error('[dsh-liquid-glass] ' + label + '：', err);
  };
  window.addEventListener('error', trap('未捕获异常'));                  // ← 全局
  window.addEventListener('unhandledrejection', trap('未处理的 Promise 拒绝'));
}
```
**影响**：DSH 里**任何**未捕获异常（别的插件、应用自身、甚至第三方 iframe 冒泡上来的）都会先写进 `window.__DSHLG_ERR`，而该字段正是本项目诊断链路唯一判据（`test/diagnose.mjs:79 err: window.__DSHLG_ERR || null`、`settings.test.mjs:74/178`）。后果是双向污染：别的插件坏了会报成本插件坏（本次 P0-1 也借这条路把一条假错误写进去）；反之若别的插件先报错占位，本插件真正的错误会被 `if (!window.__DSHLG_ERR)` 丢掉。
**最小修法**：加来源判断
```js
const own = /dsh-liquid-glass|client\.js/.test(text);
if (own && !window.__DSHLG_ERR) window.__DSHLG_ERR = label + ': ' + text;
console.error('[dsh-liquid-glass] ' + label + (own ? '' : '（外部来源，已忽略）') + '：', err);
```

---

### P2-9　「0 张壁纸」是静默的

```js
/* client.js:4205-4208 passInner */
if (wallList.length > 0) {
  paintWallpaperPicker(wallList);
  paintGallery(wallPort, wallList, onControlCommand);
}
```
```js
/* client.js:3479-3484：这段空态提示永远显示不出来 */
if (usable.length === 0) { const p = document.createElement('div'); p.className = 'empty';
  p.textContent = '没扫到可用壁纸（web / video 类型）。往 wallpapers\ 放目录或订阅工坊壁纸后重开。'; ... }
```
`paintGallery` 只在 `wallList.length > 0` 时被调用，而空态提示在 `paintGallery` 内部 —— 于是"一张都没扫到"（新装用户、Steam 路径不同、`wallpapers/` 为空）时：下拉框是空白的 `<select>`（3270-3274 建好后从没填过选项），画廊是一个空框，没有任何解释。
**最小修法**：去掉守卫
```diff
-            if (wallList.length > 0) {
-              paintWallpaperPicker(wallList);
-              paintGallery(wallPort, wallList, onControlCommand);
-            }
+            paintWallpaperPicker(wallList);
+            paintGallery(wallPort, wallList, onControlCommand);
```
（`paintGallery`/`paintWallpaperPicker` 对空数组已是幂等安全的：`sig` 空串、`usable.length===0` 走空态分支。）

---

### P2-10　玻璃预算的陈旧标记（坑⑧的潜伏复发路径）

```js
/* client.js:4347-4362 */
const all = Array.from(document.querySelectorAll('[data-dshlg-region], .dshlg-glass'))
  .filter((el) => el.isConnected && !el.hasAttribute('data-dshlg-closed'));
const unique = all.filter((el) => !all.some((o) => o !== el && o.contains(el)));   // 只留最外层
...
for (const el of unique) { if (isStructural(el)) delete el.dataset.dshlgGlassOver; }  // 只清 unique 里的
floats.forEach((el, i) => { if (i < GLASS_BUDGET) delete el.dataset.dshlgGlassOver; else el.dataset.dshlgGlassOver = '1'; });
```
**影响**：某个元素一旦因为「被更外层候选包含」而掉出 `unique`，它的旧 `data-dshlg-glass-over` 就**再也没人清**，样式层 `#root [data-dshlg-glass-over] { backdrop-filter: none !important }`（1474-1477）会长期生效。今天不会触发：可参与预算的浮层只有 `approval`/`modal` 两个，恰好等于 `GLASS_BUDGET = 2`（4323），所以 `over` 恒为 0 —— 结构面（`side`/`right`/`.dshlg-glass`）也已被 `STRUCTURAL` 排除（4324-4332），坑⑧本身修得对。但只要以后把行级 `.dshlg-bar` 或 `.dshlg-brand` 纳入候选、或把预算调小，就会立刻变成「某块玻璃莫名其妙没了模糊」。
**最小修法**：重算前先全量清一次
```diff
 const enforceGlassBudget = () => {
+  document.querySelectorAll('[data-dshlg-glass-over]').forEach((el) => delete el.dataset.dshlgGlassOver);
   const all = ...
```

---

### P2-11　品牌行 CSS 双份且互相矛盾

```css
/* client.js:1505-1510 */  #root .dshlg-brand [class*="_brand"] { display:flex !important; justify-content: flex-start !important; /* 文字靠左 */ ... }
/* client.js:1554-1558 */  #root .dshlg-brand [class*="_brand"] { display:flex !important; justify-content: center !important; /* 承载容器居中 */ ... }
```
两条选择器**特异性完全相同**、间隔 44 行，后者胜；再加上 `.dshlg-brand-label`（1512-1552）自己写着 `justify-content: flex-start; text-align: left; width: 100%`（1544-1545），最终是**左对齐**。1497 行「放大 + 居中：字更大，并在品牌行内水平居中」与 1553 行「承载容器居中」的意图并没有实现，而 1507 行「文字靠左」又与之互斥。
**最小修法**：删掉 1505-1510 那一份（保留 1554-1558），并按真实意图二选一：要左对齐就删 1554-1558 的 `justify-content: center` 与注释；要居中就把 1544-1545 改成 `justify-content: center; text-align: center;`。

---

### P2-12　宿主端口重试 / 停用竞态

```js
/* index.js:870-910 */
const start = (index) => {
  if (index >= PORTS.length) { ...; return; }
  const s = createServer(...);
  s.once('error', (error) => { if (error.code === 'EADDRINUSE') start(index + 1); ... });   // 不看是否已停用
  s.listen(candidate, '127.0.0.1', async () => {
    server = s;                                    // ← 停用后仍可能执行到这里
    try { const list = await listWallpapers(); ... } catch { ... }   // 停用后仍全量扫盘
  });
};
/* index.js:918-928 */
const stop = () => { try { server?.close(); server = null; } catch {} };
```
**影响**：`stop()` 之后（停用/热重载插件）仍可能有 `listen` 回调或 `EADDRINUSE` 重试把服务真正拉起来，且 `server` 已无人持有 → 端口 39321-39324 **永久占用**，下次启动本插件反而被自己的僵尸实例顶掉（`features` 兜底会救回功能，但端口不再释放，多轮热重载后四个端口可能耗尽）。
**最小修法**
```diff
 export function apply(ctx) {
   let server = null;
+  let stopped = false;
   const start = (index) => {
+    if (stopped) return;
     ...
     s.once('error', (error) => {
-      if (error && error.code === 'EADDRINUSE') { start(index + 1); }
+      if (stopped) { try { s.close(); } catch {} return; }
+      if (error && error.code === 'EADDRINUSE') { start(index + 1); }
     ...
     s.listen(candidate, '127.0.0.1', async () => {
+      if (stopped) { try { s.close(); } catch {} return; }
       server = s;
   const stop = () => {
+    stopped = true;
     try { server?.close(); server = null; } catch {}
```

---

### P2-13　静态 / 预览路由没有缓存验证器

```js
/* index.js:732-738  /__preview */
'Cache-Control': 'no-cache',
/* index.js:805-811  静态资源（含 .webm/.mp4/.mp3 与 iframe 的 html/js/css） */
'Cache-Control': 'no-cache',
'Accept-Ranges': 'bytes',
```
`no-cache` 的语义是「用之前必须回源校验」，而服务端**不发送 ETag / Last-Modified**（grep 全文无命中），也没有处理 `If-None-Match` / `If-Modified-Since` → 每次请求都是 200 + 完整字节。
**影响**：60 张壁纸的画廊每次打开、每次换壁纸走 `__video`（videoPage 里的 `<video src>` 指向的裸文件），都会重新下载完整字节；Steam 工坊壁纸的 preview.gif 动辄数 MB。磁盘与首屏都被白付。内存侧目前是好的：`paintGallery` 用 `sig` 门控重建（3475-3477）+ `img.loading='lazy'`（3497）+ `onerror` 时 `img.remove()`（3500-3503）。
**最小修法**：两处 `stat` 已经有 `info`，直接利用
```js
const etag = `W/"${info.size}-${Math.round(info.mtimeMs)}"`;
if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ...CORS }); res.end(); return; }
// headers 里补：
'ETag': etag,
'Last-Modified': new Date(info.mtimeMs).toUTCString(),
'Cache-Control': 'private, max-age=60',
```

---

### P2-14　CORS 全开 + 清单回传绝对路径

```js
/* index.js:135-140 */
const CORS = { 'Access-Control-Allow-Origin': '*', ... };
/* index.js:690 */
send(res, 200, JSON.stringify({ root: ROOT, wallpapers: list }), ...);
```
**影响**：服务只读、只绑回环、并且做了路径穿越校验（`insideDir` 188-193、`decodedRaw` 拒 `..` 658-661），所以拿不到壁纸目录之外的东西；但 `ACAO: *` 意味着**用户浏览器里任何网页**都可以 `fetch('http://127.0.0.1:39321/__wallpapers')` 读到：本机壁纸清单（标题）、以及 `root` 里的绝对路径（形如 `D:\AI应用\dsh-liquid-glass\wallpapers\`，会暴露用户名/目录结构）。这是低危但确凿的本机信息泄露面。
**最小修法**：把 `Access-Control-Allow-Origin` 换成具体来源（客户端页面是 `dsh-app://app`；若该来源在请求头里不可靠，就给 URL 加一次性 token 由客户端带上），并从 `/__wallpapers` 响应里删掉 `root` 字段（客户端代码从未读它：grep `data.root` 无命中，只读 `data.wallpapers`，3586-3587）。

---

### P2-15　`pass(true)` 完全绕过节流

```js
/* client.js:4162-4181 */
let passDue = 0;
const pass = (first) => {
  if (disposed || !document.body) return false;
  if (!first) {
    const now = Date.now();
    if (now < passDue) { ...尾随补偿...; return false; }
    passDue = now + 200;         // ← 只有非 first 才推进
  }
  return passInner(first);
};
```
节流的设计是好的（尾随执行补上了被丢掉的调用，4169-4177 的注释与实现一致，没有"丢更新"）。但 `first === true` 的调用**既不检查也不推进** `passDue`，而所有用户交互都走这条路：`commitSetting → requestPass(true)`（2839）、重置位置（2885）、`start()`（4410）、尾随补偿（4175）。连点设置面板的档位按钮 → 每次都跑一整轮 `passInner`（`readTheme` 摘/插样式表 + 全量 CSS 重建 + `buildBaseCss/buildRegionCss/buildOverlayCss/buildControlsCss/buildCss`）。
**最小修法**
```diff
   if (!first) {
     const now = Date.now();
     if (now < passDue) { ...尾随...; return false; }
-    passDue = now + 200;
   }
+  passDue = Date.now() + 200;
   return passInner(first);
```
（保留 `first` 的"不被拒绝"语义，同时让后续调用仍然被合并。）

---

### P2-16　`PREVIEWS.clear()` 与 `/__preview` 的竞态

```js
/* index.js:552-556 */
async function listWallpapers() { const out = []; MOUNTS.clear(); PREVIEWS.clear(); ...
/* index.js:699-718 */
if (!scanned) { await listWallpapers(); }        // scanned 一旦为 true 就再也不补扫
const id = url.searchParams.get('id') ?? '';
const file = PREVIEWS.get(id);
if (!file) { send(res, 403, 'forbidden'); return; }
```
**影响**：并发的 `/__wallpapers`（第二次打开界面、多窗口、或 `/__video` 的 `MOUNTS.size === 0` 补扫 751-757）会清空 `PREVIEWS`，此时到达的 `/__preview` 查表落空 → 403 → 客户端 `img` 的 `onerror` 把缩略图退化成两个字（3500-3503）。表现是"偶发有几张缩略图变成文字"，重启就好了 —— 典型的间歇性静默失败。
**最小修法**：先在临时 Map 里建好再整体替换（`const next = new Map(); ... PREVIEWS.clear(); for (const [k,v] of next) PREVIEWS.set(k,v);`），或在 `/__preview` 查表落空时补扫一次再查。

---

## 三、历史 8 类坑的逐条复核结论

| 坑 | 结论 | 证据 |
|---|---|---|
| ① `this._apply` / 依赖 `this` | ✅ 无残留 | grep `\bthis\.` 全文只命中 3 处**注释**（3759/3762/4458）；导出用对象字面量方法 `apply(ctx)`（4465）且内部 try/catch 不外抛（4466-4472），factory 最外层还有一层兜底（4475-4481） |
| ② CONFIG 键撞名 | ✅ 已分离，但有 1 处同型残留 | `sidebar`（bool，1083/4090）与 `sidebarGlass`（对象，2027）已分开，`right`/`rightGlass`、`modal`/`modalGlass` 同理；`brand` 仍是「对象兼开关」（4097/4243 当布尔用），见 P2-3/P2-11 |
| ③ 动态样式表 id 写错 | ✅ 无残留 | `STYLE_ID='dshlg-critical'`（36）→ 1894 查/1897 赋一致；`STYLE_ID_DYN='dshlg-style'`（37）→ 3702 查/3705 赋一致（3705 还留了警示注释）；`STYLE_LINK_ID`（38）→ 1907/1927-1930 一致；cleanup 4440 三个 id 都在清单里 |
| ④ 模块级调 `pass()` | ❌ **仍有 1 处活跃**（P0-1） | 2622；其余调用点全在 applyGlass 内（≥3766） |
| ⑤ 只插调用没插定义 | ⚠️ 2 处同型 | P1-1（空 `@media`）、P2-4（相同分支/丢弃实参）；另外逐个核对了 applyGlass 内 29 个标识符的定义-使用关系，无其它"用了没定义" |
| ⑥ CSS 注释里的反引号截断模板 | ✅ 扫描通过 | Lead 代跑 `scanbt2.mjs`：client.js / index.js 均「模板内部注释不含反引号」；人工复核最危险的 CRITICAL_CSS 注释（1444-1448、3631-3636、2380-2384）确实没有裸反引号，1446-1447 里是**已转义**的 `\`` |
| ⑦ 拖动点击抑制标记残留 | ✅ 已修得对 | 用时间戳 `data-dshlgDraggedAt` + 250ms 窗口 + `event.target !== el` 子元素放行（3089-3095），注释把两个坑都写清了；`pointercancel` 也走 finish（3082） |
| ⑧ 玻璃预算误伤结构面 | ✅ 已修（有潜伏分支） | `STRUCTURAL = new Set(['side','right'])` + `.dshlg-glass` 例外（4324-4332）、`data-dshlg-closed` 不占额度（4349）；潜伏问题见 P2-10 |

---

## 四、验证执行情况（透明记录）

| 检查 | 执行者 | 结果 |
|---|---|---|
| `node --check client.js` | Lead（代跑） | exit=0（语法通过） |
| `node --check index.js` | Lead（代跑） | exit=0 |
| `node D:\dev-cache\temp\scanbt2.mjs`（模板反引号扫描） | Lead（代跑） | client.js ✓ / index.js ✓ |
| `node test\check-install.mjs` | Lead（代跑） | exit=0，12 项全 PASS（bundle 注册、link 依赖、`dsh.client` 声明、`exports["./client"]`、客户端半体存在 202581 字节、patch 声明、bundle 可解析、profile 可见、junction 指向源目录） |
| 「调用了但未定义」标识符 | 本报告（静态） | grep 全量比对：唯一越界是 client.js:2622 的 `pass` |
| 「定义了但未使用」常量/函数 | 本报告（静态） | 见 P2-6（7 个：2 函数 + 4 CONFIG 键 + 1 DOM dataset） |
| 「同一 CONFIG 键出现两次」 | 本报告（静态） | CONFIG 字面量（85-340）内**无重复键**；`layer('overlayGlass', 0.9, 24)` 的多余实参见 P2-4 |
| 真机/CDP 运行验证 | ❌ 本会话无 shell | 我的 pwsh 被沙箱 ACL 阻断（`SetNamedSecurityInfoW failed (Win32 5): grantWrite(...)`），delegated subagent 权限范围固定、无法提权；因此**所有 P0/P1 结论都由"全文精读 + 代码路径交叉核对"支撑**，其中 P0-1 的触发器（2622 是模块级、`pass` 只在 applyGlass 内定义）是纯静态可判定的事实，不依赖运行。 |

### 建议补跑的两条命令（我无 shell）
1. `Get-FileHash D:\AI应用\dsh-liquid-glass\client.js, D:\AI应用\dsh-liquid-glass\lib\client.js -Algorithm SHA256` —— 确认 P1-4 的"逐字节相同"（我只抽样比对了 3 处）。
2. 把 P0-1 的测试补丁（见其「最小修法」）打上后，先不改 client.js 跑一次 `node test\collapse.test.mjs`，应当看到「点圆点后控制条恢复且不报错」**失败** —— 这是对该缺陷最直接的运行级证明；改完 2622 再跑应当转绿。

### 建议纳入 test/README 的已知盲区（原有 + 本次新增）
- `prefers-reduced-motion` / `prefers-reduced-transparency` 未模拟（原有，README:358）→ 掩盖了 P1-1。
- 交互类断言只验"结果"不验 `__DSHLG_ERR`（本次新增，见 P0-1）→ 掩盖了 P0-1；`settings.test.mjs:178-183` 已有正确范式，建议推广到全部点击路径。
- cleanup / dispose 路径无任何测试（本次新增）→ 掩盖了 P1-3、P2-1、P2-2。
