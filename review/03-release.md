# 03 · 发布就绪审查（开源前的敏感信息 / 体积 / 文档 / 元数据）

> **审查对象**：`D:\AI应用\dsh-liquid-glass`（DSH 客户端插件：液态玻璃 + 壁纸画廊 + 自制设置面板）
> **审查范围**：全仓库 60 个文件（44 个文本 + 16 张 PNG），含 `test/`、`lib/`、`preview/`、`wallpapers/`
> **审查任务**：共享任务 `task-5` · 审查人 `release-reviewer`
> **工作区版本**：`package.json` 2.5.2，尚未 `git init`

---

## 结论先行（TL;DR）

| 维度 | 结论 |
|---|---|
| **凭据泄漏** | ✅ **无**。12 组关键字（API Key / token / secret / password / sk- / Bearer / gho_ / ghp_ / AKIA / BEGIN PRIVATE KEY / 私钥 / 邮箱 / 云厂商 AK）全仓库 0 命中 |
| **隐私泄漏** | ❌ **有 2 处，均为 P0**：① `test/dsh-liquid-glass-diagnose.json` 含**真实会话标题 + 对话内容片段**；② `README.md:138` 含**真实 Windows 用户名 `<用户名>`** |
| **可移植性** | ❌ 9 处硬编码本机绝对路径（含 `D:\deepseek harness\`、`D:\AI应用\`、`D:\dev-cache\`），**别人 clone 后 `test/` 基本跑不起来** |
| **体积** | ✅ 12.26 MB 无 GitHub 风险（最大单文件 1.38 MB）；但 96% 是图片/测试产物，按本报告可**瘦到 ≈2.9 MB** |
| **开源就绪** | ⚠️ 缺 LICENSE、`.gitignore`（**本次已生成**）、`.gitattributes`；README 缺「DSH 升级后重新适配」章节（**草稿见 §5**） |
| **包元数据** | ❌ `package.json` 缺 `license` / `repository` / `keywords`；`files` **漏了 `cordis.patch.yml`**（npm 场景会装坏）；三处版本号不一致 |

**发布阻断项（必须先修）**：R-01、R-02、R-03、R-04。

---

## 0. 环境限制与数据可信度声明

| 项 | 情况 |
|---|---|
| 本会话 shell | ❌ 不可用（`SetNamedSecurityInfoW failed (Win32 5)`，沙箱 ACL 初始化失败，命令未执行） |
| 体积数据来源 | Lead 用提权 PowerShell **实测**输出（§2 全部数字可复核） |
| 文本扫描 | ripgrep（本机 `grep` 工具），覆盖全部 44 个文本文件 |
| 本会话可写范围 | 仅会话工作区；`D:\AI应用\**` 写入被沙箱拒绝 → 三个交付物由 Lead 代为落盘 |
| **未覆盖/弱覆盖** | ① PNG 二进制元数据（tEXt/iTXt 可能含作者名/软件名）→ 已请 Lead 代查，结果见 §1.5；② 非 UTF-8 文件 `test\诊断-双击运行.bat`（GBK）、`test\dsh-liquid-glass-diagnose-meta.txt`；③ 未执行 `git` 相关命令（仓库尚未 init） |

---

## 1. ① 敏感信息扫描记录

### 1.1 扫描方法（可复核）

- 工具：ripgrep（`grep` 工具），默认递归 + 跳过二进制。
- 范围：`D:\AI应用\dsh-liquid-glass` 全目录（含 `test/`、`test/.tmp/`、`test/shots/`、`preview/`、`lib/`、`wallpapers/`）。
- 判定标准：命中「可直接使用的凭据」= P0；命中「真实用户名 / 私有域名 / 可定位到个人的绝对路径」= P0/P1；命中「机器相关但与个人无关的绝对路径」= P1。

### 1.2 关键字命中表（逐条，含"未命中"结论）

| # | 关键字 / 正则 | 命中 | 结论 |
|---|---|---|---|
| 1 | `(?i)api[_-]?key`、`apikey` | **0** | ✅ 无 |
| 2 | `(?i)token` | 28 处，**全部是主题令牌**（`--dsw-alias-*`、`tokenValue()`、`TOKEN_ALPHAS`、`LG_COMMON_TOKENS`） | ✅ 非凭据 |
| 3 | `(?i)secret`、`passwd`、`password` | **0** | ✅ 无 |
| 4 | `sk-[A-Za-z0-9]{20,}` | **0**（宽匹配 `sk-` 的 20 处全是 CSS `mask-image` 误报） | ✅ 无 |
| 5 | `Bearer\s` | **0** | ✅ 无 |
| 6 | `gho_` / `ghp_` / `ghs_` / `ghr_` / `github_pat_` | **0** | ✅ 无 GitHub 令牌 |
| 7 | `AKIA`（AWS） | **0** | ✅ 无 |
| 8 | `-----BEGIN`（PEM 私钥）/ `ssh-rsa` | **0** | ✅ 无 |
| 9 | `AIza…`（Google）/ `npm_…` / `xox[bp]-`（Slack）/ `eyJ…`（JWT） | **0** | ✅ 无 |
| 10 | `(?i)access[_-]?key` / `secret[_-]?key` / `private[_-]?key` / `passphrase` / `credential` | **0** | ✅ 无 |
| 11 | 邮箱正则 `[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}` | **0** | ✅ 无邮箱 |
| 12 | `(?i)192\.168\.` / `10.x.x.x` / `.internal` / `.lan` | **0** | ✅ 无内网地址 |
| 13 | `https?://` | 20 处，**全部是 `http://127.0.0.1:3932x` 本机回环** 与 `http://www.w3.org/2000/svg` 命名空间 | ✅ 无外部/私有域名 |
| 14 | `D:[\\/]AI应用` | **15 处**（README 8、test/\* 6、diagnose.log 1） | ⚠️ 见 R-03 |
| 15 | `(?i)C:[\\/]Users` / `<用户名>` | **1 处**：`README.md:138` | ❌ **P0** 见 R-01 |
| 16 | `(?i)steam` / `wallpaper_engine` / `dev-cache` / `Desktop` / `.dsh` | 31 处，均为通用 Steam 安装路径（`C:\Program Files (x86)\Steam` 等）、`D:\dev-cache\temp` 备份路径、profile 路径 | ⚠️ 见 R-03/R-10 |
| 17 | `localStorage` | 45 处，键名 4 个：`dshlg.entry` / `dshlg.settings` / `dshlg.pos` / `dshlg.controlsHidden` | ✅ 见 §1.7 |
| 18 | `process.env` / `.env` | 1 处：`test/verify.mjs:47` 读 `DSHLG_PLUGIN_DIR` | ✅ 无 .env 文件（全仓库不存在 `.env*`） |

### 1.3 ❌ P0-1：诊断报告里含**真实会话标题与对话内容**

**证据（文件:行号，逐条可打开核对）**

```
test/dsh-liquid-glass-diagnose.json
:109  "text": "新会话Ctrl+N插件工作区AI应用发动机标定知识库审计续做4小时AI应用多名专"
:330  "text": "新会话Ctrl+N插件工作区AI应用发动机标定知识库审计续做4小时AI应用多名专"
:351  "text": "新会话Ctrl+N插件工作区AI应用发动机标定知识库审计续做4小时AI应用多名专"
:502  "text": "优化Harness玻璃质感分层3 个子智能体智能体团队创造模式"
:522  "text": "优化Harness玻璃质感分层"
:542  "text": "思考The user needs the left sidebar and in"     ← 会话正文（思考块）
:602  "text": "The user needs the left sidebar and inpu"      ← 会话正文（summary）
```

