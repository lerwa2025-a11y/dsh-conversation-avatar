/**
 * dsh-conversation-avatar —— Host 半：头像存储 + 三条路由（上传 / 查看 / 清除）。
 *
 * 移植自 dsh-plugin-wallpaper-engine 的「自定义会话头像」扩展，只保留头像部分：
 * 不碰壁纸、玻璃、字体、点击特效、拖尾、吉祥物等任何其它功能。
 *
 * 路由（全部挂 ctx.effect，卸载即净；只信任回环 + 同源）：
 *   GET    /dsh-conversation-avatar/avatar/<side>       → 头像字节（未导入 → 404）
 *   POST   /dsh-conversation-avatar/avatar/<side>       → 导入（body 即图片字节）
 *   DELETE /dsh-conversation-avatar/avatar/<side>       → 清除
 *   GET    /dsh-conversation-avatar/settings            → 读设置
 *   POST   /dsh-conversation-avatar/settings            → 写设置（部分 patch）
 *
 * 存储：$DSH_HOME/dsh-conversation-avatar/{settings.json, avatars/<side>-<stamp>.<ext>}
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/** 允许的图片格式（Content-Type → 扩展名）。 */
const AVATAR_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
/** 单张上限 8MB（客户端导入前已缩到 512px 以内）。 */
const AVATAR_MAX_BYTES = 8 * 1024 * 1024;
/** 只有两方。路径段当白名单查，不拼进文件名 ⇒ 路径穿越在这一步就不可能。 */
const AVATAR_SIDES = ['user', 'ai'];

const DATA_DIR = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'dsh-conversation-avatar');
const AVATAR_DIR = join(DATA_DIR, 'avatars');
const SETTINGS_FILE = join(DATA_DIR, 'settings.json');

const name = 'dsh-conversation-avatar';
const inject = ['webServer'];

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};
const LOCAL_HOST_RE = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

function trustedRequest(req) {
  const { host = '', origin = '' } = req.headers ?? {};
  if (typeof host !== 'string' || !LOCAL_HOST_RE.test(host)) return false;
  if (origin === '') return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function sendJson(res, code, payload) {
  try {
    res.writeHead(code, JSON_HEADERS);
    res.end(JSON.stringify(payload));
  } catch { /* ignore */ }
}

/** 目录确保存在（每次调用都 mkdir，幂等且便宜）。 */
function avatarDir() {
  mkdirSync(AVATAR_DIR, { recursive: true });
  return AVATAR_DIR;
}

/** 换图即换名：时间戳 + 随机，天然是缓存键。 */
function avatarStamp() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** 某一方当前那张头像的路径（按前缀扫目录取第一个命中的）；没有就 null。 */
function avatarPath(side) {
  if (!AVATAR_SIDES.includes(side)) return null;
  let entries = [];
  try {
    entries = readdirSync(avatarDir());
  } catch {
    return null;
  }
  const prefix = side + '-';
  const hit = entries.filter((n) => n.startsWith(prefix) && !n.endsWith('.tmp')).sort()[0];
  return hit ? join(avatarDir(), hit) : null;
}

/** 两侧是否已有可用头像：客户端据此决定「画导入的图」还是「内置默认头像」。 */
function avatarAvailability() {
  return {
    user: avatarPath('user') !== null,
    ai: avatarPath('ai') !== null,
  };
}

// ── 设置 ────────────────────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  plugin: { enabled: true, aiBubble: true, stickOffset: 2 },
  avatarSize: 40,
  avatarRadius: 100,
  bubbleBg: '',
  bubbleBorder: '',
  bubbleRadius: 14,
  bubbleAlpha: 100,
};

function clampNum(v, lo, hi, fallback) {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

/** 只接受 `#rgb` / `#rrggbb`（空串 = 跟随主题哨兵值）。 */
function hexOrEmpty(v) {
  if (typeof v !== 'string') return '';
  const s = v.trim();
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s) ? s : '';
}

/** 逐字段净化：非法/缺失沿用 current，未知字段丢弃。 */
function sanitizeSettings(patch, current) {
  const p = patch && typeof patch === 'object' ? patch : {};
  const plugin = p.plugin && typeof p.plugin === 'object' ? p.plugin : {};
  return {
    plugin: {
      enabled: typeof plugin.enabled === 'boolean' ? plugin.enabled : current.plugin.enabled,
      aiBubble: typeof plugin.aiBubble === 'boolean' ? plugin.aiBubble : current.plugin.aiBubble,
      stickOffset: clampNum(plugin.stickOffset ?? current.plugin.stickOffset, 0, 6, 2),
    },
    avatarSize: clampNum(p.avatarSize ?? current.avatarSize, 16, 128, 40),
    avatarRadius: clampNum(p.avatarRadius ?? current.avatarRadius, 0, 100, 100),
    // [本地补丁] 气泡框外观（空串 = 跟随主题）
    bubbleBg: p.bubbleBg === undefined ? current.bubbleBg : hexOrEmpty(p.bubbleBg),
    bubbleBorder: p.bubbleBorder === undefined ? current.bubbleBorder : hexOrEmpty(p.bubbleBorder),
    bubbleRadius: clampNum(p.bubbleRadius ?? current.bubbleRadius, 0, 40, 14),
    bubbleAlpha: clampNum(p.bubbleAlpha ?? current.bubbleAlpha, 0, 100, 100),
  };
}

