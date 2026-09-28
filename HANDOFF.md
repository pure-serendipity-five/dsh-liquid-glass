# 交接文档 · DSH 液态玻璃插件

> 写给下一个接手这个项目的 AI 会话。**先读完这一份再动手。**
> 最后更新：2026-09-27 深夜（**第二个会话**：两个阻塞项已修完，并用真实鼠标事件实测通过）

---

## 一、这是什么 / 在哪

| 项 | 值 |
|---|---|
| 项目 | **DSH 液态玻璃主题 + 壁纸库**（DeepSeek Harness 的客户端插件） |
| 本机路径 | `D:\AI应用\dsh-liquid-glass` |
| GitHub | https://github.com/pure-serendipity-five/dsh-liquid-glass （公开，账号 `pure-serendipity-five`，`gh` 已登录） |
| 结构 | `client.js`（客户端半体，~6000 行，内联 CSS 在 `CRITICAL_CSS` + `buildControlsCss`）/ `index.js`（宿主半体，Node，本地 HTTP 服务 39321-39324）/ `styles.css`（**真机上取不到**，关键规则都内联）/ `test/` / `review/`（6 份专家报告） |
| 用户 | **发动机台架标定工程师，非程序员**；习惯双击 `.bat`；中文沟通；**结论先行**；遇到问题会**截图**发来 |

**`lib/client.js` 是 `client.js` 的镜像副本，两份必须逐字节一致**（本项目为此吃过亏）。

---

## 二、当前状态（2026-09-27 夜）

### ✅ 已经能用
- 六面玻璃、壁纸库（Steam 工坊）、品牌区「Agent-枝星」、可拖动的控制条 / 找回圆点 / ⚙ 齿轮
- 设置面板（玻璃外观，7 项）—— 外观是用户认可的基准
- **宿主侧控制中心 API 全部 200 且返回真实数据**（已实测，见第四节）
- 控制中心面板**能打开、能渲染**（分页、工具栏、蓝白果冻外观都在）

### ❌ 待修（按优先级）
1. ~~**控制中心面板「点击任何位置都没反应」—— 包括「关闭」按钮。**~~ ✅ **已修**（真因：`makeDraggable` 的指针捕获把 click 的 target 重定向了，见二·补）
2. ~~**控制中心「工作区」页签显示「共 0 个 / 宿主没返回任何工作区」**~~ ✅ **已修**（形状容错 `ccPickArray`，见二·补）
3. **壁纸控制条仍在闪烁**（已定位一个确切热源并修了，但可能还有第二个）
4. 架构审查报告里的 P1/P2 未修（见 `review/01-architecture.md`）

### ✅ 上一轮的欠账（本轮已全部还清）
`verifier` 提的两件事 —— ①形状容错、②四个入口 try/catch + `window.__DSHLG_CC_ERR` 埋点 —— **都已落地**。
但它给的「根因推理」和「兜底方案」是**错的**（见二·补开头的⚠️），**别再照着那个方向查**。

---

## 二·补 · 两个阻塞项的根因（**2026-09-27 深夜实测确认，两个都已修完**）

> ⚠️ **上一轮（verifier）给的根因是纯静态推理，已被实测推翻，不要再照着查。**
> 它的说法是「①工作区拿到对象 → `ccSig()` 里 `w.map` 抛 → 每次 `ccRender()` 都抛 → 点击静默死」。
> **实测不成立**：那一版 `ccLoadWorkspaces` 把非数组一律落成 `[]`，`[].map` 不会抛；
> 而且埋点 `window.__DSHLG_CC_ERR` 全程 `count: 0` —— **一个异常都没有**。
> 更要紧的是它建议的兜底方案（「每个按钮直接 `addEventListener`，不走委托」）**修不好这个 bug**：
> 当时 `click` 事件根本没派发到按钮上，挂在按钮自己身上的监听一样不会触发
> （实测：合成实验里按钮自己的监听确实一次都没响）。**方向反了。**

### ①「点击任何位置都没反应（包括关闭）」= `makeDraggable` 的指针捕获把 click 的 target 重定向了

**根因在 `client.js` 的 `makeDraggable()`（约 4590 行），而控制中心面板在
`ensureControlCenter()`（约 1174 行）对它调用了这个函数：**

