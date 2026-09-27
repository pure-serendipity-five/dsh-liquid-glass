# 交接文档 · DSH 液态玻璃插件

> 写给下一个接手这个项目的 AI 会话。**先读完这一份再动手。**
> 最后更新：2026-09-27 深夜（上一轮会话上下文耗尽时）

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
1. **控制中心面板「点击任何位置都没反应」—— 包括「关闭」按钮。面板关不掉、不能用。** ← 用户的唯一阻塞项
2. **控制中心「工作区」页签显示「共 0 个 / 宿主没返回任何工作区」**，而宿主实测返回 `count: 2`
3. **壁纸控制条仍在闪烁**（已定位一个确切热源并修了，但可能还有第二个）
4. 架构审查报告里的 P1/P2 未修（见 `review/01-architecture.md`）

### 🔄 上一个会话正在做
已把 1 和 2 交给 teammate `verifier`（它写的控制中心代码），要求：
- 在 `ccOnClick` / `ccOnOutsidePointer` / `ccClose` / `ccRender` 入口加 **try/catch + 写 `window.__DSHLG_CC_ERR`**
- 对照宿主真实响应核「共 0 个」的解析

**先问用户拿到 `verifier` 的结果**（或直接看 `D:\Documents\deepseek-harness\default-workspace\lg-verify\` 有没有新产物）。

---

## 二·补 · 【最新】①②两个问题的根因已找到（verifier 诊断，高置信）

### ①「共 0 个工作区」= 形状不匹配（确切）
宿主返回**包了一层**的对象：
```js
controlJson(res, 200, { ok: true, version, currentCwd, count: workspaces.length, workspaces });  // index.js:1330
```
客户端**当纯数组用**：
```js
ccState.workspaces = Array.isArray(out.data) ? out.data : [];   // client.js:248 → 永远是 []
```
`Array.isArray({ok,count,workspaces:[...]})` === `false` → 落到 `[]` → 显示 0 个。
`sessions` 完全相同（`index.js:1534` 返回 `{ok, …, sessions}`，`client.js:260` 同样当数组用）。
**修法**：`ccPickArray(data, keys)` 形状容错（数组直接用；对象依次找 `workspaces`/`sessions`/`items`/`list`/`data`/`rows`）；**都找不到就显示「形状不认识 + 顶层字段名」而不是静默变空**。

### ②「点击任何位置都没反应」= 极可能是 ① 引发的连锁（verifier 的核心线索）
`ccSig()`（`client.js:136`）里有 `w.map(...)`。一旦 `ccState.workspaces` 是**对象**，之后**每一次** `ccRender()` 都会抛 `w.map is not a function`；
而 `ccRender` **原来只有内层 try**（只护住分页渲染），**开头那段没有保护** → 异常被吞 → **所有点击静默死掉，包括「关闭」**。

**已被排除的怀疑**（verifier 逐行核过，别再查）：
- ❌ `ccOnOutsidePointer` 拦截：`client.js:949–957` 第一件事就是 `if (t && box.contains(t)) return;`，**且没有 `stopPropagation()`**
- ❌ 兜底面抢点击：`1030–1036` 同样先判 `box.contains(t)`
- ❌ 层级：面板 `2147483001` > 兜底面/控制条/齿轮 `2147483000`
- ❌ `pointer-events: none`：只有 3 处（SVG 滤镜容器 1651 / 品牌伪元素 2192 / 13px 渐隐带 2770），都够不到面板
- ❌ handler 没挂上：`1052` 确实挂了

### 待落地：`cc4-patch.txt`（9 条 X1–X9，已写好）
`D:\Documents\deepseek-harness\default-workspace\lg-verify\cc4-patch.txt`
内容：X1 错误埋点 `window.__DSHLG_CC_ERR`（**不写 `__DSHLG_ERR`**，避免 `settings.test.mjs` 变红）/ X2–X5 四个入口包 try / X6–X7 形状容错 / X8–X9 系统页显示 degraded。

**⚠️ 落地器 `cc4-patch.mjs` 卡在一个点**：`X1` 是 `@@NEWONLY`（纯插入）**但排在第一条**，而落地器的规则是「纯插入必须接在上一条补丁之后」→ 直接拒绝。
**修法二选一**：① 把 X1 改成带 `@@OLD` 锚点的普通补丁；② 调整补丁顺序让非 NEWONLY 的打头。
（`cc4-patch.mjs` 已由 Lead 生成 = `cc2-patch.mjs` 的副本 + 换 FILES 列表，含「`'@END'`→`'@@END'`」与「纯删除补丁幂等判据」两处 bug fix。）

### ⚠️ cc4 落地实测结果（Lead 代跑，2026-09-27 收尾时）
```
node cc4-patch.mjs --check
  解析补丁 9 条（cc4-patch.txt）
  目标 client.js（LF，225201 字节）
  锚点唯一：X1 / X2 / X3 / X4          ← 前四条通过
  ✗ 锚点找不到：X5 ccRender 外包一层   ← 卡在这里，落地器全有或全无
