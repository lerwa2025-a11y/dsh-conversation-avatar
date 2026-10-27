/**
 * 验证「字体覆盖层」：界面字体打底 + 正文字体覆盖。
 *
 * 2026-10-25 修正：**没有「标题字体」开关**。
 * 查 app.asar 核实过三条链路都取同一个 --dsw-font-family：
 *   markdown h1..h6  → var(--dsw-font-family)
 *   markdown 正文     → var(--dsw-font-family)
 *   侧边栏标题        → 无自己的 font-family，继承 body
 * 所以「标题字体」等于界面字体，单独做一项没有意义，已从面板去掉。
 *
 * 用法：node 验证_字体覆盖层.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const CLIENT = join(here, '..', 'lib', 'client.js');
const HOST = join(here, '..', 'lib', 'index.js');

const src = readFileSync(CLIENT, 'utf8');
const host = readFileSync(HOST, 'utf8');

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

let pass = 0;
let fail = 0;
const check = (label, ok, detail = '') => {
  if (ok) { pass += 1; console.log(`  ✓ ${label}`); }
  else { fail += 1; console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`); }
};

const clamp = (v, lo, hi, fb) => {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fb;
  return Math.min(hi, Math.max(lo, Math.round(n)));
};
const fontStackOf = (v) => {
  if (typeof v !== 'string') return '';
  const s = v.trim().slice(0, 200);
  if (s === '') return '';
  return /^[\w\s\u4e00-\u9fa5\-,"'·]+$/.test(s) ? s : '';
};

const YAHEI = '"Microsoft YaHei", "微软雅黑", sans-serif';
const SONG = 'SimSun, "宋体", serif';
const KAI = 'KaiTi, "楷体", serif';

function render(settings) {
  // eslint-disable-next-line no-new-func
  const fn = new Function('clamp', 'fontStackOf', `
    ${buildCss}
    return buildFontCss;
  `)(clamp, fontStackOf);
  return fn(settings);
}

const base = {
  fontFamily: '', fontMono: '', bodyFont: '', headingFont: '',
  fontSizeDelta: 0, headingSizeDelta: 0, lineHeightDelta: 0, fontWeight: 0,
};

console.log('\n[1] 全空 → 不产生任何 CSS');
{
  const css = render(base);
  check('返回空串', css === '', JSON.stringify(css));
}

console.log('\n[2] 只设界面字体 → 只出界面那条');
{
  const css = render({ ...base, fontFamily: YAHEI });
  check('含 --dsw-font-family', css.includes('--dsw-font-family:' + YAHEI));
  check('不含正文字体覆盖规则', !css.includes('[class*="_markdown_" i]{font-family'));
}

console.log('\n[3] 只设正文字体 → 正文换、界面不变');
{
  const css = render({ ...base, fontFamily: YAHEI, bodyFont: SONG });
  check('正文容器被设为宋体', css.includes('[class*="_markdown_" i]{font-family:' + SONG));
  check('界面字体仍是雅黑', css.includes('--dsw-font-family:' + YAHEI));
  check('正文规则用 !important（要压过容器自身声明）',
    css.includes('[class*="_markdown_" i]{font-family:' + SONG + ' !important}'));
}

console.log('\n[4] 面板不再提供「标题字体」（侧边栏标题 = 界面字体）');
{
  check('面板没有「标题字体」这一项', !src.includes("label: '标题字体'"));
  check('不再渲染 headingFont 下拉框', !src.includes('headingFontOf()'));
  // 字段本身保留，老配置不报错
  check('数据字段 headingFont 仍保留', /headingFont:\s*''/.test(src) && /headingFont:/.test(host));
  check('buildFontCss 仍尊重残留的 headingFont 值', buildCss.includes('s.headingFont'));
}

console.log('\n[5] 侧边栏标题必须跟随界面字体（这是去掉标题字体的依据）');
{
  /*
   * 静态核对：界面字体那条规则写的是 --dsw-font-family + body{font-family}，
   * 而侧边栏标题没有自己的 font-family ⇒ 继承 body ⇒ 等于界面字体。
   * 这里断言界面规则确实包含 body{font-family}，这是「侧边栏标题能生效」的前提。
   */
  const css = render({ ...base, fontFamily: YAHEI });
  check('界面字体同时写 body{font-family}（侧边栏标题靠它继承）',
    css.includes('body{font-family:' + YAHEI + ' !important}'));
  check('界面字体也写 --dsw-font-family（markdown 令牌靠它）',
    css.includes('--dsw-font-family:' + YAHEI));
}

console.log('\n[6] 覆盖层不动其他功能');
{
  const css = render({ ...base, bodyFont: SONG });
  check('不产生字号规则', !css.includes('--dsh-content-font-size'));
  check('不产生代码字体规则', !css.includes('--ds-font-family-code'));
  check('不产生加粗规则', !css.includes('font-weight'));
}

console.log('\n[7] 用户消息也要跟着正文字体走');
{
  const css = render({ ...base, bodyFont: SONG });
  check('有用户气泡的覆盖规则', css.includes('bubble'));
  check('该规则限定在 data-cav-row 内', css.includes('[data-cav-row]'));
}

console.log('\n[8] 设置项端到端');
{
  check('服务端默认 bodyFont', /bodyFont:\s*''/.test(host));
  check('服务端净化 bodyFont', /bodyFont:[^\n]*fontStackOrEmpty/.test(host));
  check('客户端默认 bodyFont', /bodyFont:\s*''/.test(src));
  check('客户端净化 bodyFont', /bodyFont:[^\n]*fontStackOf/.test(src));
  check('有 bodyFontOf()', src.includes('bodyFontOf'));
  check('面板有「正文字体」', src.includes("label: '正文字体'"));
  check('面板选项写「跟随界面字体」', src.includes('跟随界面字体'));
}

console.log('\n[9] 字体值仍做注入过滤');
{
  check('含分号的被拒绝', fontStackOf('Arial; color:red') === '');
  check('含右花括号的被拒绝', fontStackOf('Arial}') === '');
  check('含圆括号的被拒绝', fontStackOf('Arial(') === '');
  check('正常字体名通过', fontStackOf(YAHEI) === YAHEI);
  const css = render({ ...base, bodyFont: 'Arial; }body{display:none' });
  check('危险值进不了 CSS', !css.includes('display:none'), css);
}

console.log(`\n结果：通过 ${pass}，失败 ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