**成因**：`test/diagnose.mjs:36` 的探针把每个候选元素的 `textContent` 截 40 字写进报告（`text: (el.textContent || '').trim().slice(0, 40)`），左侧栏会话列表、消息摘要都在候选集合里。

**更严重的连带产物**：`test/diagnose.mjs:247-250` 还会写出**整窗真实界面截图** `test/dsh-liquid-glass-shot-full.png` 与 `-shot-brand.png`（当前目录里没有，但只要重跑一次诊断就会生成）。

**影响**：这份 JSON/截图一旦 `git add .` 就会永久留在 GitHub 历史里 —— 会话标题 + 对话正文属于个人隐私，且无法通过 force-push 前的普通操作彻底清除（需要 rewrite history）。

**建议**：
1. `.gitignore` 已忽略 `test/dsh-liquid-glass-diagnose.*` 与 `test/dsh-liquid-glass-shot-*.png`（本次交付）。
2. **如果要给外部用户看一份样例报告**：另存一份**脱敏版**（把 `text` 字段全替换为 `"<redacted>"`、删掉 `boot.rowsSample` 的本机构建清单）到 `docs/sample-diagnose.json`，并在 README 注明「诊断报告含本机界面文本，请勿直接提交」。
3. 长期：给 `diagnose.mjs` 加 `--redact` 开关（默认对 `text` 只保留长度、不保留内容）。

### 1.4 ❌ P0-2：README 里的**真实 Windows 用户名**

**证据**

```
README.md:138   notepad %USERPROFILE%\.dsh\profiles\desktop\package.json
```

**影响**：公开仓库直接暴露本机账户名，且该行对任何其他用户都不可执行。

**建议**（README 由 Lead 改）：
```powershell
notepad "%USERPROFILE%\.dsh\profiles\desktop\package.json"
```
> 同一份 README 的 72 行已经用了 `%USERPROFILE%`，直接沿用这个写法即可。

### 1.5 ⏳ 待补：二进制 / 非 UTF-8 覆盖（结果以 Lead 回传为准）

| 检查项 | 目的 | 状态 |
|---|---|---|
| 16 张 PNG 的 `tEXt / iTXt / zTXt / Author / Software` 块 | 截图工具可能写入作者名、机器名、软件序列号 | ⏳ Lead 代查 |
| `test\诊断-双击运行.bat`（GBK）全文 | 已确认第 10 行 `set "EXE=D:\deepseek harness\DeepSeek Harness.exe"`（见 R-03） | ⏳ Lead 回传全文 |
| `test\dsh-liquid-glass-diagnose-meta.txt`（非 UTF-8） | 0.1 KB，疑似摘要 | ⏳ Lead 回传全文 |

> 注：ripgrep 实际**能**扫到 GBK 文件里的 ASCII 行（证据：`诊断-双击运行.bat:10` 被命中），所以「无凭据」结论对 .bat 仍然成立；但中文串可能被有损解码，故标注为弱覆盖。

### 1.6 ✅ 未命中清单（明确的"无"）

- 无 API Key / AccessKey / SecretKey / 私钥 / 证书
- 无 GitHub / Slack / Google / npm 令牌
- 无 `.env` / `.npmrc` / `credentials` 类文件
- 无邮箱、无手机号、无真实姓名（**除** §1.4 的用户名）
- 无内网 IP / 私有域名 / 内部服务地址
- 无 `localStorage` 中的隐私数据（见 §1.7）

### 1.7 localStorage 隐私评估（✅ 通过）

| 键 | 写入位置 | 内容 | 判定 |
|---|---|---|---|
| `dshlg.settings` | `client.js:2793` | 通透度/品牌宝石色/品牌文字/品牌底色/控制条让位等 6 个外观项 | 无隐私 |
| `dshlg.pos` | `client.js:3006` | 控制条与齿轮的 `{x,y}` 像素位置 | 无隐私 |
| `dshlg.entry` | `client.js:2126` | 上次选中的壁纸 **id**（如 `local:zen`、`ws-3803012159`） | 无隐私（**注意**：工坊 id 会暴露你订阅过哪张壁纸，属弱指纹，可接受） |
| `dshlg.controlsHidden` | `client.js:3233` | `'1'` | 无隐私 |

结论：**没有任何会话内容、路径、账号写入 localStorage**。

---

## 2. ② 体积分析

### 2.1 逐目录总览（Lead PowerShell 实测）

| 目录 / 文件 | 大小 | 占比 | 文件数 | 处置 |
|---|---:|---:|---:|---|
| `preview/` | **7.63 MB** | 62.2% | 10 PNG | 部分留、部分移出（§2.2） |
| `test/` | **4.18 MB** | 34.1% | 22 | 源码留、产物忽略（§2.2） |
| └ `test/shots/` | 3.98 MB | 32.5% | 6 PNG | **忽略**（`verify.mjs` 可重生） |
| └ `test/` 根文件 | 0.19 MB | 1.6% | 12 | 留（产物 3 个忽略） |
| └ `test/.tmp/` | 0.011 MB | 0.1% | 7 log | **忽略** |
| `lib/` | 0.198 MB | 1.6% | 1 | **留**（⚠️ 必须与根 `client.js` 同步） |
| 根目录 | ≈0.25 MB | 2.0% | 6 | 留 |
| `wallpapers/` | **0 MB** | 0% | 0 | 空目录，git 不跟踪（§2.4） |
| **合计** | **12.26 MB** | 100% | **60** | — |

### 2.2 逐文件分类表（留 / 忽略 / 改走 Release）

#### A. `preview/` —— 产品效果图（7.63 MB / 10 张）

| 文件 | 大小 | README 引用 | 处置 | 理由 |
|---|---:|:---:|---|---|
| `layered-glass-dark.png` | 0.37 MB | ✅ :7 | **留**，压到 ≤250 KB | 主效果图，README 首屏 |
| `layered-glass-light.png` | 0.92 MB | ✅ :9 | **留**，压到 ≤300 KB | 浅色主题证据 |
| `layered-glass-rightbar-closed.png` | 0.90 MB | ✅ :11 | **留**，压到 ≤300 KB | 右栏收起专项的视觉证据，对应 `collapse.test.mjs` |
| `left-sidebar-brand.png` | 0.06 MB | ✅ :13 | **留**（体积已合理） | 行级玻璃 + 蓝色品牌 |
| `zen-courtyard.png` | 1.35 MB | ❌ | **移出仓库** → Release 附件 / 删除 | 未引用 + 画面是第三方壁纸（版权） |
| `zen-no-white-blocks.png` | 1.38 MB | ❌ | **移出仓库** | 同上（且这是全仓最大文件） |
| `zen-sidebar-glass.png` | 1.31 MB | ❌ | **移出仓库** | 同上 |
| `layered-glass-wallpaper.png` | 0.92 MB | ❌ | **移出**，或补一句引用 + 压缩后留 | 有价值但当前无人引用 |
| `builtin-backdrop.png` | 0.34 MB | ❌ | **移出 / 删除** | 内置背景层，README 未提 |
| `final-v2.6.png` | 0.08 MB | ❌ | **删除** | 旧版终稿，版本号已过期（v2.6 vs 当前 2.5.2），语义误导 |

