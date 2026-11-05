import {
  App,
  Component,
  ItemView,
  MarkdownRenderer,
  MarkdownView,
  Modal,
  Notice,
  Platform,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  WorkspaceLeaf,
  normalizePath,
  requestUrl,
  setIcon,
} from "obsidian";
import { MobileAI } from "./mobile-ai";
import {
  setDigestTrackedInNote,
  setWatchActiveInNote,
  setWatchOrderInNote,
  watchNoteItemId,
  WatchOrder,
} from "./watch-note";

import { BackendClient, BackendHealth, SourceTestResult } from "./backend";
import { RssItem, dedupeItems, parseFeed, translateText } from "./rss";

const VIEW_TYPE = "under-the-sun-home";
const BACKEND_API = 1;
const MOBILE_AI_KEY = "under-the-sun-mobile-api-key";
const MOBILE_SETTINGS_KEY = "under-the-sun-mobile-settings";

interface TrackerSettings {
  backendUrl: string;
  backendToken: string;
  showStatusBar: boolean;
  lastAlertAt: string;
  aiEnabled: boolean;
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  reasoningEffort: string;
  rssFeeds: string;
  rssDigestFolder: string;
  rssMaxItems: number;
  rssWatchKeywords: string;
  scheduleMorning: string;
  scheduleEvening: string;
  scheduleEnabled: boolean;
  scheduleEveningDigest: boolean;
  mobileSnapshotPath: string;
  debugMobile?: boolean;
  showJudgments?: boolean;
  updateRepo?: string;
  updateUrl?: string;
}

const DEFAULT_SETTINGS: TrackerSettings = {
  backendUrl: "http://127.0.0.1:8765",
  backendToken: "",
  showStatusBar: true,
  lastAlertAt: "",
  aiEnabled: false,
  apiBaseUrl: "https://api.deepseek.com/v1",
  apiKey: "",
  model: "deepseek-flash",
  reasoningEffort: "medium",
  rssFeeds: "",
  rssDigestFolder: "朝闻天下/RSS日报",
  rssMaxItems: 60,
  rssWatchKeywords: "",
  scheduleMorning: "07:00",
  scheduleEvening: "19:00",
  scheduleEnabled: true,
  scheduleEveningDigest: false,
  mobileSnapshotPath: "朝闻天下/.同步数据/mobile.json",
  debugMobile: false,
  showJudgments: false,
  updateRepo: "0xTack/TokenPeek",
  updateUrl: "https://0xtack.github.io/TokenPeek/works.html",
};

const LOGIN_ENTRIES = [
  {
    key: "weibo",
    label: "微博",
    url: "https://weibo.com/login.php",
    cookieUrl: "https://weibo.com",
    required: ["SUB", "SUBP"],
    validity: "通常 7–30 天",
  },
  {
    key: "zhihu",
    label: "知乎",
    url: "https://www.zhihu.com/signin",
    cookieUrl: "https://www.zhihu.com",
    required: ["z_c0"],
    validity: "通常约 30 天",
  },
  {
    key: "xiaohongshu",
    label: "小红书",
    url: "https://www.xiaohongshu.com/login",
    cookieUrl: "https://www.xiaohongshu.com",
    required: ["web_session"],
    validity: "通常 7–14 天",
  },
];

function daysAgo(iso: string): string {
  const ts = Date.parse(iso || "");
  if (!ts) return "";
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days <= 0) return "今天";
  return `${days} 天前`;
}

