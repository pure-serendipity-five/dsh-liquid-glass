/**
 * dsh-liquid-glass · Client 半体
 *
 * 分层玻璃（v1.9.2）：**中间工作区全透明，两侧栏与浮层磨砂玻璃**。
 *
 * 三个关键设计：
 *   1. 折射用 SVG 滤镜（feTurbulence + feDisplacementMap），背景会真的弯折，
 *      而不是单纯糊掉 —— 这是液态玻璃和普通毛玻璃的区别。
 *   2. 目标元素靠**运行时 DOM 探测**定位：能拿到的稳定钩子（DSH 自己的
 *      data-* 属性、AppFrame 的列类名、UI 包里的模块类名）优先，
 *      拿不到就用**几何特征**兜底。哈希类名（`LdtX1G_xxx`）永远不当选择器。
 *   3. 面板颜色全部**从当前主题令牌派生**，浅色/深色主题都不会压掉文字对比度。
 *
 * 为什么中间全透明、两侧要磨砂：
 *   全透明（v1.8 的老行为）会让侧栏文字直接压在壁纸上，两块字叠在一起看不清。
 *   所以中间工作区保持全透明（壁纸完整透出来，也是视觉焦点），
 *   左栏 / 右栏 / 审批卡 / 弹窗各给一档**模糊 + 淡色玻璃**，文字才压得住。
 */

/* 模块加载器一碰这个文件就留痕（先于 factory 执行）。
   用来区分「文件没被送到浏览器」和「factory 没被调用」——
   这两种情况的表象完全一样（界面毫无变化），只能靠留痕分辨。 */
try {
  if (!window.__DSHLG_LOAD__) window.__DSHLG_LOAD__ = [];
  window.__DSHLG_LOAD__.push({ at: Date.now(), href: location.href, hasLoader: !!window.__ModuleLoader__ });
} catch { /* 忽略 */ }