> **不建议"一刀切忽略 preview/"**：它是产品的一部分，README 有 4 处内联引用；忽略后 README 首屏全是裂图。正确做法是**保留引用的 4 张 + 压缩**，其余**移走**而不是"留在本地被忽略"（否则 `git status` 干净但资产失踪）。

#### B. `test/` —— 验证台（4.18 MB / 22 个）

| 文件/目录 | 大小 | 处置 | 理由 |
|---|---:|---|---|
| `verify.mjs` | 60.9 KB | **留** | 主验证台，仓库核心资产 |
| `harness.html` | 45.3 KB | **留** | 验证台页面 |
| `README.md` | 25.2 KB | **留** | 测试文档（讲清锚定法/判据/限制） |
| `collapse.test.mjs` | 22.8 KB | **留** | 右栏收起专项（真时钟） |
| `diagnose.mjs` | 12.2 KB | **留** | 升级适配的诊断脚本 |
| `settings.test.mjs` | 11.9 KB | **留** | 设置面板 16 项 |
| `baseline-expected.md` | 5.7 KB | **留** | 历史基线说明 |
| `check-install.mjs` | 3.5 KB | **留** | 安装状态自检（最省时间的那个） |
| `诊断-双击运行.bat` | 1.6 KB | **留**（保持 GBK + CRLF，**不要转 UTF-8**） | 双击入口，面向普通用户 |
| `dsh-liquid-glass-diagnose.json` | 15.1 KB | **忽略**（P0 隐私） | 见 §1.3 |
| `dsh-liquid-glass-diagnose.log` | 0.8 KB | **忽略** | 运行产物 |
| `dsh-liquid-glass-diagnose-meta.txt` | 0.1 KB | **忽略** | 运行产物 |
| `shots/*.png`（6 张） | **3.98 MB** | **忽略** | `verify.mjs` 每次运行重生；内容随主题/字体/DSH 版本漂移，不适合做二进制基线（文本基线在 `baseline-expected.md`）。想留则 `git add -f` |
| `.tmp/stderr-*.log`（7 个） | 0.011 MB | **忽略** | 纯运行噪声 |

#### C. 其它

| 文件/目录 | 大小 | 处置 | 理由 |
|---|---:|---|---|
| `client.js`（根） | 197.8 KB | **留** | DSH 要求客户端半体必须在**包根**且叫 `client.js` |
| `lib/client.js` | 197.8 KB | **留**（⚠️ 双副本同步风险 R-08） | 给「从 `lib/` 取客户端半体」的 DSH 构建准备 |
| `index.js` | ≈30 KB | **留** | 宿主半体（壁纸服务） |
| `styles.css` | ≈20 KB | **留** | 外置材质（真机取不到时有内联兜底） |
| `README.md` / `package.json` / `cordis.patch.yml` | ≈10 KB | **留** | — |
| `wallpapers/` | 0 MB（**空目录**） | git 不跟踪空目录 | 见 §2.4 |

### 2.3 `.gitignore` 逐条理由（本次创建的文件）

| 规则 | 为什么存在 | 会不会误伤 |
|---|---|---|
| `node_modules/` | clone 后各自安装；DSH profile 侧走 junction，不在仓库内 | ❌ 不误伤（仓库内无依赖源码） |
| `**/.tmp/`、`*.tmp` | `verify.mjs:836` 每次运行写 `test/.tmp/stderr-<场景>.log` | ❌ |
| `test/shots/` | `verify.mjs:837` 生成的 6 张场景截图（3.98 MB） | ❌ 生成物；要留基线可 `git add -f` |
| `test/dsh-liquid-glass-diagnose.{json,log}`、`-meta.txt` | 诊断脚本产物；**json 含真实会话标题/对话内容**（§1.3） | ❌ |
| `test/dsh-liquid-glass-shot-*.png` | `diagnose.mjs:247-250` 写的**整窗真实界面截图** | ❌ 防隐私事故的关键一条 |
| `/wallpapers/**` + `!/wallpapers/README.md` | Steam 工坊/WE 壁纸版权属原作者，禁止随仓库分发；本包 `wallpapers/` 只放说明 | ⚠️ 若将来要发布**自有版权**壁纸，删掉这两行或用 `git add -f`（已在文件里写明） |
| `*.log`、`npm-debug.log*`、`yarn-error.log*`、`pnpm-debug.log*` | 通用日志 | ❌ |
| `*.bak`、`*.orig`、`*.rej`、`*~` | 回滚/合并残留（README §五 的回滚就是 `Copy-Item` 覆盖，很会产生 `.bak`） | ❌ |
| `.vscode/`、`.idea/`、`*.swp`、`*.swo` | 编辑器本地配置 | ❌ |
| `.DS_Store`、`Thumbs.db`、`desktop.ini` | 跨平台 OS 噪声 | ❌ |
| `.edge-*/`、`edge-profile*/` | 测试脚本用 `--user-data-dir` 起 Edge；默认写在 `D:\dev-cache\temp`，一旦改成仓库内路径就能兜住 | ❌ |

**明确"不忽略"的**（防止过度忽略）：`client.js`、`lib/client.js`、`index.js`、`styles.css`、`package.json`、`cordis.patch.yml`、`README.md`、`LICENSE`、`test/*.mjs`、`test/*.md`、`test/harness.html`、`test/诊断-双击运行.bat`、`preview/*.png`（含引用的 4 张）。

### 2.4 `wallpapers/` 空目录处理

- git **不跟踪空目录** → 现在它既不会入库，也不影响功能（`index.js:28` 把它当"额外来源"，不存在就跳过；真正的 60 张来自 Steam 工坊 + WE 项目，**运行时扫描，不入库**）。
- 建议二选一：① 放一个 `wallpapers/README.md` 说明「把自有壁纸丢这里，会被画廊自动列出」（`.gitignore` 已为此留了白名单）；② 干脆不管它。

### 2.5 瘦身路径与预期体积

| 动作 | 减重 | 剩余 |
|---|---:|---:|
| 现状 | — | **12.26 MB** |
| 应用 `.gitignore`（shots + .tmp + 诊断产物） | −4.01 MB | **≈8.25 MB** |
| 移出 6 张未引用 preview（zen×3 + wallpaper + builtin-backdrop + final-v2.6） | −5.38 MB | **≈2.87 MB** |
| 再把保留的 4 张 preview 压到 ≤300 KB（pngquant / oxipng / WebP） | −1.6 MB | **≈1.3 MB** |

> GitHub 硬限制是单文件 100 MB / 仓库建议 <1 GB，所以 12.26 MB **不算违规**；这里纯粹是"clone 体验 + 明确仓库边界"的优化。**是否瘦身不阻断发布**，但 §1.3 的隐私项与 §4 的 P0/P1 **阻断发布**。

---

## 3. ③ 发布前检查清单（勾选表）

