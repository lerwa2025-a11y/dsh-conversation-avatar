/**
 * 验证气泡框的层叠修复 + 磨砂。
 *
 * 核心要防的 bug（2026-10-24 修过）：
 *   旧 CSS 用「伪元素 z-index:0 + 直接把子元素抬到 z-index:1」，
 *   但 `> *` 只覆盖直接子元素，更深的文字会被不透明度高的底色盖死。
 *
 * 用法：node 验证_气泡层叠与磨砂.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const CLIENT = join(here, '..', 'lib', 'client.js');
const HOST = join(here, '..', 'lib', 'index.js');

const src = readFileSync(CLIENT, 'utf8');
const host = readFileSync(HOST, 'utf8');

/** 取 CSS 模板字符串（从 `const STYLES = \`` 到结尾反引号）。 */
function stylesBlock(text) {
  const start = text.indexOf('const STYLES = `');
  if (start < 0) throw new Error('找不到 STYLES');
  const from = text.indexOf('`', start) + 1;
  const end = text.indexOf('\n`;', from);
  return text.slice(from, end);
}

const css = stylesBlock(src);

/** 只取气泡相关的规则块。 */
function bubbleRules(text) {
  return text.split('\n').filter((line) => /cav-bubbled|BUBBLE_CLASS/.test(line)).join('\n');
}
const bubble = bubbleRules(css);

let pass = 0;
let fail = 0;
const check = (label, ok, detail = '') => {
  if (ok) { pass += 1; console.log(`  ✓ ${label}`); }
  else { fail += 1; console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`); }
};

console.log('\n[1] 层叠修复：背景层必须压在所有后代之下');
{
  check('气泡自建层叠上下文（isolation: isolate）', /isolation:\s*isolate/.test(css));
  const before = css.slice(css.indexOf('::before'), css.indexOf('::before') + 700);
  check('背景伪元素用 z-index: -1', /z-index:\s*-1/.test(before),
    before.slice(0, 200));
  check('背景伪元素不再用 z-index: 0', !/z-index:\s*0\s*;/.test(before));
  check('旧的「直接子元素抬到 z-index:1」规则已删除',
    !/BUBBLE_CLASS\}\s*>\s*\*\s*\{[^}]*z-index:\s*1/.test(css)
    && !css.includes('> * { position: relative; z-index: 1; }'));
}

console.log('\n[2] 磨砂实现正确性');
{
  check('有 backdrop-filter', /backdrop-filter:\s*blur\(/.test(css));
  check('带 -webkit- 前缀（兼容旧 Chromium/Electron）', /-webkit-backdrop-filter:\s*blur\(/.test(css));
  check('磨砂半径走变量 --cav-bubble-blur', css.includes('--cav-bubble-blur'));
  /*
   * 关键：backdrop-filter 只能出现在 ::before 上。
   * 如果出现在 .cav-bubbled 本身，元素会成为包含块，历史上导致整段会话不渲染。
   */
  const mainRuleStart = css.indexOf(`.${'${BUBBLE_CLASS}'} {`);
  check('磨砂不在 .cav-bubbled 主规则上（否则会改定位上下文）',
    !/backdrop-filter/.test(css.slice(mainRuleStart, css.indexOf('::before', mainRuleStart))));
  check('磨砂只加在伪元素上', /::before[\s\S]{0,400}backdrop-filter/.test(css));
  check('加了 saturate 让磨砂不显脏', /saturate\(1\.35\)/.test(css));
}

console.log('\n[3] 磨砂设置项端到端');
{
  check('客户端有默认值 bubbleBlur: 10', /bubbleBlur:\s*10/.test(src));
  check('客户端有 bubbleBlurOf()', src.includes('bubbleBlurOf'));
  check('客户端净化取值 0–30', /bubbleBlur:\s*clamp\([^)]*0,\s*30,\s*10\)/.test(src));
  check('服务端默认值也有 bubbleBlur: 10', /bubbleBlur:\s*10/.test(host));
  check('服务端净化 0–30', /bubbleBlur:\s*clampNum\([^)]*0,\s*30,\s*10\)/.test(host));
  check('写入 DOM 变量', src.includes("setProperty('--cav-bubble-blur'"));
  check('关闭插件时清理该变量', src.includes("removeProperty('--cav-bubble-blur')"));
  check('设置面板有滑杆（min 0 max 30）',
    /min:\s*0,\s*max:\s*30, step 1|min: 0, max: 30, step: 1/.test(src));
}

console.log('\n[4] 文字永不被盖：不依赖内容结构的兜底');
{
  /*
   * 真正的保证来自两点：
   *   ① isolation 把 -1 关在气泡内；
   *   ② 背景是 -1，而正常流内容在 z-index:auto（> -1）。
   * 所以无论文字嵌套多深都在背景之上。这里断言这两点同时成立。
   */
  check('两点同时成立（isolation + 背景 -1）',
    /isolation:\s*isolate/.test(css) && /z-index:\s*-1/.test(css));
  /*
   * 这里要断言的是「气泡本体没有被设 overflow 裁切」，因为裁切会切掉
   * 圆角外的磨砂边缘和内描边。
   *
   * ⚠️ 2026-10-25 修：旧写法用 /overflow/ 裸匹配，会把 v0.3.3 新增的
   *    `overflow-wrap: anywhere`（文字换行属性，与裁切无关）误判成
   *    overflow:hidden。必须只认真正的 `overflow` / `overflow-x` / `overflow-y` 声明。
   */
  const bubbleMain = css.match(/\.\$\{BUBBLE_CLASS\}\s*\{([^}]*)\}/);
  const mainBody = bubbleMain ? bubbleMain[1] : '';
  check('气泡本体没有 overflow 裁切声明',
    !/(^|[\s;])overflow(-x|-y)?\s*:/.test(mainBody), mainBody.replace(/\s+/g, ' '));
  check('气泡本体允许长词断行（overflow-wrap）',
    /overflow-wrap:\s*anywhere/.test(
      (css.match(/\.\$\{BUBBLE_CLASS\}\s*\{([^}]*)\}/g) ?? []).join(''),
    ));
}

console.log('\n[5] 高不透明度下的可读性兜底');
{
  check('alpha 接近满时只有背景变实，不影响文字层', /calc\(var\(--cav-bubble-alpha/.test(css));
  check('保留了 color-mix 半透明混合', css.includes('color-mix(in srgb'));
}

console.log(`\n结果：通过 ${pass}，失败 ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
