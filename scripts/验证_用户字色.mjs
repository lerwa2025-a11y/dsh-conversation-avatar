/**
 * 验证「用户消息字色」功能（v0.2.5）。
 *
 * 重点防两件事：
 *   ① 只作用于 user 侧的行，不误伤 AI 回复
 *   ② 头像绝不被命中（2026-10-25 被这个坑坏过一次）
 *
 * 用法：node 验证_用户字色.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const CLIENT = join(here, '..', 'lib', 'client.js');
const HOST = join(here, '..', 'lib', 'index.js');

const src = readFileSync(CLIENT, 'utf8');
const host = readFileSync(HOST, 'utf8');

function stylesBlock(text) {
  const start = text.indexOf('const STYLES = `');
  const from = text.indexOf('`', start) + 1;
  const end = text.indexOf('\n`;', from);
  return text.slice(from, end)
    .replace(/\$\{BUBBLE_CLASS\}/g, 'cav-bubbled')
    .replace(/\$\{AVATAR_NODE_CLASS\}/g, 'cav-avatar')
    .replace(/\$\{AVATAR_ATTR\}/g, 'data-cav-on')
    .replace(/\$\{AVATAR_ROW_ATTR\}/g, 'data-cav-row')
    .replace(/\$\{VAR_SIZE\}/g, '--cav-size')
    .replace(/\$\{VAR_ROUND\}/g, '--cav-round');
}
const css = stylesBlock(src);
const decls = css.replace(/\/\*[\s\S]*?\*\//g, '');

function parseRules(text) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push({ sel: m[1].trim().replace(/\s+/g, ' '), body: m[2].trim() });
  }
  return out;
}
const rules = parseRules(decls);

let pass = 0;
let fail = 0;
const check = (label, ok, detail = '') => {
  if (ok) { pass += 1; console.log(`  ✓ ${label}`); }
  else { fail += 1; console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`); }
};

console.log('\n[1] 用户字色只作用于 user 侧');
{
  const userRules = rules.filter((r) => r.body.includes('--cav-user-text-color'));
  check('存在使用 --cav-user-text-color 的规则', userRules.length > 0);
  check('所有用户字色规则都限定 data-cav-row="user"',
    userRules.every((r) => r.sel.includes('data-cav-row="user"')),
    userRules.map((r) => r.sel).join(' | '));

  // 反过来：AI 规则不能引用用户变量，避免串色
  const aiRules = rules.filter((r) => r.body.includes('--cav-text-color') && !r.body.includes('--cav-user-text-color'));
  check('AI 字色规则不引用用户变量',
    aiRules.every((r) => !r.body.includes('--cav-user-text-color')));

  // 用户规则不能引用 AI 变量
  check('用户字色规则不引用 AI 变量',
    userRules.every((r) => !r.body.includes('var(--cav-text-color')));
}

console.log('\n[2] 头像绝不被用户字色命中（上次的事故）');
{
  const userWildcard = rules.find((r) => r.sel.includes('data-cav-row="user"') && r.sel.includes('*:not('));
  check('用户侧也有后代通配规则', Boolean(userWildcard));
  check('排除清单含 .cav-avatar（含后代）',
    Boolean(userWildcard) && /\.cav-avatar \*/.test(userWildcard.sel),
    userWildcard ? userWildcard.sel.slice(0, 300) : '');

  // 硬断言：任何含通配符的颜色规则，排除清单里都必须有头像
  const colorWildcards = rules.filter((r) => /(^|[\s;])color\s*:/.test(r.body) && r.sel.includes('*'));
  const missing = colorWildcards.filter((r) => !/\.cav-avatar/.test(r.sel));
  check('没有「会命中头像」的颜色通配规则', missing.length === 0,
    missing.map((r) => r.sel).join(' | '));
}

console.log('\n[3] 用户侧也排除代码（用户消息里可能有行内代码）');
{
  const userWildcard = rules.find((r) => r.sel.includes('data-cav-row="user"') && r.sel.includes('*:not('));
  const sel = userWildcard ? userWildcard.sel : '';
  check('排除 pre 及其后代', /pre, pre \*/.test(sel));
  check('排除 code 及其后代', /code, code \*/.test(sel));
  check('排除 kbd / samp', /kbd, samp/.test(sel));
}

console.log('\n[4] 用户字色规则不碰布局属性');
{
  const userRules = rules.filter((r) => r.body.includes('--cav-user-text-color'));
  check('只设置 color，不写 width/flex/display',
    userRules.every((r) => !/(^|[\s;])(width|max-width|min-width|flex|display|overflow)\s*:/.test(r.body)),
    userRules.map((r) => r.body.replace(/\s+/g, ' ')).join(' | '));
}

console.log('\n[5] 设置项端到端');
{
  check('服务端默认值 userTextColor: \'\'', /userTextColor:\s*''/.test(host));
  check('服务端净化 userTextColor', /userTextColor:[^\n]*hexOrEmpty/.test(host));
  check('客户端默认值 userTextColor: \'\'', /userTextColor:\s*''/.test(src));
  check('客户端净化 userTextColor', /userTextColor:[^\n]*hexOf/.test(src));
  check('有 userTextColorOf()', src.includes('userTextColorOf'));
  check('面板有「我的消息字色」这一项', src.includes('我的消息字色'));
  check('面板有跟随主题按钮', src.includes("saveSettings({ userTextColor: '' })"));
  check('写入 DOM 变量', src.includes("applyColorVar(b, '--cav-user-text-color'"));
  check('关闭插件时清理变量', src.includes("removeProperty('--cav-user-text-color')"));
}

console.log('\n[6] 不破坏已有功能');
{
  const bubble = rules.find((r) => r.sel === '.cav-bubbled');
  check('气泡主规则仍无 width 类属性（上次事故）',
    Boolean(bubble) && !/(max-width|min-width|(^|[\s;])width\s*:)/.test(bubble.body));
  check('气泡层叠仍正确', /cav-bubbled::before\s*\{[^}]*z-index:\s*-1/.test(decls));
  check('磨砂仍在', /backdrop-filter:\s*blur\(/.test(decls));
  check('AI 字色规则仍在', rules.some((r) => r.body.includes('--cav-text-color')));
  // 头像尺寸唯一来源
  const sizeRules = rules.filter((r) => (
    /(^|[\s>])\.cav-avatar(\s*$|\s*[>{])/.test(r.sel + ' ') && /(^|[\s;])width\s*:/.test(r.body)
  ));
  check('头像尺寸仍只有一个来源', sizeRules.length === 1, String(sizeRules.length));
}

console.log(`\n结果：通过 ${pass}，失败 ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