```js
el.addEventListener('pointerdown', (event) => {
  ...
  el.setPointerCapture(event.pointerId);   // ← 元凶
});
```

按 Pointer Events 规范，**指针被捕获之后，后续那一下 `click` 的 `event.target`
会被重定向到「捕获元素」本身**。真 Edge + CDP **真实鼠标事件**实测：

| 量 | 值 |
|---|---|
| `document.elementFromPoint(关闭按钮中心)` | `BUTTON[act=close]` ← 按钮在最上层，**没被任何东西盖住** |
| 那一下 `click` 的 `event.target` | `#dshlg-cc<DIV>` ← **面板本身** |
| 于是 `event.target.closest('[data-cc-act]')` | `null` → 面板里**每一个**按钮都失配 |

所以：面板内所有按钮（页签、排序、刷新、新建、关闭…）在真机上一次都不响应，
而**面板外面的入口按钮是好的**（控制条没有整条被 makeDraggable 捕获），
所以表现正好是用户报的「面板能打开、但点里面任何位置都没反应、连关闭都关不掉」。

**为什么一直没被发现（最重要的一条经验）**：
项目现有测试（`collapse.test.mjs` / `settings.test.mjs`）**全部用 `el.click()`**。
合成 click **不产生 `pointerdown`** → `setPointerCapture` 从不发生 → 重定向从不发生
→ **测试一路全绿，真机全死**。

**修法（已落地）**：交互元素（`button/input/select/textarea/label/[role=…]` 等）上按下时
**不接管拖动、也不捕获指针**，按钮保持原生 click；只有按在面板空白处才拖动
（拖动本身照旧保留指针捕获）。必须写成 `t !== el` —— 齿轮、找回圆点这些
「自身就是 button 的拖动物」要照旧能拖（它们的 click target 就是自己，不受重定向影响）。

**新增回归测试：`test/cc-click.test.mjs`**（**用 `Input.dispatchMouseEvent` 发真实鼠标事件**，
不是 `.click()`）。覆盖：入口打开 → 工作区数据 → 排序按钮 → 页签切换 → 系统页 →
关闭 → 再开再关 → 埋点无异常。**以后凡是「点不动」类问题，先跑它。**

### ②「共 0 个 / 宿主没返回任何工作区」= 形状不匹配（**这条上一轮诊断是对的**）

宿主 `index.js:1330` 返回的是**包了一层**的对象：
```js
controlJson(res, 200, { ok: true, version, currentCwd, count: workspaces.length, workspaces });
```
客户端却当纯数组用：`Array.isArray(out.data) ? out.data : []` → 永远是 `[]`（`count` 明明是 2）。
`sessions` 一模一样。

**修法（已落地）**：`ccPickArray(data, keys)`（约 279 行）形状容错 —— 数组直接用；
对象依次找 `workspaces` / `sessions` / `items` / `list` / `data` / `rows`；
都找不到就显示「返回体里找不到…（顶层字段：…）」而不是静默变空
（静默变空正是上一版「显示 0 个但宿主有 2 个」的原因）。

**宿主实测（带 `Origin: app://dsh`，2026-09-27 23:1x，端口 39321）**：
- `/__alive` → `features: wallpapers,control`，`ACAO: app://dsh`（回显来源，跨源可用）
- `/workspaces` → 顶层 `ok, count, currentCwd, currentBasis, flagsAvailable, workspaces`，`count=2`（AI应用 / default-workspace）
- `/sessions/inspect` → 顶层含 `sessions`
- `/health` → 顶层含 `services` / `degraded` / `carrier` → 已顺手显示到「系统」页

### 顺带落地的（同一次改动，都已验证）
- **错误埋点**：`window.__DSHLG_CC_ERR`（where / message / stack / when / target）
  与 `window.__DSHLG_CC_LAST`（点击回执）；四个入口 `ccOnClick` / `ccOnOutsidePointer` /
  `ccClose` / `ccRender` 全部包了 try/catch。
  **刻意不写 `window.__DSHLG_ERR`**（那会让 `settings.test.mjs` 的「插件无异常」变红）。
  下次再有「点了没反应」，先看这两个全局量，别再靠推理。
