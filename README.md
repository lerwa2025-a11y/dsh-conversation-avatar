# 头像和气泡框（dsh-conversation-avatar）

给 DSH 会话双方各配一张头像，消息左右分列（像好友聊天），并给 AI 的最终回复加气泡框。

从 **壁纸引擎插件（dsh-plugin-wallpaper-engine）** 的「自定义会话头像」扩展移植而来，
**只保留头像扩展本身** —— 不带壁纸、液态玻璃、字体、点击特效、拖尾、吉祥物等任何其它功能。

仓库地址：<https://github.com/lerwa2025-a11y/dsh-conversation-avatar>
原作者：**elysia395**（仓库 <https://github.com/elysia395/dsh-wallpaper-engine>），MIT 协议，特此致谢。

## 安装

> 名词解释：『profile（配置档）』= DSH 里一套独立的插件组合，你的插件装在哪个 profile 就只在那个 profile 生效。
> 名词解释：『本地安装（link）』= 让 DSH 直接指向你电脑上的这个文件夹，而不是从网上下载，方便随时改代码。

### 方式一：让 DSH 从本机文件夹加载（推荐，改代码即时生效）

在 DSH 界面里：**插件 → 添加插件 → 选择"从本地/文件夹安装"**，指向本文件夹即可。
安装后**重启 DSH**。

或在命令行执行（`web` 换成你的 profile 名，比如 `desktop`）：

```sh
dsh plugin --profile web add "本地文件夹的绝对路径"
```

### 方式二：从 GitHub 直接安装（另一台电脑最省事）

在 DSH 界面里：**插件 → 添加插件**，填入下面这个地址即可：

```
https://github.com/lerwa2025-a11y/dsh-conversation-avatar
```

因为仓库是公开的，DSH 会自动拉取源码装上。安装后**重启 DSH**。
> 注意：仓库必须公开才能这么装；私有仓库需要先在另一台电脑上登录 GitHub 账号。

### 方式三：打包成压缩包给别人

把本文件夹打包成 ZIP 发给对方，对方在 DSH 界面里用「导入」功能选择该 ZIP 即可。
导入后同样**需要重启 DSH**。

### 安装后

1. 重启 DSH
2. 打开 **设置 → 头像和气泡框**（即本插件的设置节）
3. 上传 AI 头像和你的头像，调好大小和圆角，把总开关打开

### 卸载

在 **插件** 页面里停用或删除本插件，重启 DSH。
停用后会移除界面上全部头像与气泡框，但**你上传的图片和设置会保留**。

## 功能

- **每个消息行都配头像**：user / steering 行在右侧，assistant-step 行在左侧。
  （与壁纸引擎一致；展开「已完成，用时…」过程区时里面的行也会各配一张。）
- **头像跟随滚动**：长回复往下滚时，头像贴着滚动区顶部跟着走；整条消息滚出去才随行消失。
- **吸顶下移**：翻页时头像下滑 N 个身位（默认 2），避开主题插件云母状态栏的遮挡。
- **AI 回复气泡框**：只给每轮**最终回复**套框；思考过程 / 工具区不套。可开关。
- **内置默认头像**：没导入图片时画 SVG（我方人像、助手四角星），跟随主题文字色。

## 设置

入口：**设置 → 头像**（`settings.section`，order 16）。

| 项 | 说明 |
|---|---|
| AI 头像 / 我的头像 | 上传、替换、清除（图片自动缩到 512px 内，存本机） |
| 头像大小 | 16–128 px |
| 圆角强度 | 0（直角）–100（正圆）% |
| AI 回复气泡框 | 开关，默认开 |
| 头像吸顶下移 | 0–6 个头像身位，默认 2 |
| 启用插件 | 总开关；关掉后移除全部头像与气泡，设置保留 |

## 存储

```
$DSH_HOME/dsh-conversation-avatar/
├── settings.json
└── avatars/
    ├── user-<stamp>.<ext>
    └── ai-<stamp>.<ext>
```

## 路由

- `GET    /dsh-conversation-avatar/avatar/<side>` → 头像字节（未导入 404）
- `POST   /dsh-conversation-avatar/avatar/<side>` → 导入
- `DELETE /dsh-conversation-avatar/avatar/<side>` → 清除
- `GET/POST /dsh-conversation-avatar/settings` → 读写设置

## 移植说明

装饰层逻辑（行选择器、注入标记、MutationObserver 早退、就地更新）取自壁纸引擎的
`src/avatar-layer.js`；默认头像 SVG 零件表取自同处。类名统一改为 `cav-*` 前缀，
数据目录与设置独立，避免与壁纸引擎冲突。

**注意**：不要同时启用本插件与壁纸引擎的「自定义会话头像」——两者都会往同一批
`[data-chat-flow-kind]` 行里插头像，会出现双重头像。
