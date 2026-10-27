/*
 * 验证「头像跟随画面」开关（v1.0）。
 *
 * 这个开关的行为只有两种状态：
 *   开（默认） → 头像贴住滚动区顶部跟着走（老行为，等于升级前）
 *   关         → 头像只固定在行首，往下翻时随行滚走，不跟着滑动
 *
 * 静态断言能查的是「代码路径是否齐全」（设置项、净化、面板控件、复位、置灰），
 * 真正「滚动时头像动不动」要靠实机，这里只把可自动化的部分钉住。
 *
 * 跑法：node "脚本\验证_跟随滚动开关.mjs"
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const clientPath = join(root, 'lib', 'client.js')
const indexPath = join(root, 'lib', 'index.js')
const pkgPath = join(root, 'package.json')

const client = readFileSync(clientPath, 'utf8')
const index = readFileSync(indexPath, 'utf8')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))

let pass = 0
let fail = 0
const check = (label, ok) => {
  if (ok) { pass += 1; console.log(`  ✓ ${label}`) }
  else { fail += 1; console.log(`  ✗ ${label}`) }
}

console.log('\n[1] 服务端：默认值与净化');
{
  check('DEFAULT_SETTINGS 里有 stickFollow', index.includes('stickFollow: true'))
  check('sanitizeSettings 净化 stickFollow', index.includes('stickFollow:'))
  check('只接受 boolean，非法值沿用 current',
    /stickFollow:\s*typeof plugin\.stickFollow === 'boolean'/.test(index))
  check('默认 true（升级前行为不变）',
    index.includes('stickFollow: true'))
}

console.log('\n[2] 客户端：取值与净化');
{
  check('有 stickFollowOf 取值函数', client.includes('const stickFollowOf ='))
  check('缺省视为开（!== false，而不是 === true）',
    client.includes('stickFollowOf = () => settings.plugin?.stickFollow !== false'))
  check('客户端净化同样只认 boolean',
    /stickFollow:\s*typeof pl\.stickFollow === 'boolean'/.test(client))
  check('客户端缺省也落在「开」',
    client.includes("current.plugin.stickFollow !== false"))
}

console.log('\n[3] 滚动逻辑：关掉时不算也不写');
{
  check('updateSticky 开头就短路', /if \(!stickFollowOf\(\)\) \{ resetSticky\(\); return; \}/.test(client))
  check('scheduleSticky 连 rAF 都不排',
    (client.match(/if \(!stickFollowOf\(\)\) \{ resetSticky\(\); return; \}/g) ?? []).length >= 2)
  check('有 resetSticky 复位函数', client.includes('function resetSticky()'))
  check('复位把 top 清零（不是删 style 留脏值）',
    /function resetSticky\(\)[\s\S]{0,300}wrap\.style\.top = '0px'/.test(client))
  check('复位是幂等的（先比再写）',
    /function resetSticky\(\)[\s\S]{0,300}if \(wrap\.style\.top !== '0px'\)/.test(client))
}

console.log('\n[4] 切开关立刻生效，不等下一次滚动');
{
  check('setLayerSync 里按当前状态二选一',
    /if \(stickFollowOf\(\)\) scheduleSticky\(\); else resetSticky\(\);/.test(client))
}

console.log('\n[5] 面板：控件在，且跟随关闭时吸顶滑杆置灰');
{
  check('面板有「头像跟随画面」这一行', client.includes('头像跟随画面'))
  check('文案说清关掉的效果', client.includes('关掉后头像只固定在消息开头，不再跟着滑动'))
  check('开关写回 plugin.stickFollow',
    client.includes('saveSettings({ plugin: { ...st.plugin, stickFollow: v } })'))
  check('吸顶滑杆在关闭时 disabled', client.includes('disabled: !stickFollowOf()'))
  check('关闭时提示先开跟随',
    client.includes('先打开「头像跟随画面」才有效'))
  check('吸顶滑杆原本的说明没被删（开着时仍显示）',
    client.includes('翻页时下滑几个身位，避开主题状态栏'))
  check('置灰滑杆有视觉样式', client.includes('.cav-range:disabled'))
}

console.log('\n[6] 版本号 1.0.0');
{
  check('package.json version = 1.0.0', pkg.version === '1.0.0')
  check('不是 0.x 了', !/^0\./.test(pkg.version))
}

console.log('\n[7] 未破坏既有功能');
{
  // 老功能点逐个确认还在（回归保护）
  check('吸顶下移取值仍在', client.includes('stickOffsetOf'))
  check('吸顶下移净化仍在', index.includes('stickOffset: clampNum'))
  check('STICK_TOP 常量仍在', client.includes('const STICK_TOP'))
  check('findScroller 仍在', client.includes('function findScroller'))
  check('气泡框逻辑没动', client.includes('const BUBBLE_CLASS'))
  check('字体覆盖层没动', client.includes('syncFontStyle'))
  check('思考行保护没动', client.includes('isProcessRow'))
  check('总开关仍在', client.includes('st.plugin.enabled'))
}

console.log('\n[8] 安全性：没有把用户值直接拼进 CSS');
{
  // stickFollow 只影响分支走向，不进 CSS 字符串
  const cssBlock = client.slice(client.indexOf('const STYLES = `'), client.indexOf('const STYLES = `') + 60000)
  const head = cssBlock.slice(0, cssBlock.indexOf('`;'))
  check('STYLES 里没有 stickFollow 插值', !head.includes('stickFollow'))
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
if (fail > 0) process.exitCode = 1
