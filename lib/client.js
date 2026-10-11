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
 *   - 设置入口是「设置 → 头像」（settings.section，order 16）。
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
    const aiBubbleOn = () => settings.plugin?.aiBubble !== false;
    const bubbleRadiusOf = () => clamp(settings.bubbleRadius, 0, 40, 14);
    const bubbleAlphaOf = () => clamp(settings.bubbleAlpha, 0, 100, 100);
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
        },
        avatarSize: clamp(p.avatarSize ?? current.avatarSize, CLAMP_SIZE.min, CLAMP_SIZE.max, CLAMP_SIZE.def),
        avatarRadius: clamp(p.avatarRadius ?? current.avatarRadius, CLAMP_ROUND.min, CLAMP_ROUND.max, CLAMP_ROUND.def),
        bubbleBg: p.bubbleBg === undefined ? current.bubbleBg : hexOf(p.bubbleBg),
        bubbleBorder: p.bubbleBorder === undefined ? current.bubbleBorder : hexOf(p.bubbleBorder),
        bubbleRadius: clamp(p.bubbleRadius ?? current.bubbleRadius, 0, 40, 14),
        bubbleAlpha: clamp(p.bubbleAlpha ?? current.bubbleAlpha, 0, 100, 100),
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

    function scheduleSticky() {
      if (!active || stickFrame !== 0) return;
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
      }
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
   ── [本地补丁 · 透明度] ──────────────────────────────────────────────────
   主题令牌都是**实色**（没有半透明背景令牌），直接盖在壁纸上会很重、也不搭。
   底色统一走 color-mix()：把「底色 × alpha」混出来 —— 跟随主题或自定义色都按同一 alpha 混。
   · --cav-bubble-base  底色（不透明），默认主题 layer-1
   · --cav-bubble-alpha 不透明度 0–100，默认 100
   ⚠️ 本插件不提供磨砂：气泡底色只做半透明混合，不加 backdrop-filter。
      历史原因：backdrop-filter 会让元素自成包含块 + 层叠上下文，
      把行的 flex 布局与头像定位一起搅坏（表现为整段会话不渲染），且文字会被压在模糊层下发虚。 */
.${BUBBLE_CLASS} {
  position: relative;
  border: 1px solid var(--cav-bubble-border, var(--dsw-alias-border-l1, rgba(128,128,128,.28)));
  border-radius: var(--cav-bubble-radius, var(--dsw-radius-lg, 14px));
  padding: var(--cav-bubble-pad, 10px 16px);
}
/* 底色由伪元素承载（伪元素不是包含块，不会破坏行的 flex 布局）。
   不用负 z-index：给它 z-index:0，再用 isolation 把行内内容压在它上面即可。 */
.${BUBBLE_CLASS}::before {
  content: ""; position: absolute; inset: 0; border-radius: inherit;
  pointer-events: none; z-index: 0;
  background: var(--cav-bubble-base, var(--dsw-alias-bg-layer-1, rgba(128,128,128,.10)));
}
@supports (background: color-mix(in srgb, red 50%, transparent)) {
  .${BUBBLE_CLASS}::before {
    background: color-mix(in srgb,
      var(--cav-bubble-base, var(--dsw-alias-bg-layer-1, rgba(128,128,128,.10))) calc(var(--cav-bubble-alpha, 100) * 1%),
      transparent);
  }
}
/* 行内真实内容抬到伪元素之上 */
.${BUBBLE_CLASS} > * { position: relative; z-index: 1; }

/* ── 设置面板 ── */
.cav-panel{display:flex;flex-direction:column;gap:14px;padding:4px 2px;font-size:13px;color:var(--dsw-alias-label-primary,#ddd)}
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
/* [本地补丁] 气泡颜色选择器 */
.cav-color{width:38px;height:26px;padding:0;border:1px solid var(--dsw-alias-border-l1,#555);border-radius:6px;
  background:var(--dsw-alias-bg-layer-1,#1e1e1e);cursor:pointer}
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
          react.createElement(Row, { label: '头像吸顶下移', hint: '翻页时下滑几个身位，避开主题状态栏' },
            react.createElement('input', {
              className: 'cav-range', type: 'range',
              min: 0, max: 6, step: 1, value: stickOffsetOf(),
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
            applyColorVar(b, '--cav-bubble-base', settings.bubbleBg);
            applyColorVar(b, '--cav-bubble-border', settings.bubbleBorder);
          }
          startLayer();
          scheduleProcess();
        } else {
          stopLayer();
        }
      });
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'dsh-conversation-avatar',
        order: 16,
        label: () => '头像和气泡框',
      }, AvatarPanel));
      loadSettings();
      notify();
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