| # | 检查项 | 状态 | 证据 / 备注 |
|---|---|:---:|---|
| 1 | 全仓库无凭据（Key/Token/私钥/密码/邮箱/内网地址） | ✅ | §1.2，18 组关键字 0 命中 |
| 2 | 无真实用户名 / 可定位个人的路径 | ❌ | R-01（`README.md:138`） |
| 3 | 诊断产物（含会话标题/正文的 json + 整窗截图）不入库 | ⚠️ | `.gitignore` 已覆盖；**落盘后需 `git status` 复核一次** |
| 4 | 无 `.env` / `.npmrc` / 凭据文件 | ✅ | 全仓库不存在 |
| 5 | `LICENSE` 存在且版权行正确 | ✅ | 本次创建 MIT，`Copyright (c) 2026 pure-serendipity-five` |
| 6 | `.gitignore` 覆盖临时产物且不误伤源码 | ✅ | 本次创建，逐条理由见 §2.3 |
| 7 | `.gitattributes`（`.bat` 保持 CRLF；`*.png binary`） | ❌ **建议补** | 见 R-12 |
| 8 | README 讲清「这是什么」 | ✅ | 首段 + 五层规格 |
| 9 | README 讲清「怎么装」 | ⚠️ | 有 junction 说明，但路径写死本机（R-03/R-10） |
| 10 | README 讲清「怎么验证」 | ✅ | 第四节：诊断 .bat + 4 条命令 |
| 11 | README 讲清「怎么回滚」 | ⚠️ | 有，但依赖 `D:\dev-cache\temp` 本机备份（R-10） |
| 12 | README 讲清「**DSH 升级后怎么重新适配**」 | ❌ | 全文无此章节 → **草稿见 §5** |
| 13 | 包元数据（license/repository/keywords/author） | ❌ | R-04，建议值见 §6 |
| 14 | `files` 字段包含运行时必需文件 | ❌ | **漏 `cordis.patch.yml`**（`dsh.bundle.patch` 指向它） |
| 15 | 版本号单一事实源 | ❌ | R-07：2.5.2 / 1.9.2 / 1.9.2 / v2.2.2 四处不一致 |
| 16 | `node --check client.js` / `index.js` | ✅ | Lead 实测 exit=0 |
| 17 | 安装自检 | ✅ | `check-install.mjs` 12 项 PASS |
| 18 | 功能回归 | ✅ | `collapse.test.mjs` 全通过；`settings.test.mjs` 16/16 |
| 19 | 验证台自身可信（非空转） | ✅ | `verify.mjs --self-test`（Lead 已跑）；自检被判红的用例见 test/README |
| 20 | 单文件 < 100 MB、仓库 < 1 GB | ✅ | 最大 1.38 MB |
| 21 | `.bat` 保持 GBK + CRLF | ✅ | 文件已确认为非 UTF-8；**README 需提醒不要转码** |
| 22 | 壁纸素材版权（不入库第三方壁纸） | ✅ | `.gitignore` `/wallpapers/**`；素材在 Steam 工坊，运行时读取 |
| 23 | 截图里的第三方壁纸版权 | ⚠️ | `zen-*.png` 画面是工坊壁纸 → 建议**移出仓库**（正好与瘦身同向） |
| 24 | "非官方插件"声明（商标/归属） | ❌ 建议补 | 插件会替换 DSH 官方字标（`client.js:3915-3992`） |
| 25 | `lib/client.js` 与根 `client.js` 同步 | ⚠️ | R-08：197.8 KB × 2 副本，无自动校验 |
| 26 | CI（GitHub Actions 跑 `--self-test` + `node --check`） | ⚠️ 可选 | R-11 |
| 27 | 回滚方案对外可执行（不依赖本机备份） | ⚠️ | R-10 |
| 28 | `git init` + 首次提交前 `git status` 复核（确认 P0 产物未进索引） | ⏳ 待办 | 由 Lead 执行 |

---

## 4. ④ 问题 / 证据 / 影响 / 建议 / 严重度

| ID | 严重度 | 问题 | 证据 | 影响 | 建议 |
|---|---|---|---|---|---|
| **R-01** | **P0** | README 含真实 Windows 用户名 | `README.md:138` `notepad %USERPROFILE%\.dsh\profiles\desktop\package.json` | 公开暴露本机账户名；该行对他人不可执行 | 改 `"%USERPROFILE%\.dsh\profiles\desktop\package.json"`（README:72 已有正确写法） |
| **R-02** | **P0** | 诊断产物含**真实会话标题与对话内容** | `test/dsh-liquid-glass-diagnose.json:109,330,351,502,522,542,602`；生成逻辑 `test/diagnose.mjs:36,247-250` | 一旦提交即永久留在 git 历史，需 rewrite 才能清除 | `.gitignore` 已加 4 条；建议给 `diagnose.mjs` 加 `--redact`，并提供脱敏样例报告 |
| **R-03** | **P1** | 9 处硬编码本机绝对路径 → **外部用户跑不了测试** | 清单见 §7 | 别人 clone 后 `check-install` / `collapse` / `settings` / 诊断 .bat 全部失败；README 里的命令直接抄也会失败 | 改成「脚本相对定位 + 环境变量覆盖」（`verify.mjs:44-49` 已经是正确范式，照抄即可） |
| **R-04** | **P1** | `package.json` 元数据不适合公开发布，且 `files` 漏 `cordis.patch.yml` | `package.json:12-17`（`files` 只有 4 项）；缺 `license`/`repository`/`keywords` | npm 打包后 `dsh.bundle.patch → ./cordis.patch.yml` 指向不存在的文件；GitHub 上无 license 徽标/无仓库链接 | 按 §6 补全，`files` 加 `cordis.patch.yml` |
| **R-05** | **P1** | README 无「DSH 升级后重新适配」章节，也没有真实 DOM 钩子清单 | 全文 292 行无此节；钩子事实只散落在第 204-292 行 | **项目的核心诉求缺失**：DSH 一升级只能靠回忆重排 | 直接粘贴 §5 草稿 |
| **R-06** | **P1** | 「60 张壁纸库」表述误导 + 第三方壁纸版权 | README 首段/第八节；`index.js:39-59,78-85`（工坊 431960 / WE 项目，运行时扫描） | 读者以为仓库里有 60 张图（实际 0 张）；有人会顺手把工坊壁纸拷进 `wallpapers/` 提交 → 版权风险 | 改成「复用本机 Wallpaper Engine 工坊壁纸（运行时扫描，不入库）」；`preview/zen-*.png`（画面是工坊壁纸）移出仓库 |
| **R-07** | **P2** | 版本号四处不一致 | `package.json:3`=2.5.2；`client.js:35`=1.9.2；`lib/client.js:35`=1.9.2；`index.js:673`=1.9.2；`README.md:199`=v2.2.2 | 排查问题时对不上版本；`/__alive` 报告的版本是错的 | 以 `package.json` 为单一事实源，把 `VERSION`、`/__alive`、README 页脚统一到 2.5.2（或刻意 bump 3.0.0） |
| **R-08** | **P2** | `lib/client.js` 与根 `client.js` 是 197.8 KB × 2 的重复副本，无同步校验 | 两文件同内容（`client.js:1-4483`）；`package.json:15` 同时声明 | 改了根文件但真机加载 `lib/` 那份 → "改了没反应"（本项目踩过同类坑） | 加 `test/check-sync.mjs`（比字节/哈希，`check-install.mjs` 里已有比对范式 `:71-75`）；或构建时从根复制 |
| **R-09** | **P2** | 默认品牌文字是个人品牌 `Agent-枝星` | `client.js:207` `label: 'Agent-枝星'`（`lib/client.js:207` 同） | 别人装上看到的是你的品牌；README 把它当默认值描述 | 公开版默认值改中性（如 `DeepSeek Harness`），个人配置走 localStorage/`CONFIG` 覆盖 |
| **R-10** | **P2** | 回滚段依赖本机临时备份 | `README.md:126-135` `D:\dev-cache\temp\client-legacy-1.9.2.js`、`lg-host-verify\index.js.bak`；`README.md:271,278` `D:\dev-cache\temp\scanbt2.mjs` | 他人（和半年后的你）无法执行；`scanbt2.mjs` 根本不在仓库里 | 备份改到仓库外但说明来源（`git tag` + `git revert` 是更稳的回滚）；把反引号扫描脚本**收进 `test/`**（它是防坑资产） |
| **R-11** | **P2** | 无 CI | 无 `.github/` | 升级适配后无人自动回归 | 加最小 Actions：`node --check client.js index.js` + `node test/verify.mjs --self-test`（不依赖 DSH profile，可在 CI 跑）；`check-install.mjs` 依赖本机 profile，CI 跳过 |
| **R-12** | **P3** | 缺 `.gitattributes` | 无该文件；`test\诊断-双击运行.bat` 是 GBK + CRLF | `core.autocrlf` 或别人"顺手转 UTF-8"会让 .bat 中文乱码/解析失败 | 加：`* text=auto eol=lf` / `*.bat text eol=crlf` / `*.png binary` / `*.webm binary`；README 注明 .bat 必须 GBK |
| **R-13** | **P3** | README 首屏内联 2.25 MB PNG | `README.md:7,9,11,13` | 首屏加载慢（GitHub 渲染原图） | 按 §2.2 压缩到 ≤300 KB/张 |
| **R-14** | **P3** | 诊断报告含本机 DSH 构建清单（非隐私但无意义） | `test/dsh-liquid-glass-diagnose.json:6-47`（43 个插件 + `rev=` 哈希） | 泄露本机插件组合（弱指纹）；报告变长 | `--redact` 时一并裁掉 `boot.rowsSample` |
| **R-15** | **P3** | 无"非官方"声明 | `client.js:3915-3992` 会替换/隐藏 DSH 官方字标与鱼标 | 商标与归属上容易被误认为官方 | README 顶部加一句「非官方插件，与 DeepSeek 无隶属关系；默认品牌文字可在设置里改」 |

