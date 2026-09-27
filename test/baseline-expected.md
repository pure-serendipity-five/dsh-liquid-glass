# 历史基线：v1.8.2 的**预测**（已被 v1.9.0 实测取代）

> ## ⚠️ 这份文件现在只是**历史对照**，不是当前期望值
>
> | 事实 | 值 | 来源 |
> |---|---|---|
> | 插件 v1.8.2 | 预测 **FAIL ≈ 21 条**（见下面的表） | 只读推断，**从未实测** |
> | 插件 **v1.9.0** | **实测 0 条断言不通过**：`dark` / `light` / `wallpaper` / `modal` 四场景全绿 | Lead 用 `node verify.mjs` 实跑（v1.9.0 = 「分层玻璃」那一版） |
> | `approval`（第 5 场景） | **尚无实测记录** —— 它是本轮验证台才新增的 | 本轮新增，等跑 |
>
> 也就是说：**下面那张「预期 FAIL」表放在今天会误导人**。
> 它是 v1.8.2 时代的产物，v1.9.0 重写玻璃方案后逐条都不成立了。
> 保留它只是为了留个对照：**当时推断对了、后来是怎么修掉的**。
>
> 现在的判据以 `verify.mjs --self-test` + `node verify.mjs` 的**实测输出**为准，
> 不以本文为准。文件名保留 `baseline-expected.md` 是为了不改历史引用。

---

## 一、v1.8.2 的推断依据（逐条可核对，均为**当时**的代码事实）

| 结论 | 依据（v1.8.2 的 `client.js`） |
|---|---|
| 左栏拿不到毛玻璃 | `CONFIG.sidebar: false`；`discover()` 里 `if (CONFIG.sidebar)` 整段不执行 → `found.sidebar` 永远是 `null` → 不会打 `dshlg-sidebar` |
| 顶栏同理 | `CONFIG.topbar: false` |
| 右栏**根本没有探测逻辑** | 全文件搜不到右栏的判据（只有左栏 `findLeftColumn()` 和顶栏结构判据）→ 右栏不会被打任何标记 |
| 三处的底色会被清掉 | `CONFIG.clearAllBackgrounds: true` → 注入 `#root, #root *:not([data-dshlg-keep]) { background-color: transparent !important }` |
| 审批卡片会变成全透明 | 它的底色来自 `ApprovalPanel.module.css` 的 `background: var(--dsw-specific-input-major)`，而插件把 `--dsw-specific-input-major` **没动**、但 `clearAllBackgrounds` 把该元素的 `background-color` 直接清成 `transparent` |
| 弹窗同理会变成全透明 | dialog 的底色来自 `var(--dsw-alias-bg-layer-2)`，插件把该令牌按 `panelAlpha` 算成 `transparent`（`panelAlpha: 0` → `tokenValue()` 直接返回 `'transparent'`），且 `clearAllBackgrounds` 再清一遍 |
| 输入卡片是通过的 | `discover()` 的 composer 判据（向上找「圆角 ≥ 4px + ≥2 个按钮」）在验证台的 DOM 上命中 `.mock-composer`，打上 `dshlg-glass` → 有 tint + refract blur |

---

## 二、v1.8.2 预测表（**历史对照，已全部不成立**）

> 下表最后一列的「v1.9.0 实测」是**从实测结论反推**的：
> Lead 用 `node verify.mjs` 实测四场景 **0 条断言不通过**，所以原先预测 FAIL 的那几行
> 都不再是 FAIL。至于每行的**具体计算值**，以实跑输出为准，本文不复制那些数字。

### 场景 dark / light / wallpaper（三张表的判定结果应当一致）

| 区域 | v1.8.2 预测 | 预测关键值 | v1.9.0 实测 |
|---|---|---|---|
| 插件加载 | PASS | `applied = @local/dsh-liquid-glass` | PASS |
| 插件样式表 | PASS | `#dshlg-style` 在；打标记：`dshlg-glass→composer-card`、`dshlg-toolbar→composer-btnrow` | PASS（打标记更多，见实测输出） |
| 中栏/工作区 | **PASS** | `bg=rgba(0,0,0,0) alpha=0 blur=none gradient=false` | PASS |
| 左侧会话工作区 | **FAIL** | `alpha=0 blur=none gradient=false` —— 没 blur、没底色 | **PASS**（v1.9.0 分层玻璃：tint + backdrop blur） |
| 右侧面板（打开态） | **FAIL** | 同上 | **PASS**（新增右栏探测 + 面板本体就地套玻璃） |
| 聊天输入卡片 | PASS | `gradient=true blur=blur(7px) saturate(1.7) url(#dshlg-refract)` | PASS |
| 审批卡片 | **FAIL** | `bg=rgba(0,0,0,0) alpha=0 blur=none` | **PASS**（卡面被标成 `data-dshlg-region="approval"`） |
| 左栏按钮可读性 | **FAIL** | 9/9 个按钮（6 个会话 + 设置/新建会话/帮助）「全透明 + 无 blur + 无渐变」 | PASS（判据也改了：父级有玻璃面就不算 bad） |
| 右栏按钮可读性 | **FAIL** | 4/4 个按钮（↻ ⋯ 在编辑器中打开 复制路径）同上 | PASS |
| 右栏文件行可读性 | **FAIL** | 5/5 个文件行同上 | PASS |
| 输入框底色（参考） | 报告 | `alpha=0 blur=none`（输入框自己被清成透明；玻璃在外面那层卡片上） | 报告（不判死） |
| 中栏气泡（参考） | 报告 | 8/8 个气泡完全透明（工作区要求全透明，属预期） | 报告（不判死） |
| 插件注入元素 | INFO | `pluginBackdrop=有 pluginWall=无 pluginControls=无 pluginBanner=无` | INFO |

### 场景 modal

| 区域 | v1.8.2 预测 | 预测关键值 | v1.9.0 实测 |
|---|---|---|---|
| 弹窗 dialog | **FAIL** | `bg=rgba(0,0,0,0) alpha=0 blur=none`（`--dsw-mask-blur` 本身是 `none`，遮罩那层也不会有 blur） | **PASS**（dialog 自己那一档有 tint + blur；遮罩仍然没 blur，属预期） |

**v1.8.2 预测不通过条数：每场景 5 条（三张非 modal）+ 6 条（modal）≈ 21 条。**
**v1.9.0 实测：0 条。**

---

## 三、怎么判断「验证台自己坏了」而不是「插件有问题」

跑 `node verify.mjs --self-test`：

- 自检全绿 → 解析与判定逻辑可信，实测的 FAIL 就是插件的问题
- 自检有红 → 先修 `verify.mjs`，别急着改插件

另外看实测输出里这两行：

- `实际加载的插件源` —— 必须指向真实的 `<插件目录>\client.js`
- `插件加载 / 插件样式表` —— 若这两条就 FAIL，说明是**环境**没接上
  （脚本没加载 / 验证台放错目录），不是插件没做效果

> 本文的「v1.9.0 实测」一列由 Lead 实跑后回填；`approval` 场景那一行等第 5 张截图跑出来再补。