```
**X1 的 `@@NEWONLY` 首位问题已由 verifier 改成带 `@@OLD` 的普通补丁（插入点 `client.js:88–89`），已通过。**
**剩余卡点：X5 的锚点与实际文件不匹配**（X6–X9 还没轮到验）。
→ **修法**：把 X5 的 `@@OLD` 换成从当前 `client.js` 里**逐字读出来**的 `ccRender` 开头（**不要手打** —— 本项目已因手打锚点漂移卡住过 4 次：6/7 空格、8/10 空格、中间夹 5 行注释、17 行块）。
→ 可复用 Lead 写的对比工具 `D:\dev-cache\temp\anchor-diff.mjs`（打印每条 `@@OLD` 的匹配次数与首个差异码点）。

### ⚠️ 两条来自 verifier 的重要提示（务必看）
1. **`ccApi()` 的回落路径是个隐患**：`client.js:97–101`，端口没探到时回落到 `CC_API_FALLBACK = '/dshlg-control'`（同源相对路径）→ **必然 404**。而 `ccPort` 只在 **`client.js:5376`**（applyGlass 的 `findWallpaper` 里）被赋值。
   → 面板能出数据的前提是：**`ccPort` 已赋值 且 宿主 `/__alive` 的 `features` 含 `control`**。
   → 为一版更稳的**三态能力判定**（`pending` / `no_service` / `no_control`，不满足就**先不发请求**、直接给可操作降级页）**没有落地**，草稿在 `lg-verify\cc3-patch-js1.txt`（8 条，锚点是 6010 行版本，**需重新对锚**）。若接手的会话遇到用户报「控制服务未连接」，**八成就是这个回落路径**。
2. **⛔ 本轮所有对 `client.js` 的诊断都只有「静态证据」** —— verifier 没有 shell、**没跑过一次测试、没截过图**；`window.__DSHLG_CC_ERR` / `__DSHLG_CC_LAST` 正是**为了把「猜」变成「测」**才加的埋点。
   **不要把 verifier 的推理当成实测结论。** 宿主侧（`index.js` / `/dshlg-control/*`）的结论**是 Lead 实测的**（带 Origin 的 HTTP 请求），可信。

### 落地后的两个观察点
1. **「共 N 个」应该变成 `2`**（宿主实测：`AI应用` + 默认工作区）→ 直接验证 X6 的形状修复
2. 点击若仍无反应 → 三行 console（见下）
```js
JSON.stringify(window.__DSHLG_CC_ERR)     // 有没有抛、抛在哪
JSON.stringify(window.__DSHLG_CC_LAST)    // handler 到底进没进
(()=>{const p=document.getElementById('dshlg-cc');return [p&&p.getAttribute('data-dshlg-cc-open'),p&&p.hasAttribute('hidden'),p&&getComputedStyle(p).display];})()
```
第三行能区分「handler 没跑」与「跑了但面板没关掉」。

---

## 三、立刻要做的（诊断结论已给出，不用重新调查）

### 问题 1：面板点击无反应
已确认的事实：
- `#dshlg-cc` = `z-index: 2147483001`，兜底面 `#dshlg-cc-backdrop` = `2147483000` → **层级不是问题**（面板在兜底之上）
- `client.js:1052` `el.addEventListener('click', ccOnClick)` → 委托**挂上了**
- `client.js:1057` `document.addEventListener('pointerdown', ccOnOutsidePointer, **true**)` → **document 捕获阶段的 pointerdown，早于 click**
- `client.js:1012` `ccToggle()` = `ccIsOpen() ? ccClose() : ccOpen(tabId)`
- `client.js:752` `if (a === 'close') { ccClose(); return; }`

**两个怀疑方向**：
- **A**：`ccOnOutsidePointer`（捕获阶段）把面板内部的点击也判成"外部"，先 `ccClose()` 或 `stopPropagation()` → 后续 `click` 到不了 `ccOnClick`
- **B**：`ccOnClick` 或 `ccRender()` 抛异常 → 每次点击静默失败（本项目有前科）

**兜底方案（有信心一次做对）**：把点击处理改成**最简可靠形式** —— 每个按钮**直接** `addEventListener`，**不走委托、不依赖捕获阶段的 pointerdown**。牺牲优雅换绝对可用。

### 问题 2：「共 0 个工作区」
宿主实测返回（**字段以此为准**）：
```json
{ "ok": true, "count": 2,
  "currentCwd": "D:\\Documents\\deepseek-harness\\default-workspace",
  "currentBasis": "最近活跃会话的 cwd",
  "flagsAvailable": true,
  "workspaces": [ { "id":"...", "name":"AI应用", "path":"D:\\AI应用",
                    "isCurrent":false, "sessionCount":3, "pinnedCount":0,
                    "archivedCount":0, "status":"ok",
                    "createdAt":"...", "updatedAt":"..." } ] }
```
→ 客户端解析/字段名对不上，属纯代码 bug。

### 问题 3：控制条闪烁
**已修的确切热源**（`1e33d11`）：`positionGear()` 每轮 `pass()` 都**无条件写** `gear.style.left/bottom`，即使值没变 → 标记 dirty → 重绘；齿轮紧贴控制条同层 → 观感是控制条在闪。已改成 `setGearPos()` 判重后再写。

**若仍闪**，下一个怀疑顺序（来自未落地的补丁数据，可参考 `lg-verify/cc3-patch-js2.txt`）：
- `applyStyle()` 每轮重写 `<style>` 的 `textContent`（样式表一变 → 整页重算样式）
- `paintControls()` 的 state-stamp 判重被破坏
- `ensureControls()` 每轮重建子节点

**做法**：加计数器 `window.__DSHLG_FLICKER = { pass, passMutate, ctrl, paint, style, styleMutate, gear, gearMutate, ccMutate, lastReason }`，**先测量再改**。

---

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
```
**每次改完必须跑这五个，全绿才算完成。** 真机诊断：`test\诊断-双击运行.bat`（先完全退出 DSH）。

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

**先修「点击无反应」**（用户唯一的阻塞项），走**兜底方案**：把面板按钮的点击从「委托 + 捕获阶段 pointerdown」改成**每个按钮直接 `addEventListener`**。
理由：两个可疑点（捕获阶段拦截 / 处理器抛异常）一次绕开，**牺牲优雅换可用**。用户已经在这个 bug 上等了很久。

改完让用户 **F5 刷新**（不用重启）→ 立刻能验证。**这个迭代回路很短，别浪费。**