function lastJsonLine(text: string): any {
  const line = (text || "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("{"))
    .pop();
  if (!line) return null;
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function compactAnswer(text: string): string {
  return (text || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function slugify(text: string): string {
  return (text || "")
    .replace(/[^0-9a-zA-Z\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

interface SourceInfo {
  key: string;
  label: string;
  enabled: boolean;
  region: string;
  url?: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  at: string;
  typing?: boolean;
}

interface AlertItem {
  watch_id: number;
  title: string;
  note: string;
  headline: string;
  url: string;
  source: string;
  time: string;
}

interface JudgmentItem {
  id: number;
  item_id: number;
  title: string;
  url: string;
  source: string;
  question: string;
  claim_type: string;
  claim: string;
  confidence: number;
  confidence_note: string;
  horizon: string;
  status: string;
  version: number;
  created_at: string;
  updated_at: string;
  change_reason: string;
  source_quality?: { level?: string; reason?: string };
  confirm_if?: string[];
  falsifiers?: string[];
  counter?: string;
  evidence_counts?: { support?: number; contradict?: number; neutral?: number };
}

interface StatusPayload {
  generated_at: string;
  version?: string;
  api?: number;
  schedule?: { enabled?: boolean; morning?: string; evening?: string; eveningDigest?: boolean };
  vault: string;
  digest_folder: string;
  watch_folder?: string;
  today: string;
  digest_exists: boolean;
  digest_path: string;
  stats: { items: number; watches: number; last_digest: string; last_digest_items: number };
  sources: SourceInfo[];
  top_items: TopItem[];
  mobile_items?: TopItem[];
  history: HistoryItem[];
  judgments?: JudgmentItem[];
  filters: {
    enabled?: boolean;
    min_title_chars?: number;
    block_keywords?: string[];
    rules?: Array<{ type?: string; value?: string; enabled?: boolean }>;
  };
  dedupe?: {
    enabled?: boolean;
    lookback_days?: number;
    min_similarity?: number;
    containment?: number;
  };
  cookies?: { weibo?: boolean; zhihu?: boolean; xiaohongshu?: boolean };
  cookie_meta?: Record<string, string>;
  ai: { enabled: boolean; base_url: string; model: string; has_key: boolean };
  alerts: { unread: number; updated_at: string; items: AlertItem[] };
}

interface HistoryItem {
  watch_id: number;
  item_id?: number;
  title: string;
  note: string;
  active?: number;
  count: number;
  updates: number;
  forward: number;
  backward: number;
  deep: number;
  first_date: string;
  first_title: string;
  first_url: string;
  first_source: string;
}

interface TopItem {
  id: number;
  title: string;
  url: string;
  source: string;
  region: string;
  score: number;
  topic: string;
  summary?: string;
  tracked: boolean;
  has_ai: boolean;
  has_judgment?: boolean;
}

function openExternalUrl(url: string): void {
  const target = (url || "").trim();
  if (!target) return;
  if (Platform.isDesktopApp) {
    try {
      const electron = (window as any).require?.("electron");
      if (electron?.shell?.openExternal) {
        void electron.shell.openExternal(target);
        return;
      }
    } catch {
      // 回退到浏览器标准打开方式
    }
  }
  window.open(target, "_blank", "noopener,noreferrer");
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

function deepMerge(base: any, over: any): any {
  for (const key of Object.keys(over)) {
    const value = over[key];
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      base[key] &&
      typeof base[key] === "object"
    ) {
      deepMerge(base[key], value);
    } else {
      base[key] = value;
    }
  }
  return base;
}

function compareVersion(a: string, b: string): number {
  const parse = (value: string) =>
    value
      .split("-")[0]
      .split(".")
      .map((part) => Number(part) || 0);
  const left = parse(a);
  const right = parse(b);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

export default class InfoTrackerPlugin extends Plugin {
  settings!: TrackerSettings;
  running = false;
  lastLog = "";
  backend!: BackendClient;
  backendHealth: BackendHealth = { ok: false };
  sourceTestResults: SourceTestResult[] = [];
  private backendWarned = false;
  rssItems: RssItem[] = [];
  runStartedAt = 0;
  runLabel = "";
  simpleAiText: Record<string, string> = {};
  simpleChats: Record<string, Array<{ role: string; content: string }>> = {};
  private lastChatItem = 0;
  private lastChatAt = 0;
  private lastOpenChatId = 0;
  private lastOpenChatAt = 0;
  private statusBar: HTMLElement | null = null;
  private statsTimer: number | null = null;
  private editButton: HTMLElement | null = null;
  private editButtonPath = "";

  get view(): TrackerHomeView | null {
    const view = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view;
    return view instanceof TrackerHomeView ? view : null;
  }

  async onload() {
    await this.loadSettings();
    this.backend = new BackendClient(this.settings.backendUrl, this.settings.backendToken);
    this.chatDebug("plugin:onload-start", {});

    this.registerView(VIEW_TYPE, (leaf) => new TrackerHomeView(leaf, this));

    this.addRibbonIcon("newspaper", "打开朝闻天下", () => {
      void this.activateView();
    });

    this.addCommand({ id: "open-home", name: "打开朝闻天下", callback: () => this.activateView() });
    if (!this.isMobile()) {
      this.addCommand({
        id: "run-all",
        name: "立即抓取并生成日报",
        callback: () => {
          void this.runWithConfirm();
        },
      });
      this.addCommand({
        id: "fetch-only",
        name: "收集（不出报）",
        callback: () => this.runCli(["fetch"]),
      });
      this.addCommand({
        id: "setup-env",
        name: "安装/更新本地增强服务",
        callback: () => {
          this.openBackendInstallGuide();
        },
      });
    }

    this.statusBar = this.addStatusBarItem();
    this.statusBar.addClass("mod-clickable");
    this.statusBar.onClickEvent(() => this.activateView());
    this.refreshStatusBar();
    if (!this.isMobile()) {
      this.registerInterval(
        window.setInterval(() => {
          void this.autoReconnectBackend();
        }, 30000)
      );
    }

    this.addSettingTab(new TrackerSettingTab(this.app, this));

    const protocolHandler = async (params: Record<string, string>) => {
      if (params.cmd === "ai" && params.item) {
        await this.generateAi(Number(params.item));
      } else if (params.cmd === "ai-all" && params.day) {
        await this.generateAllAi(params.day);
      } else if (params.cmd === "chat" && params.item) {
        const id = Number(params.item);
        if (this.lastChatItem === id && Date.now() - this.lastChatAt < 1200) {
          return;
        }
        await this.openChat(id, params.title || "");
      } else if (params.cmd === "watch-stop" && params.watch) {
        await this.handleWatchUri("stop", Number(params.watch));
      } else if (params.cmd === "watch-start" && params.watch) {
        await this.handleWatchUri("start", Number(params.watch));
      } else if (params.cmd === "watch-sort" && params.watch) {
        await this.handleWatchUri(
          "sort",
          Number(params.watch),
          params.order === "oldest" ? "oldest" : "newest"
        );
      } else if (params.cmd === "home") {
        await this.activateView();
      }
    };
    this.registerObsidianProtocolHandler("info-tracker", protocolHandler);
    this.registerObsidianProtocolHandler("under-the-sun", protocolHandler);

    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        void this.applyDefaultReadingMode(file);
      })
    );

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        if (this.settingMode) return;
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (view?.file) void this.applyDefaultReadingMode(view.file);
      })
    );

    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view || view.getMode() !== "preview") this.removeEditButton();
      })
    );

    this.attachChatClickHandler(document);
    this.attachWatchClickHandler(document);
    this.watchUrlTooltips(document);
    this.registerEvent(
      this.app.workspace.on("window-open", (win) => {
        this.attachChatClickHandler(win.doc);
        this.attachWatchClickHandler(win.doc);
        this.watchUrlTooltips(win.doc);
      })
    );

    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile) this.scheduleStatsUpdate(file);
      })
    );

    this.registerInterval(window.setInterval(() => this.pollAlerts(), 60000));
    window.setTimeout(() => this.pollAlerts(), 4000);

    this.chatDebug("plugin:loaded", { version: this.manifest.version });

    // 开机后如果今天还没有日报，后台补一份，别等用户点。手机端没有 Python，跳过。
    if (!this.isMobile()) {
      window.setTimeout(async () => {
        const status = await this.readStatus();
        if (status && !status.digest_exists && !this.running) {
          new Notice("今天还没有日报，后台生成中…");
          void this.runCli(["run"]);
        }
      }, 20000);
    }
  }

  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getLeaf(true);
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  isMobile() {
    return !Platform.isDesktopApp || !!this.settings.debugMobile;
  }

  mobileAi(): MobileAI {
    return new MobileAI({
      aiEnabled: this.settings.aiEnabled,
      apiBaseUrl: this.settings.apiBaseUrl,
      apiKey: this.settings.apiKey,
      model: this.settings.model,
      reasoningEffort: this.settings.reasoningEffort,
    });
  }

  mobileDataDir(): string {
    return normalizePath(this.settings.mobileSnapshotPath)
      .split("/")
      .slice(0, -1)
      .join("/") || "朝闻天下/.同步数据";
  }

  mobileChatPath(itemId: number): string {
    return normalizePath(`${this.mobileDataDir()}/chats/${itemId}.json`);
  }

  async ensureVaultDir(dir: string): Promise<void> {
    const adapter = this.app.vault.adapter;
    let current = "";
    for (const part of normalizePath(dir).split("/")) {
      if (!part) continue;
      current = current ? `${current}/${part}` : part;
      if (!(await adapter.exists(current))) {
        await adapter.mkdir(current);
      }
    }
  }

  async vaultExists(rel: string): Promise<boolean> {
    return this.app.vault.adapter.exists(normalizePath(rel));
  }

  async vaultRead(rel: string): Promise<string> {
    return this.app.vault.adapter.read(normalizePath(rel));
  }

  async vaultWrite(rel: string, content: string): Promise<void> {
    const full = normalizePath(rel);
    const dir = full.split("/").slice(0, -1).join("/");
    if (dir) await this.ensureVaultDir(dir);
    await this.app.vault.adapter.write(full, content);
  }

  async readMobileStatus(): Promise<StatusPayload | null> {
    try {
      const rel = normalizePath(this.settings.mobileSnapshotPath);
      const adapter = this.app.vault.adapter;
      if (!(await adapter.exists(rel))) return null;
      const raw = await adapter.read(rel);
      return JSON.parse(raw) as StatusPayload;
    } catch (err) {
      console.error("info-tracker: 读取手机快照失败", err);
      return null;
    }
  }

  async checkUpdate() {
    const repo = (this.settings.updateRepo || "0xTack/TokenPeek").trim();
    const current = this.manifest.version;
    try {
      const res = await requestUrl({
        url: `https://api.github.com/repos/${repo}/releases?per_page=20`,
        headers: { Accept: "application/vnd.github+json" },
      });
      const releases = Array.isArray(res.json) ? res.json : [];
      let found: { version: string; url: string } | null = null;
      for (const release of releases) {
        if (!release || release.draft) continue;
        for (const asset of release.assets || []) {
          const name = String(asset?.name || "");
          const match = name.match(/^UnderTheSun-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/i);
          if (match) {
            found = {
              version: match[1],
              url: release.html_url || asset.browser_download_url || this.settings.updateUrl || "",
            };
            break;
          }
        }
        if (found) break;
      }
      if (!found) {
        new Notice("没有找到 Under The Sun 的发布记录");
        return;
      }
      if (compareVersion(found.version, current) > 0) {
        new Notice(`发现新版本 ${found.version}（当前 ${current}），正在打开发布页`, 8000);
        if (found.url) window.open(found.url);
      } else {
        new Notice(`已是最新版本 ${current}`);
      }
    } catch (err: any) {
      new Notice(`检查更新失败：${err?.message || err}`);
    }
  }

  async readStatus(): Promise<StatusPayload | null> {
    if (this.isMobile()) return this.readMobileStatus();
    const status = await this.backend.status();
    if (status) {
      this.backendHealth = { ok: true, version: status.version, api: status.api };
      return status as StatusPayload;
    }
    // 后端不可用时，仍然读手机快照，保证只读界面有内容
    return this.readMobileStatus();
  }

  async saveOverrides(partial: any) {
    if (this.isMobile()) {
      new Notice("手机端不改抓取配置；请在电脑端修改");
      return;
    }
    const ok = await this.backend.saveConfig(partial);
    if (!ok) {
      new Notice("本地增强服务未连接，配置没有保存");
    }
  }

  openBackendInstallGuide() {
    window.open("https://0xtack.github.io/TokenPeek/under-the-sun/#install", "_blank");
  }

  openInstallGuide() {
    new InstallGuideModal(this.app, this).open();
  }

  async checkBackend(): Promise<BackendHealth> {
    this.backend = new BackendClient(this.settings.backendUrl, this.settings.backendToken);
    this.backendHealth = await this.backend.health();
    this.warnBackendVersion(this.backendHealth);
    return this.backendHealth;
  }

  private warnBackendVersion(health: BackendHealth) {
    if (!health.ok || !health.api || health.api === BACKEND_API) return;
    if (this.backendWarned) return;
    this.backendWarned = true;
    new Notice(
      `本地增强服务 API v${health.api} 与插件 v${BACKEND_API} 不匹配，请更新本地增强服务`,
      12000
    );
  }

  async autoReconnectBackend() {
    if (this.isMobile() || this.running) return;
    const was = this.backendHealth.ok;
    this.backendHealth = await this.backend.health();
    this.warnBackendVersion(this.backendHealth);
    if (this.backendHealth.ok !== was) await this.view?.refresh();
  }

  private aiBaseUrl(raw: string): string {
    return (raw.trim() || this.settings.apiBaseUrl || "https://api.deepseek.com/v1").replace(
      /\/+$/,
      ""
    );
  }

  private aiErrorMessage(status: number, text: string): string {
    let message = "";
    try {
      const data = JSON.parse(text || "{}");
      message = data?.error?.message || data?.message || "";
    } catch {
      message = (text || "").slice(0, 200);
    }
    if (status === 401 || status === 403) return "API Key 无效或没有权限";
    if (status === 404) return `模型不存在或地址错误${message ? "：" + message : ""}`;
    return `HTTP ${status}${message ? "：" + message : ""}`;
  }

  async listAiModels(
    baseUrl: string,
    apiKey: string
  ): Promise<{ ok: boolean; models: string[]; error?: string }> {
    const key = apiKey.trim();
    if (!key) {
      const result = await this.backend.aiModels();
      if (result) return result;
      return { ok: false, models: [], error: "请先填写 API Key" };
    }
    try {
      const res = await requestUrl({
        url: `${this.aiBaseUrl(baseUrl)}/models`,
        method: "GET",
        headers: { Authorization: `Bearer ${key}` },
        throw: false,
      });
      if (res.status < 200 || res.status >= 300) {
        return { ok: false, models: [], error: this.aiErrorMessage(res.status, res.text || "") };
      }
      const data = (res.json || {}) as { data?: Array<{ id?: string }> };
      const models = Array.from(
        new Set((data.data || []).map((item) => item.id).filter((id): id is string => !!id))
      ).sort();
      return { ok: true, models };
    } catch (err) {
      return {
        ok: false,
        models: [],
        error: `请求失败：${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  async testAiConnection(
    baseUrl: string,
    model: string,
    apiKey: string
  ): Promise<{ ok: boolean; message: string }> {
    const key = apiKey.trim();
    if (!key) {
      const result = await this.backend.aiTest(model, baseUrl);
      if (result) return result;
      return {
        ok: false,
        message: "请先填写 API Key；留空测试已保存的 Key 需要本地增强服务",
      };
    }
    if (!model.trim()) return { ok: false, message: "请先选择或填写模型" };
    try {
      const res = await requestUrl({
        url: `${this.aiBaseUrl(baseUrl)}/chat/completions`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: model.trim(),
          messages: [{ role: "user", content: "只回复 ok" }],
          max_tokens: 32,
          temperature: 0,
          stream: false,
        }),
        throw: false,
      });
      if (res.status >= 200 && res.status < 300) {
        return { ok: true, message: `连接成功：${model.trim()} 可用` };
      }
      return { ok: false, message: this.aiErrorMessage(res.status, res.text || "") };
    } catch (err) {
      return {
        ok: false,
        message: `请求失败：${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  async runSetup(): Promise<number> {
    this.openBackendInstallGuide();
    return -1;
  }

  async testSources(): Promise<void> {
    if (!this.backendHealth.ok) await this.checkBackend();
    if (!this.backendHealth.ok) {
      new Notice("本地增强服务未连接，无法测试来源");
      return;
    }
    const notice = new Notice("正在测试热榜和 RSS 来源，受网络环境影响可能较慢…", 0);
    const results = await this.backend.testSources();
    notice.hide();
    if (!results) {
      new Notice("测试失败：本地增强服务未连接");
      return;
    }
    this.sourceTestResults = results;
    new SourceTestModal(this.app, results, () => {
      void this.applyReachableSources();
    }).open();
  }

  async applyReachableSources(): Promise<void> {
    if (!this.sourceTestResults.length) {
      new Notice("先点「测试所有来源」");
      return;
    }
    const status = await this.readStatus();
    const sources = status?.sources || [];
    const failedKeys = new Set(
      this.sourceTestResults.filter((item) => !item.ok && item.key).map((item) => item.key as string)
    );
    const failedUrls = new Set(
      this.sourceTestResults.filter((item) => !item.ok && item.url).map((item) => item.url)
    );
    const rss = sources.filter((source) => source.key.startsWith("rss:") && source.url);
    const disabled = rss
      .filter(
        (source) =>
          !source.enabled ||
          failedKeys.has(source.key) ||
          failedUrls.has(source.url || "")
      )
      .map((source) => source.url as string);
    const patch: Record<string, { enabled: false } | { disabled: string[] }> = {
      rss: { disabled },
    };
    for (const source of sources) {
      if (!source.key || source.key === "rss" || source.key.startsWith("rss:")) continue;
      if (failedKeys.has(source.key)) patch[source.key] = { enabled: false };
    }
    const ok = await this.backend.saveConfig({ sources: patch });
    if (!ok) {
      new Notice("保存失败，本地增强服务未连接");
      return;
    }
    await this.runCli(["status"], true);
    await this.view?.refresh();
    new Notice("已只启用可访问来源");
  }

  async runWithConfirm(): Promise<number> {
    if (this.running) {
      new Notice("正在运行，请稍候");
      return -1;
    }
    const status = await this.readStatus();
    if (!status?.digest_exists) {
      return this.runCli(["run", "--force"]);
    }
    new ConfirmModal(
      this.app,
      "今天已有日报。重新生成会覆盖日报正文，但会保留跟踪/已读勾选和 AI 缓存。",
      () => void this.runCli(["run", "--force"])
    ).open();
    return -1;
  }

  async runCli(args: string[], silent = false, queue = false): Promise<number> {
    if (this.isMobile()) {
      new Notice("本地增强服务只在电脑端可用；手机端读取电脑同步过来的快照");
      return -1;
    }
    if (!this.backend.configured) {
      new Notice("还没有安装本地增强服务；先点主页的「安装本地增强服务」");
      return -1;
    }
    if (!this.backendHealth.ok) {
      await this.checkBackend();
      if (!this.backendHealth.ok) {
        new Notice("本地增强服务未连接；请确认服务已启动");
        return -1;
      }
    }
    if (this.running) {
      if (!queue) {
        new Notice("正在运行，请稍候");
        return -1;
      }
      await this.waitUntilIdle();
      return this.runCli(args, silent, true);
    }
    this.running = true;
    this.lastLog = "";
    this.runStartedAt = Date.now();
    this.runLabel = args[0] || "";
    this.view?.setBusy(true);

    let result = { code: -1, output: "" };
    try {
      result = await this.backend.run(args);
    } finally {
      this.runStartedAt = 0;
      this.runLabel = "";
      this.lastLog = result.output || "";
      this.running = false;
      this.view?.setBusy(false);
      this.view?.updateLog(this.lastLog);
      if (!silent) {
        new Notice(result.code === 0 ? "完成" : `结束（退出码 ${result.code}），看下面的日志`);
      }
      await this.view?.refresh();
      this.refreshStatusBar();
    }
    return result.code;
  }

  private waitUntilIdle(timeoutMs = 180000): Promise<void> {
    return new Promise((resolve) => {
      const started = Date.now();
      const tick = () => {
        if (!this.running || Date.now() - started > timeoutMs) {
          resolve();
          return;
        }
        window.setTimeout(tick, 120);
      };
      tick();
    });
  }

  stopRun() {
    new Notice("本地增强服务运行中暂不支持中断；可以等这次完成");
  }

  async pollAlerts() {
    const status = await this.readStatus();
    if (!status) return;
    const alerts = status.alerts;
    if (alerts?.updated_at && alerts.updated_at !== this.settings.lastAlertAt && alerts.unread > 0) {
      this.settings.lastAlertAt = alerts.updated_at;
      await this.saveSettings();
      const first = alerts.items[0];
      new Notice(
        `跟踪有新进展：${first ? first.headline : ""}（${alerts.unread} 条）`,
        10000
      );
      this.view?.refresh();
    }
    this.refreshStatusBar(alerts?.unread ?? 0);
  }

  async refreshStatusBar(unread?: number) {
    if (!this.statusBar) return;
    if (!this.settings.showStatusBar) {
      this.statusBar.setText("");
      return;
    }
    const status = await this.readStatus();
    const count = unread ?? status?.alerts?.unread ?? 0;
    const watches = status?.stats?.watches ?? 0;
    this.statusBar.setText(count > 0 ? `📰 跟踪 ${count}` : `📰 ${watches}`);
    this.statusBar.setAttr("aria-label", "信息跟踪");
  }

  async autoLogin(entry: {
    key: string;
    label: string;
    url: string;
    cookieUrl: string;
    required: string[];
  }) {
    new Notice(
      `请用「打开${entry.label}登录页」手动登录，然后复制 Cookie 填到下面的输入框。插件不再内置登录窗口。`,
      12000
    );
  }

  private scheduleStatsUpdate(file: TFile) {
    if (this.isMobile() || file.extension !== "md") return;
    const status = this.view?.status;
    const folder = status?.digest_folder || "朝闻天下/日报";
    if (!file.path.startsWith(`${folder}/`)) return;
    const day = file.basename;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;

    if (this.statsTimer) window.clearTimeout(this.statsTimer);
    this.statsTimer = window.setTimeout(() => {
      this.statsTimer = null;
      if (!this.running) void this.runCli(["stats", "--day", day], true);
    }, 1200);
  }

  private removeEditButton() {
    if (this.editButton) {
      this.editButton.remove();
      this.editButton = null;
    }
    this.editButtonPath = "";
  }

  private updateModeButton(view: MarkdownView, file: TFile) {
    if (!this.editButton || this.editButtonPath !== file.path) {
      this.installModeButton(view, file);
      return;
    }
    const editing = view.getMode() !== "preview";
    const label = editing ? "返回阅读模式" : "编辑此页";
    setIcon(this.editButton, editing ? "book-open" : "pencil");
    this.editButton.setAttr("aria-label", label);
    this.editButton.setAttr("title", label);
  }

  private installModeButton(view: MarkdownView, file: TFile) {
    this.removeEditButton();
    const host = view.containerEl;
    host.addClass("it-edit-host");
    const button = host.createEl("button", {
      cls: "it-edit-top",
      attr: { "aria-label": "编辑此页", title: "编辑此页" },
    });
    this.editButton = button;
    this.editButtonPath = file.path;
    this.updateModeButton(view, file);

    button.onclick = async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const current = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!current || current.file?.path !== file.path) return;
      const target = current.getMode() === "preview" ? "source" : "preview";
      await this.setMarkdownMode(current, target);
      window.setTimeout(() => {
        const active = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (active && active.file?.path === file.path) {
          this.updateModeButton(active, file);
        }
      }, 150);
    };
  }

  async applyDefaultReadingMode(file: TFile | null) {
    this.removeEditButton();
    if (!file || file.extension !== "md") return;
    const status = this.view?.status || (await this.readStatus());
    const digestFolder = status?.digest_folder || "朝闻天下/日报";
    const watchFolder = status?.watch_folder || "朝闻天下/跟踪";
    const isDigest = file.path.startsWith(`${digestFolder}/`);
    const isTracking = file.path.startsWith(`${watchFolder}/`);
    if (!isDigest && !isTracking) return;

    window.setTimeout(async () => {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view || view.file?.path !== file.path) return;
      const preview = view.containerEl.querySelector(
        ".markdown-preview-view"
      ) as HTMLElement | null;
      if (!preview || preview.getClientRects().length === 0) {
        await this.setMarkdownMode(view, "preview");
      }
      window.setTimeout(() => {
        const active = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (active && active.file?.path === file.path) {
          this.installModeButton(active, file);
        }
      }, 150);
    }, 80);
  }

  private watchUrlTooltips(doc: Document) {
    const hide = () => {
      doc.querySelectorAll(".tooltip").forEach((el) => {
        const node = el as HTMLElement;
        node.style.display = (el.textContent || "").includes("http") ? "none" : "";
      });
    };
    const observer = new MutationObserver(hide);
    observer.observe(doc.body, { childList: true, subtree: true });
    doc.addEventListener("mouseover", hide, true);
    this.register(() => {
      observer.disconnect();
      doc.removeEventListener("mouseover", hide, true);
    });
  }

  private attachChatClickHandler(doc: Document) {
    const handler = (event: MouseEvent) => {
      let target: Element | null = null;
      if (event.target instanceof Element) target = event.target;
      else if (event.target instanceof Node) target = (event.target as Node).parentElement;
      if (!target) return;
      const anyLink = target.closest('a[href*="info-tracker"]') as HTMLAnchorElement | null;
      if (anyLink) {
        this.chatDebug("click:link", {
          href: (anyLink.getAttribute("href") || "").slice(0, 140),
        });
      }
      const anchor = target.closest(
        'a.external-link[href*="cmd=chat"], a[href*="cmd=chat"]'
      ) as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = (anchor.getAttribute("href") || anchor.href || "").replace(/&amp;/g, "&");
      const match = href.match(/[?&]item=(\d+)/);
      if (!match) return;
      event.preventDefault();
      event.stopPropagation();
      const titleMatch = href.match(/[?&]title=([^&]*)/);
      let title = "";
      if (titleMatch) {
        try {
          title = decodeURIComponent(titleMatch[1].replace(/\+/g, " "));
        } catch {
          title = "";
        }
      }
      this.lastChatItem = Number(match[1]);
      this.lastChatAt = Date.now();
      void this.openChat(Number(match[1]), title, this.markdownViewFor(anchor)).catch(
        (err) => {
          console.error("info-tracker: 打开 AI 交流失败", err);
          new Notice("AI 交流打开失败，请重试");
        }
      );
    };
    doc.addEventListener("click", handler, true);
    this.register(() => doc.removeEventListener("click", handler, true));
  }

  /**
   * 跟踪笔记里的「停止 / 重新追踪 / 时间线排序」直接改笔记。
   * 不依赖 Python，手机端也能用；桌面端下次运行会把状态同步回数据库。
   */
  private attachWatchClickHandler(doc: Document) {
    const handler = (event: MouseEvent) => {
      let target: Element | null = null;
      if (event.target instanceof Element) target = event.target;
      else if (event.target instanceof Node) target = (event.target as Node).parentElement;
      if (!target) return;

      const anchor = target.closest(
        'a[href*="cmd=watch-stop"], a[href*="cmd=watch-start"], a[href*="cmd=watch-sort"]'
      ) as HTMLAnchorElement | null;
      if (!anchor) return;

      const href = (anchor.getAttribute("href") || anchor.href || "").replace(/&amp;/g, "&");
      const watch = href.match(/[?&]watch=(\d+)/);
      if (!watch) return;

      let cmd: "stop" | "start" | "sort";
      if (href.includes("cmd=watch-stop")) cmd = "stop";
      else if (href.includes("cmd=watch-start")) cmd = "start";
      else if (href.includes("cmd=watch-sort")) cmd = "sort";
      else return;

      const order: WatchOrder = /[?&]order=oldest/.test(href) ? "oldest" : "newest";
      const view = this.markdownViewFor(anchor);
      const file = view?.file instanceof TFile ? view.file : null;

      event.preventDefault();
      event.stopPropagation();
      if (file) {
        void this.applyWatchAction(file, cmd, Number(watch[1]), order).catch((err) => {
          console.error("info-tracker: 修改跟踪笔记失败", err);
          new Notice("修改跟踪笔记失败，请重试");
        });
      } else {
        // 悬浮预览等场景拿不到源文件，按 watch_id 回查，避免改错笔记
        void this.handleWatchUri(cmd, Number(watch[1]), order);
      }
    };
    doc.addEventListener("click", handler, true);
    this.register(() => doc.removeEventListener("click", handler, true));
  }

  private async handleWatchUri(
    cmd: "stop" | "start" | "sort",
    watchId: number,
    order: WatchOrder = "newest"
  ) {
    const file = await this.findWatchNote(watchId);
    if (!file) {
      new Notice("找不到这条跟踪笔记，可能已被移动或删除");
      return;
    }
    await this.applyWatchAction(file, cmd, watchId, order);
  }

  private async findWatchNote(watchId: number): Promise<TFile | null> {
    for (const file of this.app.vault.getMarkdownFiles()) {
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (frontmatter && Number(frontmatter.watch_id) === watchId) return file;
    }
    return null;
  }

  private async applyWatchAction(
    file: TFile,
    cmd: "stop" | "start" | "sort",
    watchId: number,
    order: WatchOrder = "newest"
  ) {
    let itemId: number | null = null;
    let changed = false;
    let active = false;

    await this.app.vault.process(file, (data) => {
      itemId = watchNoteItemId(data);
      let next = data;
      if (cmd === "sort") {
        next = setWatchOrderInNote(data, watchId, order);
      } else {
        active = cmd === "start";
        next = setWatchActiveInNote(data, watchId, active);
      }
      changed = next !== data;
      return next;
    });

    if (!changed) {
      new Notice("笔记状态没有变化");
      return;
    }

    if (cmd !== "sort") {
      if (itemId === null) {
        const status = await this.readStatus();
        itemId =
          status?.history?.find((entry) => Number(entry.watch_id) === watchId)?.item_id ??
          null;
      }
      // 让日报里的「跟踪」勾选和笔记保持一致，避免下次运行互相覆盖
      if (itemId !== null) await this.setDigestTrackedEverywhere(itemId, active);
    }

    new Notice(
      cmd === "stop"
        ? "已停止追踪"
        : cmd === "start"
          ? "已重新开始追踪"
          : order === "oldest"
            ? "时间线已改为最初在前"
            : "时间线已改为最新在前"
    );
    await this.view?.refresh();

    // 电脑端顺手让 Python 立刻把数据库对齐；手机端没有 Python，等下次同步
    if (!this.isMobile()) void this.runCli(["watch"], true, true);
  }

  private async setDigestTrackedEverywhere(itemId: number, tracked: boolean) {
    const status = await this.readStatus();
    const folder = (status?.digest_folder || "朝闻天下/日报").replace(/\/+$/, "");
    // 和 Python 的 LOOKBACK_DAYS 保持一致，只改最近 14 份日报
    const files = this.app.vault
      .getMarkdownFiles()
      .filter((file) => file.path.startsWith(`${folder}/`))
      .sort((a, b) => a.path.localeCompare(b.path))
      .slice(-14);
    let changed = 0;
    for (const file of files) {
      await this.app.vault.process(file, (data) => {
        const next = setDigestTrackedInNote(data, itemId, tracked);
        if (next !== data) changed++;
        return next;
      });
    }
    return changed;
  }

  private infinitySeq = 0;

  private infinitySvg(): string {
    const id = `it-ai-grad-${++this.infinitySeq}`;
    return (
      '<svg viewBox="0 0 32 24" width="28" height="20" fill="none">' +
      `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0">` +
      '<stop offset="0%" stop-color="currentColor" stop-opacity="1"/>' +
      '<stop offset="45%" stop-color="currentColor" stop-opacity="0.5"/>' +
      '<stop offset="100%" stop-color="currentColor" stop-opacity="0"/>' +
      "</linearGradient></defs>" +
      `<path class="it-ai-trail" pathLength="100" stroke="url(#${id})" ` +
      'd="M6 12C6 6.5 12 6.5 16 12s10 5.5 10 0-6-5.5-10 0-10 5.5-10 0Z"/>' +
      "</svg>"
    );
  }

  private showBatchProgress(total: number) {
    const el = document.createElement("div");
    el.className = "it-ai-pending it-ai-progress";
    const icon = document.createElement("span");
    icon.className = "it-ai-infinity";
    icon.setAttribute("aria-hidden", "true");
    // eslint-disable-next-line no-unsanitized/property -- 常量 SVG，不包含外部输入
    icon.innerHTML = this.infinitySvg();
    const label = document.createElement("span");
    label.className = "it-ai-pending-text";
    label.textContent = `正在研读 0/${total}`;
    el.appendChild(icon);
    el.appendChild(label);

    const place = () => {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view) return;
      const link = view.containerEl.querySelector(
        'a[href*="cmd=ai-all"]'
      ) as HTMLElement | null;
      const host = (link?.closest("p") as HTMLElement | null) || null;
      if (host?.parentElement) {
        host.parentElement.insertBefore(el, host.nextSibling);
        return;
      }
      const sizer =
        (view.containerEl.querySelector(".markdown-preview-sizer") as HTMLElement | null) ||
        view.contentEl;
      sizer.prepend(el);
    };
    place();

    return {
      update: (done: number) => {
        label.textContent = `正在研读 ${Math.min(done, total)}/${total}`;
        if (!el.isConnected) place();
      },
      finish: (done: number) => {
        label.textContent = `已完成 ${done}/${total}`;
      },
      ensure: () => {
        if (!el.isConnected) place();
      },
      remove: () => el.remove(),
    };
  }

  private pendingAi = new Map<number, HTMLElement>();
  private pendingTimers = new Map<number, number>();

  private markdownViewFor(el: Element): MarkdownView | null {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.containerEl.contains(el)) return view;
    }
    return null;
  }

  private outerCallout(node: Element): HTMLElement | null {
    let callout = node.closest(".callout") as HTMLElement | null;
    while (callout) {
      const outer = callout.parentElement?.closest(".callout") as HTMLElement | null;
      if (!outer) break;
      callout = outer;
    }
    return callout;
  }

  async showAiPending(itemId: number): Promise<boolean> {
    if (this.pendingAi.has(itemId)) return true;
    for (let attempt = 0; attempt < 6; attempt++) {
      if (this.tryShowAiPending(itemId)) return true;
      await new Promise<void>((resolve) => window.setTimeout(resolve, 200));
    }
    return false;
  }

  private tryShowAiPending(itemId: number): boolean {
    const views: MarkdownView[] = [];
    const active = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (active) views.push(active);
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      if (leaf.view instanceof MarkdownView && !views.includes(leaf.view)) {
        views.push(leaf.view);
      }
    }

    for (const view of views) {
      if (view.getMode() !== "preview") continue;
      const links = Array.from(
        view.containerEl.querySelectorAll('a[href*="cmd=ai&"]')
      ) as HTMLAnchorElement[];
      const link = links.find((anchor) => {
        const href = (anchor.getAttribute("href") || anchor.href || "").replace(/&amp;/g, "&");
        return new RegExp(`[?&]item=${itemId}(&|$)`).test(href);
      });
      if (!link) continue;
      const callout = this.outerCallout(link);
      if (!callout || !callout.parentElement) continue;

      const el = document.createElement("div");
      el.className = "it-ai-pending";
      el.dataset.item = String(itemId);
      const infinity = document.createElement("span");
      infinity.className = "it-ai-infinity";
      infinity.setAttribute("aria-hidden", "true");
      // eslint-disable-next-line no-unsanitized/property -- 常量 SVG，不包含外部输入
      infinity.innerHTML = this.infinitySvg();
      const label = document.createElement("span");
      label.className = "it-ai-pending-text";
      label.textContent = "正在研读";
      el.appendChild(infinity);
      el.appendChild(label);
      callout.parentElement.insertBefore(el, callout.nextSibling);
      this.pendingAi.set(itemId, el);

      const timer = window.setTimeout(() => {
        const current = this.pendingAi.get(itemId);
        if (!current) return;
        const text = current.querySelector(".it-ai-pending-text");
        if (text && text.textContent !== "正在写入") text.textContent = "正在思考";
      }, 5000);
      this.pendingTimers.set(itemId, timer);
      return true;
    }
    return false;
  }

  setAiPendingLabel(itemId: number, text: string) {
    const el = this.pendingAi.get(itemId);
    const label = el?.querySelector(".it-ai-pending-text");
    if (label) label.textContent = text;
    const timer = this.pendingTimers.get(itemId);
    if (timer) window.clearTimeout(timer);
    this.pendingTimers.delete(itemId);
  }

  clearAiPending(itemId: number) {
    const el = this.pendingAi.get(itemId);
    if (el) el.remove();
    this.pendingAi.delete(itemId);
    const timer = this.pendingTimers.get(itemId);
    if (timer) window.clearTimeout(timer);
    this.pendingTimers.delete(itemId);
  }

  clearAllAiPending() {
    for (const el of this.pendingAi.values()) el.remove();
    this.pendingAi.clear();
    for (const timer of this.pendingTimers.values()) window.clearTimeout(timer);
    this.pendingTimers.clear();
  }

  private chatDebug(message: string, data?: any) {
    try {
      if (!this.settings.debugMobile) return;
      console.debug(`[under-the-sun] ${message}`, data === undefined ? "" : data);
    } catch {
      // 忽略调试日志失败
    }
  }

  private async visibleAnchor(start: HTMLElement): Promise<HTMLElement | null> {
    let el: HTMLElement | null = start;
    for (let depth = 0; el && depth < 10; depth++) {
      const parent = el.parentElement;
      if (!parent) break;
      const probe = document.createElement("div");
      probe.setCssStyles({ height: "1px", width: "1px", pointerEvents: "none" });
      parent.insertBefore(probe, el.nextSibling);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 30));
      const visible = probe.getClientRects().length > 0;
      probe.remove();
      if (visible) return el;
      el = parent;
    }
    return null;
  }

  private settingMode = false;

  private async setMarkdownMode(view: MarkdownView, mode: "preview" | "source") {
    if (!view.file || this.settingMode) return;
    if (mode === "preview") {
      const preview = view.containerEl.querySelector(
        ".markdown-preview-view"
      ) as HTMLElement | null;
      if (preview && preview.getClientRects().length > 0) return;
    }
    const leaf = this.app.workspace
      .getLeavesOfType("markdown")
      .find((candidate) => candidate.view === view);
    if (!leaf) return;
    this.settingMode = true;
    try {
      await leaf.setViewState({
        type: "markdown",
        state: { file: view.file.path, mode, source: false } as any,
        active: false,
      });
    } catch (err) {
      console.error("info-tracker: 切换视图模式失败", err);
      try {
        await view.setState({ ...view.getState(), mode } as any, { history: false });
      } catch (inner) {
        console.error("info-tracker: setState 也失败", inner);
      }
    } finally {
      this.settingMode = false;
    }
  }

  private async ensureReadingMode(view: MarkdownView): Promise<boolean> {
    const isVisiblePreview = () => {
      const preview = view.containerEl.querySelector(
        ".markdown-preview-view"
      ) as HTMLElement | null;
      return !!preview && preview.getClientRects().length > 0;
    };
    if (isVisiblePreview()) return true;
    await this.setMarkdownMode(view, "preview");
    for (let i = 0; i < 12; i++) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 100));
      if (isVisiblePreview()) return true;
    }
    return false;
  }

  async openInlineChat(
    view: MarkdownView,
    itemId: number,
    title: string,
    retried = false
  ): Promise<boolean> {
    const old = document.querySelector(".it-inline-chat[data-item]");
    old?.remove();

    let link: HTMLAnchorElement | null = null;
    for (let attempt = 0; attempt < 8 && !link; attempt++) {
      const links = Array.from(view.containerEl.querySelectorAll("a")) as HTMLAnchorElement[];
      const matches = links.filter((anchor) => {
        const href = (anchor.getAttribute("href") || anchor.href || "").replace(/&amp;/g, "&");
        return (
          href.includes("cmd=chat") &&
          new RegExp(`[?&]item=${itemId}(&|$)`).test(href)
        );
      });
      const isVisible = (anchor: HTMLAnchorElement) => {
        const host = anchor.closest(
          ".markdown-preview-view, .markdown-source-view"
        ) as HTMLElement | null;
        return !host || host.getClientRects().length > 0;
      };
      // Obsidian 会同时保留阅读视图和隐藏的编辑视图，优先选可见阅读视图里的链接
      link =
        matches.find((anchor) => !anchor.closest(".markdown-source-view") && isVisible(anchor)) ||
        matches.find(isVisible) ||
        matches[0] ||
        null;
      if (!link) await new Promise<void>((resolve) => window.setTimeout(resolve, 150));
    }
    if (!link) return false;

    const chain: string[] = [];
    let cursor: Element | null = link;
    for (let i = 0; cursor && i < 14; i++) {
      const cls = (cursor.className || "").toString().split(/\s+/).slice(0, 2).join(".");
      chain.push(`${cursor.tagName}.${cls}`);
      cursor = cursor.parentElement;
    }
    this.chatDebug("inline:chain", { itemId, chain });

    const inSource = !!link.closest(".markdown-source-view");
    const embed = (link.closest(".cm-embed-block") as HTMLElement | null) || null;

    if (inSource && !retried) {
      // 实时预览里嵌套 callout 会被裁切，先切到阅读视图，让插入方式和其它新闻一致
      const switched = await this.ensureReadingMode(view);
      this.chatDebug("inline:switch-reading", { itemId, switched });
      if (switched) {
        return await this.openInlineChat(view, itemId, title, true);
      }
    }

    const callout = inSource ? null : this.outerCallout(link);
    if (!inSource && (!callout || !callout.parentElement)) return false;
    this.chatDebug("inline:locate", {
      itemId,
      view: view.file?.path || "",
      inSource,
      embed: !!embed,
      callout: !!callout,
    });

    const panel = document.createElement("div");
    panel.className = "it-inline-chat";
    panel.dataset.item = String(itemId);

    const modal = new ChatModal(this.app, this, itemId, title);
    modal.contentEl = panel;
    await modal.onOpen();
    panel.createEl("div", { cls: "it-inline-chat-collapsed", text: "AI 交流" });
    const toggle = panel.createEl("button", {
      cls: "it-inline-chat-close",
      attr: { "aria-label": "收起 AI 交流", title: "收起 AI 交流" },
    });
    setIcon(toggle, "chevron-up");
    toggle.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const collapsed = !panel.hasClass("is-collapsed");
      panel.toggleClass("is-collapsed", collapsed);
      setIcon(toggle, collapsed ? "chevron-down" : "chevron-up");
      const label = collapsed ? "展开 AI 交流" : "收起 AI 交流";
      toggle.setAttr("aria-label", label);
      toggle.setAttr("title", label);
    };

    if (inSource) {
      // 实时预览里 callout 是 .cm-embed-block，插入正文流不生效；
      // 用固定定位贴在对应新闻下方，随滚动跟随。
      const anchorEl = embed || (link.closest(".callout") as HTMLElement | null) || link;
      panel.addClass("it-inline-chat-floating");
      document.body.appendChild(panel);
      const position = () => {
        if (!anchorEl.isConnected) return;
        const r = anchorEl.getBoundingClientRect();
        panel.style.top = `${Math.max(8, Math.min(r.bottom + 6, window.innerHeight - 80))}px`;
        panel.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - panel.offsetWidth - 8))}px`;
      };
      position();
      window.addEventListener("scroll", position, true);
      window.addEventListener("resize", position);
      panel.addEventListener("remove", () => {
        window.removeEventListener("scroll", position, true);
        window.removeEventListener("resize", position);
      });
      this.chatDebug("inline:floating", { itemId });
      new Notice("AI 交流已展开");
      return true;
    }

    callout!.parentElement!.insertBefore(panel, callout!.nextSibling);
    panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    await new Promise<void>((resolve) => window.setTimeout(resolve, 80));
    this.chatDebug("inline:inserted", {
      itemId,
      connected: panel.isConnected,
      rects: panel.getClientRects().length,
      parent: (panel.parentElement?.className || "").toString().slice(0, 80),
    });
    if (!panel.isConnected) {
      panel.remove();
      return false;
    }
    new Notice("AI 交流已展开");
    return true;
  }

  async openChat(itemId: number, title: string, view?: MarkdownView | null) {
    const now = Date.now();
    if (this.lastOpenChatId === itemId && now - this.lastOpenChatAt < 900) return;
    this.lastOpenChatId = itemId;
    this.lastOpenChatAt = now;
    const candidates: MarkdownView[] = [];
    const add = (candidate: MarkdownView | null | undefined) => {
      if (candidate && !candidates.includes(candidate)) candidates.push(candidate);
    };
    add(view);
    add(this.app.workspace.getActiveViewOfType(MarkdownView));
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      if (leaf.view instanceof MarkdownView) add(leaf.view);
    }
    this.chatDebug("openChat", {
      itemId,
      candidates: candidates.map((candidate) => ({
        path: candidate.file?.path || "",
        mode: candidate.getMode(),
      })),
    });

    for (const candidate of candidates) {
      try {
        const ok = await this.openInlineChat(candidate, itemId, title);
        if (ok) return;
      } catch (err) {
        console.error("info-tracker: 内联交流失败，换下一个视图", err);
      }
    }

    // 还没打开：找到包含这条新闻的日报，用阅读视图打开后再内联展开
    const folder = this.view?.status?.digest_folder || "朝闻天下/日报";
    try {
      const ok = await this.openChatInReadingLeaf(itemId, title, folder);
      if (ok) return;
    } catch (err) {
      console.error("info-tracker: 打开日报阅读视图失败", err);
    }

    console.warn("info-tracker: 内联交流定位失败", itemId, candidates);
    this.chatDebug("fallback:none", {
      itemId,
      candidates: candidates.map((candidate) => ({
        path: candidate.file?.path || "",
        mode: candidate.getMode(),
      })),
    });
    new Notice("没找到这条新闻所在的日报，请先打开今日日报");
  }

  private async openChatInReadingLeaf(
    itemId: number,
    title: string,
    folder: string
  ): Promise<boolean> {
    const all = this.app.vault.getMarkdownFiles();
    const seen = new Set<string>();
    const files = all
      .filter((file) => {
        const inFolder = file.path.startsWith(`${folder}/`);
        const dated = /^\d{4}-\d{2}-\d{2}$/.test(file.basename);
        if (!inFolder && !dated) return false;
        if (seen.has(file.path)) return false;
        seen.add(file.path);
        return true;
      })
      .sort((a, b) => b.basename.localeCompare(a.basename))
      .slice(0, 40);
    for (const file of files) {
      let data = "";
      try {
        data = await this.app.vault.cachedRead(file);
      } catch {
        continue;
      }
      const hasItem =
        data.includes(`cmd=chat&item=${itemId}&`) ||
        data.includes(`cmd=chat&item=${itemId})`);
      if (!hasItem) continue;
      const leaf = this.app.workspace.getLeaf("tab");
      await leaf.openFile(file, { state: { mode: "preview" } as any });
      await new Promise<void>((resolve) => window.setTimeout(resolve, 450));
      const view = leaf.view;
      if (view instanceof MarkdownView) {
        return await this.openInlineChat(view, itemId, title);
      }
      return false;
    }
    return false;
  }

  async generateAi(itemId: number) {
    const pendingShown = await this.showAiPending(itemId);
    let statusNotice: Notice | null = null;
    let statusTimer = 0;
    if (!pendingShown) {
      statusNotice = new Notice("AI 解读：正在研读…", 0);
      statusTimer = window.setTimeout(() => {
        statusNotice?.setMessage("AI 解读：正在思考…");
      }, 5000);
    }
    try {
    const status = await this.readStatus();
    const item =
      status?.mobile_items?.find((row) => row.id === itemId) ||
      status?.top_items?.find((row) => row.id === itemId);

    if (this.isMobile()) {
      if (!item) {
        new Notice("手机快照里找不到这条新闻，等电脑端再同步一次");
        return;
      }
      const ai = this.mobileAi();
      if (!ai.available()) {
        new Notice("先在 设置 → 第三方插件 → 朝闻天下 里启用 AI 并填 API Key");
        return;
      }
      new Notice("正在生成 AI 解读…");
      const text = await ai.interpret(item.title, item.summary || "");
      if (!text) {
        new Notice(`AI 解读失败：${ai.error || "检查 API Key"}`);
        return;
      }
      this.setAiPendingLabel(itemId, "正在写入");
      statusNotice?.setMessage("AI 解读：正在写入…");
      await this.insertAi(itemId, text).then((ok) => {
        if (ok) new Notice("AI 解读已插入");
        else new Notice("AI 解读已生成，但没能插入当前日报；请在阅读模式下重试");
      });
      await this.view?.refresh();
      return;
    }

    await this.runCli(["ai-one", "--item", String(itemId)], true, true);
    const line = this.lastLog
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("{"))
      .pop();

    let payload: any = null;
    try {
      payload = line ? JSON.parse(line) : null;
    } catch {
      payload = null;
    }

    if (payload?.ok && payload.text) {
      this.setAiPendingLabel(itemId, "正在写入");
      statusNotice?.setMessage("AI 解读：正在写入…");
      const ok = await this.insertAi(itemId, payload.text);
      await this.runCli(["status"], true);
      new Notice(
        ok
          ? "AI 解读已插入"
          : "AI 解读已生成，但没能插入当前日报；请在阅读模式下重试"
      );
    } else {
      new Notice(`AI 解读失败：${payload?.error || "看主页的运行日志"}`);
    }
    await this.view?.refresh();
    } finally {
      if (statusTimer) window.clearTimeout(statusTimer);
      statusNotice?.hide();
      this.clearAiPending(itemId);
    }
  }

  async generateAllAi(day: string) {
    if (this.isMobile()) {
      new Notice("手机端暂不支持一键批量解读，请到电脑端");
      return;
    }
    const status = await this.readStatus();
    if (!status) {
      new Notice("先刷新状态，再一键解读");
      return;
    }
    if (day !== status.today) {
      new Notice("一键解读目前只支持今天的日报");
      return;
    }
    const items = (status.mobile_items || status.top_items || []).filter(
      (item) => !item.has_ai
    );
    if (!items.length) {
      new Notice("今天所有新闻都已经解读过");
      return;
    }

    new Notice(`开始一键解读 ${items.length} 条，可继续阅读…`, 8000);
    const progress = this.showBatchProgress(items.length);
    const seen = new Set<number>();
    let processed = 0;
    let done = 0;
    let failed = 0;
    let finished = false;

    const consume = async () => {
      const lines = this.lastLog
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("{"));
      while (processed < lines.length) {
        const line = lines[processed++];
        try {
          const payload = JSON.parse(line);
          const id = Number(payload?.item_id || 0);
          if (!id || seen.has(id)) continue;
          seen.add(id);
          if (payload.ok && payload.text) {
            const ok = await this.insertAi(id, String(payload.text));
            if (ok) done += 1;
            else failed += 1;
          } else {
            failed += 1;
          }
        } catch {
          // 单行解析失败就跳过，不影响后面的条目
        }
        progress.update(done + failed);
      }
    };

    try {
      const task = this.runCli(["ai-all", "--day", day], true, true).finally(() => {
        finished = true;
      });
      while (!finished) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 350));
        await consume();
        progress.ensure();
      }
      await consume();
      progress.ensure();
      progress.finish(done);
      new Notice(`AI 一键解读完成：成功 ${done}，失败 ${failed}`);
      await this.runCli(["status"], true, true);
      await this.view?.refresh();
      window.setTimeout(() => progress.remove(), 1800);
    } finally {
      if (!finished) progress.remove();
    }
  }

  private digestRelPath(status: StatusPayload): string {
    if (!status.vault) return status.digest_path;
    return status.digest_path.startsWith(status.vault)
      ? status.digest_path.slice(status.vault.length + 1)
      : status.digest_path;
  }

  async insertAi(itemId: number, text: string): Promise<boolean> {
    const status = await this.readStatus();
    let file: TFile | null = null;
    const active = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
    if (active instanceof TFile && active.extension === "md") {
      const folder = status?.digest_folder || "朝闻天下/日报";
      if (active.path.startsWith(`${folder}/`)) file = active;
    }
    if (!file && status?.digest_exists) {
      const candidate = this.app.vault.getAbstractFileByPath(this.digestRelPath(status));
      if (candidate instanceof TFile) file = candidate;
    }
    if (!file) return false;

    let inserted = false;
    await this.app.vault.process(file, (data) => {
      const lines = data.split("\n");
      const marker = `<!-- t:${itemId} -->`;
      const index = lines.findIndex((line) => line.includes(marker));
      if (index === -1) return data;
      const quoted = lines[index].trimStart().startsWith(">");
      const startMarker = `<!-- it-ai:${itemId}:start -->`;
      if (data.includes(startMarker)) {
        inserted = true;
        return data;
      }

      let linkIndex = index;
      for (let i = index; i >= 0 && i > index - 20; i--) {
        if (lines[i].includes("[原文](") || lines[i].includes("[AI 解读]")) {
          linkIndex = i;
          break;
        }
      }
      const stripAiLink = (line: string) =>
        line
          .replace(/\s*·\s*\[🤖 AI 解读\]\([^)]*\)/g, "")
          .replace(/\s*·\s*\[AI 解读\]\([^)]*\)/g, "");
      lines[linkIndex] = stripAiLink(lines[linkIndex]);
      lines[index] = stripAiLink(lines[index]);

      const chunks = text.split(/\n?\s*===\s*\n?/);
      let summary = chunks.length > 1 ? chunks[0].trim() : "";
      let deep = chunks.length > 1 ? chunks[1].trim() : text.trim();
      summary = summary.replace(/^(一句话|总结)[:：]\s*/, "");
      deep = deep.replace(/^(深度解读|深度思考)[:：]\s*/, "");

      const block: string[] = [];
      if (quoted) {
        block.push(">");
        if (summary) block.push(`> **一句话**：${summary}`);
        if (deep) {
          block.push(">");
          block.push("> > [!ai] 深度解读");
          block.push(`> > ${startMarker}`);
          let firstSection = true;
          for (const line of deep.split("\n").map((l) => l.trim()).filter(Boolean)) {
            if (line.startsWith("【") && !line.includes("】")) continue;
            if (line.startsWith("【") && line.includes("】")) {
              if (!firstSection) block.push("> >");
              const idx = line.indexOf("】");
              const head = line.slice(0, idx).replace(/[【】]/g, "").trim();
              const rest = line.slice(idx + 1).replace(/^[：:\s]+/, "").trim();
              block.push(`> > **${head}**：${rest}`);
              firstSection = false;
            } else {
              block.push("> > " + line);
            }
          }
          block.push(`> > <!-- it-ai:${itemId}:end -->`);
          block.push(">");
        }
      } else {
        if (summary) block.push(`**一句话**：${summary}`);
        if (deep) {
          block.push("");
          block.push(`<!-- it-ai:${itemId}:start -->`);
          for (const line of deep.split("\n").map((l) => l.trim()).filter(Boolean)) {
            block.push(line);
          }
          block.push(`<!-- it-ai:${itemId}:end -->`);
        }
      }
      if (!block.length) return data;

      // 有「原文」链接的，插在链接之前；简讯插在标记行之后
      let insertAt = index;
      for (let i = index; i >= 0 && i > index - 8; i--) {
        if (lines[i].includes("[原文](")) {
          insertAt = i;
          break;
        }
      }
      lines.splice(insertAt, 0, ...block);
      inserted = true;
      return lines.join("\n");
    });
    return inserted;
  }

  async setTracked(itemId: number, tracked: boolean) {
    const status = await this.readStatus();
    if (!status?.digest_exists) {
      new Notice("今天还没有日报");
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(this.digestRelPath(status));
    if (!(file instanceof TFile)) return;

    await this.app.vault.process(file, (data) => {
      const lines = data.split("\n");
      const marker = `<!-- t:${itemId} -->`;
      const index = lines.findIndex((line) => line.includes(marker));
      if (index === -1) return data;
      lines[index] = lines[index].replace(/- \[[ xX]\]/, tracked ? "- [x]" : "- [ ]");
      return lines.join("\n");
    });

    await this.runCli(["watch"], true);
    new Notice(tracked ? "已开始跟踪" : "已取消跟踪");
    await this.view?.refresh();
  }

  async loadSettings() {
    const data = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data, { apiKey: "" });
    this.rssItems = Array.isArray(data?.rssItems) ? data.rssItems : [];
    this.simpleAiText = data?.simpleAiText && typeof data.simpleAiText === "object" ? data.simpleAiText : {};
    this.simpleChats = data?.simpleChats && typeof data.simpleChats === "object" ? data.simpleChats : {};
    if (this.isMobile()) {
      const raw = this.app.loadLocalStorage(MOBILE_SETTINGS_KEY);
      if (typeof raw === "string") {
        try {
          Object.assign(this.settings, JSON.parse(raw));
        } catch {
          // 本地设置损坏时回退到默认值
        }
      }
      const localKey = this.app.loadLocalStorage(MOBILE_AI_KEY);
      if (typeof localKey === "string") this.settings.apiKey = localKey;
    }
  }

  async saveSettings() {
    // 手机端设置全部只存本机，避免手机覆盖电脑端共享的 data.json
    if (this.isMobile()) {
      this.app.saveLocalStorage(MOBILE_AI_KEY, this.settings.apiKey || "");
      this.app.saveLocalStorage(
        MOBILE_SETTINGS_KEY,
        JSON.stringify({
          aiEnabled: this.settings.aiEnabled,
          apiBaseUrl: this.settings.apiBaseUrl,
          model: this.settings.model,
          reasoningEffort: this.settings.reasoningEffort,
          mobileSnapshotPath: this.settings.mobileSnapshotPath,
          rssFeeds: this.settings.rssFeeds,
          rssDigestFolder: this.settings.rssDigestFolder,
          rssMaxItems: this.settings.rssMaxItems,
          rssWatchKeywords: this.settings.rssWatchKeywords,
          showStatusBar: this.settings.showStatusBar,
          lastAlertAt: this.settings.lastAlertAt,
        })
      );
      return;
    }
    // API Key 不写进随 vault 同步的 data.json
    await this.saveSimpleData();
    this.backend = new BackendClient(this.settings.backendUrl, this.settings.backendToken);
  }

  async saveSimpleData() {
    await this.saveData(
      Object.assign({}, this.settings, {
        apiKey: "",
        rssItems: this.rssItems,
        simpleAiText: this.simpleAiText,
        simpleChats: this.simpleChats,
      })
    );
  }

  feedUrls(): string[] {
    return (this.settings.rssFeeds || "")
      .split(/\r?\n/)
      .map((row) => row.trim())
      .filter((row) => row && !row.startsWith("#"));
  }

  rssKeywords(): string[] {
    return (this.settings.rssWatchKeywords || "")
      .split(/\r?\n/)
      .map((row) => row.trim().toLowerCase())
      .filter(Boolean);
  }

  async fetchRss(): Promise<void> {
    const feeds = this.feedUrls();
    if (!feeds.length) {
      new Notice("先在设置里填至少一个 RSS 地址");
      return;
    }
    this.running = true;
    let failed = 0;
    const collected: RssItem[] = [];
    for (const url of feeds) {
      try {
        const res = await requestUrl({
          url,
          headers: { "User-Agent": "Mozilla/5.0 (Obsidian Under the Sun)" },
          throw: false,
        });
        if (res.status < 200 || res.status >= 300) {
          failed += 1;
          continue;
        }
        collected.push(...parseFeed(res.text, url));
      } catch (err) {
        failed += 1;
        console.error("under-the-sun: RSS 失败", url, err);
      }
    }
    const existing = new Map(this.rssItems.map((item) => [item.id, item]));
    const merged = dedupeItems([...collected, ...this.rssItems]).slice(
      0,
      Math.max(10, this.settings.rssMaxItems)
    );
    for (const item of merged) {
      const previous = existing.get(item.id);
      if (previous) {
        item.read = previous.read;
        item.translated = previous.translated;
      }
    }
    this.rssItems = merged;
    this.running = false;
    await this.saveSimpleData();
    await this.view?.refresh();
    new Notice(failed ? `RSS 已刷新，${failed} 个源失败` : "RSS 已刷新");
  }

  async writeRssDigest(): Promise<void> {
    if (!this.rssItems.length) {
      new Notice("还没有新闻，先刷新 RSS");
      return;
    }
    const day = new Date().toISOString().slice(0, 10);
    const folder = normalizePath(
      this.settings.rssDigestFolder || "朝闻天下/RSS日报"
    );
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
      `> 来源：${this.feedUrls().length} 个 RSS · 共 ${this.rssItems.length} 条`,
      "",
    ];
    for (const item of this.rssItems) {
      lines.push(`> [!rss] ${item.title}`, ">");
      const text = item.translated || item.summary;
      if (text) lines.push(`> ${text}`, ">");
      const meta = [item.feed, item.date ? item.date.slice(0, 10) : ""]
        .filter(Boolean)
        .join(" · ");
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

  private digestRelativePath(status: StatusPayload): string {
    if (!status.vault) return status.digest_path;
    return status.digest_path.startsWith(status.vault)
      ? status.digest_path.slice(status.vault.length + 1)
      : status.digest_path;
  }

  async currentDigest(): Promise<{ file: TFile; markdown: string } | null> {
    const status = await this.readStatus();
    let rel = "";
    if (status?.digest_exists) {
      rel = this.digestRelativePath(status);
    } else {
      const day = new Date().toISOString().slice(0, 10);
      const folder = normalizePath(this.settings.rssDigestFolder || "朝闻天下/RSS日报");
      rel = normalizePath(`${folder}/${day}.md`);
    }
    const file = this.app.vault.getAbstractFileByPath(rel);
    if (!(file instanceof TFile)) return null;
    return { file, markdown: await this.app.vault.read(file) };
  }

  async copyDigest(): Promise<void> {
    const digest = await this.currentDigest();
    if (!digest) {
      new Notice("今天还没有日报");
      return;
    }
    const ok = await copyText(digest.markdown);
    new Notice(ok ? "今日日报已复制为 Markdown" : "复制失败，请重试");
  }

  async exportDigestHtml(): Promise<void> {
    const digest = await this.currentDigest();
    if (!digest) {
      new Notice("今天还没有日报");
      return;
    }
    const component = new Component();
    component.load();
    try {
      const body = document.createElement("div");
      await MarkdownRenderer.render(this.app, digest.markdown, body, "", component);
      const day = digest.file.basename;
      const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${day} 朝闻天下</title>
<style>
body{max-width:820px;margin:40px auto;padding:0 20px;font:16px/1.75 -apple-system,BlinkMacSystemFont,"PingFang SC","Noto Sans SC",sans-serif;color:#26231f;background:#f6f2ea}
h1,h2,h3{line-height:1.3} a{color:#b23a2f} blockquote{border-left:3px solid #b23a2f;margin:1em 0;padding:.2em 1em;background:#fffdf8}
code{background:#efe9de;padding:.1em .35em;border-radius:3px} pre{overflow:auto;padding:12px;background:#fffdf8}
.callout{border:1px solid #dfd8cb;border-radius:6px;padding:10px 14px;margin:12px 0;background:#fffdf8}
.callout-title{font-weight:600}
</style></head><body>${body.innerHTML}</body></html>`;
      const folder = normalizePath("朝闻天下/导出");
      if (!this.app.vault.getAbstractFileByPath(folder)) {
        await this.app.vault.createFolder(folder);
      }
      const path = normalizePath(`${folder}/${day}.html`);
      const existing = this.app.vault.getAbstractFileByPath(path);
      if (existing instanceof TFile) {
        await this.app.vault.modify(existing, html);
      } else {
        await this.app.vault.create(path, html);
      }
      new Notice(`已导出：${path}`);
    } catch (err) {
      console.error("under-the-sun: 导出 HTML 失败", err);
      new Notice("导出失败，看控制台");
    } finally {
      component.unload();
    }
  }

  async simpleInterpret(item: RssItem): Promise<void> {
    const ai = this.mobileAi();
    if (!ai.available()) {
      new Notice("先在设置里启用 AI 并填 API Key");
      return;
    }
    const text = await ai.interpret(item.title, item.summary);
    if (!text) {
      new Notice(`AI 解读失败：${ai.error || "没有返回内容"}`);
      return;
    }
    this.simpleAiText[item.id] = text;
    await this.saveSimpleData();
    await this.view?.refresh();
  }

  async simpleChat(item: RssItem, message: string): Promise<string> {
    const ai = this.mobileAi();
    if (!ai.available()) {
      new Notice("先在设置里启用 AI 并填 API Key");
      return "";
    }
    const history = this.simpleChats[item.id] || [];
    const next = history.concat([{ role: "user", content: message }]);
    const answer = await ai.chat(
      item.title,
      item.summary,
      next,
      this.simpleAiText[item.id] || ""
    );
    if (answer) {
      next.push({ role: "assistant", content: answer });
      this.simpleChats[item.id] = next.slice(-20);
      await this.saveSimpleData();
      await this.view?.refresh();
    }
    return answer;
  }

  async translateItem(item: RssItem): Promise<void> {
    const text = await translateText(item.summary || item.title);
    if (!text) {
      new Notice("翻译失败，或内容已经是中文");
      return;
    }
    item.translated = text;
    await this.saveSimpleData();
    await this.view?.refresh();
  }

  async toggleRead(item: RssItem): Promise<void> {
    item.read = !item.read;
    await this.saveSimpleData();
    await this.view?.refresh();
  }
}