window.__ModuleLoader__.load({
  id: '@local/dsh-liquid-glass',
  factory() {
    try { window.__DSHLG_FACTORY__ = (window.__DSHLG_FACTORY__ || 0) + 1; } catch { /* 忽略 */ }
    /* 加载期最外层兜底：factory 里任何未捕获异常都不能冒泡出去，
       否则 DSH 会判「entry 未激活」并影响同一次 boot 的其他插件。 */
    try {
    const VERSION = '1.9.2';
    const STYLE_ID = 'dshlg-critical';   // 内联兜底材质
    const STYLE_ID_DYN = 'dshlg-style';  // 运行时动态部分（令牌/几何相关）
    const STYLE_LINK_ID = 'dshlg-stylesheet';
    const SVG_ID = 'dshlg-svg';
    const FILTER_REF = 'dshlg-refract';
    const BG_ID = 'dshlg-backdrop';
    const WALL_ID = 'dshlg-wall';
    const CTRL_ID = 'dshlg-controls';
    const GALLERY_ID = 'dshlg-gallery';
    const RESTORE_ID = 'dshlg-restore';   // 控制条收起后的「找回」入口
    const SETTINGS_ID = 'dshlg-settings';   // 设置面板
    const GEAR_ID = 'dshlg-gear';           // 打开设置面板的齿轮按钮
    const SETTINGS_KEY = 'dshlg.settings';  // 本地持久化键名

    /**
     * 请求重画一遍的**模块级**入口。
     *
     * 为什么需要它：pass() 是 applyGlass 内部的局部函数，而设置面板/拖动这些
     * 代码位于模块级作用域 —— 直接调用 pass() 会抛 ReferenceError
     * （实测：点壁纸卡片报「pass is not defined」，设置改完也不重绘）。
     * 这里放一个回调，由 applyGlass 在 pass 定义好之后赋值给它。
     */
    let requestPass = () => { /* applyGlass 启动后会被替换 */ };
    const SAPPHIRE_ID = 'dshlg-sapphire-defs';   // 深蓝宝石渐变定义容器
    const FADE_TOP_ID = 'dshlg-fade-top';        // 页面顶部渐隐带
    const FADE_BOTTOM_ID = 'dshlg-fade-bottom';  // 页面底部渐隐带
    const BANNER_ID = 'dshlg-banner';
    const CLS_GLASS = 'dshlg-glass';
    const CLS_TOOLBAR = 'dshlg-toolbar';
    const CLS_SIDE = 'dshlg-side';
    const CLS_RIGHT = 'dshlg-right';
    const CLS_APPROVAL = 'dshlg-approval';
    const CLS_MODAL = 'dshlg-modal';
    const CLS_BAR = 'dshlg-bar';       // 左栏会话行（和右栏同款玻璃）
    const CLS_BRAND = 'dshlg-brand';   // 左上角品牌区（蓝色液态玻璃）

    /* ══════════════════════════════════════════════════════════════
     * 控制中心（M0 外壳 + M1 工作区管理）
     *
     * 为什么整块放在**模块级**而不是塞进 applyGlass()：
     *   · applyGlass 已经是 700+ 行的单个函数，再塞进去没法维护；
     *   · 模块级函数**不能**引用 applyGlass 内部的局部量（如 pass）——
     *     本项目踩过「点了必抛 ReferenceError」的坑，所以这里只走
     *     已经存在的模块级挂钩 requestPass()。
     *   · 不引入任何新的色调变量：材质全部复用已有的 --dshlg-bar-tone
     *     与 --dshlg-panel-veil / --dshlg-panel-ink（和设置面板同一套）。
     *   · 面板本体**不做 backdrop-filter**（全屏/容器上的 backdrop 会闪，
     *     而且会变成 fixed 后代的包含块）——玻璃感由描边 + 顶光给出，
     *     与控制条 / 设置面板完全一致。
     * ══════════════════════════════════════════════════════════════ */
    const CC_ID = 'dshlg-cc';                   // 面板本体
    const CC_BACKDROP_ID = 'dshlg-cc-backdrop'; // 面板外部的点击兜底面
    const CC_POS_KEY = 'cc';                    // 位置记忆键（与 'bar' / 'gear' 同一套）
    const CC_API = '/dshlg-control';
    const CC_TABS = [
      { id: 'workspaces', label: '工作区' },
      { id: 'sessions', label: '会话' },
      { id: 'plugins', label: '插件' },
      { id: 'system', label: '系统' },
    ];

    /* 面板状态集中在一个对象里：散落的模块级 let 最容易出现
       「只插了调用没插定义」，集中一处一眼能看全，也不容易撞名。 */
    const ccState = {
      tab: 'workspaces',
      lastFocus: null,
      workspaces: null,       // null = 还没拉到
      workspacesError: null,
      sessions: null,
      sessionsError: null,
      health: null,
      sortAsc: true,
      showArchived: false,
      wizard: null,           // { step:'path'|'name', path, name, error }
      confirm: null,          // { kind, id, name, sessions } 危险动作二次确认
      renamingId: null,
      busy: false,
      notice: null,           // 人话提示（成功 / 失败都走它）
      renderError: null,      // 错误边界：分页渲染抛异常时记这里
    };

    /* 健康状态的短缓存：避免每次切分页都打一次宿主 */
    const ccCache = { health: null, healthAt: 0, healthTried: 0 };

    /* ── 小工具（全部定义在使用点之前）──────────────────────────── */

    /** 转义后放进 innerHTML。 */
    function ccEsc(value) {
      return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    /**
     * 错误人话化：宿主返回 { ok:false, error:{ code, message } }。
     * 认不出的 code 就把原文附上 —— 绝不显示「操作失败」这种没信息量的话。
     */
    function ccHumanError(error) {
      const code = String((error && error.code) || '').toLowerCase();
      const raw = String((error && error.message) || error || '').trim();
      const map = {
        name_taken: '这个名字已经被别的空间用了，换一个。',
        duplicate: '这个名字已经被别的空间用了，换一个。',
        exists: '这个名字或目录已经存在了。',
        invalid_name: '名字不合法：不能为空，也不能包含 \\ / : * ? " < > | 这些字符。',
        bad_name: '名字不合法：不能为空，也不能包含 \\ / : * ? " < > | 这些字符。',
        not_found: '找不到这个空间，可能已经被改名或归档了。刷新一下列表。',
        no_such_workspace: '找不到这个空间，可能已经被改名或归档了。刷新一下列表。',
        enoent: '目录不存在，或者当前账号没有权限读它。',
        eacces: '没有权限访问这个目录。',
        eperm: '没有权限访问这个目录。',
        eexist: '目标目录已经存在了。',
        not_a_directory: '这个路径不是一个目录。',
        enotdir: '这个路径不是一个目录。',
        unsupported: '当前宿主版本还不支持这个操作（需要升级宿主半体）。',
        not_implemented: '当前宿主版本还没有实现这个操作。',
        timeout: '宿主没有在预期时间内响应，稍后再试。',
        offline: '控制服务未连接，稍后再试。',
        busy: '宿主正忙，稍后再试。',
        internal: '宿主内部出错，看 DSH 日志能拿到细节。',
      };
      if (code && map[code]) return map[code];
      if (/ENOENT/i.test(raw)) return '目录不存在，或者当前账号没有权限读它。';
      if (/EACCES|EPERM/i.test(raw)) return '没有权限访问这个目录。';
      if (/EEXIST/i.test(raw)) return '目标目录已经存在了。';
      if (/fetch|network|failed to load|连接/i.test(raw)) return '控制服务未连接：' + (raw || '网络请求失败');
      return raw || '未知错误（宿主没有给出原因）。';
    }

    /** 统一取 JSON。返回 { ok, data, error }，**绝不抛异常**。 */
    async function ccFetchJson(url, options) {
      try {
        const res = await fetch(url, Object.assign({ cache: 'no-store' }, options || {}));
        if (!res.ok) {
          return { ok: false, error: { code: 'http_' + res.status, message: 'HTTP ' + res.status } };
        }
        const data = await res.json().catch(() => null);
        if (data === null) return { ok: false, error: { code: 'bad_json', message: '返回内容不是 JSON' } };
        return { ok: true, data };
      } catch (error) {
        return { ok: false, error: { code: 'offline', message: String((error && error.message) || error) } };
      }
    }

    /** 宿主健康状态（缓存 8 秒；force=true 给「重试」按钮用）。 */
    async function ccLoadHealth(force) {
      const now = Date.now();
      if (!force && ccCache.health && now - ccCache.healthAt < 8000) return ccCache.health;
      if (!force && ccCache.healthTried && now - ccCache.healthTried < 8000) return ccCache.health;
      ccCache.healthTried = now;
      const out = await ccFetchJson(CC_API + '/health');
      ccCache.health = out.ok
        ? {
            ok: out.data && out.data.ok !== false,
            version: out.data && out.data.version,
            services: (out.data && out.data.services) || {},
          }
        : { ok: false, error: out.error };
      ccCache.healthAt = Date.now();
      ccState.health = ccCache.health;
      return ccCache.health;
    }

    async function ccLoadWorkspaces() {
      const out = await ccFetchJson(CC_API + '/workspaces');
      if (!out.ok) {
        ccState.workspaces = null;
        ccState.workspacesError = out.error;
        return null;
      }
      ccState.workspaces = Array.isArray(out.data) ? out.data : [];
      ccState.workspacesError = null;
      return ccState.workspaces;
    }

    async function ccLoadSessions() {
      const out = await ccFetchJson(CC_API + '/sessions/inspect');
      if (!out.ok) {
        ccState.sessions = null;
        ccState.sessionsError = out.error;
        return null;
      }
      ccState.sessions = Array.isArray(out.data) ? out.data : [];
      ccState.sessionsError = null;
      return ccState.sessions;
    }

    /* ── 面板的建 / 开 / 关 ───────────────────────────────────── */

    function ccEl() { return document.getElementById(CC_ID); }

    function ccIsOpen() {
      const el = ccEl();
      return !!el && el.hasAttribute('data-dshlg-cc-open');
    }

    function ccSetNotice(kind, text) {
      ccState.notice = text ? { kind, text } : null;
    }

    /** 面板壳：标题 + 可选动作按钮（用 DOM 追加，不重写 innerHTML）。 */
    function ccShell(titleText, actionHtml) {
      const wrap = document.createElement('div');
      wrap.className = 'cc-sec';
      const h = document.createElement('h4');
      h.textContent = titleText;
      wrap.appendChild(h);
      if (actionHtml) {
        const box = document.createElement('div');
        box.innerHTML = actionHtml;
        wrap.appendChild(box);
      }
      return wrap;
    }

    function ccNoticeNode() {
      const note = ccState.notice;
      if (!note) return null;
      const div = document.createElement('div');
      div.className = 'cc-note ' + (note.kind === 'error' ? 'cc-err' : 'cc-ok');
      div.textContent = note.text;
      return div;
    }

    /** 降级页：宿主不可达时给人话，而不是空白面板。 */
    function ccDegradedNode(what, error) {
      const box = document.createElement('div');
      box.className = 'cc-degraded';
      const svc = (ccState.health && ccState.health.services) || {};
      const lines = Object.keys(svc).map((k) => k + (svc[k] ? ' ✓' : ' ✗'));
      box.innerHTML = '<b>控制服务未连接</b>'
        + '<div class="cc-why">' + ccEsc(what) + '暂时不可用。'
        + (error ? '原因：' + ccEsc(ccHumanError(error)) : '')
        + '</div>'
        + '<div class="cc-why">当前可用：'
        + ccEsc(lines.length ? lines.join('　') : '（宿主没有上报服务清单）') + '</div>'
        + '<div class="cc-actions">'
        + '<button type="button" class="cc-btn cc-go" data-cc-act="retry">重试</button>'
        + '<span class="cc-tail">需要宿主半体（index.js）提供 ' + ccEsc(CC_API) + ' 路由</span>'
        + '</div>';
      return box;
    }

    /* ── 分页 1：工作区（M1）──────────────────────────────────── */

    function ccTabWorkspaces() {
      const frag = document.createDocumentFragment();
      const notice = ccNoticeNode();
      if (notice) frag.appendChild(notice);

      if (ccState.workspacesError) {
        frag.appendChild(ccDegradedNode('工作区列表', ccState.workspacesError));
        return frag;
      }
      if (ccState.workspaces === null) {
        const loading = document.createElement('div');
        loading.className = 'cc-empty';
        loading.textContent = '正在读取工作区…';
        frag.appendChild(loading);
        void ccLoadWorkspaces().then(() => { if (ccIsOpen()) ccRender(); });
        return frag;
      }

      const bar = document.createElement('div');
      bar.className = 'cc-actions';
      bar.innerHTML =
        '<button type="button" class="cc-btn cc-go" data-cc-act="new">新建空间</button>'
        + '<button type="button" class="cc-btn" data-cc-act="sort">排序：' + (ccState.sortAsc ? '名称 ↑' : '名称 ↓') + '</button>'
        + '<button type="button" class="cc-btn" data-cc-act="reload">刷新</button>'
        + '<button type="button" class="cc-btn" data-cc-act="show-archived">' + (ccState.showArchived ? '隐藏已归档' : '显示已归档') + '</button>'
        + '<span class="cc-tail">共 ' + ccState.workspaces.length + ' 个</span>';
      frag.appendChild(bar);

      if (ccState.wizard) frag.appendChild(ccWizardNode());

      const list = ccState.workspaces
        .filter((w) => ccState.showArchived || !w.archived)
        .slice()
        .sort((a, b) => {
          if (!!b.pinned !== !!a.pinned) return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
          const r = String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN');
          return ccState.sortAsc ? r : -r;
        });

      if (list.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'cc-empty';
        empty.textContent = ccState.workspaces.length === 0 ? '宿主没返回任何工作区。' : '当前筛选下没有工作区。';
        frag.appendChild(empty);
      }
      for (const w of list) frag.appendChild(ccWorkspaceRow(w));

      const tail = document.createElement('div');
      tail.className = 'cc-tail';
      tail.textContent = '删除一律只做「归档」—— 本项目还没验证过真删除的语义边界，所以不提供。';
      frag.appendChild(tail);
      return frag;
    }

    function ccWorkspaceRow(w) {
      const row = document.createElement('div');
      row.className = 'cc-row' + (w.current ? ' is-current' : '');
      const id = String(w.id ?? '');

      const chips = [];
      if (w.current) chips.push('<span class="cc-chip cc-cur">当前</span>');
      if (w.pinned) chips.push('<span class="cc-chip">置顶</span>');
      if (w.archived) chips.push('<span class="cc-chip cc-warn">已归档</span>');
      chips.push('<span class="cc-chip">' + Number(w.sessionCount || 0) + ' 会话</span>');

      row.innerHTML = '<div class="cc-main">'
        + '<div class="cc-name">' + ccEsc(w.name || '(未命名)') + '</div>'
        + '<div class="cc-path" title="' + ccEsc(w.path || '') + '">' + ccEsc(w.path || '(无路径)') + '</div>'
        + '</div>'
        + '<div class="cc-meta">' + chips.join('') + '</div>';

      const main = row.querySelector('.cc-main');

      const acts = document.createElement('div');
      acts.className = 'cc-actions';
      acts.innerHTML =
        (w.current ? '' : '<button type="button" class="cc-btn cc-go" data-cc-ws="switch" data-id="' + ccEsc(id) + '">切换</button>')
        + '<button type="button" class="cc-btn" data-cc-ws="rename" data-id="' + ccEsc(id) + '">重命名</button>'
        + '<button type="button" class="cc-btn" data-cc-ws="pin" data-id="' + ccEsc(id) + '">' + (w.pinned ? '取消置顶' : '置顶') + '</button>'
        + (w.archived
          ? '<button type="button" class="cc-btn" data-cc-ws="unarchive" data-id="' + ccEsc(id) + '">取消归档</button>'
          : '<button type="button" class="cc-btn cc-danger" data-cc-ws="archive" data-id="' + ccEsc(id) + '">归档</button>');
      main.appendChild(acts);

      /* 危险动作二次确认：就地展开，并显示会影响多少个会话 */
      if (ccState.confirm && String(ccState.confirm.id) === id) {
        const c = ccState.confirm;
        const box = document.createElement('div');
        box.className = 'cc-confirm';
        box.innerHTML = '<b>确定要' + (c.kind === 'archive' ? '归档' : '取消归档') + '「' + ccEsc(c.name) + '」吗？</b>'
          + '<div class="cc-why">会影响 ' + Number(c.sessions || 0) + ' 个会话。'
          + (c.kind === 'archive' ? '归档不会删除任何文件，之后可以取消归档。' : '')
          + '</div>'
          + '<div class="cc-actions">'
          + '<button type="button" class="cc-btn cc-danger cc-go" data-cc-confirm="yes">确定'
          + (c.kind === 'archive' ? '归档' : '取消归档') + '</button>'
          + '<button type="button" class="cc-btn" data-cc-confirm="no">取消</button>'
          + '</div>';
        main.appendChild(box);
      }

      /* 重命名：就地输入 */
      if (ccState.renamingId === id) {
        const form = document.createElement('div');
        form.className = 'cc-form';
        form.innerHTML = '<label>新名字</label>'
          + '<input type="text" data-cc-rename-input value="' + ccEsc(w.name || '') + '" />'
          + '<div class="cc-actions">'
          + '<button type="button" class="cc-btn cc-go" data-cc-ws="rename-ok" data-id="' + ccEsc(id) + '">保存</button>'
          + '<button type="button" class="cc-btn" data-cc-ws="rename-cancel">取消</button>'
          + '</div>';
        main.appendChild(form);
      }
      return row;
    }

    function ccWizardNode() {
      const wiz = ccState.wizard;
      const box = document.createElement('div');
      box.className = 'cc-confirm';
      if (!wiz) return box;
      if (wiz.step === 'path') {
        box.innerHTML = '<b>新建空间 · 第 1 步：选目录</b>'
          + '<div class="cc-why">填一个已存在目录的绝对路径。宿主会校验它是否存在、是不是目录、有没有权限。</div>'
          + '<div class="cc-form">'
          + '<input type="text" data-cc-wiz-path placeholder="D:\\AI应用\\某个目录" value="' + ccEsc(wiz.path || '') + '" />'
          + (wiz.error ? '<div class="cc-why">' + ccEsc(wiz.error) + '</div>' : '')
          + '<div class="cc-actions">'
          + '<button type="button" class="cc-btn cc-go" data-cc-wiz="path-next">下一步</button>'
          + '<button type="button" class="cc-btn" data-cc-wiz="cancel">取消</button>'
          + '</div></div>';
        return box;
      }
      box.innerHTML = '<b>新建空间 · 第 2 步：起名字</b>'
        + '<div class="cc-why">目录：' + ccEsc(wiz.path || '') + '</div>'
        + '<div class="cc-form">'
        + '<input type="text" data-cc-wiz-name placeholder="显示名（留空则用目录名）" value="' + ccEsc(wiz.name || '') + '" />'
        + (wiz.error ? '<div class="cc-why">' + ccEsc(wiz.error) + '</div>' : '')
        + '<div class="cc-actions">'
        + '<button type="button" class="cc-btn cc-go" data-cc-wiz="create">创建</button>'
        + '<button type="button" class="cc-btn" data-cc-wiz="back">上一步</button>'
        + '<button type="button" class="cc-btn" data-cc-wiz="cancel">取消</button>'
        + '</div></div>';
      return box;
    }

    /* ── 分页 2：会话 ─────────────────────────────────────────── */

    function ccTabSessions() {
      const frag = document.createDocumentFragment();
      const intro = ccShell('会话巡检', '<div class="cc-tail">只读：列出有问题的会话和修复建议，本面板不会替你改会话。</div>');
      frag.appendChild(intro);

      const notice = ccNoticeNode();
      if (notice) frag.appendChild(notice);

      if (ccState.sessionsError) {
        frag.appendChild(ccDegradedNode('会话巡检', ccState.sessionsError));
        return frag;
      }
      if (ccState.sessions === null) {
        const loading = document.createElement('div');
        loading.className = 'cc-empty';
        loading.textContent = '正在读取…';
        frag.appendChild(loading);
        void ccLoadSessions().then(() => { if (ccIsOpen()) ccRender(); });
        return frag;
      }
      if (ccState.sessions.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'cc-empty';
        empty.textContent = '没有发现需要处理的会话。';
        frag.appendChild(empty);
        return frag;
      }

      const order = { high: 0, error: 0, warn: 1, medium: 1, low: 2, info: 3 };
      const rows = ccState.sessions
        .slice()
        .sort((a, b) => (order[String(a.severity || 'info').toLowerCase()] ?? 9) - (order[String(b.severity || 'info').toLowerCase()] ?? 9));

      for (const s of rows) {
        const row = document.createElement('div');
        row.className = 'cc-row';
        const sev = String(s.severity || 'info').toLowerCase();
        const chipCls = (sev === 'high' || sev === 'error') ? 'cc-bad' : ((sev === 'warn' || sev === 'medium') ? 'cc-warn' : '');
        row.innerHTML = '<div class="cc-main">'
          + '<div class="cc-name">' + ccEsc(s.title || s.id || '(无标题)') + '</div>'
          + '<div class="cc-path">' + ccEsc(s.symptom || '') + '</div>'
          + (s.suggestion ? '<div class="cc-path">建议：' + ccEsc(s.suggestion) + '</div>' : '')
          + '</div>'
          + '<div class="cc-meta"><span class="cc-chip ' + chipCls + '">' + ccEsc(sev) + '</span></div>';
        frag.appendChild(row);
      }
      const tail = document.createElement('div');
      tail.className = 'cc-tail';
      tail.textContent = '共 ' + rows.length + ' 条。';
      frag.appendChild(tail);
      return frag;
    }

    /* ── 分页 3：插件 ─────────────────────────────────────────── */

    function ccTabPlugins() {
      const frag = document.createDocumentFragment();
      const tagged = document.querySelectorAll('[data-dshlg-region]').length;
      const sec = ccShell('已加载的玻璃插件',
        '<div class="cc-kv"><span class="k">本插件版本</span><span class="v">v' + ccEsc(VERSION) + '</span></div>'
        + '<div class="cc-kv"><span class="k">运行期样式</span><span class="v">'
        + (document.getElementById(STYLE_ID_DYN) ? '已注入' : '未注入')
        + '　静态材质：' + (document.getElementById(STYLE_LINK_ID) ? '已加载' : '内联兜底')
        + '</span></div>'
        + '<div class="cc-kv"><span class="k">已标记玻璃面</span><span class="v">' + tagged + ' 块</span></div>'
        + '<div class="cc-kv"><span class="k">壁纸控制条</span><span class="v">'
        + (document.getElementById(CTRL_ID) ? '在' : '不在（已收起或未探到宿主）') + '</span></div>');
      frag.appendChild(sec);

      const other = ccShell('其它插件',
        '<div class="cc-empty">本项目<strong>不提供</strong>第三方插件的安装 / 卸载 / 启停。'
        + '<div class="cc-tail">原因：宿主端没有可验证的插件管理接口，误操作会直接影响 DSH 启动。'
        + '要看已安装插件请用 DSH 自己的界面。</div></div>');
      frag.appendChild(other);
      return frag;
    }

    /* ── 分页 4：系统 ─────────────────────────────────────────── */

    function ccTabSystem() {
      const frag = document.createDocumentFragment();
      const h = ccState.health;

      if (!h) {
        const loading = document.createElement('div');
        loading.className = 'cc-empty';
        loading.textContent = '正在读取宿主状态…';
        frag.appendChild(loading);
        void ccLoadHealth().then(() => { if (ccIsOpen()) ccRender(); });
        return frag;
      }
      if (!h.ok) {
        frag.appendChild(ccDegradedNode('宿主控制接口', h.error));
      } else {
        const svc = h.services || {};
        const keys = Object.keys(svc);
        frag.appendChild(ccShell('宿主',
          '<div class="cc-kv"><span class="k">状态</span><span class="v">已连接</span></div>'
          + '<div class="cc-kv"><span class="k">宿主版本</span><span class="v">' + ccEsc(h.version || '(未上报)') + '</span></div>'
          + '<div class="cc-kv"><span class="k">服务</span><span class="v">'
          + (keys.length ? keys.map((k) => ccEsc(k) + (svc[k] ? ' ✓' : ' ✗')).join('　') : '（宿主没有上报服务清单）')
          + '</span></div>'));
      }

      frag.appendChild(ccShell('应用',
        '<div class="cc-kv"><span class="k">页面来源</span><span class="v">'
        + ccEsc(String(location.origin || location.href).slice(0, 120)) + '</span></div>'
        + '<div class="cc-kv"><span class="k">视口</span><span class="v">'
        + window.innerWidth + ' × ' + window.innerHeight + '</span></div>'
        + '<div class="cc-kv"><span class="k">材质来源</span><span class="v">'
        + ccEsc((stylesheetUrls && stylesheetUrls()[0]) || '(未知)') + '</span></div>'));

      const acts = document.createElement('div');
      acts.className = 'cc-actions';
      acts.innerHTML = '<button type="button" class="cc-btn" data-cc-act="reload-health">刷新状态</button>'
        + '<button type="button" class="cc-btn" data-cc-act="log-report">把诊断打到控制台</button>';
      frag.appendChild(acts);

      const tail = document.createElement('div');
      tail.className = 'cc-tail';
      tail.textContent = '凭据 / 密钥管理刻意不做：宿主 HTTP 服务绝不承载任何密钥读写。';
      frag.appendChild(tail);
      return frag;
    }

    function ccTabNode(tabId) {
      if (tabId === 'sessions') return ccTabSessions();
      if (tabId === 'plugins') return ccTabPlugins();
      if (tabId === 'system') return ccTabSystem();
      return ccTabWorkspaces();
    }

    /* ── 渲染（含错误边界）────────────────────────────────────── */

    /**
     * 错误边界：任一分页渲染抛异常 → 只把**这一个分页**换成
     * 「这个分页出错了 + 重试」，整页和另外几个分页都不受影响。
     * 这里刻意自己 try/catch，绝不让异常冒到 window.onerror。
     */
    function ccRender() {
      const el = ccEl();
      if (!el) return;
      const body = el.querySelector('.cc-body');
      const tabs = el.querySelector('.cc-tabs');
      if (!body || !tabs) return;

      tabs.replaceChildren();
      for (const tab of CC_TABS) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = tab.label;
        btn.dataset.ccTab = tab.id;
        btn.setAttribute('role', 'tab');
        btn.setAttribute('aria-selected', tab.id === ccState.tab ? 'true' : 'false');
        if (tab.id === ccState.tab) btn.classList.add('is-on');
        tabs.appendChild(btn);
      }

      ccState.renderError = null;
      try {
        body.replaceChildren(ccTabNode(ccState.tab));
      } catch (error) {
        ccState.renderError = String((error && error.message) || error);
        console.error('[dsh-liquid-glass] 控制中心分页渲染失败（已隔离）：', error);
        const box = document.createElement('div');
        box.className = 'cc-degraded cc-err';
        box.innerHTML = '<b>这个分页出错了</b>'
          + '<div class="cc-why">' + ccEsc(ccState.renderError) + '</div>'
          + '<div class="cc-actions">'
          + '<button type="button" class="cc-btn cc-go" data-cc-act="retry-tab">重试</button>'
          + '</div>';
        body.replaceChildren(box);
      }
    }

    /* ── 宿主动作（全部经 requestPass 挂钩，不引用 applyGlass 内部量）── */

    async function ccPost(action, payload) {
      const out = await ccFetchJson(CC_API + '/workspace/' + action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {}),
      });
      if (!out.ok) { ccSetNotice('error', ccHumanError(out.error)); return false; }
      if (out.data && out.data.ok === false) { ccSetNotice('error', ccHumanError(out.data.error)); return false; }
      return true;
    }

    async function ccDoWorkspaceAction(kind, id) {
      if (ccState.busy) return;
      const list = ccState.workspaces || [];
      const w = list.find((x) => String(x.id) === String(id)) || { id, name: id, sessionCount: 0 };
      ccState.busy = true;
      try {
        if (kind === 'switch') {
          const ok = await ccPost('switch', { id });
          if (ok) {
            ccSetNotice('ok', '已请求切换到「' + (w.name || id) + '」。');
            await ccLoadWorkspaces();
          } else {
            /* 契约里没有 switch 端点：说人话 + 给退路，别只丢一个「不支持」 */
            ccSetNotice('error', '宿主还不支持从插件里切换空间，请用 DSH 自己的工作区入口。'
              + '（这个能力要等宿主把 ' + CC_API + '/workspace/switch 做出来）');
          }
        } else if (kind === 'pin') {
          const ok = await ccPost('pin', { id, pinned: !w.pinned });
          if (ok) { ccSetNotice('ok', (w.pinned ? '已取消置顶' : '已置顶') + '「' + (w.name || id) + '」'); await ccLoadWorkspaces(); }
        } else if (kind === 'archive' || kind === 'unarchive') {
          const ok = await ccPost('archive', { id, archived: kind === 'archive' });
          if (ok) {
            ccSetNotice('ok', (kind === 'archive' ? '已归档' : '已取消归档') + '「' + (w.name || id) + '」');
            await ccLoadWorkspaces();
          }
        } else if (kind === 'rename') {
          const input = document.querySelector('#' + CC_ID + ' [data-cc-rename-input]');
          const name = input ? String(input.value || '').trim() : '';
          if (!name) { ccSetNotice('error', '名字不能为空。'); return; }
          const ok = await ccPost('rename', { id, name });
          if (ok) {
            ccSetNotice('ok', '已改名为「' + name + '」');
            ccState.renamingId = null;
            await ccLoadWorkspaces();
          }
        }
      } finally {
        ccState.busy = false;
        ccState.confirm = null;
      }
    }

    async function ccDoCreate() {
      const wiz = ccState.wizard;
      if (!wiz || ccState.busy) return;
      ccState.busy = true;
      try {
        const ok = await ccPost('create', { path: wiz.path, name: wiz.name });
        if (ok) {
          ccState.wizard = null;
          ccSetNotice('ok', '空间已创建：' + (wiz.name || wiz.path));
          await ccLoadWorkspaces();
        } else if (ccState.notice && ccState.notice.kind === 'error' && ccState.wizard) {
          /* 把宿主的错误显示在向导里，用户不用抬头找提示 */
          ccState.wizard.error = ccState.notice.text;
        }
      } finally {
        ccState.busy = false;
      }
    }

    /* ── 事件（面板只建一次，全部走委托）──────────────────────── */

    function ccOnClick(event) {
      const el = ccEl();
      if (!el || !event || !event.target || !event.target.closest) return;

      const tabBtn = event.target.closest('#' + CC_ID + ' .cc-tabs button');
      if (tabBtn && tabBtn.dataset.ccTab) {
        ccState.tab = tabBtn.dataset.ccTab;
        ccState.notice = null;
        ccState.renderError = null;
        if (ccState.tab === 'sessions' && ccState.sessions === null && !ccState.sessionsError) void ccLoadSessions();
        if (ccState.tab === 'system') void ccLoadHealth();
        ccRender();
        return;
      }

      const act = event.target.closest('[data-cc-act]');
      if (act) {
        const a = act.dataset.ccAct;
        if (a === 'close') { ccClose(); return; }
        if (a === 'retry-tab') { ccState.renderError = null; ccRender(); return; }
        if (a === 'retry') {
          ccCache.health = null; ccCache.healthAt = 0; ccCache.healthTried = 0;
          ccState.workspaces = null; ccState.workspacesError = null;
          ccState.sessions = null; ccState.sessionsError = null;
          ccSetNotice(null, null);
          void ccLoadHealth(true).then(() => { if (ccIsOpen()) ccRender(); });
          return;
        }
        if (a === 'reload') {
          ccState.workspaces = null;
          ccSetNotice(null, null);
          void ccLoadWorkspaces().then(() => { if (ccIsOpen()) ccRender(); });
          return;
        }
        if (a === 'sort') { ccState.sortAsc = !ccState.sortAsc; ccRender(); return; }
        if (a === 'show-archived') { ccState.showArchived = !ccState.showArchived; ccRender(); return; }
        if (a === 'new') {
          ccState.wizard = { step: 'path', path: '', name: '', error: null };
          ccSetNotice(null, null);
          ccRender();
          return;
        }
        if (a === 'reset-pos') {
          clearPos();
          el.removeAttribute('style');
          el.removeAttribute('data-dshlg-moved');
          delete el.dataset.dshlgMoved;
          ccRender();
          return;
        }
        if (a === 'reload-health') { ccCache.healthAt = 0; void ccLoadHealth(true).then(() => { if (ccIsOpen()) ccRender(); }); return; }
        if (a === 'log-report') {
          try {
            console.info('[dsh-liquid-glass] 控制中心诊断', {
              version: VERSION,
              health: ccState.health,
              workspaces: ccState.workspaces,
              sessions: ccState.sessions,
              viewport: [window.innerWidth, window.innerHeight],
            });
            ccSetNotice('ok', '诊断信息已打到控制台（F12 → Console）。');
          } catch (error) {
            ccSetNotice('error', String((error && error.message) || error));
          }
          ccRender();
          return;
        }
      }

      const wizBtn = event.target.closest('[data-cc-wiz]');
      if (wizBtn && ccState.wizard) {
        const k = wizBtn.dataset.ccWiz;
        if (k === 'cancel') { ccState.wizard = null; ccRender(); return; }
        if (k === 'back') { ccState.wizard.step = 'path'; ccState.wizard.error = null; ccRender(); return; }
        if (k === 'path-next') {
          const input = el.querySelector('[data-cc-wiz-path]');
          const path = input ? String(input.value || '').trim() : '';
          if (!path) { ccState.wizard.error = '请填一个目录的绝对路径。'; ccRender(); return; }
          if (!/^[a-zA-Z]:[\\/]/.test(path) && path.charAt(0) !== '/') {
            ccState.wizard.error = '看起来不是绝对路径：Windows 上应形如 D:\\目录，Unix 上以 / 开头。';
            ccRender();
            return;
          }
          ccState.wizard.path = path;
          ccState.wizard.step = 'name';
          ccState.wizard.error = null;
          ccRender();
          return;
        }
        if (k === 'create') {
          const input = el.querySelector('[data-cc-wiz-name]');
          ccState.wizard.name = input ? String(input.value || '').trim() : '';
          void ccDoCreate().then(() => { if (ccIsOpen()) ccRender(); });
          return;
        }
      }

      const cf = event.target.closest('[data-cc-confirm]');
      if (cf) {
        if (cf.dataset.ccConfirm === 'no') { ccState.confirm = null; ccRender(); return; }
        const c = ccState.confirm;
        if (!c) return;
        const kind = c.kind;
        const id = c.id;
        ccState.confirm = null;
        void ccDoWorkspaceAction(kind, id).then(() => { if (ccIsOpen()) ccRender(); });
        return;
      }

      const ws = event.target.closest('[data-cc-ws]');
      if (ws) {
        const kind = ws.dataset.ccWs;
        const id = ws.dataset.id;
        if (kind === 'rename') { ccState.renamingId = id; ccState.notice = null; ccRender(); return; }
        if (kind === 'rename-cancel') { ccState.renamingId = null; ccRender(); return; }
        if (kind === 'rename-ok') { void ccDoWorkspaceAction('rename', id).then(() => { if (ccIsOpen()) ccRender(); }); return; }
        if (kind === 'archive' || kind === 'unarchive') {
          const w = (ccState.workspaces || []).find((x) => String(x.id) === String(id)) || {};
          ccState.confirm = { kind, id, name: w.name || id, sessions: w.sessionCount || 0 };
          ccRender();
          return;
        }
        void ccDoWorkspaceAction(kind, id).then(() => { if (ccIsOpen()) ccRender(); });
      }
    }

    /** Esc 通道。向导/重命名打开时，Esc 先退那一层而不是整个面板。 */
    function ccOnKeydown(event) {
      if (event.key !== 'Escape' && event.key !== 'Esc') return;
      if (!ccIsOpen()) return;
      const t = event.target;
      const inPanel = t && t.closest && t.closest('#' + CC_ID);
      if (inPanel && (ccState.wizard || ccState.renamingId)) {
        ccState.wizard = null;
        ccState.renamingId = null;
        ccRender();
      } else {
        ccClose();
      }
      event.preventDefault();
      event.stopPropagation();
    }

    /**
     * 销毁：插件被 dispose 时由 applyGlass 的 cleanup 调用。
     *
     * 存在的理由：控制中心在 **document** 上挂了两个捕获监听
     * （点外部 + Esc），而 cleanup 里那份 id 清单不认识 CC_ID /
     * CC_BACKDROP_ID，也不会摘 document 级监听 —— 不在这里收拾，
     * 插件卸载后会留下一对「对着已删节点做事的」全局监听。
     */
    function ccTeardown() {
      try { document.removeEventListener('pointerdown', ccOnOutsidePointer, true); } catch { /* 忽略 */ }
      try { document.removeEventListener('keydown', ccOnKeydown, true); } catch { /* 忽略 */ }
      for (const id of [CC_ID, CC_BACKDROP_ID]) {
        try { document.getElementById(id)?.remove(); } catch { /* 忽略 */ }
      }
    }

    /** 输入框里按 Enter = 点同组的确认按钮（键盘用户不用去够鼠标）。 */
    function ccOnKeydownInner(event) {
      if (event.key !== 'Enter') return;
      const t = event.target;
      if (!t || !t.closest) return;
      const el = ccEl();
      if (!el || !el.contains(t)) return;
      if (t.hasAttribute('data-cc-rename-input')) {
        const ok = t.closest('.cc-form')?.querySelector('[data-cc-ws="rename-ok"]');
        if (ok) { event.preventDefault(); ok.click(); }
        return;
      }
      if (t.hasAttribute('data-cc-wiz-path')) {
        const next = el.querySelector('[data-cc-wiz="path-next"]');
        if (next) { event.preventDefault(); next.click(); }
        return;
      }
      if (t.hasAttribute('data-cc-wiz-name')) {
        const create = el.querySelector('[data-cc-wiz="create"]');
        if (create) { event.preventDefault(); create.click(); }
      }
    }

    /** 点外部通道：兜底面 + document 捕获各一条，互为保险。 */
    function ccOnOutsidePointer(event) {
      if (!ccIsOpen()) return;
      const box = ccEl();
      if (!box) return;
      const t = event.target;
      if (t && box.contains(t)) return;
      if (t && t.closest && t.closest('#' + CTRL_ID + ', #' + GEAR_ID)) return; // 点入口不算外部
      ccClose();
    }

    /* ── 开 / 关 ─────────────────────────────────────────────── */

    function ccOpen(tabId) {
      /* 需要时先建起来 —— 万一入口走的是「齿轮里的按钮」而控制条被收起，
         这时 ensureControlCenter 可能还没被调过。幂等，重复调没代价。 */
      if (!ccEl()) ensureControlCenter();
      const el = ccEl();
      if (!el) return false;
      if (tabId) ccState.tab = tabId;
      try { ccState.lastFocus = document.activeElement; } catch { ccState.lastFocus = null; }
      el.setAttribute('data-dshlg-cc-open', '');
      el.removeAttribute('hidden');
      const back = document.getElementById(CC_BACKDROP_ID);
      if (back) back.setAttribute('data-dshlg-cc-open', '');
      ccState.wizard = null;
      ccState.confirm = null;
      ccState.renderError = null;
      ccRender();
      void ccLoadHealth().then(() => { if (ccIsOpen() && ccState.tab === 'system') ccRender(); });
      /* 焦点：落在第一个控件（不是整个面板），键盘用户 Tab 一下就能走 */
      requestAnimationFrame(() => {
        try {
          const first = el.querySelector('.cc-tabs button') || el.querySelector('button');
          if (first && typeof first.focus === 'function') first.focus({ preventScroll: true });
        } catch { /* 忽略 */ }
      });
      return true;
    }

    function ccClose() {
      const el = ccEl();
      if (!el) return false;
      el.removeAttribute('data-dshlg-cc-open');
      el.setAttribute('hidden', '');
      const back = document.getElementById(CC_BACKDROP_ID);
      if (back) back.removeAttribute('data-dshlg-cc-open');
      ccState.wizard = null;
      ccState.confirm = null;
      ccState.renamingId = null;
      const prev = ccState.lastFocus;
      ccState.lastFocus = null;
      requestAnimationFrame(() => {
        try {
          if (prev && prev.isConnected && typeof prev.focus === 'function') prev.focus({ preventScroll: true });
          else {
            const g = document.getElementById(GEAR_ID);
            if (g && typeof g.focus === 'function') g.focus({ preventScroll: true });
          }
        } catch { /* 忽略 */ }
      });
      return false;
    }

    function ccToggle(tabId) {
      return ccIsOpen() ? ccClose() : ccOpen(tabId);
    }

    /**
     * 建面板（幂等）。只在第一次真正建 DOM + 挂监听。
     * 面板本体不做 backdrop-filter（见控制中心材质的注释）。
     */
    function ensureControlCenter() {
      let el = ccEl();
      if (!el) {
        let back = document.getElementById(CC_BACKDROP_ID);
        if (!back) {
          back = document.createElement('div');
          back.id = CC_BACKDROP_ID;
          back.dataset.dshlgKeep = '1';
          back.setAttribute('aria-hidden', 'true');
          /* 点外部通道 1：兜底面独立覆盖整个视口，最容易命中 */
          back.addEventListener('pointerdown', (event) => {
            const t = event.target;
            const box = ccEl();
            if (t && t.closest && t.closest('#' + CTRL_ID + ', #' + GEAR_ID)) return;
            if (box && t && box.contains(t)) return;
            if (ccIsOpen()) ccClose();
          });
          document.body.appendChild(back);
        }

        el = document.createElement('div');
        el.id = CC_ID;
        el.dataset.dshlgKeep = '1';
        el.setAttribute('hidden', '');
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-modal', 'false');
        el.setAttribute('aria-label', '控制中心');
        el.innerHTML = '<div class="cc-head"><b>控制中心</b><span class="grow"></span>'
          + '<button type="button" data-cc-act="reset-pos">重置位置</button>'
          + '<button type="button" data-cc-act="close">关闭</button></div>'
          + '<div class="cc-tabs" role="tablist"></div>'
          + '<div class="cc-body"></div>';
        el.addEventListener('click', ccOnClick);
        el.addEventListener('keydown', ccOnKeydownInner);
        document.body.appendChild(el);

        /* 点外部通道 2：document 捕获。兜底面可能被别的浮层盖住 / 被 pointer-events 挡住 */
        document.addEventListener('pointerdown', ccOnOutsidePointer, true);
        /* 关闭通道 3：Esc。挂 document 捕获，面板没聚焦也能关 */
        document.addEventListener('keydown', ccOnKeydown, true);

        /* 拖动 + 位置记忆：直接复用项目里成熟的那两个（不重写）。
           注意 makeDraggable 的约定：位置写在 **left / bottom** 上
           （见 applySavedPos / savePos），所以面板的 CSS 必须用
           left + bottom 定位，**不能**用 top/transform 居中 ——
           否则拖动时 top 与 bottom 会同时生效，面板被抻成一条。
           回调签名是 onMoved(el)，不是 onMoved(pos)。 */
        try {
          makeDraggable(el, CC_POS_KEY, (node) => {
            if (node) node.setAttribute('data-dshlg-moved', '');
          });
          applySavedPos(el, CC_POS_KEY);
        } catch (error) {
          console.warn('[dsh-liquid-glass] 控制中心拖动初始化失败（不影响打开/关闭）：', error);
        }
      }
      ccRender();
      return el;
    }

    /* ══════════════════════════════════════════════════════════
     *  ★ 改这里调效果。存盘后按 Ctrl+R 生效。
     *
     *  这一版按 **iOS 26 Liquid Glass** 规格调：
     *    · 半透明白色叠层 ≈8%、背景 18px 高斯模糊、饱和度 1.6×
     *    · 圆角 20px、描边 1px 白 18%
     *    · **只有边缘 10~15% 宽度向内折射**（透镜感），中间不扭
     *    · 最外缘 ≤2px 低强度彩虹色差
     *    · 顶部 1px 白色高光线（≈30%），四周一圈菲涅尔边缘光
     *    · 玻璃下柔和浮动阴影 0 8px 32px / 35% 黑
     *    · 激活（hover/聚焦）时：模糊减弱、折射与高光增强
     *    · 高光随指针移动（--dshlg-mx/my）
     * ══════════════════════════════════════════════════════════ */
    const CONFIG = {
      /* ── 四档通透度（设计规格：8% / 3% / 1.5% / 0）───────────
       * 改这一行就能整体换档，各区域的相对厚薄关系保持不变。
       * 注意取舍：越透越好看，但**文字压壁纸的可读性越差**。
       * sidebar/right 这类大面积为读字服务，所以默认给 'regular'。 */
      /* 用户定稿：**全透明玻璃，只有边框看得出是玻璃**。
         'off' = 白纱 0；玻璃感全部由 1px 描边 + 顶部高光 + 菲涅尔内环给出。 */
      glassTier: 'off',

      /* 自制界面的位置微调 */
      ui: {
        /* 齿轮按钮与控制条右边界之间的间距（px）。
           控制条右边若是头像/其它按钮，调大这个值即可避开。 */
        gearGap: 72,
      },

      /* ── 玻璃质感（iOS 26 规格，全区域共用）─────────────────
       * 每档还可以单独覆盖 alpha / frost，不写就吃这里的默认值。 */
      glass: {
        /* 半透明白色叠层的不透明度。0.08 = 规格值。
         * 越小人越「无色」，但压字能力也越弱。 */

        /* 背景高斯模糊半径 px（18 = 规格值） */
        blur: 18,

        /* 饱和度提升（1.6 = 规格值） */
        saturate: 1.6,

        /* 圆角 px（20 = 规格值） */
        radius: 20,

        /* 描边：1px 白，18% */
        border: 1,
        borderAlpha: 0.18,

        /* 顶部 1px 白色高光线（30% 亮度） */
        topLine: 0.3,

        /* 四周菲涅尔边缘光强度（0~1），0 = 关 */
        fresnel: 0.22,

        /* 浮动阴影：0 8px 32px，35% 黑 */
        shadowY: 8,
        shadowBlur: 32,
        shadowAlpha: 0.35,

        /* 折射（透镜感）：只有边缘这一圈向内弯折。
         *   edgeRefract —— 边缘折射强度 px（0 = 不折射）
         *   edgeWidth   —— 边缘带占短边的比例（0.10~0.15 是规格区间） */
        edgeRefract: 0,
        edgeWidth: 0.12,

        /* 最外缘的彩虹色差：宽度 px（≤2）与强度（0 = 关） */
        chroma: 2,
        chromaAlpha: 0.22,

        /* 激活态（鼠标悬停 / 键盘聚焦）：模糊减弱、折射与高光增强 */
        activeBlur: 0.7,
        activeRefract: 1.6,
        activeHighlight: 1.5,

        /* 高光随指针滑移（跟着 --dshlg-mx/my 走） */
        pointerFollow: true,
      },

      /* ── 分层玻璃：每一个区域单独一档 ───────────────────────
       * 这一版的核心：不再用一个 panelAlpha 把整个界面抹平，
       * 而是「哪一层该透、哪一层该糊」分开控制。
       *
       * 每档两个数：
       *   alpha —— 玻璃底色不透明度。0 = 全透明（文字会压在壁纸上）
       *            null = 用 CONFIG.glass.tint（规格值 0.08）
       *   frost —— backdrop-filter 的模糊半径 px。0 = 不模糊
       *            null = 用 CONFIG.glass.blur（规格值 18）
       *
       * 中间工作区刻意**没有**开关：它永远是全透明的。 */
      middle: { alpha: 0, frost: 0 },

      /* 左侧「会话工作区」。面积大、字多，给它比规格稍厚一点点的底，
       * 否则花哨壁纸上的会话标题会糊成一片。 */
      /* frost: 0 = 不模糊（纯透明 + 边缘光学）；调成 18 就是磨砂玻璃 */
      sidebarGlass: { alpha: null, frost: 0 },

      /* 右侧栏（会话面板）。和左栏一档，保持「同一层」的观感。 */
      rightGlass: { alpha: null, frost: 0 },

      /* 聊天输入卡片（composer）。用户要求「和工作区输入栏也改一下」——
         以前它跟随 panelAlpha（≈0，几乎没有底），现在和侧栏同一档：
         可读性够、又不会变成一块白的。 */
      composerGlass: { alpha: null, frost: 0 },

      /* 下拉菜单、popover、菜单面板。菜单要读得快，底厚一点。 */
      /* ⚠️ 弹窗/菜单/popover 是**可读卡片**，不是结构性窗格，不能跟着 α0.138 走。
         上一轮「六面统一」把它们一起压薄，导致 DSH 自己的设置对话框变成全透明、
         文字与工作区重叠看不清 —— 这是那个问题的根因。这里恢复厚底。 */
      overlayGlass: { alpha: 0.74, frost: null },

      /* 审批对话框（「等待审批 / 允许一次」那张卡）。
       * 浮在对话流里，必须压得住标题与命令，但仍要透出壁纸。 */
      approvalGlass: { alpha: null, frost: 0 },

      /* 真正的模态弹窗（设置确认、风险确认这类居中对话框）。 */
      modalGlass: { alpha: null, frost: 0 },

      /* ── 左上角品牌区（DeepSeek 标 + 名字）───────────────
       * 用户要求：改「蓝色液态玻璃质感」，旁边的白块也一并收干净。
       * 做法是**叠加蓝色玻璃底**（不是替换图标）：文字与 logo 都留着，
       * 只在下面垫一层蓝色玻璃 + 边缘高光。
       *   alpha —— 蓝色叠加强度；0 = 关掉（恢复原样，只保留去白块）
       *   hue   —— 蓝色（HSL 色相角度，210 ≈ DeepSeek 蓝） */
      /* 品牌区按用户明确规格：**浅蓝色玻璃底 + 深蓝色字标/鱼标**。
         不跟随主题推导 —— 用户要的就是这个配色，深浅模式下都一致。
         alpha 是玻璃浓度（0.2 时在壁纸上几乎看不出蓝，只有一圈淡描边）。 */
      /* 用户定稿：品牌区也要**全透明** —— alpha 0 = 不画任何底，
         只留 1px 描边与顶部高光（和其余玻璃面一致）。
         想要回浅蓝玻璃底，把它调回 0.42 即可。 */
      brand: {
        alpha: 0,
        hue: 210,
        /* 玻璃底：浅蓝（blue-200） */
        base: { r: 191, g: 219, b: 254 },
        /* 字标与鱼标：深蓝（blue-800） */
        ink: { r: 30, g: 64, b: 175 },
        /* 品牌区显示的文字。设成空字符串则保留官方原始字标。
           为什么默认替换：官方是矢量字标 + 铭牌，我们清不掉铭牌那块底。 */
        label: 'Agent-枝星',
        /* 宝石配色：ice（冰钻白蓝，默认，暗色壁纸上最跳）/ gold（香槟金）/ aqua（青玉）
           深蓝在暗色壁纸上会看不清，所以默认不用深蓝。 */
        gem: 'ice',
      },

      /* ── 右栏收起后的表现 ─────────────────────────────────
       * DSH 的右栏「收起」是把面板滑出视口、并去掉 data-sidebar-right-open
       * （track 那一格仍然占位），所以收起后如果还留着玻璃，
       * 就会在右边留下一条**模糊的空带子** —— 用户要的是「和工作区一样透明」。
       *   'auto'  —— 面板真的开着才给玻璃；收起后全透明（默认）
       *   'keep'  —— 不管开合都保留玻璃 */
      rightWhenClosed: 'auto',

      /* 侧栏/右栏是否也做边缘折射。
       * 默认关：整列面积太大，SVG 折射在这个尺度上很吃显卡，
       * 而且「整列透镜」看着不像 iOS。要试就改成 true。 */
      refractRegions: false,

      /* 浮层的渲染方式：
       *   'frost' —— backdrop-filter 模糊（默认，最通透）
       *   'clear' —— 不模糊，改用更实的半透明色面板（显卡吃不消时用）
       *   'off'   —— 浮层完全不处理，交给 DSH 自己的材质 */
      overlayMode: 'frost',

      /* ── 通用透明度（保留旧语义，向后兼容）────────────────── */
      panelAlpha: 0,

      /* 浮层（下拉菜单 / 弹窗 / 工具提示）的令牌级不透明度。
       * overlay.alpha 是给「我们自己识别出来的浮层」用的；
       * 这一项是给**没被识别到的**浮层令牌兜底。 */
      overlayAlpha: 0.9,

      /* 面板很透时给文字加一层衬底阴影 —— 压在壁纸上可读性会好很多。
       * 0 = 关闭；0.55 左右比较自然。 */
      textShadow: 0.55,

      /* ── 内容块底色（对话里的卡片 / 代码块 / 工具调用框）─────
       * 'glass' —— 只清掉不透明底色，另给一层极淡的玻璃底（默认，推荐）
       * 'none'  —— 一块不留，连内容块也全透明（v1.8 的老行为，字会压壁纸）
       * 'keep'  —— 内容块完全不动，保留 DSH 自己的底色
       * 无论哪一档，**两侧栏与浮层的玻璃底都不受影响**。 */
      contentFill: 'glass',
      contentFillAlpha: 0.06,

      /* 逐层清掉容器底色（contentFill 之外的兜底，默认给 0 不参与）。 */
      clearBackgroundDepth: 0,

      /* ── 文字颜色 ──────────────────────────────────────────
       * 空字符串 = 用应用自己的配色（跟随明暗主题）。
       * 填颜色（如 '#ffffff'）= 强制所有文字用这个颜色。
       * 当前：统一白字（用户明确要求，深浅主题都白）。 */
      textColor: '#ffffff',

      /* true 时连「写死了颜色」的元素也一起强制（#root * { color: … !important }）。
       * 不打开的话「统一白字」做不到 —— DSH 里大量文字是写死颜色/走状态色的
       * （标题、正文、按钮、时间戳），只改令牌覆盖不到。
       * 代价：链接色、成功/警告/错误这类状态色也会变白。
       * 若发现某处本该有颜色却变白了，把它改回 false。 */
      textColorAggressive: true,

      /* 次要文字（时间戳、说明文字）是否跟着一起变。
       * false = 保留应用原本的次要文字色（通常更淡）。 */
      textColorSecondaryToo: true,

      /* ── 各区域的开关 ─────────────────────────────────────── */
      // 聊天框（消息输入卡片）
      composer: true,

      // 聊天框内的按钮行
      toolbar: true,

      // 左侧会话工作区（这一版默认开）
      sidebar: true,

      // 右侧栏（这一版默认开）
      right: true,

      // 顶栏（Windows 上其实是窗口标题条区域，默认不动它）
      topbar: false,

      // 审批对话框 / 模态弹窗 玻璃化
      approval: true,
      modal: true,

      // 模糊半径（px）—— 液态玻璃一般 6~12
      blur: 7,

      // 饱和度提升，让透过来的颜色更"活"
      saturate: 1.7,

      // 聊天框折射强度（px）—— 0 关闭折射，只要毛玻璃。12~24 效果明显
      refract: 0,   // 0 = 不做边缘折射（SVG 滤镜 backdrop 在动画壁纸上会闪烁）

      // 圆角（px）
      radius: 18,

      // 背景层：为了让玻璃"有东西可折射"，
      // 在应用后面铺一层随主题走的柔和光斑。
      // 接上壁纸后会自动让位（壁纸垫底效果更好）。
      backdrop: true,

      /* ── 壁纸 ──────────────────────────────────────────────
       * 由宿主半体（index.js）起的本地只读服务提供文件。
       * 这里填相对 wallpapers/ 的入口路径。
       *   宅邸禅院 → 'zen/index.html'
       */
      wallpaper: {
        enabled: true,
        entry: 'zen/index.html',
        // 宿主服务监听的候选端口，顺序与 index.js 保持一致
        ports: [39321, 39322, 39323, 39324],
        // 壁纸整体压暗 0~1（壁纸太亮会影响读字）
        dim: 0.15,
        // 壁纸整体模糊 px。⚠️ 壁纸是跨源 iframe（独立合成层），
        // 外面套 filter 会把它变成一片黑，所以默认 0，别乱调。
        blur: 0,
        // 壁纸不透明度
        opacity: 1,
        // 显示左下角的玻璃控制条（切场景 / 环境音 / 音量）
        controls: true,
        // 隐藏壁纸自带的 HUD（否则那个「院」按钮会浮在右边）
        hideWallpaperHud: true,
        // 下拉框里是否也列出 scene / application 类型的壁纸。
        // 那些依赖 Wallpaper Engine 的 DirectX 运行时，选了也渲染不出来，默认不显示。
        showUnsupported: false,
        // 壁纸画廊（缩略图九宫格）默认展开还是收起
        galleryOpen: false,
      },

      // 右下角状态横幅。已关闭；排查问题时改回 true 即可。
      // （无论开关，Console 里始终有详细日志。）
      report: false,
    };

    /* ── 工具 ───────────────────────────────────────────── */

    function parseColor(value) {
      const s = String(value ?? '').trim();
      if (!s || s === 'transparent' || s === 'none') return null;
      let m = /^#([0-9a-f]{3})$/i.exec(s);
      if (m) {
        const h = m[1];
        return {
          r: Number.parseInt(h[0] + h[0], 16),
          g: Number.parseInt(h[1] + h[1], 16),
          b: Number.parseInt(h[2] + h[2], 16),
        };
      }
      m = /^#([0-9a-f]{6})$/i.exec(s);
      if (m) {
        const n = Number.parseInt(m[1], 16);
        return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
      }
      m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(s);
      if (m) return { r: Math.round(+m[1]), g: Math.round(+m[2]), b: Math.round(+m[3]) };
      return null;
    }

    const toHex = (c) =>
      '#' +
      [c.r, c.g, c.b]
        .map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0'))
        .join('');

    /** 把 0~1 的两端夹住；非数字回落到 fallback。 */
    function clamp01(v, fallback = 0) {
      const n = Number(v);
      if (!Number.isFinite(n)) return fallback;
      return Math.max(0, Math.min(1, n));
    }

    /** 非负数值；非数字回落 fallback。 */
    function num(v, fallback = 0) {
      const n = Number(v);
      return Number.isFinite(n) ? Math.max(0, n) : fallback;
    }

    /** 四档通透度 → 白纱不透明度（设计规格 8% / 3% / 1.5% / 0）。 */
    const GLASS_TIERS = {
      clear: 0.08,     // 规格里的 Clear 档基准
      regular: 0.03,   // 默认：更透，仍压得住大部分壁纸
      thin: 0.015,     // 很透，花哨壁纸上字会吃力
      off: 0,          // 完全无色（只剩模糊与边缘光学）
    };

    /**
     * 各区域的**厚度倍数**（乘在档位值上）。
     * 为什么用倍数而不是绝对值：换通透度档时，各区域之间的相对关系
     * 必须保持不变 —— 否则换一档就要把所有区域重调一遍。
     * 倍数取舍来自「这块面上的字有多重要」：
     *   审批卡 > 弹窗 > 浮层菜单 > 左栏 ≈ 右栏 > 输入卡片。
     */
    /* 用户定稿：**所有玻璃面都对齐「右侧栏展开」那一档**（α = 0.03 × 4.6 ≈ 0.138），
       不再按区域分厚薄 —— 之前审批卡 ×10、弹窗 ×13 明显偏厚，看着不像同一套材质。 */
    const REGION_MULT = {
      sidebarGlass: 4.6,
      rightGlass: 4.6,
      composerGlass: 4.6,
      overlayGlass: 4.6,
      approvalGlass: 4.6,
      modalGlass: 4.6,
    };

    /** 取 iOS 26 规格里的一项（CONFIG.glass 的兜底）。 */
    function g(key, fallback) {
      const raw = CONFIG.glass && typeof CONFIG.glass === 'object' ? CONFIG.glass : {};
      let v = raw[key];
      if (v === null || v === undefined) {
        /* tint 没显式给 → 取通透度档位 */
        if (key === 'tint') {
          const tier = String(CONFIG.glassTier ?? 'regular');
          v = GLASS_TIERS[tier] ?? GLASS_TIERS.regular;
        } else {
          return fallback;
        }
      }
      return v;
    }

    /**
     * 取某一档玻璃配置。
     *
     * `alpha` 写 null（或不写）= **档位值 × 该区域倍数**；
     * 写数字 = 该区域单独指定，不受档位影响。
     * `frost` 写 null = 用规格模糊半径（18px）。
     * 老配置把整档写成数字也照样认（向后兼容）。
     */
    function layer(name, fallbackAlpha) {
      const raw = CONFIG[name];
      const obj = raw && typeof raw === 'object' ? raw : {};
      const pick = (v, spec, fb) => {
        if (v === null || v === undefined) {
          if (typeof raw === 'number') return raw;      // 老写法：整档就是一个数字
          return g(spec, fb);
        }
        return v;
      };
      let alpha = obj.alpha;
      if (alpha === null || alpha === undefined) {
        // 档位值 × 区域倍数
        const mult = REGION_MULT[name] ?? 5;
        alpha = clamp01(num(g('tint', 0.03), 0.03) * mult);
      }
      return {
        alpha: clamp01(pick(alpha, 'tint', fallbackAlpha)),
        frost: num(pick(obj.frost, 'blur', 18), 18),
      };
    }

    /**
     * DSH 背景令牌的**参考默认值**。
     * 实际生效的透明度由 CONFIG 各档决定（见 buildBaseCss），
     * 这里只用于「读不到令牌时」的兜底颜色。
     */
    const TOKEN_ALPHAS = {
      '--dsw-alias-bg-layer-1': 0.86,
      '--dsw-alias-bg-layer-2': 0.74,
      '--dsw-alias-bg-overlay': 0.96,
      '--dsw-specific-sidebar-fill': 0.84,
    };

    /**
     * 读当前主题。
     * 先把自己的样式摘掉再读，否则读到的会是自己上一次写进去的值。
     *
     * 除了判断明暗，还要**记下这些令牌的原始颜色** —— 后面只把它们变半透明，
     * 颜色沿用应用自己的，这样浅色/深色主题都不会压掉文字对比度。
     */
    function readTheme() {
      const mine = document.getElementById(STYLE_ID_DYN);
      const parent = mine ? mine.parentNode : null;
      const out = { base: null, dark: true, raw: '', tokens: {} };
      try {
        if (mine && parent) parent.removeChild(mine);
        const read = (name) => {
          let v = getComputedStyle(document.documentElement).getPropertyValue(name);
          if (!String(v).trim()) v = getComputedStyle(document.body).getPropertyValue(name);
          return String(v).trim();
        };
        /* 品牌蓝要用它做基准（只换色相，保住主题的明度） */
        const labelRgb = parseColor(read('--dsw-alias-label-primary'));
        if (labelRgb) out.tokens['--dsw-alias-label-primary'] = labelRgb;
        for (const name of Object.keys(TOKEN_ALPHAS)) {
          const rgb = parseColor(read(name));
          if (rgb) out.tokens[name] = rgb;
        }
        const baseRaw = read('--dsw-alias-bg-base');
        const labelRaw = read('--dsw-alias-label-primary');
        out.raw = baseRaw;
        out.base = parseColor(baseRaw);
        const label = parseColor(labelRaw);
        if (out.base) {
          out.dark = (0.2126 * out.base.r + 0.7152 * out.base.g + 0.0722 * out.base.b) / 255 < 0.5;
        } else if (label) {
          out.dark = (0.2126 * label.r + 0.7152 * label.g + 0.0722 * label.b) / 255 > 0.5;
        }
      } catch (error) {
        out.error = String(error && error.message);
      } finally {
        if (mine && parent) parent.appendChild(mine);
      }
      return out;
    }

    function rgbaOf(rgb, alpha) {
      const a = Math.max(0, Math.min(1, Number(alpha)));
      return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${Number.isFinite(a) ? a : 1})`;
    }

    /**
     * 把颜色换成指定色相（保留明度/饱和度），用来做品牌蓝。
     * 为什么要换算而不是直接写死 #4d6bfe：
     * 深浅主题下品牌字与 logo 的明度本来就不同，写死会一边糊一边飘。
     * 只换色相 → 深浅主题各自保持自己的对比度，观感却统一成蓝色。
     */
    function toHue(c, hue) {
      const r = c.r / 255; const gg = c.g / 255; const b = c.b / 255;
      const max = Math.max(r, gg, b); const min = Math.min(r, gg, b);
      const l = (max + min) / 2;
      const d = max - min;
      /* 源色近中性（白/灰）时饱和度≈0，只换色相等于换了个白 ——
         所以设一个饱和度下限，让品牌蓝在任何主题下都真的蓝。 */
      const rawSat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
      const sat = Math.max(rawSat, 0.55);
      const h = Number(hue) / 360;
      const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat;
      const p = 2 * l - q;
      const f = (t0) => {
        let t = t0;
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      };
      return {
        r: Math.round(f(h + 1 / 3) * 255),
        g: Math.round(f(h) * 255),
        b: Math.round(f(h - 1 / 3) * 255),
      };
    }

    /** CSS 字符串里的 rgb 三连（"77, 107, 254"）按给定色相重算。 */
    function hueShiftCssLinear(value, hue) {
      return String(value).replace(
        /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)([^)]*)\)/g,
        (all, r, gg, b, rest) => {
          const c = toHue({ r: +r, g: +gg, b: +b }, hue);
          return `rgba(${c.r}, ${c.g}, ${c.b}${rest})`;
        },
      );
    }

    /**
     * 左上角品牌区的玻璃参数。
     *
     * 叠加两层蓝色：一层径向做「液态」的体积感，一层线性做上亮下暗。
     * 色相由 CONFIG.brand.hue 定，明度由主题的 label-primary 派生 ——
     * 于是深色主题是「浅蓝玻璃字」，浅色主题是「深蓝玻璃字」。
     */
    function buildBrandVars(theme) {
      const cfg = CONFIG.brand && typeof CONFIG.brand === 'object' ? CONFIG.brand : {};
      const alpha = clamp01(cfg.alpha === undefined ? 0.42 : cfg.alpha);
      /* 配色写死成规格值，不再从主题推 —— 用户要「浅蓝底 + 深蓝字标」，
         主题推导会在深色模式下把底变成近白，反而不符合要求。 */
      const blue = cfg.base ?? { r: 191, g: 219, b: 254 };
      const ink = cfg.ink ?? { r: 30, g: 64, b: 175 };
      const inkStr = `${ink.r}, ${ink.g}, ${ink.b}`;
      const blueStr = `${blue.r}, ${blue.g}, ${blue.b}`;
      const blur = num(layer('sidebarGlass', 0.12).frost, 18);
      const sat = num(g('saturate', 1.6), 1.6);
      const edgeRefract = num(g('edgeRefract', 10), 10);
      const filter =
        edgeRefract > 0
          ? `blur(${blur}px) saturate(${sat}) url(#${FILTER_REF})`
          : `blur(${blur}px) saturate(${sat})`;
      return `--dshlg-brand-ink: ${inkStr};
  -dshlg-brand-tone: ${blueStr};
  --dshlg-brand-a: ${alpha};
  --dshlg-brand-filter: ${alpha > 0 ? filter : 'none'};`.replace('-dshlg-brand-tone', '--dshlg-brand-tone');
    }

    /** 计算值是不是「透明」（空串 / transparent / none / rgba(...,0)）。 */
    function isClear(v) {
      const s = String(v ?? '').trim().toLowerCase();
      if (!s || s === 'transparent' || s === 'none' || s === 'rgba(0, 0, 0, 0)') return true;
      const m = /rgba?\(([^)]*)\)/.exec(s);
      if (m) {
        const parts = m[1].split(/[,/\s]+/).filter(Boolean);
        if (parts.length >= 4) return Number(parts[3]) === 0;
      }
      return false;
    }

    /* ── SVG 折射滤镜（只弯折边缘一圈）───────────────────── */

    /**
     * 建「边缘透镜」滤镜；已存在时只更新强度与边缘带宽。
     *
     * 为什么必须有 mask：`backdrop-filter` 里的 SVG 滤镜是**整面**生效的，
     * 直接挂 feDisplacementMap 会把整块玻璃扭成毛玻璃汤 —— 那不是 iOS。
     * iOS 26 的做法是**只有边缘 10~15% 宽度**向内折射，中间保持清晰，
     * 于是用一张「外圈白、内部黑」的 mask 去限制位移图：
     *   · mask 用 objectBoundingBox（默认）→ 每块面按自己的尺寸缩放，
     *     侧栏与审批卡拿到的是同一条**相对厚度**的边；
     *   · 外圈白只给 35% 不透明度：feDisplacementMap 对 0.5 灰就取满幅位移，
     *     不压亮度边缘会扭过头。
     */
    function ensureFilter(scale) {
      const band = edgeBandPct(g('edgeWidth', 0.12));
      const mid = band * 0.5;
      const inner = band * 1.05;
      const existing = document.getElementById(SVG_ID);
      if (existing) {
        const disp = existing.querySelector('feDisplacementMap');
        if (disp) disp.setAttribute('scale', String(num(scale, 0)));
        const mask = existing.querySelector('mask');
        if (mask) {
          const stops = mask.querySelectorAll('stop');
          if (stops[1]) stops[1].setAttribute('offset', `${mid.toFixed(1)}%`);
          if (stops[2]) stops[2].setAttribute('offset', `${inner.toFixed(1)}%`);
        }
        return;
      }
      const NS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('id', SVG_ID);
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('width', '0');
      svg.setAttribute('height', '0');
      svg.style.cssText =
        'position:fixed;left:0;top:0;width:0;height:0;overflow:hidden;pointer-events:none';

      // ① 边缘掩码：外圈亮、内部黑（stop 的透明度由 CSS 里的 .stop-* 给）
      const mask = document.createElementNS(NS, 'mask');
      mask.setAttribute('id', `${FILTER_REF}-edge`);
      mask.setAttribute('x', '-20%');
      mask.setAttribute('y', '-20%');
      mask.setAttribute('width', '140%');
      mask.setAttribute('height', '140%');
      const mkStop = (offset, cls) => {
        const s = document.createElementNS(NS, 'stop');
        s.setAttribute('offset', offset);
        s.setAttribute('class', cls);
        return s;
      };
      const grad = document.createElementNS(NS, 'radialGradient');
      grad.setAttribute('id', `${FILTER_REF}-edge-grad`);
      grad.appendChild(mkStop('0%', 'stop-outer'));
      grad.appendChild(mkStop(`${mid.toFixed(1)}%`, 'stop-mid'));
      grad.appendChild(mkStop(`${inner.toFixed(1)}%`, 'stop-inner'));
      grad.appendChild(mkStop('100%', 'stop-inner'));
      const defs = document.createElementNS(NS, 'defs');
      defs.appendChild(grad);
      svg.appendChild(defs);
      const rect = document.createElementNS(NS, 'rect');
      rect.setAttribute('x', '-20%');
      rect.setAttribute('y', '-20%');
      rect.setAttribute('width', '140%');
      rect.setAttribute('height', '140%');
      rect.setAttribute('fill', `url(#${FILTER_REF}-edge-grad)`);
      mask.appendChild(rect);
      svg.appendChild(mask);

      // ② 滤镜：噪声 → 柔化 → 位移（位移图被 mask 限制在边缘）
      const filter = document.createElementNS(NS, 'filter');
      filter.setAttribute('id', FILTER_REF);
      // 滤镜区域放大，避免折射把边缘推出可视范围
      filter.setAttribute('x', '-20%');
      filter.setAttribute('y', '-20%');
      filter.setAttribute('width', '140%');
      filter.setAttribute('height', '140%');
      filter.setAttribute('color-interpolation-filters', 'sRGB');
      filter.setAttribute('mask', `url(#${FILTER_REF}-edge)`);

      const turb = document.createElementNS(NS, 'feTurbulence');
      turb.setAttribute('type', 'fractalNoise');
      turb.setAttribute('baseFrequency', '0.006 0.009');
      turb.setAttribute('numOctaves', '2');
      turb.setAttribute('seed', '7');
      turb.setAttribute('result', 'noise');

      const soft = document.createElementNS(NS, 'feGaussianBlur');
      soft.setAttribute('in', 'noise');
      soft.setAttribute('stdDeviation', '3');
      soft.setAttribute('result', 'soft');

      const disp = document.createElementNS(NS, 'feDisplacementMap');
      disp.setAttribute('in', 'SourceGraphic');
      disp.setAttribute('in2', 'soft');
      disp.setAttribute('scale', String(num(scale, 0)));
      disp.setAttribute('xChannelSelector', 'R');
      disp.setAttribute('yChannelSelector', 'G');

      filter.appendChild(turb);
      filter.appendChild(soft);
      filter.appendChild(disp);
      svg.appendChild(filter);
      document.body.appendChild(svg);
    }

    /* ── DOM 探测 ───────────────────────────────────────── */

    /** 圆角是否 >= min（读计算值，兼容 px / 百分比）。 */
    function radiusOf(el) {
      const cs = getComputedStyle(el);
      const v = cs.borderTopLeftRadius || '0';
      const n = Number.parseFloat(v);
      return Number.isFinite(n) ? n : 0;
    }

    /** 元素在 DOM 里的深度（越浅越靠近 #root）。 */
    function depthOf(el) {
      let d = 0;
      for (let n = el; n; n = n.parentElement) d++;
      return d;
    }

    /** 尺寸描述，用来在报告里核对几何判据。 */
    function rectOf(el) {
      if (!el || !el.getBoundingClientRect) return null;
      const r = el.getBoundingClientRect();
      return {
        w: Math.round(r.width),
        h: Math.round(r.height),
        left: Math.round(r.left),
        right: Math.round(r.right),
      };
    }

    /**
     * 找左侧那一栏「会话工作区」。
     *
     * 为什么不按类名找：DSH 的类名是哈希的（`LdtX1G_xxx`），而且每次构建都会变，
     * 拿它当选择器一次升级就废。也不按结构猜（`root.children[0].children[0]`
     * 这种），布局一改就错。
     *
     * 所以用**几何特征**，它由「左侧整列」这个事实本身决定：
     *   · 左边缘贴着 x=0
     *   · 高度接近整个视口
     *   · 宽度是一栏的量级（不是整个窗口，也不是一根分隔线）
     *   · 里面有若干个按钮（会话列表、设置入口…）
     * 满足这些的**最外层**元素就是它。
     */
    function findLeftColumn(root, vw, vh) {
      /* ① 语义钩子优先：ui-sidebar 的根容器类名是 <hash>_root，
         它一定包着 logoRow / panelList / regionArea 这些稳定后缀。 */
      const inner = root.querySelector('[class*="_logoRow"]')
        ?? root.querySelector('[class*="_panelList"]')
        ?? root.querySelector('[class*="_regionArea"]');
      if (inner) {
        const outer = inner.closest('[class*="_root"]') ?? inner.parentElement;
        if (outer && outer.getBoundingClientRect().width >= 40) return outer;
      }

      /* ② 几何兜底（DSH 换结构时用）：左缘贴视口、近满高、一栏宽、内含 ≥2 个按钮 */
      const maxWidth = Math.min(520, vw * 0.45);
      let best = null;
      let bestDepth = Infinity;

      for (const el of root.querySelectorAll('*')) {
        const r = el.getBoundingClientRect();
        if (r.width < 44 || r.width > maxWidth) continue;
        if (r.height < vh * 0.75) continue;
        if (r.left > 4) continue;
        if (el.querySelectorAll('button').length < 2) continue;
        const d = depthOf(el);
        if (d < bestDepth) {
          bestDepth = d;
          best = el;
        }
      }
      return best;
    }

    /**
     * 找右侧栏（会话面板）。
     *
     * 它的结构是：右栏轨道（rightbarCol）里放一个 `position:absolute; right:0`
     * 的面板，面板**宽度可以超出轨道**（所以轨道本身不能套玻璃，否则只有窄窄一条）。
     *
     * 判据（同样只看几何 + 结构事实）：
     *   · 贴着视口右边缘
     *   · 高度接近整个视口
     *   · 宽度 ≥ 240px 且 ≤ 视口 70%
     *   · 里面**有东西**（按钮 / 文本 / 滚动容器），空的轨道不算
     * 取最外层那个。
     */
    function findRightPanel(root, frame, vw, vh) {
      const maxWidth = vw * 0.7 + 8;
      const container = frame ?? root;
      let best = null;
      let bestDepth = Infinity;

      for (const el of container.querySelectorAll('*')) {
        if (el === frame) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 240 || r.width > maxWidth) continue;
        if (r.height < vh * 0.75) continue;
        if (Math.abs(r.right - vw) > 6) continue;
        const text = (el.textContent ?? '').trim();
        if (el.querySelectorAll('button, input, textarea, a[href]').length === 0 && text.length < 8) {
          continue;
        }
        const d = depthOf(el);
        if (d < bestDepth) {
          bestDepth = d;
          best = el;
        }
      }
      return best;
    }

    /**
     * 找右栏面板本体（DSH 的 SidebarRight `.panel`）。
     *
     * 它自己发布了稳定钩子（源码实测）：
     *   `data-sidebar-right-session="<id>"`
     *   `data-sidebar-right-panel="push|fullscreen"`
     *   `data-sidebar-right-open`          ← **只在展开时才有**
     *   `aria-hidden="true"`               ← 收起的另一面
     * 这些比几何判据硬得多，所以优先用它们。
     */
    function resolveRightPanel(root, frame) {
      const container = frame ?? root ?? document;
      const hooked = container.querySelectorAll('[data-sidebar-right-session]');
      if (hooked.length > 0) {
        /* 一个页面里可能有多个 session 面板（历史会话各留一个），
           必须挑**开着的那个**，否则会拿到一个收起的、把开着的那块也判成收起。
           代价只有一次遍历，收益是省掉一整类误判。 */
        for (const el of hooked) {
          if (el.hasAttribute('data-sidebar-right-open')) return el;
        }
        return hooked[hooked.length - 1];
      }
      return container.querySelector('[data-sidebar-right-panel]');
    }

    /**
     * 右栏轨道里「真正画出内容」的那一层。
     *
     * 两种情况都要覆盖：
     *   · 面板是绝对定位、比轨道更宽（能露到轨道外面）→ 按右边缘贴视口找；
     *   · 面板就在轨道里、宽度等于轨道（真实 DSH 的 .LdcXKW_panel 也是这样，
     *     它 top/bottom:0、right:0）→ 找轨道里「铺满轨道且有内容」的最外层。
     *
     * 为什么非要往里找一层：轨道（网格列）本身没内容，
     * 把玻璃糊在轨道上，等于只糊了一条空带子。
     */
    function findPanelInsideColumn(col, vw, vh) {
      const track = col.getBoundingClientRect();
      let wide = null;
      let filling = null;
      for (const el of col.querySelectorAll('*')) {
        const r = el.getBoundingClientRect();
        if (r.width < 240 || r.height < vh * 0.6) continue;
        // A) 比轨道宽、右边缘贴视口 → 绝对定位的浮层面板
        if (
          r.width <= vw * 0.7 + 8 &&
          r.width > track.width + 8 &&
          Math.abs(r.right - vw) <= 6
        ) {
          if (!wide || depthOf(el) < depthOf(wide)) wide = el;
          continue;
        }
        // B) 铺满轨道、且自己有内容 → 轨道内的面板本体
        if (
          Math.abs(r.width - track.width) <= 6 &&
          Math.abs(r.height - track.height) <= 6 &&
          el.querySelectorAll('button, input, textarea, a[href], [class*="_file"], [class*="_row"]').length > 0
        ) {
          if (!filling || depthOf(el) < depthOf(filling)) filling = el;
        }
      }
      return wide ?? filling;
    }

    /**
     * 右栏面板「现在是不是真的打开着」。
     *
     * ⚠️ 这里必须**属性优先**，不能靠几何：
     *   · DSH 收起是把面板滑出视口，且 `transform` 作用在**子元素**
     *     （`[data-dockkit-host]` 上），面板自己的 rect **不会变**；
     *   · 面板自己的 `visibility` 也可能是 visible（隐藏落在子元素上）。
     *     实测源码：`.LdcXKW_panel [data-dockkit-host]{visibility:hidden;transform:translateX(...)}`
     * 所以只要「面板自己没有 data-sidebar-right-open」就先倾向收起，
     * 再拿「dock 子元素是否真的出现在视口里」兜底。
     */
    function isOpenPanel(panel) {
      if (!panel) return false;
      try {
        /* ① DSH 自己发布的开关：展开时才有这个属性（源码实测） */
        const owner = panel.closest('[data-sidebar-right-session]') ?? panel;
        const hasOpenAttr = owner.hasAttribute('data-sidebar-right-open');
        if (!hasOpenAttr) return false;

        /* ② 面板自己都不显示 → 收起 */
        const cs = getComputedStyle(panel);
        if (cs.display === 'none') return false;

        /* ③ dock 子元素是不是真的出现在视口里
              （隐藏/位移都落在它们身上，所以这里才是可信的几何） */
        const vw = window.innerWidth;
        const hosts = panel.querySelectorAll('[data-dockkit-host], [data-dockkit-pane], [data-dockkit-float]');
        for (const h of hosts) {
          const hcs = getComputedStyle(h);
          if (hcs.display === 'none' || hcs.visibility === 'hidden') continue;
          const hr = h.getBoundingClientRect();
          if (hr.width < 1 || hr.height < 1) continue;
          if (hr.right <= 1 || hr.left >= vw - 1) continue;
          return true;
        }
        /* ④ 一个 dock 子元素都没有（空面板）：只要它在视口内就算开着 */
        const r = panel.getBoundingClientRect();
        return r.width > 1 && r.right > 1 && r.left < vw - 1;
      } catch {
        return false;
      }
    }

    /**
     * 右栏整体是否处于「已收起」。
     *
     * 为什么不只用 isOpenPanel(某一块面)：探测有可能选到轨道而不是面板本体，
     * 那时 isOpenPanel 会答「收起」，而**真正还开着的那块面板**却保留着玻璃。
     * 所以这里独立判一次：只要容器里存在任何一个**开着**的 session 面板，
     * 右栏就算开着；一个都没有，就整列按收起处理。
     * 这样无论探测选中的是哪一层，收起后都不会留下玻璃。
     */
    function rightColumnCollapsed(container, fallbackSurface) {
      if (!container) return !isOpenPanel(fallbackSurface);
      const panels = container.querySelectorAll('[data-sidebar-right-session]');
      if (panels.length > 0) {
        for (const p of panels) {
          if (isOpenPanel(p)) return false;   // 有一个开着 → 整列算开着
        }
        return true;                          // 全收起 → 整列收起
      }
      return !isOpenPanel(fallbackSurface);
    }

    /**
     * 给一个元素套玻璃前，先找一个更合适的宿主。
     *
     * `backdrop-filter` 只作用于**自己身后的背景**，对后代无效：
     *   · 如果宿主自己背景不透明 → 后代其实压在这块不透明底上，玻璃等于没用；
     *   · 如果宿主是纯布局容器（背景透明）→ 直接套在上面，让玻璃盖住整个子树。
     * 所以「有底色就地用，没底色往上顶一层」。
     *
     * @param stop 到这一层就绝不再往上（一般是整帧，别把整个界面糊掉）
     * @param bounds 只许在这些祖先里找（空 = 从 el 到 stop 都行）。
     *   传入 [container] 就等于「就地用，不许爬出去」——
     *   右栏面板、审批卡面都用这个，因为它们本身就是要糊的那块面。
     */
    function hostFor(el, stop, maxUp = 3, bounds = null) {
      if (!el || !el.ownerDocument) return el;
      const frame = stop ?? null;
      const base = el.getBoundingClientRect();
      let node = el;
      for (let i = 0; i < maxUp; i++) {
        const bg = getComputedStyle(node).backgroundColor;
        if (!isClear(bg)) return node;                 // 自己有底色 → 就地套
        const parent = node.parentElement;
        if (!parent || parent === document.body || parent === document.documentElement) return node;
        if (frame && parent === frame) return node;    // 别把整帧吃掉
        if (bounds && !bounds.includes(parent)) return node;  // 越界了 → 就地套
        const pr = parent.getBoundingClientRect();
        // 父节点明显比目标大（或者根本不是一块面）→ 顶上去就把别的区域也糊了
        if (pr.width > base.width * 1.6 || pr.height > base.height * 1.2) return node;
        if (parent.querySelectorAll('button, input, textarea, a[href]').length > 80) return node;
        node = parent;
      }
      return node;
    }

    /**
     * 找模态层 / 模态卡。
     *
     * 两种形态都要认：
     *   · 外层「遮罩容器」自己带 backdrop-filter（DSH 的 Modal.root 就是这种）
     *       → 返回它，调用方再往里找 .dialog；
     *   · 遮罩只是个普通全屏层、模糊在 mask 兄弟节点上
     *       → 直接找 role=dialog / 类名含 dialog 的那张卡，就地糊它。
     *
     * 判据放宽到「近全屏 + fixed/absolute + 有模糊」，是因为
     * 不同 DSH 版本把 backdrop-filter 放在 root 还是 mask 上并不固定，
     * 按老写法（要求 display:flex + z-index≥100 + 自己带模糊）会整片漏掉。
     */
    function findModalCandidate(root, vw, vh) {
      let outer = null;
      for (const el of root.querySelectorAll('*')) {
        const cs = getComputedStyle(el);
        if (cs.position !== 'fixed' && cs.position !== 'absolute') continue;
        const r = el.getBoundingClientRect();
        if (r.width < vw * 0.85 || r.height < vh * 0.85) continue;
        const blurry = !isClear(cs.backdropFilter) || !isClear(cs.webkitBackdropFilter);
        if (!blurry) continue;
        if (outer === null || depthOf(el) < depthOf(outer)) outer = el;
      }
      if (outer) {
        const dialog = outer.querySelector('[role="dialog"], [class*="_dialog"]');
        if (dialog) return dialog;
      }
      // 兜底：直接找可见的对话框卡片（不管遮罩长什么样）
      let dialog = null;
      for (const el of root.querySelectorAll('[role="dialog"], [class*="_dialog"]')) {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const r = el.getBoundingClientRect();
        if (r.width < 200 || r.height < 80) continue;
        if (dialog === null || depthOf(el) < depthOf(dialog)) dialog = el;
      }
      return outer ?? dialog;
    }

    function discover() {
      const out = {
        editor: null, composer: null, toolbar: null,
        sidebar: null, right: null, approval: null, modal: null,
        notes: [],
      };

      const root = document.getElementById('root') ?? document.body;
      const frame = root.querySelector('[class*="_frame"]') ?? root;
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      // 1) 消息输入框
      const editor =
        document.querySelector('[contenteditable="true"]') ||
        document.querySelector('[contenteditable=""]') ||
        document.querySelector('textarea') ||
        /* ProseMirror / 富文本编辑器的常见落点 */
        root.querySelector('[class*="_editor"]') ||
        root.querySelector('[class*="_composer"] [contenteditable]') ||
        null;
      out.editor = editor;
      if (!editor) {
        out.notes.push('没找到输入框（[contenteditable] / textarea）');
      }

      // 2) 聊天框卡片：从输入框往上，找「圆角 >= 4 且内部至少 2 个按钮」的最近祖先
      if (editor) {
        let node = editor.parentElement;
        for (let depth = 0; node && depth < 10; depth++, node = node.parentElement) {
          if (node === document.body || node === document.documentElement) break;
          const buttons = node.querySelectorAll('button').length;
          if (radiusOf(node) >= 4 && buttons >= 2) {
            out.composer = node;
            out.notes.push(`聊天框：向上 ${depth + 1} 层命中（按钮 ${buttons} 个）`);
            break;
          }
        }
        if (!out.composer) {
          out.composer = editor.parentElement;
          out.notes.push('聊天框：未命中理想判据，回落到输入框的直接父节点');
        }
      }

      // 3) 工具栏：卡片范围内「含 >=2 个按钮、且不含输入框」的最外层元素
      const scope = out.composer ?? editor?.parentElement ?? null;
      if (scope && editor) {
        const all = Array.from(scope.querySelectorAll('*'));
        const candidates = all.filter((el) => {
          if (el.contains(editor)) return false;      // 排除整个卡片
          if (el.querySelectorAll('button').length < 2) return false;
          return true;
        });
        out.toolbar = candidates.find((el) => !candidates.some((o) => o !== el && o.contains(el))) ?? null;
        if (out.toolbar) out.notes.push(`工具栏：在聊天框内找到（按钮 ${out.toolbar.querySelectorAll('button').length} 个）`);
        else out.notes.push('工具栏：聊天框内没找到按钮行');
      }

      // 4) 左侧会话工作区
      if (CONFIG.sidebar) {
        out.sidebar = findLeftColumn(root, vw, vh);
        if (out.sidebar) {
          const r = rectOf(out.sidebar);
          out.notes.push(
            `左栏：几何命中（${r.w}×${r.h}，按钮 ${out.sidebar.querySelectorAll('button').length} 个）`,
          );
        } else {
          out.notes.push('左栏：几何判据没命中（窗口太窄？或布局不是左右分栏）');
        }
      }

      // 5) 右侧栏
      if (CONFIG.right) {
        // 先认 DSH 自己发布的钩子（data-sidebar-right-*），命不中再用几何兜底
        const hooked = resolveRightPanel(root, frame);
        if (hooked) {
          const open = isOpenPanel(hooked);
          const r = rectOf(hooked);
          out.right = hooked;
          out.rightOpen = open;
          out.rightVia = 'hook';
          out.notes.push(
            `右栏：钩子命中 data-sidebar-right-session（${r.w}×${r.h}）→ ${open ? '展开' : '收起'}`,
          );
        } else {
          const geo = findRightPanel(root, frame, vw, vh);
          out.right = geo;
          out.rightOpen = geo ? isOpenPanel(geo) : false;
          out.rightVia = geo ? 'geometry' : null;
          out.notes.push(
            geo
              ? `右栏：几何命中（${rectOf(geo).w}×${rectOf(geo).h}）→ ${out.rightOpen ? '展开' : '收起'}`
              : '右栏：钩子与几何都没命中（窗口太窄？右栏没打开？）',
          );
        }
      }

      // 6) 审批卡 / 模态弹窗
      if (CONFIG.approval) {
        // 几何宿主是整块「composer takeover」容器，但**有内容的是里面那张卡**
        // （圆角 + 描边 + 文字都在卡上），所以玻璃要贴在卡上，
        // 不能让卡里的字压在壁纸上。
        const approvalRoot = document.querySelector('[data-approval-key]') ?? null;
        out.approval = approvalRoot ? (approvalRoot.querySelector('[class*="_card"]') ?? approvalRoot) : null;
        if (out.approval) {
          out.notes.push(
            `审批卡：命中 [data-approval-key]${out.approval !== approvalRoot ? ' → 卡面' : '（找不到卡面，用容器兜底）'}`,
          );
        }
      }
      if (CONFIG.modal) {
        out.modal = findModalCandidate(root, vw, vh);
        if (out.modal) {
          out.notes.push(`弹窗：命中「${(out.modal.className || out.modal.tagName).toString().slice(0, 40)}」`);
        }
      }

      return out;
    }

    /** 打标记；返回是否新打上。 */
    function tag(el, cls) {
      if (!el || !(el instanceof Element)) return false;
      if (el.classList.contains(cls)) return false;
      el.classList.add(cls);
      el.dataset.dshlg = cls;
      return true;
    }

    function untagAll() {
      document.querySelectorAll('[data-dshlg]').forEach((el) => {
        el.classList.remove(CLS_GLASS, CLS_TOOLBAR, CLS_SIDE, CLS_RIGHT, CLS_APPROVAL, CLS_MODAL);
        delete el.dataset.dshlg;
      });
      document.querySelectorAll('[data-dshlg-closed]').forEach((el) => {
        delete el.dataset.dshlgClosed;
      });
    }

    /* ── 背景层（给玻璃一点可折射的东西）───────────────── */

    function buildBackdrop(theme) {
      if (!CONFIG.backdrop) return '';
      const base = theme.base ?? { r: 13, g: 17, b: 23 };
      // 色斑用「明暗两套」固定色调，而不是从底色推 —— 推算出来的太接近底色，
      // 玻璃等于没有东西可折射（这正是第一版看起来"没效果"的原因）。
      const palette = theme.dark
        ? ['#1d3fa8', '#5b1f96', '#0e6b60']
        : ['#b9d2ff', '#ffc9e2', '#bdf0e6'];
      const [c1, c2, c3] = palette.map(parseColor);
      const blobOpacity = theme.dark ? 0.72 : 0.9;

      return `
#${BG_ID} {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background: ${toHex(base)};
  overflow: hidden;
}
#${BG_ID} i {
  position: absolute;
  width: 80vmax;
  height: 80vmax;
  border-radius: 50%;
  filter: blur(16vmax);
  opacity: ${blobOpacity};
  mix-blend-mode: ${theme.dark ? 'screen' : 'normal'};
}
#${BG_ID} i:nth-child(1) { background: radial-gradient(circle, ${toHex(c1)} 0%, transparent 68%); animation: dshlg-a 58s ease-in-out infinite; }
#${BG_ID} i:nth-child(2) { background: radial-gradient(circle, ${toHex(c2)} 0%, transparent 68%); animation: dshlg-b 74s ease-in-out infinite; }
#${BG_ID} i:nth-child(3) { background: radial-gradient(circle, ${toHex(c3)} 0%, transparent 68%); animation: dshlg-c 92s ease-in-out infinite; }
@keyframes dshlg-a { 0%,100% { transform: translate(-24%,-18%) } 50% { transform: translate(12%,16%) } }
@keyframes dshlg-b { 0%,100% { transform: translate(56%,10%) } 50% { transform: translate(16%,-22%) } }
@keyframes dshlg-c { 0%,100% { transform: translate(6%,54%) } 50% { transform: translate(50%,24%) } }
@media (prefers-reduced-motion: reduce) { #${BG_ID} i { animation: none } }
`;
    }

    function ensureBackdrop(theme) {
      if (!CONFIG.backdrop) return;
      let el = document.getElementById(BG_ID);
      if (!el) {
        el = document.createElement('div');
        el.id = BG_ID;
        el.setAttribute('aria-hidden', 'true');
        el.innerHTML = '<i></i><i></i><i></i>';
        document.body.prepend(el);
      }
      const want = theme.dark ? 'dark' : 'light';
      // 只在真的变了才写：这个属性也是 <body> 上的变动，会惊动我们自己的 observer
      if (el.dataset.theme !== want) el.dataset.theme = want;
    }

    /**
     * 移除内置背景层。
     *
     * ⚠️ 必须先判存在再删。`?.remove()` 对**不存在的节点**也是安全的，
     * 但它在旧实现里每遍都会被调用 —— 而 `ChildList` 型 MutationObserver
     * 连「删除一个不存在的节点」这种空操作都不会触发，真正的问题在别处：
     * 一旦这个节点在两种状态间反复创建/删除，observer 就会互相触发形成churn。
     * 所以这里保持「不存在就什么都不做」的语义，并且调用方也只在需要时调。
     */
    function removeBackdrop() {
      const el = document.getElementById(BG_ID);
      if (el) el.remove();
    }

    /* ── 基础样式：透明化 + 令牌 + 内容块底色 ───────────── */

    /**
     * 应用自身底色透明化 + 把 DSH 的背景令牌改成（半）透明。
     *
     * 不管用不用壁纸都必须有这一段 —— 否则应用是不透明的，
     * 壁纸看不见、玻璃也没东西可折射。
     *
     * 令牌**沿用应用自己的颜色**（readTheme 记下的原色），只改 alpha：
     * 浅色主题得浅色面板、深色主题得深色面板，
     * 文字对比度始终由应用自己的配色保证，不需要判断主题。
     */
    function buildBaseCss(theme) {
      const captured = theme?.tokens ?? {};
      const fallback = theme?.base ?? { r: 13, g: 17, b: 23 };
      const dark = theme?.dark !== false;

      const panel = clamp01(CONFIG.panelAlpha);
      const overlay = clamp01(CONFIG.overlayAlpha);

      /** 令牌取原色 + 指定透明度；全透明时直接输出 transparent，更干净。 */
      const tokenValue = (name, alpha) => {
        const a = Math.max(0, alpha);
        if (a <= 0) return 'transparent';
        return rgbaOf(captured[name] ?? fallback, a);
      };

      // 文字衬底阴影：跟随「实际文字色」而不是主题 ——
      // 强制白字时，浅色主题原本的白阴影会失效，必须反转成深色。
      const ts = clamp01(CONFIG.textShadow);
      const textColor = String(CONFIG.textColor ?? '').trim();
      const tcRgb = parseColor(textColor);
      // 文字偏亮 → 用黑阴影；文字偏暗 → 用白阴影
      const textIsLight = tcRgb
        ? (0.2126 * tcRgb.r + 0.7152 * tcRgb.g + 0.0722 * tcRgb.b) / 255 > 0.5
        : !dark;
      const shadowColor = (a) =>
        textIsLight ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${Math.min(1, a + 0.25)})`;
      const shadowCss =
        ts > 0
          ? `
