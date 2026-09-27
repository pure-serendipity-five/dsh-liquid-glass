# dsh-liquid-glass · 验证台（test/）

一套**自包含、可重复**的验证：把真实的 `client.js` 放进一个重建的 DSH DOM 里跑，
用本机 Edge 无头模式截图 + 读回**真实计算样式**，最后打印一张 PASS/FAIL 表。

它回答一个问题：

> 用户要的是「**中间工作区完全透明**，但**左栏、右栏、审批卡片、弹窗必须有毛玻璃**，
> 壁纸透出来还得看得清字」。现在这份构建做到了吗？

---

## 一、怎么跑

```powershell
cd <插件目录>\test
node verify.mjs
```

跑完：

- 截图落在 `test/shots/`：`dark.png` `light.png` `wallpaper.png` `modal.png` `approval.png`
- 屏幕上打印每个区域的 PASS / FAIL / WARN，**有任何 FAIL 就以非零码退出**（可直接接 CI / 脚本）

其它参数：

| 命令 | 作用 |
|---|---|
| `node verify.mjs --self-test` | **不启动浏览器、也不需要插件在场**，自检「报告解析 + 断言判定」本身对不对 |
| `node verify.mjs --url-only` | 只打印会访问的 URL |
| `node verify.mjs --no-shots` | 不截图，只跑断言 |
| `node verify.mjs --plugin <插件目录>` | 指定被测插件目录（默认 `<本文件>/..`，也认环境变量 `DSHLG_PLUGIN_DIR`） |

退出码：`0` = 没有 FAIL（可能有 WARN）；`1` = 有 FAIL；`2` = 环境不对
（找不到插件 / 找不到浏览器 / 路径里含 cmd.exe 会改写的字符）。

依赖：只有 Node 自带模块（`node:child_process` / `node:fs` / `node:path`），**不需要 npm install**。
浏览器按顺序找 `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`、
`C:\Program Files\Microsoft\Edge\...`、Chrome 两个常见路径，取第一个存在的。

### 三种结论，别混

| 记号 | 含义 | 影响退出码 |
|---|---|---|
| `PASS` | 断言通过 | 否 |
| `FAIL` | 断言不通过 | **是**（`exit 1`） |
| `WARN` | **不判死**的警告：值能过线但明显偏弱 / 无法判定的地方（例如玻璃 alpha < 0.08、截图里出现了真壁纸、色值格式没解析出来） | 否，但汇总里计数 |
| `报告` | 纯陈述事实，供人看（输入框底色、中栏气泡、文字对比度里底色不可信的那些） | 否 |
| `INFO` | 诊断（插件注入了哪些元素） | 否 |

`--plugin` 的用处：验证台**不必**放在 `<插件目录>/test/` 下也能跑真实产物 ——
`verify.mjs` 会把真实 `client.js` 的绝对路径用 `?client=` 传给验证台，
**任何情况下被执行的都只有那一份真实 `client.js`，验证台从不复制插件代码**。

> `?client=` 的值是完整 `file:///` URL，经 `URLSearchParams` 编码。
> 如果插件目录路径里带空格或中文且加载失败，报告里的 `clientSrc` 与 `errors`
> 会直接指出加载的是哪个 URL。

---

## 二、五个场景

| 场景 | 查询参数 | 截图 | 看什么 |
|---|---|---|---|
| `dark` | `theme=dark&wallpaper=0` | `dark.png` | 深色主题 + 中性灰底：玻璃有没有颜色、糊不糊 |
| `light` | `theme=light&wallpaper=1` | `light.png` | 浅色主题 + 高对比壁纸：会不会「深字压深底」全糊 |
| `wallpaper` | `theme=dark&wallpaper=1` | `wallpaper.png` | 文字压在花壁纸上的可读性 |
| `modal` | `theme=dark&wallpaper=0&modal=1` | `modal.png` | 弹窗（浮层）单独一档 |
| `approval` | `theme=dark&wallpaper=1&focus=approval` | `approval.png` | **审批卡**单独一档（第 5 张，见下） |

`?wallpaper=0` 会隐藏高对比壁纸替身，只留 `body` 的中性底色。
两个极端都跑，是因为「玻璃有没有颜色」和「花背景上读不读得清」是两件事。

