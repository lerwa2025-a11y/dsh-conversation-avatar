/**
 * 头像尺寸回归验证（2026-10-25 事故）。
 *
 * 事故：加「正文字色」时写了通配规则 `[data-cav-row="ai"] *:not(...)`，
 * 没有把 .cav-avatar 排除，头像被卷进字色规则（SVG 用 currentColor 会被染色），
 * 同时给 .cav-bubbled 加了 max-width/min-width，把同一行里的头像一起改坏
 * —— 表现是「对话里出现一个很大的头像」。
 *
 * 这个脚本守住三条底线：
 *   ① 头像绝不被任何「字色」规则命中
 *   ② .cav-bubbled 本体不写 width 类属性（它和头像同处一个 flex 行）
 *   ③ 头像尺寸只有一个来源：.cav-avatar 的 var(--cav-size)
 *
 * 用法：node 验证_头像尺寸.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8');

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

/** 把 CSS 拆成 { sel, body } 列表。 */
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

console.log('\n[1] 头像不被字色规则命中');
{
  // 找所有设置 color 的规则，看有没有可能选中头像
  const colorRules = rules.filter((r) => /(^|[\s;])color\s*:/.test(r.body));
  const hitsAvatar = colorRules.filter((r) => {
    // 含通配符且排除清单里没有 cav-avatar ⇒ 会命中头像
    if (!r.sel.includes('*')) return false;
    return !/\.cav-avatar/.test(r.sel);
  });
  check('不存在「会命中头像」的字色通配规则',
    hitsAvatar.length === 0,
    hitsAvatar.map((r) => r.sel).join(' | '));

  // 排除清单里必须显式写出头像
  const wildcard = rules.find((r) => r.sel.includes('*:not('));
  check('通配规则的排除清单里含 .cav-avatar', Boolean(wildcard) && /\.cav-avatar/.test(wildcard.sel));
  check('也排除 .cav-avatar 的后代（svg 等）', Boolean(wildcard) && /\.cav-avatar \*/.test(wildcard.sel));
}

console.log('\n[2] 气泡本体不碰 width 类属性（会和头像同处一个 flex 行）');
{
  const bubble = rules.find((r) => r.sel === '.cav-bubbled');
  check('找到了 .cav-bubbled 主规则', Boolean(bubble));
  const body = bubble ? bubble.body : '';
  check('没有 max-width', !/max-width/.test(body), body.replace(/\s+/g, ' '));
  check('没有 min-width', !/min-width/.test(body), body.replace(/\s+/g, ' '));
  check('没有 width', !/(^|[\s;])width\s*:/.test(body));
  check('没有 overflow', !/overflow/.test(body));
  check('仍保留 isolation（层叠修复）', /isolation:\s*isolate/.test(body));
}

console.log('\n[3] 头像尺寸只有一个来源');
{
  /*
   * 只统计「直接给头像本体」设 width 的规则，选择器必须**就是** .cav-avatar
   * （或其修饰选择器），不能把子元素算进来：
   *   .cav-avatar              ← 本体尺寸，唯一真相
   *   .cav-avatar__img         ← 图片撑满父级（width:100%），正常
   *   .cav-avatar__glyph svg   ← 图标占 62%，正常
   * 之前把这三条都算成「重复」是测试写粗了（误报），不是代码问题。
   */
  const bodyRules = rules.filter((r) => (
    /(^|[\s>])\.cav-avatar(\s*$|\s*[>{])/.test(r.sel + ' ')
    && /(^|[\s;])width\s*:/.test(r.body)
  ));
  check('只有 1 条规则给头像本体设宽度', bodyRules.length === 1,
    bodyRules.map((r) => r.sel).join(' | '));
  const only = bodyRules[0];
  check('宽度用 var(--cav-size)', Boolean(only) && only.body.includes('--cav-size'));
  check('高度也用 var(--cav-size)', Boolean(only) && /height:\s*var\(--cav-size/.test(only.body));
  check('flex: 0 0 auto（禁止被拉伸）', Boolean(only) && /flex:\s*0 0 auto/.test(only.body));
  check('box-sizing: border-box（尺寸含边框）', Boolean(only) && /box-sizing:\s*border-box/.test(only.body));

  // 子元素各自占位是正常设计，不该被当成重复
  const imgRule = rules.find((r) => r.sel.includes('.cav-avatar__img'));
  check('图片仍是 width:100%（撑满头像）', Boolean(imgRule) && /width:\s*100%/.test(imgRule.body));
}

console.log('\n[4] 行布局规则没被改动');
{
  const rowRule = rules.find((r) => r.sel === 'body[data-cav-on="on"] [data-cav-row]');
  check('行仍是 display: flex', Boolean(rowRule) && /display:\s*flex/.test(rowRule.body));
  const contentRule = rules.find((r) => r.sel.includes('[data-cav-row] > :not(.cav-avatar)'));
  check('内容区仍 flex: 1 1 auto', Boolean(contentRule) && /flex:\s*1 1 auto/.test(contentRule.body));
  check('内容区仍 min-width: 0', Boolean(contentRule) && /min-width:\s*0/.test(contentRule.body));
}

console.log('\n[5] 表格修复仍然在');
{
  const tableRule = rules.find((r) => /\.cav-bubbled :where\(\.md-table-wide\)/.test(r.sel));
  check('有 md-table-wide 归位规则', Boolean(tableRule));
  check('去掉负 margin-left', Boolean(tableRule) && /margin-left:\s*0/.test(tableRule.body));
  check('表格自己横向滚动', Boolean(tableRule) && /overflow-x:\s*auto/.test(tableRule.body));
}

console.log(`\n结果：通过 ${pass}，失败 ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
