/**
 * 回归验证 2026-10-25 两个 bug：
 *   ① 正文字色不生效（宿主在 .v5IAXa_root 上写死了 color，截断继承）
 *   ② 宽表格跑到气泡框外面（宿主的 md-table-wide 故意向外撑）
 *
 * 用法：node 验证_字色与宽度.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const CLIENT = join(here, '..', 'lib', 'client.js');
const src = readFileSync(CLIENT, 'utf8');

function stylesBlock(text) {
  const start = text.indexOf('const STYLES = `');
  const from = text.indexOf('`', start) + 1;
  const end = text.indexOf('\n`;', from);
  return text.slice(from, end)
    .replace(/\$\{BUBBLE_CLASS\}/g, 'cav-bubbled')
    .replace(/\$\{AVATAR_NODE_CLASS\}/g, 'cav-avatar')
    .replace(/\$\{AVATAR_ATTR\}/g, 'data-cav-on')
    .replace(/\$\{AVATAR_ROW_ATTR\}/g, 'data-cav-row');
}
const css = stylesBlock(src);
const decls = css.replace(/\/\*[\s\S]*?\*\//g, '');

let pass = 0;
let fail = 0;
const check = (label, ok, detail = '') => {
  if (ok) { pass += 1; console.log(`  ✓ ${label}`); }
  else { fail += 1; console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`); }
};

console.log('\n[1] 字色要下发到整棵子树（穿透宿主写死的 color）');
{
  /*
   * 宿主的 .v5IAXa_root 有 `color: var(--dsw-alias-label-primary)` 显式声明，
   * 只设在直接子元素上会被截断 ⇒ 文字不变色。必须有通配到后代的规则。
   */
  const wildcardRule = decls.match(/body\[data-cav-on="on"\]\s*\[data-cav-row="ai"\]\s*\*:not\(([\s\S]*?)\)\s*\{([^}]*)\}/);
  check('存在「行内所有后代」的字色规则', Boolean(wildcardRule), '没找到 * :not(...) 规则');
  check('该规则设置了 --cav-text-color', wildcardRule ? wildcardRule[2].includes('--cav-text-color') : false);

  // 排除清单必须覆盖会导致误伤的类别
  const excludeList = wildcardRule ? wildcardRule[1] : '';
  check('排除 pre 及其后代', /pre, pre \*/.test(excludeList));
  check('排除 code 及其后代（shiki token）', /code, code \*/.test(excludeList));
  check('排除思考区', excludeList.includes('[data-chat-group-part="reasoning"]'));
  check('排除工具调用', excludeList.includes('[data-chat-flow-kind="turn-process"]'));
  check('排除工具卡片', excludeList.includes('[data-chat-call-id]'));
}

console.log('\n[2] 不再残留会造成特异性冲突的「事后复原」规则');
{
  // 2026-10-25 之前的写法是改完再复原，会与 :not 版本打架
  check('没有旧的「代码复原」规则',
    !/:where\(pre, code, kbd, samp\)\s*\{[\s\S]{0,120}?--dsw-alias-label-primary/.test(decls));
  check('没有旧的「思考区复原」规则',
    !/:where\(\s*\[data-chat-group-part="reasoning"\][\s\S]{0,300}?\}[\s\S]{0,80}?--dsw-alias-label-primary/.test(decls));
}

console.log('\n[3] 宽表格必须回到气泡内');
{
  const tableRule = decls.match(/\.cav-bubbled\s+:where\(\.md-table-wide\)\s*\{([^}]*)\}/);
  check('有 md-table-wide 的归位规则', Boolean(tableRule), '没找到');
  const body = tableRule ? tableRule[1] : '';
  check('宽度改回 100%', /width:\s*100%\s*!important/.test(body));
  check('最大宽度 100%', /max-width:\s*100%\s*!important/.test(body));
  check('清掉负 margin-left（宿主向外撑的元凶）', /margin-left:\s*0\s*!important/.test(body));
  check('清掉 padding-left', /padding-left:\s*0\s*!important/.test(body));
  check('改为表格自己横向滚动', /overflow-x:\s*auto\s*!important/.test(body));
  check('用 !important 压过宿主更高的特异性',
    (body.match(/!important/g) ?? []).length >= 4);
}