export class TrackerHomeView extends ItemView {
  plugin: InfoTrackerPlugin;
  status: StatusPayload | null = null;
  busy = false;
  private logEl: HTMLElement | null = null;
  private openSimpleChat = "";
  private busyTimer = 0;
  private rssQuery = "";
  private rssFilter: "all" | "unread" | "watch" = "all";

  constructor(leaf: WorkspaceLeaf, plugin: InfoTrackerPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return VIEW_TYPE;
  }

  getDisplayText() {
    return "朝闻天下";
  }

  getIcon() {
    return "";
  }

  async onOpen() {
    await this.refresh();
  }

  async onClose() {
    this.stopBusyTimer();
  }

  async refresh() {
    await this.plugin.checkBackend();
    this.status = await this.plugin.readStatus();
    this.render();
    this.updateLog(this.plugin.lastLog);
  }

  setBusy(busy: boolean) {
    this.busy = busy;
    const bar = this.contentEl.querySelector(".it-busy") as HTMLElement | null;
    if (bar) {
      bar.toggleClass("is-hidden", !busy);
      if (busy) this.startBusyTimer(bar);
      else {
        this.stopBusyTimer();
        delete bar.dataset.tip;
        bar.setText("正在运行…");
      }
    }
    this.contentEl.querySelectorAll("button.it-action").forEach((btn) => {
      (btn as HTMLButtonElement).disabled = busy;
    });
    const stop = this.contentEl.querySelector("button.it-stop") as HTMLButtonElement | null;
    if (stop) stop.disabled = !busy;
  }