/* 面板很透时，给文字加一层衬底 —— 压在壁纸上可读性会好很多。
   text-shadow 是可继承属性，写在 #root 上即可覆盖整棵树。
   阴影颜色跟着文字色走：白字配黑晕，深字配白晕。 */
#root {
  text-shadow: 0 1px 2px ${shadowColor(ts)},
               0 0 2px ${shadowColor(ts * 0.7)};
}
`
          : '';

      // 文字颜色覆盖
      let textCss = '';
      if (textColor) {
        const secondary = CONFIG.textColorSecondaryToo ? textColor : '';
        textCss = `
/* 强制文字颜色 */
html, body, #root {
  --dsw-alias-label-primary: ${textColor} !important;${secondary ? `\n  --dsw-alias-label-secondary: ${secondary} !important;` : ''}
}
${
  CONFIG.textColorAggressive
    ? `/* 连写死颜色的元素也一起覆盖（含子元素） */
#root, #root * { color: ${textColor} !important; }`
    : ''
}
`;
      }

      /* ── 清除背景块 ────────────────────────────────────────
       * 这是"不要白块"的主力，但**分层清**：
       *
       *   · 不透明底色一律清掉 → 壁纸才透得出来；
       *   · 内容块（对话卡片、代码块、工具调用框）另给一层**极淡的玻璃底**，
       *     否则文字直接压在壁纸上（v1.8 的老毛病）；
       *   · 侧栏 / 右栏 / 浮层 / 审批卡 的玻璃底**永不参与清理** —— 它们是
       *     靠本插件自己的 `data-dshlg` / `data-dshlg-region` 标记认出来的，
       *     下面用 :not() 排除。
       */
      const fill = String(CONFIG.contentFill ?? 'glass');
      const fillAlpha = clamp01(CONFIG.contentFillAlpha, 0.06);
      const keepList = ['[data-dshlg-keep]', '[data-dshlg]', '[data-dshlg-region]'];
      const notKeep = keepList.map((s) => `:not(${s})`).join('');

      let structural = '';
      let contentGlassCss = '';

      if (fill === 'glass' || fill === 'none') {
        structural = `
/* 清掉不透明底色（保留 background-image：图标与渐变不受影响）。
   !important 能压过元素上的内联 style="background-color:…"。
   下面 :not() 里那几类是本插件自己的玻璃面，绝不能清。 */
#root, #root *${notKeep} {
  background-color: transparent !important;
}
`;
        if (fill === 'glass') {
          contentGlassCss = `
/* 内容块补一层极淡的玻璃底：只清不铺的话，字会直接压在壁纸上。
   放在 html 上、用 :where() 保持零特异性 —— 任何组件自己的
   背景规则（哪怕只写 background:）都能压过它。 */
html {
  --dshlg-content-fill: rgba(255, 255, 255, ${dark ? fillAlpha : Math.min(1, fillAlpha + 0.1)});
}
:where(#root, #root *)${notKeep} {
  background-color: var(--dshlg-content-fill, transparent);
}
`;
        }
      } else {
        const depth = Math.max(0, Math.min(8, Number(CONFIG.clearBackgroundDepth) || 0));
        if (depth > 0) {
          const selectors = [];
          let sel = '#root';
          for (let i = 0; i < depth; i++) {
            sel += ' > *';
            selectors.push(sel);
          }
          structural = `