- 「系统」页补上 **不可用服务 / 接口载体** 两行（宿主 `/health` 真的会返回 `degraded` 和 `carrier`）。
- ⚠️ **`lg-verify/cc4-patch.txt` 是个陷阱**：它的 X5 锚点里带着 `flk('cc')`，
  而本项目**根本没有 `flk` 这个函数**（手打锚点漂移的又一例）。
  直接落地会让 `ccRender` 一进去就 `ReferenceError`、面板彻底不渲染。
  **X1–X9 现在已经全部落地**（用 `edit` 逐条改的，锚点从文件里读），
  再跑 `cc4-patch.mjs` 只会报「看起来这个补丁已经打过了」——**不要重跑它**。

---

## 二·补2 · 材质定稿：四块面统一成「深色半透明玻璃」（2026-09-27 晚）

**用户定稿**：设置面板 / 控制中心 / DSH 官方设置浮层 / 头像账号菜单 —— 四块面统一成
图一那张任务卡的样式：**深色 + 半透明（壁纸透出来）+ 白字 + 1px 冰蓝描边**。
用户原话：图二图三「太透了」、图四「太实了」，并以图一红框里那张卡为参考。

| 面 | 选择器（真身类名是从 DSH 自己的 app.asar 里挖出来的，不是猜的） | 材质 |
|---|---|---|
| 设置面板 / 控制中心 | \`#dshlg-settings\` / \`#dshlg-cc\`（共用基座，两处值必须一致） | \`rgba(10,14,20,0.82)\` + 冰蓝描边 |
| DSH 官方设置浮层 | \`[class*='_overlay'] [class*='_panel']\`（真身 \`y7bFDa_overlay > y7bFDa_panel\`） | 同上 |
| 头像账号菜单 | \`[data-menu-material]\`（**portal 到 body，在 #root 外**）；但底色画在**内部 \`.material\` 层**（z-index:-1），要改的是令牌 \`--dsw-menu-surface-fill\`，**不是父元素 background** | 同上 |

**0.82 是量出来的、不是拍的**：三档 A/B 对比图（\`tools/style-preview.mjs\` + \`LG_ALPHAS\`）——
0.72 背景正文还会透上来抢注意力；0.90 壁纸几乎看不见（偏「实」）；0.82 两头都占。
**要改这个数就改两处**（共用基座 + 控制中心那条，必须一起改，否则两块面板不一样）。

配套的两条联动规则（改材质时别漏）：
- 亮壁纸兜底：\`html[data-dshlg-bright-wall]\` 下把底加厚到 0.9，**不换字色**
  （旧逻辑是「亮壁纸 → 深字」，深色玻璃下会变成深字压深底，已删）。
- 底深了字必须浅：四块面都强制 \`color: #eaf2ff !important\`；
  但 \`[class*='danger']\` 之类的红项要放行（「退出登录」「归档」）。
- DSH 官方浮层里**自带浅底**的按钮要单独处理，否则白底白字（实测踩到
  「打开配置文件」「查询用量」看不见字）—— 已统一成插件的半透明白底按钮。

### 这一轮新踩的两个坑（都已进第五节）
1. **CSS 注释里写反引号 —— 本轮又犯两次**，两次都是 \`scanbt2.mjs\` 当场抓到的
   （\`node --check\` 报 \`SyntaxError: Unexpected identifier\`）。写 CSS 注释别用反引号。
2. **特异性 (0,4,0) 的清底规则**：动态样式里有一条
   \`#root, #root *:not([data-dshlg-keep]):not([data-dshlg]):not([data-dshlg-region])
   { background-color: transparent !important }\`，会把 \`#root\` 里**任何**元素的底色清成透明。
   → 真机账号菜单是 **portal 到 body** 的，躲过了它（原来的灰底来自
   \`buildOverlayCss\` 里那层 37.8% 白纱）；
   → 给菜单写 \`#root\` 内规则会被那条压掉，所以用了重复属性的提权写法。
   **教训：改了没反应，先算特异性，再看行内变量。**
3. **负 z-index 的内部层会盖住父元素底色** —— 改「容器底色」不等于改到看得见的那层。
   账号菜单的真身结构（从 app.asar 挖出来）：
   \`div[data-menu-material] > div[aria-hidden].material{position:absolute;inset:0;z-index:-1;
   background:var(--dsw-menu-surface-fill);backdrop-filter:var(--dsw-menu-backdrop-filter)}\`
   → 菜单的灰底来自 DSH 令牌 \`--dsw-menu-surface-fill\`（浅色主题 = \`#f8f9fa94\` = 58% 近白），
   父元素上写 background **完全看不见效果**（第一次改就栽在这）。
   **修法：改令牌，不是改父元素底色。** 预览台里也要照抄这个嵌套结构，否则预览会骗人。

### 视觉验证怎么做（本轮新工具，可复用）
- \`tools/style-preview.mjs [壁纸]\`：最小复现台 + 真壁纸 + CDP 截图，一次出四张
  （控制中心 / 设置面板 / DSH 设置浮层（真身类名 mock）/ 菜单）；
  用 \`LG_ALPHAS=0.72,0.82,0.9\` 可扫多档做对比图。
  ⚠️ mock 必须照抄真身结构（portal、内部材质层、令牌），否则预览会骗人（踩过）。
- \`tools/scan-dsh-asar.mjs [语义后缀…]\`：从 \`D:\deepseek harness\resources\app.asar\`（112MB 二进制）
  里挖 DSH 的真实类名（哈希_语义）。**要动 DSH 自己的界面，先用它确认真身类名，别猜。**
  （已知：设置浮层 = \`y7bFDa_overlay/_panel/_header/_nav/_content/_close\`；
  账号菜单 = \`[data-menu-material]\` > 内部 \`.material\` 层，吃令牌 \`--dsw-menu-surface-fill\`）
- \`tools/click-probe.mjs\`：\`setPointerCapture\` 会把 click 的 target 重定向的最小实验。
- **踩坑总账：\`review/13-pitfalls.md\`**（本轮所有坑 + 检查清单，动手前扫一眼）。

---

## 二·补3 · 插件市场（控制中心「插件」页，v1.10.0 新增）

用户要「一个能下载插件的地方」。**这一页只负责找和复制，不替你装。**

| 事实 | 值 |
|---|---|
| 社区公开清单 | \`https://awesome-dsh-plugin.com/plugins.json\` —— 4000+ 插件、23 分类、中英说明、star/下载量、**权限能力与红线警告**、现成的 install 命令。实测 \`ACAO: *\`（页面能直接拉）、**5.25 MB** |
| 自己的补充清单 | \`market/index.json\`（本仓库）+ \`market/README.md\` 写了字段格式。控中心把两份合并去重 |
| 官方安装器 | \`@deepseek-ai/dsh-client-ui-plugin-manager\`（左侧栏「插件」）+ 宿主 \`dsh-plugin-manager\`：在 profile 里跑 pnpm，带**供应链校验 + 授权确认 + 风险提示**，日志在 \`profile\\.plugin-manager\\logs\\operation-*\\pnpm.log\` |
| 没有的东西 | 没有 \`dsh\` 命令行（纯 Electron 安装，\`runtime\\bin\` 只有 node/pnpm 的 shim）；没有「调起插件管理器并预填」的接口（查过 app.asar）→ 所以只能「复制标识 + 让用户粘」 |

### 三条设计约束（都是查证过的，不是拍脑袋）
1. **不自己实现安装**：自己跑 pnpm = 重复实现一条安全关键路径，还绕开官方三道校验；
   装错了 profile 起不来 = DSH 直接打不开。所以「安装」按钮 = 复制安装标识 +
   打开官方插件管理器（\`ccOpenPluginManager()\`：按文字「插件」找左侧栏入口并 click，
   找不到就给人话提示，绝不硬点别的元素）。
2. **清单不自己维护**：社区那份 4000+ 条且持续更新，自己维护只会过期。
   本仓库那份只放社区没有的（自研/私藏/内网包）。
3. **5MB 不静默拉**：第一次要用户点「加载清单」，之后 24h 走 localStorage 缓存；
   缓存存**精简字段**（4377 条全字段塞不进配额，精简后约 1MB），配额满了就只留内存。

### 实现要点（改这段代码前先看）
- 清单 URL 在 \`client.js\` 的 \`MARKET_URLS\`；缓存键 \`dshlg-market-v1\`；一次渲染 \`MARKET_PAGE=40\` 条
  （4000+ 条全渲染会把 DOM 拖死），筛选/排序在 \`ccMarketFiltered()\`。
- 安装标识 = 清单 \`install\` 字段里 \`add\` **后面那一段**（官方管理器「包名」框要的就是它）：
  \`dsh plugin --profile web add github:CAI-MH/dsh-quality-review\` → \`github:CAI-MH/dsh-quality-review\`。
- 搜索框走 \`input\` 事件 + **防抖 250ms**；重绘会重建 input（焦点会丢），
  所以 \`ccMarketSearch()\` 里重绘后要把**焦点与光标位置还回去**（踩过：打一个字就得重新点）。
- 市场状态进了 \`ccSig()\`（清单/筛选/搜索任何一项变了都要重绘）。
- 权限红线（\`capabilityRedLines\`）直接标红展示，不藏 —— 市场页有义务告诉用户「它要什么权限」。

### 这一轮新踩的坑
**\`<button>\` 不继承 \`color\`**：\`.cc-chip\` 原本只用在 \`<span>\` 上（span 继承面板的浅字），
改成 \`<button class="cc-chip">\` 之后吃 UA 的 \`color: buttontext\`（近黑）→
深色玻璃面板上变成「一排空胶囊」。**预览图里一眼就看出来了**（\`tools/style-preview.mjs\` 出的
\`preview-6-market.png\`）—— 这就是为什么材质/新界面改完要先出图看一眼，别只看测试绿不绿。

---

## 三、剩下要做的

0. **插件市场（v1.10.0）后续可选**：① 宿主只读接口 → 「已装 / 版本 / 有更新」标记；
   ② 真·一键安装（要考虑绕开官方授权校验的代价，见二·补3）。
   两件都要改 `index.js`（= 必须完全退出 DSH 才能验）。
1. **壁纸控制条闪烁**（唯一剩下的旧问题）。
   已修的确切热源：`positionGear()` 每轮 `pass()` **无条件写** `gear.style.left/bottom`，
   即使值没变也标记 dirty → 重绘（已改成 `setGearPos()` 判重后再写，提交 `1e33d11`）。
   若仍闪，下一个怀疑顺序（补丁数据在 `lg-verify/cc3-patch-js2.txt`，
   **锚点是 6010 行版本、必须重新对锚**）：
   - `applyStyle()` 每轮重写 `<style>` 的 `textContent`（样式表一变 → 整页重算样式）
   - `paintControls()` 的 state-stamp 判重被破坏
   - `ensureControls()` 每轮重建子节点
   **做法**：先加计数器测量（`pass / passMutate / paint / styleMutate / gearMutate`），
   **测量之后再改** —— 本项目踩过「凭感觉改闪烁」的坑。
2. **`ccApi()` 的回落路径隐患**：`client.js:121–126`，端口没探到时回落到同源相对路径
   `CC_API_FALLBACK = '/dshlg-control'` → **必然 404**；而 `ccPort` 只在 `findWallpaper()`
   里（约 5503 行）被赋值。三态能力判定（`pending` / `no_service` / `no_control`，
   不满足就先不发请求、直接给可操作降级页）草稿在 `lg-verify/cc3-patch-js1.txt`（需重新对锚）。
   用户报「控制服务未连接」时八成就是这个。
3. 架构审查报告里的 P1/P2 未修（见 `review/01-architecture.md`）。

## 四、环境的硬事实（这一节能省你几小时）

### 🔴 最重要：**「关闭窗口」≠ 退出程序**（DSH 托盘常驻）
- **客户端半体** `client.js`：走 HTTP，**每次页面刷新重取** → 改完 **F5 即可生效**
- **宿主半体** `index.js`：Node **进程启动时加载** → **必须真正退出再启动**（托盘图标右键 → 退出）

**用户曾连续几轮"重启"都没生效** —— 因为进程从 20:08 起就没退过。判断方法：
```powershell
Get-Process -Name 'DeepSeek Harness' | Sort-Object StartTime | Select-Object -First 1 Id,StartTime
```

### 🔴 验证跨源接口必须带 Origin（我栽在这上面）
页面在 `127.0.0.1:19387`（或应用自定义协议），服务在 `3932x` —— **跨源**。
`Invoke-WebRequest` **不做 CORS 检查**，所以我用命令行测出 200 就以为服务是好的，而浏览器全被拦。
```powershell
Invoke-WebRequest 'http://127.0.0.1:39321/dshlg-control/health' -Headers @{Origin='app://dsh'} -UseBasicParsing |
  ForEach-Object { $_.StatusCode; $_.Headers['Access-Control-Allow-Origin'] }