  private startBusyTimer(bar: HTMLElement) {
    this.stopBusyTimer();
    const started = this.plugin.runStartedAt || Date.now();
    const label = this.plugin.runLabel;
    const estimate =
      label === "run"
        ? "1–3 分钟"
        : label === "fetch"
          ? "30–90 秒"
          : label === "ai-all"
            ? "2–5 分钟"
            : "几秒到 1 分钟";
    const tips =
      label === "run"
        ? [
            "正在抓取热榜和 RSS…",
            "正在补全正文…",
            "正在去重和聚类…",
            "正在打分排序…",
            "正在更新跟踪…",
            "正在排版今天的报纸…",
          ]
        : label === "fetch"
          ? ["正在抓取热榜和 RSS…", "正在写入本地素材库…"]
          : label === "ai-all"
            ? ["正在生成 AI 解读…", "正在整理判断材料…"]
            : ["正在处理…"];
    const tick = () => {
      const elapsed = Math.floor((Date.now() - started) / 1000);
      const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
      const ss = String(elapsed % 60).padStart(2, "0");
      const tip = tips[Math.floor(elapsed / 4) % tips.length];
      bar.dataset.tip = tip;
      bar.setText(
        `正在运行… 已用 ${mm}:${ss} · 预计 ${estimate} · 悬停查看当前步骤`
      );
    };
    tick();
    this.busyTimer = window.setInterval(tick, 1000);
  }

  private stopBusyTimer() {
    if (this.busyTimer) {
      window.clearInterval(this.busyTimer);
      this.busyTimer = 0;
    }
  }