**如果只能改三件事**：R-01（用户名）、R-02（诊断产物入库风险）、R-03（路径可移植化）。

---

## 5. ⑤ README 补充章节草稿（可直接粘贴）

> **插入位置**：建议插在「五、回滚」之后，作为新的「六、DSH 升级后重新适配」，其后小节顺延为七/八/九…
> 下面内容自包含，可直接整段粘贴。

````markdown
## 六、DSH 升级后怎么重新适配

**本插件不依赖任何构建后哈希类名**（`LdtX1G_xxx` 这种永远不写进选择器），只依赖三类稳定信息：
**DSH 自己发布的 `data-*` 钩子** → **CSS Modules 类名的语义后缀** → **主题令牌 `--dsw-*`**，
三类都拿不到时才退到**几何兜底**。所以 DSH 升级后，问题几乎总是"这三类里某一类被改名了"，
跑一次诊断就能定位到具体是哪一类。

### 6.1 先判断"插件还活着吗"（30 秒）

```powershell
cd <插件目录>\test
node check-install.mjs
```

它会查三件事：profile 的 `dsh.profile.bundles` 里有没有本插件、`node_modules\@local\dsh-liquid-glass`
这个链接能不能解析、`exports["./client"]` 指向的文件在不在。**这一步不过，后面全白搭**（插件不在
bundle 列表时，DSH 不会报错、不会崩，样式就是完全不出现）。

自检全绿但界面没变化，就双击 `test\诊断-双击运行.bat`：
它会用 `--remote-debugging-port=9333` 启动 DSH、等界面加载完，再跑 `diagnose.mjs`，
把真实 DOM 上的事实写进 `test\dsh-liquid-glass-diagnose.json`（同时在控制台打一份人话摘要）。

摘要里逐行对照：

| 报告字段 | 期望 | 说明 |
|---|---|---|
| `plugin.scriptLoaded` | 非空 | 文件被送到了浏览器（加载器有没有取到 `/plugins/<id>/client.js`） |
| `plugin.factoryRuns` | ≥ 1 | factory 被调用了 |
| `plugin.applyDone` | `true` | apply 跑完了 |
| `plugin.critical` / `dynamic` / `svgFilter` / `mask` | `true` | 内联材质 / 动态样式 / 折射滤镜 / 边缘遮罩都挂上了 |
| `plugin.err` | `null` | 有值就是运行时报错（带栈）—— 静默失效的第一现场 |
| `boot.mentionsLiquidGlass` | `true` | 宿主把它登记进模块图了 |
| `hooks.logoRow` / `brandMark` / `sidebarRoot` / `sidebarCol` | 非空 | 左栏 / 品牌区钩子还认得出来 |
| `hooks.editor` / `composer` | 非空 | 输入栏钩子还认得出来 |
| `tagged[]` | 含 `…dshlg-side[region]` / `dshlg-brand[region]` / `dshlg-right[region]` | 玻璃面标记打上了 |

`scriptLoaded` / `factoryRuns` / `applyDone` 三行的**组合**能区分三种完全同表象（界面毫无变化）的故障：
文件没送到 / factory 没跑 / apply 没跑。

> ⚠️ `dsh-liquid-glass-diagnose.json` 会把真实界面文本（截 40 字）与整窗截图
> （`dsh-liquid-glass-shot-*.png`）写进 `test/`——**含会话标题与对话内容，已在 `.gitignore` 里，不要提交**。

### 6.2 真实 DOM 钩子清单（升级时逐行核对这张表）

**(A) DSH 自己发布的 `data-*` 钩子 —— 稳定度最高，坏了优先怪它改名**

| 用途 | 钩子 | 断了的表现 |
|---|---|---|
| 右栏面板 | `[data-sidebar-right-session]`、`[data-sidebar-right-panel]`、**仅展开时才有** `[data-sidebar-right-open]`、收起时 `aria-hidden="true"` | 判不出展开/收起 → 收起后仍留一条模糊空带，或整列不透明 |
| 右栏轨道 | `[data-rightbar-col]` | 收起态判定落空（回落到面板自身） |
| 右栏里的 dock 面板 | `[data-dockkit-host]`、`[data-dockkit-pane]`、`[data-dockkit-float]` | 面板 rect 不随展开变化 → 误判收起 |
| 审批卡 | `[data-approval-key]`（卡面再往里找 `[class*="_card"]`） | 审批卡没有玻璃，字直接压壁纸 |
| 输入框 | `[data-composer-input]`、`[data-phase]`、`[data-lexical-editor]`、`[contenteditable="true"]`、`textarea` | 找不到输入框 → 整条 composer 链路跳过 |
| 输入区座位 | `[data-composer-seat]`、`[data-conversation-region]` | 输入栏玻璃丢失 |
| 会话滚动区 | `[data-conversation-scroll]`、`[data-conversation-region]` | 中栏透明/文字可读性策略失效 |
| 菜单材质 | `[data-menu-material]` | 菜单没玻璃 |
| 暗色主题标志 | `body[data-ds-dark-theme]` | 亮/暗两套派生色错档 |
| 窗口拖拽区 | `[data-window-drag]` | 只影响诊断输出 |

