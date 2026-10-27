/**
 * 验证「字体」功能（从 dsh-fonttune 移植的精简版）。
 *
 * 四个能力：界面字体 / 代码字体 / 正文字号 / 标题字号 / 行距 / 加粗。
 * 重点验证：
 *   ① 字号分离是真的分离（正文与标题走不同变量）
 *   ② 字体值做了注入过滤（这个值会被拼进 CSS，必须挡住 ; { } 之类）
 *   ③ 全部是「相对偏移」，0 = 不动主题
 *   ④ 不破坏前面修好的东西（头像/气泡/字色）
 *
 * 用法：node 验证_字体功能.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const CLIENT = join(here, '..', 'lib', 'client.js');
const HOST = join(here, '..', 'lib', 'index.js');

const src = readFileSync(CLIENT, 'utf8');
const host = readFileSync(HOST, 'utf8');

/** 取出 buildFontCss 的源码体做静态分析。 */
function sliceFunction(name, text) {
  const start = text.indexOf(`function ${name}`);
  if (start < 0) throw new Error(`找不到 ${name}`);
  const brace = text.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  throw new Error(`${name} 未配平`);
}
const buildCss = sliceFunction('buildFontCss', src);
const syncFn = sliceFunction('syncFontStyle', src);

let pass = 0;
let fail = 0;
const check = (label, ok, detail = '') => {
  if (ok) { pass += 1; console.log(`  ✓ ${label}`); }
  else { fail += 1; console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`); }
};

console.log('\n[1] 正文字号与标题字号是真的分开');
{
  check('正文用 --dsh-content-font-size', buildCss.includes('--dsh-content-font-size:calc(14px'));
  check('标题用 --dsh-content-font-delta', buildCss.includes('--dsh-content-font-delta:'));
  // 两者必须是不同变量，否则等于没分开
  const usesSize = buildCss.includes('--dsh-content-font-size');
  const usesDelta = buildCss.includes('--dsh-content-font-delta:');
  check('两个变量互不相同（真的分离了）', usesSize && usesDelta);
  check('正文偏移读 fontSizeDelta', buildCss.includes('s.fontSizeDelta'));
  check('标题偏移读 headingSizeDelta', buildCss.includes('s.headingSizeDelta'));
  check('两个偏移量没有互相引用',
    !buildCss.includes('fontSizeDelta ?? s.headingSizeDelta')
    && !buildCss.includes('headingSizeDelta ?? s.fontSizeDelta'));
}

console.log('\n[2] 字体值做了注入过滤');
{
  // 服务端与客户端都要过滤
  check('服务端有 fontStackOrEmpty', /function fontStackOrEmpty/.test(host));
  check('服务端挡掉 ; { } ( )', /\[\\w\\s\\u4e00-\\u9fa5/.test(host) || host.includes("\\\\w\\\\s\\\\u4e00-\\\\u9fa5"));
  check('客户端有 fontStackOf', /const fontStackOf = /.test(src));
  check('客户端同样有字符白名单', /\\u4e00-\\u9fa5/.test(src));
  check('拼接进 CSS 前经过 fontStackOf', buildCss.includes('fontStackOf('));
  // 关键：不能直接把 settings 值拼进 CSS
  check('没有裸拼 settings.fontFamily', !buildCss.includes('+ s.fontFamily +'));
  check('没有裸拼 settings.fontMono', !buildCss.includes('+ s.fontMono +'));
}

console.log('\n[3] 全部是相对偏移，0 = 不改主题');
{
  check('字号 0 时不输出规则', /if \(sizeDelta !== 0\)/.test(buildCss));
  check('标题 0 时不输出规则', /if \(headDelta !== 0\)/.test(buildCss));
  check('行距 0 时不输出规则', /if \(lineDelta !== 0\)/.test(buildCss));
  check('加粗 0 时不输出规则', /if \(weight > 0\)/.test(buildCss));
  check('字体空串时不输出规则', /if \(family\)/.test(buildCss) && /if \(mono\)/.test(buildCss));
  check('全部为空时返回空串（等于不改）', buildCss.includes("return decls.join"));
}

console.log('\n[4] 加粗不压平标题层次');
{
  // 只给段落级元素加粗，不能用通配符
  check('加粗只针对段落级元素', /:where\(p,li,td,th,blockquote\)/.test(buildCss));
  check('加粗不用通配符', !/markdown_"? i\]\s*\*\s*\{font-weight/.test(buildCss));
  /*
   * 「不给标题设字重」要看**加粗那一条 push 语句本身**，不能看整段源码：
   *  · 注释里提到 h1..h6（解释为什么不能压平它们）会误判；
   *  · v0.3.1 起这段后面还跟着「标题字体」覆盖层，也含 h1..h6，更会误判；
   *  · 行距那条也是 `[class*="_markdown_" i]` 开头，只按前缀会抓错。
   * 所以锚定「行内带 font-weight 的那条 push」，用 [\s\S] 跨行。
   */
  const weightPush = buildCss.match(/decls\.push\(\s*'\[class\*="_markdown_" i\] :where\(p,li,td,th,blockquote\)'[\s\S]*?;/);
  check('找到了加粗那条 push', Boolean(weightPush),
    buildCss.slice(buildCss.indexOf('weight > 0'), buildCss.indexOf('weight > 0') + 300));
  const pushed = weightPush ? weightPush[0] : '';
  check('加粗规则不含 h1..h6 选择器', !/\bh[1-6]\b/.test(pushed), pushed.slice(0, 200));
  check('加粗规则带上了 weight 变量', pushed.includes('weight'));
}

console.log('\n[5] 必须 !important（主题内联写在 body 上）');
{
  /*
   * 字号那条是跨行拼接的，正则要允许换行与字符串拼接，
   * 所以先去掉换行和多余空格再做匹配。
   */
  const flat = buildCss.replace(/\s+/g, ' ');
  check('字号规则带 !important', /--dsh-content-font-size:calc\(14px \+[^)]*\)[^}]*!important/.test(flat),
    flat.slice(flat.indexOf('--dsh-content-font-size'), flat.indexOf('--dsh-content-font-size') + 150));
  check('字体变量带 !important', /--dsw-font-family:[^}]*!important/.test(flat));
  check('代码字体带 !important', /--ds-font-family-code:[^}]*!important/.test(flat));
  check('标题 delta 带 !important', /--dsh-content-font-delta:[^}]*!important/.test(flat));
}

console.log('\n[6] 注入与清理');
{
  check('有独立的 style 节点 id', src.includes("FONT_STYLE_ID = 'cav-font-style'"));
  check('syncFontStyle 会更新已有节点', /node\.textContent !== css/.test(syncFn));
  check('空设置时移除节点', /if \(css === ''\)[\s\S]{0,80}\.remove\(\)/.test(syncFn));
  check('有 clearFontStyle', /function clearFontStyle/.test(src));
  check('关插件时清理字体', src.includes('clearFontStyle()'));
  check('每次设置变化都会重算', src.includes('syncFontStyle()'));
}

console.log('\n[7] 字体清单只列本机有的');
{
  check('有 FONT_FAMILIES 常量', src.includes('const FONT_FAMILIES ='));
  check('有 MONO_FAMILIES 常量', src.includes('const MONO_FAMILIES ='));
  check('第一项是「主题默认」空值', /label: '主题默认', value: ''/.test(src));
  for (const fam of ['Microsoft YaHei', 'Noto Sans SC', 'SimSun', 'KaiTi', 'FangSong']) {
    check(`清单含 ${fam}`, src.includes(fam));
  }
  // 不该出现本机没有的（只看实际清单，注释里提到它们是解释原因，不算）
  const listBlock = src.slice(
    src.indexOf('const FONT_FAMILIES ='),
    src.indexOf('const MONO_FAMILIES ='),
  ).replace(/\/\*[\s\S]*?\*\//g, '');
  for (const absent of ['PingFang SC', 'Sarasa Gothic', 'Hiragino']) {
    check(`清单不含本机没装的 ${absent}`, !listBlock.includes(absent),
      listBlock.slice(0, 200));
  }
  check('每个字体值都以 generic family 兜底',
    (listBlock.match(/sans-serif'|serif'|monospace'/g) ?? []).length >= 5);
}

console.log('\n[8] 设置项端到端');
{
  for (const field of ['fontFamily', 'fontMono', 'fontSizeDelta', 'headingSizeDelta', 'lineHeightDelta', 'fontWeight']) {
    check(`服务端有默认值 ${field}`, new RegExp(`${field}:\\s*(0|'')`).test(host));
    check(`客户端有默认值 ${field}`, new RegExp(`${field}:\\s*(0|'')`).test(src));
  }
  check('服务端净化 fontSizeDelta 范围', /fontSizeDelta:\s*offsetOrZero\([^)]*-4,\s*8\)/.test(host));
  check('服务端净化 headingSizeDelta 范围', /headingSizeDelta:\s*offsetOrZero\([^)]*-6,\s*12\)/.test(host));
  check('面板有「界面字体」', src.includes("label: '界面字体'"));
  check('面板有「代码字体」', src.includes("label: '代码字体'"));
  check('面板有「正文字号」', src.includes("label: '正文字号'"));
  check('面板有「标题字号」', src.includes("label: '标题字号'"));
  check('面板有「行距」', src.includes("label: '行距'"));
  check('面板有「正文加粗」', src.includes("label: '正文加粗'"));
}

console.log('\n[9] 不破坏前面修好的东西');
{
  function stylesBlock(text) {
    const start = text.indexOf('const STYLES = `');
    const from = text.indexOf('`', start) + 1;
    const end = text.indexOf('\n`;', from);
    /*
     * ⚠️ 必须把模板占位符替换成真实类名，否则选择器里还是
     * `.${AVATAR_NODE_CLASS}` 这种字面量，所有按类名的断言都会失效
     * —— 这个坑踩过一次（头像宽度检查因此误报）。
     */
    return text.slice(from, end)
      .replace(/\$\{BUBBLE_CLASS\}/g, 'cav-bubbled')
      .replace(/\$\{AVATAR_NODE_CLASS\}/g, 'cav-avatar')
      .replace(/\$\{AVATAR_ATTR\}/g, 'data-cav-on')
      .replace(/\$\{AVATAR_ROW_ATTR\}/g, 'data-cav-row')
      .replace(/\$\{VAR_SIZE\}/g, '--cav-size')
      .replace(/\$\{VAR_ROUND\}/g, '--cav-round');
  }
  const css = stylesBlock(src).replace(/\/\*[\s\S]*?\*\//g, '');
  check('气泡主规则仍无 width 类属性',
    !/\.cav-bubbled\s*\{[^}]*max-width/.test(css) && !/\.cav-bubbled\s*\{[^}]*min-width/.test(css));
  check('气泡层叠仍正确', /::before\s*\{[^}]*z-index:\s*-1/.test(css));
  check('磨砂仍在', /backdrop-filter:\s*blur\(/.test(css));
  check('两个字色变量都还在', css.includes('--cav-text-color') && css.includes('--cav-user-text-color'));
  check('头像尺寸仍只有一个来源', (() => {
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    /*
     * 选择器必须**就是** .cav-avatar（不做前缀匹配），否则
     * `.cav-avatar__img` 这种 BEM 修饰符会被误算成「又一条头像宽度」。
     * 用 `^\.cav-avatar($|\s|[>{])` 精确锚定。
     */
    const body = rules.filter((m) => {
      const sel = m[1].trim();
      return /^\.cav-avatar(\s*$|\s*[>{])/.test(sel) && /(^|[\s;])width\s*:/.test(m[2]);
    });
    return body.length === 1;
  })());
}

console.log(`\n结果：通过 ${pass}，失败 ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