  updateLog(text: string) {
    if (!this.logEl) return;
    this.logEl.setText(text || "（还没有运行记录）");
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  render() {
    const root = this.contentEl;
    root.empty();
    root.addClass("it-root");

    const status = this.status;
    const mobile = this.plugin.isMobile();

    const heading = root.createDiv({ cls: "it-head" });
    heading.createEl("h2", { text: "朝闻天下", cls: "it-title" });
    const sub = heading.createDiv({ cls: "it-sub" });
    if (!status) {
      sub.setText(
        mobile
          ? "还没收到电脑端快照。先在电脑端运行一次，或等每天 07:00 抓取后同步过来。"
          : "本地增强服务未连接。先安装本地增强服务，或继续使用轻量模式。"
      );
    } else {
      sub.setText(
        `${status.today} · 今日${status.digest_exists ? "已生成" : "未生成"} · 库存 ${
          status.stats.items
        } 条 · 跟踪 ${status.stats.watches} 条${mobile ? " · 手机端只读" : ""}`
      );
    }

    const schedule = status?.schedule;
    if (schedule) {
      const line = root.createDiv({ cls: "it-schedule-line" });
      line.createEl("span", {
        text: `抓取时间：每天 ${schedule.morning || "07:00"} 出报 · ${
          schedule.evening || "19:00"
        } ${schedule.eveningDigest ? "出报" : "收集"}${schedule.enabled === false ? "（已暂停）" : ""}`,
      });
      const edit = line.createEl("button", { text: "修改", cls: "it-mini" });
      edit.onclick = () => {
        const app = this.app as any;
        app.setting?.open?.();
        app.setting?.openTabById?.(this.plugin.manifest.id);
      };
    }

    const busy = root.createEl("div", { cls: "it-busy is-hidden", text: "正在运行…" });
    busy.toggleClass("is-hidden", !this.busy);
    if (this.busy) this.startBusyTimer(busy);

    if (!this.plugin.backendHealth.ok) {
      this.renderSimpleMode(root);
      return;
    }

    this.renderBackendBar(root);
    this.renderAI(root, status);
    this.renderActions(root);

    if (status?.alerts?.unread) this.renderAlerts(root, status);

    if (this.plugin.settings.showJudgments) this.renderJudgments(root, status);
    this.renderHistory(root, status, !mobile);
    if (mobile) {
      this.renderMobileHint(root, status);
    } else {
      this.renderSources(root, status);
    }

    const logHead = root.createEl("div", { cls: "it-section-head" });
    logHead.createEl("span", { text: "运行日志" });
    const refreshBtn = logHead.createEl("button", { text: "刷新", cls: "it-mini" });
    refreshBtn.onclick = () => this.refresh();

    this.logEl = root.createEl("pre", { cls: "it-log" });
    this.updateLog(this.plugin.lastLog);
  }

  private renderSimpleMode(root: HTMLElement) {
    const plugin = this.plugin;

    const card = root.createDiv({ cls: "it-card it-backend-card" });
    const cardHead = card.createDiv({ cls: "it-section-head" });
    cardHead.createEl("span", { text: "本地增强服务" });
    cardHead.createEl("span", { cls: "it-badge on", text: "推荐" });
    card.createDiv({
      cls: "it-hint",
      text: "安装后解锁完整能力；不安装也能继续使用下面的 RSS + AI + 日报。",
    });
    const features = card.createEl("ul", { cls: "it-enhancer-features" });
    for (const text of [
      "热榜：百度、微博、知乎、小红书、B站、抖音等",
      "正文补全、聚类、打分排序",
      "跟踪时间线与新进展提醒",
      "判断簿与复核",
      "每天 07:00 / 19:00 自动收集、出报",
    ]) {
      features.createEl("li", { text });
    }
    const actions = card.createDiv({ cls: "it-actions" });
    const install = actions.createEl("button", {
      text: "安装本地增强服务",
      cls: "mod-cta",
    });
    install.onclick = () => plugin.openInstallGuide();
    const check = actions.createEl("button", { text: "检测连接", cls: "it-mini" });
    check.onclick = async () => {
      const health = await plugin.checkBackend();
      new Notice(health.ok ? "本地增强服务已连接" : "仍然未连接，请确认安装器已完成");
      await this.refresh();
    };
    card.createDiv({
      cls: "it-hint",
      text: "安装器只装增强服务，不覆盖插件，也不会影响现有 RSS 和 AI 设置；可随时卸载。",
    });

    const list = root.createDiv({ cls: "it-card" });
    const head = list.createDiv({ cls: "it-section-head" });
    const countEl = head.createEl("span");

    const tools = list.createDiv({ cls: "it-actions" });
    const refresh = tools.createEl("button", { text: "刷新 RSS", cls: "it-mini mod-cta" });
    refresh.onclick = () => void plugin.fetchRss();
    const digest = tools.createEl("button", { text: "生成今日日报", cls: "it-mini" });
    digest.onclick = () => void plugin.writeRssDigest();
    const allRead = tools.createEl("button", { text: "全部已读", cls: "it-mini" });
    allRead.onclick = async () => {
      for (const item of plugin.rssItems) item.read = true;
      await plugin.saveSimpleData();
      await this.refresh();
    };

    if (!plugin.feedUrls().length) {
      list.createDiv({
        cls: "it-hint",
        text: "还没有 RSS 来源。打开 设置 → 第三方插件 → Under the Sun，在「RSS 地址」里一行填一个。",
      });
      return;
    }
    if (!plugin.rssItems.length) {
      list.createDiv({
        cls: "it-hint",
        text: "还没有新闻。点上面的「刷新 RSS」。",
      });
      return;
    }

    const search = list.createEl("input", {
      type: "text",
      cls: "it-input it-rss-search",
      placeholder: "搜索标题、摘要、来源",
    });
    search.value = this.rssQuery;

    const filterRow = list.createDiv({ cls: "it-rss-filters" });
    const buttons: Record<string, HTMLButtonElement> = {};
    const applyFilter = () => {
      for (const [key, button] of Object.entries(buttons)) {
        button.toggleClass("is-active", this.rssFilter === key);
      }
      this.renderSimpleItems(listBody, countEl);
    };
    for (const [key, label] of [
      ["all", "全部"],
      ["unread", "未读"],
      ["watch", "关注"],
    ] as Array<["all" | "unread" | "watch", string]>) {
      const button = filterRow.createEl("button", { text: label, cls: "it-mini" });
      buttons[key] = button;
      button.onclick = () => {
        this.rssFilter = key;
        applyFilter();
      };
    }
    search.oninput = () => {
      this.rssQuery = search.value;
      this.renderSimpleItems(listBody, countEl);
    };

    const listBody = list.createDiv({ cls: "it-rss-list" });
    applyFilter();
  }

  private renderSimpleItems(container: HTMLElement, countEl: HTMLElement) {
    const plugin = this.plugin;
    container.empty();
    const query = this.rssQuery.trim().toLowerCase();
    const keywords = plugin.rssKeywords();
    const matches = (item: RssItem) =>
      keywords.some((keyword) =>
        `${item.title} ${item.summary}`.toLowerCase().includes(keyword)
      );
    const items = plugin.rssItems.filter((item) => {
      if (this.rssFilter === "unread" && item.read) return false;
      if (this.rssFilter === "watch" && !matches(item)) return false;
      if (
        query &&
        !`${item.title} ${item.summary} ${item.feed}`.toLowerCase().includes(query)
      ) {
        return false;
      }
      return true;
    });
    const unread = plugin.rssItems.filter((item) => !item.read).length;
    countEl.setText(`RSS 新闻 · ${items.length} 条 / ${unread} 未读`);
    if (!items.length) {
      container.createDiv({ cls: "it-hint", text: "没有匹配的新闻" });
      return;
    }

    for (const item of items.slice(0, 80)) {
      const row = container.createDiv({
        cls: `it-news${item.read ? " is-read" : ""}`,
      });
      const title = row.createDiv({ cls: "it-news-title", text: item.title });
      title.onclick = () => {
        if (item.link) window.open(item.link);
        if (!item.read) void plugin.toggleRead(item);
      };
      if (matches(item)) {
        row.createEl("span", { cls: "it-keyword-badge", text: "关注" });
      }
      row.createDiv({
        cls: "it-news-meta",
        text: `${item.feed}${item.date ? " · " + item.date.slice(0, 16).replace("T", " ") : ""}`,
      });
      const text = item.translated || item.summary;
      if (text) row.createDiv({ cls: "it-hint", text });

      const rowActions = row.createDiv({ cls: "it-news-actions" });
      const read = rowActions.createEl("button", {
        text: item.read ? "标为未读" : "标为已读",
        cls: "it-mini",
      });
      read.onclick = () => void plugin.toggleRead(item);
      const translate = rowActions.createEl("button", { text: "翻译", cls: "it-mini" });
      translate.onclick = () => void plugin.translateItem(item);
      const ai = rowActions.createEl("button", { text: "AI 解读", cls: "it-mini" });
      ai.onclick = () => void plugin.simpleInterpret(item);
      const chat = rowActions.createEl("button", { text: "AI 交流", cls: "it-mini" });
      chat.onclick = async () => {
        this.openSimpleChat = this.openSimpleChat === item.id ? "" : item.id;
        this.render();
      };

      const aiText = plugin.simpleAiText[item.id];
      if (aiText) {
        const box = row.createDiv({ cls: "it-rss-ai" });
        box.setText(aiText);
      }
      if (this.openSimpleChat === item.id) {
        this.renderSimpleChat(row, item);
      }
    }
  }

  private renderSimpleChat(row: HTMLElement, item: RssItem) {
    const plugin = this.plugin;
    const box = row.createDiv({ cls: "it-rss-chat" });
    const messages = box.createDiv({ cls: "it-rss-messages" });
    const history = plugin.simpleChats[item.id] || [];
    for (const message of history) {
      const line = messages.createDiv({ cls: `it-rss-msg ${message.role}` });
      line.setText(`${message.role === "user" ? "我" : "AI"}：${message.content}`);
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
      const answer = await plugin.simpleChat(item, text);
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

  private renderBackendBar(root: HTMLElement) {
    const health = this.plugin.backendHealth;
    const bar = root.createDiv({ cls: "it-backend-bar" });
    const button = bar.createEl("div", {
      cls: `it-backend-open${health.ok ? " is-connected" : ""}`,
      attr: { role: "button", tabindex: "0" },
    });
    button.createEl("span", { text: "本地增强服务" });
    const mismatch = health.ok && !!health.api && health.api !== BACKEND_API;
    button.createEl("span", {
      cls: `it-badge ${health.ok && !mismatch ? "on" : "off"}`,
      text: health.ok
        ? `${health.version ? `v${health.version} · ` : ""}${mismatch ? "需更新" : "已连接"}`
        : "未连接",
    });
    const open = () => new BackendSettingsModal(this.app, this.plugin).open();
    button.onclick = open;
    button.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    });
  }

  private renderActions(root: HTMLElement) {
    const box = root.createEl("div", { cls: "it-actions" });

    if (this.plugin.isMobile()) {
      const open = box.createEl("button", { text: "打开今日日报", cls: "it-action mod-cta" });
      open.onclick = () => this.openToday();
      const refresh = box.createEl("button", { text: "刷新快照", cls: "it-action" });
      refresh.onclick = () => this.refresh();
      return;
    }

    const run = box.createEl("button", { text: "抓取并出报", cls: "it-action mod-cta" });
    run.onclick = () => void this.plugin.runWithConfirm();

    const open = box.createEl("button", { text: "打开今日日报", cls: "it-action" });
    open.onclick = () => this.openToday();

    const stop = box.createEl("button", { text: "停止", cls: "it-action it-stop" });
    stop.disabled = !this.busy;
    stop.onclick = () => this.plugin.stopRun();
  }

  private renderMobileHint(root: HTMLElement, status: StatusPayload | null) {
    const card = root.createEl("div", { cls: "it-card" });
    card.createEl("div", { cls: "it-section-head", text: "手机端说明" });
    card.createEl("div", {
      cls: "it-hint",
      text:
        "抓取、正文补全、来源开关、Cookie 和判断卡新建/复核都只在电脑端。" +
        "跟踪和已读可以直接在日报里勾选，电脑端下次运行会同步。" +
        "手机端读取电脑同步过来的快照和日报；AI 解读与 AI 交流需要先在 " +
        "设置 → 第三方插件 → 朝闻天下 里启用 AI 并填 API Key。" +
        (status?.generated_at ? ` 快照生成于 ${status.generated_at.slice(0, 16).replace("T", " ")}。` : ""),
    });
  }

  private renderJudgments(root: HTMLElement, status: StatusPayload | null) {
    const items = status?.judgments || [];
    const card = root.createEl("div", { cls: "it-card" });
    const head = card.createEl("div", { cls: "it-section-head" });
    head.createEl("span", { text: items.length ? `判断簿（${items.length}）` : "判断簿" });

    if (!items.length) {
      card.createEl("div", {
        cls: "it-hint",
        text: this.plugin.isMobile()
          ? "还没有判断卡。手机端判断簿只读，新建和复核在电脑端完成。"
          : "还没有判断卡。可以从今日新闻里选一条，AI 会先起草，你确认后才会入库。",
      });
      if (!this.plugin.isMobile()) {
        const create = card.createEl("button", {
          text: "从今日新闻新建判断",
          cls: "it-mini mod-cta",
        });
        create.onclick = () => this.openJudgmentPicker();
      }
      return;
    }

    for (const item of items.slice(0, 8)) {
      const row = card.createEl("div", { cls: "it-judgment" });
      const title = row.createEl("div", { cls: "it-judgment-claim", text: item.claim });
      title.onclick = () => window.open(item.url);

      const meta = row.createEl("div", { cls: "it-judgment-meta" });
      const counts = item.evidence_counts;
      const evidenceText =
        counts && (counts.support || counts.contradict || counts.neutral)
          ? ` · 证据 支持${counts.support || 0}/反驳${counts.contradict || 0}`
          : "";
      meta.setText(
        `v${item.version} · 置信度 ${item.confidence}% · ${item.status} · ${item.claim_type} · ${
          item.updated_at ? item.updated_at.slice(0, 10) : ""
        }${evidenceText}`
      );

      if (item.change_reason) {
        row.createEl("div", { cls: "it-judgment-reason", text: item.change_reason });
      }

      const actions = row.createEl("div", { cls: "it-judgment-actions" });
      if (!this.plugin.isMobile()) {
        const review = actions.createEl("button", { text: "复核判断", cls: "it-mini" });
        review.onclick = () => this.reviewJudgment(item.id, item.item_id);
      }

      const open = actions.createEl("button", { text: "原文", cls: "it-mini" });
      open.onclick = () => window.open(item.url);
    }

    if (this.plugin.isMobile()) {
      card.createEl("div", {
        cls: "it-hint",
        text: "手机端判断簿只读；新建和复核在电脑端完成，下次同步后这里会更新。",
      });
    }
  }

  openJudgmentPicker() {
    const items = this.status?.mobile_items || this.status?.top_items || [];
    if (!items.length) {
      new Notice("今天的日报还没有生成，先抓取并出报");
      return;
    }
    new JudgmentPickerModal(this.app, items, (itemId) => {
      void this.draftJudgment(itemId);
    }).open();
  }

  async draftJudgment(itemId: number) {
    if (this.busy) {
      new Notice("正在运行，请稍候");
      return;
    }
    new Notice("正在生成判断草案…");
    await this.plugin.runCli(["judge", "--item", String(itemId)], true);
    const payload = lastJsonLine(this.plugin.lastLog);
    if (!payload?.ok || !payload.card) {
      new Notice(`判断草案失败：${payload?.error || "看主页运行日志"}`);
      return;
    }
    new JudgmentModal(this.app, this.plugin, this, {
      itemId,
      card: payload.card,
      baseCard: payload.card,
    }).open();
  }

  async reviewJudgment(judgmentId: number, itemId: number) {
    if (this.busy) {
      new Notice("正在运行，请稍候");
      return;
    }
    new Notice("正在结合新事实复核判断…");
    await this.plugin.runCli(["judge-review", "--id", String(judgmentId)], true);
    const payload = lastJsonLine(this.plugin.lastLog);
    if (!payload?.ok || !payload.card) {
      new Notice(`复核失败：${payload?.error || "看主页运行日志"}`);
      return;
    }
    new JudgmentModal(this.app, this.plugin, this, {
      itemId: payload.item_id || itemId,
      judgmentId,
      card: payload.card,
      baseCard: payload.current || payload.card,
      reason: payload.card.change_reason || "复核后修订",
      status: payload.card.status_suggestion || payload.card.status,
    }).open();
  }

  private renderHistory(root: HTMLElement, status: StatusPayload | null, withAdd = false) {
    const items = status?.history || [];

    const card = root.createEl("div", { cls: "it-card" });
    card.createEl("div", { cls: "it-section-head", text: "跟踪话题" });

    if (!items.length) {
      card.createEl("div", {
        cls: "it-hint",
        text: "还没有跟踪话题。在日报里勾选「跟踪」，或在下面添加一个链接。",
      });
    }

    items.slice(0, 6).forEach((item) => {
      const row = card.createEl("div", { cls: "it-history" });

      const head = row.createEl("div", { cls: "it-history-head" });
      const link = head.createEl("a", { text: item.title, cls: "it-history-title" });
      link.onclick = (event) => {
        event.preventDefault();
        this.app.workspace.openLinkText(item.note, "", false);
      };
      head.createEl("span", {
        cls: "it-history-count",
        text: `${item.count} 条历史 · ${item.updates} 条进展`,
      });

      const first = row.createEl("div", { cls: "it-history-first" });
      if (item.first_title) {
        first.setText(`最早：${item.first_date} · ${item.first_source} · `);
        const a = first.createEl("a", { text: item.first_title, cls: "it-history-link" });
        a.href = item.first_url;
        a.target = "_blank";
      } else {
        first.setText("还没有历史记录，会随着抓取慢慢积累");
      }

      if (!this.plugin.isMobile()) {
        const flags = row.createEl("div", { cls: "it-history-flags" });

        const mkFlag = (label: string, key: string, value: number) => {
          const lab = flags.createEl("label", { cls: "it-flag" });
          const box = lab.createEl("input", { type: "checkbox" });
          box.checked = !!value;
          lab.createEl("span", { text: label });
          box.onchange = async () => {
            await this.plugin.runCli(
              ["watch-flags", "--watch", String(item.watch_id), `--${key}`, box.checked ? "1" : "0"],
              true
            );
            await this.refresh();
          };
        };
        mkFlag("向前跟踪", "backward", item.backward);
        mkFlag("向后跟踪", "forward", item.forward);

        const again = flags.createEl("button", { text: "重新搜索", cls: "it-mini" });
        again.onclick = () => this.plugin.runCli(["research", "--watch", String(item.watch_id)]);

        const deepBtn = flags.createEl("button", {
          text: item.deep ? "再扩大范围" : "扩大范围",
          cls: "it-mini",
        });
        deepBtn.onclick = () =>
          this.plugin.runCli(["research", "--watch", String(item.watch_id), "--deep"]);
      }
    });

    if (withAdd) this.renderCustomAdd(card, status);
  }

  private renderCustomAdd(host: HTMLElement, status: StatusPayload | null) {
    const wrap = host.createEl("details", { cls: "it-add" });
    const summary = wrap.createEl("summary", { cls: "it-add-summary" });
    summary.createEl("span", { cls: "it-add-title", text: "手动添加跟踪" });
    summary.createEl("span", { cls: "it-add-action" });

    const form = wrap.createEl("div", { cls: "it-form" });
    const url = form.createEl("input", { type: "text", cls: "it-input" });
    url.placeholder = "粘贴一个链接";

    const title = form.createEl("input", { type: "text", cls: "it-input" });
    title.placeholder = "标题（可留空，自动抓取）";

    const row = form.createEl("div", { cls: "it-form-row" });
    const select = row.createEl("select", { cls: "it-input" });
    select.createEl("option", { value: "", text: "新建一个跟踪话题" });
    for (const item of status?.history || []) {
      select.createEl("option", {
        value: String(item.watch_id),
        text: item.title.slice(0, 40),
      });
    }

    const btn = row.createEl("button", { text: "添加并跟踪", cls: "mod-cta" });
    btn.onclick = async () => {
      if (!url.value.trim()) {
        new Notice("先填链接");
        return;
      }
      const args = ["add", "--url", url.value.trim()];
      if (title.value.trim()) args.push("--title", title.value.trim());
      if (select.value) args.push("--watch", select.value);
      await this.plugin.runCli(args);
      url.value = "";
      title.value = "";
      await this.refresh();
    };
  }

  private renderAlerts(root: HTMLElement, status: StatusPayload) {
    const card = root.createEl("div", { cls: "it-card it-alerts" });
    card.createEl("div", {
      cls: "it-section-head",
      text: `🔔 跟踪有新进展（${status.alerts.unread}）`,
    });
    for (const item of status.alerts.items.slice(0, 8)) {
      const row = card.createEl("div", { cls: "it-alert-row" });
      const link = row.createEl("a", { text: item.headline, cls: "it-alert-title" });
      link.href = item.url;
      link.target = "_blank";
      const meta = row.createEl("div", { cls: "it-alert-meta" });
      meta.setText(`${item.source} · ${item.time.slice(5, 16)} · `);
      const noteLink = meta.createEl("a", { text: "打开链条", cls: "it-alert-note" });
      noteLink.onclick = (event) => {
        event.preventDefault();
        this.app.workspace.openLinkText(item.note, "", false);
      };
    }
  }

  private renderSources(root: HTMLElement, status: StatusPayload | null) {
    const card = root.createEl("details", { cls: "it-card it-sources-card" });
    const summary = card.createEl("summary", { cls: "it-sources-summary" });
    if (!status) {
      summary.createEl("span", { cls: "it-sources-title", text: "选择来源" });
      return;
    }
    const count = (list: SourceInfo[]) =>
      `${list.filter((source) => source.enabled).length}/${list.length}`;
    const cn = status.sources.filter((source) => source.region === "cn");
    const intl = status.sources.filter((source) => source.region !== "cn");
    summary.createEl("span", { cls: "it-sources-title", text: "选择来源" });
    summary.createEl("span", {
      cls: "it-sources-meta",
      text: `国内 ${count(cn)} · 国外 ${count(intl)}`,
    });
    summary.createEl("span", { cls: "it-sources-action" });
    const names = status.sources
      .filter((source) => source.enabled)
      .slice(0, 6)
      .map((source) => source.label);
    summary.createEl("span", {
      cls: "it-sources-preview",
      text: names.length
        ? `${names.join(" · ")}${status.sources.length > names.length ? ` · 等 ${status.sources.length} 个来源` : ""}`
        : "还没有启用来源",
    });

    const grid = card.createEl("div", { cls: "it-sources" });
    const groups: Record<string, SourceInfo[]> = { cn: [], intl: [] };
    for (const source of status.sources) {
      (groups[source.region] || (groups[source.region] = [])).push(source);
    }

    for (const [region, list] of Object.entries(groups)) {
      if (!list.length) continue;
      const block = grid.createEl("div", { cls: "it-source-group" });
      block.createEl("div", {
        cls: "it-source-group-title",
        text: region === "intl" ? "国外" : "国内",
      });
      for (const source of list) {
        const row = block.createEl("label", { cls: "it-source" });
        const checkbox = row.createEl("input", { type: "checkbox" });
        checkbox.checked = source.enabled;
        row.createEl("span", { text: source.label });
        const login = LOGIN_ENTRIES.find((entry) =>
          source.key.toLowerCase().includes(entry.key)
        );
        const logged = !!(login && status.cookies?.[login.key]);
        if (login) {
          row.createEl("span", {
            cls: `it-source-badge ${logged ? "is-on" : ""}`,
            text: logged ? "已登录" : "未登录",
          });
        }
        checkbox.onchange = async () => {
          if (login && !logged && checkbox.checked) {
            checkbox.checked = false;
            new Notice(`${source.label} 需要先登录 Cookie；请在下方「登录态」里完成登录`);
            card
              .querySelector(".it-cookie-block")
              ?.scrollIntoView({ behavior: "smooth", block: "center" });
            return;
          }
          if (source.key.startsWith("rss:") && source.url) {
            await this.plugin.runCli(
              ["toggle-feed", "--url", source.url, "--on", checkbox.checked ? "1" : "0"],
              true
            );
          } else {
            await this.plugin.saveOverrides({
              sources: { [source.key]: { enabled: checkbox.checked } },
            });
          }
          await this.plugin.runCli(["status"], true);
          await this.refresh();
        };
      }
    }

    if (intl.length) {
      const hint = card.createEl("div", { cls: "it-hint it-sources-hint" });
      hint.createEl("span", { cls: "it-hint-label", text: "国外来源：" });
      hint.createEl("span", { cls: "it-hint-emphasis", text: "不开启 AI" });
      hint.createEl("span", { text: " 时保留 " });
      hint.createEl("span", { cls: "it-hint-strong", text: "外文原文" });
      hint.createEl("span", { text: "，不会自动翻译成中文。" });
    }

    this.renderCookies(card, status);
  }

  private renderCookies(host: HTMLElement, status: StatusPayload | null) {
    const card = host.createEl("div", { cls: "it-cookie-block" });
    card.createEl("div", { cls: "it-subhead", text: "登录态（仅需登录的来源）" });

    const saved = status?.cookies || {};
    const meta = status?.cookie_meta || {};

    const loginRow = card.createEl("div", { cls: "it-login-row" });
    for (const entry of LOGIN_ENTRIES) {
      const logged = !!saved[entry.key];
      const button = loginRow.createEl("button", {
        text: `打开${entry.label}登录页`,
        cls: "it-mini",
      });
      button.onclick = () => {
        window.open(entry.url, "_blank");
        new Notice(
          `已打开${entry.label}登录页。登录后按 F12 → Network → 刷新，复制任意请求的 Cookie。${entry.label} Cookie ${entry.validity}。`,
          12000
        );
      };
      loginRow.createEl("span", {
        cls: `it-source-badge ${logged ? "is-on" : ""}`,
        text: logged ? "已登录" : "未登录",
      });
    }

    const guide = card.createEl("div", { cls: "it-cookie-guide" });
    guide.createEl("div", {
      text: "点「打开登录页」登录，登录成功后把 Cookie 粘贴到下面。",
    });
    guide.createEl("div", {
      text: "手动方式：登录成功后按 F12 → Network → 刷新页面 → 点任意请求 → 复制请求头里的 Cookie，粘贴到下面。",
    });
    guide.createEl("div", {
      text: "有效期：微博通常 7–30 天，知乎约 30 天，小红书约 7–14 天。平台也可能随时提前失效；抓不到数据时重新登录一次即可。",
    });

    const form = card.createEl("div", { cls: "it-form" });

    const makeField = (key: string, label: string) => {
      const input = form.createEl("input", { type: "password", cls: "it-input" });
      if (saved[key]) {
        const when = meta[key] ? daysAgo(meta[key]) : "";
        input.placeholder = `${label}：已保存${when ? `（${when}）` : ""}，留空则不修改`;
      } else {
        input.placeholder = `${label}：粘贴 Cookie`;
      }
      return input;
    };

    const weibo = makeField("weibo", "微博");
    const zhihu = makeField("zhihu", "知乎");
    const xhs = makeField("xiaohongshu", "小红书");

    const actions = form.createEl("div", { cls: "it-actions" });
    const save = actions.createEl("button", { text: "保存登录态", cls: "mod-cta" });
    save.onclick = async () => {
      const cookies: any = {};
      const stamps: any = {};
      const now = new Date().toISOString();
      if (weibo.value.trim()) {
        cookies.weibo = weibo.value.trim();
        stamps.weibo = now;
      }
      if (zhihu.value.trim()) {
        cookies.zhihu = zhihu.value.trim();
        stamps.zhihu = now;
      }
      if (xhs.value.trim()) {
        cookies.xiaohongshu = xhs.value.trim();
        stamps.xiaohongshu = now;
      }
      if (!Object.keys(cookies).length) {
        new Notice("没有填写新的 Cookie");
        return;
      }
      await this.plugin.saveOverrides({ cookies, cookies_meta: stamps });
      await this.plugin.runCli(["status"], true);
      await this.refresh();
      new Notice("登录态已保存，下次抓取生效");
    };

    card.createEl("div", {
      cls: "it-hint",
      text: "微博：有 Cookie 后热搜带真实热度。知乎：有 Cookie 后能抓高赞回答当评论。小红书：Cookie 只能改善镜像抓取，官方接口还需要请求签名。",
    });
  }

  private renderAI(root: HTMLElement, status: StatusPayload | null) {
    const ready = !!(status?.ai?.enabled && status?.ai?.has_key);
    const card = root.createEl("details", { cls: "it-ai-status" });
    card.open = !ready;
    const head = card.createEl("summary", { cls: "it-ai-summary" });
    head.createEl("span", { text: "AI 解读" });
    head.createEl("span", {
      cls: "it-ai-purpose",
      text: "证据链研判 · 可检验判断",
    });
    head.createEl("span", {
      cls: `it-badge ${ready ? "on" : "off"}`,
      text: ready ? "已启用" : "未启用",
    });

    card.createEl("p", {
      cls: "it-hint",
      text: "不是问答框。它按固定流程拆解事实、信源、矛盾、利益、反方与可证伪条件；AI 不参与排序，最终判断由你确认。",
    });

    if (!status?.ai?.has_key) {
      const guide = card.createEl("div", { cls: "it-ai-guide" });
      guide.createEl("div", { cls: "it-subhead", text: "没有 API Key？按下面步骤配置" });
      const steps = guide.createEl("ol", { cls: "it-install-steps" });
      for (const text of [
        "打开 DeepSeek 开放平台，注册或登录。",
        "在「API Keys」里创建一个 Key，复制保存。",
        "回到这里：API 地址填 https://api.deepseek.com/v1，点「获取模型」选择可用模型。",
        "把 Key 粘贴到下面，点「保存」或「测试连接」。",
      ]) {
        steps.createEl("li", { text });
      }
      const open = guide.createEl("button", {
        text: "去 DeepSeek 获取 API Key",
        cls: "mod-cta",
      });
      open.onclick = () => window.open("https://platform.deepseek.com/api_keys", "_blank");
    }

    const form = card.createEl("div", { cls: "it-form" });

    const enabledRow = form.createEl("label", { cls: "it-source" });
    const enabled = enabledRow.createEl("input", { type: "checkbox" });
    enabled.checked = !!status?.ai?.enabled;
    enabledRow.createEl("span", { text: "启用 AI（仅手动解读，不自动生成）" });

    const base = form.createEl("input", { type: "text", cls: "it-input" });
    base.placeholder = "API 地址，例如 https://api.deepseek.com/v1";
    base.value = status?.ai?.base_url || "";

    const modelRow = form.createEl("div", { cls: "it-actions" });
    const modelSelect = modelRow.createEl("select", { cls: "it-input" });
    const model = form.createEl("input", { type: "text", cls: "it-input" });
    model.placeholder = "自定义模型名";
    model.value = status?.ai?.model || "";

    const fillModelSelect = (models: string[], current: string) => {
      modelSelect.empty();
      for (const name of models) {
        modelSelect.createEl("option", { value: name, text: name });
      }
      modelSelect.createEl("option", { value: "自定义", text: "自定义" });
      if (current && models.includes(current)) {
        modelSelect.value = current;
        model.value = current;
        model.toggleClass("is-hidden", true);
      } else if (current) {
        modelSelect.value = "自定义";
        model.value = current;
        model.toggleClass("is-hidden", false);
      } else {
        modelSelect.value = models[0] || "自定义";
        model.value = models[0] || "";
        model.toggleClass("is-hidden", modelSelect.value !== "自定义");
      }
    };

    const knownModels = /deepseek/i.test(base.value || status?.ai?.base_url || "")
      ? ["deepseek-flash", "deepseek-v4-pro"]
      : [];
    const savedModel = status?.ai?.model || "";
    fillModelSelect(
      Array.from(new Set([...knownModels, ...(savedModel ? [savedModel] : [])])),
      savedModel
    );
    modelSelect.onchange = () => {
      model.toggleClass("is-hidden", modelSelect.value !== "自定义");
      if (modelSelect.value !== "自定义") model.value = modelSelect.value;
    };

    const modelHint = form.createEl("div", { cls: "it-hint" });
    modelHint.setText("模型名以「获取模型」返回的列表为准。");

    const fetchModels = modelRow.createEl("button", { text: "获取模型", cls: "it-mini" });
    fetchModels.onclick = async () => {
      const notice = new Notice("正在读取可用模型…", 0);
      const result = await this.plugin.listAiModels(base.value, key.value);
      notice.hide();
      if (!result.ok || !result.models.length) {
        new Notice(result.error || "没有返回可用模型", 10000);
        return;
      }
      fillModelSelect(result.models, model.value.trim() || result.models[0]);
      modelHint.setText(`已获取 ${result.models.length} 个可用模型。`);
      new Notice(`已获取 ${result.models.length} 个可用模型`, 5000);
    };

    const key = form.createEl("input", { type: "password", cls: "it-input" });
    key.placeholder = status?.ai?.has_key ? "已保存（留空则不修改）" : "API Key";
    key.value = "";

    const actions = form.createEl("div", { cls: "it-actions" });
    const save = actions.createEl("button", { text: "保存", cls: "mod-cta" });
    save.onclick = async () => {
      const typedKey = key.value.trim();
      let enabledValue = enabled.checked;

      // 填了 Key 但没勾启用 → 自动勾上，避免"填了没反应"
      if (typedKey && !enabledValue) {
        enabledValue = true;
        enabled.checked = true;
      }
      if (enabledValue && !typedKey && !status?.ai?.has_key) {
        new Notice("启用 AI 需要先填 API Key");
        return;
      }

      const payload: any = {
        enabled: enabledValue,
        base_url: base.value.trim() || "https://api.openai.com/v1",
        model: model.value.trim() || "gpt-4o-mini",
      };
      if (typedKey) payload.api_key = typedKey;

      await this.plugin.saveOverrides({ ai: payload });
      await this.plugin.runCli(["status"], true);
      await this.refresh();

      if (enabledValue) {
        const result = await this.plugin.testAiConnection(
          base.value,
          model.value,
          typedKey
        );
        new Notice(`已保存。${result.message}`, result.ok ? 6000 : 12000);
        modelHint.setText(result.message);
      } else {
        new Notice("已保存（AI 未启用）");
      }
    };

    const test = actions.createEl("button", { text: "测试连接" });
    test.onclick = async () => {
      if (!key.value.trim() && !status?.ai?.has_key) {
        new Notice("请先填写 API Key");
        return;
      }
      if (!model.value.trim()) {
        new Notice("请先选择或填写模型");
        return;
      }
      const notice = new Notice("正在测试 AI 连接…", 0);
      const result = await this.plugin.testAiConnection(
        base.value,
        model.value,
        key.value.trim()
      );
      notice.hide();
      modelHint.setText(result.message);
      new Notice(result.message, result.ok ? 5000 : 12000);
    };

    card.createEl("div", {
      cls: "it-hint",
      text: "任何 OpenAI 兼容接口都行：DeepSeek、Kimi、通义、Ollama、OpenAI。先点「获取模型」，再点「测试连接」。",
    });
  }

  private openToday() {
    const status = this.status;
    if (!status) return;
    if (!status.digest_exists) {
      new Notice("今天的日报还没生成");
      return;
    }
    const rel = !status.vault
      ? status.digest_path
      : status.digest_path.startsWith(status.vault)
      ? status.digest_path.slice(status.vault.length + 1)
      : status.digest_path;
    const file = this.app.vault.getAbstractFileByPath(rel);
    if (file instanceof TFile) {
      this.app.workspace.getLeaf(true).openFile(file);
    } else {
      new Notice(`找不到文件：${rel}`);
    }
  }

  private openFolder(folder: string) {
    const file = this.app.vault.getAbstractFileByPath(folder);
    if (file) {
      this.app.workspace.getLeaf(true).openFile(file as any);
    } else {
      new Notice(`目录不存在：${folder}`);
    }
  }
}

interface JudgmentModalOptions {
  itemId: number;
  judgmentId?: number;
  card: any;
  baseCard?: any;
  reason?: string;
  status?: string;
}

class JudgmentModal extends Modal {
  plugin: InfoTrackerPlugin;
  view: TrackerHomeView;
  options: JudgmentModalOptions;

