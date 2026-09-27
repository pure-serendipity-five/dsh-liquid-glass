# 13 · 踩坑总账（2026-09-27 那一轮）

> 目的：**下一个人不用重走这些弯路**。
> 每条都是真事故，不是理论风险；标注了「症状 → 真因 → 怎么发现的 → 修法 → 教训」。
> 配套：`HANDOFF.md`（当前状态与交接）、`tools/`（本次新增的复现/取证工具）。

---

## 一、这一轮解决的两件事

| # | 症状（用户原话） | 真因 | 修法 |
|---|---|---|---|
| ① | 控制中心面板「点击任何位置都没反应」，连「关闭」都点不动 | `makeDraggable()` 的 `setPointerCapture()` 把后续 `click` 的 **target 重定向到捕获元素本身** | 交互元素上按下时不接管拖动、不捕获指针 |
| ② | 控制中心「工作区」显示「共 0 个 / 宿主没返回任何工作区」，而宿主返回 `count: 2` | 宿主返回 `{ ok, count, workspaces:[...] }`，客户端当纯数组用 → `Array.isArray()` false → 落成 `[]` | `ccPickArray()` 形状容错 + 「形状不认识」降级 |

之后又做了一轮**材质统一**（设置面板 / 控制中心 / DSH 官方设置浮层 / 账号菜单
→ 深色半透明玻璃），那一轮又踩出 5 个新坑，见第三节。

---

## 二、①「点击无反应」—— 最贵的一个坑

### 症状
面板能打开（控制条上的入口按钮是好的），但**面板里每一个按钮都不响应**：
页签不切、排序不动、新建没反应，**连「关闭」都关不掉**。没有任何报错。

### 真因
`client.js` 的 `makeDraggable()`：

```js
el.addEventListener('pointerdown', (event) => {
  ...
  el.setPointerCapture(event.pointerId);   // ← 元凶
});
```

控制中心面板在 `ensureControlCenter()` 里对整块面板调了 `makeDraggable`。
按 Pointer Events 规范，**指针被捕获后，后续那一下 `click` 的 `event.target`
会被重定向到「捕获元素」本身**。面板里的点击处理是委托式：

```js
const act = event.target.closest('[data-cc-act]');   // target 是面板自己 → null
```

于是**每个按钮都匹配不上**，表现就是「点了像没点」。

### 怎么证明的（别再靠推理）
真 Edge + CDP **真实鼠标事件**（`Input.dispatchMouseEvent`）：

| 量 | 值 |
|---|---|
| `document.elementFromPoint(关闭按钮中心)` | `BUTTON[act=close]` ← 按钮在最上层，没被任何东西挡住 |
| 那一下 `click` 的 `event.target` | `#dshlg-cc<DIV>` ← 面板本身 |
| `event.target.closest('[data-cc-act]')` | `null` |

最小实验在 `tools/click-probe.mjs`（两个容器，一个捕获一个不捕获，跑一次就能看清）。

### 为什么现有测试全绿却真机全死
`collapse.test.mjs` / `settings.test.mjs` **全部用 `el.click()`**。
合成 click **不产生 `pointerdown`** → `setPointerCapture` 从不发生 → 重定向从不发生。
**这是本轮最重要的一条方法论教训：点不动类问题必须用真实鼠标事件测。**

### 教训
1. 委托式点击 + `setPointerCapture` 是**互斥**的，别同时用在同一个容器上。
2. 上一轮的建议「每个按钮直接 `addEventListener`，不走委托」**修不好这个 bug**
   —— 当时 click 根本没派发到按钮上，挂在按钮自己身上的监听一样不会触发。
   **方向错了比不做更贵**：先证伪再动手。
3. 别把「静态推理」当实测结论。本轮 `window.__DSHLG_CC_ERR` 全程 `count: 0`
   （一个异常都没有），足以推翻「handler 抛异常」那套说法。

---

## 三、材质统一那一轮新踩的 5 个坑

### 3.1 负 z-index 的内部材质层会盖住父元素底色（**改了半天没反应**）
账号菜单的灰底，第一次改父元素 `background` 完全没效果。真身结构（从 `app.asar` 挖出来）：

```js
div[data-menu-material] > div[aria-hidden].material{
  position:absolute; inset:0; z-index:-1;
  background: var(--dsw-menu-surface-fill);        /* ← 灰底在这 */
  backdrop-filter: var(--dsw-menu-backdrop-filter);
}
```

- **负 z-index 的子元素画在父元素背景之上** → 只改父元素等于没改。
- 那个令牌在 DSH 浅色主题下的原值是 `#f8f9fa94` = **58% 近白**，
  压在深色壁纸的模糊层上，就是用户看到的「灰实底」。
- **修法：改令牌 `--dsw-menu-surface-fill`，不是改父元素底色。**

> 教训：改「容器样式」不等于改到**看得见的那一层**。先确认视觉来自哪个元素。