### 为什么要第 5 张截图（`?focus=approval`）

审批卡挂在会话流**最底部**，默认被折到视口外 —— 前 4 张截图里它**一次都没出现过**，
而它的断言一直是过的。也就是说：这块面到底长什么样、字压上去读不读得清，
**没有任何人用眼睛看过**，而这正是「外层糊了、里层生的」这类 bug 最该被眼睛抓到的地方。

所以：

- 验证台在 `?focus=approval` 时**只做一件事**：`approval-card.scrollIntoView({block:'center'})`
  （不改插件、不改 DOM 结构、不碰样式，不掩盖任何问题）；发布报告前会再滚一次并重新取报告，
  保证报告里的 `rect` 与截图是同一时刻的状态。
- `verify.mjs` 在 `approval` 场景多一条**守门断言**：审批卡的 `rect` 必须完整落在视口内。
  滚不动 / 没滚到位 → **FAIL**，而不是静默地拍一张看不见审批卡的图。

---

## 三、每条断言是什么意思

判定逻辑全在 `verify.mjs` 里，验证台只负责**报告事实**（`getComputedStyle` 的结果），不下结论。

| 断言 | 判据 | 为什么这么定 |
|---|---|---|
| **中栏 / 工作区完全透明** | `background-color` alpha = 0 **且** 无 `background-image` 渐变 **且** 无 `backdrop-filter` | 用户的硬要求：中间区不许有底、不许有模糊，壁纸必须原样透出来 |
| **左栏有毛玻璃** | 有 `backdrop-filter` 含 `blur(` **且** 有可见底色（`background-color` alpha > 0.02 **或** 有渐变） | 「毛玻璃」= tint + blur，缺一不可 |
| **右栏（展开态）有毛玻璃** | 同上 | 用户明确点了右栏 |
| **审批卡片有毛玻璃** | 同上 | 审批卡是压在聊天流上的浮卡，没底就没法读 |
| **弹窗 dialog 有毛玻璃** | 同上（仅 `modal` 场景） | 浮层单独一档，`overlayAlpha` 管它 |
| **聊天输入卡片有毛玻璃** | 同上 | 这是插件原本就该做好的部分（回归项） |
| **玻璃 alpha 数值下限** | 过线之后再看：有效 alpha < `0.08` → **WARN** | α=0.021 与 α=0.42 在旧判据里一样 PASS，但前者肉眼基本看不出玻璃 |
| **左栏按钮 / 右栏按钮 / 右栏文件行可读** | 每个元素不能是「`background-color` 全透明 + 无渐变 + 无 `blur`」**且 `insideGlass !== true`** | 见下面「`insideGlass` 判据」 |
| **审批卡可见性**（仅 `approval` 场景） | 审批卡 `rect` 完整落在视口内 | 保证第 5 张截图真的拍到了它 |
| **报告区域清单** | 报告里的 region key 集合 **必须与** `verify.mjs` 认识的 key 集合完全一致 | 防止 harness 与验证器脱节（见下） |
| **标记面自查** | 凡带 `data-dshlg-region` 的 `side/right/approval/modal` 元素，一律要求「有 tint + 有 blur」 | 见下面「标记面自查」 |
| **文字对比度** | 逐区域打印正文色 / 底色 / 合成色 / WCAG 对比度；**只在底色可靠不透明时才判死** | 见下面「文字对比度」 |
| **输入框底色** | **只报告不判死** | 输入框自己没底色时，是否算问题取决于它外面那层玻璃够不够 —— 交给人工看截图定 |
| **中栏气泡 / 次要文字** | **只报告不判死** | 工作区要求全透明，气泡没底色是预期内的 |
| **插件确实被加载** | `__ModuleLoader__.load` 收到 id、`apply(ctx)` 被调用、`#dshlg-style` 存在 | 防止「插件根本没跑，所以什么都没事」这种假 PASS |
| **运行期无错误** | 验证台捕获的加载/执行异常为空 | 同上 |