**(B) CSS Modules 类名后缀 —— 最脆的一类（前缀是构建哈希，只有下划线后的语义后缀稳定）**

| 用途 | 选择器 | 断了的表现 |
|---|---|---|
| 应用外框 / 左栏根 | `#root` → `[class*="_frame"]`；左栏：`[class*="_logoRow"]` / `[class*="_panelList"]` / `[class*="_regionArea"]` → `closest('[class*="_root"]')` | 所有几何兜底的基准丢失；左栏整列玻璃消失 |
| 品牌区 | `[class*="_brandMark"]`、`[class*="_brandName"]`、`[class*="_brandIdentity"]`、`[class*="_brand"]`、`[class*="_localBuildTitle"]`、`[class*="_buildVersion"]` | 左上角蓝色品牌玻璃 / 宝石字失效（兜底：顶部"产品名候选"文本匹配） |
| 聊天框 / 工具栏 | `[class*="_editor"]`、`[class*="_composer"]`、`[class*="_composerSeat"]` | 输入栏玻璃丢失 |
| 弹窗 | `[role="dialog"]`、`[class*="_dialog"]` | 弹窗没玻璃 |
| 会话行 | `[class*="_row"]`、`[class*="_file"]` | 行级玻璃失效 |

**实测样本**（某次真实诊断里的类名，**只用于说明"前缀会变、后缀才是钩子"**）：
`ZTP-Xa_sidebarCol`、`n_2Q3W_logoRow`、`LdcXKW_panel`、`BuPN2G_input`、`D_tfqW_composerSeat`、
`p7JKGG_summary`、`_row_luwio_16`。
→ 前缀（`ZTP-Xa_`、`n_2Q3W_`、`LdcXKW_`）**每次构建都会变**，永远不要写进选择器。

**(C) 主题令牌 —— 材质颜色的来源**

`--dsw-alias-bg-layer-1` / `-bg-layer-2` / `-bg-overlay` / `-bg-base` / `-bg-mask-1`、
`--dsw-alias-label-primary`、`--dsw-specific-sidebar-fill`、`--dsw-mask-blur`、`--dsw-elevation-*`。
插件按这些令牌**派生**白纱与高光（不写死颜色）。令牌改名 → 玻璃发灰/发白（现在有主题探测 + 兜底 alpha，
所以表现为"颜色不对"而不是"完全没效果"）。

**(D) 插件加载契约 —— 坏了是完全静默的**

| 项 | 事实 |
|---|---|
| 加载器 API | `window.__ModuleLoader__.load({ id, factory })`（`client.js:28`） |
| 资源路径 | 固定 `/plugins/<id>/client.js` → **客户端半体必须在包根且叫 `client.js`**（放 `lib/` 不生效，`exports` 也不管用） |
| 插件 id | `@local/dsh-liquid-glass`（与 `package.json.name`、`cordis.patch.yml` 必须一致） |
| 清单 | `package.json` 的 `dsh.bundle.patch` 与 `dsh.client.{platform,immediately,inject}` |
| 诊断用 | `window.__DSH_BOOT__`（宿主模块图）、`window.__DSHLG_LOAD__` / `__DSHLG_FACTORY__` / `__DSHLG_ERR` |

### 6.3 最可能因 DSH 升级而失效的 7 个地方（按概率排序）

| # | 位置 | 为什么会断 | 断了的表现 | 怎么修 |
|---|---|---|---|---|
| 1 | `[class*="_xxx"]` 后缀（`client.js:756-760, 1032-1043, 3929-3984`） | CSS Modules 的 local name 改名 / 换构建工具 | 品牌区、左栏、输入栏玻璃消失（几何兜底能接管一部分） | 看诊断 `hooks` 四行 + `rowCandidates` / `topTextCandidates`，改后缀字符串 |
| 2 | 主题令牌名（`client.js:1254-1375`） | `--dsw-alias-*` / `--dsw-specific-*` 改名 | 玻璃发灰、白纱失效、颜色不对 | 对照诊断 `brandVars` 与计算样式；补新令牌名 |
| 3 | `data-sidebar-right-*`（`client.js:832-845`） | 右栏组件改钩子名 | 收起态判定错 → 模糊空带 / 该透明的不透明 | 几何兜底已在；或改钩子名 |
| 4 | 加载器契约（`client.js:28`、`/plugins/<id>/client.js`、`dsh.bundle.patch`） | 加载器 API / 清单字段变 | **完全静默**：不报错、不崩、样式全无 | 先 `check-install.mjs`，再诊断看 `scriptLoaded/factoryRuns/applyDone` |
| 5 | 业务钩子 `[data-approval-key]` / `[data-composer-seat]`（`client.js:1126, 2650`） | 审批 / 输入组件改名 | 审批卡、输入栏没玻璃 | 改钩子；或补 `[class*="_card"]` 之类的兜底 |
| 6 | 几何兜底阈值（`client.js:765-780, 798-819`） | 布局改宽/改窄/改分栏 | 连兜底也命不中（诊断里 `hooks` 全 null） | 调阈值常数（左栏 `≤ min(520, vw*0.45)`、右栏 `≥240` 且高 `≥75%vh`） |
| 7 | 层叠优先级（`CRITICAL_CSS` 里的 `!important`） | DSH 提高自家样式优先级 / 引入 CSS `@layer` | 诊断显示 `critical=true` 但计算样式没有 blur | 提高选择器特异性（`#root [data-dshlg-region]` 这一档已经这么做了） |

### 6.4 改完必跑（按这个顺序）

```powershell
cd <插件目录>\test

node check-install.mjs        # ① 安装状态（先查这个；不过就是白改）
node collapse.test.mjs        # ② 右栏收起/展开 + 左栏/品牌/输入栏（真时钟，结论可重复）
node settings.test.mjs        # ③ 设置面板（16 项：持久化、拖动、重置、恢复默认）
node verify.mjs --self-test   # ④ 验证台自身逻辑自检（不启浏览器，秒级）
node verify.mjs               # ⑤ 6 场景截图 + 计算样式断言（需要本机 Edge/Chrome）
```

| 命令 | 判据 |
|---|---|
| ①②③④ | 退出码必须为 0 |
| ⑤ | 有 FAIL 即非零退出（WARN 不判死） |
| 右栏收起/展开 | **以 `collapse.test.mjs` 为准** —— `verify.mjs` 跑在 `--virtual-time-budget` 虚拟时钟上，样式重算时序不稳（1500/3000ms 预算读到的是落地前的值） |
| 截图 | 落在 `test/shots/`（6 张），已被 `.gitignore` 忽略，可随时重生 |

### 6.5 升级适配失败要回滚

见「五、回滚」。**注意**：那里的备份路径是本机专用的，换机器请自备备份；
更稳的做法是 `git tag v<版本>` 后 `git checkout <tag> -- client.js styles.css index.js`。
回滚后**必须重启 DSH**（`Ctrl+R` 只重载界面，不会重新组合插件树）。