### 3.2 特异性 (0,4,0) 的清底规则
动态样式里有一条：

```css
#root, #root *:not([data-dshlg-keep]):not([data-dshlg]):not([data-dshlg-region]) {
  background-color: transparent !important;
}
```

特异性 **（0,4,0）**，会清掉 `#root` 里**任何**元素的底色。后果：
- DSH 的账号菜单是 **portal 到 body** 的（不在 `#root` 内），躲过了它；
- 但只要给 `#root` 内的元素写规则，就会被它压掉 → 表现为「改了没反应」。

**改「没反应」时的排查顺序：先算特异性 → 再看行内变量 → 最后才怀疑选择器写错。**

### 3.3 行内变量优先（图二那层粉白纱的来历）
设置面板的「粉白纱」不是样式表里的，是 `adaptPanelReadability()` 用
`panel.style.setProperty('--dshlg-panel-veil', ...)` 写的**行内变量**（0.78）。
行内优先级高于样式表 → 用户在面板里选「全透明 + 无底」也压不过它。

**要改这类问题：先量实际生效值**（`getComputedStyle`），别改兜底值。
深色玻璃那版是靠 `!important` 把它钉死的。

### 3.4 底深了，字必须跟着浅（「底与字绑成一个决策」）
只把底改深、不管字色 → 深底压深字（DSH 浅色主题下自带深字）。
但**同一个坑还有第二层**：DSH 官方浮层里**自带浅底**的按钮被一起刷成白字 →
**白底白字**（实测：「打开配置文件」「查询用量」直接看不见字）。
修法：面板内按钮/输入框统一成插件自己那套（半透明白底 + 浅描边 + 浅字），
危险色项（`[class*=danger]`，如「退出登录」「归档」）单独放行。

### 3.5 「亮壁纸 → 换深字」的旧逻辑与深色玻璃冲突
旧规则是 `html[data-dshlg-bright-wall] … { color: #1a1030 }`（亮壁纸下用深字）。
深色玻璃下这就变成「深字压深底」。
**新逻辑：亮壁纸下不换字色，而是把底加厚**（0.82 → 0.9）。语义更干净。

### 3.6 预览台结构搭错 → 预览骗人（**最该记住的一条**）
第一次修完菜单，我的预览台显示「已经是深色了」，但真机上还是灰的。
原因：预览里我把菜单当成
`<div data-menu-material>` 直接给了背景色，而真身是
**portal 到 body + 内部 `.material` 材质层 + 令牌**。

> 教训：**复现台的结构必须照抄真身**（层级、portal、内部层、令牌），
> 否则它会给你一个「修好了」的假信号。结构不确定就用
> `tools/scan-dsh-asar.mjs` 去挖，别照着自己的想象搭。

---

## 四、这个项目反复踩的老坑（历史累积，本轮验证过的）

| 坑 | 后果 / 对策 |
|---|---|
| 插件里用 `this` | 加载器把 `apply` 解构后单独调用 → **整个插件不激活** |
| **只插了调用没插定义** | 静默 `ReferenceError`（本项目最大的时间黑洞） |
| 模块级函数引用 `applyGlass` 的局部量（`pass` / `wallPort`） | 点一次抛一次；模块级只能用 `requestPass` 挂钩与 `ccPort` |
| **CSS 注释里写反引号** | 截断外层模板字符串 → `SyntaxError`。本轮**又犯两次**，两次都被 `test/scanbt2.mjs` 当场抓住 → **改完 CSS 立刻跑它** |
| 在容器上加 `backdrop-filter` | 成为 `fixed` 后代的包含块（曾把 DSH 收起侧栏按钮锚到品牌字上）→ 玻璃画在 `::before` |
| 大面积 `backdrop-filter` + 动画壁纸 iframe | **闪烁**（踩过两次，最后都是去掉滤镜才解决） |
| **行内 CSS 变量优先于样式表** | 调「兜底值」不生效 → 先量实际生效值 |
| **同一个值写在两处**（共用基座 + 控制中心各一份） | 只改一处 → 两块面板不一致。改材质必须**一起改** |
| **锚点手打**（多行块） | 空白漂移（6/7 空格、8/10 空格、中间夹注释）→ **锚点一律从目标文件里读出来用** |
| 落地器「全有或全无」 | **它是功臣**：多次拒绝写入不完整的补丁集，保住了项目文件 |
| **补丁数据里的 `flk('cc')`** | 本项目根本没有 `flk` 函数；照抄锚点会让 `ccRender` 一进去就 `ReferenceError` |
| **测试用合成 click**（`el.click()`） | 测不出 `setPointerCapture` 把 click 重定向的问题 → **测试全绿、真机全死**（控制中心为此卡了两轮） |
| 用 PowerShell 字符串改 JS/补丁文件 | 反引号、`${}`、`\n` 被吃掉 → 语法错误。**改文件只用 edit/write 工具** |
| 提交信息里带双引号 | PowerShell 把消息截断成 pathspec → 用 `git commit -F 消息文件` |
| 顺手做「安全加固」 | 把 CORS 从 `ACAO:*` 收紧成白名单 → **壁纸全挂** → 别在修功能时顺手加固 |
| 「关闭窗口」≠ 退出程序 | DSH 托盘常驻；改 `index.js` 必须托盘右键 → 退出 |
| 验证跨源接口不带 `Origin` | `Invoke-WebRequest` 不做 CORS 检查 → 命令行 200、浏览器全被拦 |