「可见底色」同时接受 `background-color` 的 alpha **和** 渐变，是因为插件自己的玻璃
用的是 `background: linear-gradient(...)`（写在 `background-image` 上）——
只查 `background-color` 会把一个正确的实现误判成失败。

### 「有效 alpha」是怎么算的（为什么不能只看 background-color）

分层玻璃的写法是 `background: var(--dshlg-tint) !important`，而 `--dshlg-tint` 是个
`linear-gradient(…)`。于是计算样式里 **`background-color` 是 `rgba(0, 0, 0, 0)`**，
真正的 α（side 0.42 / right 0.46 / approval 0.5 / modal 0.62）藏在渐变里 ——
只看 `background-color` 会把一整块正常的玻璃报成 α=0（要么误判 WARN，要么让人以为没上色）。

所以：

- `harness.html` 的 `lgRegion()` 额外报一个 `tintVar`（`--dshlg-tint` 的原文）；
- `verify.mjs` 的 **有效 alpha = max(`background-color` 的 α, `--dshlg-tint` 渐变层的 α,
  `background-image` 渐变里第一个色的 α)**，数值下限 WARN 与「有没有可见底色」都用它来判断；
- PASS 行会打印 `有效α=…`，`报告` 行会打印 `玻璃渐变层 α=…`，都是**实测**值。

两个来源都要看，因为它们各管一半：区域玻璃（`[data-dshlg-region]`）把色写在 `--dshlg-tint`
变量里；而 composer 那张卡（`.dshlg-glass`）把渐变**直接写在 `background` 上、没有变量**，
只看 `tintVar` 会把它当成 α=0。

### α「未知」不等于 α = 0（一条真实踩过的假绿）

`harness.html` 的 `lgAlpha()` 对**认不出的颜色格式**返回 `null`，而不是 0。
而 `Number(null) === 0` 正好为真 —— 旧代码写 `Number(r.bgAlpha) === 0` 时，
「没解析出来」会被当成「完全透明」：中栏（用户硬要求那条）会**假绿**。

现在 `verify.mjs` 统一走 `alphaOf()`：`null` / `undefined` / `NaN` 一律返回 `null`，
由调用方当「未知」处理 ——

- 中栏：未知 → **FAIL**（无法证明它透明）
- 玻璃区域：未知 → **FAIL**（无法证明它有底）
- 可读性子元素：未知 → **FAIL**（同上）
- 输入框：未知 → `报告`（它本来就不判死）

### `insideGlass` 判据（避免假红）

「字压在壁纸上」的真正判据是：**它自己和它的祖先都没有玻璃面**。

子元素自身 `background-color: transparent` 是**正常**的 —— 它压在父级那块磨砂面上。
所以 `harness.html` 给每个子元素报一个 `insideGlass`（`closest('[data-dshlg-region], .dshlg-glass, .dshlg-toolbar')`），
`verify.mjs` 只在 `insideGlass !== true` 时才把它算成 bad。

上一版只看子元素自己，会把「父级已磨砂」误判成 FAIL —— 那是假红，会让作者去改本来正确的代码。

### 标记面自查（兜底，防「外层糊了、里层生的」）

插件的玻璃可能落在**外层容器**（例如审批卡的 root、右栏轨道），而文字其实在里层卡面上。
只按固定 `data-testid` 测，就会出现「外层糊了、里层全透明，字照样压在壁纸上」却判 PASS 的假绿。

所以凡带 `data-dshlg-region` 的元素（`side` / `right` / `approval` / `modal`），
一律要求它**自己**有 `--dshlg-tint` 且有 `backdrop-filter: blur(...)`。
这条断言依赖报告里的 `plugin.taggedFacts`（每个被标记元素的真实层叠结果）——
**自检样本里也必须带 `taggedFacts`**，否则这段断言在自检里等于没跑（旧版就是这样）。

### 报告区域清单交叉校验

`harness.html` 的 `lgRegion()` 列表与 `verify.mjs` 的 `REGION_SPEC` + `EXTRA_REGION_KEYS`
是两份并行定义、靠 key 对齐。以前改一边不会报错，只会**静默地少测一组**。
现在 `evaluate()` 会断言两者的 key 集合**完全相等**，多一个少一个都 FAIL。

