# Under the Sun（朝闻天下）

An Obsidian plugin for RSS, daily digests, AI discussion, and an optional local backend for hotlists, tracking and judgments.

一个 Obsidian 插件：不装本地增强服务时是轻量 RSS + AI + 日报；安装后解锁热榜、正文补全、聚类、跟踪时间线和判断簿。

---

## 两种模式

| 模式 | 需要增强服务 | 能做什么 |
|---|---|---|
| 轻量模式 | 不需要 | RSS / Atom、日报、AI 解读、AI 交流、翻译、去重、阅读状态 |
| 完整模式 | 需要本地增强服务 | 热榜、正文补全、聚类、跟踪时间线、判断簿、07:00 / 19:00 定时任务 |

插件只有一个，安装一次即可。本地增强服务是可选服务，不会覆盖插件。

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

## 轻量模式

1. 打开 `设置 → 第三方插件 → Under the Sun`
2. 在「RSS 地址」里一行填一个源，例如：

   ```text
   https://feeds.bbci.co.uk/zhongwen/simp/rss.xml
   https://www.ithome.com/rss/
   ```

3. 可选：启用 AI，填 API 地址、模型、Key
4. 回到插件主页，点「刷新 RSS」
5. 想留档就点「生成今日日报」，会写到 `朝闻天下/RSS日报/YYYY-MM-DD.md`

轻量模式的能力：

- 多个 RSS / Atom 源
- 按时间、摘要长度和标题做基础打分
- 链接和标题相似度去重
- 翻译非中文摘要
- 标记已读 / 未读
- AI 解读和 AI 交流

## 安装本地增强服务（可选，macOS）

想要热榜、正文补全、聚类、跟踪和判断簿，需要安装本地增强服务。

1. 先安装并启用 `under-the-sun` 插件
2. 下载本地增强服务：

   <https://0xtack.github.io/TokenPeek/under-the-sun/downloads/UnderTheSun-Backend-0.4.1-macOS.zip>

3. 解压后双击 `install-backend.command`
4. 安装器会：
   - 检查 Python 3.9+
   - 创建 venv 并安装依赖
   - 写入 vault 路径
   - 生成 token
   - 把增强服务地址和 token 写进插件配置
   - 安装 launchd 后台服务
5. 重启 Obsidian，插件会自动检测到本地增强服务

安装器**只装增强服务，不安装或覆盖插件**。

## 第一次使用完整模式

1. 打开插件主页
2. 如果显示「本地增强服务已连接」，点「抓取并出报」
3. 日报会写到 `朝闻天下/日报/YYYY-MM-DD.md`
4. 跟踪、判断簿、来源开关会出现在主页

## AI 设置

在设置页：

- 打开「启用 AI」
- 填 API 地址，默认 `https://api.deepseek.com/v1`
- 点「获取模型」读取当前 Key 可用的模型列表，再选择；也可以手动填模型名
- 填 API Key

Key 只保存在本机插件数据里，不写进笔记，也不会上传。

## AI 怎么工作

它不是简单的问答框，也不是让模型自由发挥。解读按固定流程进行：

1. **事实 / 推断 / 判断分层**：材料能确定的部分才写事实；推断和判断分开写。
2. **信源与报道质量**：看信源是否单一、是否缺关键背景、标题是否夸大。
3. **核心矛盾与利益**：谁获利、谁承担成本、谁有决定权、谁没有发言权。
4. **反方与可证伪条件**：给出最强反方，以及什么新事实能推翻判断。
5. **判断卡**：把判断写成 claim、确认条件、反证条件和置信度，后续证据自动标为支持、反驳或无关。

AI 不参与排序。排序只看平台热度、跨源数量和新鲜度；最终判断由你确认。

## 数据和隐私

- RSS 地址、AI 设置、新闻缓存保存在插件数据里
- AI 对话保存在 vault 的 `.同步数据/chats/`，跟着 vault 同步
- 本地增强服务只监听 `127.0.0.1`，带 token
- 不发送遥测
- 不下载或执行外部代码
- 网络请求只发生在：刷新 RSS、调用你配置的 AI 接口、翻译、本地增强服务

## 本地增强服务更新

- 插件：Obsidian 市场自动更新
- 本地增强服务：插件发现版本旧了会提示，打开官网下载新安装包
- 安装器不会覆盖插件，插件更新也不会覆盖本地增强服务

## 限制

- 完整模式目前只提供 macOS 一键安装
- Windows / Linux 暂时只能用轻量模式，或手动运行 Python 增强服务
- 外国 RSS 源能否抓取取决于本地网络环境；被阻断或超时的源会被跳过
- 需要稳定访问外国源时，可在 `config.yaml` 的 `http.proxy` 填入本地代理地址
- 设置页的「测试所有来源」可以查看每个源当前是否可访问
- 建议开启 AI：外文摘要抓取后会翻译成中文；不开启 AI 时直接显示外文原文
- 手机端只能用轻量模式
- 完整模式需要 Python 3.9+
- AI 需要你自己的 API Key

## 开发

```bash
npm install
npm run build
npm run lint
```

构建产物是 `main.js`，和 `manifest.json`、`styles.css` 一起发布。

## 反馈

在插件设置页最下方可以直接打开：

- 报告问题
- 功能建议
- 作者主页（Tack）

反馈里不要粘贴 API Key、Cookie 或私人路径。

## 支持 / Sponsor

如果 Under the Sun 对你有帮助，可以请作者喝杯咖啡：

- 爱发电：<https://afdian.com/a/tack123/plan>

支持完全自愿，不影响插件的任何功能。

## License

MIT