/* 逐层清掉容器底色（${depth} 层）—— 应对没走主题令牌、写死底色的容器 */
${selectors.join(',\n')} {
  background-color: transparent !important;
}
`;
        }
      }

      return `
html, body { background: transparent !important; background-color: transparent !important; }
#root { position: relative; z-index: 1; background: transparent !important; }
${structural}${contentGlassCss}${shadowCss}${textCss}
/* 半透明化 DSH 的背景令牌。!important 是关键：这些令牌是作为
   内联样式写在 body 上的，而内联样式优先级高于普通样式表规则。

   注意这里**不再**把层令牌做成全透明：中间工作区之所以能全透明，
   是因为它的底色本来就来自 bg-base（上一行直接置 transparent）；
   两侧栏另有自己的玻璃面（见 buildRegionCss），不靠令牌「透」。 */
html, body, #root {
  --dsw-alias-bg-base: transparent !important;
  --dsw-alias-bg-layer-1: ${tokenValue('--dsw-alias-bg-layer-1', panel)} !important;
  --dsw-alias-bg-layer-2: ${tokenValue('--dsw-alias-bg-layer-2', Math.max(0, panel - 0.08))} !important;
  --dsw-alias-bg-overlay: ${tokenValue('--dsw-alias-bg-overlay', overlay)} !important;
  --dsw-specific-sidebar-fill: ${tokenValue('--dsw-specific-sidebar-fill', Math.max(0, panel - 0.05))} !important;
}
`;
    }

    function buildWallpaperCss() {
      const w = CONFIG.wallpaper;
      return `