  constructor(
    app: App,
    plugin: InfoTrackerPlugin,
    view: TrackerHomeView,
    options: JudgmentModalOptions
  ) {
    super(app);
    this.plugin = plugin;
    this.view = view;
    this.options = options;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("it-judgment-modal");
    const card = this.options.card || {};
    const base = this.options.baseCard || card;

    contentEl.createEl("h2", {
      text: this.options.judgmentId ? "复核判断" : "形成判断",
    });
    contentEl.createEl("div", {
      cls: "it-hint",
      text: "AI 只是起草。判断由你确认，保存后会自动开始跟踪这条新闻。",
    });

    const quality = card.source_quality || base.source_quality || {};
    if (quality?.level || quality?.reason) {
      contentEl.createEl("div", {
        cls: "it-judgment-quality",
        text: `信源质量：${quality.level || "未知"}${quality.reason ? ` · ${quality.reason}` : ""}`,
      });
    }

    const addText = (label: string, value: string, rows = 2) => {
      const wrap = contentEl.createEl("div", { cls: "it-modal-field" });
      wrap.createEl("label", { text: label });
      const input = wrap.createEl("textarea");
      input.rows = rows;
      input.value = value || "";
      return input;
    };

    const question = addText("问题", card.question || base.question || "", 2);
    const claim = addText("判断", card.claim || base.claim || "", 3);
    const counter = addText("最强反方", card.counter || base.counter || "", 3);
    const confirmIf = addText(
      "什么算我对（每行一条）",
      (card.confirm_if || base.confirm_if || []).join("\n"),
      3
    );
    const falsifiers = addText(
      "什么算我错 / 该改判（每行一条）",
      (card.falsifiers || base.falsifiers || []).join("\n"),
      3
    );

    const metaRow = contentEl.createEl("div", { cls: "it-modal-row" });

    const typeWrap = metaRow.createEl("div", { cls: "it-modal-field" });
    typeWrap.createEl("label", { text: "判断类型" });
    const claimType = typeWrap.createEl("select");
    for (const name of ["预测", "因果", "利益归属", "价值排序", "重要性"]) {
      claimType.createEl("option", { value: name, text: name });
    }
    claimType.value = card.claim_type || base.claim_type || "重要性";

    const statusWrap = metaRow.createEl("div", { cls: "it-modal-field" });
    statusWrap.createEl("label", { text: "状态" });
    const status = statusWrap.createEl("select");
    for (const name of ["观察中", "加强", "削弱", "已修正", "已证伪", "已过期"]) {
      status.createEl("option", { value: name, text: name });
    }
    status.value =
      this.options.status || card.status_suggestion || card.status || base.status || "观察中";

    const numberRow = contentEl.createEl("div", { cls: "it-modal-row" });

    const confidenceWrap = numberRow.createEl("div", { cls: "it-modal-field" });
    confidenceWrap.createEl("label", { text: "置信度（0-100）" });
    const confidence = confidenceWrap.createEl("input", { type: "number" });
    confidence.min = "0";
    confidence.max = "100";
    confidence.value = String(card.confidence ?? base.confidence ?? 50);

    const horizonWrap = numberRow.createEl("div", { cls: "it-modal-field" });
    horizonWrap.createEl("label", { text: "有效期" });
    const horizon = horizonWrap.createEl("input", { type: "text" });
    horizon.value = card.horizon || base.horizon || "";

    const reason = addText(
      "本次保存的原因",
      this.options.reason || card.change_reason || (this.options.judgmentId ? "复核后修订" : "初始判断"),
      2
    );

    const actions = contentEl.createEl("div", { cls: "it-modal-actions" });
    const save = actions.createEl("button", { text: "保存判断", cls: "mod-cta" });
    const cancel = actions.createEl("button", { text: "取消" });
    cancel.onclick = () => this.close();

    save.onclick = async () => {
      const claimText = claim.value.trim();
      if (!claimText) {
        new Notice("判断不能为空");
        return;
      }

      const merged = Object.assign({}, base, {
        question: question.value.trim(),
        claim_type: claimType.value,
        claim: claimText,
        confidence: Math.max(0, Math.min(100, Number(confidence.value) || 0)),
        horizon: horizon.value.trim(),
        confirm_if: this.splitLines(confirmIf.value),
        falsifiers: this.splitLines(falsifiers.value),
        counter: counter.value.trim(),
        status: status.value,
        change_reason: reason.value.trim(),
      });

      const args = ["judge-save"];
      if (this.options.judgmentId) {
        args.push("--id", String(this.options.judgmentId));
      } else {
        args.push("--item", String(this.options.itemId));
      }
      args.push("--data", JSON.stringify(merged));
      args.push("--reason", reason.value.trim());

      save.disabled = true;
      await this.plugin.runCli(args, true);
      save.disabled = false;
      const payload = lastJsonLine(this.plugin.lastLog);
      if (payload?.ok) {
        new Notice(`判断已保存 · v${payload.version}`);
        this.close();
        await this.view.refresh();
      } else {
        new Notice(`保存失败：${payload?.error || "看主页运行日志"}`);
      }
    };
  }

  private splitLines(text: string): string[] {
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }

  onClose() {
    this.contentEl.empty();
  }
}

class JudgmentPickerModal extends Modal {
  items: TopItem[];
  choose: (itemId: number) => void;

  constructor(app: App, items: TopItem[], choose: (itemId: number) => void) {
    super(app);
    this.items = items;
    this.choose = choose;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("it-judgment-picker-modal");
    contentEl.createEl("h2", { text: "从今日新闻新建判断" });
    contentEl.createEl("div", {
      cls: "it-hint",
      text: "选一条新闻，AI 会起草判断卡；你确认后才会入库。",
    });

    for (const item of this.items.slice(0, 30)) {
      const row = contentEl.createEl("div", { cls: "it-news" });
      const title = row.createEl("div", { cls: "it-news-title", text: item.title });
      title.onclick = () => window.open(item.url);
      row.createEl("div", {
        cls: "it-news-meta",
        text: `${item.source} · ${item.topic}`,
      });
      const button = row.createEl("button", {
        text: "形成判断",
        cls: "it-mini mod-cta",
      });
      button.onclick = () => {
        this.close();
        this.choose(item.id);
      };
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}

class ChatModal extends Modal {
  plugin: InfoTrackerPlugin;
  itemId: number;
  title: string;
  url = "";
  messages: ChatMessage[] = [];
  busy = false;
  private listEl: HTMLElement | null = null;
  private inputEl: HTMLInputElement | null = null;
  private inputWrapEl: HTMLElement | null = null;
  private sendBtn: HTMLButtonElement | null = null;
  private statusEl: HTMLElement | null = null;
  private statusTimer = 0;
  private renderer = new Component();

  constructor(app: App, plugin: InfoTrackerPlugin, itemId: number, title: string) {
    super(app);
    this.plugin = plugin;
    this.itemId = itemId;
    this.title = title || "";
  }

  async onOpen() {
    this.renderer.load();
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("it-chat-modal");
    contentEl.createEl("h2", { text: "AI 交流" });
    contentEl.createEl("div", {
      cls: "it-chat-title",
      text: this.title || "这条新闻",
    });
    contentEl.createEl("div", {
      cls: "it-hint",
      text: "可以追问事实、反方、影响或下一步要盯什么。对话会保存在本机，方便下次继续。",
    });

    this.listEl = contentEl.createEl("div", { cls: "it-chat-list" });
    this.statusEl = contentEl.createEl("div", { cls: "it-chat-status" });
    const inputWrap = contentEl.createEl("div", { cls: "it-chat-input-wrap" });
    this.inputWrapEl = inputWrap;
    const input = inputWrap.createEl("input", { type: "text", cls: "it-chat-input" });
    input.placeholder = "问点什么…";
    this.inputEl = input;
    inputWrap.createEl("span", {
      cls: "it-terminal-cursor",
      text: "▌",
      attr: { "aria-hidden": "true" },
    });
    const syncCursor = () => inputWrap.toggleClass("has-text", !!input.value.trim());
    input.addEventListener("input", syncCursor);
    syncCursor();

    const send = inputWrap.createEl("button", {
      cls: "it-chat-send",
      attr: { "aria-label": "发送", title: "发送" },
    });
    setIcon(send, "send");
    this.sendBtn = send;
    send.onclick = () => this.send();
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || ((event.metaKey || event.ctrlKey) && event.key === "Enter")) {
        event.preventDefault();
        this.send();
      }
    });

    await this.loadHistory();
    this.renderMessages();
    input.focus();
  }

  private historyPath(): string {
    return this.plugin.mobileChatPath(this.itemId);
  }

  private async loadHistory() {
    try {
      const path = this.historyPath();
      const raw = (await this.plugin.vaultExists(path))
        ? await this.plugin.vaultRead(path)
        : "";
      if (!raw) {
        this.messages = [];
        return;
      }
      const payload = JSON.parse(raw);
      this.messages = Array.isArray(payload.messages) ? payload.messages : [];
      this.title = payload.title || this.title;
      this.url = payload.url || "";
    } catch {
      this.messages = [];
    }
  }

  private async saveHistory() {
    const file = this.historyPath();
    const payload = {
      itemId: this.itemId,
      title: this.title,
      url: this.url,
      updatedAt: new Date().toISOString(),
      messages: this.messages,
    };
    await this.plugin.vaultWrite(file, JSON.stringify(payload, null, 2));
  }

  private setStatus(text: string | null) {
    if (!this.statusEl) return;
    this.statusEl.textContent = text || "";
    this.statusEl.toggleClass("is-visible", !!text);
  }