---

## 五、检查清单（照着做就不会重复踩）

### 改之前
1. 先读 `HANDOFF.md`（当前状态、环境硬事实、踩坑清单）。
2. 问清楚**改的是哪一半**：
   - `client.js`（客户端）→ **F5 刷新**就生效；
   - `index.js`（宿主）→ **必须完全退出 DSH 再启动**（关窗口不算退出，托盘右键 → 退出）。
3. 要动 **DSH 自己的界面**（设置浮层、菜单、弹窗）→ 先用
   `node tools/scan-dsh-asar.mjs <语义后缀>` 挖真身类名与结构，**不要猜**。
4. 要动 `client.js` 里成对出现的值（共用基座 / 控制中心）→ 想好两处一起改。

### 改的时候
5. 只用 `edit` / `write` 工具改文件（**不要用 PowerShell 拼字符串改 JS/CSS**）。
6. **CSS 注释里绝不写反引号**（会截断模板字符串）。
7. 每改完一组，立刻 `node --check client.js && node test/scanbt2.mjs`。
8. 改完记得同步镜像：`lib/client.js` 必须与 `client.js` **逐字节一致**（比对 SHA256）。

### 改之后（**全绿才算完成**）
```powershell
cd D:\AI应用\dsh-liquid-glass
node --check client.js ; node --check index.js
node test\scanbt2.mjs          # 模板反引号扫描
cd test
node collapse.test.mjs         # 主验证（真时钟 + 无头 Edge + CDP）
node settings.test.mjs         # 设置面板专项
node check-install.mjs         # 安装/注册自检
node cc-click.test.mjs         # 控制中心**真实鼠标**点击专项（「点不动」类必跑）
```
9. 涉及**点击** → 跑 `cc-click.test.mjs`（真实鼠标事件）。
10. 涉及**材质/观感** → 跑 `node tools/style-preview.mjs` 出图**自己先看一眼**再下结论。

### 别做
- ❌ 顺手做「安全加固」「代码清理」—— 修功能时就只修功能。
- ❌ 凭感觉改闪烁 —— 先加计数器测量，再改。
- ❌ 手打多行锚点 —— 从目标文件里读出来。
- ❌ 把静态推理当实测结论 —— 本项目为此多花了两轮。

---

## 六、本次新增的可复用工具

| 工具 | 干什么 | 什么时候用 |
|---|---|---|
| `test/cc-click.test.mjs` | 控制中心**真实鼠标**点击全链路（打开→数据→排序→页签→系统页→关闭→埋点无异常） | 任何「点不动 / 点了没反应」类问题 |
| `tools/click-probe.mjs` | `setPointerCapture` 会不会重定向 `click` 的最小实验（A/B 对照） | 怀疑指针捕获吞了点击 |
| `tools/style-preview.mjs` | 把插件自制面板 + DSH 浮层 + 菜单放在**真壁纸**上截图；`LG_ALPHAS=0.72,0.82,0.9` 可出多档对比 | 判材质（深/透/字色），或给用户看效果 |
| `tools/scan-dsh-asar.mjs` | 从 `app.asar` 里挖 DSH 的**真实类名** | 要动 DSH 自己的界面之前（别猜选择器） |

诊断埋点（常态开着，出问题先看这两个全局量）：
```js
JSON.stringify(window.__DSHLG_CC_ERR)    // 控制中心四个入口有没有抛、抛在哪
JSON.stringify(window.__DSHLG_CC_LAST)   // handler 到底进没进
```

---

## 七、环境硬事实（会省你几小时）

- **页面在 `127.0.0.1:19387`（或 `dsh-app://`），宿主服务在 `3932x` → 跨源。**
  验证接口**必须带 `Origin`**；`Invoke-WebRequest` 不做 CORS 检查，
  命令行 200 不代表浏览器能用。
- 宿主端口是**扫描** 39321~39324 拿到的（实测本机在 **39321**），
  `/__alive` 的 `features` 里含 `control` 才提供控制 API。
- 宿主控制接口返回体统一是 `{ ok, ...payload }`，数组在 payload 的**字段**里
  （`workspaces` / `sessions`），不是顶层数组。
- 真机诊断：`test\诊断-双击运行.bat`（先完全退出 DSH）。
