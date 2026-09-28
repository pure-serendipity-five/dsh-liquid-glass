# market/ · 插件清单（控制中心「插件」页的数据源）

控制中心的「插件」页（分页 3）会拉**两份**清单并合并去重：

| 来源 | URL | 谁维护 |
|---|---|---|
| 社区公开清单 | `https://awesome-dsh-plugin.com/plugins.json` | 社区（`github.com/awesome-dsh-plugin/awesome-dsh-plugin`），约 4000+ 个插件，持续更新 |
| **本文件**（补充清单） | `https://raw.githubusercontent.com/pure-serendipity-five/dsh-liquid-glass-studio/main/market/index.json` | 你自己 |

两个 URL 都写在 `client.js` 的 `MARKET_URLS` 里 —— 想加第三个来源，往那个数组再加一行即可。

> **为什么不用自己维护整份清单**：社区那份有 4000+ 条、23 个分类、带中英文说明、star / 下载量、
> 权限能力与红线警告，还在持续更新。自己维护一份只会过期。
> 本文件只用来放社区清单里**没有**的东西（自研插件、私藏插件、内网包）。

---

## 怎么加一条自己的插件

编辑 `index.json` 的 `plugins` 数组，照抄社区清单的字段形状：

```json
{
  "name": "我的插件",
  "owner": "pure-serendipity-five",
  "url": "https://github.com/pure-serendipity-five/my-plugin",
  "page": "",
  "category": "ui",
  "description": { "zh": "一句话说明它干什么。", "en": "One line description." },
  "npm": "@pure-serendipity-five/my-plugin",
  "version": "0.1.0",
  "stars": 0,
  "downloads": null,
  "capabilities": ["fs-read"],
  "capabilityRedLines": [],
  "install": "dsh plugin --profile desktop add @pure-serendipity-five/my-plugin",
  "added": "2026-09-27"
}
```

字段说明（**只有 `name` 是必需的**，其余缺了就不显示）：

| 字段 | 用途 |
|---|---|
| `name` | 插件名（必填） |
| `owner` | 作者 / 组织，界面上放在名字后面 |
| `url` | 仓库地址 → 行里的「仓库」按钮 |
| `page` | 详情页地址（没有就留空） → 「详情」按钮 |
| `category` | 分类 id；要显示中文名，就在顶层 `categories` 里加一条 `"ui": { "zh": "UI 增强" }` |
| `description.zh` / `.en` | 说明，界面优先显示中文 |
| `npm` | npm 包名 |
| `version` / `stars` / `downloads` / `added` | 版本、星标、下载量、收录日期（用于排序） |
| `capabilities` | 权限能力标签，如 `fs-write` `network` `shell` `credentials` `llm` |
| `capabilityRedLines` | **权限红线**，界面上会标红（例：`reads credentials/secrets AND has network access`） |
| `install` | 完整安装命令。界面只取 `add` 后面那一段当「安装标识」 |

---

## 改完怎么生效

1. 把 `index.json` 推到 GitHub 的 `main` 分支（raw 地址带 `access-control-allow-origin: *`，页面能直接拉）。
2. 打开控制中心 → 「插件」页 → 点 **刷新清单**。
3. 清单在本机缓存 24 小时；不刷新的话明天才会自动更新。

---

## 重要：这一页**不替你装插件**

「安装」按钮只做两件事：**把安装标识复制到剪贴板** + **打开 DSH 官方插件管理器**。
真正的安装由 DSH 官方插件管理器执行 —— 它在 profile 里跑 pnpm，并且会做
**供应链校验 + 授权确认 + 风险提示**。

为什么不做成一键安装：

- 自己跑 pnpm = 重复实现一条安全关键路径，还绕开了官方那三道校验；
- 装错了会让 profile 起不来（DSH 直接打不开），代价太大；
- DSH 没有对外暴露「调起插件管理器并预填」的接口（查过 `app.asar`），
  所以本页只能把标识送到你手上。

**装完要完全退出 DSH（托盘图标右键 → 退出）再启动才生效** —— 关窗口不算退出。