  private renderMessages() {
    if (!this.listEl) return;
    this.listEl.empty();
    if (!this.messages.length) {
      this.listEl.createEl("div", {
        cls: "it-chat-empty",
        text: "还没有对话。可以先问：这条新闻最值得怀疑的地方是什么？",
      });
      return;
    }
    for (const message of this.messages) {
      const row = this.listEl.createEl("div", {
        cls: `it-chat-msg ${message.role}`,
      });
      row.createEl("div", { cls: "it-chat-role", text: message.role === "user" ? "我" : "AI" });
      const body = row.createEl("div", { cls: "it-chat-body" });
      if (message.role === "assistant") {
        if (message.typing) body.setText("");
        else void MarkdownRenderer.render(this.app, message.content, body, "", this.renderer);
      } else {
        body.setText(message.content);
      }
    }
    this.listEl.scrollTop = this.listEl.scrollHeight;
  }

  private async typeAssistantMessage(message: ChatMessage) {
    if (!this.listEl) return;
    const rows = this.listEl.querySelectorAll(".it-chat-msg");
    const row = rows[rows.length - 1] as HTMLElement | undefined;
    const body = row?.querySelector(".it-chat-body") as HTMLElement | null;
    if (!body) return;
    const full = message.content;
    body.empty();
    body.addClass("is-typing");
    const chunk = Math.max(2, Math.ceil(full.length / 140));
    let index = 0;
    await new Promise<void>((resolve) => {
      const timer = window.setInterval(() => {
        if (!body.isConnected || !this.listEl) {
          window.clearInterval(timer);
          resolve();
          return;
        }
        index += chunk;
        body.setText(full.slice(0, index));
        this.listEl.scrollTop = this.listEl.scrollHeight;
        if (index >= full.length) {
          window.clearInterval(timer);
          resolve();
        }
      }, 10);
    });
    body.removeClass("is-typing");
    if (body.isConnected) {
      body.empty();
      await MarkdownRenderer.render(this.app, full, body, "", this.renderer);
    }
    if (this.listEl) this.listEl.scrollTop = this.listEl.scrollHeight;
  }

  private async send() {
    if (this.busy || !this.inputEl) return;
    const text = this.inputEl.value.trim();
    if (!text) return;

    this.busy = true;
    const userText = text;
    this.inputEl.value = "";
    this.inputEl.disabled = true;
    this.inputWrapEl?.removeClass("has-text");
    this.inputWrapEl?.addClass("is-thinking");
    if (this.sendBtn) this.sendBtn.disabled = true;
    this.setStatus("正在研读…");
    this.statusTimer = window.setTimeout(() => this.setStatus("正在思考…"), 5000);

    this.messages.push({
      role: "user",
      content: userText,
      at: new Date().toISOString(),
    });
    this.renderMessages();

    try {
      if (this.plugin.isMobile()) {
    const status = await this.plugin.readStatus();
        const item =
          status?.mobile_items?.find((row) => row.id === this.itemId) ||
          status?.top_items?.find((row) => row.id === this.itemId);
        if (!item) {
          this.messages.pop();
          this.inputEl.value = userText;
          new Notice("手机快照里找不到这条新闻，等电脑端再同步一次");
          return;
        }
        const ai = this.plugin.mobileAi();
        if (!ai.available()) {
          this.messages.pop();
          this.inputEl.value = userText;
          new Notice("先在 设置 → 第三方插件 → 朝闻天下 里启用 AI 并填 API Key");
          return;
        }
        const judged = status?.judgments?.find((row) => row.item_id === this.itemId);
        const insight = judged
          ? JSON.stringify({
              question: judged.question,
              claim: judged.claim,
              confidence: judged.confidence,
              status: judged.status,
              confirm_if: judged.confirm_if,
              falsifiers: judged.falsifiers,
            })
          : "";
        const answer = await ai.chat(
          item.title,
          item.summary || "",
          this.messages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
          insight
        );
        if (!answer) {
          this.messages.pop();
          this.inputEl.value = userText;
          new Notice(`AI 交流失败：${ai.error || "检查 API Key"}`);
          return;
        }
        this.title = item.title || this.title;
        this.url = item.url || this.url;
        this.setStatus("正在写入…");
        const assistantMessage: ChatMessage = {
          role: "assistant",
          content: compactAnswer(answer),
          at: new Date().toISOString(),
          typing: true,
        };
        this.messages.push(assistantMessage);
        this.renderMessages();
        await this.typeAssistantMessage(assistantMessage);
        assistantMessage.typing = false;
        await this.saveHistory();
        return;
      }

      await this.plugin.runCli(
        [
          "ai-chat",
          "--item",
          String(this.itemId),
          "--messages",
          JSON.stringify(
            this.messages.map((message) => ({
              role: message.role,
              content: message.content,
            }))
          ),
        ],
        true,
        true
      );

      const payload = lastJsonLine(this.plugin.lastLog);
      if (payload?.ok && payload.text) {
        this.title = payload.item?.title || this.title;
        this.url = payload.item?.url || this.url;
        this.setStatus("正在写入…");
        const assistantMessage: ChatMessage = {
          role: "assistant",
          content: compactAnswer(String(payload.text)),
          at: new Date().toISOString(),
          typing: true,
        };
        this.messages.push(assistantMessage);
        this.renderMessages();
        await this.typeAssistantMessage(assistantMessage);
        assistantMessage.typing = false;
        await this.saveHistory();
      } else {
        this.messages.pop();
        this.inputEl.value = userText;
        new Notice(`AI 交流失败：${payload?.error || "看主页运行日志"}`);
      }
    } catch (err) {
      this.messages.pop();
      this.inputEl.value = userText;
      new Notice(`AI 交流失败：${String(err)}`);
    } finally {
      this.busy = false;
      if (this.statusTimer) window.clearTimeout(this.statusTimer);
      this.statusTimer = 0;
      this.setStatus(null);
      this.inputWrapEl?.removeClass("is-thinking");
      if (this.inputEl) this.inputEl.disabled = false;
      if (this.sendBtn) this.sendBtn.disabled = false;
      this.renderMessages();
      this.inputEl?.focus();
    }
  }

  onClose() {
    if (this.statusTimer) window.clearTimeout(this.statusTimer);
    this.statusTimer = 0;
    this.renderer.unload();
    this.contentEl.empty();
  }
}

class SourceTestModal extends Modal {
  private results: SourceTestResult[];
  private onApply: () => void;

  constructor(app: App, results: SourceTestResult[], onApply: () => void) {
    super(app);
    this.results = results;
    this.onApply = onApply;
  }

  onOpen() {
    const { contentEl } = this;
    this.modalEl.addClass("it-source-test-modal");
    contentEl.empty();
    contentEl.createEl("h2", { text: "来源连通性" });
    contentEl.createEl("p", {
      cls: "it-hint",
      text: "逐个测试热榜与 RSS 源。结果取决于本机网络、代理和本地增强服务的运行环境；被阻断或超时的源会被跳过。",
    });
    const foreignNote = contentEl.createEl("p", { cls: "it-hint" });
    foreignNote.createEl("span", { text: "国外来源建议" });
    foreignNote.createEl("span", { cls: "it-hint-emphasis", text: "打开 AI" });
    foreignNote.createEl("span", { text: "：开启后翻译成中文摘要；" });
    foreignNote.createEl("span", { cls: "it-hint-emphasis", text: "不开启 AI" });
    foreignNote.createEl("span", { text: " 时直接显示 " });
    foreignNote.createEl("span", { cls: "it-hint-strong", text: "外文原文" });
    foreignNote.createEl("span", { text: "。" });

    const okCount = (rows: SourceTestResult[]) => rows.filter((row) => row.ok).length;
    const cn = this.results.filter((item) => item.region !== "intl");
    const intl = this.results.filter((item) => item.region === "intl");
    contentEl.createDiv({
      cls: "it-source-test-summary",
      text: `国内 ${okCount(cn)}/${cn.length} · 国外 ${okCount(intl)}/${intl.length} · 合计 ${okCount(this.results)}/${this.results.length}`,
    });

    const list = contentEl.createDiv({ cls: "it-source-test-list" });
    for (const [label, rows] of [
      ["国内", cn],
      ["国外", intl],
    ] as Array<[string, SourceTestResult[]]>) {
      if (!rows.length) continue;
      list.createDiv({
        cls: "it-source-test-group",
        text: `${label} · ${okCount(rows)}/${rows.length}`,
      });
      for (const item of rows) {
        const row = list.createDiv({ cls: "it-source-test-row" });
        row.createEl("span", {
          cls: `it-source-badge ${item.ok ? "is-on" : ""}`,
          text: item.ok ? "可访问" : "不可访问",
        });
        row.createEl("span", { cls: "it-source-test-name", text: item.name });
        row.createEl("span", {
          cls: "it-source-kind",
          text: item.kind === "rss" ? "RSS" : "热榜",
        });
        row.createEl("span", {
          cls: "it-source-test-state",
          text: item.ok
            ? `${item.count ?? 0} 条`
            : item.error || (item.status ? `HTTP ${item.status}` : ""),
        });
      }
    }

    const actions = contentEl.createDiv({ cls: "it-actions" });
    const apply = actions.createEl("button", {
      text: "只启用可访问来源",
      cls: "mod-cta",
    });
    apply.onclick = () => {
      this.close();
      this.onApply();
    };
    const close = actions.createEl("button", { text: "关闭" });
    close.onclick = () => this.close();
  }

  onClose() {
    this.contentEl.empty();
  }
}

class ConfirmModal extends Modal {
  private message: string;
  private onConfirm: () => void;
  private title: string;
  private confirmText: string;

  constructor(
    app: App,
    message: string,
    onConfirm: () => void,
    title = "重新生成今天的日报？",
    confirmText = "继续生成"
  ) {
    super(app);
    this.message = message;
    this.onConfirm = onConfirm;
    this.title = title;
    this.confirmText = confirmText;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: this.title });
    contentEl.createEl("p", { cls: "it-hint", text: this.message });
    const actions = contentEl.createDiv({ cls: "it-actions" });
    const cancel = actions.createEl("button", { text: "取消" });
    cancel.onclick = () => this.close();
    const run = actions.createEl("button", { text: this.confirmText, cls: "mod-cta" });
    run.onclick = () => {
      this.close();
      this.onConfirm();
    };
  }

  onClose() {
    this.contentEl.empty();
  }
}

class InstallGuideModal extends Modal {
  plugin: InfoTrackerPlugin;

  constructor(app: App, plugin: InfoTrackerPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("it-backend-modal");
    contentEl.createEl("h2", { text: "安装本地增强服务" });
    contentEl.createEl("p", {
      cls: "it-hint",
      text: "本地增强服务是独立安装的本地服务，插件不会被覆盖。装好后热榜、正文补全、聚类、跟踪和判断簿会解锁。",
    });
    const steps = contentEl.createEl("ol", { cls: "it-install-steps" });
    for (const text of [
      "下载 macOS 增强服务安装包。",
      "解压后双击 install-backend.command。",
      "安装器会写入 token、安装 launchd 后台服务。",
      "重启 Obsidian，插件会自动连接。",
    ]) {
      steps.createEl("li", { text });
    }
    const actions = contentEl.createDiv({ cls: "it-actions" });
    const open = actions.createEl("button", {
      text: "在浏览器打开安装页",
      cls: "mod-cta",
    });
    open.onclick = () => this.plugin.openBackendInstallGuide();
    const check = actions.createEl("button", { text: "已安装，检测连接", cls: "it-mini" });
    check.onclick = async () => {
      const health = await this.plugin.checkBackend();
      new Notice(health.ok ? "本地增强服务已连接" : "还没有连上，请确认安装器已完成");
      if (health.ok) {
        this.close();
        await this.plugin.view?.refresh();
      }
    };
  }

  onClose() {
    this.contentEl.empty();
  }
}

class BackendSettingsModal extends Modal {
  plugin: InfoTrackerPlugin;
  private urlEl!: HTMLInputElement;
  private tokenEl!: HTMLInputElement;
  private statusEl!: HTMLElement;
  private showStatusEl!: HTMLInputElement;

  constructor(app: App, plugin: InfoTrackerPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("it-backend-modal");
    contentEl.createEl("h2", { text: "本地增强服务" });
    contentEl.createEl("p", {
      cls: "it-hint",
      text: "本地增强服务是独立安装的本地服务，插件只通过 127.0.0.1 调用它。不安装时，RSS、AI、日报仍可使用。",
    });

    const form = contentEl.createEl("div", { cls: "it-form" });
    this.urlEl = form.createEl("input", { type: "text", cls: "it-input" });
    this.urlEl.placeholder = "http://127.0.0.1:8765";
    this.urlEl.value = this.plugin.settings.backendUrl;

    this.tokenEl = form.createEl("input", { type: "password", cls: "it-input" });
    this.tokenEl.placeholder = "服务 token（安装器会写入）";
    this.tokenEl.value = this.plugin.settings.backendToken;

    const showRow = form.createEl("label", { cls: "it-source" });
    this.showStatusEl = showRow.createEl("input", { type: "checkbox" });
    this.showStatusEl.checked = this.plugin.settings.showStatusBar;
    showRow.createEl("span", { text: "在底部状态栏显示跟踪数量" });

    this.statusEl = form.createEl("div", { cls: "it-hint" });
    this.updateStatus();

    const actions = form.createEl("div", { cls: "it-actions" });
    const check = actions.createEl("button", { text: "检测连接", cls: "it-mini" });
    check.onclick = async () => {
      await this.plugin.checkBackend();
      this.updateStatus();
      await this.plugin.view?.refresh();
    };
    const install = actions.createEl("button", {
      text: "安装 / 更新本地增强服务",
      cls: "it-mini",
    });
    install.onclick = () => this.plugin.openBackendInstallGuide();
    const save = actions.createEl("button", { text: "保存", cls: "mod-cta" });
    save.onclick = async () => {
      this.plugin.settings.backendUrl =
        this.urlEl.value.trim() || DEFAULT_SETTINGS.backendUrl;
      this.plugin.settings.backendToken = this.tokenEl.value.trim();
      this.plugin.settings.showStatusBar = this.showStatusEl.checked;
      await this.plugin.saveSettings();
      await this.plugin.checkBackend();
      this.plugin.refreshStatusBar();
      this.updateStatus();
      await this.plugin.view?.refresh();
      new Notice("本地增强服务设置已保存");
    };
  }

  private updateStatus() {
    if (!this.statusEl) return;
    const health = this.plugin.backendHealth;
    this.statusEl.setText(
      health.ok
        ? `${health.version ? `v${health.version} · ` : ""}已连接`
        : `未连接${health.error ? ` · ${health.error}` : ""}`
    );
  }

  onClose() {
    this.contentEl.empty();
  }
}

class TrackerSettingTab extends PluginSettingTab {
  plugin: InfoTrackerPlugin;

