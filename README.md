# Under the Sun（朝闻天下）

An Obsidian plugin for RSS, daily digests, AI discussion, and an optional local backend for hotlists, tracking and judgments.

一个 Obsidian 插件：不装后端时是轻量 RSS + AI + 日报；装了本地后端后解锁热榜、正文补全、聚类、跟踪时间线和判断簿。

---

## 两种模式

| 模式 | 需要后端 | 能做什么 |
|---|---|---|
| 简单模式 | 不需要 | RSS / Atom、日报、AI 解读、AI 交流、翻译、去重、阅读状态 |
| 完整模式 | 需要本地后端 | 热榜、正文补全、聚类、跟踪时间线、判断簿、07:00 / 19:00 定时任务 |

插件只有一个，安装一次即可。后端是可选服务，不会覆盖插件。

## 安装插件

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

## 简单模式

1. 打开 `设置 → 第三方插件 → Under the Sun`
2. 在「RSS 地址」里一行填一个源，例如：

   ```text
   https://feeds.bbci.co.uk/zhongwen/simp/rss.xml
   https://www.ithome.com/rss/
   ```

3. 可选：启用 AI，填 API 地址、模型、Key
4. 回到插件主页，点「刷新 RSS」
5. 想留档就点「生成今日日报」，会写到 `朝闻天下/RSS日报/YYYY-MM-DD.md`

简单模式的能力：

- 多个 RSS / Atom 源
- 按时间、摘要长度和标题做基础打分
- 链接和标题相似度去重
- 翻译非中文摘要
- 标记已读 / 未读
- AI 解读和 AI 交流

## 安装完整版后端（可选，macOS）

想要热榜、正文补全、聚类、跟踪和判断簿，需要安装本地后端。

1. 先安装并启用 `under-the-sun` 插件
2. 下载后端安装包：

   <https://0xtack.github.io/TokenPeek/under-the-sun/downloads/UnderTheSun-Backend-0.4.1-macOS.zip>

3. 解压后双击 `install-backend.command`
4. 安装器会：
   - 检查 Python 3.9+
   - 创建 venv 并安装依赖
   - 写入 vault 路径
   - 生成 token
   - 把后端地址和 token 写进插件配置
   - 安装 launchd 后台服务
5. 重启 Obsidian，插件会自动检测到后端

安装器**只装后端，不安装或覆盖插件**。

## 第一次使用完整模式

1. 打开插件主页
2. 如果显示「后端已连接」，点「抓取并出报」
3. 日报会写到 `朝闻天下/日报/YYYY-MM-DD.md`
4. 跟踪、判断簿、来源开关会出现在主页

## AI 设置

在设置页：

- 打开「启用 AI」
- 填 API 地址，默认 `https://api.deepseek.com/v1`
- 填模型，默认 `deepseek-flash`
- 填 API Key

Key 只保存在本机插件数据里，不写进笔记，也不会上传。

## 数据和隐私

- RSS 地址、AI 设置、新闻缓存保存在插件数据里
- AI 对话保存在 vault 的 `.同步数据/chats/`，跟着 vault 同步
- 后端只监听 `127.0.0.1`，带 token
- 不发送遥测
- 不下载或执行外部代码
- 网络请求只发生在：刷新 RSS、调用你配置的 AI 接口、翻译、本地后端

## 完整模式的后端更新

- 插件：Obsidian 市场自动更新
- 后端：插件发现版本旧了会提示，打开官网下载新安装包
- 安装器不会覆盖插件，插件更新也不会覆盖后端

## 限制

- 完整模式目前只提供 macOS 一键安装
- Windows / Linux 暂时只能用简单模式，或手动运行 Python 后端
- 手机端只能用简单模式
- 完整模式需要 Python 3.9+
- AI 需要你自己的 API Key

## 开发

```bash
npm install
npm run build
npm run lint
```

构建产物是 `main.js`，和 `manifest.json`、`styles.css` 一起发布。

## 支持 / Sponsor

如果 Under the Sun 对你有帮助，可以请作者喝杯咖啡：

- 爱发电：<https://afdian.com/a/tack123/plan>

支持完全自愿，不影响插件的任何功能。

## License

MIT