```
**更准的办法**：让用户在 DSH 里按 F12 → Console 粘：
```js
fetch('http://127.0.0.1:39321/dshlg-control/workspaces').then(r=>r.json()).then(console.log)
```

### 🔴 沙箱与权限
- 我的 shell 需要 `sandbox_permissions: "danger-full-access"` + 一句 justification 才能写 `D:\AI应用`（工作区外）
- **teammate（子代理）的 shell 全坏**（`SetNamedSecurityInfoW failed (Win32 5)`）、也**写不了 `D:\AI应用`** → 它们的产物落在 `D:\Documents\deepseek-harness\default-workspace\`，**需要 Lead 转存**
- **专家席位上限 8 人**；复用已收工的 teammate 用 `send_message` 唤醒

### 🔴 用户全局规矩（`~/.dsh/AGENTS.md`）
- C 盘只剩 ~24GB → 新装东西放 D 盘；真实桌面是 `D:\Desktop`；临时文件 `D:\dev-cache\temp\`
- `.bat` 必须 **GBK + CRLF**
- 涉及**删除/支付/发送**先确认
- 中文回答、结论先行、**不编造数据**

---

## 五、踩过的坑（**全是真事故，动手前扫一眼**）

| 坑 | 后果 |
|---|---|
| 插件里用 `this` | 加载器把 `apply` 解构后单独调用 → **整个插件不激活** |
| **只插了调用没插定义** | 静默 `ReferenceError`（本项目的最大时间黑洞） |
| **模块级函数引用 `applyGlass` 内部的局部标识符**（如 `pass`、`wallPort`） | 点一次抛一次；已有模块级挂钩 `requestPass`，模块级代码只能用它与 `ccPort` |
| CSS 注释里写反引号 | 截断外层模板字符串（踩过两次）→ 用 `test/scanbt2.mjs` 自检 |
| 在**容器元素**上加 `backdrop-filter` | 成为 `fixed` 后代的包含块（曾把 DSH 收起侧栏按钮锚到品牌字上）→ 玻璃画在 `::before` |
| **大面积 `backdrop-filter` + 动画壁纸 iframe** | **闪烁**（踩过两次，最后都是去掉滤镜才解决） |
| **行内 CSS 变量优先于样式表** | 我调"兜底值"完全没生效，因为自适应写了行内变量 → **改 CSS 变量类问题必须先量实际生效值** |
| **用 PowerShell 字符串改 JS/补丁文件** | `` ` ``、`${}`、`\n` 被吃掉 → 语法错误。**改文件只用 edit/write 工具** |
| **提交信息里带双引号** | PowerShell 把消息截断成 pathspec → 用 `git commit -F 消息文件` |
| **顺手做"安全加固"** | 把 CORS 从 `ACAO:*` 收紧成白名单 → **壁纸全挂**（界面来源是自定义协议）→ 别在修功能时顺手加固 |
| **锚点手打**（多行块） | 空白漂移（6/7 空格、8/10 空格、中间夹注释）→ **锚点一律从目标文件里读出来用** |
| **`<button>` 不继承 `color`** | `.cc-chip` 只在 `<span>` 上用过（span 继承浅字）；改成按钮后吃 UA 的 `color: buttontext`（近黑）→ 深色面板上一排**空胶囊**。按钮类规则要显式 `color: inherit` |
| **CSS 注释里写反引号** | 截断外层模板字符串 → `SyntaxError`。**2026-09-27 那一轮又犯了两次**，都是 `test/scanbt2.mjs` 当场抓住的 → **改完 CSS 立刻跑它** |
| **改动「没反应」先算特异性** | 动态样式里有 `#root, #root *:not(...) { background-color: transparent !important }`（**(0,4,0)**），会清掉 `#root` 内一切底色；DSH 的 portal 菜单在 `#root` 外才躲得过。改别人界面先用 `scan-asar*.mjs` 挖真身，再算特异性 |
| **测试用合成 click**（`el.click()`） | 合成 click **不产生 `pointerdown`** → 测不出 `setPointerCapture` 把 click 的 target 重定向的问题 → **测试全绿、真机全死**（控制中心为此卡了两轮）。「点不动」类问题必须用 `Input.dispatchMouseEvent` 发**真实鼠标事件**（见 `test/cc-click.test.mjs`） |
| **补丁数据里的 `flk('cc')`** | 本项目**没有** `flk` 函数；照抄 `cc4-patch.txt` 的 X5 锚点会让 `ccRender` 一进去就 `ReferenceError`、面板彻底不渲染 |
| 落地器「全有或全无」 | **它是功臣**：多次拒绝写入不完整的补丁集，保住了项目文件 |