改 key 时必须同时改两处，这是故意的。

### 文字对比度（先报告，只在能判的地方判死）

每个区域打印一行：正文 `color`、区域底色、玻璃渐变层 α（`--dshlg-tint`）、
合成色与 WCAG 对比度。

**为什么不默认判死**：分层玻璃的底色是 `background: linear-gradient(rgba(255,255,255,α))`，
计算样式里 `background-color` 是**透明的**、真正的 α 在渐变里。
于是「文字压在什么颜色上」取决于背后那块壁纸是黑是白 —— 验证台不知道。
拿一个假设的背景去判死会产生假红。

判死条件（三条同时满足）：

1. key 属于「正文面」（`sidebar` / `rightPanel` / `approvalCard` / `modalDialog` / `composerCard`）
2. `background-color` **不透明**（α ≥ 0.98）
3. 没有渐变盖在上面（否则代表色不可知）

不满足时一律 `报告`，并把「若背后纯黑 ≈ x:1 / 纯白 ≈ y:1」两个**推断值**一并打出来供人判断
（明确标着「不是实测背景」）。**次要文字（按钮、文件行、气泡）永远只报告，不判死。**

判死时用的色值来自**实测的计算样式**，不是猜的：插件 `CONFIG.textColor: ''`（跟随主题），
所以正文颜色实际就是主题令牌 `--dsw-alias-label-primary`。

---

## 四、报告是怎么被读回来的（锚定法）

`verify.mjs` 用 `--dump-dom` 拿到整页 HTML，再从里面抠出验证台写进 `<pre id="report">` 的 JSON。

**不用** `<pre id="report">…</pre>` 这种**标签正则**：标签正则在「内容本身长得像标签」时会跨接 ——
`<pre>` 里就是 JSON、里面又带转义与字面量，或者页面别处（注释 / 说明文字）也出现同一段标签字面量时，
正则就会从**前面的开标签**一直跨到**真节点的闭标签**，抠出一段非 JSON 文本，
`JSON.parse` 报错，看起来像插件坏了，其实是取错了区间。

改用**锚定 JSON 载荷 + 括号配对扫描**（跳过字符串内的括号与转义）：

1. **主锚** `{"harness":"` —— 比 `{"harness":` 更具体（要求值确实是字符串），
   不会被 `{"harnessNote":123}` 这类**同名兄弟键**误锚；
2. 一次配不平 / 解析不了就**往后找下一个锚点**再试，不因为前面有半截载荷就整个放弃；
3. 主锚一个都没有时（例如 `harness` 不是对象的第一个键）走**兜底**：
   按 `"harness"` 这个键往前找最近的若干 `{`，逐个配平，取第一个「解出来是对象且带 `harness` 键」的。

配套的 `--self-test` 用例就在这四种情形上：

- 载荷前面有含 `<pre id="report">` 字面量的注释 + 值里有 `& < >` 转义 → 仍解出正确对象
- 载荷前面有同名兄弟键 `{"harnessNote":123}` → 不被锚错
- `harness` 不是第一个键（`href` 在前）→ 兜底路径解得出
- 第一个锚点是半截载荷 → 向后找下一个锚点
- 页面里根本没有锚点 → 返回 `null`（不抛异常、也不是 `__parseError`）

---

## 五、自检（`--self-test`）都在测什么

`node verify.mjs --self-test` 用**构造数据**验证「解析 + 判定」两段逻辑，
不启动浏览器、不需要插件在场、不需要 `client.js`。
它的存在意义是：**证明实测出来的 FAIL 是插件的问题，而不是验证器的 bug**。

样本报告的形状**必须与 `harness.html` 的 `lgBuildReport()` 一致**
（15 个 region key 一个不多一个不少、含 `taggedFacts`）——
旧版自检的样本缺 `taggedFacts`，导致「标记面自查」那段断言在自检里从来没被执行过。

`--self-test` 共 18 条（报告解析 5 条 + 断言判定 13 条）：

**解析（5）**

