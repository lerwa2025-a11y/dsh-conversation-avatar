/**
 * dsh-conversation-avatar —— Client 半。
 *
 * 移植自 dsh-plugin-wallpaper-engine 的「自定义会话头像」装饰层，只保留头像扩展本身，
 * 并补上两项用户要的行为：
 *   ① 头像跟随滚动（sticky 语义）：行顶滚出可视区 ⇒ 头像贴顶跟着走；行快滚完 ⇒ 停行尾随行滚出。
 *   ② AI 回复气泡框：只给最终回复套框，思考过程 / 工具区不套；开关可启停。
 *
 * 与壁纸引擎那套的关键差别：
 *   - 头像**每个消息行都挂**（包括展开的过程区里的行）—— 这才是用户要的"多个头像"；
 *   - 有独立的数据目录与设置（不复用 ~/.dsh-wallpaper-engine）；
 *   - 设置入口是**这个插件自己的详情页**（plugins.bundle.config，按包名 keyed），
 *     不再占「设置」页里单独的一节。
 */

window.__ModuleLoader__.load({
  id: 'dsh-conversation-avatar',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
    let react = require('react');

    // ── 常量 ────────────────────────────────────────────────────────────────
    const API = '/dsh-conversation-avatar';

    /** 三种「消息行」的 kind → 头像属于哪一方（移植自壁纸引擎）。 */
    const AVATAR_FLOW_SIDES = { user: 'user', steering: 'user', 'assistant-step': 'ai' };
    /** 消息行选择器。 */
    const AVATAR_ROW_SELECTOR =
      '[data-chat-flow-kind="user"], [data-chat-flow-kind="steering"], [data-chat-flow-kind="assistant-step"]';

    const AVATAR_ROW_ATTR = 'data-cav-row';
    const AVATAR_NODE_CLASS = 'cav-avatar';
    const AVATAR_NODE_ATTR = 'data-cav-node';
    const AVATAR_ATTR = 'data-cav-on';
    const VAR_SIZE = '--cav-size';
    const VAR_ROUND = '--cav-round';

    /** 尺寸 16–128；圆角 0–100；吸顶下移 0–6（个头像身位）。 */
    const CLAMP_SIZE = { min: 16, max: 128, def: 40 };
    const CLAMP_ROUND = { min: 0, max: 100, def: 100 };

    /*
     * ── [本地补丁 · 字体清单] ────────────────────────────────────────────────
     * 只列**本机实测装了的**中文字体（2026-10-25 用 InstalledFontCollection 查过）。
     *
     * 为什么不照搬 dsh-fonttune 的 22 项清单：那份清单里有 PingFang SC、
     * Hiragino、Sarasa Gothic 等 macOS/第三方字体，本机没有。列出来选中后
     * 浏览器静默回退到别的字体，看上去像「功能没生效」，其实是字体不存在。
     *
     * 每项 value 是完整的 CSS font-family 值：中文名 + 英文名 + 兜底，
     * 这样不同引擎都能命中，末尾的 generic family 保证永远有字可显示。
     */
    const FONT_FAMILIES = [
      { label: '主题默认', value: '' },
      { label: '微软雅黑', value: '"Microsoft YaHei", "微软雅黑", sans-serif' },
      { label: 'Noto Sans SC（思源黑体风格）', value: '"Noto Sans SC", "Microsoft YaHei", sans-serif' },
      { label: '宋体', value: 'SimSun, "宋体", serif' },
      { label: '黑体', value: '"黑体", SimHei, sans-serif' },
      { label: '楷体', value: 'KaiTi, "楷体", serif' },
      { label: '仿宋', value: 'FangSong, "仿宋", serif' },
    ];

    /** 等宽字体清单。Consolas 是 Windows 自带，JetBrains Mono 装了就用。 */
    const MONO_FAMILIES = [
      { label: '主题默认', value: '' },
      { label: 'Consolas', value: 'Consolas, "Courier New", monospace' },
      { label: 'JetBrains Mono', value: '"JetBrains Mono", Consolas, monospace' },
      { label: '等宽（系统默认）', value: 'monospace' },
    ];

    /** 内置默认头像（没导入图片时画）：user = 人像，ai = 四角星。 */
    const GLYPH_PARTS = {
      user: [
        ['circle', { cx: '8', cy: '5.6', r: '2.5' }],
        ['path', { d: 'M3.4 13.2c0-2.3 2.1-3.8 4.6-3.8s4.6 1.5 4.6 3.8' }],
      ],
      ai: [
        ['path', { d: 'M8 2.2l1.35 3.9a1.6 1.6 0 0 0 1 1l3.9 1.35-3.9 1.35a1.6 1.6 0 0 0-1 1L8 14.7l-1.35-3.9a1.6 1.6 0 0 0-1-1L1.75 8.45l3.9-1.35a1.6 1.6 0 0 0 1-1z' }],
      ],
    };
    const GLYPH_VIEW_BOX = '0 0 16 16';

    // ── 状态 ────────────────────────────────────────────────────────────────
    const DEFAULT_SETTINGS = {
      plugin: { enabled: true, aiBubble: true, stickOffset: 2 },
      avatarSize: 40,
      avatarRadius: 100,
      // [本地补丁] 气泡框外观：底色留空 = 跟随主题；alpha/blur 让它透出主题与壁纸
      bubbleBg: '',
      bubbleBorder: '',
      bubbleRadius: 14,
      bubbleAlpha: 100,
      bubbleBlur: 10,
      // [本地补丁] 正文字色：留空 = 跟随主题
      textColor: '',
      // [本地补丁] 用户消息字色：留空 = 跟随主题
      userTextColor: '',
      // [本地补丁] 字体（从 dsh-fonttune 移植的精简版）
      fontFamily: '',
      fontMono: '',
      // 字体覆盖层：空 = 沿用界面字体。填了则正文/标题单独用它。
      bodyFont: '',
      headingFont: '',
      fontSizeDelta: 0,
      headingSizeDelta: 0,
      lineHeightDelta: 0,
      fontWeight: 0,
    };
    let settings = DEFAULT_SETTINGS;
    let availability = { user: false, ai: false };
    const listeners = new Set();
    let layerSync = null;

    const clamp = (v, lo, hi, fb) => {
      const n = typeof v === 'number' ? v : Number(v);
      if (!Number.isFinite(n)) return fb;
      return Math.min(hi, Math.max(lo, Math.round(n)));
    };
    /** 只接受 `#rgb` / `#rrggbb`（以及空串 = 跟随主题），避免任意值进 CSS 造成注入。 */
    const hexOf = (v) => {
      if (typeof v !== 'string') return '';
      const s = v.trim();
      return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s) ? s : '';
    };
    const sizeOf = () => clamp(settings.avatarSize, CLAMP_SIZE.min, CLAMP_SIZE.max, CLAMP_SIZE.def);
    const roundOf = () => clamp(settings.avatarRadius, CLAMP_ROUND.min, CLAMP_ROUND.max, CLAMP_ROUND.def);
    const stickOffsetOf = () => clamp(settings.plugin?.stickOffset, 0, 6, 2);
    /**
     * 头像是否跟随滚动（v1.0）。
     *   true  = 贴住滚动区顶部跟着走（老行为，默认）
     *   false = 只固定在行首，长回复往下滚时头像随行一起滚走
     * 缺省 true：旧配置里没有这个键时不能被判成「关」。
     */
    const stickFollowOf = () => settings.plugin?.stickFollow !== false;
    const aiBubbleOn = () => settings.plugin?.aiBubble !== false;
    const bubbleRadiusOf = () => clamp(settings.bubbleRadius, 0, 40, 14);
    const bubbleAlphaOf = () => clamp(settings.bubbleAlpha, 0, 100, 100);
    const bubbleBlurOf = () => clamp(settings.bubbleBlur, 0, 30, 10);

    /**
     * [本地补丁] 正文字色。返回合法 hex 或 ''（空 = 跟随主题）。
     *
     * 只做「是不是颜色」的判断，不干预用户选什么颜色 —— 太浅看不清是用户的选择，
     * 面板上给一句提示即可，不拦、不自动纠正。
     */
    const textColorOf = () => hexOf(settings.textColor);

    /** [本地补丁] 用户消息字色。返回合法 hex 或 ''（空 = 跟随主题）。 */
    const userTextColorOf = () => hexOf(settings.userTextColor);

    // ── [本地补丁 · 字体] 取值与净化 ──────────────────────────────────────
    /** 字体栈：空串 = 沿用主题；非法字符（能逃出 CSS 声明的）一律丢掉。 */
    const fontStackOf = (v) => {
      if (typeof v !== 'string') return '';
      const s = v.trim().slice(0, 200);
      if (s === '') return '';
      return /^[\w\s\u4e00-\u9fa5\-,"'·]+$/.test(s) ? s : '';
    };
    const fontFamilyOf = () => fontStackOf(settings.fontFamily);
    const fontMonoOf = () => fontStackOf(settings.fontMono);
    /**
     * 界面上「界面字体」下拉框当前该显示哪一项。
     * 存的是完整字体栈，但 <option> 的 value 也是完整栈，直接相等即可。
     * 若存的值不在清单里（比如手改过配置文件），退回第一项「主题默认」，
     * 避免下拉框显示空白。
     */
    const familyOf = () => {
      const v = fontFamilyOf();
      return FONT_FAMILIES.some((f) => f.value === v) ? v : '';
    };
    const bodyFontOf = () => fontStackOf(settings.bodyFont);
    const headingFontOf = () => fontStackOf(settings.headingFont);
    /** 偏移量：0 = 跟随主题。 */
    const fontSizeDeltaOf = () => clamp(settings.fontSizeDelta, -4, 8, 0);
    const headingSizeDeltaOf = () => clamp(settings.headingSizeDelta, -6, 12, 0);
    const lineHeightDeltaOf = () => clamp(settings.lineHeightDelta, -20, 60, 0);
    const fontBoldOf = () => clamp(settings.fontWeight, 0, 700, 0);
    /** [本地补丁] 设了合法颜色就写入变量，留空/非法则移除变量 ⇒ CSS 回落到主题色。 */
    function applyColorVar(el, name, value) {
      const hex = hexOf(value);
      if (hex) el.style.setProperty(name, hex);
      else el.style.removeProperty(name);
    }

    function sanitize(patch, current) {
      const p = patch && typeof patch === 'object' ? patch : {};
      const pl = p.plugin && typeof p.plugin === 'object' ? p.plugin : {};
      return {
        plugin: {
          enabled: typeof pl.enabled === 'boolean' ? pl.enabled : current.plugin.enabled,
          aiBubble: typeof pl.aiBubble === 'boolean' ? pl.aiBubble : current.plugin.aiBubble,
          stickOffset: clamp(pl.stickOffset ?? current.plugin.stickOffset, 0, 6, 2),
          /* 头像跟随滚动（v1.0）。缺省视为 true —— 旧配置没有这个键时保持老行为。 */
          stickFollow: typeof pl.stickFollow === 'boolean' ? pl.stickFollow : current.plugin.stickFollow !== false,
        },
        avatarSize: clamp(p.avatarSize ?? current.avatarSize, CLAMP_SIZE.min, CLAMP_SIZE.max, CLAMP_SIZE.def),
        avatarRadius: clamp(p.avatarRadius ?? current.avatarRadius, CLAMP_ROUND.min, CLAMP_ROUND.max, CLAMP_ROUND.def),
        bubbleBg: p.bubbleBg === undefined ? current.bubbleBg : hexOf(p.bubbleBg),
        bubbleBorder: p.bubbleBorder === undefined ? current.bubbleBorder : hexOf(p.bubbleBorder),
        bubbleRadius: clamp(p.bubbleRadius ?? current.bubbleRadius, 0, 40, 14),
        bubbleAlpha: clamp(p.bubbleAlpha ?? current.bubbleAlpha, 0, 100, 100),
        bubbleBlur: clamp(p.bubbleBlur ?? current.bubbleBlur, 0, 30, 10),
        textColor: p.textColor === undefined ? current.textColor : hexOf(p.textColor),
        userTextColor: p.userTextColor === undefined ? current.userTextColor : hexOf(p.userTextColor),
        // ── [本地补丁 · 字体] ──
        fontFamily: p.fontFamily === undefined ? current.fontFamily : fontStackOf(p.fontFamily),
        fontMono: p.fontMono === undefined ? current.fontMono : fontStackOf(p.fontMono),
        bodyFont: p.bodyFont === undefined ? current.bodyFont : fontStackOf(p.bodyFont),
        headingFont: p.headingFont === undefined ? current.headingFont : fontStackOf(p.headingFont),
        fontSizeDelta: clamp(p.fontSizeDelta ?? current.fontSizeDelta, -4, 8, 0),
        headingSizeDelta: clamp(p.headingSizeDelta ?? current.headingSizeDelta, -6, 12, 0),
        lineHeightDelta: clamp(p.lineHeightDelta ?? current.lineHeightDelta, -20, 60, 0),
        fontWeight: clamp(p.fontWeight ?? current.fontWeight, 0, 700, 0),
      };
    }

    const getSettings = () => settings;
    const hasAvatar = (side) => availability[side] === true;
    function notify() {
      listeners.forEach((fn) => fn());
      layerSync?.();
    }
    function subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }
    function setLayerSync(fn) { layerSync = fn; }

    function fetchJson(path, init) {
      return fetch(API + path, { headers: { 'content-type': 'application/json' }, ...init }).then((r) => r.json());
    }
    let seq = 0;
    function applyResponse(d) {
      if (d && d.ok && d.settings) {
        settings = sanitize(d.settings, settings);
        if (d.available && typeof d.available === 'object') {
          availability = {
            user: typeof d.available.user === 'boolean' ? d.available.user : availability.user,
            ai: typeof d.available.ai === 'boolean' ? d.available.ai : availability.ai,
          };
        }
        notify();
      }
    }
    function loadSettings() {
      const mine = ++seq;
      fetchJson('/settings').then((d) => { if (mine === seq) applyResponse(d); }).catch(() => {});
    }
    function saveSettings(patch) {
      const mine = ++seq;
      settings = sanitize(patch, settings);
      notify();
      fetchJson('/settings', { method: 'POST', body: JSON.stringify(patch) })
        .then((d) => { if (mine === seq) applyResponse(d); }).catch(() => {});
    }

    // ── DOM 装饰层（移植自壁纸引擎 avatar-layer.js）──────────────────────────
    let observer = null;
    let timer = null;
    let active = false;
    const DEBOUNCE_MS = 120;

    const STICK_TOP = 8;
    let stickFrame = 0;
    let stickListening = false;

    function body() {
      return typeof document !== 'undefined' && document && document.body ? document.body : null;
    }

    /** 头像图片 URL：带上"有没有设置过"的判据（没设置就画内置默认头像）。 */
    function avatarUrl(side) {
      if (!hasAvatar(side)) return '';
      return `${API}/avatar/${side}`;
    }

    function glyphSvgString(side) {
      const parts = GLYPH_PARTS[side] || GLYPH_PARTS.user;
      const inner = parts.map(([tag, a]) =>
        '<' + tag + ' ' + Object.keys(a).map((k) => k + '="' + a[k] + '"').join(' ') + '/>').join('');
      return '<svg viewBox="' + GLYPH_VIEW_BOX + '" width="16" height="16" fill="none" stroke="currentColor"'
        + ' stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
    }

    /** 就地更新头像节点内容（图 or 内置头像）。 */
    function fillNode(node, side) {
      const url = avatarUrl(side);
      const want = url ? 'img' : 'glyph';
      if (node.getAttribute('data-cav-kind') === want) {
        if (want === 'img') {
          const img = node.firstElementChild;
          if (img && img.getAttribute('src') !== url) img.setAttribute('src', url);
        }
        return;
      }
      node.setAttribute('data-cav-kind', want);
      try { node.textContent = ''; } catch { /* ignore */ }
      if (want === 'img') {
        const img = document.createElement('img');
        img.className = AVATAR_NODE_CLASS + '__img';
        img.setAttribute('alt', '');
        img.setAttribute('draggable', 'false');
        img.setAttribute('src', url);
        node.appendChild(img);
      } else {
        const span = document.createElement('span');
        span.className = AVATAR_NODE_CLASS + '__glyph';
        span.innerHTML = glyphSvgString(side);
        node.appendChild(span);
      }
    }

    /**
     * 判断一行是不是「过程行」（思考区）。
     * 宿主把同一条 assistant-step 拆成两行，靠 data-chat-group-part 区分：
     *   data-chat-group-part="reasoning" → 思考
     *   data-chat-group-part="response"  → 主要回复
     *
     * ⚠️ 硬规矩：本插件**绝不能装饰 reasoning 行**（不插头像、不把它改成 flex）。
     *    证据（不是猜的）：工具调用行是 data-chat-flow-kind="turn-process"，
     *    它**不在** AVATAR_FLOW_SIDES 里 ⇒ 插件从来不碰它 ⇒ 工具调用照常显示；
     *    而思考行是 assistant-step + reasoning ⇒ 插件会去装饰它 ⇒ 思考内容整块消失。
     *    「工具调用正常、思考消失」这个对照，把问题精确定位在"插件动了思考行"上。
     *    思考行那块内容由宿主自己的 ReasoningRow 控制（折叠时 contain:size layout
     *    + 固定 24px 高），行一旦被改成别的排版上下文就会算不出高度 ⇒ 直接不显示。
     */
    function isProcessRow(row) {
      if (!row || typeof row.getAttribute !== 'function') return false;
      return (row.getAttribute('data-chat-group-part') ?? '') === 'reasoning';
    }

    /** 摘掉一行上的插件痕迹（头像节点 + 行标记），把该行完整交还给宿主原生渲染。 */
    function stripRow(row) {
      if (!row || typeof row.getAttribute !== 'function') return false;
      if (!row.hasAttribute(AVATAR_ROW_ATTR)) return false;
      const old = row.firstElementChild;
      if (old && old.classList && old.classList.contains(AVATAR_NODE_CLASS)) {
        try { old.remove(); } catch { /* ignore */ }
      }
      row.removeAttribute(AVATAR_ROW_ATTR);
      return true;
    }

    /** 给一条消息行补头像（已补过则只就地更新）。 */
    function decorateRow(row) {
      if (!row || typeof row.getAttribute !== 'function') return;
      // ⚠️ 思考行：不装饰；若以前装饰过（改设置/热重载残留）就先摘干净。
      if (isProcessRow(row)) { stripRow(row); return; }
      const side = AVATAR_FLOW_SIDES[row.getAttribute('data-chat-flow-kind')];
      if (!side) return;
      const marked = row.getAttribute(AVATAR_ROW_ATTR);
      if (marked === side) {
        const node = row.firstElementChild;
        if (node && node.classList && node.classList.contains(AVATAR_NODE_CLASS)) {
          fillNode(node, side);
          return;
        }
        row.removeAttribute(AVATAR_ROW_ATTR);
      } else if (marked) {
        const old = row.firstElementChild;
        if (old && old.classList && old.classList.contains(AVATAR_NODE_CLASS)) {
          try { old.remove(); } catch { /* ignore */ }
        }
        row.removeAttribute(AVATAR_ROW_ATTR);
      }
      const node = document.createElement('div');
      node.className = AVATAR_NODE_CLASS + ' ' + AVATAR_NODE_CLASS + '--' + side;
      node.setAttribute(AVATAR_NODE_ATTR, side);
      node.setAttribute('aria-hidden', 'true');
      fillNode(node, side);
      row.setAttribute(AVATAR_ROW_ATTR, side);
      try { row.insertBefore(node, row.firstChild); } catch { /* ignore */ }
    }

    function sweep() {
      if (typeof document.querySelectorAll !== 'function') return;
      let rows = [];
      try { rows = document.querySelectorAll(AVATAR_ROW_SELECTOR); } catch { return; }
      for (const row of rows) decorateRow(row);
    }

    /** 观察者回调：新增行直接补；其余新增元素若在已装饰行内就早退（避免流式输出时逐帧扫子树）。 */
    function onMutations(records) {
      if (!active) return;
      for (const r of records) {
        const added = r.addedNodes;
        if (!added || !added.length) continue;
        for (const n of added) {
          if (!n || n.nodeType !== 1) continue;
          try {
            if (n.matches && n.matches(AVATAR_ROW_SELECTOR)) { decorateRow(n); continue; }
            if (n.closest && n.closest('[' + AVATAR_ROW_ATTR + ']')) continue;
          } catch { continue; }
          let inner = [];
          try { inner = n.querySelectorAll ? n.querySelectorAll(AVATAR_ROW_SELECTOR) : []; } catch { inner = []; }
          for (const row of inner) decorateRow(row);
        }
      }
    }

    /** 找到行所在的滚动容器（向上第一个真正可纵向滚动的祖先）。 */
    function findScroller(el) {
      let node = el?.parentElement ?? null;
      while (node && node !== document.body) {
        const oy = getComputedStyle(node).overflowY;
        if ((oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight + 1) return node;
        node = node.parentElement;
      }
      return null;
    }

    /** 头像跟随滚动：重算每个头像相对行的 top。 */
    function updateSticky() {
      /*
       * 关掉「跟随滚动」时什么都不算：头像固定在行首，位置完全由 flex 布局决定。
       * 必须先复位 —— 开关从「开」切到「关」时，上一次循环可能已经往
       * style.top 写过一个大值，不复位的话头像会停在半空。
       */
      if (!stickFollowOf()) { resetSticky(); return; }
      const wraps = document.querySelectorAll('[' + AVATAR_NODE_ATTR + ']');
      for (const wrap of wraps) {
        const row = wrap.parentElement;
        if (!row) continue;
        const scroller = findScroller(row);
        if (!scroller) {
          if (wrap.style.top !== '0px') wrap.style.top = '0px';
          continue;
        }
        const rowRect = row.getBoundingClientRect();
        const scRect = scroller.getBoundingClientRect();
        const rowTopInView = rowRect.top - scRect.top;
        const maxTop = Math.max(0, row.offsetHeight - wrap.offsetHeight);
        // 吸顶位置 = 8px 留白 + N 个头像身位（默认 2，避开主题云母状态栏）
        const stickTop = STICK_TOP + wrap.offsetHeight * stickOffsetOf();
        let top = 0;
        if (rowTopInView < stickTop) top = Math.min(stickTop - rowTopInView, maxTop);
        top = Math.max(0, Math.min(top, maxTop));
        const next = Math.round(top) + 'px';
        if (wrap.style.top !== next) wrap.style.top = next;
      }
    }

    /** 把所有头像的跟随偏移清零（= 固定在行首）。关闭跟随时用，幂等。 */
    function resetSticky() {
      const wraps = document.querySelectorAll('[' + AVATAR_NODE_ATTR + ']');
      for (const wrap of wraps) {
        if (wrap.style.top !== '0px') wrap.style.top = '0px';
      }
    }

    function scheduleSticky() {
      if (!active || stickFrame !== 0) return;
      /*
       * 关闭跟随时连 rAF 都不排：滚动时整个重算被跳过，
       * 既不浪费每帧的 querySelectorAll，也不会和复位逻辑打架。
       */
      if (!stickFollowOf()) { resetSticky(); return; }
      stickFrame = requestAnimationFrame(() => { stickFrame = 0; updateSticky(); });
    }
    const onScrollOrResize = () => scheduleSticky();

    /** AI 气泡框：只给「每轮最后一条有正文的 assistant-step」套框（= 最终回复）。
        ⚠️ 分组必须扫**全量**消息行（含 user/steering）才能切开轮次 —— 只查 assistant-step 的话
        永远遇不到 user 行，所有轮次会被并成一批，结果只有整段对话的最后一条有框。 */
    const BUBBLE_CLASS = 'cav-bubbled';
    function syncBubbles() {
      const on = aiBubbleOn();
      let rows = [];
      try { rows = document.querySelectorAll(AVATAR_ROW_SELECTOR); } catch { return; }
      let steps = [];
      const flush = () => {
        if (steps.length === 0) return;
        for (const r of steps) {
          if (on && r === finalOf(steps)) r.classList.add(BUBBLE_CLASS);
          else r.classList.remove(BUBBLE_CLASS);
        }
        steps = [];
      };
      for (const row of rows) {
        const kind = row.getAttribute('data-chat-flow-kind') ?? '';
        if (kind === 'user' || kind === 'steering') { flush(); continue; }
        steps.push(row);
      }
      flush();
      if (!on) {
        document.querySelectorAll('.' + BUBBLE_CLASS).forEach((el) => el.classList.remove(BUBBLE_CLASS));
      }
    }
    /**
     * 本轮最终回复：最后一条「有正文」的 assistant-step。
     * ⚠️ 这里必须用 textContent 而不是 innerText：innerText 是「渲染后可见的文字」，
     * 一旦某行被折叠 / 被压成 0 高度（思考行就是这种情况），innerText 会变成空串，
     * 于是思考行会被误判成「没有正文」而参与/干扰最终回复的选取，气泡框就可能套错行。
     * textContent 只看 DOM 里有没有文字，不受样式与折叠影响。
     * 判定前先排除「过程行」：宿主用 data-chat-group-part="reasoning" 标记思考/工具区，
     * 它即使有文字也不是主要回复。
     */
    function finalOf(steps) {
      const withText = steps.filter((r) => !isProcessRow(r) && (r.textContent ?? '').trim() !== '');
      const answerRows = withText.length > 0 ? withText : steps.filter((r) => !isProcessRow(r));
      return answerRows.length > 0 ? answerRows[answerRows.length - 1] : steps[steps.length - 1];
    }

    function scheduleProcess() {
      if (!active || timer !== null) return;
      timer = window.setTimeout(() => {
        timer = null;
        sweep();
        syncBubbles();
        scheduleSticky();
      }, DEBOUNCE_MS);
    }

    function startLayer() {
      if (active) return;
      active = true;
      observer = new MutationObserver(() => scheduleProcess());
      observer.observe(document.body, { childList: true, subtree: true });
      if (!stickListening) {
        stickListening = true;
        window.addEventListener('scroll', onScrollOrResize, { capture: true, passive: true });
        window.addEventListener('resize', onScrollOrResize, { passive: true });
      }
      scheduleProcess();
    }

    function stopLayer() {
      if (!active) return;
      active = false;
      observer?.disconnect();
      observer = null;
      if (stickListening) {
        stickListening = false;
        window.removeEventListener('scroll', onScrollOrResize, { capture: true });
        window.removeEventListener('resize', onScrollOrResize);
      }
      if (stickFrame !== 0) { cancelAnimationFrame(stickFrame); stickFrame = 0; }
      if (timer !== null) { window.clearTimeout(timer); timer = null; }
      // 关掉 = 逐字节回到原生：摘掉所有注入节点、标记、body 开关与变量
      document.querySelectorAll('[' + AVATAR_NODE_ATTR + ']').forEach((n) => { try { n.remove(); } catch { /* ignore */ } });
      document.querySelectorAll('[' + AVATAR_ROW_ATTR + ']').forEach((r) => r.removeAttribute(AVATAR_ROW_ATTR));
      document.querySelectorAll('.' + BUBBLE_CLASS).forEach((el) => el.classList.remove(BUBBLE_CLASS));
      const b = body();
      if (b) {
        b.removeAttribute(AVATAR_ATTR);
        b.style.removeProperty(VAR_SIZE);
        b.style.removeProperty(VAR_ROUND);
        // [本地补丁] 气泡外观变量也要撤掉，否则关掉插件后残留自定义色
        b.style.removeProperty('--cav-bubble-radius');
        b.style.removeProperty('--cav-bubble-base');
        b.style.removeProperty('--cav-bubble-border');
        b.style.removeProperty('--cav-bubble-alpha');
        b.style.removeProperty('--cav-bubble-blur');
        b.style.removeProperty('--cav-text-color');
        b.style.removeProperty('--cav-user-text-color');
      }
    }

    // ── [本地补丁 · 字体] 注入 ──────────────────────────────────────────────
    /**
     * 字体功能的实现（精简自 dsh-fonttune，只保留「够用」的部分）。
     *
     * 为什么不用它那套：它用 573KB 逐个改写 DSH 的 font 简写令牌链
     * （--dsw-font-base-16 这种每个字号一个令牌，还有 40+ 个派生令牌），
     * 为的是让字重轴、行高、字体三轴全联动。我们只要四件事：
     *   换字体 / 正文字号 / 标题字号 / 行距与加粗
     * 所以走一条短得多的路：**只改最上游的两个变量 + 少量直接覆盖**。
     *
     * DSH 的字号体系（查 app.asar 得到）：
     *   正文  --dsw-font-markdown-base  = var(--dsh-content-font-size,14px) / calc(24px + delta)
     *   标题  --dsw-font-markdown-h1..h3 = calc(N px + var(--dsh-content-font-delta))
     *   所以：
     *     · 正文字号 → 改 --dsh-content-font-size（其余派生自动跟）
     *     · 标题字号 → 改 --dsh-content-font-delta（标题加在 delta 上的）
     *   两者天然分离，正好对上「标题和正文分开调」的要求。
     *
     * ⚠️ 必须 !important：主题把 --dsh-content-font-size **内联写在 body 上**，
     *    内联声明优先级高于普通样式表规则，不加 !important 会改不动。
     */
    const FONT_STYLE_ID = 'cav-font-style';

    /** 把用户设置拼成一段 CSS。没有任何设置时返回空串（等于不改）。 */
    function buildFontCss(s) {
      const decls = [];
      const body = 'body';
      const root = ':root,body';

      // ① 界面字体：同时写 DSH 的字体变量和 body 的 font-family
      const family = fontStackOf(s.fontFamily);
      if (family) {
        decls.push(root + '{--dsw-font-family:' + family + ' !important}');
        decls.push(body + '{font-family:' + family + ' !important}');
      }

      // ② 代码字体：DSH 代码令牌链到 --ds-font-family-code
      const mono = fontStackOf(s.fontMono);
      if (mono) {
        decls.push(root + '{--dsw-font-mono:' + mono + ' !important;'
          + '--ds-font-family-code:' + mono + ' !important}');
        // 代码元素本身也要盖一次：它的 font 简写里已经写死了 family
        decls.push('pre,code,kbd,samp{font-family:' + mono + ' !important}');
      }

      // ③ 正文字号：只动最上游那个变量，派生令牌自动跟随
      const sizeDelta = clamp(s.fontSizeDelta, -4, 8, 0);
      if (sizeDelta !== 0) {
        decls.push(root + '{--dsh-content-font-size:calc(14px + ' + (sizeDelta > 0 ? '+' : '')
          + sizeDelta + 'px) !important}');
      }

      // ④ 标题字号：改 delta（标题字号 = 固定 px + delta），与正文互不影响
      const headDelta = clamp(s.headingSizeDelta, -6, 12, 0);
      if (headDelta !== 0) {
        decls.push(root + '{--dsh-content-font-delta:' + (headDelta > 0 ? '+' : '')
          + headDelta + 'px !important}');
      }

      // ⑤ 行距：delta 只作用于标题，正文行高要单独给
      const lineDelta = clamp(s.lineHeightDelta, -20, 60, 0);
      if (lineDelta !== 0) {
        const extra = Math.round(24 * lineDelta / 100);
        decls.push(root + '{--dsh-content-font-delta-secondary:' + (extra > 0 ? '+' : '')
          + extra + 'px !important}');
        decls.push('[class*="_markdown_" i]{line-height:calc(24px + ' + (extra > 0 ? '+' : '')
          + extra + 'px) !important}');
      }

      // ⑥ 正文加粗。0 = 不动（沿用主题自己的 400/600 规则）
      const weight = clamp(s.fontWeight, 0, 700, 0);
      if (weight > 0) {
        /*
         * ⚠️ 只给「段落级」元素加粗，不要用通配符 ——
         * 通配会把 h1..h6、strong 的既定字重也压平，标题就没了层次。
         */
        decls.push('[class*="_markdown_" i] :where(p,li,td,th,blockquote)'
          + '{font-weight:' + weight + ' !important}');
      }

      /*
       * ⑦⑧ 字体覆盖层（2026-10-25 加）：正文 / 标题各一套。
       *
       * 设计意图：界面字体（①）是「打底」，覆盖层是「局部改」。
       *   · 都不填 → 一切跟随界面字体
       *   · 只填正文 → 正文换字体，标题仍是界面字体
       *   · 只填标题 → 标题换字体，正文仍是界面字体
       *   · 两个都填 → 各自独立
       *
       * ⚠️ 选择器要点：
       *   正文 = 所有「非标题」的文字。不能写 `[class*="_markdown_"] p` 就算完，
       *          因为列表项、表格单元、引用块都不在 p 里，会漏掉。
       *          这里用「容器设字体 + 标题再覆盖」两步走：
       *            先把整个 markdown 容器的 family 设成正文体，
       *            再把 h1..h6 单独设成标题体。
       *          这样任何层级都继承到正文体，只有标题被特殊化 —— 不需要穷举标签。
       *   标题 = h1..h6。DSH 用 `:where(h5,h6)` 也会命中，所以六个都列上。
       *
       * 这两个覆盖层用独立的规则、不加 !important 到父容器上，
       * 避免和界面字体那条 `body{font-family:...!important}` 打架：
       * 子元素自己的声明本来就优先于 body 的继承值，不加 flag 也能赢。
       */
      const bodyFamily = fontStackOf(s.bodyFont);
      /*
       * 标题字体：不提供开关（理由见面板那段注释 —— 侧边栏标题与 markdown 标题
       * 都取 --dsw-font-family，和「界面字体」是同一个来源）。
       * 但若配置里残留了 headingFont（老版本写的），仍然尊重它：
       * 有值就覆盖标题，没有就自然继承界面字体。
       */
      const headingFamily = fontStackOf(s.headingFont);

      // 正文体：给 markdown 容器设，标题稍后单独覆盖
      if (bodyFamily) {
        decls.push('[class*="_markdown_" i]{font-family:' + bodyFamily + ' !important}');
        // 用户消息用的是另一套渲染，也要覆盖（它不叫 _markdown_）
        decls.push('[data-cav-row] [class*="bubble" i]{font-family:' + bodyFamily + ' !important}');
      }

      // 标题体：优先级最高，排在正文体之后
      if (headingFamily) {
        decls.push('[class*="_markdown_" i] :where(h1,h2,h3,h4,h5,h6)'
          + '{font-family:' + headingFamily + ' !important}');
      }

      return decls.join('\n');
    }

    /**
     * 把字体样式写进 / 更新 / 移除。
     *
     * 用单独一个 <style> 节点而不是塞进 STYLES：
     * 设置一变只要替换这一个节点的内容，不用重建整套插件样式。
     */
    function syncFontStyle() {
      const s = getSettings();
      const css = buildFontCss(s);
      let node = document.getElementById(FONT_STYLE_ID);
      if (css === '') {
        if (node) node.remove();
        return;
      }
      if (!node) {
        node = document.createElement('style');
        node.id = FONT_STYLE_ID;
        node.dataset.plugin = 'dsh-conversation-avatar';
        document.head.appendChild(node);
      }
      if (node.textContent !== css) node.textContent = css;
    }

    /** 关掉插件时清掉字体样式，逐字节回到原生外观。 */
    function clearFontStyle() {
      const node = document.getElementById(FONT_STYLE_ID);
      if (node) node.remove();
    }

    // ── 样式 ────────────────────────────────────────────────────────────────
    const STYLES = `
/* 会话里的头像：行改成横向 flex，头像与消息并排；用户行反过来 ⇒ 你的消息在右、助手在左 */
body[${AVATAR_ATTR}="on"] [${AVATAR_ROW_ATTR}] { display: flex; align-items: flex-start; gap: 8px; }
body[${AVATAR_ATTR}="on"] [${AVATAR_ROW_ATTR}="user"] { flex-direction: row-reverse; }
/* ⚠️ 只把「非头像的直接子元素」设成可压缩。别扩大这条规则的作用范围。
   历史教训：曾经想用 CSS 单独照顾思考行，但正确解法是**根本不装饰思考行**
   （见 decorateRow 里的 isProcessRow/stripRow），思考行不会带 data-cav-row 标记，
   因此下面这条永远只作用在真正被装饰的行上。保留此注释以免以后又去猜 CSS。 */
body[${AVATAR_ATTR}="on"] [${AVATAR_ROW_ATTR}] > :not(.${AVATAR_NODE_CLASS}) { flex: 1 1 auto; min-width: 0; }
.${AVATAR_NODE_CLASS} {
  box-sizing: border-box; flex: 0 0 auto; display: flex; align-items: center; justify-content: center;
  width: var(${VAR_SIZE}, 40px); height: var(${VAR_SIZE}, 40px);
  border-radius: calc(var(${VAR_ROUND}, 100) * 0.5%);
  overflow: hidden; position: relative;
  color: var(--dsw-alias-label-secondary, currentColor);
  background: var(--dsw-alias-bg-layer-1, rgba(128,128,128,.16));
  border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.28));
}
/* 跟随滚动：top 由 JS 写入（行顶滚出可视区就贴顶跟随，行快滚完则停行尾） */
body[${AVATAR_ATTR}="on"] [${AVATAR_ROW_ATTR}] > .${AVATAR_NODE_CLASS} { align-self: flex-start; }
.${AVATAR_NODE_CLASS}__img { display: block; width: 100%; height: 100%; object-fit: cover; }
.${AVATAR_NODE_CLASS}__glyph { display: flex; align-items: center; justify-content: center; }
.${AVATAR_NODE_CLASS}__glyph svg { width: 62%; height: 62%; }

/* AI 回复气泡框：只给最终回复套（.cav-bubbled 由 JS 打在行上）
   ── [本地补丁 · 透明度 / 磨砂] ─────────────────────────────────────────────
   主题令牌都是**实色**（没有半透明背景令牌），直接盖在壁纸上会很重、也不搭。
   底色统一走 color-mix()：把「底色 × alpha」混出来 —— 跟随主题或自定义色都按同一 alpha 混。
   · --cav-bubble-base  底色（不透明），默认主题 layer-1
   · --cav-bubble-alpha 不透明度 0–100，默认 100
   · --cav-bubble-blur  磨砂半径 0–30px，默认 10（0 = 关掉磨砂）

   ⚠️ 层叠顺序是这个组件的命门，2026-10-24 修过一次「调高不透明度后文字消失」：
      旧写法是「伪元素 z-index:0 + 把直接子元素逐个抬到 z-index:1」。
      但「> *」只保护**直接子元素**，气泡里更深层的文字仍停在 z-index:auto，
      于是被 z-index:0 的底色层整片盖住 —— 不透明度越高盖得越死。
      现在的写法不依赖「内容一定是直接子元素」：
        ① 行自建层叠上下文（isolation）—— 把 -1 关在气泡内部，不会漏到外层；
        ② 底色层用 z-index:-1 —— 压在**所有后代**之下，无论嵌套多深。
      这样文字永远不会被底色或磨砂吃掉，不管宿主把内容包成几层。

   ⚠️ 磨砂（backdrop-filter）只加在**伪元素**上，绝不加在 .cav-bubbled 本身：
      加在元素上会让它成为包含块并改变定位上下文（历史上因此整段会话不渲染）。
      伪元素是绝对定位且没有子节点，放它身上没有这个副作用。

   ── [本地补丁 · 宽度跟随内容] 2026-10-25 ──────────────────────────────────
   问题：输出一个很宽的表格时，内容会跑到气泡框外面。
   原因不在气泡，而在宿主：宽表格被包上 .md-table-wide，那条规则是**故意**
   让它横向撑出正文区（width: calc(100% + lead + spare)、margin-left 取负），
   靠 100cqw 容器宽度算出「比正文更宽」。气泡框是行内的 flex 子项，
   宽度由行决定，于是表格比气泡宽 ⇒ 视觉上「文字在框外」。
   
   处理办法分两层：
     ① 把 md-table-wide 在气泡内改回「不溢出」：宽度回到 100%，
        横向溢出改成「表格自己滚动」（overflow-x:auto），气泡仍然包住它。
        这样表格依旧能看全，只是要在表格区域内横向滚，而不是冲出气泡。
     ② 气泡本体宽度跟随内容：给行内容区 max-width:100%，避免被撑破。 */
.${BUBBLE_CLASS} {
  position: relative;
  /* 自建层叠上下文：让下面那个 z-index:-1 只在本气泡内部生效，不漏到外层 */
  isolation: isolate;
  border: 1px solid var(--cav-bubble-border, var(--dsw-alias-border-l1, rgba(128,128,128,.28)));
  border-radius: var(--cav-bubble-radius, var(--dsw-radius-lg, 14px));
  padding: var(--cav-bubble-pad, 10px 16px);
}
/* 宽表格回到气泡内：不再向外撑，改为表格区域自己横向滚动。
   ⚠️ 只动「向外撑」那三个属性，不要给 .cav-bubbled 本身上加
      max-width / min-width / overflow —— 2026-10-25 踩过：
      那几行会参与行 flex 的宽度计算，把同一行里的**头像**一起改坏
      （表现为头像突然变得很大）。气泡宽度本来就由行决定，不需要额外约束。 */
.${BUBBLE_CLASS} :where(.md-table-wide) {
  width: 100% !important;
  max-width: 100% !important;
  margin-left: 0 !important;
  padding-left: 0 !important;
  overflow-x: auto !important;
}
/* ── 通用兜底：任何可能比气泡宽的东西，都在自己内部滚，不许溢出 ─────────────
   2026-10-25 第二次修。上一次只盯住「表格」，但撑破气泡的不止表格：
     · 很长的代码块（white-space:pre，一行几十个 token 不换行）
     · 长 URL / 长路径（不可断词的连续字符）
     · 数学公式（katex-display 居中块）
     · 宽图片 / 视频
   它们的共同点是「内部允许横向滚动，但自身宽度不该超过容器」。
   与其逐个猜宿主给它们起了什么类名，不如让**所有直接子元素**都满足。

   ⚠️ 只写 max-width:100% 是不够的（第一版就栽在这）：
      宿主给表格设的是 width:max-content 与 max-width:max-content，
      两者都带 !important 级的语义，光盖 max-width 压不住 width。
      必须**同时**把 width 拉回来，并且配 min-width:0 ——
      否则弹性/网格布局里「最小内容宽度」还会把盒子顶大。
   ⚠️ 仍然不给 .cav-bubbled 本身上加约束（会连累同一行的头像）。 */
.${BUBBLE_CLASS} > * {
  max-width: 100% !important;
  min-width: 0 !important;
}
/* 会自己横向滚的块：限宽 + 溢出自己滚。这里 width:100% 是相对气泡内容区，
   不会溢出，也不影响同一行的头像（作用域限定在气泡内部）。 */
.${BUBBLE_CLASS} :where(
  pre,
  table,
  .katex-display,
  [class*="tableScroll" i],
  [class*="codeBlock" i],
  [class*="code-block" i]
) {
  max-width: 100% !important;
  min-width: 0 !important;
  overflow-x: auto !important;
}
/* 媒体类：只限宽，不强制滚动（图片该等比缩小而不是滚）。 */
.${BUBBLE_CLASS} :where(img, video, iframe, canvas, svg) {
  max-width: 100% !important;
  height: auto !important;
}
/* 表格本体：宿主的 table 是 width:max-content，必须显式压回 100%。 */
.${BUBBLE_CLASS} :where(table) {
  width: 100% !important;
}
/* 长单词/长 URL 强制断行。只在「实在放不下」时才断，不会把正常中文切碎。 */
.${BUBBLE_CLASS} {
  overflow-wrap: anywhere;
}
/* 底色 + 磨砂都挂在伪元素上。伪元素不是包含块，不会破坏行的 flex 布局。 */
.${BUBBLE_CLASS}::before {
  content: ""; position: absolute; inset: 0; border-radius: inherit;
  pointer-events: none;
  /* -1 而不是 0：压到所有后代之下，不再依赖「内容是不是直接子元素」 */
  z-index: -1;
  background: var(--cav-bubble-base, var(--dsw-alias-bg-layer-1, rgba(128,128,128,.10)));
  /* 磨砂：模糊的是气泡背后的壁纸/主题，不是内容；0px 时浏览器不产生开销 */
  -webkit-backdrop-filter: blur(var(--cav-bubble-blur, 10px)) saturate(1.35);
  backdrop-filter: blur(var(--cav-bubble-blur, 10px)) saturate(1.35);
}
@supports (background: color-mix(in srgb, red 50%, transparent)) {
  .${BUBBLE_CLASS}::before {
    background: color-mix(in srgb,
      var(--cav-bubble-base, var(--dsw-alias-bg-layer-1, rgba(128,128,128,.10))) calc(var(--cav-bubble-alpha, 100) * 1%),
      transparent);
  }
}
/* 兜底：气泡不再抬高任何子元素。
   旧规则 .cav-bubbled > * { z-index: 1 } 已删除 —— 它只覆盖直接子元素，
   对更深层的文字无效，正是文字被盖住的原因。现在靠 isolation + z-index:-1 解决。

   另加一条「高不透明度可读性」保护：不透明度拉到很高时，底色会和文字色贴近，
   于是字虽然「在上面」却看不出轮廓。这里给气泡补一圈极淡的内描边，
   把气泡区域和文字在视觉上隔开 —— 它画在 z-index:-1 层，绝不压在文字上。
   不透明度越低，这条越淡；60% 以下完全不出现。 */
.${BUBBLE_CLASS}::after {
  content: ""; position: absolute; inset: 0; border-radius: inherit;
  pointer-events: none;
  z-index: -1;
  box-shadow: inset 0 0 0 1px color-mix(in srgb,
    var(--cav-bubble-border, var(--dsw-alias-border-l1, rgba(128,128,128,.28))) 70%,
    transparent);
}

/* ── [本地补丁 · 正文字色] ──────────────────────────────────────────────────
   只改 AI 回复的**正文文字**颜色，代码与思考内容一律不动。

   实现思路（为什么不直接给元素上 color）：
   宿主把正文颜色写成 color: var(--dsw-alias-label-primary)。所以这里
   **在正文容器上重定义这个变量**，正文里所有继承颜色的文字（段落、标题、
   列表、粗体、斜体）自然全部跟随，不用逐个元素点名。
   这比「* { color }」安全得多 —— 后者会连图标、边框、按钮一起改。

   生效条件：JS 把颜色写进 --cav-text-color，只有它存在时下面才覆盖。
   清空设置 = 移除变量 = 完全回到主题原样（用 initial 复位而不是删规则）。

   三条「不管」的边界，每条都有理由：

     ① 代码：pre / code / kbd / samp。
        宿主 shiki 语法高亮给每个 token 自带颜色，但代码块的**默认前景与底色**
        若被继承色污染，在深色代码块上会出现看不清的暗字。
        所以显式把它们的颜色复原成宿主令牌，不参与变字色。

     ② 思考区：[data-chat-group-part="reasoning"] 整棵子树排除。
        判定依据与 isProcessRow() 一致（宿主就是这么标的），两处不能各写各的。

     ③ 工具调用：[data-chat-flow-kind="turn-process"]、工具卡片
        （[data-chat-call-id]）一律排除。

   还**不碰**行内彩色语义元素（徽章、标签、diff 增删行）—— 它们各有状态色
   令牌，改字色会让「红=错误、绿=成功」这类约定失效。

   写法说明：这里**只覆盖 color 这一个属性**，不改任何主题令牌
   （--dsw-alias-label-primary 原样不动）。父级 color 一变，正文里所有
   「没有自己 color 声明」的文字（段落/标题/列表/粗体）自动继承，这正是想要的；
   而 shiki 给代码 token 写的是自带颜色，不受父级影响。
   代码、思考区、工具调用则显式复原成宿主令牌 ⇒ 回到主题原样。
   清空设置 = 移除 --cav-text-color 变量 = 下面整条规则不产生作用。

   ⚠️ 只作用于 AI 侧的行（[data-cav-row="ai"]），用户自己的消息不动 ——
   这是需求原话「只改 AI 回复的字色」。data-cav-row 的取值由 decorateRow 写入，
   和 AVATAR_FLOW_SIDES 一致，不另起一套判定。

   ⚠️⚠️ 2026-10-25 修的第二个坑：只写在「直接子元素」上【不管用】。
   宿主的正文组件 AssistantMarkdown 自己在根容器上写死了
     .v5IAXa_root { color: var(--dsw-alias-label-primary) }
   —— 这是一个「显式声明」，会**截断继承**。所以设在外层父元素上的 color
   传不进去，界面上文字一动不动。
   正确做法：把用户色下发到**整棵子树**，而不是只给最外层。

   但通配符会连代码块里的语法高亮 token 一起改（shiki 给每个 token 上色），
   所以用 :not() 在**源头**就把不该碰的排除掉，而不是改完再复原。
   排除清单与下方说明一一对应：
     · pre / code / kbd / samp 及其所有后代（语法高亮）
     · 思考区、工具调用的整棵子树
     · ⚠️ 头像自身及其后代（.cav-avatar / .cav-avatar *）——
       2026-10-25 踩过：头像 SVG 用 stroke="currentColor"，被这条 color 规则
       命中后图标被染色，连带影响头像的视觉尺寸/观感（表现为「头像变得很大」）。
       头像的外观只该由 --cav-size / --cav-round 控制，不该受字色影响。 */
body[${AVATAR_ATTR}="on"] [${AVATAR_ROW_ATTR}="ai"] *:not(
  pre, pre *,
  code, code *,
  kbd, samp,
  [data-chat-group-part="reasoning"], [data-chat-group-part="reasoning"] *,
  [data-chat-flow-kind="turn-process"], [data-chat-flow-kind="turn-process"] *,
  [data-chat-call-id], [data-chat-call-id] *,
  .${AVATAR_NODE_CLASS}, .${AVATAR_NODE_CLASS} *
) {
  color: var(--cav-text-color, inherit);
}
/* 行本身也覆盖一次：让「没有自己 color 声明」的节点跟随（含没有元素包裹的裸文本）。
   注意这里只设 color —— 绝不能顺手加 width/display 之类，否则会碰坏行的 flex 布局。 */
body[${AVATAR_ATTR}="on"] [${AVATAR_ROW_ATTR}="ai"] {
  color: var(--cav-text-color, inherit);
}
/* ⚠️ 这里【故意不写】头像的 width/height。
   头像尺寸的唯一真相是上面 .cav-avatar 那条规则里的 var(--cav-size)。
   2026-10-25 事故的教训：我在这个位置补了一条「兜底尺寸」，
   结果是同属性出现两处声明、又和气泡的 max-width 搅在一起，
   头像被撑成一大块。**一个属性只能有一个声明来源**，需要加固就改原规则。 */
/* 注意：这里【不需要】再写一条「把代码/思考区复原」的规则。
   2026-10-25 的写法是在源头用 :not() 排除，被排除的节点压根没被碰过，
   它们的颜色仍是宿主自己的值。此前那两条「事后复原」规则会造成
   同特异性冲突（谁在后面谁赢），反而让行为不确定，故删除。 */

/* ── [本地补丁 · 用户消息字色] ──────────────────────────────────────────────
   和 AI 侧同一套做法，只是换成 [data-cav-row="user"]（含 steering，都是你发的）。

   宿主的用户气泡是 .cJsG2q_bubble，同样写死了
     color: var(--dsw-alias-label-primary)
   所以一样要把颜色下发到整棵子树，否则文字不跟随。

   用户消息用的是另一套渲染（conversation.user.text，不是 markdown），
   但排除清单照样保留：用户消息里也可能出现行内代码、附件、引用块，
   这些都有各自的颜色语义，不该被字色覆盖。
   最关键的是**头像必须排除** —— 2026-10-25 就是因为漏了这个把头像染色了。 */
body[${AVATAR_ATTR}="on"] [${AVATAR_ROW_ATTR}="user"] *:not(
  pre, pre *,
  code, code *,
  kbd, samp,
  .${AVATAR_NODE_CLASS}, .${AVATAR_NODE_CLASS} *
) {
  color: var(--cav-user-text-color, inherit);
}
/* 行本身也覆盖一次（裸文本用）。
   ⚠️ 只设 color：不要在这里加 width/display/flex，会把同一行的头像碰坏。 */
body[${AVATAR_ATTR}="on"] [${AVATAR_ROW_ATTR}="user"] {
  color: var(--cav-user-text-color, inherit);
}
.cav-card{border:1px solid var(--dsw-alias-border-l1,#555);border-radius:10px;padding:12px 14px;
  background:var(--dsw-alias-bg-layer-1,rgba(255,255,255,.02))}
.cav-card-head{display:flex;align-items:center;gap:10px;margin-bottom:10px}
.cav-card-title{font-weight:600}
.cav-card-hint{color:var(--dsw-alias-label-secondary,#999);font-size:12px;margin-top:2px}
.cav-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0;
  border-top:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.25))}
.cav-row:first-of-type{border-top:none}
.cav-label{color:var(--dsw-alias-label-primary,#ddd)}
.cav-hint{color:var(--dsw-alias-label-secondary,#999);font-size:12px;margin-top:2px}
.cav-group{display:flex;align-items:center;gap:8px}
.cav-btn{display:inline-flex;align-items:center;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:12px;
  border:1px solid var(--dsw-alias-border-l1,#555);background:var(--dsw-alias-bg-layer-1,#1e1e1e);
  color:var(--dsw-alias-label-primary,#ddd);white-space:nowrap}
.cav-btn:hover{border-color:var(--dsw-alias-brand-primary,#4a9eff)}
.cav-btn[disabled]{opacity:.5;cursor:not-allowed}
.cav-range{width:120px;accent-color:var(--dsw-alias-brand-primary,#4a9eff)}
/* 依赖别的开关才有意义的滑杆（如「吸顶下移」依赖「头像跟随画面」）置灰时给个视觉提示 */
.cav-range:disabled{opacity:.45;cursor:not-allowed}
/* [本地补丁] 气泡颜色选择器 */
.cav-color{width:38px;height:26px;padding:0;border:1px solid var(--dsw-alias-border-l1,#555);border-radius:6px;
  background:var(--dsw-alias-bg-layer-1,#1e1e1e);cursor:pointer}
/*
 * [本地补丁] 字体下拉框。原生 <select> 在各平台长得不一样，这里统一成
 * 和 .cav-btn 同款的方块，避免在深色主题下变成一块刺眼的白。
 * 宽度给足，因为中文字体名 + 括号说明比较长。
 */
.cav-select{
  font:inherit;font-size:12.5px;line-height:1.2;
  min-width:210px;max-width:100%;
  padding:6px 8px;border-radius:7px;cursor:pointer;
  color:var(--dsw-alias-label-primary,#ddd);
  background:var(--dsw-alias-bg-layer-1,#1e1e1e);
  border:1px solid var(--dsw-alias-border-l1,#555);
}
.cav-select:hover{border-color:var(--dsw-alias-border-l2,#777)}
.cav-select:focus{outline:none;border-color:var(--dsw-alias-brand-primary,#4a9eff)}
/* 下拉展开的选项也要跟着深色，否则 Windows 上会闪白底黑字 */
.cav-select option{
  color:var(--dsw-alias-label-primary,#ddd);
  background:var(--dsw-alias-bg-overlay,#252525);
}
.cav-val{min-width:52px;text-align:right;color:var(--dsw-alias-label-secondary,#999)}
.cav-toggle{position:relative;width:38px;height:22px;flex:none;cursor:pointer}
.cav-toggle input{opacity:0;width:0;height:0}
.cav-toggle .track{position:absolute;inset:0;border-radius:11px;transition:background .16s;
  background:var(--dsw-alias-label-tertiary,#8a8a8a);border:1px solid var(--dsw-alias-border-l1,#666)}
.cav-toggle .track::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;
  background:var(--dsw-alias-bg-overlay,#f2f2f2);transition:left .16s;box-shadow:0 1px 3px rgba(0,0,0,.35)}
.cav-toggle input:checked + .track{background:var(--dsw-alias-brand-primary,#4a9eff);border-color:transparent}
.cav-toggle input:checked + .track::after{left:18px}
.cav-preview{width:44px;height:44px;border-radius:50%;object-fit:cover;display:flex;align-items:center;justify-content:center;
  border:1px solid var(--dsw-alias-border-l1,#555);background:var(--dsw-alias-bg-overlay,#222);color:var(--dsw-alias-label-secondary,#999)}
.cav-preview-empty{font-size:10px;border-style:dashed;color:var(--dsw-alias-label-tertiary,#888)}
.cav-status{font-size:12px;color:var(--dsw-alias-state-error-primary,#e05252);min-height:16px}
`;

    // ── 设置面板 ────────────────────────────────────────────────────────────
    function useSettings() {
      const [, force] = react.useState(0);
      react.useEffect(() => subscribe(() => force((n) => n + 1)), []);
      return getSettings();
    }
    function Toggle({ checked, onChange }) {
      return react.createElement('label', { className: 'cav-toggle' },
        react.createElement('input', { type: 'checkbox', checked, onChange: (e) => onChange(e.target.checked) }),
        react.createElement('span', { className: 'track' }));
    }
    function Row({ label, hint, children }) {
      return react.createElement('div', { className: 'cav-row' },
        react.createElement('div', null,
          react.createElement('div', { className: 'cav-label' }, label),
          hint ? react.createElement('div', { className: 'cav-hint' }, hint) : null),
        react.createElement('div', { className: 'cav-group' }, children));
    }

    /** 压缩到 <=512px 再上传（与壁纸引擎同一口径：导入前先缩一轮）。 */
    function downscale(file) {
      return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
          URL.revokeObjectURL(url);
          const max = 512;
          const scale = Math.min(1, max / Math.max(img.width, img.height));
          if (scale >= 1) { resolve({ blob: file, type: file.type }); return; }
          const c = document.createElement('canvas');
          c.width = Math.round(img.width * scale);
          c.height = Math.round(img.height * scale);
          const g = c.getContext('2d');
          g.drawImage(img, 0, 0, c.width, c.height);
          c.toBlob((blob) => {
            if (blob) resolve({ blob, type: blob.type || file.type });
            else reject(new Error('压缩失败'));
          }, file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.92);
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片读取失败')); };
        img.src = url;
      });
    }

    function AvatarCard({ side, title, hint, onStatus }) {
      const fileRef = react.useRef(null);
      const available = hasAvatar(side);
      const [busy, setBusy] = react.useState(false);
      const onSubmit = async (e) => {
        const file = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!file) return;
        setBusy(true);
        onStatus('');
        try {
          const { blob, type } = await downscale(file);
          const res = await fetch(`${API}/avatar/${side}`, {
            method: 'POST',
            headers: { 'content-type': type },
            body: blob,
          });
          const d = await res.json().catch(() => ({}));
          if (!res.ok || !d.ok) throw new Error(d.error || ('HTTP ' + res.status));
          const st = await fetchJson('/settings');
          applyResponse(st);
          notify();
        } catch (err) {
          onStatus('上传失败：' + String(err.message ?? err));
        } finally {
          setBusy(false);
        }
      };
      const onClear = async () => {
        setBusy(true);
        try {
          await fetch(`${API}/avatar/${side}`, { method: 'DELETE' });
          const st = await fetchJson('/settings');
          applyResponse(st);
          notify();
        } catch (err) {
          onStatus('清除失败：' + String(err.message ?? err));
        } finally {
          setBusy(false);
        }
      };
      const preview = available
        ? react.createElement('img', {
            className: 'cav-preview',
            src: `${API}/avatar/${side}`,
            alt: title + '预览',
            style: { borderRadius: roundOf() >= 100 ? '50%' : Math.round(roundOf() / 4) + '%' },
          })
        : react.createElement('div', { className: 'cav-preview cav-preview-empty' }, '未上传');
      return react.createElement('div', { className: 'cav-card' },
        react.createElement('div', { className: 'cav-card-head' },
          react.createElement('div', null,
            react.createElement('div', { className: 'cav-card-title' }, title),
            react.createElement('div', { className: 'cav-card-hint' }, hint)),
          preview),
        react.createElement(Row, { label: '上传图片', hint: 'PNG / JPG / WebP，自动缩到 512px 内' },
          react.createElement('span', { className: 'cav-btn', onClick: () => fileRef.current?.click() },
            busy ? '处理中…' : (available ? '替换图片…' : '选择图片…')),
          react.createElement('input', {
            ref: fileRef, type: 'file', accept: 'image/png,image/jpeg,image/webp',
            style: { display: 'none' }, onChange: onSubmit,
          })),
        available ? react.createElement(Row, { label: '清除', hint: '恢复为内置默认头像' },
          react.createElement('span', { className: 'cav-btn', onClick: onClear }, '清除')) : null);
    }

    function AvatarPanel() {
      const st = useSettings();
      const [status, setStatus] = react.useState('');
      return react.createElement('div', { className: 'cav-panel' },
        react.createElement(AvatarCard, { side: 'ai', title: 'AI 头像', hint: '显示在助手消息的左侧', onStatus: setStatus }),
        react.createElement(AvatarCard, { side: 'user', title: '我的头像', hint: '显示在你的消息右侧', onStatus: setStatus }),
        react.createElement('div', { className: 'cav-card' },
          react.createElement(Row, { label: '头像大小', hint: `${CLAMP_SIZE.min} – ${CLAMP_SIZE.max} px` },
            react.createElement('input', {
              className: 'cav-range', type: 'range',
              min: CLAMP_SIZE.min, max: CLAMP_SIZE.max, step: 1, value: sizeOf(),
              onChange: (e) => saveSettings({ avatarSize: Number(e.target.value) }),
            }),
            react.createElement('span', { className: 'cav-val' }, sizeOf() + ' px')),
          react.createElement(Row, { label: '圆角强度', hint: '100% = 正圆，0% = 直角方形' },
            react.createElement('input', {
              className: 'cav-range', type: 'range',
              min: CLAMP_ROUND.min, max: CLAMP_ROUND.max, step: 1, value: roundOf(),
              onChange: (e) => saveSettings({ avatarRadius: Number(e.target.value) }),
            }),
            react.createElement('span', { className: 'cav-val' }, roundOf() + ' %')),
          react.createElement(Row, { label: 'AI 回复气泡框', hint: '只给最终回复套框，思考/工具区不套' },
            react.createElement(Toggle, {
              checked: aiBubbleOn(),
              onChange: (v) => saveSettings({ plugin: { ...st.plugin, aiBubble: v } }),
            })),
          // [本地补丁] 气泡框外观：颜色留空 = 跟随主题（默认）
          react.createElement(Row, { label: '气泡背景色', hint: st.bubbleBg ? '自定义颜色' : '空 = 跟随主题' },
            react.createElement('input', {
              type: 'color', className: 'cav-color',
              value: st.bubbleBg || '#1b1b1f',
              onChange: (e) => saveSettings({ bubbleBg: e.target.value }),
            }),
            st.bubbleBg
              ? react.createElement('span', { className: 'cav-btn', onClick: () => saveSettings({ bubbleBg: '' }) }, '跟随主题')
              : react.createElement('span', { className: 'cav-val' }, '主题色')),
          react.createElement(Row, { label: '气泡边框色', hint: st.bubbleBorder ? '自定义颜色' : '空 = 跟随主题' },
            react.createElement('input', {
              type: 'color', className: 'cav-color',
              value: st.bubbleBorder || '#4a4a52',
              onChange: (e) => saveSettings({ bubbleBorder: e.target.value }),
            }),
            st.bubbleBorder
              ? react.createElement('span', { className: 'cav-btn', onClick: () => saveSettings({ bubbleBorder: '' }) }, '跟随主题')
              : react.createElement('span', { className: 'cav-val' }, '主题色')),
          react.createElement(Row, { label: '气泡圆角', hint: '0 – 40 px' },
            react.createElement('input', {
              className: 'cav-range', type: 'range',
              min: 0, max: 40, step: 1, value: bubbleRadiusOf(),
              onChange: (e) => saveSettings({ bubbleRadius: Number(e.target.value) }),
            }),
            react.createElement('span', { className: 'cav-val' }, bubbleRadiusOf() + ' px')),
          // [本地补丁] 透明度：让它透出主题与壁纸，比手选颜色更搭
          react.createElement(Row, { label: '气泡不透明度', hint: '越小越透，越低越能看见壁纸' },
            react.createElement('input', {
              className: 'cav-range', type: 'range',
              min: 0, max: 100, step: 1, value: bubbleAlphaOf(),
              onChange: (e) => saveSettings({ bubbleAlpha: Number(e.target.value) }),
            }),
            react.createElement('span', { className: 'cav-val' }, bubbleAlphaOf() + ' %')),
          /*
           * 磨砂：把气泡背后的壁纸/主题糊掉，底色再淡也不会糊成一团。
           * 只影响「气泡背后」的东西，文字本身永远清晰（见 STYLES 里关于层叠的说明）。
           * 0 = 关掉。默认 10px，配合默认 100% 不透明度也不会觉得闷。
           */
          react.createElement(Row, { label: '气泡磨砂', hint: '模糊气泡背后的壁纸，0 = 关闭；不影响文字清晰度' },
            react.createElement('input', {
              className: 'cav-range', type: 'range',
              min: 0, max: 30, step: 1, value: bubbleBlurOf(),
              onChange: (e) => saveSettings({ bubbleBlur: Number(e.target.value) }),
            }),
            react.createElement('span', { className: 'cav-val' }, bubbleBlurOf() === 0 ? '关' : bubbleBlurOf() + ' px')),
          /*
           * 正文字色：只改 AI 回复的正文文字。
           * 代码、思考区、工具调用不受影响（见 STYLES 里的边界说明）。
           * 这里**不做对比度校验**：选什么颜色是用户的选择，最多提示一句。
           */
          react.createElement(Row, {
            label: '正文字色',
            hint: textColorOf() ? '只影响正文，代码与思考内容不变' : '空 = 跟随主题',
          },
          react.createElement('input', {
            type: 'color', className: 'cav-color',
            value: textColorOf() || '#e8e8ee',
            onChange: (e) => saveSettings({ textColor: e.target.value }),
          }),
          textColorOf()
            ? react.createElement('span', { className: 'cav-btn', onClick: () => saveSettings({ textColor: '' }) }, '跟随主题')
            : react.createElement('span', { className: 'cav-val' }, '主题色')),
          /*
           * 用户消息字色：只改你自己发出的消息文本。
           * 与「正文字色」同款做法，两边可以分别设成不同颜色。
           */
          react.createElement(Row, {
            label: '我的消息字色',
            hint: userTextColorOf() ? '只影响你发出的消息' : '空 = 跟随主题',
          },
          react.createElement('input', {
            type: 'color', className: 'cav-color',
            value: userTextColorOf() || '#e8e8ee',
            onChange: (e) => saveSettings({ userTextColor: e.target.value }),
          }),
          userTextColorOf()
            ? react.createElement('span', { className: 'cav-btn', onClick: () => saveSettings({ userTextColor: '' }) }, '跟随主题')
            : react.createElement('span', { className: 'cav-val' }, '主题色')),

          /*
           * ── [本地补丁 · 字体] ────────────────────────────────────────────
           * 三组控件：界面字体、字号（正文/标题分开）、行距与加粗。
           * 字体清单只列本机确实装了的 —— 列一堆没装的字体，选了没反应，
           * 用户会以为功能坏了（这是 dsh-fonttune 原版的问题，这里避开）。
           */
          react.createElement(Row, {
            label: '界面字体',
            hint: familyOf() ? '点右侧可恢复主题字体' : '当前系统默认',
          },
          react.createElement('select', {
            className: 'cav-select',
            value: familyOf(),
            onChange: (e) => saveSettings({ fontFamily: e.target.value }),
          }, FONT_FAMILIES.map((f) => react.createElement('option', {
            key: f.value, value: f.value,
          }, f.label)))),

          /*
           * 字体覆盖层：正文 / 标题各一套。
           * 默认项写「跟随界面字体」而不是「主题默认」—— 因为这里是覆盖层，
           * 不填就等于用上面那套界面字体，不是回到系统默认。
           */
          react.createElement(Row, {
            label: '正文字体',
            hint: bodyFontOf() ? '覆盖界面字体，只作用于正文' : '跟随界面字体',
          },
          react.createElement('select', {
            className: 'cav-select',
            value: bodyFontOf(),
            onChange: (e) => saveSettings({ bodyFont: e.target.value }),
          }, [{ label: '跟随界面字体', value: '' }].concat(FONT_FAMILIES.slice(1)).map((f) => (
            react.createElement('option', { key: f.value, value: f.value }, f.label)
          )))),

          /*
           * ⚠️ 面板里【不提供】「标题字体」。
           *
           * 依据（查 app.asar 逐条核对过）：
           *   markdown h1..h6  → font-family: var(--dsw-font-family)
           *   markdown 正文     → font-family: var(--dsw-font-family)
           *   侧边栏标题        → 没有任何自己的 font-family，继承 body
           * 三者最终都取同一个 --dsw-font-family，也就是「界面字体」。
           * 所以再做一个「标题字体」开关，等于把同一个变量换个名字卖第二次，
           * 不会产生任何区别于界面字体的效果 —— 故去掉。
           *
           * settings.headingFont 字段仍然保留在数据里（不删），
           * 老配置读进来不会报错；万一以后 DSH 拆出独立的标题字体令牌，
           * 这个字段还能直接用上。
           */

          react.createElement(Row, { label: '代码字体', hint: '只影响代码块与行内代码' },
            react.createElement('select', {
              className: 'cav-select',
              value: fontMonoOf(),
              onChange: (e) => saveSettings({ fontMono: e.target.value }),
            }, MONO_FAMILIES.map((f) => react.createElement('option', {
              key: f.value, value: f.value,
            }, f.label)))),

          react.createElement(Row, { label: '正文字号', hint: '相对主题，0 = 不变' },
            react.createElement('input', {
              className: 'cav-range', type: 'range',
              min: -4, max: 8, step: 1, value: fontSizeDeltaOf(),
              onChange: (e) => saveSettings({ fontSizeDelta: Number(e.target.value) }),
            }),
            react.createElement('span', { className: 'cav-val' },
              (fontSizeDeltaOf() > 0 ? '+' : '') + fontSizeDeltaOf() + ' px')),

          react.createElement(Row, { label: '标题字号', hint: '独立于正文，0 = 不变' },
            react.createElement('input', {
              className: 'cav-range', type: 'range',
              min: -6, max: 12, step: 1, value: headingSizeDeltaOf(),
              onChange: (e) => saveSettings({ headingSizeDelta: Number(e.target.value) }),
            }),
            react.createElement('span', { className: 'cav-val' },
              (headingSizeDeltaOf() > 0 ? '+' : '') + headingSizeDeltaOf() + ' px')),

          react.createElement(Row, { label: '行距', hint: '相对主题，0 = 不变' },
            react.createElement('input', {
              className: 'cav-range', type: 'range',
              min: -20, max: 60, step: 5, value: lineHeightDeltaOf(),
              onChange: (e) => saveSettings({ lineHeightDelta: Number(e.target.value) }),
            }),
            react.createElement('span', { className: 'cav-val' },
              (lineHeightDeltaOf() > 0 ? '+' : '') + lineHeightDeltaOf() + ' %')),

          react.createElement(Row, { label: '正文加粗', hint: '0 = 跟随主题；只加粗段落，不动标题' },
            react.createElement('input', {
              className: 'cav-range', type: 'range',
              min: 0, max: 700, step: 50, value: fontBoldOf(),
              onChange: (e) => saveSettings({ fontWeight: Number(e.target.value) }),
            }),
            react.createElement('span', { className: 'cav-val' },
              fontBoldOf() === 0 ? '主题' : String(fontBoldOf()))),

          /*
           * 头像跟随滚动（v1.0）：总开关。
           * 关掉后头像只固定在每条消息的开头，长回复往下翻时它随行一起滚走，
           * 不再贴住滚动区顶部跟着走。下面的「吸顶下移」只在开着时有意义，
           * 所以顺手把它置灰（disabled），避免调了没反应像是坏了。
           */
          react.createElement(Row, { label: '头像跟随画面', hint: '关掉后头像只固定在消息开头，不再跟着滑动' },
            react.createElement(Toggle, {
              checked: stickFollowOf(),
              onChange: (v) => saveSettings({ plugin: { ...st.plugin, stickFollow: v } }),
            })),
          react.createElement(Row, { label: '头像吸顶下移', hint: stickFollowOf() ? '翻页时下滑几个身位，避开主题状态栏' : '先打开「头像跟随画面」才有效' },
            react.createElement('input', {
              className: 'cav-range', type: 'range',
              min: 0, max: 6, step: 1, value: stickOffsetOf(),
              disabled: !stickFollowOf(),
              onChange: (e) => saveSettings({ plugin: { ...st.plugin, stickOffset: Number(e.target.value) } }),
            }),
            react.createElement('span', { className: 'cav-val' }, stickOffsetOf() + ' 个')),
          react.createElement(Row, { label: '启用插件', hint: '关闭后移除全部头像与气泡（设置保留）' },
            react.createElement(Toggle, {
              checked: st.plugin.enabled !== false,
              onChange: (v) => saveSettings({ plugin: { ...st.plugin, enabled: v } }),
            }))),
        react.createElement('div', { className: 'cav-status' }, status));
    }

    // ── 入口 ────────────────────────────────────────────────────────────────
    const inject = ['slots'];
    function apply(ctx) {
      ctx.effect(() => {
        const style = document.createElement('style');
        style.dataset.plugin = 'dsh-conversation-avatar';
        style.textContent = STYLES;
        document.head.appendChild(style);
        return () => { style.remove(); };
      });
      ctx.effect(() => () => stopLayer());
      setLayerSync(() => {
        const b = body();
        if (getSettings().plugin.enabled !== false) {
          if (b) {
            b.setAttribute(AVATAR_ATTR, 'on');
            b.style.setProperty(VAR_SIZE, sizeOf() + 'px');
            b.style.setProperty(VAR_ROUND, String(roundOf()));
            // [本地补丁] 气泡框外观：底色留空 = 移除变量 ⇒ CSS 回落主题色
            b.style.setProperty('--cav-bubble-radius', bubbleRadiusOf() + 'px');
            b.style.setProperty('--cav-bubble-alpha', String(bubbleAlphaOf()));
            b.style.setProperty('--cav-bubble-blur', bubbleBlurOf() + 'px');
            applyColorVar(b, '--cav-bubble-base', settings.bubbleBg);
            applyColorVar(b, '--cav-bubble-border', settings.bubbleBorder);
            // [本地补丁] 正文字色：空 = 移除变量 ⇒ CSS 那条 color 规则不生效，回到主题
            applyColorVar(b, '--cav-text-color', settings.textColor);
            // [本地补丁] 用户消息字色：同上
            applyColorVar(b, '--cav-user-text-color', settings.userTextColor);
          }
          startLayer();
          scheduleProcess();
          /*
           * [本地补丁 · v1.0] 开关切换后要让新状态**立刻**生效，不等下一次滚动：
           *   关 → 所有头像的 style.top 立刻清零（resetSticky）；
           *   开 → 立刻按当前滚动位置重算一次（scheduleSticky）。
           * 这两步都幂等，设置没变时不会产生多余写入。
           */
          if (stickFollowOf()) scheduleSticky(); else resetSticky();
          /*
           * [本地补丁] 字体：独立于头像图层。
           * 放在这里是因为 setLayerSync 在「每次设置变化 / notify()」时都会跑，
           * 正好是字体需要重新计算的时机。字体样式有自己的 <style> 节点，
           * 和头像的开关互不影响（关掉头像仍然可以换字体）。
           */
          syncFontStyle();
        } else {
          stopLayer();
          clearFontStyle();
        }
      });
      /*
       * 设置卡片挂在「插件详情页」，不再占设置页里单独的一节。
       *
       * 位置说明（DSH 官方对三个插槽的定义）：
       *   settings.section       → 设置页里独立的一节（旧做法，占地方）
       *   plugins.item           → 「已安装插件」页里的**官方插件**列表项，我们不是官方插件
       *   plugins.bundle.config  → 按 bundle 包名 keyed，显示在**该插件的详情页**上，
       *                            位置在「描述」和「组件行列表」之间 ← 用这个
       *
       * 这样设置只在点进这个插件时才出现，设置页列表保持干净。
       * 组件本身（AvatarPanel）不用改：它靠 useSettings() 自己读写，不依赖挂在哪。
       *
       * 不写 `locale` 字段：这个插件没有向客户端注册过 locale 命名空间
       * （界面文字全写死在组件里），挂一个不存在的命名空间反而会拿到空字典。
       */
      ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
        name: 'plugins.bundle.config',
        key: 'dsh-conversation-avatar',
      }, AvatarPanel));
      loadSettings();
      notify();
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
