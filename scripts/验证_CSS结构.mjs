/**
 * 用浏览器自带的 CSS 解析器校验气泡那段 CSS 是否真的能被解析。
 * 不连浏览器：用 Node 里的最小 DOM 跑不了 CSSOM，所以这里做一个
 * 「括号/引号配平 + 关键声明可解析」的结构检查，并列出所有气泡规则。
 */
import { readFileSync } from 'node:fs';

const f = 'E:/AGENT/DSH/dsh-home/plugins-src/dsh-conversation-avatar/lib/client.js';
const src = readFileSync(f, 'utf8');

const start = src.indexOf('const STYLES = `');
const from = src.indexOf('`', start) + 1;
const end = src.indexOf('\n`;', from);
let css = src.slice(from, end);

// 把 ${...} 模板占位替换成已知类名，便于分析
css = css.replace(/\$\{BUBBLE_CLASS\}/g, 'cav-bubbled')
         .replace(/\$\{AVATAR_NODE_CLASS\}/g, 'cav-avatar')
         .replace(/\$\{AVATAR_ATTR\}/g, 'data-cav-on')
         .replace(/\$\{AVATAR_ROW_ATTR\}/g, 'data-cav-row')
         .replace(/\$\{VAR_SIZE\}/g, '--cav-size')
         .replace(/\$\{VAR_ROUND\}/g, '--cav-round');

let pass = 0;
let fail = 0;
const check = (label, ok, detail = '') => {
  if (ok) { pass += 1; console.log(`  ✓ ${label}`); }
  else { fail += 1; console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`); }
};

console.log('\n[A] 结构配平');
{
  const open = (css.match(/\{/g) ?? []).length;
  const close = (css.match(/\}/g) ?? []).length;
  check(`花括号配平（{ ${open} / } ${close}）`, open === close);
  const parenOpen = (css.match(/\(/g) ?? []).length;
  const parenClose = (css.match(/\)/g) ?? []).length;
  check(`圆括号配平（( ${parenOpen} / ) ${parenClose}）`, parenOpen === parenClose);
  check('没有未闭合的注释', (css.match(/\/\*/g) ?? []).length === (css.match(/\*\//g) ?? []).length);
}

console.log('\n[B] 气泡相关规则全文');
{
  // 抽出所有含 cav-bubbled 的规则块
  const blocks = [];
  const re = /([^{}]*cav-bubbled[^{}]*)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css)) !== null) blocks.push({ sel: m[1].trim(), body: m[2].trim() });
  console.log(`  共 ${blocks.length} 条规则：`);
  for (const b of blocks) {
    console.log(`  · ${b.sel}`);
    for (const decl of b.body.split(';').map((s) => s.trim()).filter(Boolean)) {
      console.log(`      ${decl}`);
    }
  }
  /*
   * 条数只做「别太多别太少」的粗筛，不是精确断言。
   * v0.3.3 加了一组「防溢出」兜底规则（子元素限宽、媒体限宽、表格压回 100%），
   * 条数从 6 涨到 10 是预期的，所以上限放宽到 14。
   */
  check('气泡规则数量在预期范围内（6–14 条）',
    blocks.length >= 6 && blocks.length <= 14, String(blocks.length));
}

console.log('\n[C] 关键声明逐条存在');
{
  const findBlock = (sel) => {
    const re = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^{}]*)\\}');
    const m = css.match(re);
    return m ? m[1] : '';
  };
  const main = findBlock('.cav-bubbled');
  const before = findBlock('.cav-bubbled::before');
  const after = findBlock('.cav-bubbled::after');

  check('主规则有 position: relative', /position:\s*relative/.test(main));
  check('主规则有 isolation: isolate', /isolation:\s*isolate/.test(main));
  check('主规则不包含 backdrop-filter', !/backdrop-filter/.test(main));
  check('主规则不包含 overflow: hidden', !/overflow/.test(main));

  check('::before 有 z-index: -1', /z-index:\s*-1/.test(before));
  check('::before 有 inset: 0', /inset:\s*0/.test(before));
  check('::before 有 pointer-events: none', /pointer-events:\s*none/.test(before));
  check('::before 有 blur 磨砂', /backdrop-filter:\s*blur\(/.test(before));
  check('::before 有 -webkit- 前缀', /-webkit-backdrop-filter/.test(before));

  check('::after 有 z-index: -1（不压文字）', /z-index:\s*-1/.test(after));
  check('::after 有 pointer-events: none', /pointer-events:\s*none/.test(after));
}

console.log('\n[D] color-mix 表达式可解析');
{
  /*
   * 按「从 color-mix( 起数括号」的方式逐个配平，不能用正则截取
   * —— 这些声明是多行的，正则会在换行处把括号截断（这个误报踩过一次）。
   */
  const mixes = [];
  let i = -1;
  while ((i = css.indexOf('color-mix(', i + 1)) !== -1) {
    let depth = 0;
    for (let j = i + 'color-mix'.length; j < css.length; j += 1) {
      if (css[j] === '(') depth += 1;
      else if (css[j] === ')') {
        depth -= 1;
        if (depth === 0) { mixes.push(css.slice(i, j + 1)); break; }
      }
    }
  }
  console.log(`  共 ${mixes.length} 处 color-mix`);
  let bad = 0;
  for (const mix of mixes) {
    const opens = (mix.match(/\(/g) ?? []).length;
    const closes = (mix.match(/\)/g) ?? []).length;
    if (opens !== closes) { bad += 1; console.log(`    ✗ 配平失败: ${mix.slice(0, 90)}`); }
  }
  check('所有 color-mix 括号配平', bad === 0 && mixes.length > 0, `${bad} 处异常 / 共 ${mixes.length} 处`);
  check('alpha 用 calc(var(...) * 1%) 形式', /calc\(var\(--cav-bubble-alpha[^)]*\)\s*\*\s*1%\)/.test(css));
}

console.log('\n[E] 没有残留会导致文字被盖的旧规则');
{
  // 先剥掉注释再判断，否则注释里那句「旧规则 .cav-bubbled > * 已删除」会被误判
  const decls = css.replace(/\/\*[\s\S]*?\*\//g, '');

  /*
   * 这里真正要防的是历史上那条「把直接子元素抬到 z-index:1」的旧规则 ——
   * 它只保护直接子元素，深层文字仍会被背景层盖住（v0.2.x 的重大 bug）。
   *
   * ⚠️ 2026-10-25 修：旧断言是「只要存在 .cav-bubbled > * 规则就失败」，
   *    太粗。v0.3.3 起有意加了 `.cav-bubbled > * { max-width:100%; min-width:0 }`
   *    用于防止内容撑破气泡，这是**宽度**约束，与层叠无关，不该被判为残留。
   *    正确判据：这条规则里不得出现 position / z-index。
   */
  const childRules = [...decls.matchAll(/\.cav-bubbled\s*>\s*\*\s*\{([^}]*)\}/g)]
    .map((m) => m[1]);
  check('不存在「抬 z-index」的 .cav-bubbled > * 规则',
    childRules.every((b) => !/position|z-index/.test(b)),
    childRules.join(' | '));
  check('若存在 .cav-bubbled > * 规则，它只做宽度约束',
    childRules.length === 0 || childRules.every((b) => /max-width|min-width/.test(b)),
    childRules.join(' | '));
  check('不存在 z-index: 0 的气泡背景', !/cav-bubbled::before\s*\{[^}]*z-index:\s*0/.test(decls));
}

console.log(`\n结果：通过 ${pass}，失败 ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
