# Under the Sun（朝闻天下）

An Obsidian RSS reader with a daily digest and AI discussion. Self-contained: no Python, no external service.

一个自带 RSS 抓取、日报和 AI 交流的 Obsidian 插件，不依赖 Python 或外部程序。

---

## 功能

- 读取多个 RSS / Atom 源
- 刷新后保留最近新闻，自动去重
- 一键生成当天的 RSS 日报（Markdown，带 Obsidian callout）
- 对任意一条新闻生成 AI 解读
- 在新闻下方直接进行 AI 交流
- 桌面、手机都可以用

## 安装

### 社区插件市场

在 Obsidian 的「第三方插件 → 浏览」里搜索 **Under the Sun** 安装，或直接打开 [市场页](https://community.obsidian.md/plugins/under-the-sun)。

### BRAT

1. 安装 BRAT
2. 添加仓库：`0xTack/obsidian-under-the-sun`
3. 启用 Under the Sun

### 手动安装

把以下文件放进：

```text
<vault>/.obsidian/plugins/under-the-sun/
```

需要的文件：

```text
manifest.json
main.js
styles.css
```

然后在 Obsidian 里启用插件。

## 第一次使用

1. 打开 `设置 → 第三方插件 → Under the Sun`
2. 在「RSS 地址」里一行填一个源，例如：

   ```text
   https://feeds.bbci.co.uk/zhongwen/simp/rss.xml
   https://www.ithome.com/rss/
   ```

3. 点「保存」
4. 回到插件主页，点「刷新 RSS」
5. 想留档就点「生成今日日报」，会在 `朝闻天下/RSS日报/YYYY-MM-DD.md` 生成一份 Markdown 日报

## AI 设置

在同一个设置页：

- 打开「启用 AI」
- 填 API 地址，默认 `https://api.deepseek.com/v1`
- 填模型，默认 `deepseek-flash`
- 填 API Key

Key 只保存在本机插件数据里，不写进笔记，也不会上传。

## 使用

### 刷新 RSS

主页点「刷新 RSS」。失败的源会在通知里提示，其他源仍然会更新。

### 生成日报

主页点「生成今日日报」。同一天重复生成会覆盖当天文件。

### AI 解读

每条新闻下方点「AI 解读」，结果直接显示在新闻下面。

### AI 交流

每条新闻下方点「AI 交流」，在新闻下方展开输入框，围绕这条新闻追问。对话只保存在当前会话，不写入笔记。

## 数据和隐私

- RSS 地址、AI 设置、新闻缓存都保存在插件自己的数据里
- 不发送遥测
- 不下载或执行外部代码
- 网络请求只发生在：刷新 RSS、调用你配置的 AI 接口

## 想要完整版

社区版保持轻量，只做 RSS + AI。需要热榜抓取、正文补全、跟踪时间线、判断簿和 macOS 定时任务，请使用完整版：

- 作品页：https://0xtack.github.io/TokenPeek/works.html
- 完整版仅支持 macOS；Windows 和其他系统请继续使用社区版。

## 限制

- 只支持 RSS / Atom，不抓取热榜
- 不做聚类、打分、跨天去重
- AI 需要你自己的 API Key
- 与完整版 `info-tracker` 不同：完整版才有热榜、跟踪时间线、判断簿和 Python 后端

## 开发

```bash
npm install
npm run build
```

构建产物是 `main.js`，和 `manifest.json`、`styles.css` 一起发布。

## 支持 / Sponsor

如果 Under the Sun 对你有帮助，可以请作者喝杯咖啡：

- 爱发电：<https://afdian.com/a/tack123/plan>

支持完全自愿，不影响插件的任何功能。

## License

MIT