### 6.6 别人怎么在本机跑（可移植性）

- 需要 **Node ≥ 20** + 本机 **Edge 或 Chrome**（`verify.mjs:61-66` 按 4 个常见路径找，找不到退出码 2）。
- 指定插件目录：`DSHLG_PLUGIN_DIR=<插件目录> node test/verify.mjs`（`--plugin <目录>` 等价）。
- 只想看要访问哪个 URL：`node test/verify.mjs --url-only`。
- `check-install.mjs` / `collapse.test.mjs` / `settings.test.mjs` / `诊断-双击运行.bat` 目前**仍写死了
  本机路径**，非本机运行前需按仓库 issue/README 里的说明改成自己的路径（见本报告 §7 清单）。
````

---

## 6. ⑥ `package.json` 建议值

### 6.1 建议的完整字段（Lead 可直接套用）

```json
{
  "name": "@local/dsh-liquid-glass",
  "version": "2.5.2",
  "private": true,
  "type": "module",
  "description": "iOS 26 Liquid Glass theme for DeepSeek Harness (DSH): fully transparent workspace, frosted sidebars / approval / modal, built-in wallpaper gallery. DSH 客户端插件：液态玻璃材质 + 壁纸画廊 + 设置面板。",
  "license": "MIT",
  "author": "pure-serendipity-five",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/pure-serendipity-five/dsh-liquid-glass.git"
  },
  "homepage": "https://github.com/pure-serendipity-five/dsh-liquid-glass#readme",
  "bugs": {
    "url": "https://github.com/pure-serendipity-five/dsh-liquid-glass/issues"
  },
  "keywords": [
    "dsh", "deepseek-harness", "deepseek", "cordis", "cordis-plugin", "dsh-plugin",
    "liquid-glass", "glassmorphism", "ios26", "theme", "wallpaper",
    "wallpaper-engine", "client-plugin", "ui"
  ],
  "engines": { "node": ">=20" },
  "exports": { ".": "./index.js", "./client": "./client.js", "./styles.css": "./styles.css" },
  "files": [
    "index.js",
    "client.js",
    "lib/client.js",
    "styles.css",
    "cordis.patch.yml"
  ],
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "immediately": true, "inject": ["@deepseek-ai/dsh-client-ui-layout"] }
  }
}
```

> `README.md` / `LICENSE` / `package.json` 是 npm 的强制包含项，不必写进 `files`。
> **必须补的是 `cordis.patch.yml`**：`dsh.bundle.patch` 指向它，漏了就是"装上但插件不注册"。

### 6.2 逐字段取舍

| 字段 | 现状 | 建议 | 理由 |
|---|---|---|---|
| `name` | `@local/dsh-liquid-glass` | **保持不改**（首选） | 见 §6.3 |
| `version` | `2.5.2` | 保持 `2.5.2`，打 tag `v2.5.2`；或首次公开用 `3.0.0` | 连续性优先；关键是把 `client.js:35`、`lib/client.js:35`、`index.js:673`、README 页脚统一（R-07） |
| `description` | 中文长句 | **中英双语**（见上） | GitHub 搜索与 npm 以英文为主；中文保留可读性 |
| `license` | **缺失** | `"MIT"` | 与新增的 `LICENSE` 对应；GitHub 才会显示 license 徽标 |
| `author` | 缺失 | `"pure-serendipity-five"` | 与 LICENSE 版权行一致 |
| `repository` / `homepage` / `bugs` | **缺失** | 见上 | 公开仓库的基本项（README 徽标、"View on GitHub"） |
| `keywords` | 缺失 | 见上 | 决定被搜到的概率；`dsh` / `deepseek-harness` / `liquid-glass` 是主词 |
| `engines` | 缺失 | `{"node": ">=20"}` | `verify.mjs` 用了 `import.meta.dirname`（Node 20.11+） |
| `private` | `true` | **保持 `true`** | 我们发布的是 GitHub 仓库而非 npm 包；`private` 能挡住误 `npm publish`（尤其是 `@local` 这个不属于你的 scope） |
| `files` | 4 项，**漏 patch** | 加 `cordis.patch.yml` | 见上 |

### 6.3 `name` 保持 `@local/...` 还是改公开名？—— 取舍

**保持 `@local/dsh-liquid-glass`（推荐）**

- 这个字符串是**运行时 id**，不只写在 `package.json` 里，改名的联动面是 **6 处**：

| # | 位置 | 内容 |
|---|---|---|
| 1 | `package.json:2` | `name` |
| 2 | `cordis.patch.yml:8` | `name: '@local/dsh-liquid-glass'` |
| 3 | `client.js:29`（及 `lib/client.js:29`） | `__ModuleLoader__.load({ id: '@local/dsh-liquid-glass' })` |
| 4 | profile 的 `%USERPROFILE%\.dsh\profiles\desktop\package.json` | `dependencies` + `dsh.profile.bundles` 两处 |
| 5 | `test/check-install.mjs:14` | `const PKG_NAME = '@local/dsh-liquid-glass'` |
| 6 | profile 里的 junction 目录名 | `node_modules\@local\dsh-liquid-glass`（要重挂） |

- 其中 4、6 在**仓库之外**（用户 profile），改名后老用户会"插件消失且不报错"。
- `@local/` 在 DSH 生态里是"本地私有插件"的约定命名，公开仓库里看到它并不影响使用。
- 只要 `private: true`，就不会有人误发到 npm。

**改成公开名（仅在以下情况才值得）**

- 你打算 `npm publish` 让别人 `npm i dsh-liquid-glass`；或想让它看起来像正式生态插件。
- 那就用**无 scope 名** `dsh-liquid-glass`（先在 npm 查名是否被占），或 `@pure-serendipity-five/dsh-liquid-glass`。
- **千万不要** `npm publish` 成 `@local/...`：`@local` 不是你的 npm scope，必然失败。
- 改名清单 = 上表 6 处一次性全改 + bump 到 `3.0.0` + 在 README 写迁移说明。

---

## 7. 需要 Lead 统一修改的文件清单（含精确行号）

> 全部为**只读审查得出的结论**，我不动这些文件（写范围仅 `.gitignore` / `LICENSE` / `review/03-release.md`）。