---

## 六、验证命令（都在 `test/`）

```powershell
cd D:\AI应用\dsh-liquid-glass
node --check client.js ; node --check index.js
node test\scanbt2.mjs          # 模板反引号扫描
cd test
node collapse.test.mjs         # 主验证（真时钟 + 无头 Edge + CDP）
node settings.test.mjs         # 设置面板专项 16 项
node check-install.mjs         # 安装/注册自检
node cc-click.test.mjs         # 控制中心**真实鼠标**点击专项（「点不动」类问题必跑）
```
**每次改完必须跑这六条，全绿才算完成。**（`node --check` 两条算一条命令） 真机诊断：`test\诊断-双击运行.bat`（先完全退出 DSH）。

宿主 API 手测：
```powershell
foreach($p in '/dshlg-control/health','/dshlg-control/workspaces','/dshlg-control/sessions/inspect'){
  (Invoke-WebRequest "http://127.0.0.1:39321$p" -UseBasicParsing).Content }
```

---

## 七、文件与资料地图

| 路径 | 内容 |
|---|---|
| `review/01-architecture.md` | 架构审查（P0×1 / P1×4 / P2×16，带文件:行号与最小修法） |
| `review/02-ux.md` | 体验审查（P0×5 / P1×7 / P2×9 + 只改三件事） |
| `review/03-release.md` | 发布审查（含**「DSH 升级后重新适配」章节草稿**） |
| `review/10-control-center-plan.md` | 控制中心技术方案（骨架） |
| `review/11-control-center-cost.md` | 控制中心工期成本（三档，推荐「先做 M0+M1」） |
| `review/12-prior-art.md` | 同源项目挖掘（视频壁纸该用裸 `<video>`、对比度补两个信号、跨 Shadow DOM 40 行实现、许可证红线） |
| `D:\dev-cache\temp\dsh-dock-src\` | DSH Dock v1.3.3 源码（MIT；`docs\contract.md` = DSH 文件契约） |
| `D:\dev-cache\temp\prior-art\` | 8 个同源开源项目源码 |
| `D:\Documents\deepseek-harness\default-workspace\lg-verify\` | 专家产物暂存（`cc*-patch*.txt` = 未落地的补丁数据，**含已定位的闪烁修复**） |
| `D:\dev-cache\temp\anchor-diff.mjs` | 锚点对比工具（我写的，可复用） |
| `D:\dev-cache\temp\client.js.bak*` | 历史备份 |

**⚠️ 许可证**：`dsh-ui-enhancer` / `dsh-screen-translator` 是 MIT（可复制，须附声明）；**`dsh-WallpaperAndCost` 无许可证 = 保留所有权利 → 一行都不能抄**。我们自己 `package.json` **还没有 license 字段**。

---

## 八、给接手者的第一条建议

两个阻塞项（点击无反应 / 共 0 个）**已经修完并实测通过**，见「二·补」。所以现在的第一件事是：

1. **动手前先跑一遍 `test/cc-click.test.mjs`** —— 它用**真实鼠标事件**验控制中心，
   是「点不动」类问题的照妖镜。全绿就说明这条链路是好的。
2. **改完 `client.js` 让用户 F5 刷新**（不用重启 DSH）→ 迭代回路只有几秒，别浪费。
   改 `index.js` 才必须**完全退出 DSH 再启动**（关窗口不算退出：托盘右键 → 退出）。
3. 剩下的活见「三、剩下要做的」，第一优先是**控制条闪烁**（先加计数器测量，再改）。

> ⚠️ 别再用「每个按钮直接 `addEventListener`」那个兜底方案了 —— 它修不好这个 bug
> （当时 click 事件根本没派发到按钮上），而且会把「委托」这个结构拆散。真因在
> `makeDraggable` 的指针捕获，已修。