console.log('\n[3b] 通用兜底：不止表格会溢出（2026-10-25 第二次修）');
{
  /*
   * 第一次只修了表格，用户反馈「还是盖不住」——因为溢出的是别的东西
   * （长代码块 / 长 URL / 公式 / 宽图）。所以要有覆盖面更广的规则。
   */
  check('所有直接子元素都限宽', /\.cav-bubbled\s*>\s*\*\s*\{[^}]*max-width:\s*100%/.test(decls));
  check('直接子元素也 min-width: 0（防最小内容宽度顶大）',
    /\.cav-bubbled\s*>\s*\*\s*\{[^}]*min-width:\s*0/.test(decls));

  // 会滚的块：必须同时有 max-width 和 overflow-x
  const scrollRule = decls.match(/\.cav-bubbled\s+:where\(\s*pre,[\s\S]*?\)\s*\{([^}]*)\}/);
  check('有 pre/table/公式等的滚动规则', Boolean(scrollRule), '没找到');
  const sb = scrollRule ? scrollRule[1] : '';
  check('该规则含 pre', /pre/.test(decls.slice(decls.indexOf('pre,'), decls.indexOf('pre,') + 200)));
  check('该规则含 table', /table/.test(sb) || decls.includes('table,'));
  check('该规则含 overflow-x: auto', /overflow-x:\s*auto/.test(sb), sb);
  check('该规则含 min-width: 0', /min-width:\s*0/.test(sb), sb);

  // 表格本体宽度必须压回 100%（宿主是 width:max-content）
  check('表格 width 被压回 100%',
    /\.cav-bubbled\s+:where\(table\)\s*\{[^}]*width:\s*100%/.test(decls));

  // 图片类只限宽，不改比例
  const mediaRule = decls.match(/\.cav-bubbled\s+:where\(img,[\s\S]*?\)\s*\{([^}]*)\}/);
  check('有图片/视频的限宽规则', Boolean(mediaRule));
  check('媒体元素带 height: auto（保持比例）',
    Boolean(mediaRule) && /height:\s*auto/.test(mediaRule[1]));

  // 长 URL 断行
  check('气泡内允许长词断行', /overflow-wrap:\s*anywhere/.test(decls));
}

console.log('\n[4] 气泡本体不写 width 类属性（否则会改坏同一行的头像）');
{
  const main = decls.match(/\.cav-bubbled\s*\{([^}]*)\}/);
  const body = main ? main[1] : '';
  /*
   * 2026-10-25 事故：这里原来有 max-width:100% / min-width:0，
   * 它们参与行 flex 的宽度计算，把同一行里的头像撑成一大块。
   * 气泡宽度本来就由行决定，不需要额外约束 ⇒ 断言这两条**不存在**。
   */
  check('没有 max-width（会连累头像）', !/max-width/.test(body), body.replace(/\s+/g, ' '));
  check('没有 min-width（会连累头像）', !/min-width/.test(body), body.replace(/\s+/g, ' '));
  check('没有 width', !/(^|[\s;])width\s*:/.test(body));
  check('没有 overflow: hidden（会裁掉磨砂边缘）', !/overflow\s*:\s*hidden/.test(body));
  check('仍保留 isolation', /isolation:\s*isolate/.test(body));
}

console.log('\n[5] 不破坏此前的修复');
{
  check('气泡层叠仍正确（::before 用 -1）',
    /cav-bubbled::before\s*\{[^}]*z-index:\s*-1/.test(decls));
  check('磨砂仍在（backdrop-filter）', /backdrop-filter:\s*blur\(/.test(decls));
  check('磨砂仍只加在伪元素', !/\.cav-bubbled\s*\{[^}]*backdrop-filter/.test(decls));
}

console.log('\n[6] 服务端 textColor 仍完整');
{
  const host = readFileSync(join(here, '..', 'lib', 'index.js'), 'utf8');
  check('默认值有 textColor', /textColor:\s*''/.test(host));
  check('净化逻辑有 textColor', /textColor:[^\n]*hexOrEmpty/.test(host));
  check('客户端取值有 textColorOf', src.includes('textColorOf'));
  check('写入 DOM 变量', src.includes("applyColorVar(b, '--cav-text-color'"));
}

console.log(`\n结果：通过 ${pass}，失败 ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