#${WALL_ID} {
  position: fixed;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
  background: #000;
  opacity: ${clamp01(w.opacity, 1)};
}
#${WALL_ID} iframe {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  ${num(w.blur) > 0 ? `filter: blur(${num(w.blur)}px);` : ''}
}
/* 压暗层：壁纸太亮会影响读字 */
#${WALL_ID}::after {
  content: '';
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, ${clamp01(w.dim)});
}
`;
    }

    /* ── 分层玻璃 CSS（iOS 26 Liquid Glass）─────────────── */

    /** 边缘带占短边的比例 → 让透镜感在「细边」上也是同一段厚度。 */
    function edgeBandPct(widthRatio) {
      const ratio = Math.max(0.03, Math.min(0.45, num(widthRatio, 0.12)));
      return Math.max(3, Math.min(45, ratio * 200));   // 长边 / 短边 = 2 倍关系
    }

    /**
     * 边缘透镜让位：折射滤镜的变量（全局一份）。
     *
     * 只弯折**边缘一圈**，中间不扭：
     *   · feTurbulence 造噪声 → feGaussianBlur 柔化 → feDisplacementMap 位移像素
     *   · 位移图用 `<mask>` 裁成「外圈亮、内部黑」，并且把外圈亮度调低（约 35%）
     *     —— 因为 feDisplacementMap 对 0.5 灰就取 1.0 的位移量（0.5 灰 = 满幅），
     *     不压亮度的话边缘会扭得过分。
     *   · maskUnits=objectBoundingBox：掩码跟着**每块面自己的尺寸**缩放，
     *     所以侧栏（整列）与审批卡（小卡片）拿到的是同一条相对厚度的透镜边。
     *
     * 不支持 backdrop-filter 里用 SVG 滤镜时，CSS 里的兜底声明（纯 blur）仍然生效。
     */
    /**
     * 关键材质兜底（**内联、永远在**）。
     *
     * 为什么要有这一层：styles.css 是外置文件，加载可能失败 ——
     * 实测 `file://` 页面下 `<link>` 会被当成跨源请求直接拦掉
     * （file:// 是不透明源），于是整份材质都不生效，玻璃只剩一层白纱。
     * 所以这里内联最关键的十几条：玻璃/模糊、收起透明、中栏透明、
     * 高光与圆角。它保证「无论 styles.css 在不在，界面都是对的」。
     * styles.css 里的完整版会在加载成功后覆盖这些（同选择器、更靠后）。
     */
    /** styles.css 只尝试加载一次 */
    let styleLoadTried = false;

    const CRITICAL_CSS = `
/* 一块玻璃面：底色 + 模糊 + 描边 + 顶光（细节在 styles.css）
   ⚠️ 必须带 #root 前缀（提高一级特异性）：动态样式里有一条
   \`#root, #root * { background-color: transparent !important }\`，
   单靠 \`[data-dshlg-region]\` 会在层叠里输给它 —— 结果就是
   「有底色、没模糊」的半成品玻璃（实测踩过）。 */
#root [data-dshlg-region]:not(.dshlg-brand) {
  box-sizing: border-box !important;
  background-color: rgba(var(--dshlg-tone, 255, 255, 255), var(--dshlg-alpha, 0.08)) !important;
  border: var(--dshlg-border, 1px) solid rgba(255, 255, 255, var(--dshlg-border-a, 0.18)) !important;
  border-radius: var(--dshlg-radius, 20px) !important;
  backdrop-filter: var(--dshlg-filter, blur(18px) saturate(1.6));
  -webkit-backdrop-filter: var(--dshlg-filter, blur(18px) saturate(1.6));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, var(--dshlg-topline, 0.3)) !important;
}
/* 中栏与收起态：透明（同样带特异性，免得被兜底规则按回去） */
#root [data-dshlg-region="middle"],
#root [data-dshlg-region="middle"] *,
#root [data-dshlg-region="right"][data-dshlg-closed],
#root [data-dshlg-region="right"][data-dshlg-closed] * {
  background-color: transparent !important;
  background-image: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}
#root [data-dshlg-region="middle"],
#root [data-dshlg-region="right"][data-dshlg-closed] {
  box-shadow: none !important;
  border: 0 !important;
}
/* 玻璃预算：超出的面不吃 backdrop-filter */
#root [data-dshlg-glass-over] {
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}
/* 官方品牌节点被替换时隐藏（display:none 比 visibility 干净，不占位） */
#root .dshlg-brand [data-dshlg-hidden] {
  display: none !important;
}
/* 自定义品牌文字：深蓝宝石渐变（文字渐变不受 SVG 底板问题影响）。
   注意特异性 (1,2,0) 高于上面那条清底的 (1,1,0)，所以这里的渐变不会被清掉。 */
/* ══ 品牌文字：宝石质感 ══════════════════════════════════════
   两层背景（先写的在上层）：
     ① 窄白高光带 —— 扫过字面时就是「布灵」的那一下
     ② 切面渐变 —— 铺满文字，让每个字都有明暗过渡
   配色按 html[data-dshlg-gem] 切换；默认 ice（整体提亮，暗色壁纸上清楚）。 */

/* 预设一：冰钻白蓝 —— 整体亮，暗色壁纸上最清楚（默认） */

/* 预设二：香槟金 —— 最像珠宝，冷暖壁纸都压得住 */

/* 预设三：青玉 —— 冷色系，偏翡翠 */


/* 放大 + 居中：字更大，并在品牌行内水平居中 */

/* 承载容器也要能居中（DSH 的品牌按钮默认左对齐） */
/* 鲸鱼/鱼标：彻底不显示（用户要求去掉）。直接按稳定类名后缀隐藏 ——
   不依赖 JS 打的 data 属性，避免「标记没打上就不生效」。 */
#root .dshlg-brand [class*="_brandMark"] {
  display: none !important;
}
#root .dshlg-brand [class*="_brand"] {
  display: flex !important;
  justify-content: flex-start !important;   /* 文字靠左 */
  align-items: center !important;
  width: 100% !important;
}

#root .dshlg-brand .dshlg-brand-label {
  /* ══ 宝石质感（两层背景，先写的在上层）══════════════════════
     ① 窄白高光带 —— 260% 宽、左右扫动，扫过字面时就是「布灵」那一下
     ② 切面渐变 —— 铺满文字，每个字都有明暗过渡
     两层都被 background-clip:text 裁进文字，只作用在字上。
     配色用**具体值**写，不用 CSS 变量：变量一旦在计算值阶段无效，
     整条 background-image 会退化成 none（实测踩过）。 */
  background-image:
    linear-gradient(100deg,
      rgba(255, 255, 255, 0) 0%, rgba(255, 255, 255, 0) 41%,
      rgba(255, 255, 255, 0.98) 50%,
      rgba(255, 255, 255, 0) 59%, rgba(255, 255, 255, 0) 100%),
    linear-gradient(165deg,
      #ffffff 0%, #e0f2fe 16%, #bae6fd 32%, #7dd3fc 48%,
      #a5f3fc 64%, #e0f2fe 80%, #ffffff 100%) !important;
  background-size: 260% 100%, 100% 100% !important;
  background-position: -70% 50%, 0 0 !important;
  background-repeat: no-repeat, no-repeat !important;
  background-color: transparent !important;
  -webkit-background-clip: text !important;
  background-clip: text !important;
  -webkit-text-fill-color: transparent !important;
  color: #7dd3fc;
  /* 更大、更粗、居中 */
  font: 800 23px/1.25 "Segoe UI", system-ui, "Microsoft YaHei", sans-serif !important;
  letter-spacing: .05em !important;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  flex: 1 1 auto;
  width: 100%;
  padding-left: 2px;
  justify-content: flex-start;
  text-align: left;
  /* 外侧深投影（浅壁纸上读得出）+ 内侧蓝光（暗壁纸上发光） */
  filter:
    drop-shadow(0 1px 1px rgba(8, 20, 60, 0.6))
    drop-shadow(0 2px 6px rgba(8, 20, 60, 0.5))
    drop-shadow(0 0 12px rgba(186, 230, 253, 0.75));
  animation: dshlg-gem-shimmer 5.5s linear infinite;
}
/* 承载容器居中（DSH 的品牌按钮默认左对齐） */
#root .dshlg-brand [class*="_brand"] {
  display: flex !important;
  justify-content: center !important;
  width: 100% !important;
}
/* 预设二：香槟金 */
html[data-dshlg-gem='gold'] #root .dshlg-brand .dshlg-brand-label {
  background-image:
    linear-gradient(100deg,
      rgba(255, 255, 255, 0) 0%, rgba(255, 255, 255, 0) 41%,
      rgba(255, 255, 255, 0.98) 50%,
      rgba(255, 255, 255, 0) 59%, rgba(255, 255, 255, 0) 100%),
    linear-gradient(165deg,
      #fffdf5 0%, #fef3c7 18%, #fcd34d 36%, #f59e0b 54%,
      #fbbf24 70%, #fef9c3 86%, #ffffff 100%) !important;
}
/* 预设三：青玉 */
html[data-dshlg-gem='aqua'] #root .dshlg-brand .dshlg-brand-label {
  background-image:
    linear-gradient(100deg,
      rgba(255, 255, 255, 0) 0%, rgba(255, 255, 255, 0) 41%,
      rgba(255, 255, 255, 0.98) 50%,
      rgba(255, 255, 255, 0) 59%, rgba(255, 255, 255, 0) 100%),
    linear-gradient(165deg,
      #ffffff 0%, #ccfbf1 18%, #5eead4 36%, #2dd4bf 54%,
      #14b8a6 70%, #99f6e4 86%, #ffffff 100%) !important;
}

@keyframes dshlg-gem-shimmer {
  0%   { background-position: -70% 50%, 0 0; }
  100% { background-position: 170% 50%, 0 0; }
}
/* 尊重「减少动态效果」：保留静态切面，不流光 */
@media (prefers-reduced-motion: reduce) {
  /* 品牌流光必须在这里关掉 —— 之前是个空规则体，等于没生效。 */
  #root .dshlg-brand .dshlg-brand-label {
    animation: none !important;
    background-position: -20% 50%, 0 0 !important;
  }
}

/* ══ 品牌区内**任何**后代都不许有自己的底 ══════════════════════
   用户反馈：「harness 背后是一个蓝块」。这块底不是字标自带的（官方 BrandWordmark
   是 7 个 fill=currentColor 的 path），而是某个包裹元素/伪元素照样带着背景。
   与其逐个猜是哪个元素，这里一次性立规矩：品牌区内所有后代一律无底、无描边、
   无阴影，伪元素不产生内容 —— 唯一允许的底是品牌行自己的 ::before 玻璃。
   需要保留的交互反馈（悬停）由下面单独一条补回来。 */
#root .dshlg-brand *,
#root .dshlg-brand *::before,
#root .dshlg-brand *::after {
  background: none !important;
  background-color: transparent !important;
  background-image: none !important;
  border-color: transparent !important;
  box-shadow: none !important;
}
#root .dshlg-brand *::before,
#root .dshlg-brand *::after {
  content: none !important;
}
/* 补两个「不是 background 也能画出底」的属性：
   border-image 会绕过 border-color: transparent 继续画；
   background-clip 也可能把渐变裁成色块。 */
#root .dshlg-brand *,
#root .dshlg-brand *::before,
#root .dshlg-brand *::after {
  border-image: none !important;
  background-clip: border-box !important;
  -webkit-background-clip: border-box !important;
  mix-blend-mode: normal !important;
}
#root .dshlg-brand [data-dshlg-flat]:hover {
  background-color: rgba(255, 255, 255, 0.08) !important;
  border-radius: 10px !important;
}

/* 品牌区内的任何「行级玻璃」一律透明 —— 品牌按钮不该有自己的底。 */
#root .dshlg-brand .dshlg-bar,
#root .dshlg-brand [data-dshlg-flat] {
  background: none !important;
  background-color: transparent !important;
  background-image: none !important;
  border: 0 !important;
  box-shadow: none !important;
}
/* 左侧栏「行级玻璃」：淡底 + 内高光 + 圆角，**不做模糊**（一列十几行太贵） */
#root .dshlg-bar {
  /* 0.05 → 0.028：侧栏整列已有一层 0.138，行上再叠 0.05 会让侧栏
     整体比右栏「厚」—— 用户反馈「右栏更透明」就是这么来的。 */
  background-color: transparent !important;
  background-image: none !important;
  border: 1px solid rgba(255, 255, 255, 0.06) !important;
  border-radius: 10px !important;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1) !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}
/* ══ 左上角品牌：蓝色液态玻璃 ══════════════════════════════════
   ⚠️ 关键：玻璃画在 ::before 上，.dshlg-brand 本身**绝不碰 backdrop-filter**。
   原因：DSH 在 Windows 下把「收起侧边栏」按钮放在 logoRow **内部**，
   而它是 position:fixed。按 CSS 规范，backdrop-filter 取 none 以外的值时，
   该元素会成为 fixed 后代的**包含块** —— 于是那个按钮不再相对视口定位，
   而是相对这块玻璃定位，**正好压在 DeepSeek Harness 字上**（用户报的重叠）。
   挪到伪元素后，行本身不产生包含块，按钮回到视口定位。
   （注意：这段在模板字符串内部，注释里不能出现反引号。） */
#root .dshlg-brand {
  position: relative;
  box-sizing: border-box;
  isolation: isolate;
  background: none !important;
  border: 0 !important;
  box-shadow: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  margin: 2px 4px 6px !important;
  padding: 4px 8px !important;
}
#root .dshlg-brand::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  border-radius: 14px;
  background-color: rgba(var(--dshlg-brand-tone, 147, 197, 253),
    calc(var(--dshlg-brand-a, 0.42) * 0.62));
  background-image:
    radial-gradient(120% 160% at 10% 0%,
      rgba(255, 255, 255, calc(var(--dshlg-brand-a, 0.42) * 0.75)) 0%,
      rgba(255, 255, 255, 0) 62%),
    linear-gradient(180deg,
      rgba(255, 255, 255, calc(var(--dshlg-brand-a, 0.42) * 0.5)) 0%,
      rgba(255, 255, 255, 0) 58%);
  border: 1px solid rgba(var(--dshlg-brand-tone, 147, 197, 253),
    calc(var(--dshlg-brand-a, 0.42) * 1.6));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, calc(var(--dshlg-topline, 0.3) * 1.5)),
    inset 0 0 12px rgba(var(--dshlg-brand-tone, 147, 197, 253),
      calc(var(--dshlg-brand-a, 0.42) * 0.8)),
    0 4px 18px rgba(0, 0, 0, 0.2);
  backdrop-filter: var(--dshlg-brand-filter, none);
  -webkit-backdrop-filter: var(--dshlg-brand-filter, none);
}
/* 品牌文字：白 → 蓝 渐变填充。
   只写 background-image —— background 简写会把背景色一起重置，渐变丢失、
   文字退回灰白（实测踩过）。配色从纯白过渡到深蓝，保证在浅色玻璃上也读得出。 */
/* ══ 关键：官方字标是 SVG，不是文字 ══════════════════════════
   DSH 的品牌名由 dsh-client-ui-brand-official 注册，渲染的是
   BrandWordmark —— 一个 viewBox 为 26 0 156 24 的矢量字标（宽 = 高 × 6.5），
   内部 fill="none"、path 各自带 fill。
   所以：对 _brandName 做文字渐变填充**完全没有作用**（没有文本节点），
   真机上看到的就是一块被填成白色的字标 —— 用户说的「白块，都看不出来」。
   正确做法是直接改 path 的 fill。 */
/* 鱼标与字标：深蓝宝石质感。
   fill 指向运行时注入的渐变（#dshlg-sapphire）—— SVG 形状不能直接吃 CSS 渐变，
   但 fill: url(#id) 可以引用文档里的 <linearGradient>。
   再叠一层「顶部白色高光 + 底部深色投影」，做出宝石的立体感。 */
#root .dshlg-brand svg path,
#root .dshlg-brand svg rect,
#root .dshlg-brand svg circle,
#root .dshlg-brand svg polygon {
  fill: url(#dshlg-sapphire) !important;
  color: rgb(var(--dshlg-brand-ink, 30, 64, 175)) !important;
}
#root .dshlg-brand svg {
  filter:
    drop-shadow(0 1px 0 rgba(255, 255, 255, 0.65))
    drop-shadow(0 2px 3px rgba(12, 30, 80, 0.45));
}

/* 文字兜底：若某版本品牌名真的是文本（fallbackBrandName / localBuildTitle），
   深蓝实色填充即可（不用渐变，避免又走回被覆盖的老路）。 */
#root .dshlg-brand [class*="_brandName"],
#root .dshlg-brand [class*="_fallbackBrandName"],
#root .dshlg-brand [class*="_localBuildTitle"],
#root .dshlg-brand [class*="_buildVersion"] {
  background-image: none !important;
  background-color: transparent !important;
  -webkit-text-fill-color: rgb(var(--dshlg-brand-ink, 30, 64, 175)) !important;
  color: rgb(var(--dshlg-brand-ink, 30, 64, 175)) !important;
  font-weight: 600 !important;
}

/* 鱼标：递归上蓝（DSH 的 SVG 可能是 currentColor，也可能是写死的白） */
#root .dshlg-brand [class*="_brandMark"] svg,
#root .dshlg-brand [class*="_brandMark"] svg *,
#root .dshlg-brand [class*="_brandName"] svg,
#root .dshlg-brand [class*="_brandName"] svg * {
  color: rgb(var(--dshlg-brand-ink, 30, 64, 175)) !important;
  /* 宝石渐变（而不是纯色）—— 规则顺序上这条比 svg path 那条更靠后、特异性更高，
     所以渐变必须也写在这里，否则会被纯色盖掉。 */
  fill: url(#dshlg-sapphire) !important;
}
#root .dshlg-brand [class*="_brandMark"] {
  filter: drop-shadow(0 1px 1px rgba(255, 255, 255, 0.6));
}
/* ══ 边缘渐隐带（借鉴 Aqua）══════════════════════════════════
   顶/底各一条 13px 模糊带：聊天内容滚到边缘时渐入模糊，
   但更高的玻璃面（侧栏 / 输入栏 / 控制条）不受影响，保持清晰。 */
#dshlg-fade-top,
#dshlg-fade-bottom {
  position: fixed;
  left: 0;
  right: 0;
  height: 13px;
  z-index: 7;
  pointer-events: none;
  backdrop-filter: blur(5px);
  -webkit-backdrop-filter: blur(5px);
  /* 极淡的一层纱：太浓会在玻璃面下显出一道膜 */
  background: rgba(255, 255, 255, 0.2);
}
body[data-ds-dark-theme] #dshlg-fade-top,
body[data-ds-dark-theme] #dshlg-fade-bottom {
  background: rgba(0, 0, 0, 0.15);
}
#dshlg-fade-top {
  top: 0;
  -webkit-mask-image: linear-gradient(180deg, #000 0%, transparent 100%);
  mask-image: linear-gradient(180deg, #000 0%, transparent 100%);
}
#dshlg-fade-bottom {
  bottom: 0;
  -webkit-mask-image: linear-gradient(0deg, #000 0%, transparent 100%);
  mask-image: linear-gradient(0deg, #000 0%, transparent 100%);
}
@media (prefers-reduced-transparency: reduce) {
  #dshlg-fade-top, #dshlg-fade-bottom { display: none; }
}


/* ══ 可读性：正文暗描影（只在亮壁纸上开）═══════════════════════
   全透明下文字边缘直接贴壁纸，亮壁纸会「糊边」。
   这里用 1px 暗描影把字边缘压住 —— 比盖纱轻得多，且不改变玻璃观感。
   只在实测壁纸偏亮时开（html[data-dshlg-bright-wall]），暗壁纸保持纯净。
   选择器放宽到 #root 整体（原规则盯的 [data-conversation-region] 真机上
   只出现在输入区，等于没命中）。 */
html[data-dshlg-bright-wall] #root,
html[data-dshlg-bright-wall] #root * {
  text-shadow: 0 0 1px rgba(0, 0, 0, 0.55), 0 1px 2px rgba(0, 0, 0, 0.35) !important;
}
/* 自制界面不跟着加（它们自带底色与描边） */
html[data-dshlg-bright-wall] #dshlg-controls,
html[data-dshlg-bright-wall] #dshlg-controls *,
html[data-dshlg-bright-wall] #dshlg-settings,
html[data-dshlg-bright-wall] #dshlg-settings * {
  text-shadow: none !important;
}


/* ══ 弹窗/设置面板必须是**可读卡片**，不能全透明 ══════════════════
   结构性窗格（左右侧栏、输入栏）走全透明是设计定调；
   但弹窗、菜单、设置对话框是「浮在内容之上的可读面」——
   全透明会让它和背后的工作区文字叠在一起，两边都读不了。
   这里给它们一层真正的板（不是玻璃纱），保证字读得出。 */
#root [role='dialog'],
#root [role='dialog'] *,
#root [data-menu-material] {
  --dshlg-plate: 1;
}
#root [role='dialog'] {
  background-color: rgba(var(--dshlg-tone, 255, 255, 255), 0.88) !important;
  background-image: none !important;
  backdrop-filter: var(--dshlg-filter-plate, blur(18px) saturate(1.5)) !important;
  -webkit-backdrop-filter: var(--dshlg-filter-plate, blur(18px) saturate(1.5)) !important;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.5),
    0 24px 64px rgba(0, 0, 0, 0.42) !important;
  border: 1px solid rgba(255, 255, 255, 0.28) !important;
}
/* 深色主题下用深板，否则白板刺眼 */
body[data-ds-dark-theme] #root [role='dialog'] {
  background-color: rgba(24, 28, 38, 0.9) !important;
  border-color: rgba(255, 255, 255, 0.14) !important;
}
/* 厚底上的字必须是深色（深色主题下保持浅色）——底与字绑成一个决策 */
#root [role='dialog'],
#root [role='dialog'] * {
  color: #16233a !important;
}
body[data-ds-dark-theme] #root [role='dialog'],
body[data-ds-dark-theme] #root [role='dialog'] * {
  color: #eaf0fa !important;
}
/* 菜单/popover 同样给足底 */
#root [data-menu-material] {
  background-color: rgba(var(--dshlg-tone, 255, 255, 255), 0.9) !important;
}
body[data-ds-dark-theme] #root [data-menu-material] {
  background-color: rgba(26, 30, 40, 0.92) !important;
}


/* ══ DSH 自带设置面板（SettingsShell 覆盖层）必须不透明 ══════════════
   真身：<hash>_overlay{position:fixed;inset:0;background:var(--dsw-alias-bg-base)}
   本插件把 --dsw-alias-bg-base 改成透明（为了让壁纸透出），
   这个全屏覆盖层就跟着变透明 → 面板文字与工作区文字叠在一起看不清。
   按**稳定语义后缀**命中（DSH 的类名是模块哈希 + 语义后缀，后缀稳定），
   并给一块与主题配对的实色板；字色交给 DSH 自己的令牌，
   所以「浅底配深字 / 深底配浅字」天然成立，不会出现白底白字。 */
[class*='_overlay'],
[class*='_scrim'] {
  background-color: var(--dshlg-plate-bg, rgba(250, 251, 253, 0.97)) !important;
  background-image: none !important;
}
body[data-ds-dark-theme] [class*='_overlay'],
body[data-ds-dark-theme] [class*='_scrim'] {
  background-color: var(--dshlg-plate-bg-dark, rgba(19, 23, 31, 0.98)) !important;
}
/* 覆盖层里通常还有一层内层「面板」，一并给底，避免只有边缘实、内容区透 */
[class*='_overlay'] [class*='_panel'],
[class*='_overlay'] [class*='_card'],
[class*='_overlay'] [class*='_content'],
[class*='_overlay'] [class*='_body'],
[class*='_overlay'] [class*='_nav'],
[class*='_overlay'] [class*='_sidebar'],
[class*='_overlay'] [class*='_list'] {
  background-color: transparent !important;
  background-image: none !important;
}
/* 自制界面不受影响（它们自带底色与描边） */
#dshlg-settings, #dshlg-controls, #dshlg-gallery, #dshlg-gear, #dshlg-restore {
  --dshlg-plate-bg: unset;
}

/* ══ 可读性：正文 1px 描影（借鉴 Aqua）════════════════════════
   全透明背景下文字边缘直接贴着壁纸，容易糊边。
   1px 描影把字边缘的背景压住一点，是最省事的可读性提升。 */
#root [data-conversation-scroll],
#root [data-conversation-region] {
  text-shadow: 0 0 1px rgba(0, 0, 0, 0.4);
}
body:not([data-ds-dark-theme]) #root [data-conversation-scroll],
body:not([data-ds-dark-theme]) #root [data-conversation-region] {
  text-shadow: 0 0 1px rgba(255, 255, 255, 0.55), 0 1px 2px rgba(19, 45, 83, 0.08);
}

/* ══ 无障碍：焦点环 + 选区色（借鉴 Aqua）══════════════════════
   半透明界面上默认焦点环对比不足，这两条成本极低但影响可用性。 */
#root :focus-visible {
  outline: 2px solid rgba(110, 155, 232, 0.85);
  outline-offset: 1px;
}
#root ::selection {
  background: rgba(110, 155, 232, 0.35);
}

/* ══ 选中会话：左侧强调条 + 柔光（借鉴 Aqua）═════════════════ */
#root [role='treeitem'][aria-selected='true'] {
  box-shadow:
    inset 2px 0 0 var(--dsw-specific-sidebar-nav-item-active-accent, rgba(110, 155, 232, 0.9)),
    0 0 16px rgba(110, 155, 232, 0.14);
}

/* ══ 关键防护（Aqua 源码里明确记录过的坑）═════════════════════
   侧栏内出现固定定位弹层时，侧栏不能带 backdrop-filter：
   否则该弹层会被重新锚定进侧栏（Aqua 实测弹窗宽度被压到 254px）。
   这与本项目踩到的「包含块」问题同源，故再兜一道，
   防止将来把侧栏的 frost 调回非零时复发。 */
#root [data-dshlg-region="side"]:has([role='dialog']),
#root .dshlg-brand:has([role='dialog']) {
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}

/* ══ 品牌里那个「白块 / 蓝块」的真身 ══════════════════════════
   DSH 把整组标识（鱼标 + 字标）包在一个按钮里（<hash>_brand），
   这个按钮自带底色 —— 用户看到的「白块」就是它。
   ⚠️ 不要给它画任何底（无论是白、透明还是蓝胶囊）：
     · 画成透明 → 字标 currentColor 是白色，白字在浅底上看不见
     · 画成蓝色胶囊 → 字标改深蓝后又变成「深蓝字在蓝块上」，一样看不见
   正解：让它彻底无底、无描边、无阴影，字标直接落在品牌行的浅蓝玻璃上。
   也**不能**在这里强制子 svg 变白 —— 那会和品牌墨色规则打架。 */
#root [data-dshlg-flat] {
  background: none !important;
  background-color: transparent !important;
  background-image: none !important;
  border: 0 !important;
  box-shadow: none !important;
  outline: none !important;
}
#root [data-dshlg-flat]:hover {
  background-color: rgba(255, 255, 255, 0.07) !important;
  border-radius: 10px !important;
}
`;

    /**
     * 找一个「脚本自己的基准 URL」。
     *
     * 为什么不能用 import.meta.url：客户端半体是被 DSH 的加载器当作**普通
     * 函数体**执行的（`window.__ModuleLoader__.load({factory})`），不是 ESM 模块，
     * 所以 `import.meta` 根本不存在。
     * 也不能只靠 document.baseURI：那是页面地址（dsh-app://app/），
     * 插件文件却在 node_modules 下，拼出来必然 404。
     *
     * 可靠办法是从 <script> 标签反查：加载器/验证台都是用 <script src=…>
     * 把 lib/client.js 引进来的，取最后一个指向 client.js 的脚本地址，
     * 就能定位到同目录的 ../styles.css。
     */
    function scriptBaseUrl() {
      try {
        const scripts = Array.from(document.scripts || []);
        for (let i = scripts.length - 1; i >= 0; i -= 1) {
          const src = scripts[i].src || '';
          if (/dsh-liquid-glass.*client\.js(\?|$)/.test(src)) return src;
        }
      } catch {
        /* 忽略 */
      }
      return document.baseURI;
    }

    /**
     * styles.css 的候选 URL（由脚本地址推出）。
     *
     * 给两个候选是刻意的：客户端半体放在包根（DSH 加载器要求的
     * `<包>/client.js`）时用同目录；万一有人把它放进 lib/，退一层也能找到。
     * 顺序不能反 —— 先同目录，否则包根布局会去上一级目录找，必然 404。
     */
    function stylesheetUrls() {
      const base = scriptBaseUrl();
      const out = [];
      try { out.push(new URL('styles.css', base).href); } catch { /* 忽略 */ }
      try { out.push(new URL('../styles.css', base).href); } catch { /* 忽略 */ }
      out.push('styles.css');
      return Array.from(new Set(out));
    }

    /**
     * 挂静态材质：先写内联兜底，再尽力加载 styles.css。
     *
     * 顺序很关键 —— 内联是「保底」，styles.css 是「完整」：
     * 两者选择器相同，后写入的赢；styles.css 成功时它的完整规则生效，
     * 失败时界面仍然是正确的玻璃（不是一层白纱糊着）。
     * fetch 优先而不是直接 <link>：file:// 下 <link> 会被静默拦截，
     * 用 fetch 至少能拿到文本（本地/打包两种源都行），失败了也不影响兜底。
     */
    function ensureStylesheet() {
      // ① 内联兜底（幂等）
      let inline = document.getElementById(STYLE_ID);
      if (!inline) {
        inline = document.createElement('style');
        inline.id = STYLE_ID;
        inline.dataset.dshlgRole = 'critical';
        document.head.appendChild(inline);
      }
      if (inline.dataset.dshlgCritical !== '1') {
        inline.textContent = CRITICAL_CSS;
        inline.dataset.dshlgCritical = '1';
      }

      // ② 外置完整材质（只试一次）
      if (document.getElementById(STYLE_LINK_ID) || styleLoadTried) return true;
      styleLoadTried = true;
      const urls = stylesheetUrls();
      (async () => {
        let lastError = null;
        for (const url of urls) {
          try {
            const res = await fetch(url, { cache: 'no-store' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const text = await res.text();
            if (!text || text.length < 200) throw new Error('内容过短');
            return { url, text };
          } catch (error) {
            lastError = error;
          }
        }
        throw lastError ?? new Error('没有候选 URL');
      })()
        .then(({ text, url }) => {
          if (!text || text.length < 200) throw new Error('内容过短');
          let el = document.getElementById(STYLE_LINK_ID);
          if (!el) {
            el = document.createElement('style');
            el.id = STYLE_LINK_ID;
            el.dataset.dshlgRole = 'styles';
            document.head.appendChild(el);
          }
          el.textContent = text;
          console.info('[dsh-liquid-glass] styles.css 已加载（' + text.length + ' 字节）：' + url);
        })
        .catch(() => {
          /* fetch 走不通就换 <link> —— 原生样式加载路径，不受 fetch 的 CORS 限制。
             不成功也无所谓：关键材质已内联在 CRITICAL_CSS 里。 */
          try {
            const link = document.createElement('link');
            link.id = STYLE_LINK_ID;
            link.rel = 'stylesheet';
            link.href = urls[0];
            link.dataset.dshlgRole = 'styles';
            document.head.appendChild(link);
            console.info('[dsh-liquid-glass] styles.css 改用 <link> 加载：' + urls[0]);
          } catch { /* 都不行就只靠内联 */ }
        })
        .catch((error) => {
          console.warn('[dsh-liquid-glass] styles.css 没取到，使用内联兜底材质：', error && error.message);
        });
      return true;
    }

    /**
     * 边缘透镜的 mask 过渡点（随 edgeWidth 变）。
     * 这两条以前内联在 CSS 字符串里，现在走自定义属性，
     * 于是 styles.css 可以是纯静态文件。
     */
    function applyEdgeVars() {
      const band = edgeBandPct(g('edgeWidth', 0.12));
      const root = document.documentElement;
      root.style.setProperty('--dshlg-edge-mid', band * 0.5 + '%');
      root.style.setProperty('--dshlg-edge-inner', band * 1.05 + '%');
    }

    /**
     * 一块玻璃面的图层参数。
     *
     * `refract` 传 0 = 不做边缘透镜（只模糊）。侧栏/右栏默认不开折射：
     * 整列面积大，SVG 折射在这个尺度上很吃显卡，而且「整列透镜」也不像 iOS。
     */
    function glassVars(theme, alpha, frost, refract) {
      const dark = theme.dark !== false;
      const tone = '255, 255, 255';
      const blur = num(frost, 18);
      const sat = num(g('saturate', 1.6), 1.6);
      const refractory = num(refract, 0);
      const clearMode = CONFIG.overlayMode === 'clear';

      /* blur = 0 且不做折射 → 直接 none。
         留着 blur(0px) 浏览器仍会采样 backdrop，白付一次合成开销；
         而这个档的「玻璃感」完全由边缘光学（描边/顶光/菲涅尔/色差）给出。 */
      const base = blur > 0 ? `blur(${blur}px) saturate(${sat})` : `saturate(${sat})`;
      const normal = clearMode
        ? 'none'
        : refractory > 0
          ? `${base} url(#${FILTER_REF})`
          : blur > 0
            ? base
            : 'none';
      const activeBlur = blur * clamp01(g('activeBlur', 0.7), 0.7);
      const activeRefract = refractory * num(g('activeRefract', 1.6), 1.6);
      const activeBase = `blur(${activeBlur.toFixed(1)}px) saturate(${sat})`;
      const active =
        !clearMode && activeRefract > 0 ? `${activeBase} url(#${FILTER_REF})` : activeBase;

      // 深色主题下白纱要更亮一点，浅色主题下略降（否则一片白）
      const sheen = clamp01(alpha * (dark ? 1.15 : 0.75));

      return `  --dshlg-tone: ${tone};
  --dshlg-alpha: ${alpha};
  --dshlg-sheen: ${sheen.toFixed(3)};
  --dshlg-radius: ${num(g('radius', 20), 20)}px;
  --dshlg-border: ${num(g('border', 1), 1)}px;
  --dshlg-border-a: ${clamp01(g('borderAlpha', 0.18), 0.18)};
  --dshlg-topline: ${clamp01(g('topLine', 0.3), 0.3)};
  --dshlg-fresnel: ${clamp01(g('fresnel', 0.22), 0.22)};
  --dshlg-fresnel-w: ${Math.max(2, Math.round(blur * 0.34))}px;
  --dshlg-shadow-y: ${num(g('shadowY', 8), 8)}px;
  --dshlg-shadow-blur: ${num(g('shadowBlur', 32), 32)}px;
  --dshlg-shadow-a: ${clamp01(g('shadowAlpha', 0.35), 0.35)};
  --dshlg-chroma: ${num(g('chroma', 2), 2)}px;
  --dshlg-chroma-a: ${clamp01(g('chromaAlpha', 0.22), 0.22)};
  --dshlg-spec-a: ${(clamp01(g('fresnel', 0.22), 0.22) * 0.7).toFixed(3)};
  --dshlg-hi-boost: ${num(g('activeHighlight', 1.5), 1.5)};
  --dshlg-filter: ${normal};
  --dshlg-filter-active: ${active};`;
    }

    /**
     * 区域玻璃总装。所有区域共用一套 iOS 表现，
     * 差别只在「底色不透明度 / 模糊半径 / 是否做边缘透镜」。
     */
    function buildRegionCss(theme) {
      const side = layer('sidebarGlass', 0.14);
      const right = layer('rightGlass', 0.14);
      const approval = layer('approvalGlass', 0.3);
      const modal = layer('modalGlass', 0.4);

      /* 边缘透镜开关：
         · overlayMode === 'clear' → 不做（用户明确要实色面板）
         · 只有 CONFIG.refractRegions === true 时才给侧栏/右栏上折射 */
      const regionRefract =
        CONFIG.overlayMode === 'clear'
          ? 0
          : CONFIG.refractRegions === true
            ? num(g('edgeRefract', 10), 10)
            : 0;
      /* 审批卡 / 弹窗是小面积，透镜感最出彩，默认给 */
      const cardRefract = CONFIG.overlayMode === 'clear' ? 0 : num(g('edgeRefract', 10), 10);

      return `
/* ── 侧栏 / 右栏 / 审批卡 / 弹窗：各一档 iOS 玻璃 ───────── */
[data-dshlg-region="side"] {
${glassVars(theme, side.alpha, side.frost, regionRefract)}
}
[data-dshlg-region="right"] {
${glassVars(theme, right.alpha, right.frost, regionRefract)}
}
[data-dshlg-region="approval"] {
${glassVars(theme, approval.alpha, approval.frost, cardRefract)}
}
[data-dshlg-region="modal"] {
${glassVars(theme, modal.alpha, modal.frost, cardRefract)}
}
`;
    }

    /**
     * 浮层（下拉菜单 / hover card / menu surface）。
     * DSH 自己已经给这些面上了 `--dsw-menu-backdrop-filter`，
     * 我们只补底色、别把它的模糊覆盖掉。
     */
    function buildOverlayCss(theme) {
      if (CONFIG.overlayMode === 'off') return '';
      const overlay = layer('overlayGlass', 0.9, 24);
      const a = overlay.alpha;
      const dark = theme.dark !== false;
      const tone = '255, 255, 255';
      return `
/* 浮层：菜单、hover 卡、气泡。DSH 自带 backdrop-filter，这里只补底色与描边。 */
[data-menu-material] {
  background-color: rgba(${tone}, ${(a * 0.42).toFixed(3)}) !important;
  background-image: linear-gradient(180deg,
    rgba(${tone}, ${(a * 0.24).toFixed(3)}) 0%,
    rgba(${tone}, ${(a * 0.12).toFixed(3)}) 100%) !important;
  border: 1px solid rgba(${tone}, ${dark ? 0.22 : 0.5}) !important;
  box-shadow: inset 0 1px 0 rgba(${tone}, ${dark ? 0.2 : 0.55}),
    0 16px 44px rgba(0, 0, 0, ${dark ? 0.42 : 0.18}) !important;
}
`;
    }

    /* ── 壁纸服务探测 ───────────────────────────────────── */

    /**
     * 探测宿主半体的静态服务端口。
     *
     * 不是「谁先活就用谁」：如果旧版本的服务占着低端口，
     * 它没有 /__wallpapers 接口，会导致壁纸清单为空。
     * 所以扫完所有候选端口后，优先选声明了 wallpapers 功能的那个。
     */
    async function probeServer(ports) {
      const alive = [];
      for (const port of ports) {
        try {
          const res = await fetch(`http://127.0.0.1:${port}/__alive`, { cache: 'no-store' });
          if (!res.ok) continue;
          const body = await res.json().catch(() => null);
          if (!body || body.server !== 'dsh-liquid-glass') continue;
          alive.push({ port, features: Array.isArray(body.features) ? body.features : [] });
        } catch {
          /* 该端口没服务，试下一个 */
        }
      }
      if (alive.length === 0) return null;
      const full = alive.find((a) => a.features.includes('wallpapers'));
      return (full ?? alive[0]).port;
    }

    /** 当前选中的壁纸入口。优先用上次选的（localStorage），其次用配置里的默认值。 */
    function currentEntry() {
      try {
        const saved = localStorage.getItem('dshlg.entry');
        if (saved) return saved;
      } catch {
        /* 隐私模式等，忽略 */
      }
      return CONFIG.wallpaper.entry;
    }

    function saveEntry(entry) {
      try {
        localStorage.setItem('dshlg.entry', entry);
      } catch {
        /* 忽略 */
      }
    }

    /** 挂上壁纸 iframe；入口或端口变了就重建。 */
    function ensureWallpaper(port) {
      if (!CONFIG.wallpaper.enabled) {
        document.getElementById(WALL_ID)?.remove();
        return null;
      }
      const entry = currentEntry();
      const src = `http://127.0.0.1:${port}/${entry}`;
      let el = document.getElementById(WALL_ID);
      const existing = el?.querySelector('iframe');
      if (el && existing && existing.dataset.src === src) return src;

      if (!el) {
        el = document.createElement('div');
        el.id = WALL_ID;
        el.setAttribute('aria-hidden', 'true');
        document.body.prepend(el);
      }
      el.replaceChildren();
      const frame = document.createElement('iframe');
      frame.dataset.src = src;
      frame.setAttribute('allow', 'autoplay');
      frame.setAttribute('scrolling', 'no');
      // 诊断：load/error 跨源也能收到，是判断「iframe 到底加载成功没有」的关键
      frame.addEventListener('load', () => {
        wallDiag.load = true;
      });
      frame.addEventListener('error', () => {
        wallDiag.loadError = true;
      });
      frame.src = src;
      el.appendChild(frame);

      // 再直接 fetch 一次入口文件：能拿到状态码就说明网络链路 + CORS 都通
      wallDiag.fetchStatus = '…';
      fetch(src, { cache: 'no-store' })
        .then((res) => {
          wallDiag.fetchStatus = `HTTP ${res.status}`;
        })
        .catch((error) => {
          wallDiag.fetchStatus = `失败(${error && error.message})`;
        });

      return src;
    }

    /* ── 壁纸控制条 + 画廊 ──────────────────────────────── */

    /** 给壁纸 iframe 发命令（由宿主注入的控制桥接收）。 */
    function postToWallpaper(cmd, value) {
      const frame = document.querySelector(`#${WALL_ID} iframe`);
      if (!frame || !frame.contentWindow) return;
      try {
        frame.contentWindow.postMessage({ __dshlg: 'dshlg', cmd, value }, '*');
      } catch (error) {
        console.warn('[dsh-liquid-glass] 向壁纸发命令失败:', error);
      }
    }

    function buildControlsCss(theme) {
      const dark = theme.dark;
      const tone = '255, 255, 255';
      return `
/* ══ 齿轮按钮：打开设置面板（透明玻璃圆钮，和控制条同一族）══ */
#${GEAR_ID} {
  position: fixed;
  /* left 由 JS 按控制条实测宽度写入（贴在其右侧）；bottom 与控制条对齐。
     这里给的是「控制条不在」时的兜底位置。 */
  left: 18px;
  bottom: 18px;
  z-index: 2147483000;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  font: 14px/1 "Segoe UI", system-ui, sans-serif;
  color: ${dark ? '#ffe4ef' : '#8a0f45'};
  cursor: pointer;
  /* 深粉红（玫瑰）玻璃 · 全透：低填充 + 玫瑰描边 + 柔光晕
     —— 全透不等于看不见，靠描边和发光立住。 */
  --dshlg-gear-tone: 214, 31, 105;
  background-image: linear-gradient(150deg,
    rgba(255, 255, 255, ${dark ? 0.3 : 0.5}) 0%,
    rgba(var(--dshlg-gear-tone), ${dark ? 0.16 : 0.2}) 40%,
    rgba(var(--dshlg-gear-tone), ${dark ? 0.26 : 0.3}) 66%,
    rgba(255, 255, 255, ${dark ? 0.18 : 0.34}) 100%);
  border: 1px solid rgba(var(--dshlg-gear-tone), ${dark ? 0.85 : 0.95});
  border-radius: 50%;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, ${dark ? 0.75 : 1}),
    inset 0 -2px 4px rgba(var(--dshlg-gear-tone), 0.5),
    0 0 12px rgba(var(--dshlg-gear-tone), ${dark ? 0.6 : 0.7}),
    0 4px 14px rgba(var(--dshlg-gear-tone), 0.45);
  animation: dshlg-gem-glow 3.6s ease-in-out infinite;
}
#${GEAR_ID}[data-dshlg-moved] { cursor: grab; }
#${CTRL_ID}[data-dshlg-moved] { cursor: grab; }
#${GEAR_ID}:hover {
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 1),
    inset 0 -2px 4px rgba(var(--dshlg-gear-tone), 0.6),
    0 0 18px rgba(var(--dshlg-gear-tone), 0.9),
    0 4px 16px rgba(var(--dshlg-gear-tone), 0.55);
}
@keyframes dshlg-gem-glow {
  0%, 100% { filter: brightness(1); }
  50% { filter: brightness(1.12); }
}
@media (prefers-reduced-motion: reduce) {
  #${GEAR_ID} { animation: none; }
}

/* ══ 设置面板 ══════════════════════════════════════════════════
   和控制条一样：不做 backdrop 滤镜（动画壁纸下会闪），
   玻璃感由描边 + 顶光给出。 */
#${SETTINGS_ID} {
  /* 壁纸控制条：蓝白玻璃（全透 = 低填充，靠描边与高光立住） */
  /* 与 Agent-枝星 同一套冰钻色（品牌字标的渐变主色是 #7dd3fc / #bae6fd）。
     变量命名与齿轮的 --dshlg-gear-tone 保持同一模式。 */
  --dshlg-bar-tone: 125, 211, 252;
  position: fixed;
  left: 18px;
  bottom: 96px;
  z-index: 2147483000;
  width: min(420px, calc(100vw - 36px));
  max-height: min(70vh, 520px);
  overflow: auto;
  padding: 12px 14px;
  font: 13px/1.5 "Segoe UI", system-ui, "Microsoft YaHei", sans-serif;
  /* 文字用**粉色系**而不是白 —— 深色模式下原来是近白 #fff0f6，用户反馈「字体还是白色」。
     再配一层阴影，保证在浅色壁纸上也读得出。 */
  /* 明确的粉色，不是淡粉（#ffd0e6 看着仍接近白）。
     深色模式用饱和粉、浅色模式用深洋红，一眼能看出是彩色。 */
  /* 字色与底色可由 JS 自适应覆盖（见 adaptPanelReadability） */
  color: var(--dshlg-panel-ink, ${dark ? '#ff9ecb' : '#8a1046'});
  text-shadow: ${dark
    ? '0 1px 2px rgba(0, 0, 0, 0.6)'
    : '0 1px 1px rgba(255, 255, 255, 0.55)'};
  /* 更透：原来 0.24/0.34 偏厚，用户要「更透一些」。玻璃感交给描边 + 顶光。 */
  /* 用户要「更透」：再降一档。玻璃边界由描边 + 顶光交代。 */
  background: var(--dshlg-panel-veil, rgba(var(--dshlg-bar-tone), ${dark ? 0.06 : 0.08}));
  border: 1px solid rgba(var(--dshlg-bar-tone), ${dark ? 0.55 : 0.85});
  border-radius: 16px;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, ${dark ? 0.55 : 0.95}),
    0 12px 34px rgba(var(--dshlg-bar-tone), 0.35),
    0 12px 34px rgba(0, 0, 0, ${dark ? 0.45 : 0.18});
}
#${SETTINGS_ID}[hidden] { display: none; }
#${SETTINGS_ID} .head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  font-size: 14px;
}
#${SETTINGS_ID} .head .grow { flex: 1; }
#${SETTINGS_ID} .head button {
  font: inherit;
  padding: 3px 10px;
  cursor: pointer;
  color: inherit;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(var(--dshlg-bar-tone), 0.6);
  border-radius: 8px;
}
#${SETTINGS_ID} .head button:hover { background: rgba(255, 255, 255, 0.22); }
#${SETTINGS_ID} .row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}
#${SETTINGS_ID} .row .label { flex: none; width: 108px; opacity: 0.9; }
#${SETTINGS_ID} .seg { display: flex; flex-wrap: wrap; gap: 6px; }
#${SETTINGS_ID} .seg button {
  font: inherit;
  padding: 3px 9px;
  cursor: pointer;
  color: inherit;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(var(--dshlg-bar-tone), 0.5);
  border-radius: 8px;
}
#${SETTINGS_ID} .seg button:hover { background: rgba(255, 255, 255, 0.2); }
#${SETTINGS_ID} .seg button.is-on {
  background: rgba(255, 255, 255, 0.3);
  border-color: rgba(var(--dshlg-bar-tone), 0.95);
  font-weight: 600;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8);
}
#${SETTINGS_ID} .range { display: inline-flex; align-items: center; gap: 8px; flex: 1; min-width: 0; }
#${SETTINGS_ID} .range input[type='range'] { flex: 1; min-width: 0; accent-color: #93c5fd; cursor: pointer; }
#${SETTINGS_ID} .range b { font-weight: 600; opacity: 0.85; min-width: 2.6em; text-align: right; }
#${SETTINGS_ID} input[type='text'] {
  flex: 1;
  min-width: 0;
  font: inherit;
  padding: 4px 8px;
  color: inherit;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(var(--dshlg-bar-tone), 0.55);
  border-radius: 8px;
}
#${SETTINGS_ID} input[type='text']::placeholder { color: currentColor; opacity: 0.5; }

/* ══ 控制中心（复用控制条 / 设置面板同一套材质）══════════════════
   不新增色调变量：全部来自 --dshlg-bar-tone（冰钻蓝白）与
   --dshlg-panel-veil / --dshlg-panel-ink（由 adaptPanelReadability 写）。
   刻意不做 backdrop-filter：动画壁纸下会闪，且会变成 fixed 后代的包含块。
   定位用 left + bottom（和设置面板/控制条同一约定）—— 拖动复用
   makeDraggable，它只写 left/bottom，用 top/transform 居中会被抻变形。 */
#${CC_ID} {
  --dshlg-bar-tone: 125, 211, 252;
  position: fixed;
  left: 18px;
  bottom: 96px;
  z-index: 2147483001;
  display: none;
  flex-direction: column;
  width: min(760px, calc(100vw - 36px));
  height: min(560px, calc(100vh - 120px));
  /* 面板自己的配色变量 —— 不复用 --dshlg-panel-ink/-veil：
     那两个由 adaptPanelReadability 写给设置面板，会被那边的自适应结果串进来。 */
  --dshlg-cc-ink: ${dark ? '#e8eefb' : '#0f1a2e'};          /* 近黑/近白的中性墨色，最耐看 */
  --dshlg-cc-ink-dim: ${dark ? '#9fb0cc' : '#5a6b86'};      /* 次要信息 */
  --dshlg-cc-line: ${dark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(15, 26, 46, 0.08)'};
  /* 果冻的「厚度」：0.72/0.78 → 0.84/0.86（不太透，但仍能看见壁纸在动） */
  --dshlg-cc-veil: ${dark ? 'rgba(18, 23, 33, 0.84)' : 'rgba(250, 252, 255, 0.86)'};
  /* 果汁色：果冻本体的冰蓝，用在底部内发光与描边上 */
  --dshlg-cc-jelly: ${dark ? '80, 150, 220' : '125, 198, 245'};
  /* 排版：系统 UI 字体栈优先，Win11 用 Segoe UI Variable，中文回落 YaHei UI；
     14px/1.65 比原来的 13px/1.5 更适合中文长文本阅读。 */
  font: 400 14px/1.65 "Segoe UI Variable Text", "Segoe UI", system-ui,
    -apple-system, "Microsoft YaHei UI", "PingFang SC", "Hiragino Sans GB", sans-serif;
  letter-spacing: 0.01em;
  /* 关键：面板自己有模糊底，**不能再给文字加阴影** —— 阴影叠在模糊玻璃上会让字发虚。
     这是「字不清晰」的主因。对比度交给底色与墨色，不交给描边。 */
  text-shadow: none;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
  color: var(--dshlg-cc-ink);
  border: 1px solid rgba(var(--dshlg-bar-tone), ${dark ? 0.45 : 0.7});
  border-radius: 22px;
  /* 果冻的四层光影：
     顶内白边（受光面）→ 底内冰蓝柔光（透光感）→ 外圈冰蓝柔晕 → 大范围落影（软胶厚度） */
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, ${dark ? 0.6 : 1}),
    inset 0 -14px 28px rgba(var(--dshlg-cc-jelly), ${dark ? 0.16 : 0.22}),
    inset 0 0 0 1px rgba(255, 255, 255, ${dark ? 0.06 : 0.28}),
    0 6px 18px rgba(var(--dshlg-cc-jelly), ${dark ? 0.3 : 0.35}),
    0 20px 48px rgba(var(--dshlg-cc-jelly), ${dark ? 0.22 : 0.22}),
    0 24px 64px rgba(0, 0, 0, ${dark ? 0.5 : 0.18});
  overflow: hidden;
  /* isolation 保证 ::before 的 z-index:-1 被锁在面板自己的层叠上下文里，
     不会跑到页面背景后面去。 */
  isolation: isolate;
  /* 元素本身不画底、也不做模糊 —— 两者都在 ::before 上（见下方注释）。 */
  background: transparent;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}
/* ── 高斯模糊玻璃层（控制中心专用；只作用于这个面板）──────────────
   为什么画在伪元素而不是面板本身：
     backdrop-filter 会让元素成为 position:fixed 后代的包含块 —— 面板里将来
     若加入 fixed/绝对定位浮层会被重新锚定（本项目在侧栏收起按钮上踩过）。
   为什么纱也在这一层：
     模糊采样的是「背后已绘制的内容」。纱若画在元素自身背景上，就会位于
     伪元素模糊层之下，被一起糊成一片白 —— 等于白透。同一层才是
     「先模糊背景、再叠纱」的正确顺序。
   模糊半径 20px + saturate 1.5：够糊掉背景纹理，又不至于看不见壁纸颜色。 */
#${CC_ID}::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  border-radius: inherit;
  pointer-events: none;
  /* 三层叠在同一个伪元素上（这样高光永远在内容之下，不会把字洗白）：
     ① 顶部高光：白 → 透明，模拟光打在圆润表面上
     ② 果冻底色：底部冰蓝略深，做出「果汁沉积」的透光感
     ③ 主纱：承担不透明度，保证不太透
     模糊 24px + saturate 1.7：背景糊得更彻底，颜色也更「juicy」 */
  background:
    linear-gradient(180deg,
      rgba(255, 255, 255, ${dark ? 0.16 : 0.5}) 0%,
      rgba(255, 255, 255, ${dark ? 0.05 : 0.16}) 34%,
      rgba(255, 255, 255, 0) 58%),
    linear-gradient(180deg,
      rgba(var(--dshlg-cc-jelly), 0) 46%,
      rgba(var(--dshlg-cc-jelly), ${dark ? 0.12 : 0.16}) 100%),
    var(--dshlg-cc-veil);
  backdrop-filter: blur(24px) saturate(1.7);
  -webkit-backdrop-filter: blur(24px) saturate(1.7);
  -webkit-backdrop-filter: blur(20px) saturate(1.5);
}
/* 系统「减少透明度」档位：退回实色、去掉模糊（无障碍要求优先） */
@media (prefers-reduced-transparency: reduce) {
  #${CC_ID}::before {
    background: ${dark ? 'rgba(20, 25, 35, 0.99)' : 'rgba(252, 253, 255, 0.99)'} !important;
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
  }
}
#${CC_ID}[data-dshlg-cc-open] { display: flex; }
#${CC_ID}[hidden] { display: none; }

/* ── 面板内部的排版细节（高级感来自这些克制的统一）───────────────── */
#${CC_ID} h1, #${CC_ID} h2, #${CC_ID} h3 {
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--dshlg-cc-ink);
}
#${CC_ID} .dim, #${CC_ID} .muted, #${CC_ID} small {
  color: var(--dshlg-cc-ink-dim);
  font-weight: 400;
}
/* 数字用等宽数字，列表里的计数不会左右跳 */
#${CC_ID} {
  font-variant-numeric: tabular-nums;
}
/* 分隔线改用极淡的中性色，比彩色描边更「贵」 */
#${CC_ID} hr, #${CC_ID} .sep-line {
  border: 0;
  border-top: 1px solid var(--dshlg-cc-line);
}
/* 输入框：去掉浏览器默认外观，统一到面板墨色 */
#${CC_ID} input[type='text'], #${CC_ID} input[type='search'] {
  font: inherit;
  color: var(--dshlg-cc-ink);
  background: ${dark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(15, 26, 46, 0.04)'};
  border: 1px solid var(--dshlg-cc-line);
  border-radius: 10px;
  padding: 7px 10px;
  outline: none;
  text-shadow: none;
}
#${CC_ID} input:focus-visible {
  border-color: rgba(var(--dshlg-bar-tone), 0.9);
  box-shadow: 0 0 0 3px rgba(var(--dshlg-bar-tone), ${dark ? 0.25 : 0.3});
}
/* 键盘可达性：焦点环清晰可见 */
#${CC_ID} button:focus-visible, #${CC_ID} [tabindex]:focus-visible {
  outline: 2px solid rgba(var(--dshlg-bar-tone), 0.95);
  outline-offset: 2px;
}
/* 次要按钮：比主按钮更克制 */
#${CC_ID} button.secondary {
  color: var(--dshlg-cc-ink-dim);
  background: ${dark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(15, 26, 46, 0.04)'};
  border-color: var(--dshlg-cc-line);
}

/* 面板外部的点击兜底面：只负责接住「点外部」这一下。
   刻意不铺任何底色 —— 铺了就等于给整页加一层幕布，和「全透」冲突。 */
#${CC_BACKDROP_ID} {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  display: none;
  background: transparent;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}
#${CC_BACKDROP_ID}[data-dshlg-cc-open] { display: block; }
#${CC_ID} .cc-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.14);
  cursor: grab;
}
#${CC_ID} .cc-head b { font-size: 14px; font-weight: 600; letter-spacing: .02em; }
#${CC_ID} .cc-head .grow { flex: 1; }
#${CC_ID} .cc-head button {
  font: inherit;
  padding: 4px 10px;
  cursor: pointer;
  color: inherit;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(var(--dshlg-bar-tone), 0.6);
  border-radius: 8px;
}
#${CC_ID} .cc-head button:hover { background: rgba(255, 255, 255, 0.22); }
#${CC_ID} .cc-tabs {
  display: flex;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
}
#${CC_ID} .cc-tabs button {
  font: inherit;
  padding: 5px 14px;
  cursor: pointer;
  color: inherit;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(var(--dshlg-bar-tone), 0.45);
  border-radius: 9px;
}
#${CC_ID} .cc-tabs button:hover { background: rgba(255, 255, 255, 0.18); }
#${CC_ID} .cc-tabs button.is-on {
  background: rgba(255, 255, 255, 0.3);
  border-color: rgba(var(--dshlg-bar-tone), 0.95);
  font-weight: 600;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8);
}
#${CC_ID} .cc-tabs button:focus-visible,
#${CC_ID} .cc-head button:focus-visible,
#${CC_ID} .cc-btn:focus-visible {
  outline: 2px solid rgba(var(--dshlg-bar-tone), 0.95);
  outline-offset: 1px;
}
#${CC_ID} .cc-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px 14px 16px;
}
#${CC_ID} .cc-sec { margin-bottom: 14px; }
#${CC_ID} .cc-sec > h4 {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: .06em;
  opacity: .78;
}
#${CC_ID} .cc-btn {
  font: inherit;
  padding: 4px 11px;
  cursor: pointer;
  color: inherit;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(var(--dshlg-bar-tone), 0.6);
  border-radius: 8px;
}
#${CC_ID} .cc-btn:hover:not(:disabled) { background: rgba(255, 255, 255, 0.22); }
#${CC_ID} .cc-btn:disabled { opacity: .45; cursor: not-allowed; }
#${CC_ID} .cc-btn.cc-go { border-color: rgba(var(--dshlg-bar-tone), 0.95); font-weight: 600; }
#${CC_ID} .cc-btn.cc-danger { border-color: rgba(248, 113, 113, 0.9); color: ${dark ? '#fecaca' : '#7f1d1d'}; }
#${CC_ID} .cc-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 11px;
  margin-bottom: 7px;
}
#${CC_ID} .cc-row.is-current {
  border-color: rgba(var(--dshlg-bar-tone), 0.95);
  background: rgba(255, 255, 255, 0.14);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.5);
}
#${CC_ID} .cc-row .cc-main { flex: 1; min-width: 0; }
#${CC_ID} .cc-row .cc-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#${CC_ID} .cc-row .cc-path {
  opacity: .7;
  font-size: 11.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
#${CC_ID} .cc-row .cc-meta { display: flex; align-items: center; gap: 5px; flex: none; flex-wrap: wrap; justify-content: flex-end; max-width: 45%; }
#${CC_ID} .cc-chip {
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 999px;
  border: 1px solid rgba(var(--dshlg-bar-tone), 0.55);
  background: rgba(255, 255, 255, 0.08);
  white-space: nowrap;
}
#${CC_ID} .cc-chip.cc-cur { border-color: rgba(var(--dshlg-bar-tone), 0.95); font-weight: 600; }
#${CC_ID} .cc-chip.cc-warn { border-color: rgba(250, 204, 21, 0.8); }
#${CC_ID} .cc-chip.cc-bad { border-color: rgba(248, 113, 113, 0.85); }
#${CC_ID} .cc-note,
#${CC_ID} .cc-empty,
#${CC_ID} .cc-degraded {
  padding: 10px 12px;
  border-radius: 11px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.06);
}
#${CC_ID} .cc-degraded { border-color: rgba(250, 204, 21, 0.7); }
#${CC_ID} .cc-degraded .cc-why { opacity: .78; font-size: 12px; margin-top: 4px; word-break: break-all; }
#${CC_ID} .cc-actions { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; align-items: center; }
#${CC_ID} .cc-confirm {
  margin-top: 8px;
  padding: 10px 12px;
  border-radius: 11px;
  border: 1px solid rgba(250, 204, 21, 0.75);
  background: rgba(250, 204, 21, 0.12);
}
#${CC_ID} .cc-form { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
#${CC_ID} .cc-form label { font-size: 12px; opacity: .8; }
#${CC_ID} .cc-form input[type='text'] {
  font: inherit;
  padding: 5px 9px;
  color: inherit;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(var(--dshlg-bar-tone), 0.55);
  border-radius: 8px;
}
#${CC_ID} .cc-form input[type='text']::placeholder { color: currentColor; opacity: .5; }
#${CC_ID} .cc-kv { display: flex; gap: 8px; padding: 4px 0; border-top: 1px solid rgba(255, 255, 255, 0.1); }
#${CC_ID} .cc-kv .k { flex: none; width: 150px; opacity: .8; }
#${CC_ID} .cc-kv .v { flex: 1; min-width: 0; word-break: break-all; }
#${CC_ID} .cc-note.cc-err { border-color: rgba(248, 113, 113, 0.85); }
#${CC_ID} .cc-note.cc-ok { border-color: rgba(var(--dshlg-bar-tone), 0.85); }
#${CC_ID} .cc-tail { opacity: .62; font-size: 11.5px; margin-top: 6px; }
/* 壁纸很亮时，这些面板和设置面板一样需要深字（沿用同一套覆盖） */
html[data-dshlg-bright-wall] #${CC_ID},
html[data-dshlg-bright-wall] #${CC_ID} * { color: #1a1030; text-shadow: 0 1px 1px rgba(255, 255, 255, 0.6); }

@keyframes dshlg-restore-glow {
  0%, 100% { filter: brightness(1); }
  50% { filter: brightness(1.22); }
}
@keyframes dshlg-bar-glow {
  0%, 100% { filter: brightness(1); }
  50% { filter: brightness(1.1); }
}
@media (prefers-reduced-motion: reduce) {
  #${CTRL_ID} { animation: none !important; }
}
#${CTRL_ID} {
  --dshlg-bar-tone: 125, 211, 252;
  animation: dshlg-bar-glow 3.6s ease-in-out infinite;
  position: fixed;
  left: 18px;      /* 与上方控制条同一列 */
  bottom: 18px;
  z-index: 2147483000;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 11px;
  border-radius: 14px;
  font: 12.5px/1.4 "Segoe UI", system-ui, sans-serif;
  color: ${dark ? '#fff0f6' : '#5b1236'};
  /* 粉红色液态玻璃：透明底 + 粉色边缘光学，不糊背景 */
  /* 冰钻渐变切面（与 Agent-枝星 同色系）：斜向 150°，
     白 → 冰蓝 → 亮蓝 → 青，带透明度所以仍然是「全透」。
     比平涂更容易看出是蓝的 —— 平涂单一色在低透明度下会读成白。 */
  background-image: linear-gradient(150deg,
    rgba(255, 255, 255, ${dark ? 0.34 : 0.5}) 0%,
    rgba(224, 242, 254, ${dark ? 0.26 : 0.36}) 22%,
    rgba(var(--dshlg-bar-tone), ${dark ? 0.3 : 0.4}) 48%,
    rgba(165, 243, 252, ${dark ? 0.26 : 0.36}) 72%,
    rgba(255, 255, 255, ${dark ? 0.3 : 0.44}) 100%);
  /* 描边要够亮 —— 这是「看得见」的关键 */
  border: 1px solid rgba(186, 230, 253, ${dark ? 0.85 : 1});
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, ${dark ? 0.5 : 0.85}),
    inset 0 0 0 5px rgba(165, 243, 252, ${dark ? 0.22 : 0.34}),
    0 0 14px rgba(var(--dshlg-bar-tone), ${dark ? 0.5 : 0.6}),
    0 8px 26px rgba(var(--dshlg-bar-tone), 0.4),
    0 8px 26px rgba(0,0,0,${dark ? 0.3 : 0.12});
  /* ⚠️ 这里**不能**用 backdrop-filter: url(#dshlg-refract)。
     SVG 滤镜做 backdrop 时，浏览器要在每一帧重新执行滤镜图；
     壁纸 iframe 本身在动（视频/流体），于是整条控制栏持续重绘 ——
     用户看到的就是「一直在闪」。改成纯半透明底 + 边缘光学：
     观感一致（同样是通透玻璃），但没有每帧滤镜开销，也就不闪了。 */
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  /* 平时压低存在感，鼠标移上去变清楚 */
  opacity: ${dark ? 0.66 : 0.82};
  transition: opacity .2s ease, box-shadow .2s ease;
}
#${CTRL_ID}:hover {
  opacity: 1;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, ${dark ? 0.7 : 0.95}),
    inset 0 0 0 5px rgba(var(--dshlg-bar-tone), ${dark ? 0.28 : 0.42}),
    0 10px 32px rgba(var(--dshlg-bar-tone), 0.5),
    0 10px 30px rgba(0,0,0,${dark ? 0.36 : 0.16});
}
/* 控制条收起后的「找回」圆点：透明液态玻璃，平时很淡，悬停才明显 */
/* 品牌图标的配色规则不在这里 —— 它们属于品牌区，
   已统一放在内联 CSS（CRITICAL_CSS）里，避免出现第二份真相：
   这份旧规则曾经把鱼标染成浅蓝，且因为动态样式层叠更靠后而盖过内联规则。 */
#${RESTORE_ID} {
  position: fixed;
  /* 用户反馈：收起后这个圆点压着左下角的「枝星」和头像 —— 右移让开。
     控制条本身仍按定稿留在左下角（展开挡输入框可接受），只有圆点挪开。 */
  left: 132px;
  bottom: 18px;
  z-index: 2147483000;
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  font: 13px/1 "Segoe UI", system-ui, sans-serif;
  color: #fff;
  cursor: pointer;
  /* 深玫瑰切面（与齿轮同色系）—— 冰蓝在这个位置太淡、不明显。
     控制条用冰钻蓝白，两个「工具钮」统一用玫瑰色，功能上一眼分得开。 */
  --dshlg-restore-tone: 37, 99, 235;
  background-image: linear-gradient(150deg,
    rgba(255, 255, 255, ${dark ? 0.62 : 0.82}) 0%,
    rgba(var(--dshlg-restore-tone), ${dark ? 0.62 : 0.7}) 28%,
    rgba(29, 78, 216, ${dark ? 0.8 : 0.86}) 60%,
    rgba(96, 165, 250, ${dark ? 0.66 : 0.74}) 100%);
  border: 1px solid rgba(255, 255, 255, ${dark ? 0.75 : 0.95});
  border-radius: 50%;  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, ${dark ? 0.8 : 1}),
    inset 0 -2px 5px rgba(29, 78, 216, 0.7),
    0 0 16px rgba(var(--dshlg-restore-tone), 0.9),
    0 6px 20px rgba(var(--dshlg-restore-tone), 0.6);
  /* 同控制条：不用 SVG 滤镜做 backdrop（壁纸在动时会每帧重绘图，表现为闪烁）。 */
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  /* 别做太淡：入口做出来却看不见，等于没有。 */
  opacity: ${dark ? 0.92 : 0.95};
  animation: dshlg-restore-in 1.6s ease-out 2;
}
#${RESTORE_ID}:hover {
  opacity: 1;
  transform: scale(1.08);
}
@keyframes dshlg-restore-in {
  0%, 100% { box-shadow: inset 0 1px 0 rgba(${tone}, ${dark ? 0.3 : 0.65}), 0 6px 18px rgba(0,0,0,${dark ? 0.3 : 0.12}); }
  50% { box-shadow: inset 0 1px 0 rgba(${tone}, 0.5), 0 6px 22px rgba(${dark ? '96,165,250' : '37,99,235'}, 0.45); }
}
@media (prefers-reduced-motion: reduce) {
  #${RESTORE_ID} { animation: none; }
}
#${CTRL_ID} .sep {
  width: 1px; align-self: stretch;
  background: rgba(${tone}, ${dark ? 0.2 : 0.7});
}
#${CTRL_ID} button {
  font: inherit;
  padding: 4px 10px;
  border-radius: 9px;
  border: 1px solid rgba(255, 255, 255, ${dark ? 0.5 : 0.8});
  /* 按钮也是小宝石：斜向切面 + 顶部高光 */
  background-image: linear-gradient(150deg,
    rgba(255, 255, 255, ${dark ? 0.5 : 0.8}) 0%,
    rgba(224, 242, 254, ${dark ? 0.28 : 0.4}) 34%,
    rgba(var(--dshlg-bar-tone), ${dark ? 0.34 : 0.46}) 68%,
    rgba(165, 243, 252, ${dark ? 0.3 : 0.42}) 100%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, ${dark ? 0.5 : 0.85});
  color: inherit;
  cursor: pointer;
  /* ⚠️ 这里**不能**加 transition：壁纸的高频回报会让 .is-on 反复切换，
     背景就跟着来回渐变 —— 用户看到的就是「按钮的底一直在闪」。 */
}
#${CTRL_ID} button:hover { background: rgba(var(--dshlg-bar-tone), ${dark ? 0.3 : 0.6}); }
#${CTRL_ID} button.is-on {
  background: ${dark ? 'rgba(96,165,250,.34)' : 'rgba(37,99,235,.24)'};
  border-color: ${dark ? 'rgba(147,197,253,.6)' : 'rgba(37,99,235,.5)'};
  font-weight: 600;
}
#${CTRL_ID} input[type=range] {
  width: 76px;
  accent-color: ${dark ? '#60a5fa' : '#2563eb'};
  cursor: pointer;
}
#${CTRL_ID} select {
  font: inherit;
  max-width: 150px;
  padding: 4px 8px;
  border-radius: 9px;
  border: 1px solid rgba(${tone}, ${dark ? 0.22 : 0.7});
  background: ${dark ? 'rgba(20,26,38,.85)' : 'rgba(255,255,255,.85)'};
  color: inherit;
  cursor: pointer;
}
#${CTRL_ID} select option {
  background: ${dark ? '#141a26' : '#ffffff'};
  color: ${dark ? '#e8eef8' : '#1e293b'};
}
#${CTRL_ID} .tag {
  opacity: .62;
  font-size: 11.5px;
  letter-spacing: .03em;
}

/* ── 壁纸画廊（缩略图九宫格）────────────────────────────── */
#${GALLERY_ID} {
  position: fixed;
  left: 18px;      /* 与控制条同一左边界 */
  bottom: 74px;
  z-index: 2147483000;
  width: min(760px, calc(100vw - 36px));
  max-height: min(62vh, 560px);
  display: flex;
  flex-direction: column;
  padding: 12px;
  border-radius: 16px;
  font: 12.5px/1.4 "Segoe UI", system-ui, sans-serif;
  color: ${dark ? '#e8eef8' : '#1e293b'};
  background: linear-gradient(180deg,
    rgba(${tone}, ${dark ? 0.2 : 0.62}) 0%,
    rgba(${tone}, ${dark ? 0.12 : 0.5}) 100%);
  border: 1px solid rgba(${tone}, ${dark ? 0.3 : 0.7});
  box-shadow:
    inset 0 1px 0 rgba(${tone}, ${dark ? 0.4 : 0.85}),
    0 22px 60px rgba(0,0,0,${dark ? 0.5 : 0.24});
  backdrop-filter: blur(22px) saturate(1.7);
  -webkit-backdrop-filter: blur(22px) saturate(1.7);
  overflow: hidden;
}
#${GALLERY_ID}[hidden] { display: none; }
#${GALLERY_ID} .head {
  display: flex; align-items: center; gap: 10px;
  padding: 0 2px 10px;
  flex: none;
}
#${GALLERY_ID} .head b { font-weight: 600; letter-spacing: .02em; }
#${GALLERY_ID} .head .count { opacity: .66; font-size: 11.5px; }
#${GALLERY_ID} .head .grow { flex: 1; }
#${GALLERY_ID} .grid {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
  gap: 10px;
  padding: 2px;
}
#${GALLERY_ID} .card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px;
  border-radius: 11px;
  border: 1px solid rgba(${tone}, ${dark ? 0.16 : 0.5});
  background: rgba(${tone}, ${dark ? 0.06 : 0.28});
  cursor: pointer;
  text-align: left;
  color: inherit;
  font: inherit;
  transition: background .15s ease, border-color .15s ease, transform .15s ease;
}
#${GALLERY_ID} .card:hover {
  background: rgba(${tone}, ${dark ? 0.14 : 0.45});
  transform: translateY(-1px);
}
#${GALLERY_ID} .card.is-on {
  border-color: ${dark ? 'rgba(147,197,253,.85)' : 'rgba(37,99,235,.7)'};
  background: ${dark ? 'rgba(96,165,250,.22)' : 'rgba(37,99,235,.16)'};
}
#${GALLERY_ID} .card.is-bad { opacity: .45; cursor: not-allowed; }
#${GALLERY_ID} .thumb {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 10;
  border-radius: 8px;
  overflow: hidden;
  background: ${dark ? 'rgba(0,0,0,.45)' : 'rgba(0,0,0,.12)'};
  display: flex; align-items: center; justify-content: center;
  font-size: 20px; opacity: .9;
}
#${GALLERY_ID} .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
#${GALLERY_ID} .name {
  font-size: 12px;
  line-height: 1.3;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}
#${GALLERY_ID} .meta { font-size: 10.5px; opacity: .6; }
#${GALLERY_ID} .badge {
  position: absolute; top: 6px; right: 6px;
  padding: 1px 6px; border-radius: 7px;
  font-size: 10px;
  background: rgba(0,0,0,.55);
  color: #fff;
}
#${GALLERY_ID} .empty { padding: 18px 8px; opacity: .7; }
`;
    }

    /**
     * 控制条收起后留一个「找回」圆点。
     *
     * 为什么必须有：原来点收起是彻底移除、且状态持久化，
     * 结果用户关掉重开就再也找不到那条工具栏了 —— 这是设计失误。
     * 圆点极简（28px 玻璃圆点，平时半透明），点一下就恢复整条控制栏。
     */
    function ensureRestoreDot() {
      let el = document.getElementById(RESTORE_ID);
      if (el) return el;
      el = document.createElement('button');
      el.id = RESTORE_ID;
      el.type = 'button';
      el.textContent = '❖';
      el.title = '显示壁纸控制条';
      el.setAttribute('aria-label', '显示壁纸控制条');
      el.addEventListener('click', (event) => {
        event.stopPropagation();
        setControlsHidden(false);
        el.remove();
        /* ⚠️ 模块级作用域里没有 pass（它是 applyGlass 的局部 const），
           必须走 requestPass 挂钩 —— 否则每次点圆点都抛 ReferenceError，
           控制条只能靠 MutationObserver 事后补建（observer 不在就永久失去）。 */
        requestPass(true);    // 立刻重建控制条
      });
      document.body.appendChild(el);
      try { makeDraggable(el, 'bar', (bar) => {
        /* 画廊跟控制条一起走，否则拖完就与条分家了 */
        const g = document.getElementById(GALLERY_ID);
        if (!g) return;
        const r = bar.getBoundingClientRect();
        g.style.left = Math.round(r.left) + 'px';
        g.style.bottom = Math.round(window.innerHeight - r.top + 10) + 'px';
      }); } catch { /* 拖动装不上也不影响其它功能 */ }
      if (applySavedPos(el, 'bar')) return el;
      avoidComposerOverlap(el);
      /* 首帧那一刻布局还没定型（输入框位置/高度随后才确定），
         下一帧再量一次；之后每次 pass 也会校正。 */
      requestAnimationFrame(() => avoidComposerOverlap(el));
      setTimeout(() => avoidComposerOverlap(el), 600);
      watchComposer();
      return el;
    }

    /**
     * 盯着输入框的尺寸变化，一变就重新校正控制条位置。
     * 只靠 pass 不够：输入框长高（附件/多行/工具行）不一定伴随 DOM 结构变化。
     */
    let composerRO = null;
    function watchComposer() {
      if (typeof ResizeObserver !== 'function') return;
      const seat = document.querySelector('[data-composer-seat], [class*="_composerSeat"], [data-conversation-region]');
      if (!seat) return;
      if (composerRO && composerRO.__target === seat) return;
      composerRO?.disconnect();
      composerRO = new ResizeObserver(() => {
        const bar = document.getElementById(CTRL_ID);
        if (bar) avoidComposerOverlap(bar);
      });
      composerRO.__target = seat;
      composerRO.observe(seat);
    }

    /**
     * 让控制条躲开中间栏的输入框。
     *
     * 为什么不写死一个 bottom 值：输入框的高度随内容变（附件、多行、工具行都会长高），
     * 写死必然在某些状态下又压上去。这里实测两者的矩形，真的重叠才抬上去。
     * 只改内联 bottom，不改 CSS —— CSS 里那份是「无输入框时」的默认位置。
     */
    let placementKey = '';
    function avoidComposerOverlap(el) {
      /* 用户手动拖过位置 → 不再自动上移 */
      if (el && el.dataset.dshlgMoved === '1') return;
      /* 用户定稿：控制条就贴在左下角，遮挡输入框可以接受 —— 所以默认不再避让。
         （避让逻辑保留着，把 CONFIG.wallpaper.avoidComposer 设 true 即可启用。） */
      if (!CONFIG.wallpaper.avoidComposer) {
        if (el.style.bottom) el.style.bottom = '';
        return;
      }
      try {
        const seat = document.querySelector(
          '[data-composer-seat], [class*="_composerSeat"], [class*="_composer"][data-phase], [data-conversation-region]',
        );
        if (!seat) return;
        const cr = seat.getBoundingClientRect();
        if (cr.height < 8) return;

        /* ⚠️ 这里**不能**读控制条当前的位置来判断是否重叠 ——
           那样会形成反馈振荡：贴底时判定重叠 → 上移 → 上移后再量已不重叠
           → 又移回贴底 → 再次重叠…… 用户看到的就是「异常跳动」。
           所以只按「贴底时的天然位置」算一次结论，与当前实际位置无关。 */
        const NATURAL_BOTTOM = 18;
        const barH = el.offsetHeight || 34;
        const barW = el.offsetWidth || 420;
        const barL = 72;                                   // CSS 里的左边界
        const naturalTop = window.innerHeight - NATURAL_BOTTOM - barH;

        const overlapsX = barL < cr.right && barL + barW > cr.left;
        const wouldOverlapY = naturalTop < cr.bottom && window.innerHeight - NATURAL_BOTTOM > cr.top;

        const want = overlapsX && wouldOverlapY
          ? Math.max(NATURAL_BOTTOM, Math.round(window.innerHeight - cr.top + 10))
          : NATURAL_BOTTOM;

        /* 布局签名没变就一律不动 —— 重复调用是幂等的，不会抖动。 */
        const key = [want, Math.round(cr.top), Math.round(cr.height), barH, window.innerHeight].join('|');
        if (key === placementKey) return;
        placementKey = key;
        const next = want + 'px';
        if (el.style.bottom !== next) el.style.bottom = next;
      } catch { /* 量不到就按默认位置放 */ }
    }

    /**
     * 注入「深蓝宝石」渐变定义（幂等）。
     *
     * 为什么需要它：品牌区的鱼标与字标都是 SVG 形状（官方 BrandWordmark 是
     * 7 个 fill="currentColor" 的 path），**CSS 的 linear-gradient 不能直接
     * 当作 SVG 的填充**；但 fill: url(#id) 可以引用文档里的 <linearGradient>。
     * 所以这里放一个 0 尺寸的 <svg><defs>，供 CSS 里的 fill: url(#dshlg-sapphire) 使用。
     *
     * 四个色标模拟宝石折光：亮蓝高光 → 中蓝 → 深宝蓝 → 近黑蓝。
     */
    function ensureSapphireDefs() {
      if (document.getElementById(SAPPHIRE_ID)) return;
      const NS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(NS, 'svg');
      svg.id = SAPPHIRE_ID;
      svg.setAttribute('width', '0');
      svg.setAttribute('height', '0');
      svg.setAttribute('aria-hidden', 'true');
      svg.style.position = 'absolute';
      svg.style.pointerEvents = 'none';
      const defs = document.createElementNS(NS, 'defs');

      /* 主渐变：斜向 135°，从左上高光斜切到右下深色 —— 宝石的经典光路 */
      const grad = document.createElementNS(NS, 'linearGradient');
      grad.id = 'dshlg-sapphire';
      grad.setAttribute('x1', '0');
      grad.setAttribute('y1', '0');
      grad.setAttribute('x2', '0.45');
      grad.setAttribute('y2', '1');
      for (const [offset, color] of [
        ['0%', '#7dd3fc'],      // 顶部亮蓝高光
        ['26%', '#3b82f6'],     // 中蓝
        ['58%', '#1d4ed8'],     // 宝蓝
        ['82%', '#1e3a8a'],     // 深宝蓝
        ['100%', '#172554'],    // 近黑蓝（收边）
      ]) {
        const stop = document.createElementNS(NS, 'stop');
        stop.setAttribute('offset', offset);
        stop.setAttribute('stop-color', color);
        defs.appendChild(stop.parentNode ? stop : stop); // 占位，下面统一 append
        grad.appendChild(stop);
      }
      defs.appendChild(grad);
      svg.appendChild(defs);
      document.body.appendChild(svg);
    }


    /**
     * 设置项：读写 localStorage、并把值合并回 CONFIG。
     *
     * 为什么是自带面板而不是 DSH 的原生设置页：
     * 原生设置页要走 ctx.slots / settingsScope，而这些 API 在 0.1.1-rc.2 变过
     * （settings.plugin.item 从 list 改 keyed，ctx.slots.inject 被移除），
     * 且要写进 inject 数组 —— 服务不存在时**插件直接不激活**。
     * 前几轮已经因为激活失败把整个界面弄没过两次，所以先做零风险的自带面板。
     */
    const SETTING_SPECS = [
      { key: 'glassTier', label: '通透度', type: 'seg',
        options: [['off', '全透明'], ['thin', '微纱 1.5%'], ['regular', '白纱 3%'], ['clear', '白纱 8%']] },
      { key: 'brandGem', label: '品牌宝石色', type: 'seg',
        options: [['ice', '冰钻白蓝'], ['gold', '香槟金'], ['aqua', '青玉']] },
      { key: 'brandLabel', label: '品牌文字', type: 'text' },
      { key: 'brandAlpha', label: '品牌底色', type: 'seg',
        options: [['0', '无底'], ['0.2', '淡'], ['0.42', '明显']] },
      { key: 'barAvoid', label: '控制条让开输入框', type: 'seg',
        options: [['0', '不让开（贴左下）'], ['1', '自动上移']] },
      { key: 'wallpaperDim', label: '壁纸压暗', type: 'range', min: 0, max: 0.8, step: 0.05 },
      { key: 'controls', label: '显示壁纸控制条', type: 'seg',
        options: [['1', '显示'], ['0', '隐藏']] },
    ];

    function loadSettings() {
      try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; }
      catch { return {}; }
    }

    function saveSetting(key, value) {
      try {
        const all = loadSettings();
        all[key] = value;
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(all));
      } catch { /* 存不了就只影响本次会话 */ }
    }

    /** 把设置合并回 CONFIG（启动时 + 每次改动后各调一次）。 */
    function applySettings() {
      const st = loadSettings();
      try {
        if (typeof st.glassTier === 'string' && st.glassTier in GLASS_TIERS) CONFIG.glassTier = st.glassTier;
        if (CONFIG.brand && typeof CONFIG.brand === 'object') {
          if (typeof st.brandGem === 'string') CONFIG.brand.gem = st.brandGem;
          if (typeof st.brandLabel === 'string') CONFIG.brand.label = st.brandLabel;
          if (st.brandAlpha !== undefined && st.brandAlpha !== '') CONFIG.brand.alpha = Number(st.brandAlpha);
        }
        /* 宝石配色写在 html 属性上，CSS 按属性选预设。
           必须在这里（而不是只在品牌绘制里）写 —— 设置面板改完要**立即**生效，
           等下一遍绘制会让点击后的瞬间读取不到新值。 */
        if (CONFIG.brand && CONFIG.brand.gem) {
          document.documentElement.dataset.dshlgGem = String(CONFIG.brand.gem);
        }
        if (typeof st.barAvoid !== 'undefined') CONFIG.wallpaper.avoidComposer = String(st.barAvoid) === '1';
        if (typeof st.controls !== 'undefined') CONFIG.wallpaper.controls = String(st.controls) === '1';
        /* 壁纸压暗：用户手动设过就以手动值为准（>0 才算手动，0 视为「没设」） */
        if (st.wallpaperDim !== undefined && st.wallpaperDim !== '' && Number(st.wallpaperDim) > 0) {
          CONFIG.wallpaper.dim = Number(st.wallpaperDim);
          document.documentElement.dataset.dshlgDimManual = '1';
        } else {
          delete document.documentElement.dataset.dshlgDimManual;
        }
      } catch (error) {
        console.warn('[dsh-liquid-glass] 应用设置失败：', error);
      }
    }

    /** 设置面板的值（含默认值），供渲染时高亮当前项。 */
    function currentSettings() {
      const st = loadSettings();
      return {
        glassTier: st.glassTier ?? CONFIG.glassTier,
        brandGem: st.brandGem ?? (CONFIG.brand && CONFIG.brand.gem) ?? 'ice',
        brandLabel: st.brandLabel ?? (CONFIG.brand && CONFIG.brand.label) ?? '',
        brandAlpha: String(st.brandAlpha ?? (CONFIG.brand && CONFIG.brand.alpha) ?? 0),
        barAvoid: String(st.barAvoid ?? (CONFIG.wallpaper.avoidComposer ? '1' : '0')),
        controls: String(st.controls ?? (CONFIG.wallpaper.controls ? '1' : '0')),
        wallpaperDim: String(st.wallpaperDim ?? CONFIG.wallpaper.dim ?? 0.15),
      };
    }

    /** 改动落地：写 localStorage → 合并回 CONFIG → 立即重画一遍。 */
    function commitSetting(key, value, fromTextInput) {
      saveSetting(key, value);
      applySettings();
      if (key === 'controls' && String(value) === '0') setControlsHidden(true);
      if (key === 'controls' && String(value) === '1') setControlsHidden(false);
      requestPass(true);
      /* ⚠️ 文本框输入时**不能**重绘面板：replaceChildren 会重建 input，
         焦点随之丢失 —— 表现就是「每敲一个字就跳出输入框」，该项等于不可用。 */
      if (!fromTextInput) paintSettings();
    }

    /** 开/关设置面板。 */
    function toggleSettings(force) {
      const el = document.getElementById(SETTINGS_ID);
      if (!el) return false;
      const next = typeof force === 'boolean' ? force : el.hasAttribute('hidden');
      if (next) el.removeAttribute('hidden');
      else el.setAttribute('hidden', '');
      if (next) {
        paintSettings();
        /* 开面板时实测背后亮度 → 自动定玻璃厚度与字色。
           requestAnimationFrame 保证先完成布局再采样。 */
        requestAnimationFrame(() => adaptPanelReadability());
      }
      return next;
    }

    /** 建设置面板（幂等）。 */
    function ensureSettingsUI() {
      let panel = document.getElementById(SETTINGS_ID);
      if (!panel) {
        panel = document.createElement('div');
        panel.id = SETTINGS_ID;
        panel.setAttribute('hidden', '');
        panel.dataset.dshlgKeep = '1';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-label', '玻璃外观设置');
        panel.innerHTML = '<div class="head"><b>玻璃外观</b><span class="grow"></span>'
          + '<button type="button" data-role="reset-pos">重置位置</button>'
          + '<button type="button" data-role="reset">恢复默认</button>'
          + '<button type="button" data-role="close">关闭</button></div><div class="rows"></div>';
        panel.addEventListener('click', (event) => {
          const btn = event.target.closest('button');
          if (!btn) return;
          if (btn.dataset.role === 'close') { toggleSettings(false); return; }
          if (btn.dataset.role === 'reset-pos') {
            clearPos();
            document.getElementById(CTRL_ID)?.removeAttribute('style');
            document.getElementById(GEAR_ID)?.removeAttribute('style');
            document.getElementById(CTRL_ID)?.setAttribute('data-dshlg-moved', '');
            document.getElementById(GEAR_ID)?.setAttribute('data-dshlg-moved', '');
            delete document.getElementById(CTRL_ID)?.dataset.dshlgMoved;
            delete document.getElementById(GEAR_ID)?.dataset.dshlgMoved;
            requestPass(true);
            return;
          }
          if (btn.dataset.role === 'reset') {
            /* 加确认：原来点一下就直接 reload，属于不可撤销的粗暴操作。 */
            if (!window.confirm('恢复默认外观？会清掉全部外观设置、控件位置与收起状态，然后重新加载界面。')) return;
            try {
              localStorage.removeItem(SETTINGS_KEY);
              localStorage.removeItem(POS_KEY);            // 控件位置
              localStorage.removeItem('dshlg.controlsHidden'); // 收起状态
              localStorage.removeItem('dshlg.entry');          // 壁纸选择
              localStorage.removeItem('dshlg.gem');            // 旧版遗留键
            } catch { /* 忽略 */ }
            location.reload();
            return;
          }
          if (btn.dataset.setKey) commitSetting(btn.dataset.setKey, btn.dataset.setVal);
        });
        panel.addEventListener('input', (event) => {
          const input = event.target;
          if (input && input.dataset && input.dataset.setRange) {
            /* 滑块：即时生效，且不重绘面板（否则拖动会被打断） */
            commitSetting(input.dataset.setRange, input.value, true);
            return;
          }
          if (input && input.dataset && input.dataset.setText) {
            commitSetting(input.dataset.setText, input.value, true);
          }
        });
        document.body.appendChild(panel);
      }

      let gear = document.getElementById(GEAR_ID);
      if (!gear) {
        gear = document.createElement('button');
        gear.id = GEAR_ID;
        gear.type = 'button';
        gear.textContent = '⚙';
        gear.title = '玻璃外观设置';
        gear.setAttribute('aria-label', '玻璃外观设置');
        gear.dataset.dshlgKeep = '1';
        gear.addEventListener('click', (event) => { event.stopPropagation(); toggleSettings(); });
        document.body.appendChild(gear);
        makeDraggable(gear, 'gear');
      }
      try { positionGear(); } catch { /* 忽略 */ }
      return panel;
    }

    /** 按当前值重绘面板行（只重画内容，不重建面板）。 */
    function paintSettings() {
      const panel = document.getElementById(SETTINGS_ID);
      if (!panel || panel.hasAttribute('hidden')) return;
      const rows = panel.querySelector('.rows');
      if (!rows) return;
      const cur = currentSettings();
      rows.replaceChildren();
      for (const spec of SETTING_SPECS) {
        const row = document.createElement('div');
        row.className = 'row';
        const label = document.createElement('span');
        label.className = 'label';
        label.textContent = spec.label;
        row.appendChild(label);

        if (spec.type === 'range') {
          const wrap = document.createElement('span');
          wrap.className = 'range';
          const input = document.createElement('input');
          input.type = 'range';
          input.min = String(spec.min);
          input.max = String(spec.max);
          input.step = String(spec.step);
          input.value = String(cur[spec.key] ?? spec.min);
          input.dataset.setRange = spec.key;
          const out = document.createElement('b');
          out.textContent = Number(input.value).toFixed(2);
          input.addEventListener('input', () => { out.textContent = Number(input.value).toFixed(2); });
          wrap.appendChild(input);
          wrap.appendChild(out);
          row.appendChild(wrap);
          rows.appendChild(row);
          continue;
        }
        if (spec.type === 'seg') {
          const seg = document.createElement('span');
          seg.className = 'seg';
          for (const [val, text] of spec.options) {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = text;
            b.dataset.setKey = spec.key;
            b.dataset.setVal = val;
            if (String(cur[spec.key]) === String(val)) b.classList.add('is-on');
            seg.appendChild(b);
          }
          row.appendChild(seg);
        } else {
          const input = document.createElement('input');
          input.type = 'text';
          input.value = String(cur[spec.key] ?? '');
          input.dataset.setText = spec.key;
          input.placeholder = '留空 = 用官方字标';
          row.appendChild(input);
        }
        rows.appendChild(row);
      }
    }



    /**
     * 让齿轮与控制条**同一条水平线**且不重叠。
     *
     * 为什么用测量而不是写死 left：控制条的宽度随内容变（场景按钮数量、
     * 是否显示音量条、壁纸名长短都会影响），写死的 left 迟早会压上去。
     * 所以每次刷新都量一次控制条右边界，把齿轮放到它右边 10px 处。
     */
    function positionGear() {
      const gear = document.getElementById(GEAR_ID);
      if (!gear) return;
      /* 用户拖过就听用户的 —— 自动定位会把位置拽回去 */
      if (applySavedPos(gear, 'gear')) return;
      const bar = document.getElementById(CTRL_ID);
      if (!bar) {
        /* 控制条不在（收起/隐藏）→ 回到兜底位置，并和找回圆点错开 */
        gear.style.left = '18px';
        gear.style.bottom = '18px';
        return;
      }
      const r = bar.getBoundingClientRect();
      gear.style.bottom = Math.round(window.innerHeight - r.bottom) + 'px';   // 与控制条底边对齐
      /* 间距可配置：不同布局下控制条右边可能是头像/其它按钮，
         写死 10px 会压上去。CONFIG.ui.gearGap 可调。 */
      const gap = Number((CONFIG.ui && CONFIG.ui.gearGap) ?? 72) || 0;
      gear.style.left = Math.round(r.right + gap) + 'px';
    }


    /* ── 可拖动定位 ───────────────────────────────────────────
       用户可以直接把控制条与齿轮拖到任意位置；位置存 localStorage。
       拖动过之后就不再自动定位 —— 否则自动逻辑会把手动位置拽回去。 */

    const POS_KEY = 'dshlg.pos';

    function loadPos() {
      try { return JSON.parse(localStorage.getItem(POS_KEY) || '{}') || {}; }
      catch { return {}; }
    }
    function savePos(key, pos) {
      try {
        const all = loadPos();
        all[key] = pos;
        localStorage.setItem(POS_KEY, JSON.stringify(all));
      } catch { /* 存不了只影响本次 */ }
    }
    function clearPos() {
      try { localStorage.removeItem(POS_KEY); } catch { /* 忽略 */ }
    }

    /** 把保存的位置写到元素上（夹在视口内，避免拖出屏幕后找不回来）。 */
    function applySavedPos(el, key) {
      const p = loadPos()[key];
      if (!p || !el) return false;
      const maxLeft = Math.max(0, window.innerWidth - el.offsetWidth - 2);
      const maxBottom = Math.max(0, window.innerHeight - el.offsetHeight - 2);
      el.style.left = Math.min(Number(p.left) || 0, maxLeft) + 'px';
      el.style.bottom = Math.min(Number(p.bottom) || 0, maxBottom) + 'px';
      el.dataset.dshlgMoved = '1';
      return true;
    }

    /**
     * 让元素可拖动。
     *
     * 关键点：
     *   · 用 pointer capture，指针移出元素也不丢事件；
     *   · 位移超过 3px 才算拖动 —— 否则会把「点击」误判成拖动（齿轮就点不开了）；
     *   · 判定为拖动后，用捕获阶段的 click 拦掉这一次点击。
     */
    function makeDraggable(el, key, onMoved) {
      if (!el || el.dataset.dshlgDrag === '1') return;
      el.dataset.dshlgDrag = '1';
      el.style.touchAction = 'none';
      el.style.cursor = 'grab';
      let start = null;
      let moved = false;

      el.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        const r = el.getBoundingClientRect();
        start = {
          x: event.clientX,
          y: event.clientY,
          left: r.left,
          bottom: window.innerHeight - r.bottom,
        };
        moved = false;
        el.style.cursor = 'grabbing';
        try { el.setPointerCapture(event.pointerId); } catch { /* 忽略 */ }
      });

      el.addEventListener('pointermove', (event) => {
        if (!start) return;
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        if (!moved && Math.hypot(dx, dy) < 3) return;
        moved = true;
        const maxLeft = Math.max(0, window.innerWidth - el.offsetWidth - 2);
        const maxBottom = Math.max(0, window.innerHeight - el.offsetHeight - 2);
        const left = Math.max(0, Math.min(start.left + dx, maxLeft));
        const bottom = Math.max(0, Math.min(start.bottom - dy, maxBottom));
        el.style.left = Math.round(left) + 'px';
        el.style.bottom = Math.round(bottom) + 'px';
      });

      const finish = (event) => {
        if (!start) return;
        start = null;
        el.style.cursor = 'grab';
        try { el.releasePointerCapture(event.pointerId); } catch { /* 忽略 */ }
        if (!moved) return;
        el.dataset.dshlgMoved = '1';
        el.dataset.dshlgDraggedAt = String(Date.now());   // 供 click 抑制判断
        const r = el.getBoundingClientRect();
        savePos(key, { left: Math.round(r.left), bottom: Math.round(window.innerHeight - r.bottom) });
        if (typeof onMoved === 'function') onMoved(el);
      };
      el.addEventListener('pointerup', finish);
      el.addEventListener('pointercancel', finish);
      /* 拖动结束后拦掉「那一次」click，避免拖一下就顺手触发按钮。
         ⚠️ 两个坑（都踩过）：
           · 用 setTimeout(0) 清标记，时序不可靠 —— 标记可能残留到下一次点击，
             把画廊按钮的点击一起吞掉（用户反馈「点了没反应/刚出来就消失」）；
           · 不该拦子元素的点击：按钮在控制条内部，用户是真心想点它们。
         所以改成：记录**时间戳**（250ms 内有效），且只有点击目标就是被拖元素本身时才拦。 */
      el.addEventListener('click', (event) => {
        const at = Number(el.dataset.dshlgDraggedAt || 0);
        if (!at || Date.now() - at > 250) return;
        if (event.target !== el) return;              // 子元素（按钮）照常工作
        event.stopPropagation();
        event.preventDefault();
      }, true);
    }


    /* ── 壁纸亮度测量（可读性）────────────────────────────────
       为什么测：全透明档下正文直接压在壁纸上，亮壁纸读不出来。
       但**不**在内容上盖纱（那样等于给正文压了块板，破坏全透明观感），
       而是反过来**压暗壁纸**：界面照样全透，背景暗下去字就清楚了。
       数据来源：宿主 /__preview 缩略图（index.js 带 ACAO:*，canvas 可读像素）。 */
    const wallLum = { value: null, id: null };

    /**
     * 用壁纸缩略图估平均亮度（sRGB 相对亮度，0=黑 1=白）。
     * @param {number} port 宿主端口
     * @param {string} id 壁纸 id
     * @returns {Promise<number|null>} 测不到返回 null
     */
    function measureWallpaperLuminance(port, id) {
      if (!port || !id) return Promise.resolve(null);
      if (wallLum.id === id && wallLum.value !== null) return Promise.resolve(wallLum.value);
      return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        const fail = () => resolve(null);
        img.onload = () => {
          try {
            const cv = document.createElement('canvas');
            const w = (cv.width = 32);
            const h = (cv.height = 32);
            const ctx = cv.getContext('2d', { willReadFrequently: true });
            if (!ctx) return fail();
            ctx.drawImage(img, 0, 0, w, h);
            const d = ctx.getImageData(0, 0, w, h).data;
            const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
            let sum = 0;
            let n = 0;
            for (let i = 0; i < d.length; i += 4) {
              if (d[i + 3] < 8) continue;
              sum += 0.2126 * f(d[i]) + 0.7152 * f(d[i + 1]) + 0.0722 * f(d[i + 2]);
              n += 1;
            }
            const L = n ? sum / n : null;
            wallLum.id = id;
            wallLum.value = L;
            resolve(L);
          } catch {
            fail();     // canvas 被污染（CORS 没生效）
          }
        };
        img.onerror = fail;
        img.src = 'http://127.0.0.1:' + port + '/__preview?id=' + encodeURIComponent(id);
      });
    }

    /**
     * 按实测亮度决定壁纸压暗值（0~0.8）。
     *
     * 阈值说明：白字在 4.5:1 需要背景亮度 ≲0.18。
     * 所以亮壁纸压得狠一点，暗壁纸几乎不动 —— 尽量保留原壁纸观感。
     */
    function dimForLuminance(L) {
      if (L === null) return 0.15;                 // 测不到：用原默认值
      if (L > 0.7) return 0.55;
      if (L > 0.55) return 0.45;
      if (L > 0.4) return 0.32;
      if (L > 0.25) return 0.18;
      return 0.05;                                 // 暗壁纸：基本不压
    }

    /** 把亮度结论写到根属性（供 CSS 决定要不要开描影），并刷新一次。 */
    function applyWallLuminance(L) {
      try {
        const root = document.documentElement;
        root.dataset.dshlgWallLum = L === null ? 'unknown' : L.toFixed(2);
        if (L !== null && L > 0.45) root.dataset.dshlgBrightWall = '1';
        else delete root.dataset.dshlgBrightWall;
      } catch { /* 忽略 */ }
      return L;
    }

    /* ── 面板可读性自适应 ─────────────────────────────────────── */

    /** sRGB 相对亮度（WCAG 公式）。 */
    function relLuminance(r, g, b) {
      const f = (v) => {
        const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    }

    /** 对比度（WCAG），两色都按已合成的实色给。 */
    function contrastRatio(l1, l2) {
      const a = Math.max(l1, l2);
      const b = Math.min(l1, l2);
      return (a + 0.05) / (b + 0.05);
    }

    /** 把 "rgba(...)" 解成 [r,g,b,a]；解不出返回 null。 */
    function parseRgba(str) {
      const m = String(str || '').match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
      if (p.length < 3 || p.some((n) => !Number.isFinite(n))) return null;
      return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
    }

    /**
     * 采样面板背后的亮度。
     *
     * 做法：把面板临时设成 visibility:hidden（保留布局），在面板矩形上取 3×3 个点，
     * 用 elementsFromPoint 拿到该点的元素栈，从栈底往上找第一个**不透明背景**，
     * 换算成亮度。iframe/video（壁纸是 iframe，读不到像素）记为 unknown。
     *
     * @returns {{mean:number, spread:number, samples:number, opaque:boolean}}
     */
    function sampleBackdrop(x, y, w, h) {
      const vals = [];
      let sawUnreadable = false;
      const xs = [0.2, 0.5, 0.8].map((t) => x + w * t);
      const ys = [0.15, 0.5, 0.85].map((t) => y + h * t);
      for (const px of xs) {
        for (const py of ys) {
          let stack = [];
          try { stack = document.elementsFromPoint(px, py) || []; } catch { stack = []; }
          let lum = null;
          for (let i = stack.length - 1; i >= 0; i -= 1) {
            const el = stack[i];
            if (!el || el.id === SETTINGS_ID || el.closest?.('#' + SETTINGS_ID)) continue;
            const tag = (el.tagName || '').toLowerCase();
            if (tag === 'iframe' || tag === 'video' || tag === 'canvas') { sawUnreadable = true; break; }
            let cs;
            try { cs = getComputedStyle(el); } catch { continue; }
            const rgba = parseRgba(cs.backgroundColor);
            if (rgba && rgba[3] > 0.06) { lum = relLuminance(rgba[0], rgba[1], rgba[2]); break; }
          }
          if (lum !== null) vals.push(lum);
        }
      }
      if (vals.length === 0) return { mean: 0.5, spread: 0, samples: 0, opaque: false, unknown: true };
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const spread = Math.max(...vals) - Math.min(...vals);
      return { mean, spread, samples: vals.length, opaque: !sawUnreadable, unknown: false };
    }

    /**
     * 根据背后亮度决定「玻璃厚度 + 字色」，写到面板的内联变量上。
     *
     * 两条规则：
     *   · 背后亮或花 → 加厚玻璃（把背后内容压下去），改用**深色字**；
     *   · 背后暗且匀 → 保持很透，用**浅粉字**。
     * 然后按 WCAG 反推：对比度不足就继续加厚，直到 ≥ 4.5:1（上限 0.92）。
     */
    function adaptPanelReadability() {
      const panel = document.getElementById(SETTINGS_ID);
      if (!panel || panel.hasAttribute('hidden')) return null;
      const r = panel.getBoundingClientRect();
      if (r.width < 40 || r.height < 30) return null;

      const prevVis = panel.style.visibility;
      panel.style.visibility = 'hidden';          // 采样时不能挡住自己
      let bg;
      try { bg = sampleBackdrop(r.left, r.top, r.width, r.height); }
      finally { panel.style.visibility = prevVis; }

      /* 背后亮/花/**有文字** → 必须上厚底。
         ⚠️ 之前的判据只看亮度：背后是文字时 elementsFromPoint 读不到不透明底色，
         mean 落在中性 0.5 → 判定「不需要厚底」→ 选了「很透 + 深字」，
         结果面板文字与背后文字叠在一起，两边都看不清（用户反馈的就是这个）。
         现在：只要检测到背后有可见文字，就一律上厚底。 */
      const textBehind = (() => {
        try {
          const px = Math.round(r.left + r.width / 2);
          const py = Math.round(r.top + Math.min(40, r.height / 2));
          const stack = document.elementsFromPoint(px, py) || [];
          for (const el of stack) {
            if (!el || el.closest?.('#' + SETTINGS_ID)) continue;
            const t = (el.textContent || '').trim();
            if (t.length >= 2 && el.children.length === 0) return true;   // 叶子节点带文字
          }
        } catch { /* 忽略 */ }
        return false;
      })();
      const needOpaque = textBehind || bg.mean > 0.5 || bg.spread > 0.2 || bg.unknown;
      const darkInk = needOpaque;                 // 厚底配深字，薄底配浅字

      /* 底色：先用一档初值，再按对比度反推是否需要更厚 */
      const veilRgb = darkInk ? [255, 240, 246] : [255, 170, 205];
      const inkRgb = darkInk ? [74, 13, 43] : [255, 208, 230];
      const inkLum = relLuminance(inkRgb[0], inkRgb[1], inkRgb[2]);

      /* 需要厚底时**从 0.78 起**：0.6 在文字背景上仍会透出后面的字。
         薄底档保持 0.08（背后是纯色/暗背景时不影响观感）。 */
      let alpha = needOpaque ? 0.78 : 0.08;
      for (let i = 0; i < 8; i += 1) {
        /* 合成色 = 底色 × a + 背后色 × (1-a)。背后色按平均亮度还原成灰。 */
        const base = bg.mean * 255;
        const mixR = veilRgb[0] * alpha + base * (1 - alpha);
        const mixG = veilRgb[1] * alpha + base * (1 - alpha);
        const mixB = veilRgb[2] * alpha + base * (1 - alpha);
        if (contrastRatio(relLuminance(mixR, mixG, mixB), inkLum) >= 4.5) break;
        alpha = Math.min(0.92, alpha + 0.08);
      }

      panel.style.setProperty('--dshlg-panel-veil', `rgba(${veilRgb.join(', ')}, ${alpha.toFixed(2)})`);
      panel.style.setProperty('--dshlg-panel-ink', `rgb(${inkRgb.join(', ')})`);
      panel.dataset.dshlgPanelFit = darkInk ? 'dark-ink' : 'light-ink';
      panel.dataset.dshlgPanelBg = bg.mean.toFixed(2) + '/' + bg.spread.toFixed(2);
      panel.dataset.dshlgTextBehind = textBehind ? '1' : '0';
      return { bg, alpha, darkInk };
    }

    /** 顶/底边缘渐隐带（纯装饰，指针穿透）。幂等：已存在就不重建。 */
    function ensureFades() {
      for (const [id, where] of [[FADE_TOP_ID, 'top'], [FADE_BOTTOM_ID, 'bottom']]) {
        if (document.getElementById(id)) continue;
        const d = document.createElement('div');
        d.id = id;
        d.dataset.dshlgKeep = '1';
        d.setAttribute('aria-hidden', 'true');
        d.dataset.edge = where;
        document.body.appendChild(d);
      }
    }

    /** 控制条是否被用户收起过。localStorage 记住，重启后仍然收起。 */
    function controlsHidden() {
      try {
        return localStorage.getItem('dshlg.controlsHidden') === '1';
      } catch {
        return false;
      }
    }
    function setControlsHidden(hidden) {
      try {
        if (hidden) localStorage.setItem('dshlg.controlsHidden', '1');
        else localStorage.removeItem('dshlg.controlsHidden');
      } catch { /* 忽略：存不了就只影响本次 */ }
    }

    /**
     * 建控制条。回调把用户操作转成给壁纸的命令。
     * 结构： [壁纸▾] [画廊] | [庭院][主室] | [松风] [音量] | [收起]
     */
    function ensureControls(theme, onCommand) {
      /* 用户点过「收起」就记住 —— 必须跨样式 pass 记住。
         踩过的坑：原来点收起只是 el.remove()，而每次 pass 都会重新
         ensureControls() → 立刻又建回来，看起来就是「点了没反应」。 */
      if (controlsHidden()) {
        document.getElementById(CTRL_ID)?.remove();
        document.getElementById(GALLERY_ID)?.remove();
        ensureRestoreDot();          // 留一个入口，别让人找不到
        ensureSettingsUI();          // 设置入口始终在（齿轮按钮独立于控制条）
        return null;
      }
      if (!CONFIG.wallpaper.controls) {
        document.getElementById(CTRL_ID)?.remove();
        document.getElementById(GALLERY_ID)?.remove();
        return null;
      }
      document.getElementById(RESTORE_ID)?.remove();
      let el = document.getElementById(CTRL_ID);
      if (el) return el;

      el = document.createElement('div');
      el.id = CTRL_ID;
      // 控制条自己也是玻璃面，别被「清背景」规则清掉
      el.dataset.dshlgKeep = '1';
      el.setAttribute('role', 'toolbar');
      el.setAttribute('aria-label', '壁纸控制');

      // 壁纸切换器：选项由宿主的 /__wallpapers 接口自动生成
      const picker = document.createElement('select');
      picker.dataset.role = 'wallpaper';
      picker.setAttribute('aria-label', '选择壁纸');
      picker.title = '换壁纸：往下拉，或点右边的「画廊」看缩略图';
      el.appendChild(picker);

      const galleryBtn = document.createElement('button');
      galleryBtn.type = 'button';
      galleryBtn.dataset.role = 'gallery';
      galleryBtn.textContent = '画廊';
      galleryBtn.title = '展开带缩略图的壁纸画廊';
      el.appendChild(galleryBtn);

      const sep0 = document.createElement('span');
      sep0.className = 'sep';
      el.appendChild(sep0);

      const scenes = document.createElement('span');
      scenes.dataset.role = 'scenes';
      el.appendChild(scenes);

      const sep1 = document.createElement('span');
      sep1.className = 'sep';
      el.appendChild(sep1);

      const audio = document.createElement('button');
      audio.type = 'button';
      audio.dataset.role = 'audio';
      audio.textContent = '松风';
      el.appendChild(audio);

      const vol = document.createElement('input');
      vol.type = 'range';
      vol.min = '0';
      vol.max = '100';
      vol.value = '45';
      vol.dataset.role = 'volume';
      vol.setAttribute('aria-label', '环境音音量');
      el.appendChild(vol);

      const sep2 = document.createElement('span');
      sep2.className = 'sep';
      el.appendChild(sep2);

      const hide = document.createElement('button');
      hide.type = 'button';
      /* 控制中心入口：复用控制条这个既有控件，不新增悬浮件。
         事件仍走下面那个委托，只是多认一个 role。
         标签用紧凑字形：控制条已经很长，四字按钮会把齿轮挤出去。 */
      const ccBtn = document.createElement('button');
      ccBtn.type = 'button';
      ccBtn.dataset.role = 'control-center';
      ccBtn.textContent = '⊞';
      ccBtn.title = '控制中心：工作区管理 / 会话巡检 / 插件 / 系统';
      ccBtn.setAttribute('aria-label', '控制中心');
      el.appendChild(ccBtn);

      const ccSep = document.createElement('span');
      ccSep.className = 'sep';
      el.appendChild(ccSep);

      hide.dataset.role = 'hide';
      hide.textContent = '收起';
      hide.title = '隐藏这条控制栏（改 CONFIG.wallpaper.controls 可恢复）';
      el.appendChild(hide);

      picker.addEventListener('change', () => onCommand('wallpaper', picker.value));

      // 事件委托
      el.addEventListener('click', (event) => {
        const btn = event.target.closest('button');
        if (!btn) return;
        const role = btn.dataset.role;
        if (role === 'audio') {
          onCommand('audio-toggle');
        } else if (role === 'control-center') {
          ensureControlCenter();
          ccToggle();
        } else if (role === 'hide') {
          setControlsHidden(true);          // 记住，别让下一遍 pass 又建回来
          el.remove();
          document.getElementById(GALLERY_ID)?.remove();
        } else if (role === 'gallery') {
          onCommand('gallery-toggle');
        } else if (btn.dataset.scene) {
          onCommand('scene', btn.dataset.scene);
        }
      });
      vol.addEventListener('input', () => onCommand('volume', Number(vol.value)));
      /* 记下最后一次的值，paintControls 里值没变就不写 DOM */
      vol.dataset.dshlgVol = vol.value;

      document.body.appendChild(el);
      return el;
    }

    /** 用壁纸回报的状态刷新控制条。 */
    function paintControls(state) {
      const el = document.getElementById(CTRL_ID);
      if (!el) return;
      /* 状态没变就整段跳过 —— 壁纸会高频回报，无脑重绘就是闪烁的来源。 */
      try {
        const stamp = JSON.stringify(state ?? null);
        if (el.dataset.dshlgState === stamp) return;
        el.dataset.dshlgState = stamp;
      } catch { /* 状态不可序列化时照常走 */ }

      const scenesBox = el.querySelector('[data-role="scenes"]');
      // 壁纸明确回报「没有场景」（视频壁纸就是这种）时不显示按钮；
      // 只有还没收到过任何回报时，才用宅邸禅院的默认两项兜底。
      const list = Array.isArray(state.scenes)
        ? state.scenes
        : [{ id: 'courtyard', label: '庭院' }, { id: 'hall', label: '主室' }];

      /* 场景按钮按回报重建（只在**集合**变化时）。
         ⚠️ 签名必须与顺序无关：壁纸回报的场景顺序可能变（异步状态更新），
         若把顺序写进签名，就会反复 replaceChildren → 用户看到的「一直在闪」。 */
      const sig = list.map((s) => `${s.id}:${s.label}`).sort().join('|');
      if (scenesBox.dataset.sig !== sig) {
        scenesBox.dataset.sig = sig;
        scenesBox.replaceChildren();
        for (const s of list) {
          const b = document.createElement('button');
          b.type = 'button';
          b.dataset.scene = s.id;
          b.textContent = s.label || s.id;
          scenesBox.appendChild(b);
          scenesBox.appendChild(document.createTextNode(' '));
        }
      }
      /* 只在开关状态真的不同时才写 class —— 反复 toggle 会触发样式重算，
         配合任何过渡就是肉眼可见的闪烁。 */
      for (const b of scenesBox.querySelectorAll('button[data-scene]')) {
        const want = b.dataset.scene === state.scene;
        if (b.classList.contains('is-on') !== want) b.classList.toggle('is-on', want);
      }
      // 没有场景时把分隔线一起藏起来，免得控制条上留一根孤零零的竖线
      const empty = list.length === 0;
      const scenesSep = scenesBox.nextElementSibling;
      scenesBox.style.display = empty ? 'none' : '';
      if (scenesSep && scenesSep.classList.contains('sep')) {
        scenesSep.style.display = empty ? 'none' : '';
      }

      const audioBtn = el.querySelector('[data-role="audio"]');
      if (audioBtn) {
        audioBtn.classList.toggle('is-on', state.audioOn === true);
        audioBtn.textContent = state.audioOn ? '松风 · 开' : '松风 · 止';
      }
      const vol = el.querySelector('[data-role="volume"]');
      if (vol && state.volume !== null && state.volume !== undefined && document.activeElement !== vol) {
        vol.value = String(Math.round(state.volume));
      }
    }

    /**
     * 用宿主回报的壁纸清单刷新下拉框。
     *
     * 清单里混了三种来源（本地 / Steam 工坊 / WE 项目），用 optgroup 分组；
     * scene 之类依赖 WE 运行时的类型默认不显示（否则下拉框里大半是选了没反应的）。
     */
    function paintWallpaperPicker(list) {
      const picker = document.querySelector(`#${CTRL_ID} [data-role="wallpaper"]`);
      if (!picker) return;

      const usable = list.filter((w) => w.supported !== false || CONFIG.wallpaper.showUnsupported);
      const hidden = list.length - usable.length;

      const entry = currentEntry();
      const sig = usable.map((w) => `${w.entry}:${w.title}:${w.source}`).join('|');
      if (picker.dataset.sig !== sig) {
        picker.dataset.sig = sig;
        picker.replaceChildren();

        // 按来源分组，保持宿主给的顺序（本地 → 工坊 → WE 项目）
        const groups = new Map();
        for (const w of usable) {
          const key = w.source || '其他';
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(w);
        }

        for (const [source, items] of groups) {
          const g = document.createElement('optgroup');
          g.label = `${source}（${items.length}）`;
          for (const w of items) {
            const opt = document.createElement('option');
            opt.value = w.entry;
            opt.textContent = w.type ? `${w.title}  · ${w.type}` : w.title;
            if (w.supported === false) {
              opt.disabled = true;
              opt.textContent += '（不可用）';
            }
            g.appendChild(opt);
          }
          picker.appendChild(g);
        }
      }

      const current = usable.find((w) => w.entry === entry);
      if (current) picker.value = entry;
      picker.title =
        `可用 ${usable.length} 张` +
        (hidden > 0 ? `，另有 ${hidden} 张 scene/application 类型无法在浏览器渲染` : '') +
        `。\n点右边的「画廊」可以看缩略图。`;
    }

    /**
     * 壁纸画廊：带缩略图的九宫格。
     *
     * 缩略图走宿主的 `/__preview?id=…`（原图就在壁纸目录里，
     * 工坊壁纸的 project.json 一般带 preview.jpg / preview.gif）。
     */
    function paintGallery(port, list, onCommand) {
      const el = document.getElementById(GALLERY_ID);
      if (!el) return;
      const grid = el.querySelector('.grid');
      const count = el.querySelector('.count');
      if (!grid) return;

      const usable = list.filter((w) => w.supported !== false || CONFIG.wallpaper.showUnsupported);
      const entry = currentEntry();

      const sig = usable.map((w) => `${w.id}:${w.title}:${w.previewExt}`).join('|');
      if (grid.dataset.sig !== sig) {
        grid.dataset.sig = sig;
        grid.replaceChildren();
        if (usable.length === 0) {
          const p = document.createElement('div');
          p.className = 'empty';
          p.textContent = '没扫到可用壁纸（web / video 类型）。往 wallpapers\\ 放目录或订阅工坊壁纸后重开。';
          grid.appendChild(p);
        }
        for (const w of usable) {
          const card = document.createElement('button');
          card.type = 'button';
          card.className = 'card';
          card.dataset.entry = w.entry;
          if (w.supported === false) card.classList.add('is-bad');
          card.title = `${w.title}\n来源：${w.source}\n类型：${w.type || '未知'}${w.supported === false ? '\n（浏览器渲染不了）' : ''}`;

          const thumb = document.createElement('span');
          thumb.className = 'thumb';
          if (w.previewExt) {
            const img = document.createElement('img');
            img.loading = 'lazy';
            img.alt = '';
            img.src = `http://127.0.0.1:${port}/__preview?id=${encodeURIComponent(w.id)}`;
            img.addEventListener('error', () => {
              img.remove();
              thumb.textContent = String(w.title || '?').slice(0, 2);
            });
            thumb.appendChild(img);
          } else {
            thumb.textContent = String(w.title || '?').slice(0, 2);
          }
          card.appendChild(thumb);

          if (w.type) {
            const badge = document.createElement('span');
            badge.className = 'badge';
            badge.textContent = w.type;
            card.appendChild(badge);
          }

          const name = document.createElement('span');
          name.className = 'name';
          name.textContent = w.title || w.id;
          card.appendChild(name);

          const meta = document.createElement('span');
          meta.className = 'meta';
          meta.textContent = w.source;
          card.appendChild(meta);

          grid.appendChild(card);
        }
      }

      for (const card of grid.querySelectorAll('.card')) {
        card.classList.toggle('is-on', card.dataset.entry === entry);
      }
      if (count) count.textContent = `${usable.length} 张可用`;

      // 点卡片 = 换壁纸（走和控制条下拉框同一条命令）
      if (grid.dataset.wired !== '1') {
        grid.dataset.wired = '1';
        grid.addEventListener('click', (event) => {
          const card = event.target.closest('.card');
          if (!card || card.classList.contains('is-bad')) return;
          onCommand('wallpaper', card.dataset.entry);
        });
      }
    }

    /** 显示/隐藏画廊。 */
    function toggleGallery(show) {
      const el = document.getElementById(GALLERY_ID);
      if (!el) return false;
      const next = typeof show === 'boolean' ? show : el.hasAttribute('hidden');
      if (next) el.removeAttribute('hidden');
      else el.setAttribute('hidden', '');
      return next;
    }

    function ensureGallery() {
      /* ⚠️ 只受 CONFIG.wallpaper.controls 控制，**不要**再加 controlsHidden()：
         否则用户点「收起」后，画廊会在每一轮 pass 被删掉 ——
         表现就是「画廊刚拉出来就消失、没法切换壁纸」。 */
      if (!CONFIG.wallpaper.controls) {
        document.getElementById(GALLERY_ID)?.remove();
        return null;
      }
      let el = document.getElementById(GALLERY_ID);
      if (!el) {
        el = document.createElement('div');
        el.id = GALLERY_ID;
        el.dataset.dshlgKeep = '1';
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-label', '壁纸画廊');
        el.innerHTML =
          '<div class="head"><b>壁纸</b><span class="count"></span><span class="grow"></span></div>' +
          '<div class="grid"></div>';
        if (!CONFIG.wallpaper.galleryOpen) el.setAttribute('hidden', '');
        document.body.appendChild(el);
      }
      return el;
    }

    /** 拉取壁纸清单。 */
    async function fetchWallpapers(port) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/__wallpapers`, { cache: 'no-store' });
        if (!res.ok) return [];
        const data = await res.json();
        return Array.isArray(data?.wallpapers) ? data.wallpapers : [];
      } catch (error) {
        console.warn('[dsh-liquid-glass] 取壁纸清单失败:', error);
        return [];
      }
    }

    /* ── 样式 ───────────────────────────────────────────── */

    function buildCss(theme) {
      const r = num(g('radius', 20), 20);
      const blur = num(layer('composerGlass', 0.08).frost, 18);
      const sat = num(g('saturate', 1.6), 1.6);
      // 聊天框仍跟随 panelAlpha：0 = 只留一层极淡的玻璃（默认）
      const composerLayer = layer('composerGlass', 0.08);
      const composerAlpha = composerLayer.alpha;
      const composerBlur = composerLayer.frost;
      const tone = '255, 255, 255';

      /* 去掉 brightness 补偿：它让输入栏比侧栏亮一点，观感上就是「透度不一致」。 */
  const baseFilter = `blur(${composerBlur}px) saturate(${sat})`;
      const composerFilter = composerBlur > 0 ? baseFilter : 'none';
      const composerActive = composerBlur > 0
        ? `blur(${(composerBlur * clamp01(g('activeBlur', 0.7), 0.7)).toFixed(1)}px) saturate(${sat})`
        : 'none';
      const refractFilter =
        num(CONFIG.refract) > 0 && CONFIG.overlayMode !== 'clear'
          ? `${baseFilter} url(#${FILTER_REF})`
          : baseFilter;

      return `
/* ── 聊天输入卡片：同一套 iOS 玻璃语言（色 / 描边 / 顶光 / 菲涅尔 / 浮动阴影）── */
.${CLS_GLASS} {
  --dshlg-alpha: ${composerAlpha};
  --dshlg-sheen: ${(composerAlpha * 1.2).toFixed(3)};
  --dshlg-radius: ${r}px;
  --dshlg-border: ${num(g('border', 1), 1)}px;
  --dshlg-border-a: ${clamp01(g('borderAlpha', 0.18), 0.18)};
  --dshlg-topline: ${clamp01(g('topLine', 0.3), 0.3)};
  --dshlg-fresnel: ${clamp01(g('fresnel', 0.22), 0.22)};
  --dshlg-fresnel-w: ${Math.max(2, Math.round(blur * 0.34))}px;
  --dshlg-shadow-y: ${num(g('shadowY', 8), 8)}px;
  --dshlg-shadow-blur: ${num(g('shadowBlur', 32), 32)}px;
  --dshlg-shadow-a: ${clamp01(g('shadowAlpha', 0.35), 0.35)};
  /* ⚠️ 这几个必须显式给：中间工作区里的元素不匹配 [data-dshlg-region]，
     拿不到那一档定义的变量，var() 会回落到内联兜底的 blur(18px) ——
     表现就是「侧栏已经透明了，输入栏还是磨砂」。
     和两侧栏同档：不模糊，只留边缘光学。
     （注意：这段是 CSS 注释，且位于模板字符串内部 —— 里面不能出现反引号，
       否则会把外层模板截断，报出莫名其妙的 ReferenceError。） */
  --dshlg-filter: ${composerFilter};
  --dshlg-filter-active: ${composerActive};
  --dshlg-chroma: ${num(g('chroma', 2), 2)}px;
  --dshlg-chroma-a: ${clamp01(g('chromaAlpha', 0.22), 0.22)};
  box-sizing: border-box !important;
  border-radius: var(--dshlg-radius) !important;
  background-color: rgba(${tone}, var(--dshlg-alpha)) !important;
  /* 纯透明档：去掉那层「上厚下薄」的渐变，否则看起来仍是一块带雾的面 */
  background-image: none !important;
  border: var(--dshlg-border) solid rgba(${tone}, var(--dshlg-border-a)) !important;
  box-shadow:
    inset 0 1px 0 rgba(${tone}, var(--dshlg-topline)),
    inset 0 0 0 var(--dshlg-fresnel-w) rgba(${tone}, var(--dshlg-fresnel)),
    inset 0 -1px 0 rgba(${tone}, calc(var(--dshlg-fresnel) * 0.5)),
    0 var(--dshlg-shadow-y) var(--dshlg-shadow-blur) rgba(0, 0, 0, var(--dshlg-shadow-a)) !important;
  /* 先写不带 url() 的版本：万一浏览器不支持 SVG 滤镜做 backdrop，这行仍然生效 */
  backdrop-filter: ${baseFilter};
  -webkit-backdrop-filter: ${baseFilter};
  backdrop-filter: ${refractFilter};
  -webkit-backdrop-filter: ${refractFilter};
}

/* ── 工具栏（聊天框内那行按钮）：更薄的一层，避免和主体叠加变浑 ── */
.${CLS_TOOLBAR} {
  box-sizing: border-box !important;
  border-radius: ${Math.max(8, r - 8)}px !important;
  background: linear-gradient(180deg,
    rgba(${tone}, ${theme.dark ? 0.07 : 0.2}) 0%,
    rgba(${tone}, ${theme.dark ? 0.02 : 0.08}) 100%) !important;
  box-shadow: inset 0 0 0 1px rgba(${tone}, ${theme.dark ? 0.14 : 0.32}) !important;
}

/* ── 报告横幅 ─────────────────────────────────────────── */
#${BANNER_ID} {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 2147483647;
  max-width: 560px;
  max-height: 60vh;
  overflow: auto;
  padding: 10px 14px;
  border-radius: 10px;
  background: rgba(17, 24, 39, 0.94);
  color: #e8eef8;
  font: 12px/1.55 ui-monospace, Consolas, monospace;
  white-space: pre-wrap;
  user-select: text;
  cursor: text;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.4);
}
`;
    }

    /**
     * 写样式表；**内容没变就不碰 DOM**。
     *
     * 为什么要判重：pass() 每遍都重算整份 CSS，而 MutationObserver + resize
     * 会让它一遍遍跑。如果每遍都 `textContent = css`，浏览器每次都要重建
     * 整棵样式规则 —— 表现为玻璃**一闪一闪**，并且在样式重算的窗口里
     * 读计算样式会读到中间态（验证台就被这个坑过一次：收起态被读成
     * 「还有底色 + 有 blur」，而真值是全透明）。
     * 判重之后：状态不变 → 一次 DOM 写入都没有。
     */
    function applyStyle(css) {
      let el = document.getElementById(STYLE_ID_DYN);
      if (!el) {
        el = document.createElement('style');
        el.id = STYLE_ID_DYN;   // ⚠️ 必须和上面查找用同一个 id
        el.dataset.dshlgCss = css;
        el.textContent = css;
        document.head.appendChild(el);
        return;
      }
      if (el.dataset.dshlgCss === css) return;   // 一模一样 → 不写
      el.dataset.dshlgCss = css;
      el.textContent = css;
    }

    function report(lines) {
      if (!CONFIG.report) return;
      let el = document.getElementById(BANNER_ID);
      if (!el) {
        el = document.createElement('div');
        el.id = BANNER_ID;
        el.dataset.dshlgKeep = '1';
        el.addEventListener('click', () => {
          try {
            navigator.clipboard.writeText(el.textContent);
          } catch {
            /* 忽略 */
          }
        });
        document.body.appendChild(el);
      }
      el.textContent = lines.join('\n');
    }

    /* ── 主流程 ─────────────────────────────────────────── */

    /**
     * 壁纸链路诊断的**模块级**状态。
     *
     * ⚠️ 必须是模块级：写入方是 ensureWallpaper()（建 iframe 时记 load/error/状态码），
     * 读取方是 findWallpaper() 与报告横幅。曾经把它声明在 findWallpaper() 内部，
     * 结果 ensureWallpaper() 里访问不到 → ReferenceError → **壁纸层永远建不出来**
     * （用户看到的就是「壁纸没了」）。作用域 bug 不会报语法错误，只会静默失败。
     */
    const wallDiag = { load: false, loadError: false, fetchStatus: '未开始', ready: false, states: 0 };

    /** 重置诊断字段（不换对象，保证引用方看到的是同一份）。 */
    function resetWallDiag() {
      wallDiag.load = false;
      wallDiag.loadError = false;
      wallDiag.fetchStatus = '未开始';
      wallDiag.ready = false;
      wallDiag.states = 0;
    }

    /**
     * 真正的实现。
     *
     * ⚠️ 为什么写成独立函数、而不是 `apply()` 里的 `this._apply()`：
     * DSH 的加载器是**解构导出后单独调用** `apply` 的，
     * `this` 不保证指向模块对象 —— 实测线上崩过一次：
     *     TypeError: this._apply is not a function
     *     → web boot: 1 entry did not activate（整块插件没激活，界面毫无变化）
     * 所以插件里**任何地方都不要依赖 `this`**。
     */
    function applyGlass(ctx) {
      /* 只要装过一次就够（热重载可能重复调用） */
      if (!window.__DSHLG_TRAP__) {
        window.__DSHLG_TRAP__ = true;
        const trap = (label) => (event) => {
          const err = event?.error ?? event?.reason ?? event;
          const text = (err && (err.stack || err.message)) || String(err);
          if (!window.__DSHLG_ERR) window.__DSHLG_ERR = label + ': ' + text;
          console.error('[dsh-liquid-glass] ' + label + '：', err);
        };
        window.addEventListener('error', trap('未捕获异常'));
        window.addEventListener('unhandledrejection', trap('未处理的 Promise 拒绝'));
      }

      /* 先把用户上次的设置合并进 CONFIG，再开始画 —— 保证首帧就是用户要的样子。 */
      applySettings();

      let disposed = false;
      let observer = null;
      let timer = null;
      let wallPort = null;      // 宿主静态服务的端口，null 表示还没探到
      let wallTried = false;
        let pointerRaf = null;    // 高光滑移的 rAF 句柄
        let lastReportKey = '';
        /** 壁纸链路诊断：出问题时一眼看出卡在哪一环 */
        /* 复用模块级的 wallDiag（原来在这里重新声明，导致
           ensureWallpaper 里访问不到 → ReferenceError → 壁纸层建不出来）。
           这里只重置字段，不新建对象。 */
        resetWallDiag();
        let wallList = [];

        /**
         * 壁纸探测是**异步**的（要发 HTTP），所以单独一条线，
         * 探到之后再重跑一遍 pass() 把样式换成壁纸版。
         */
        const findWallpaper = async () => {
          if (wallTried || disposed) return;
          wallTried = true;
          if (!CONFIG.wallpaper.enabled) return;
          const port = await probeServer(CONFIG.wallpaper.ports);
          if (disposed) return;
          wallPort = port;
          if (port !== null) {
            console.info(`[dsh-liquid-glass] 壁纸服务端口 ${port}`);
            wallList = await fetchWallpapers(port);
            if (disposed) return;
            console.info(`[dsh-liquid-glass] 发现 ${wallList.length} 张壁纸:`,
              wallList.map((w) => `${w.title}(${w.type})`).join(', ') || '(无)');
          } else {
            console.warn('[dsh-liquid-glass] 没探到壁纸服务，回落到内置背景层');
          }
          pass(false);
        };

        /**
         * 接收壁纸控制桥回报的状态，刷新控制条。
         * 控制桥由宿主注入到壁纸页面里（跨源，所以只能走 postMessage）。
         */
        const onWallpaperMessage = (event) => {
          const d = event.data;
          if (!d || d.__dshlg !== 'dshlg') return;
          if (d.type === 'ready') {
            wallDiag.ready = true;
            // 控制桥就绪：隐藏壁纸自带的 HUD，并拉一次状态
            if (CONFIG.wallpaper.hideWallpaperHud) postToWallpaper('hud', false);
            postToWallpaper('state');
            pass(false);
            return;
          }
          if (d.type === 'state') {
            wallDiag.states += 1;
            paintControls(d);
            if (wallDiag.states === 1) pass(false);
          }
        };

        /** 控制条 → 壁纸命令。 */
        const onControlCommand = (kind, value) => {
          if (kind === 'scene') postToWallpaper('scene', value);
          else if (kind === 'volume') postToWallpaper('volume', value);
          else if (kind === 'gallery-toggle') {
            const open = toggleGallery();
            if (open && wallPort !== null && wallList.length > 0) {
              paintGallery(wallPort, wallList, onControlCommand);
            }
          } else if (kind === 'wallpaper') {
            // 换壁纸：记住选择 → 重建 iframe（ensureWallpaper 发现 src 变了会重建）
            saveEntry(value);
            wallDiag.load = false;
            wallDiag.loadError = false;
            wallDiag.ready = false;
            wallDiag.states = 0;
            if (wallPort !== null) {
              ensureWallpaper(wallPort);
              const picker = document.querySelector(`#${CTRL_ID} [data-role="wallpaper"]`);
              if (picker) picker.value = value;
              paintGallery(wallPort, wallList, onControlCommand);
              console.info('[dsh-liquid-glass] 已切换到壁纸:', value);
            }
          } else if (kind === 'audio-toggle') {
            const btn = document.querySelector(`#${CTRL_ID} [data-role="audio"]`);
            const nowOn = btn?.classList.contains('is-on') === true;
            postToWallpaper('audio', !nowOn);
          }
        };

        /**
         * 打标记。tag() 是幂等的（已经有类名就不重复加），
         * 但区域几何会变（侧栏折叠、右栏开关、窗口缩放），
         * 所以返回一个签名给上层，变了就整体重写样式。
         */
        /**
         * 左侧栏里的「行」级玻璃（会话项 / 新建会话 / 页脚按钮）。
         * 判据只认结构事实：整列内的可点行、宽度接近整列、高度 24~64px。
         * 不按类名 —— DSH 的类名是构建哈希。
         */
        const paintBarRows = (column, put) => {
          if (!column) return;
          const col = column.getBoundingClientRect();
          const rows = [];
          for (const el of column.querySelectorAll('button, a[href], [role="button"], [role="option"], li')) {
            const r = el.getBoundingClientRect();
            if (r.height < 22 || r.height > 64) continue;
            /* 会话行不一定铺满整列（有些版本是内容宽度），
               所以只要求「明显比一栏窄的碎片」被排掉：≥45%。 */
            if (r.width < col.width * 0.45) continue;
            if (r.width > col.width + 2) continue;
            rows.push(el);
          }
          // 只留最外层，避免按钮里再套按钮时叠两层玻璃
          let outer = rows.filter((el) => !rows.some((o) => o !== el && o.contains(el)));
          /* ⚠️ 品牌那一行里的按钮（DSH 的 <hash>_brand，包着鱼标 + 字标）
             不能被当成「会话行」加 dshlg-bar —— 那会给它 0.05 白底 + 1px 描边 + 圆角，
             正是用户看到的「harness 背后的底色」。
             品牌区要的是：按钮完全无底，字标直接落在品牌行的浅蓝玻璃上。 */
          const brandRow = document.querySelector('.dshlg-brand');
          if (brandRow) outer = outer.filter((el) => !brandRow.contains(el) && el !== brandRow);
          /* 一个都没命中时（布局差异），退一步：整列里**直接子级**的
             可点元素也算行 —— 宁可比理想情况多标一点，也不要整列秃着。 */
          if (outer.length === 0) {
            for (const el of column.querySelectorAll('button, a[href], [role="button"]')) {
              const r = el.getBoundingClientRect();
              if (r.height >= 20 && r.height <= 80) outer.push(el);
            }
          }
          for (const el of outer) put(el, 'bar', CLS_BAR, null, false);
        };

        /**
         * 左上角品牌区（DeepSeek 标 + 名字）改蓝色液态玻璃。
         *
         * 为什么不直接改图标：品牌位是 DSH 自己渲染的，
         * 我们只叠一层**蓝色玻璃底 + 边缘光学**，文字与 logo 原样保留 ——
         * 这样升级 DSH 后品牌结构变了也不会崩，最多是这层底色没贴上。
         * 选择器用 4 个稳定的类名碎片（哈希前缀会变，"_brand" 不会）。
         */
        
      /** 用自定义文字替换官方品牌字标（见 CONFIG.brand.label）。 */
      function renderBrandLabel(row) {
        if (!row) return;
        const cfg = CONFIG.brand && typeof CONFIG.brand === 'object' ? CONFIG.brand : {};
        const text = String(cfg.label ?? '').trim();
        for (const el of row.querySelectorAll(
          '[class*="_brandMark"], [class*="_brandName"], [class*="_brandIdentity"], [class*="_localBuildBrand"]',
        )) {
          el.dataset.dshlgHidden = '1';
          /* 直接写内联 !important —— 比依赖某条 CSS 规则是否被正确插入更可靠。
             （鱼标/worldmark 都属于「官方标识」，用户已要求完全去掉。） */
          el.style.setProperty('display', 'none', 'important');
        }
        let label = row.querySelector('.dshlg-brand-label');
        if (!text) { if (label) label.remove(); return; }
        if (!label) {
          label = document.createElement('span');
          label.className = 'dshlg-brand-label';
          label.dataset.dshlgKeep = '1';
          label.setAttribute('aria-label', text);
          /* 优先挂到品牌按钮上（DSH 的 <hash>_brand，本身就是承载标识的容器）；
             退而求其次才是行内第一个按钮。 */
          const host = row.querySelector('[class*="_brand"]') ?? row.querySelector('button') ?? row;
          /* prepend：放到容器最左侧（appendChild 会排在其它子元素后面，
             实测会被那个 + 按钮挤到右边）。 */
          host.prepend(label);
        }
        if (label.textContent !== text) label.textContent = text;
      }

      /** 把品牌子树里任何「画出来的底」用内联 !important 强制清掉。 */
      function stripBrandPaint(row) {
        if (!row) return;
        for (const el of [row, ...row.querySelectorAll('*')]) {
          if (el.hasAttribute('data-dshlg-keep') || el.classList.contains('dshlg-brand-label')) continue;
          let cs; try { cs = getComputedStyle(el); } catch { continue; }
          if (!cs) continue;
          const hasBg = cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)';
          const hasImg = cs.backgroundImage && cs.backgroundImage !== 'none';
          const hasBorderImg = cs.borderImageSource && cs.borderImageSource !== 'none';
          const hasShadow = cs.boxShadow && cs.boxShadow !== 'none';
          if (!hasBg && !hasImg && !hasBorderImg && !hasShadow) continue;
          el.style.setProperty('background', 'none', 'important');
          el.style.setProperty('background-color', 'transparent', 'important');
          el.style.setProperty('background-image', 'none', 'important');
          el.style.setProperty('border-image', 'none', 'important');
          el.style.setProperty('box-shadow', 'none', 'important');
        }
      }
const paintBrand = (column, put) => {
          /* 品牌行可能挂在侧栏列里，也可能被放到整帧的 leading 座位里，所以两处都找。
             优先用真实的类名（_logoRow），拿不到就退回「装 _brandMark 的那个最近的可视行」。 */
          const scope = [column, document.getElementById('root')].filter(Boolean);
          let row = null;
          for (const sc of scope) {
            row = sc.querySelector('[class*="_logoRow"]');
            if (row) break;
          }
          if (!row) {
            for (const sc of scope) {
              const mark = sc.querySelector('[class*="_brandMark"]');
              if (mark) { row = mark.closest('[class*="_logoRow"]') ?? mark.parentElement?.parentElement ?? null; break; }
            }
          }
          if (!row) {
            /* 最后一层：按**标题文字**找。
               产品名在不同版本会放进侧栏、顶栏或 leading 座位，
               但「左上角那块写着 DeepSeek Harness 的面」始终存在。
               条件收紧到：视口上方 20% 内、高度 ≤64px、文字完全命中。 */
            const words = String(CONFIG.brand?.titleWords ?? 'DeepSeek Harness')
              .split(/\s+/)
              .filter((w) => w.length >= 5);
            for (const sc of scope) {
              const cands = sc.querySelectorAll('div, span, header, h1');
              for (const el of cands) {
                const r = el.getBoundingClientRect();
                if (r.top > window.innerHeight * 0.2) continue;
                if (r.height < 16 || r.height > 64) continue;
                if (r.width < 60 || r.width > 420) continue;
                const text = (el.textContent ?? '').trim();
                if (!words.length || !words.some((w) => text.includes(w))) continue;
                if (el.querySelectorAll('*').length > 12) continue;   // 别把整块面板当标题
                row = el;
                break;
              }
              if (row) break;
            }
          }
          if (!row) return;
          /* region 传 null：品牌区不是「区域玻璃」，不该带 data-dshlg-region。
             否则 [data-dshlg-region][data-dshlg-chroma="1"]::before（最外缘色差环）
             与 [data-dshlg-spec="1"]::after（指针高光）会抢占伪元素，
             把品牌自己的玻璃底盖掉（实测 ::before 变成了 conic 彩虹环）。 */
          put(row, null, CLS_BRAND, [row], false);
          renderBrandLabel(row);
          /* 画完立刻扫一遍：任何「计算样式里还有底」的节点都被内联 !important 清掉。
             为什么要用内联 !important：DSH 自己的规则也带 !important，
             普通作者样式表压不住它；而内联 !important 在层叠顺序里最高。 */
          stripBrandPaint(row);
          /* 旁边的白块：新建会话按钮 / 图标按钮上的实底色一并收掉，
             否则玻璃旁边挂着一块死的白／深色矩形，非常扎眼。 */
          for (const el of row.querySelectorAll('button, [role="button"]')) {
            if (!el.hasAttribute('data-dshlg-keep')) el.dataset.dshlgFlat = '1';
          }
          /* DSH 可能把「Harness 铭牌」的底写成**内联样式**，而内联的 !important
             是 CSS（哪怕 !important）也覆盖不了的 —— 只能直接摘掉属性。 */
          for (const el of row.querySelectorAll('*')) {
            const st = el.style;
            if (!st || !st.length) continue;
            for (const prop of [
              'background', 'background-color', 'background-image', 'background-blend-mode',
              'box-shadow', 'border-image', 'border-image-source', 'border-image-slice',
              'filter', 'backdrop-filter',
            ]) {
              if (st.getPropertyValue(prop)) st.removeProperty(prop);
            }
          }
        };

        /** 包一层：某个区域的绘制异常不能拖垮其他区域。 */
        const safe = (label, fn) => {
          try {
            fn();
          } catch (error) {
            console.warn('[dsh-liquid-glass] ' + label + ' 绘制失败：', error);
          }
        };

        const paintRegions = (found, frame) => {
          const tagged = [];
          const stop = frame ?? null;

          const put = (el, region, cls, bounds = null, closed = false) => {
            if (!el) return;
            const host = hostFor(el, stop, 3, bounds);
            if (!host) return;
            tag(host, cls);
            /* region 为假值时要**删掉属性**，不能赋 null ——
               dataset 会把 null 序列化成字符串 "null"，属性依然存在，
              于是 [data-dshlg-region] 开头的规则（色差环 ::before / 指针高光 ::after）
              照样命中，把品牌自己的玻璃伪元素盖掉。 */
            if (region) {
              if (host.dataset.dshlgRegion !== region) host.dataset.dshlgRegion = region;
            } else if (host.hasAttribute('data-dshlg-region')) {
              delete host.dataset.dshlgRegion;
            }
            // 收起态：给样式留一个钩子（CSS 里 [data-dshlg-closed] 一档全透明）
            if (closed) host.dataset.dshlgClosed = '1';
            else delete host.dataset.dshlgClosed;
            /* 越界边缘那两层的开关：
               · chroma —— 最外缘 ≤2px 彩虹色差（只在有边缘透镜的面才开）
               · spec   —— 高光随指针滑移 */
            const chromaOn = num(g('chroma', 2), 2) > 0 && num(g('chromaAlpha', 0.22), 0.22) > 0;
            if (chromaOn && !closed) host.dataset.dshlgChroma = '1';
            else delete host.dataset.dshlgChroma;
            if (g('pointerFollow', true) !== false && !closed) host.dataset.dshlgSpec = '1';
            else delete host.dataset.dshlgSpec;
            /* 收起时把内联的高光坐标变量也摘掉。
               内联自定义属性优先级高于任何选择器，留着会让「收起态」
               在计算样式里仍带着上一轮的玻璃痕迹 —— 别留给下一个人排查。 */
            if (closed) {
              host.style.removeProperty('--dshlg-mx');
              host.style.removeProperty('--dshlg-my');
            }
            tagged.push([region, rectOf(host), closed]);
          };

          if (CONFIG.sidebar) {
            put(found.sidebar, 'side', CLS_SIDE);
            /* 左栏里「会浮起来的行」（会话行、新建按钮行）单独再给一层玻璃 ——
               和右栏同款。整列已经很透，行上再有一层才有 iOS 的分层感。 */
            if (found.sidebar) safe('左栏会话行', () => paintBarRows(found.sidebar, put));
          }
          /* 左上角品牌区：蓝色液态玻璃（即便没探到侧栏也要试 —— 标题可能在顶栏） */
          if (CONFIG.brand) safe('品牌区', () => paintBrand(found.sidebar, put));

          if (CONFIG.right) {
            /* 玻璃要贴在**真正画出内容的那块面板**上：
               · 钩子命中（data-sidebar-right-session）→ 就是它本人；
               · 几何兜底命中轨道 → 再往里找一层面板本体（轨道那一条窄带没内容）。 */
            const track = found.right?.closest('[data-rightbar-col]') ?? found.right ?? null;
            const inner = found.right
              ? (found.rightVia === 'hook'
                  ? found.right
                  : findPanelInsideColumn(found.right, window.innerWidth, window.innerHeight))
              : null;
            const surface = inner && found.right && inner !== found.right ? inner : found.right;

            /* 收起判定**看整列**，不看某一块面：
               探测有可能选中轨道，那样单看这一块会答「收起」，
               而真正还开着的那块面板却留着玻璃。
               → rightColumnCollapsed() 只要容器里还有任何一个开着 session 面板
                 就算开着；一个都没有才整列按收起处理。 */
            const collapsed = CONFIG.rightWhenClosed !== 'keep'
              && rightColumnCollapsed(track, surface);

            if (surface && !collapsed) {
              const bounds = found.rightVia === 'hook'
                ? [surface]
                : (surface !== found.right ? [surface] : null);
              put(surface, 'right', CLS_RIGHT, bounds, false);
            } else if (track) {
              /* 收起态：给**整列**打收起标记 —— 玻璃可能落在列内任何一层，
                 只标一层的话，别的层照样留模糊。 */
              tag(track, CLS_RIGHT);
              track.dataset.dshlgRegion = 'right';
              track.dataset.dshlgClosed = '1';
              delete track.dataset.dshlgChroma;
              delete track.dataset.dshlgSpec;
              track.style.removeProperty('--dshlg-mx');
              track.style.removeProperty('--dshlg-my');
              for (const child of track.querySelectorAll('*')) {
                if (child.hasAttribute('data-dshlg-region')) {
                  child.dataset.dshlgClosed = '1';
                  delete child.dataset.dshlgChroma;
                  delete child.dataset.dshlgSpec;
                  child.style.removeProperty('--dshlg-mx');
                  child.style.removeProperty('--dshlg-my');
                }
              }
              tagged.push(['right(收起)', rectOf(track), true]);
            }
          }

          if (CONFIG.approval && found.approval) {
            // 审批卡面：就地套（往上爬会爬到 composer takeover 容器上，
            // 那样卡里的字还是压在壁纸上）
            put(found.approval, 'approval', CLS_APPROVAL, [found.approval]);
          }
          if (CONFIG.modal && found.modal) put(found.modal, 'modal', CLS_MODAL);

          return tagged
            .map(([region, r, isClosed]) => (r ? `${region}${isClosed ? '(收起)' : ''}:${r.w}x${r.h}@${r.left}` : `${region}:?`))
            .join('|');
        };

        /* 节流：MutationObserver 在界面活动时会非常密集地触发，
           每遍都重算样式/重建控件就是「一直在闪」。合并到最多 ~5 遍/秒，
           首帧（first）不节流，保证启动即生效。 */
        let passDue = 0;
        let passTimer = null;
        const pass = (first) => {
          if (disposed || !document.body) return false;
          if (!first) {
            const now = Date.now();
            if (now < passDue) {
              /* ⚠️ 关键：被节流掉的调用必须**排一次尾随执行**。
                 否则「靠某一次 pass 才发生的事」（例如壁纸探到端口后建控制条）
                 会被永久吞掉 —— 实测就是控制条再也没建出来。 */
              if (passTimer === null) {
                passTimer = setTimeout(() => {
                  passTimer = null;
                  pass(true);
                }, Math.max(16, passDue - now + 1));
              }
              return false;
            }
            passDue = now + 200;
          }
          try {
            return passInner(first);
          } catch (error) {
            const text = String((error && error.stack) || error);
            if (!window.__DSHLG_ERR) window.__DSHLG_ERR = 'pass 失败: ' + text;
            console.error('[dsh-liquid-glass] pass 失败（已忽略，界面保持原生）：', error);
            return false;
          }
        };

        /* 把内部的 pass 暴露给模块级代码（设置面板 / 拖动 / 重置位置） */
        requestPass = (first) => pass(first);

        const passInner = (first) => {
          const theme = readTheme();
          const found = discover();

          const wallActive = CONFIG.wallpaper.enabled && wallPort !== null;
          if (wallActive) {
            ensureWallpaper(wallPort);
            const ctrl = ensureControls(theme, onControlCommand);
            if (ctrl) avoidComposerOverlap(ctrl);
            ensureGallery();
            if (wallList.length > 0) {
              paintWallpaperPicker(wallList);
              paintGallery(wallPort, wallList, onControlCommand);
            }
            // 首帧主动拉一次状态，之后靠控制桥回报
            if (first) setTimeout(() => postToWallpaper('state'), 1200);
          } else {
            document.getElementById(CTRL_ID)?.remove();
            document.getElementById(GALLERY_ID)?.remove();
          }

          let changed = 0;
          if (CONFIG.composer && tag(found.composer, CLS_GLASS)) changed++;
          if (CONFIG.toolbar && tag(found.toolbar, CLS_TOOLBAR)) changed++;

          const frame = document.getElementById('root')?.querySelector('[class*="_frame"]') ?? null;
          const sig = paintRegions(found, frame);

          // 静态材质（一次即可）+ 边缘透镜变量（随 edgeWidth 变）
          ensureStylesheet();
          ensureFades();
          /* 自制 UI 的维护：任何一处出错都不能中断整轮 pass ——
             否则会连带「样式没应用」「画廊不出现」这类看起来毫不相关的故障。 */
          /* 可读性：测壁纸亮度 → 自动压暗（没手动设过时） */
          try {
            const curId = (CONFIG.wallpaper && (CONFIG.wallpaper.currentId || CONFIG.wallpaper.entry)) || null;
            if (wallPort && curId && wallLum.id !== curId) {
              measureWallpaperLuminance(wallPort, curId)
                .then((L) => {
                  applyWallLuminance(L);
                  const manual = document.documentElement.dataset.dshlgDimManual === '1';
                  const want = dimForLuminance(L);
                  if (!manual && Math.abs((CONFIG.wallpaper.dim ?? 0) - want) > 0.02) {
                    CONFIG.wallpaper.dim = want;      // 压暗壁纸本身 → 界面仍全透明
                    requestPass(true);
                  }
                })
                .catch(() => { /* 测不到就保持默认压暗值 */ });
            }
          } catch { /* 忽略 */ }
          try { ensureSettingsUI(); positionGear(); } catch (error) {
            console.warn('[dsh-liquid-glass] 自制 UI 维护失败：', error);
          }
          ensureSapphireDefs();
          applyEdgeVars();
          /* 品牌蓝：按当前主题重算色相（深色主题=浅蓝字、浅色主题=深蓝字），
             写到 :root 上供 styles.css 的品牌规则使用。 */
          for (const decl of buildBrandVars(theme).split(';')) {
            const i = decl.indexOf(':');
            if (i < 0) continue;
            const k = decl.slice(0, i).trim();
            if (!k.startsWith('--')) continue;
            document.documentElement.style.setProperty(k, decl.slice(i + 1).trim());
          }
          /* 品牌旁的白块：补一次标记（品牌行可能是后渲染出来的） */
          if (CONFIG.brand && found.sidebar) {
            const row = found.sidebar.querySelector('[class*="_logoRow"]');
            if (row) {
              for (const el of row.querySelectorAll('button, [role="button"]')) {
                if (!el.hasAttribute('data-dshlg-keep')) el.dataset.dshlgFlat = '1';
              }
            }
          }
          // 动态部分每遍都重算：主题可能切换，区域几何也可能变
          ensureFilter(
            CONFIG.overlayMode === 'clear'
              ? 0
              : (CONFIG.refractRegions === true
                  ? num(g('edgeRefract', 10), 10)
                  : num(g('edgeRefract', 10), 10)),
          );
          applyStyle(
            buildBaseCss(theme) +
              (wallActive ? buildWallpaperCss() : buildBackdrop(theme)) +
              '' /* 静态材质由 styles.css 提供 */ +
              buildRegionCss(theme) +
              buildOverlayCss(theme) +
              buildControlsCss(theme) +
              buildCss(theme),
          );

          // 壁纸在用时，内置背景层让位；还没探到则先用内置的顶着
          if (wallActive) removeBackdrop();
          else ensureBackdrop(theme);

          // 玻璃预算：超出的面降级成实色（模糊太贵，必须封顶）
          const budget = enforceGlassBudget();

          // 横幅：状态变了就刷新（否则会停留在"探测中"这种旧状态）
          const reportKey = `${wallActive}:${wallPort}:${theme.dark}:${sig}:${budget.over}`;
          if (CONFIG.report && (first || changed > 0 || reportKey !== lastReportKey)) {
            lastReportKey = reportKey;
            const w = CONFIG.wallpaper;
            const sideLayer = layer('sidebarGlass', 0.14);
            const rightLayer = layer('rightGlass', 0.14);
            const approvalLayer = layer('approvalGlass', 0.3);
            report([
              `✅ dsh-liquid-glass v${VERSION}`,
              `主题: ${theme.dark ? '深色' : '浅色'}　底色 ${theme.base ? toHex(theme.base) : '(读不到)'}`,
              `分层: 中间 全透明　左栏 α${sideLayer.alpha}/模糊${sideLayer.frost}　右栏 α${rightLayer.alpha}/模糊${rightLayer.frost}　审批卡 α${approvalLayer.alpha}/模糊${approvalLayer.frost}`,
              `iOS 规格: 白纱 ${g('tint', 0.08)}　模糊 ${g('blur', 18)}px　饱和 ${g('saturate', 1.6)}　圆角 ${g('radius', 20)}px　描边 ${g('border', 1)}px/${g('borderAlpha', 0.18)}`,
              `边缘透镜 ${g('edgeRefract', 10)}px（边宽 ${(num(g('edgeWidth', 0.12), 0.12) * 100).toFixed(0)}%）　色差 ${g('chroma', 2)}px/${g('chromaAlpha', 0.22)}　侧栏折射 ${CONFIG.refractRegions === true ? '开' : '关'}　指针高光 ${g('pointerFollow', true) === false ? '关' : '开'}`,
              `内容块 ${CONFIG.contentFill}（α${CONFIG.contentFillAlpha}）　文字 ${CONFIG.textColor || '跟随主题'}　阴影 ${CONFIG.textShadow}`,
              '',
              `聊天框: ${found.composer ? `已命中（${found.composer.tagName.toLowerCase()}，${found.composer.querySelectorAll('button').length} 个按钮）` : '未命中'}`,
              `工具栏: ${found.toolbar ? `已命中（${found.toolbar.querySelectorAll('button').length} 个按钮）` : '未命中'}`,
              `区域: ${sig || '(无)'}`,
              wallActive
                ? `壁纸: ✅ ${currentEntry()}（端口 ${wallPort}，清单 ${wallList.length} 张）`
                : `壁纸: ${w.enabled ? (wallTried ? '❌ 没探到宿主服务 —— 宿主半体没加载？' : '…探测中') : '已关闭'}，当前用内置背景`,
              wallActive
                ? `  链路: 入口 ${wallDiag.fetchStatus}　iframe load ${wallDiag.load ? '✅' : wallDiag.loadError ? '❌ error' : '…'}　控制桥 ready ${wallDiag.ready ? '✅' : '…'}　状态回报 ${wallDiag.states} 次`
                : '',
              found.notes.length ? '\n探测记录:\n  ' + found.notes.join('\n  ') : '',
              '',
              `已标记玻璃面：左栏 ${document.querySelectorAll('[data-dshlg-region="side"]').length}　` +
                `右栏 ${document.querySelectorAll('[data-dshlg-region="right"]').length}　` +
                `审批 ${document.querySelectorAll('[data-dshlg-region="approval"]').length}　` +
                `弹窗 ${document.querySelectorAll('[data-dshlg-region="modal"]').length}`,
              '（点这条可复制全部文字）',
            ].filter(Boolean));
          }
          return changed > 0;
        };

        /* ── 玻璃预算：同时最多几处 backdrop-filter ─────────────
           模糊是滚动性能的头号杀手，所以要封顶。但**封顶的对象是浮层，
           不是结构**：
             · 结构性大面（左栏 / 右栏 / 输入卡片）是界面的骨架，常驻存在，
               必须固定保留模糊 —— 它们被降级的表现就是「左侧栏没有玻璃」，
               实测踩过：预算 3 处、场上 5 块面，排到第 4 的侧栏被打上
               data-dshlg-glass-over → backdrop-filter: none，
               于是「左栏和右栏效果不一致」。
             · 真正会同时堆叠的是浮层（审批卡、弹窗、菜单），
               它们才参与预算竞争。 */
        const GLASS_BUDGET = 2;              // 浮层的模糊处数上限
        const STRUCTURAL = new Set(['side', 'right']);

        /** 是不是「结构性常驻面」——不参与预算。 */
        const isStructural = (el) => {
          const region = el.getAttribute('data-dshlg-region');
          if (STRUCTURAL.has(region)) return true;
          // 输入卡片没有 region，靠类名认
          return el.classList.contains('dshlg-glass');
        };

        /** 浮层优先级：审批卡 > 弹窗 > 其他（越靠前越该保留模糊）。 */
        const rankOf = (el) => {
          const region = el.getAttribute('data-dshlg-region');
          if (region === 'approval') return 0;
          if (region === 'modal') return 1;
          return 2;
        };

        /**
         * 按预算给**浮层**排序：前 GLASS_BUDGET 个保留 backdrop-filter，
         * 其余打 data-dshlg-glass-over 走实色降级。
         * 收起态的面本来就没有模糊，不占预算；结构性大面固定保留。
         */
        const enforceGlassBudget = () => {
          const all = Array.from(document.querySelectorAll('[data-dshlg-region], .dshlg-glass'))
            .filter((el) => el.isConnected && !el.hasAttribute('data-dshlg-closed'));
          // 同一层里只留最外层（子元素跟着父级一起糊，不该重复占额度）
          const unique = all.filter((el) => !all.some((o) => o !== el && o.contains(el)));
          const floats = unique.filter((el) => !isStructural(el));
          // 结构性面一律恢复模糊（可能被上一版的旧标记降级过）
          for (const el of unique) {
            if (isStructural(el)) delete el.dataset.dshlgGlassOver;
          }
          floats.sort((a, b) => rankOf(a) - rankOf(b) || depthOf(a) - depthOf(b));
          floats.forEach((el, i) => {
            if (i < GLASS_BUDGET) delete el.dataset.dshlgGlassOver;
            else el.dataset.dshlgGlassOver = '1';
          });
          return { structural: unique.length - floats.length, floats: floats.length, over: Math.max(0, floats.length - GLASS_BUDGET) };
        };

        /**
         * 高光随指针滑移：把光标在面内的归一化位置写进 --dshlg-mx/my。
         * 只有带 data-dshlg-spec 的面（也就是非收起态的那些）会被更新。
         * rAF 节流，避免 pointermove 把主线程喂爆。
         */
        const onPointerMove = (event) => {
          if (disposed) return;
          const target = event.target;
          if (!target || typeof target.closest !== 'function') return;
          const host = target.closest('[data-dshlg-spec]');
          if (!host) return;
          const x = event.clientX;
          const y = event.clientY;
          if (pointerRaf !== null) cancelAnimationFrame(pointerRaf);
          pointerRaf = requestAnimationFrame(() => {
            pointerRaf = null;
            if (disposed || !host.isConnected) return;
            const r = host.getBoundingClientRect();
            if (r.width < 1 || r.height < 1) return;
            const mx = (((x - r.left) / r.width) * 100).toFixed(1);
            const my = (((y - r.top) / r.height) * 100).toFixed(1);
            host.style.setProperty('--dshlg-mx', `${mx}%`);
            host.style.setProperty('--dshlg-my', `${my}%`);
          });
        };

        /**
         * 窗口尺寸变化时重跑一遍。
         * 侧栏折叠/展开、聊天框自适应都会改变几何，而几何正是侧栏的判据；
         * 这类变化不一定触发 MutationObserver，所以要单独听 resize。
         */
        const onResize = () => {
          if (disposed) return;
          /* 窗口一变，cover 语义下的可见区就变了 —— 亮度缓存只按 id 记，
             不作废就会拿着一块区域的亮度去算另一块的可读性。 */
          wallLum.id = null;
          /* 面板开着时，布局一变背后的内容就变了 → 重新判断可读性 */
          setTimeout(() => { try { adaptPanelReadability(); positionGear(); } catch { /* 忽略 */ } }, 120);
          if (timer !== null) clearTimeout(timer);
          timer = setTimeout(() => {
            timer = null;
            if (!disposed) pass(false);
          }, 250);
        };

        const start = () => {
          if (disposed) return;
          ensureFilter(num(CONFIG.refract, 18));
          pass(true);
          window.addEventListener('message', onWallpaperMessage);
          window.addEventListener('resize', onResize);
          window.addEventListener('pointermove', onPointerMove, { passive: true });
          void findWallpaper();   // 异步探端口，探到后自己重跑 pass()
          // DOM 会随会话切换重建，观察变化后重打标记
          try {
            observer = new MutationObserver(() => {
              if (timer !== null) clearTimeout(timer);
              timer = setTimeout(() => {
                timer = null;
                if (!disposed) pass(false);
              }, 300);
            });
            observer.observe(document.body, { childList: true, subtree: true });
          } catch (error) {
            console.warn('[dsh-liquid-glass] MutationObserver 失败:', error);
          }
        };

        const cleanup = () => {
          disposed = true;
          window.removeEventListener('message', onWallpaperMessage);
          window.removeEventListener('resize', onResize);
          window.removeEventListener('pointermove', onPointerMove);
          if (pointerRaf !== null) cancelAnimationFrame(pointerRaf);
          if (observer) observer.disconnect();
          if (timer !== null) clearTimeout(timer);
          ccTeardown();
          untagAll();
          document.querySelectorAll('[data-dshlg-region]').forEach((el) => delete el.dataset.dshlgRegion);
          for (const id of [STYLE_ID, STYLE_ID_DYN, STYLE_LINK_ID, SVG_ID, BG_ID, WALL_ID, CTRL_ID, GALLERY_ID, RESTORE_ID, FADE_TOP_ID, FADE_BOTTOM_ID, SAPPHIRE_ID, SETTINGS_ID, GEAR_ID, BANNER_ID]) {
            document.getElementById(id)?.remove();
          }
        };

        if (typeof ctx?.effect === 'function') ctx.effect(() => cleanup);
        else if (typeof ctx?.on === 'function') ctx.on('dispose', cleanup);

        if (document.body) start();
        else document.addEventListener('DOMContentLoaded', start, { once: true });
    }

    return {
      /**
       * 导出给 DSH 加载器的入口。
       *
       * 刻意不用 `this`：加载器是**解构导出后单独调用** apply 的，
       * `this` 不指向模块对象 —— 实测线上因此崩过一次
       * （TypeError: this._apply is not a function → web boot: 1 entry did not activate）。
       *
       * 也刻意**不把异常抛出去**：DSH 把「apply 抛错」判成 entry 未激活，
       * 会连带把同一次 boot 里的其他插件一起拖下水（用户看到的就是
       * 「壁纸和玻璃全没了」）。没玻璃是小事，连界面一起没是大事 ——
       * 所以这里吞掉异常，只留痕 + 打日志。
       */
      apply(ctx) {
        try {
          return applyGlass(ctx);
        } catch (error) {
          try { window.__DSHLG_ERR = String((error && error.stack) || error); } catch { /* 忽略 */ }
          console.error('[dsh-liquid-glass] apply 失败（已忽略，不影响其他插件）：', error);
          return undefined;
        }
      },
    };
    } catch (error) {
      /* factory 最外层：连「导出对象」都没构造出来时也走到这里。
         绝不 rethrow —— 抛出去就是整包 boot 失败（用户的壁纸与玻璃一起消失）。 */
      try { window.__DSHLG_ERR = String((error && error.stack) || error); } catch { /* 忽略 */ }
      console.error('[dsh-liquid-glass] 加载失败（已忽略，不影响其他插件）：', error);
      return { apply() { /* 降级成空实现：界面回到 DSH 原生材质 */ } };
    }
  },
});