| # | 文件:行 | 现状 | 建议改法 | 优先级 |
|---|---|---|---|---|
| 1 | `README.md:138` | `notepad %USERPROFILE%\.dsh\profiles\desktop\package.json` | `notepad "%USERPROFILE%\.dsh\profiles\desktop\package.json"` | **P0** |
| 2 | `test/dsh-liquid-glass-diagnose.json`（全文件，615 行） | 含真实会话标题/对话内容 | **不要提交**（`.gitignore` 已挡）；如需样例另做脱敏版 | **P0** |
| 3 | `test/check-install.mjs:15` | `const PLUGIN = 'D:/AI应用/dsh-liquid-glass';` | `const PLUGIN = process.env.DSHLG_PLUGIN_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), '..');`（照抄 `verify.mjs:44-49` 范式） | **P1** |
| 4 | `test/collapse.test.mjs:14-15` | `CLIENT_PATH` / `CSS_PATH` 写死 `D:/AI应用/...` | 同上（相对 `import.meta.dirname` + 环境变量覆盖） | **P1** |
| 5 | `test/collapse.test.mjs:102` | `--user-data-dir=D:/dev-cache/temp/edge-collapse-…` | `join(os.tmpdir(), 'dshlg-edge-collapse-' + …)` | **P1** |
| 6 | `test/settings.test.mjs:42` | `--user-data-dir=D:/dev-cache/temp/edge-settings-…` | 同上 `os.tmpdir()` | **P1** |
| 7 | `test/诊断-双击运行.bat:10` | `set "EXE=D:\deepseek harness\DeepSeek Harness.exe"` | 改成 `if not defined DSH_EXE set "DSH_EXE=..."`，并在未设置且默认路径不存在时打印提示后 `exit /b 2`；**保持 GBK + CRLF** | **P1** |
| 8 | `test/diagnose.mjs:190` | 提示串里写死 `"D:\deepseek harness\DeepSeek Harness.exe" --remote-debugging-port=9333` | 改成 `"<DSH 安装目录>\DeepSeek Harness.exe" --remote-debugging-port=9333` | **P1** |
| 9 | `test/verify.mjs:6` | 注释 `cd D:\AI应用\dsh-liquid-glass\test` | 改成 `cd <插件目录>\test` | P2 |
| 10 | `test/README.md:16` | `cd D:\AI应用\dsh-liquid-glass\test` | 同上 | P2 |
| 11 | `test/baseline-expected.md:78` | 「必须指向真实的 `D:\AI应用\dsh-liquid-glass\client.js`」 | 改成「必须指向本插件的 `client.js`」 | P2 |
| 12 | `README.md:72-74, 98, 245, 276-278` | 写死 `D:\AI应用\dsh-liquid-glass` | 用 `<插件目录>` 占位，或保留一处示例并注明"按你的实际路径替换" | P2 |
| 13 | `README.md:126-135`（回滚段） | 依赖 `D:\dev-cache\temp\…` 本机备份 | 改成 `git tag` + `git checkout <tag> -- <file>` 的通用回滚；本机备份路径只在脚注保留 | P2 |
| 14 | `README.md:271, 278` | 引用仓库外脚本 `D:\dev-cache\temp\scanbt2.mjs` | 把该脚本收进 `test/scan-backticks.mjs` 并改引用（它是防坑资产） | P2 |
| 15 | `README.md:192` + 首段 | 「60 张壁纸库」 | 改成「复用本机 Wallpaper Engine 工坊壁纸（运行时扫描，不入库）」 | **P1** |
| 16 | `package.json` | 见 §6.1 | 按建议值补 `license`/`repository`/`keywords`/`author`/`engines`，`files` 加 `cordis.patch.yml` | **P1** |
| 17 | `README.md` 新增章节 | 无升级适配章节 | 粘贴 §5 草稿 | **P1** |
| 18 | `client.js:35`、`lib/client.js:35`、`index.js:673`、`README.md:199` | 版本号 1.9.2 / 1.9.2 / 1.9.2 / v2.2.2 vs `package.json` 2.5.2 | 统一到 `package.json` 的版本 | P2 |
| 19 | `client.js:207`、`lib/client.js:207` | `label: 'Agent-枝星'` | 公开版默认改中性（如 `DeepSeek Harness`） | P2 |
| 20 | 新增 `.gitattributes` | 无 | `* text=auto eol=lf` / `*.bat text eol=crlf` / `*.png binary` / `*.webm binary` | P2 |
| 21 | 新增 `.github/workflows/verify.yml` | 无 | `node --check client.js index.js`、`node test/verify.mjs --self-test` | P2 |
| 22 | `README.md` 顶部 | 无归属声明 | 加一句「非官方插件，与 DeepSeek 无隶属关系」 | P3 |

---

## 7b. 附：三份"可直接粘贴"的补充文件（对应 R-12 / R-11 / R-08）

### A. `.gitattributes`（R-12，防 `.bat` 被转码 / 图片被当文本 diff）

```gitattributes
# 默认按文本处理并用 LF 检出（仓库内统一 LF）
* text=auto eol=lf

# cmd.exe 的批处理必须是 CRLF；这个文件还是 GBK 编码，别"顺手转 UTF-8"
*.bat text eol=crlf

# 二进制，禁止行尾转换与文本 diff
*.png binary
*.jpg binary
*.webp binary
*.gif binary
*.webm binary
*.mp4 binary
*.mp3 binary
```

### B. `.github/workflows/verify.yml`（R-11，最小 CI，不依赖本机 DSH profile）

```yaml
name: verify

on:
  push:
    branches: [main]
  pull_request:

jobs:
  self-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: 语法检查
        run: |
          node --check client.js
          node --check index.js
          node --check lib/client.js
      - name: 验证台自身逻辑自检（不启浏览器）
        run: node test/verify.mjs --self-test
      - name: lib/client.js 与根 client.js 必须一致
        run: node test/check-sync.mjs
      # 说明：check-install.mjs / collapse.test.mjs / settings.test.mjs 依赖
      # 本机 DSH profile 与 Edge/Chrome，CI 上不跑；诊断 .bat 是 Windows 专用。
```

### C. `test/check-sync.mjs`（R-08，双副本同步校验；参照 `check-install.mjs:71-75` 的范式）

```js
/* 根 client.js 与 lib/client.js 必须字节一致 ——
 * 有的 DSH 构建从 lib/ 取客户端半体，两边漂移就会出现"改了根文件但真机没变"。
 * 用法：node test/check-sync.mjs   （退出码 0 = 一致）
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const pairs = [['client.js', 'lib/client.js']];
let bad = 0;
for (const [a, b] of pairs) {
  const x = readFileSync(join(ROOT, a));
  const y = readFileSync(join(ROOT, b));
  const same = x.equals(y);
  console.log((same ? '  PASS  ' : '  FAIL  ') + a + ' ↔ ' + b + '　' + x.length + ' vs ' + y.length + ' 字节');
  if (!same) bad += 1;
}
console.log(bad ? '\n✗ 副本已漂移：把根 client.js 复制到 lib/ 后再提交' : '\n✓ 双副本一致');
process.exit(bad ? 1 : 0);
```

---

## 8. 本次未能验证的项（诚实声明）

| 项 | 原因 | 谁来补 |
|---|---|---|
| PNG 内嵌元数据（作者/软件/机器名） | 需要读二进制，我的 shell 不可用 | Lead 代查（§1.5） |
| `诊断-双击运行.bat` / `-meta.txt` 全文 | 均为非 UTF-8（GBK），`read` 工具拒绝解码 | Lead 回传原文 |
| `git init` 后的实际索引内容（`git status` / `git check-ignore`） | 仓库尚未 init | Lead 落盘 `.gitignore` 后跑一次 `git status --porcelain` 复核，确认 P0 产物不在列表里 |
| `preview/*.png` 的实际画面内容（是否含个人会话内容） | 需要看图 | Lead 目视确认（尤其 `zen-*` 是否含桌面/个人信息） |
| 体积统计的逐文件复算 | 我的 shell 不可用 | 已用 Lead 实测值，未二次复算 |

---

*报告完毕。三个交付物：`.gitignore`、`LICENSE`、`review/03-release.md`。*