function readSettings() {
  try {
    return sanitizeSettings(JSON.parse(readFileSync(SETTINGS_FILE, 'utf8')), DEFAULT_SETTINGS);
  } catch {
    try {
      if (existsSync(SETTINGS_FILE)) renameSync(SETTINGS_FILE, SETTINGS_FILE + '.bak');
    } catch { /* ignore */ }
    return sanitizeSettings({}, DEFAULT_SETTINGS);
  }
}

function writeSettings(next) {
  mkdirSync(DATA_DIR, { recursive: true });
  const tmp = SETTINGS_FILE + '.tmp';
  writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8');
  renameSync(tmp, SETTINGS_FILE);
}

function readBody(req, limit) {
  return new Promise((resolvePromise, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        req.pause();
        reject(new Error('too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolvePromise(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function apply(ctx) {
  mkdirSync(DATA_DIR, { recursive: true });
  const disposers = [];

  const on = (path, handler) => {
    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path,
      handler: (req, res) => {
        if (!trustedRequest(req)) return sendJson(res, 403, { ok: false, error: 'untrusted origin' });
        Promise.resolve().then(() => handler(req, res)).catch((err) => {
          sendJson(res, 400, { ok: false, error: String(err?.message ?? err) });
        });
      },
    }));
  };

  on('/dsh-conversation-avatar/settings', async (req, res) => {
    if (req.method !== 'POST') {
      const settings = readSettings();
      return sendJson(res, 200, { ok: true, settings, available: avatarAvailability() });
    }
    const body = await readBody(req, 64 * 1024);
    const next = sanitizeSettings(JSON.parse(body.toString('utf8') || '{}'), readSettings());
    writeSettings(next);
    sendJson(res, 200, { ok: true, settings: next, available: avatarAvailability() });
  });

  // 头像：GET 查看 / POST 导入 / DELETE 清除。side 走白名单。
  disposers.push(ctx.webServer.register({
    kind: 'prefix',
    path: '/dsh-conversation-avatar/avatar',
    handler: (req, res) => {
      if (!trustedRequest(req)) return sendJson(res, 403, { ok: false, error: 'untrusted origin' });
      const method = (req.method || 'GET').toUpperCase();
      const pathname = new URL(req.url || '/', 'http://x').pathname;
      const side = decodeURIComponent(pathname.slice('/dsh-conversation-avatar/avatar/'.length)).replace(/\/+$/, '');
      if (!AVATAR_SIDES.includes(side)) return sendJson(res, 400, { ok: false, error: 'bad side' });

      if (method === 'GET' || method === 'HEAD') {
        const p = avatarPath(side);
        if (!p) return sendJson(res, 404, { ok: false, error: 'not set' });
        const bytes = readFileSync(p);
        const ext = p.slice(p.lastIndexOf('.') + 1).toLowerCase();
        const type = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
          : ext === 'webp' ? 'image/webp' : 'image/png';
        res.writeHead(200, {
          'Content-Type': type,
          // 文件名即版本 ⇒ 可长缓存；一屏会渲染多份 <img>，没缓存就是每气泡一次请求
          'Cache-Control': 'private, max-age=31536000, immutable',
          'Content-Length': String(bytes.length),
        });
        res.end(method === 'HEAD' ? undefined : bytes);
        return;
      }

      if (method === 'DELETE') {
        const p = avatarPath(side);
        let removed = false;
        if (p) {
          try { unlinkSync(p); removed = true; } catch { /* ignore */ }
        }
        sendJson(res, 200, { ok: true, side, removed, available: avatarAvailability() });
        return;
      }

      if (method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' });

      const ctype = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      const ext = AVATAR_EXT[ctype];
      if (!ext) return sendJson(res, 415, { ok: false, error: 'unsupported type: ' + ctype });

      readBody(req, AVATAR_MAX_BYTES).then((body) => {
        if (!body.length) return sendJson(res, 400, { ok: false, error: 'empty body' });
        // 换图即清兄弟：同 side 的旧文件（可能换了扩展名/时间戳）先删，否则读取侧取到旧图
        try {
          for (const n of readdirSync(avatarDir())) {
            if (!n.startsWith(side + '-')) continue;
            try { unlinkSync(join(avatarDir(), n)); } catch { /* ignore */ }
          }
        } catch { /* 空目录 */ }
        const file = join(avatarDir(), side + '-' + avatarStamp() + '.' + ext);
        const tmp = file + '.tmp';
        writeFileSync(tmp, body);
        renameSync(tmp, file);
        sendJson(res, 200, { ok: true, side, name: file.slice(file.lastIndexOf('/') + 1), available: avatarAvailability() });
      }).catch(() => sendJson(res, 413, { ok: false, error: 'image too large (max 8MB)' }));
    },
  }));

  ctx.effect(() => () => {
    for (const dispose of disposers) dispose();
  });
}

export { apply, inject, name };
