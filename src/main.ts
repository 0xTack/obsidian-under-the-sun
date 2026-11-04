import {
  App,
  ItemView,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  WorkspaceLeaf,
  normalizePath,
  requestUrl,
} from "obsidian";

const VIEW_TYPE = "under-the-sun-home";

interface SunSettings {
  feeds: string;
  digestFolder: string;
  maxItems: number;
  aiEnabled: boolean;
  apiBaseUrl: string;
  apiKey: string;
  model: string;
}

interface SunItem {
  id: string;
  title: string;
  link: string;
  summary: string;
  feed: string;
  date: string;
}

interface StoredData {
  settings: SunSettings;
  items: SunItem[];
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

interface AppWithSettings extends App {
  setting?: {
    open?: () => void;
    openTabById?: (id: string) => void;
  };
}

const DEFAULT_SETTINGS: SunSettings = {
  feeds: "",
  digestFolder: "朝闻天下/RSS日报",
  maxItems: 60,
  aiEnabled: false,
  apiBaseUrl: "https://api.deepseek.com/v1",
  apiKey: "",
  model: "deepseek-flash",
};

const INTERPRET_PROMPT = `你是资深新闻评论编辑。只根据给出的标题和摘要分析，不要复述新闻，不要编造。
一句话：不超过 40 字。
===
【事实】材料中能确定的事实；不确定就写「尚不清楚」
【报道评价】信源、背景、标题是否夸大，只写能判断的
【核心矛盾】真正的冲突是什么
【利益与权力】谁获利、谁承担成本、谁有决定权
【反方】反对这个判断的最强理由
【判断】一句话判断
要求：材料不足时明确说「已知信息有限」，总字数 200-400。`;

const CHAT_PROMPT = `你是新闻分析助手，正在讨论一条 RSS 新闻。
只根据给出的标题、摘要和对话历史回答，不要编造；不知道就说不知道。
回答简洁，先直接回答，再补依据；区分事实、推断和判断。`;

function stripHtml(input: string): string {
  const text = (input || "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
  return text.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function hash(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

function parseDate(value: string): string {
  if (!value) return "";
  const time = Date.parse(value);
  if (Number.isNaN(time)) return "";
  return new Date(time).toISOString();
}

function parseFeed(xml: string, feedUrl: string): SunItem[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const feedTitle =
    doc.querySelector("channel > title")?.textContent?.trim() ||
    doc.querySelector("feed > title")?.textContent?.trim() ||
    hostOf(feedUrl);

  const nodes = Array.from(doc.getElementsByTagName("item")).concat(
    Array.from(doc.getElementsByTagName("entry"))
  );

  const items: SunItem[] = [];
  for (const node of nodes) {
    const title = stripHtml(node.getElementsByTagName("title")[0]?.textContent || "");
    if (!title) continue;

    let link = "";
    const linkEl = node.getElementsByTagName("link")[0];
    if (linkEl) {
      link = linkEl.getAttribute("href") || linkEl.textContent || "";
    }
    if (!link) {
      const guid = node.getElementsByTagName("guid")[0]?.textContent || "";
      if (/^https?:/i.test(guid)) link = guid;
    }

    const summary =
      stripHtml(node.getElementsByTagName("description")[0]?.textContent || "") ||
      stripHtml(node.getElementsByTagName("summary")[0]?.textContent || "") ||
      stripHtml(node.getElementsByTagName("content")[0]?.textContent || "");

    const date =
      parseDate(node.getElementsByTagName("pubDate")[0]?.textContent || "") ||
      parseDate(node.getElementsByTagName("updated")[0]?.textContent || "") ||
      parseDate(node.getElementsByTagName("published")[0]?.textContent || "") ||
      parseDate(node.getElementsByTagName("dc:date")[0]?.textContent || "");

    items.push({
      id: hash(`${feedTitle}|${title}|${link}`),
      title,
      link,
      summary: summary.slice(0, 600),
      feed: feedTitle,
      date,
    });
  }
  return items;
}

export default class UnderTheSunPlugin extends Plugin {
  settings: SunSettings = DEFAULT_SETTINGS;
  items: SunItem[] = [];
  busy = false;
  private aiText = new Map<string, string>();
  private chats = new Map<string, Array<{ role: string; content: string }>>();

  async onload() {
    await this.loadAll();

    this.registerView(VIEW_TYPE, (leaf) => new SunHomeView(leaf, this));

    this.addRibbonIcon("sun", "打开 Under the Sun", () => {
      void this.activateView();
    });

    this.addCommand({ id: "open-home", name: "打开主页", callback: () => void this.activateView() });
    this.addCommand({ id: "fetch-feeds", name: "刷新 RSS", callback: () => void this.fetchAll() });
    this.addCommand({ id: "write-digest", name: "生成今天的 RSS 日报", callback: () => void this.writeDigest() });

    this.addSettingTab(new SunSettingTab(this.app, this));
  }

  refreshView() {
    const view = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view;
    if (view instanceof SunHomeView) view.render();
  }

  async loadAll() {
    const data = (await this.loadData()) as Partial<StoredData> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data?.settings || {});
    this.items = Array.isArray(data?.items) ? data.items : [];
  }

  async saveAll() {
    await this.saveData({ settings: this.settings, items: this.items });
  }

  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getLeaf(true);
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    await workspace.revealLeaf(leaf);
  }

  feedUrls(): string[] {
    return (this.settings.feeds || "")
      .split(/\r?\n/)
      .map((row) => row.trim())
      .filter((row) => row && !row.startsWith("#"));
  }

  async fetchAll() {
    const feeds = this.feedUrls();
    if (!feeds.length) {
      new Notice("先在设置里填至少一个 RSS 地址");
      return;
    }
    if (this.busy) return;
    this.busy = true;
    this.refreshView();
    let failed = 0;
    const collected: SunItem[] = [];
    for (const url of feeds) {
      try {
        const res = await requestUrl({
          url,
          headers: { "User-Agent": "Mozilla/5.0 (Obsidian Under the Sun)" },
        });
        collected.push(...parseFeed(res.text, url));
      } catch (err) {
        failed += 1;
        console.error("under-the-sun: RSS 失败", url, err);
      }
    }

    const seen = new Set<string>();
    const merged = collected.concat(this.items).filter((item) => {
      const key = item.link || `${item.feed}|${item.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    merged.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    this.items = merged.slice(0, Math.max(10, this.settings.maxItems));
    await this.saveAll();
    this.busy = false;
    this.refreshView();
    new Notice(failed ? `RSS 已刷新，${failed} 个源失败` : "RSS 已刷新");
  }

  async writeDigest() {
    if (!this.items.length) {
      new Notice("还没有新闻，先刷新 RSS");
      return;
    }
    const day = new Date().toISOString().slice(0, 10);
    const folder = normalizePath(this.settings.digestFolder || "朝闻天下/RSS日报");
    const path = normalizePath(`${folder}/${day}.md`);
    const lines = [
      "---",
      "type: RSS日报",
      "cssclasses:",
      "  - it-reading-mode",
      `date: ${day}`,
      "---",
      "",
      `# ${day} RSS 日报`,
      "",
      `> 来源：${this.feedUrls().length} 个 RSS · 共 ${this.items.length} 条`,
      "",
    ];
    for (const item of this.items) {
      lines.push(`> [!rss] ${item.title}`, ">");
      if (item.summary) lines.push(`> ${item.summary}`, ">");
      const meta = [item.feed, item.date ? item.date.slice(0, 10) : ""].filter(Boolean).join(" · ");
      lines.push(`> ${meta ? meta + " · " : ""}[原文](<${item.link || "#"}>)`, "", "---", "");
    }
    try {
      const folderExists = this.app.vault.getAbstractFileByPath(folder);
      if (!folderExists) await this.app.vault.createFolder(folder);
      const existing = this.app.vault.getAbstractFileByPath(path);
      if (existing instanceof TFile) {
        await this.app.vault.modify(existing, lines.join("\n"));
        await this.app.workspace.getLeaf(false).openFile(existing);
      } else {
        const created = await this.app.vault.create(path, lines.join("\n"));
        await this.app.workspace.getLeaf(false).openFile(created);
      }
      new Notice("RSS 日报已生成");
    } catch (err) {
      console.error("under-the-sun: 写日报失败", err);
      new Notice("写日报失败，看控制台");
    }
  }

  async aiCall(messages: Array<{ role: string; content: string }>, maxTokens = 1200): Promise<string> {
    if (!this.settings.aiEnabled || !this.settings.apiKey.trim()) {
      new Notice("先在设置里启用 AI 并填 API Key");
      return "";
    }
    const base = (this.settings.apiBaseUrl || "").replace(/\/+$/, "");
    try {
      const res = await requestUrl({
        url: `${base}/chat/completions`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.settings.apiKey.trim()}`,
        },
        body: JSON.stringify({
          model: this.settings.model,
          temperature: 0.4,
          max_tokens: maxTokens,
          messages,
        }),
      });
      const data = res.json as ChatCompletionResponse;
      return String(data.choices?.[0]?.message?.content || "").trim();
    } catch (err) {
      console.error("under-the-sun: AI 失败", err);
      const message = err instanceof Error ? err.message : String(err);
      new Notice(`AI 请求失败：${message}`);
      return "";
    }
  }

  async interpret(item: SunItem): Promise<void> {
    const text = await this.aiCall([
      { role: "system", content: INTERPRET_PROMPT },
      {
        role: "user",
        content: `标题：${item.title}\n来源：${item.feed}\n摘要：${item.summary || "（无摘要）"}`,
      },
    ], 1400);
    if (text) {
      this.aiText.set(item.id, text);
      this.refreshView();
    }
  }

  async chat(item: SunItem, message: string): Promise<string> {
    const history = this.chats.get(item.id) || [];
    const next = history.concat([{ role: "user", content: message }]);
    const answer = await this.aiCall([
      { role: "system", content: CHAT_PROMPT },
      {
        role: "user",
        content: `标题：${item.title}\n来源：${item.feed}\n摘要：${item.summary || "（无摘要）"}`,
      },
      ...next,
    ], 1200);
    if (answer) {
      next.push({ role: "assistant", content: answer });
      this.chats.set(item.id, next.slice(-20));
      this.refreshView();
    }
    return answer;
  }

  getAiText(id: string): string {
    return this.aiText.get(id) || "";
  }

  getChat(id: string): Array<{ role: string; content: string }> {
    return this.chats.get(id) || [];
  }
}

export class SunHomeView extends ItemView {
  plugin: UnderTheSunPlugin;

  constructor(leaf: WorkspaceLeaf, plugin: UnderTheSunPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return VIEW_TYPE;
  }

  getDisplayText() {
    return "Under the Sun";
  }

  getIcon() {
    return "sun";
  }

  async onOpen() {
    this.render();
  }

  render() {
    const root = this.contentEl;
    root.empty();
    root.addClass("it-root");

    root.createEl("h2", { text: "Under the Sun", cls: "it-title" });
    root.createDiv({
      cls: "it-sub",
      text: `RSS 阅读与 AI · ${this.plugin.feedUrls().length} 个来源 · ${this.plugin.items.length} 条新闻`,
    });

    const actions = root.createDiv({ cls: "it-actions" });
    const refresh = actions.createEl("button", { text: "刷新 RSS", cls: "mod-cta" });
    refresh.disabled = this.plugin.busy;
    refresh.onclick = () => void this.plugin.fetchAll();
    const digest = actions.createEl("button", { text: "生成今日日报" });
    digest.onclick = () => void this.plugin.writeDigest();
    const settings = actions.createEl("button", { text: "打开设置" });
    settings.onclick = () => {
      const app = this.app as AppWithSettings;
      app.setting?.open?.();
      app.setting?.openTabById?.(this.plugin.manifest.id);
    };

    if (!this.plugin.feedUrls().length) {
      const card = root.createDiv({ cls: "it-card" });
      card.createDiv({ cls: "it-section-head", text: "先添加来源" });
      card.createDiv({
        cls: "it-hint",
        text: "打开 设置 → 第三方插件 → Under the Sun，在「RSS 来源」里一行填一个地址，然后点刷新。",
      });
      return;
    }

    const list = root.createDiv({ cls: "it-card" });
    list.createDiv({ cls: "it-section-head", text: "最新新闻" });

    for (const item of this.plugin.items.slice(0, 80)) {
      const row = list.createDiv({ cls: "it-news" });
      const title = row.createDiv({ cls: "it-news-title", text: item.title });
      title.onclick = () => {
        if (item.link) window.open(item.link);
      };
      row.createDiv({
        cls: "it-news-meta",
        text: `${item.feed}${item.date ? " · " + item.date.slice(0, 16).replace("T", " ") : ""}`,
      });
      if (item.summary) {
        row.createDiv({ cls: "it-hint", text: item.summary });
      }

      const actionsRow = row.createDiv({ cls: "it-news-actions" });
      const aiBtn = actionsRow.createEl("button", { text: "AI 解读", cls: "it-mini" });
      aiBtn.onclick = () => void this.plugin.interpret(item);
      const chatBtn = actionsRow.createEl("button", { text: "AI 交流", cls: "it-mini" });
      chatBtn.onclick = () => {
        const box = row.querySelector<HTMLElement>(".it-rss-chat");
        if (box) {
          box.toggleClass("is-hidden", !box.hasClass("is-hidden"));
          return;
        }
        this.renderChat(row, item);
      };

      const aiText = this.plugin.getAiText(item.id);
      if (aiText) {
        const aiBox = row.createDiv({ cls: "it-rss-ai" });
        aiBox.setText(aiText);
      }
    }
  }

  private renderChat(row: HTMLElement, item: SunItem, hidden = false) {
    let box = row.querySelector<HTMLElement>(".it-rss-chat");
    if (box) box.remove();
    box = row.createDiv({ cls: "it-rss-chat" });
    if (hidden) box.addClass("is-hidden");

    const messages = box.createDiv({ cls: "it-rss-messages" });
    for (const msg of this.plugin.getChat(item.id)) {
      const line = messages.createDiv({ cls: `it-rss-msg ${msg.role}` });
      line.setText(`${msg.role === "user" ? "我" : "AI"}：${msg.content}`);
    }

    const inputRow = box.createDiv({ cls: "it-rss-input-row" });
    const input = inputRow.createEl("input", { type: "text", cls: "it-input" });
    input.placeholder = "围绕这条新闻追问…";
    const send = inputRow.createEl("button", { text: "发送", cls: "mod-cta" });
    const submit = async () => {
      const text = input.value.trim();
      if (!text) return;
      input.value = "";
      send.disabled = true;
      const answer = await this.plugin.chat(item, text);
      send.disabled = false;
      if (!answer) input.value = text;
    };
    send.onclick = () => void submit();
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void submit();
      }
    });
  }
}

class SunSettingTab extends PluginSettingTab {
  plugin: UnderTheSunPlugin;

  constructor(app: App, plugin: UnderTheSunPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl).setName("设置").setHeading();

    new Setting(containerEl).setName("RSS 来源").setHeading();
    new Setting(containerEl)
      .setName("RSS 地址")
      .setDesc("一行一个，支持 RSS / Atom。空行和 # 开头的行会忽略。")
      .addTextArea((text) => {
        text.inputEl.rows = 8;
        text.inputEl.addClass("it-textarea");
        text
          .setPlaceholder("https://example.com/feed.xml")
          .setValue(this.plugin.settings.feeds)
          .onChange((value) => {
            this.plugin.settings.feeds = value;
          });
      });

    new Setting(containerEl)
      .setName("日报目录")
      .setDesc("生成 RSS 日报的位置")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.digestFolder)
          .onChange((value) => {
            this.plugin.settings.digestFolder = value.trim() || "朝闻天下/RSS日报";
          })
      );

    new Setting(containerEl)
      .setName("最多保留条数")
      .setDesc("本地保留的新闻数量")
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.maxItems))
          .onChange((value) => {
            this.plugin.settings.maxItems = Math.max(10, Math.min(500, Number(value) || 60));
          })
      );

    new Setting(containerEl).setName("AI").setHeading();
    new Setting(containerEl)
      .setName("启用 AI")
      .setDesc("AI 解读和 AI 交流需要打开")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.aiEnabled).onChange((value) => {
          this.plugin.settings.aiEnabled = value;
        })
      );

    new Setting(containerEl)
      .setName("API 地址")
      .setDesc("OpenAI 兼容接口，例如 https://api.deepseek.com/v1")
      .addText((text) =>
        text
          .setPlaceholder("https://api.deepseek.com/v1")
          .setValue(this.plugin.settings.apiBaseUrl)
          .onChange((value) => {
            this.plugin.settings.apiBaseUrl = value.trim();
          })
      );

    new Setting(containerEl)
      .setName("模型")
      .addText((text) =>
        text
          .setPlaceholder("deepseek-flash")
          .setValue(this.plugin.settings.model)
          .onChange((value) => {
            this.plugin.settings.model = value.trim();
          })
      );

    new Setting(containerEl)
      .setName("API Key")
      .setDesc("只保存在本机插件数据里")
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder(this.plugin.settings.apiKey ? "已保存（留空不改）" : "sk-...")
          .onChange((value) => {
            const next = value.trim();
            if (next) this.plugin.settings.apiKey = next;
          });
      });

    new Setting(containerEl).setName("完整版").setHeading();
    new Setting(containerEl)
      .setName("需要热榜、跟踪和判断簿？")
      .setDesc(
        "完整版在 macOS 上提供热榜抓取、正文补全、跟踪时间线、判断簿和定时任务；社区版保持轻量，不依赖 Python。"
      )
      .addButton((button) =>
        button.setButtonText("查看完整版").onClick(() => {
          window.open("https://0xtack.github.io/TokenPeek/works.html");
        })
      );

    new Setting(containerEl).addButton((button) =>
      button
        .setButtonText("保存")
        .setCta()
        .onClick(async () => {
          await this.plugin.saveAll();
          this.plugin.refreshView();
          new Notice("设置已保存");
        })
    );
  }
}
