/**
 * 验证 dsh-conversation-avatar 的设置确实挂到了「插件详情页」，
 * 而不是原来的「设置」页独立一节。
 *
 * 用法：node 验证_详情页入口.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const PLUGIN = join(here, '..', 'lib', 'client.js');
const PKG = join(here, '..', 'package.json');

const src = readFileSync(PLUGIN, 'utf8');
const pkg = JSON.parse(readFileSync(PKG, 'utf8'));

let pass = 0;
let fail = 0;
const check = (label, ok, detail = '') => {
  if (ok) { pass += 1; console.log(`  ✓ ${label}`); }
  else { fail += 1; console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`); }
};

/** 取出一段代码的实际内容（去注释），用于区分「真的注册了」和「只在注释里提到」。 */
function codeOnly(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const code = codeOnly(src);

console.log('\n[1] 注册到了插件详情页槽位');
{
  check('有 ctx.slots.inject(\'plugins.bundle.config\')', code.includes("ctx.slots.inject('plugins.bundle.config'"));
  check('name 是 plugins.bundle.config', /name:\s*'plugins\.bundle\.config'/.test(code));
  const keyMatch = code.match(/plugins\.bundle\.config[\s\S]{0,300}?key:\s*'([^']+)'/);
  check('声明了 key', Boolean(keyMatch), '没找到 key 字段');
  check('key 等于包名（详情页靠它认领，必须一致）',
    keyMatch && keyMatch[1] === pkg.name,
    `key=${keyMatch?.[1]} 包名=${pkg.name}`);
}

console.log('\n[2] 不再注册到设置页');
{
  check('代码里没有 settings.section 注册', !code.includes("ctx.slots.inject('settings.section'"));
  check('代码里没有 name: settings.section', !/name:\s*'settings\.section'/.test(code));
}

console.log('\n[3] 组件本身没被动过（只搬入口，不改功能）');
{
  check('AvatarPanel 仍存在', src.includes('function AvatarPanel'));
  check('两个头像卡片都在（AI / 我的）',
    src.includes("side: 'ai'") && src.includes("side: 'user'"));
  check('头像大小滑杆在', src.includes('avatarSize'));
  check('圆角强度在', src.includes('avatarRadius'));
  check('气泡框开关在', src.includes('aiBubble'));
  check('气泡背景色在', src.includes('bubbleBg'));
  check('气泡边框色在', src.includes('bubbleBorder'));
  check('气泡圆角在', src.includes('bubbleRadius'));
  check('气泡不透明度在', src.includes('bubbleAlpha'));
  check('吸顶下移在', src.includes('stickOffset'));
  check('总开关在', src.includes('plugin.enabled') || src.includes('st.plugin.enabled'));
}

console.log('\n[4] 设置读写不依赖挂载位置（搬走后仍然工作）');
{
  check('组件通过 useSettings 自取数据', src.includes('useSettings'));
  check('仍有 saveSettings', src.includes('saveSettings'));
  /*
   * 数据路由是 `const API = '/dsh-conversation-avatar'` 加 `fetchJson('/settings')`
   * 拼出来的，不是一整串字面量，所以分开断言。
   */
  const hasApiBase = /const API = '\/dsh-conversation-avatar'/.test(src);
  const hasSettingsPath = src.includes("fetchJson('/settings'") || src.includes("'/settings'");
  check('API 前缀仍是自己的包名', hasApiBase);
  check('仍走 /settings 读写', hasSettingsPath);
}

console.log('\n[5] 不写不存在的 locale 命名空间');
{
  // 注册块里不应有 locale 字段（这个插件没注册客户端 locale）
  const block = code.slice(
    code.indexOf("ctx.slots.inject('plugins.bundle.config'"),
    code.indexOf("ctx.slots.inject('plugins.bundle.config'") + 400,
  );
  check('注册块内没有 locale 字段', !/locale:/.test(block), block);
}

console.log('\n[6] 版本号已升级');
{
  /*
   * 断言「不低于 0.2.0」而不是写死具体版本：
   * 写死会让每次升版本都误报（这个坑踩过），而这条测试关心的是
   * 「已经升过版本、不是最初那个 0.1.0」，不是某个精确值。
   */
  const [major, minor] = pkg.version.split('.').map(Number);
  const atLeast = major > 0 || (major === 0 && minor >= 2);
  check('版本不低于 0.2.0', atLeast, pkg.version);
  check('不是最初的 0.1.0', pkg.version !== '0.1.0', pkg.version);
}

console.log(`\n结果：通过 ${pass}，失败 ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