1. 载荷前有 `<pre id="report">` 字面量注释 + `& < >` 转义 → 仍解出正确对象
2. 同名兄弟键 `{"harnessNote":123}` → 不被锚错
3. `harness` 不是第一个键（`href` 在前）→ 兜底路径解得出
4. 第一个锚点是半截载荷 → 向后找下一个锚点
5. 页面里没有锚点 → 返回 `null`

**判定（13）**

6. 做对了的报告（含 modal、四个玻璃面 + 标记面齐全）应 **0 失败 0 警告**
7. 原始构建（三处没毛玻璃）应 FAIL（≥4）
8. 中栏 `bgAlpha=null` 必须 FAIL（**不得靠 `Number(null)===0` 当成透明**）
9. 中栏被涂上底色 + blur 应 FAIL（用户硬要求）
10. 玻璃有效 alpha=0.05 → 只 WARN、不算 FAIL
11. `taggedFacts` 里 `side` 缺 tint、缺 blur → 标记面自查必须 FAIL
12. `taggedFacts` 里 tint+blur 都有 → 标记面自查 PASS 且 failed 不增
13. 子元素自己 alpha=0 但 `insideGlass=true` → 不算 bad（假红回归）
14. 报告多一个 / 少一个区域 key → 清单交叉校验必须 FAIL
15. `approval` 场景审批卡折到视口外必须 FAIL、在视口内 PASS
16. 插件没 `apply(ctx)` 应 FAIL
17. 正文白字压白底（不透明）必须 FAIL；深字压白底必须 PASS
18. 对比度算式本身：#000/#fff = 21:1、#777 压白 4.48:1（<4.5）、#767676 压白 4.54:1（≥4.5）

> 自检是**会红的**：把第 8 条（中栏 `bgAlpha=null` → FAIL）或第 11 条（缺 tint → FAIL）
> 的期望故意改错，自检立刻报 FAIL。这证明它不是在空转。

---

## 六、验证台重建了什么（以及没重建什么）

### 逐字抄自 DSH 打包产物的真实 CSS / 类名

| 来源 | 用了什么 |
|---|---|
| `dsh-client-ui-layout` → `AppFrame.module.css` | `.ZTP-Xa_frame` `.ZTP-Xa_sidebarCol` `.ZTP-Xa_centerCol` `.ZTP-Xa_rightbarCol`（含 `[data-windows-titlebar]` 变体），以及 frame 的 `gridTemplateColumns: 280px minmax(400px,1fr) minmax(0,45vw)` 内联样式 |
| `dsh-client-ui-approval` → `ApprovalPanel.module.css` | `.EpEjdW_root/_card/_strip/_body/_headline/_command/_actionRow`，DOM 结构 `div[data-approval-key] > div.card > [strip, body, actionRow]`，`拒绝` / `允许一次` 两个按钮 |
| `dsh-client-ui-primitives` → `Modal.module.css` | `.lgModal_*`（mask 用 `backdrop-filter: var(--dsw-mask-blur)`，dialog 用 `var(--dsw-alias-bg-layer-2)` + `--dsw-elevation-prominent`） |
| `dsh-client-ui-theme` | 令牌作为**内联样式写在 `<body>` 上**（ThemePresenter 的做法）；半径、字体、阴影、`--dsh-chat-content-width` 等尺寸令牌按原值 |

### 结构

```
body                        ← 主题令牌内联在这
├── #mock-wallpaper          ← 壁纸替身（真实 DSH 里是插件注入的 #dshlg-wall）
└── #root
    └── .ZTP-Xa_frame  (grid: 280px | 1fr | 45vw)
        ├── .ZTP-Xa_sidebarCol      → 会话列表（6 个会话 + 3 个按钮；底部留 56px 躲开说明条）
        ├── .ZTP-Xa_centerCol
        │   ├── 会话滚动区（气泡 / 代码块 / 审批卡片）
        │   └── composer 卡片（[contenteditable=true] + 一行 5 个按钮）
        ├── .ZTP-Xa_rightbarCol → [data-rightbar-col] 面板（45% 宽，满高，4 个按钮 + 5 个文件行）
        └── .ZTP-Xa_overlayLayer → 弹窗（?modal=1 时才渲染）
```