  constructor(app: App, plugin: InfoTrackerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  private displayMobile() {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl).setName("朝闻天下 · 手机端").setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text:
        "抓取和正文补全在电脑端完成；手机端读取电脑写进 vault 的 mobile.json。" +
        "AI 解读和 AI 交流走手机自己的 API Key，只保存在这台设备。",
    });

    const settings = this.plugin.settings;
    let key = "";

    new Setting(containerEl).setName("RSS").setHeading();
    new Setting(containerEl)
      .setName("RSS 地址")
      .setDesc("一行一个，支持 RSS / Atom")
      .addTextArea((text) => {
        text.inputEl.rows = 6;
        text.inputEl.addClass("it-textarea");
        text
          .setPlaceholder("https://example.com/feed.xml")
          .setValue(settings.rssFeeds)
          .onChange((value) => {
            settings.rssFeeds = value;
          });
      });

    new Setting(containerEl)
      .setName("RSS 日报目录")
      .setDesc("生成 RSS 日报的位置")
      .addText((text) =>
        text
          .setPlaceholder("朝闻天下/RSS日报")
          .setValue(settings.rssDigestFolder)
          .onChange((value) => {
            settings.rssDigestFolder = value.trim() || DEFAULT_SETTINGS.rssDigestFolder;
          })
      );

    new Setting(containerEl)
      .setName("最多保留条数")
      .setDesc("本地保留的 RSS 新闻数量")
      .addText((text) =>
        text
          .setPlaceholder("60")
          .setValue(String(settings.rssMaxItems))
          .onChange((value) => {
            settings.rssMaxItems = Math.max(10, Math.min(500, Number(value) || 60));
          })
      );

    new Setting(containerEl).setName("AI").setHeading();
    new Setting(containerEl)
      .setName("启用 AI")
      .setDesc("AI 解读、AI 交流需要打开；抓取仍然只在电脑端")
      .addToggle((toggle) =>
        toggle.setValue(settings.aiEnabled).onChange((value) => {
          settings.aiEnabled = value;
        })
      );

    new Setting(containerEl)
      .setName("API 地址")
      .setDesc("OpenAI 兼容接口，例如 https://api.deepseek.com/v1")
      .addText((text) =>
        text
          .setPlaceholder("https://api.deepseek.com/v1")
          .setValue(settings.apiBaseUrl)
          .onChange((value) => {
            settings.apiBaseUrl = value.trim();
          })
      );

    new Setting(containerEl)
      .setName("模型")
      .setDesc("点主页 AI 卡片的「获取模型」读取账号可用模型；也可以填任何 OpenAI 兼容模型名")
      .addText((text) =>
        text
          .setPlaceholder("deepseek-flash")
          .setValue(settings.model)
          .onChange((value) => {
            settings.model = value.trim();
          })
      );

    new Setting(containerEl)
      .setName("推理强度")
      .setDesc("支持推理的模型可填 low / medium / high；留空则不发送")
      .addDropdown((dropdown) => {
        dropdown.addOption("", "默认");
        dropdown.addOption("low", "low");
        dropdown.addOption("medium", "medium");
        dropdown.addOption("high", "high");
        dropdown.setValue(settings.reasoningEffort || "");
        dropdown.onChange((value) => {
          settings.reasoningEffort = value;
        });
      });

    new Setting(containerEl)
      .setName("API Key")
      .setDesc("只保存在这台设备的插件 data.json，不会写进 vault")
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder(settings.apiKey ? "已保存（留空则不修改）" : "sk-...")
          .onChange((value) => {
            key = value.trim();
          });
      });

    new Setting(containerEl)
      .setName("手机快照路径")
      .setDesc("电脑端 Python 写出的文件；默认朝闻天下/.同步数据/mobile.json")
      .addText((text) =>
        text
          .setPlaceholder("朝闻天下/.同步数据/mobile.json")
          .setValue(settings.mobileSnapshotPath)
          .onChange((value) => {
            settings.mobileSnapshotPath = value.trim() || DEFAULT_SETTINGS.mobileSnapshotPath;
          })
      );

    new Setting(containerEl)
      .setName("保存")
      .setDesc("保存后回首页点「刷新快照」")
      .addButton((button) =>
        button
          .setButtonText("保存手机端设置")
          .setCta()
          .onClick(async () => {
            if (key) settings.apiKey = key;
            if (settings.aiEnabled && !settings.apiKey) {
              new Notice("启用 AI 需要先填 API Key");
              return;
            }
            await this.plugin.saveSettings();
            await this.plugin.view?.refresh();
            new Notice("手机端设置已保存");
          })
      )
      .addButton((button) =>
        button.setButtonText("测试连接").onClick(async () => {
          if (key) settings.apiKey = key;
          await this.plugin.saveSettings();
          const ai = this.plugin.mobileAi();
          if (!ai.available()) {
            new Notice("先启用 AI 并填写 API Key");
            return;
          }
          new Notice("正在测试 AI 连接…");
          const result = await ai.test();
          new Notice(result.ok ? `AI 可用：${result.message}` : `AI 不可用：${result.message}`);
        })
      );

    containerEl.createEl("p", {
      cls: "setting-item-description",
      text:
        "如果首页读不到数据，先在电脑端运行一次 `python main.py status`，或等 07:00 / 19:00 抓取后 iCloud 同步过来。",
    });
  }

  async display() {
    if (this.plugin.isMobile()) {
      this.displayMobile();
      return;
    }
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl).setName("朝闻天下 · 规则").setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "这里只放内容规则。本地增强服务、状态栏开关在插件主页最下面的「本地增强服务 / 高级设置」里。",
    });

    const backendOk = this.plugin.backendHealth.ok;
    const simple = containerEl.createEl("details", { cls: "it-settings-collapse" });
    simple.createEl("summary", { text: "RSS / 轻量模式" });
    simple.open = !backendOk;
    simple.createEl("p", {
      cls: "setting-item-description",
      text: backendOk
        ? "本地增强服务已连接，当前使用完整模式。轻量模式作为后备，不会同时运行；服务断开后会自动回退。"
        : "当前使用轻量模式。安装并连接本地增强服务后，会自动切换到完整模式，两者不会同时运行。",
    });

    new Setting(simple)
      .setName("RSS 地址")
      .setDesc("一行一个，支持 RSS / Atom。没有本地增强服务时，这里就是插件的全部来源。")
      .addTextArea((text) => {
        text.inputEl.rows = 4;
        text.inputEl.addClass("it-textarea");
        text
          .setPlaceholder("https://example.com/feed.xml")
          .setValue(this.plugin.settings.rssFeeds)
          .onChange((value) => {
            this.plugin.settings.rssFeeds = value;
          });
      });

    new Setting(simple)
      .setName("RSS 日报目录")
      .setDesc("轻量模式生成 RSS 日报的位置")
      .addText((text) =>
        text
          .setPlaceholder("朝闻天下/RSS日报")
          .setValue(this.plugin.settings.rssDigestFolder)
          .onChange((value) => {
            this.plugin.settings.rssDigestFolder =
              value.trim() || DEFAULT_SETTINGS.rssDigestFolder;
          })
      );

    new Setting(simple)
      .setName("最多保留条数")
      .setDesc("本地保留的 RSS 新闻数量")
      .addText((text) =>
        text
          .setPlaceholder("60")
          .setValue(String(this.plugin.settings.rssMaxItems))
          .onChange((value) => {
            this.plugin.settings.rssMaxItems = Math.max(
              10,
              Math.min(500, Number(value) || 60)
            );
          })
      );

    new Setting(simple)
      .setName("关注关键词")
      .setDesc("一行一个。轻量模式下命中的新闻会标「关注」，可以点「关注」筛选。")
      .addTextArea((text) => {
        text.inputEl.rows = 3;
        text.inputEl.addClass("it-textarea");
        text
          .setPlaceholder("例如：人工智能\n芯片")
          .setValue(this.plugin.settings.rssWatchKeywords)
          .onChange((value) => {
            this.plugin.settings.rssWatchKeywords = value;
          });
      });

    new Setting(simple).addButton((button) =>
      button
        .setButtonText("保存 RSS 设置")
        .setCta()
        .onClick(async () => {
          await this.plugin.saveSettings();
          new Notice("RSS 设置已保存");
          await this.plugin.view?.refresh();
        })
    );

    new Setting(containerEl).setName("本地增强服务").setHeading();
    new Setting(containerEl)
      .setName("安装 / 更新本地增强服务")
      .setDesc("热榜、正文补全、聚类、跟踪和判断簿需要它。安装器只装增强服务，不覆盖插件。")
      .addButton((button) =>
        button
          .setButtonText("安装 / 更新")
          .setCta()
          .onClick(() => this.plugin.openInstallGuide())
      )
      .addButton((button) =>
        button.setButtonText("检测连接").onClick(async () => {
          const health = await this.plugin.checkBackend();
          new Notice(health.ok ? "本地增强服务已连接" : "本地增强服务未连接，请先完成安装");
          await this.plugin.view?.refresh();
        })
      );

    new Setting(containerEl).setName("来源连通性").setHeading();
    new Setting(containerEl)
      .setName("测试所有来源")
      .setDesc("逐个检查热榜和 RSS 源。结果取决于本机网络、代理和本地增强服务的运行环境。")
      .addButton((button) =>
        button.setButtonText("开始测试").onClick(() => {
          void this.plugin.testSources();
        })
      );
    new Setting(containerEl)
      .setName("只启用可访问的来源")
      .setDesc("根据上次测试关闭不可达的热榜和 RSS 源；手动关闭的源会保留。")
      .addButton((button) =>
        button.setButtonText("应用").onClick(() => {
          void this.plugin.applyReachableSources();
        })
      );
    const foreignHint = containerEl.createEl("p", {
      cls: "setting-item-description",
    });
    foreignHint.createEl("span", { cls: "it-hint-label", text: "国外来源：" });
    foreignHint.createEl("span", { cls: "it-hint-emphasis", text: "打开 AI" });
    foreignHint.createEl("span", { text: " 才会翻译成中文；" });
    foreignHint.createEl("span", { cls: "it-hint-emphasis", text: "不开启 AI" });
    foreignHint.createEl("span", { text: " 时直接显示 " });
    foreignHint.createEl("span", { cls: "it-hint-strong", text: "外文原文" });
    foreignHint.createEl("span", { text: "。没有代理时，被阻断的源会被跳过。" });

    const status = await this.plugin.readStatus();

    const schedule = status?.schedule || {
      enabled: this.plugin.settings.scheduleEnabled,
      morning: this.plugin.settings.scheduleMorning,
      evening: this.plugin.settings.scheduleEvening,
      eveningDigest: this.plugin.settings.scheduleEveningDigest,
    };
    let scheduleEnabled = schedule.enabled !== false;
    let scheduleMorning = schedule.morning || "07:00";
    let scheduleEvening = schedule.evening || "19:00";
    let scheduleEveningDigest = schedule.eveningDigest === true;

    const saveSchedule = async () => {
      this.plugin.settings.scheduleEnabled = scheduleEnabled;
      this.plugin.settings.scheduleMorning = scheduleMorning;
      this.plugin.settings.scheduleEvening = scheduleEvening;
      this.plugin.settings.scheduleEveningDigest = scheduleEveningDigest;
      await this.plugin.saveSettings();
      const ok = await this.plugin.backend.saveSchedule({
        enabled: scheduleEnabled,
        morning: scheduleMorning,
        evening: scheduleEvening,
        eveningDigest: scheduleEveningDigest,
      });
      new Notice(ok ? "抓取时间已保存" : "已保存到本机；本地增强服务未连接");
      await this.plugin.view?.refresh();
    };

    new Setting(containerEl).setName("抓取时间").setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "定时抓取由本地增强服务负责（默认 07:00 / 19:00）；关掉 Obsidian 也会运行。",
    });
    new Setting(containerEl)
      .setName("启用定时抓取")
      .setDesc("本地增强服务启动时会按下面的时间自动运行；关闭后只能手动抓取。")
      .addToggle((toggle) =>
        toggle.setValue(scheduleEnabled).onChange((value) => {
          scheduleEnabled = value;
          void saveSchedule();
        })
      );
    new Setting(containerEl)
      .setName("早上出报时间")
      .setDesc("例如 07:00；到点后抓取并生成当天日报。")
      .addText((text) => {
        text.inputEl.type = "time";
        text.setValue(scheduleMorning).onChange((value) => {
          scheduleMorning = value || "07:00";
          void saveSchedule();
        });
      });
    new Setting(containerEl)
      .setName("晚上时间")
      .setDesc("例如 19:00；默认只收集，打开下面的开关后也出报。")
      .addText((text) => {
        text.inputEl.type = "time";
        text.setValue(scheduleEvening).onChange((value) => {
          scheduleEvening = value || "19:00";
          void saveSchedule();
        });
      });
    new Setting(containerEl)
      .setName("晚上也生成日报")
      .setDesc("打开后，晚上到点会强制重写当天日报；关闭则只收集。")
      .addToggle((toggle) =>
        toggle.setValue(scheduleEveningDigest).onChange((value) => {
          if (!value) {
            scheduleEveningDigest = false;
            void saveSchedule();
            return;
          }
          if (scheduleEveningDigest) return;
          new ConfirmModal(
            this.app,
            "打开后，晚上到点会强制重写当天日报。当天已有的日报正文会被覆盖；跟踪/已读勾选和 AI 缓存会保留。确定打开吗？",
            () => {
              scheduleEveningDigest = true;
              toggle.setValue(true);
              void saveSchedule();
            },
            "打开晚上出报？",
            "确认打开"
          ).open();
          toggle.setValue(false);
        })
      );
    const filters = status?.filters || {};
    const dedupe = status?.dedupe || {};

    let filterEnabled = !!filters.enabled;
    let minTitle = Number(filters.min_title_chars ?? 6);
    const ruleMap = new Map<string, { type: string; value: string; enabled: boolean }>();
    for (const rule of filters.rules || []) {
      if (!rule || typeof rule !== "object") continue;
      const type = String(rule.type || "keyword").trim() || "keyword";
      const value = String(rule.value || "").trim();
      if (!value) continue;
      ruleMap.set(`${type}|${value}`, {
        type,
        value,
        enabled: rule.enabled !== false,
      });
    }
    for (const word of filters.block_keywords || []) {
      const value = String(word || "").trim();
      if (!value) continue;
      const key = `keyword|${value}`;
      if (!ruleMap.has(key)) ruleMap.set(key, { type: "keyword", value, enabled: true });
    }
    const rules = Array.from(ruleMap.values());
    let dedupeEnabled = dedupe.enabled !== false;
    let lookback = Number(dedupe.lookback_days ?? 7);
    let similarity = Number(dedupe.min_similarity ?? 0.62);

    new Setting(containerEl).setName("过滤").setHeading();

    new Setting(containerEl)
      .setName("启用过滤")
      .setDesc("标题太短，或命中下面的屏蔽词，就不进报纸")
      .addToggle((toggle) =>
        toggle.setValue(filterEnabled).onChange((value) => {
          filterEnabled = value;
        })
      );

    new Setting(containerEl)
      .setName("标题最少字数")
      .setDesc("少于这个字数（不算空白）的标题会被过滤")
      .addText((text) =>
        text
          .setPlaceholder("6")
          .setValue(String(minTitle))
          .onChange((value) => {
            minTitle = Number(value) || 0;
          })
      );

    containerEl.createEl("p", {
      cls: "setting-item-description",
      text:
        "一条规则就是「命中就不进报纸」。标题包含最常用；来源、链接和正则是高级用法，可以在每行左边切换。",
    });

    const ruleTypes: Array<{ value: string; label: string; placeholder: string }> = [
      {
        value: "keyword",
        label: "标题包含",
        placeholder: "输入要屏蔽的词，例如：广告、带货、某明星",
      },
      {
        value: "source",
        label: "来源包含",
        placeholder: "输入来源，例如：抖音热榜",
      },
      {
        value: "url",
        label: "链接包含",
        placeholder: "输入链接或域名，例如：example.com",
      },
      {
        value: "regex",
        label: "正则",
        placeholder: "输入正则，例如：^广告",
      },
    ];
    const normalizeType = (type: string) => {
      const value = String(type || "keyword").trim();
      if (value === "关键词" || value === "title") return "keyword";
      if (value === "来源") return "source";
      if (value === "链接" || value === "域名" || value === "domain") return "url";
      if (value === "正则表达式") return "regex";
      return ruleTypes.some((row) => row.value === value) ? value : "keyword";
    };
    const placeholderFor = (type: string) =>
      ruleTypes.find((row) => row.value === type)?.placeholder || ruleTypes[0].placeholder;

    const ruleBox = containerEl.createEl("details", {
      cls: "it-filter-rules it-settings-collapse",
    });
    const ruleSummary = ruleBox.createEl("summary");
    const ruleList = ruleBox.createEl("div", { cls: "it-filter-rule-list" });
    const ruleActions = ruleBox.createEl("div", { cls: "it-rule-actions" });
    const renderRules = () => {
      ruleList.empty();
      ruleSummary.setText(`规则列表（${rules.length} 条）`);
      if (!rules.length) {
        ruleList.createEl("div", {
          cls: "it-hint",
          text: "还没有规则。点下面的「添加规则」加一条。",
        });
      }
      rules.forEach((rule, index) => {
        rule.type = normalizeType(rule.type);
        const row = ruleList.createEl("div", { cls: "it-filter-rule" });
        const enabled = row.createEl("input", { type: "checkbox", cls: "it-rule-enabled" });
        enabled.checked = rule.enabled !== false;
        enabled.onchange = () => {
          rule.enabled = enabled.checked;
        };
        const select = row.createEl("select", { cls: "dropdown" });
        for (const type of ruleTypes) {
          const option = select.createEl("option", { value: type.value, text: type.label });
          if (type.value === rule.type) option.selected = true;
        }
        select.value = rule.type;
        const input = row.createEl("input", {
          type: "text",
          cls: "it-input",
        });
        input.placeholder = placeholderFor(rule.type);
        input.value = rule.value;
        input.oninput = () => {
          rule.value = input.value;
        };
        select.onchange = () => {
          rule.type = select.value;
          input.placeholder = placeholderFor(rule.type);
        };
        const remove = row.createEl("button", { text: "删除", cls: "it-mini" });
        remove.onclick = () => {
          rules.splice(index, 1);
          renderRules();
        };
      });
    };

    const addRule = ruleActions.createEl("button", {
      text: "+ 添加规则",
      cls: "it-mini mod-cta",
    });
    addRule.onclick = () => {
      rules.push({ type: "keyword", value: "", enabled: true });
      renderRules();
      const inputs = ruleList.querySelectorAll("input");
      const last = inputs[inputs.length - 1] as HTMLInputElement | undefined;
      last?.focus();
    };
    renderRules();

    const filterPayload = () => ({
      enabled: filterEnabled,
      min_title_chars: minTitle,
      rules: rules
        .map((rule) => ({
          type: rule.type || "keyword",
          value: String(rule.value || "").trim(),
          enabled: rule.enabled !== false,
        }))
        .filter((rule) => rule.value),
      block_keywords: [],
    });

    const saveRules = ruleActions.createEl("button", {
      text: "保存屏蔽规则",
      cls: "it-mini",
    });
    saveRules.onclick = async () => {
      await this.plugin.saveOverrides({ filters: filterPayload() });
      await this.plugin.runCli(["status"], true);
      await this.plugin.view?.refresh();
      new Notice("屏蔽规则已保存，下一份报纸生效");
    };

    new Setting(containerEl).setName("跨天去重").setHeading();

    new Setting(containerEl)
      .setName("避免昨天上过的新闻今天重复")
      .setDesc("已勾「跟踪」的条目不受影响，后续进展会继续更新")
      .addToggle((toggle) =>
        toggle.setValue(dedupeEnabled).onChange((value) => {
          dedupeEnabled = value;
        })
      );

    new Setting(containerEl)
      .setName("回看天数")
      .setDesc("1 = 只看昨天，2 = 看前两天，依此类推")
      .addText((text) =>
        text
          .setPlaceholder("2")
          .setValue(String(lookback))
          .onChange((value) => {
            lookback = Number(value) || 2;
          })
      );

    new Setting(containerEl)
      .setName("相似度阈值")
      .setDesc("0.45–0.75 之间；越高越不容易误判，但重复新闻可能漏过")
      .addText((text) =>
        text
          .setPlaceholder("0.62")
          .setValue(String(similarity))
          .onChange((value) => {
            similarity = Number(value) || 0.62;
          })
      );

    new Setting(containerEl).addButton((button) =>
      button
        .setButtonText("保存全部规则")
        .setCta()
        .onClick(async () => {
          await this.plugin.saveOverrides({
            filters: filterPayload(),
            dedupe: {
              enabled: dedupeEnabled,
              lookback_days: Math.max(1, Math.min(14, lookback)),
              min_similarity: Math.max(0.3, Math.min(0.95, similarity)),
            },
          });

          await this.plugin.runCli(["status"], true);
          await this.plugin.view?.refresh();
          new Notice("规则已保存，下一份报纸生效");
        })
    );

    new Setting(containerEl).setName("高级选项").setHeading();

    new Setting(containerEl)
      .setName("显示判断簿")
      .setDesc("在主页显示判断簿，用于记录可检验判断；默认关闭。")
      .addToggle((toggle) =>
        toggle
          .setValue(!!this.plugin.settings.showJudgments)
          .onChange(async (value) => {
            this.plugin.settings.showJudgments = value;
            await this.plugin.saveSettings();
            this.plugin.view?.refresh();
          })
      );

    new Setting(containerEl).setName("更新").setHeading();
    new Setting(containerEl)
      .setName("插件更新")
      .setDesc("通过 Obsidian 市场自动更新。本地增强服务的更新在「本地增强服务」里检测。")
      .addButton((button) =>
        button.setButtonText("打开市场页").onClick(() => {
          openExternalUrl("https://community.obsidian.md/plugins/under-the-sun");
        })
      );

    const helpBox = containerEl.createEl("details", {
      cls: "it-settings-collapse it-settings-plain",
    });
    helpBox.createEl("summary", { text: "主页按钮说明" });
    const help = helpBox.createEl("ul", { cls: "it-settings-help" });
    for (const [title, desc] of [
      [
        "抓取并出报",
        "抓取热榜与 RSS，补全正文、聚类打分、更新跟踪，然后生成当天日报。今天已有日报时会先确认；确认后会覆盖正文，但保留跟踪/已读勾选和 AI 缓存。",
      ],
      ["打开今日日报", "只打开当天已生成的日报，不会抓取或改写。"],
      [
        "停止",
        "尝试停止当前任务。当前后端只支持等待任务完成，按钮可能提示暂不支持中断。",
      ],
      [
        "AI 解读",
        "点击展开或收起 AI 设置。未配置 API Key 时会显示 DeepSeek 获取 Key 的步骤。AI 只做证据链研判，不参与排序。",
      ],
      [
        "本地增强服务",
        "点击打开增强服务设置，查看连接状态、token 和安装/更新入口。",
      ],
    ] as Array<[string, string]>) {
      const li = help.createEl("li");
      li.createEl("strong", { text: title + "：" });
      li.createEl("span", { text: desc });
    }
    new Setting(containerEl).setName("日报导出").setHeading();
    new Setting(containerEl)
      .setName("复制今日日报")
      .setDesc("把今天的日报复制成 Markdown，方便粘贴到聊天、邮件或其他笔记。")
      .addButton((button) =>
        button.setButtonText("复制 Markdown").onClick(() => {
          void this.plugin.copyDigest();
        })
      );
    new Setting(containerEl)
      .setName("导出为 HTML")
      .setDesc("导出到 朝闻天下/导出/YYYY-MM-DD.html，可发给别人或浏览器打开。")
      .addButton((button) =>
        button.setButtonText("导出 HTML").onClick(() => {
          void this.plugin.exportDigestHtml();
        })
      );

    new Setting(containerEl).setName("反馈").setHeading();
    new Setting(containerEl)
      .setName("GitHub Issues")
      .setDesc("报告问题、提功能建议，或查看作者主页。")
      .addButton((button) =>
        button
          .setButtonText("报告问题")
          .setClass("it-mini")
          .onClick(() => {
            openExternalUrl(
              "https://github.com/0xTack/obsidian-under-the-sun/issues/new?template=bug_report.md"
            );
          })
      )
      .addButton((button) =>
        button
          .setButtonText("功能建议")
          .setClass("it-mini")
          .onClick(() => {
            openExternalUrl(
              "https://github.com/0xTack/obsidian-under-the-sun/issues/new?template=feature_request.md"
            );
          })
      )
      .addButton((button) =>
        button
          .setButtonText("作者主页")
          .setClass("it-mini")
          .onClick(() => {
            openExternalUrl("https://github.com/0xTack");
          })
      );
  }
}