`data-testid` 是**验证台自己的锚点**（插件不认这些名字）。
用它定位的好处是：插件**没**给某个区域打标记时，锚点仍然存在，断言照样失败 —— 不会被验证台「顺手」掩盖掉。

左栏 `.mock-side` 有 `padding-bottom: 56px`：留给左下角那条固定说明条
（`#mock-wallpaper .lg-caption`）。不留的话 `.mock-foot` 那行按钮会跟它叠在一起，
截图里「帮助」按钮被盖住 —— 读图的人会误以为是插件把按钮弄没了。

### 壁纸替身

`#mock-wallpaper` 是一层高对比棋盘格 + 红/绿/黄/蓝/白五个色块。
模糊会把它糊掉，全透明会让它原样透出来 —— 两种问题在截图里都一眼可见。

> ⚠️ 插件默认 `CONFIG.backdrop: true`，会自己在 `body` 最前面铺一层**不透明**光斑背景
> （`#dshlg-backdrop`，`z-index: 0`），它在 DOM 里排在壁纸替身之后，所以会盖住壁纸替身。
> 这意味着 **`wallpaper=1` 的截图里看得见的是插件的内置背景，不是那层棋盘格**。
> 想单独看壁纸替身，把插件 `CONFIG.backdrop` 改成 `false` 再跑一遍。
> 这不影响任何断言（断言查的是计算样式，不是像素）。

### 环境桩（只桩环境，不动插件）

| 桩 | 为什么 |
|---|---|
| `window.__ModuleLoader__ = { load({id, factory}) }` | 插件的入口协议。拿到 `factory(require)` 的导出后立刻 `apply({effect(){}})`，等价于框架的挂载 |
| `window.fetch` 拦 `127.0.0.1:3932x` | 插件会探宿主半体的静态服务；这里直接拒绝，模拟「宿主没起服务」，插件就会走内置背景层那条路（这正是要测的场景） |
| 内存版 `localStorage` | `file://` 下访问会抛 `SecurityError` |
| `?theme=dark\|light` | 切换两套令牌 + `data-ds-dark-theme` + `color-scheme` |
| `?focus=approval` | 把审批卡滚进视口（只为截图，见第二节） |

---

## 七、已知限制（**这是验证台的边界，别当成 DSH 的事实**）

1. **这是 DSH DOM 的替身，不是真实 DSH。** 真实 DSH 里每个 `ui-*` 包都有自己的
   `module.css`，这里只复刻了框架、审批卡、弹窗这三处，其余（气泡、文件行、按钮行）
   用的是简化样式。几何判据（侧栏 280px / 右栏 45%）按 DSH 源码设置，但没有跑过真实应用。
2. **别名调色板是近似的。** 真实 alias 色值在打包后的基础样式表里，本验证台按 DSH 自己的
   静态色阶（`--dsw-static-neutral-bluish-*` 等，逐字来自源码）取值。
   深/浅主题的**明暗事实**与插件据此做的判断是等价的，但具体色值可能有出入。
   受影响的是「看起来像不像」和**文字对比度的具体数值**，不是「断言过不过」
   （断言查的是结构事实：有没有 blur、alpha 是不是 0）。
3. **`--dsw-mask-blur` 的真实默认值是 `none`**（`gradient-shadow-text.css` 逐字如此），
   所以弹窗遮罩的 `backdrop-filter` 在本验证台里就是 `none`。弹窗 dialog 本身的毛玻璃
   仍在断言范围内。
4. **不模拟主进程 / 宿主半体。** `index.js` 的静态服务、壁纸 iframe、控制条都不参与；
   `#dshlg-wall` 正常不该存在。
   > 曾经担心「真 DSH 在跑时插件会挂上真壁纸 iframe，截图就不再是棋盘格」。
   > **查过源码后这条不成立**：`ensureWallpaper(port)` 只在 `probeServer()` 探到端口后才被调用，
   > 而验证台 stub 了 `fetch`（`probeServer` 正是用 `fetch` 探 `/__alive`），探不到 → 不挂 iframe。
   > 但为了防它哪天变成 `<img>`/`<iframe>` 直连探测，验证台仍然加了**兜底 WARN**：
   > `#dshlg-wall` 一旦存在就打印
   > 「这张截图画的可能是真壁纸，不是棋盘格替身」——**断言不受影响，但读图的人必须知道**。
5. **不模拟真实交互。** 不点按钮、不拖拽分栏、不切会话。插件打了 `MutationObserver`，
   动态重建 DOM 后的重打标记行为**没有覆盖**。
6. **`virtual-time-budget` 与真实等待不同。** 截图用的是虚拟时间（4s 预算），
   插件内部有 300ms 防抖 + 异步探端口；验证台靠「连续 3 次报告不变」来判定稳定，
   一般够用，但极端慢的机器上可能读到中间态。要更稳就用 CDP 真实等待（本验证器故意不引依赖）。
   注意验证台**不会**在插件跑起来之前就定稿：它必须看到 `apply()` 被调用过才开始数「稳定」。
7. **中文/空格路径。** 靠 `?client=` 显式传绝对路径，实测可用；
   若换到别的路径出现加载失败，报告里的 `clientSrc` 与 `errors` 会直接指出是哪一步挂了。
8. **`[data-windows-titlebar]` 没有挂上。** 真实 Windows 版 DSH 在
   `<html>` 上带这个属性（`AppFrame.module.css` 里有专门一套规则跟着它走）。
   本验证台没挂，所以走的是「无标题栏」那套规则。
   影响：不覆盖带标题栏时的 `centerCol` 圆角 / `frame` 底色分支。
9. **`prefers-reduced-transparency` / `prefers-reduced-motion` 没有模拟。**
   无头 Chromium 默认都是 `no-preference`。`AppFrame` 里为 darwin 写的
   `reduced-transparency` 分支根本没进（`data-platform` 是 `win32`）。
10. **`--dump-dom` 的输出用 shell 重定向落文件**，不走管道 —— 某些沙箱 / 杀软会拦 piped stdio。
    这也意味着如果 `cmd.exe` 不在 `PATH` 里，本验证器会报「浏览器没有输出 DOM」。
    **浏览器 stderr 每个场景一份**（`.tmp/stderr-<场景名>.log`）：以前所有场景共写一个
    `stderr.log`，后跑的会把前几个场景的浏览器现场冲掉。
11. **`shell: true` 的转义边界。** 命令行是 `spawnSync(cmdline, {shell:true})` → Windows 上就是
    cmd.exe，它在**双引号内部**依然会展开 `%VAR%`、把 `^` 当转义（延迟展开下 `!` 也会被吃），
    而 cmd 没有可靠的转义写法。所以验证器**不转义**，而是在开跑前**拒绝**含
    `% ^ ! " CR LF` 的路径（URL 里的 `%` 是正常的百分号编码，单独放行）——
    宁可报错，也不要让它静默改掉命令行。
12. **验证台不判「好不好看」。** 玻璃糊不糊、字压上去清不清楚，最终还是要人看截图。
    断言只保证「该有的结构和数值在」。

---

## 八、出问题时先看哪里

报告 JSON（`<pre id="report">`）里有这些诊断字段，用
`node verify.mjs --url-only` 拿到 URL 后，把 `?` 后面加上 `&modal=1` / `&focus=approval` 手动开浏览器也能看：

- `moduleLoader.loaded` / `applied` —— 插件有没有被加载并执行
- `plugin.taggedGlass` —— 插件到底给哪些元素打了 `data-dshlg` 标记（**最关键的一项**）
- `plugin.taggedFacts` —— 每个被标记元素的真实层叠结果（tint 变量 / backdrop），标记面自查用它
- `plugin.styleTag` —— `#dshlg-style` 在不在
- `errors` —— 加载 / 执行异常
- `regions[].bgColor / bgAlpha / bgImage / bgGradient / blur / radius / color / tintVar / rect`
- `subRegions[]` —— 左栏按钮、右栏按钮/文件行、中栏气泡逐个的计算样式（含 `color`、`insideGlass`）
- `focus` —— 这一遍是不是 `?focus=approval`

**判定逻辑本身有问题**（比如把正确实现判成 FAIL）时，先跑 `node verify.mjs --self-test`：
自检通过而实测 FAIL，那 FAIL 就是插件的问题。
