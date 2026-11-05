import { requestUrl } from "obsidian";

export interface BackendHealth {
  ok: boolean;
  version?: string;
  api?: number;
  error?: string;
}

export interface BackendResult {
  code: number;
  output: string;
}

export interface SourceTestResult {
  key?: string;
  name: string;
  url: string;
  kind?: "hot" | "rss" | "config" | string;
  region?: string;
  ok: boolean;
  status?: number;
  count?: number;
  error?: string;
}

/**
 * 本地本地增强服务的唯一入口。
 *
 * 插件不 spawn、不读项目目录，只请求 127.0.0.1。
 * 没有后端时所有调用都会快速失败，界面退回轻量模式。
 */
export class BackendClient {
  constructor(private baseUrl: string, private token: string) {}

  get configured(): boolean {
    return !!this.baseUrl.trim();
  }

  private endpoint(path: string): string {
    return `${this.baseUrl.trim().replace(/\/+$/, "")}${path}`;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.token.trim()) headers["X-Under-The-Sun-Token"] = this.token.trim();
    return headers;
  }

  async health(): Promise<BackendHealth> {
    if (!this.configured) return { ok: false, error: "未配置后端地址" };
    try {
      const res = await requestUrl({
        url: this.endpoint("/health"),
        method: "GET",
        headers: this.headers(),
        throw: false,
      });
      if (res.status < 200 || res.status >= 300) {
        return { ok: false, error: `HTTP ${res.status}` };
      }
      const data = (res.json || {}) as { ok?: boolean; version?: string; api?: number };
      return {
        ok: data.ok !== false,
        version: data.version,
        api: data.api,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async status(): Promise<Record<string, any> | null> {
    if (!this.configured) return null;
    try {
      const res = await requestUrl({
        url: this.endpoint("/status"),
        method: "GET",
        headers: this.headers(),
        throw: false,
      });
      if (res.status < 200 || res.status >= 300) return null;
      return res.json || null;
    } catch {
      return null;
    }
  }

  async run(args: string[]): Promise<BackendResult> {
    if (!this.configured) {
      return { code: -1, output: "本地增强服务未配置" };
    }
    try {
      const res = await requestUrl({
        url: this.endpoint("/cli"),
        method: "POST",
        headers: { ...this.headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ args }),
        throw: false,
      });
      const data = (res.json || {}) as { code?: number; output?: string; error?: string };
      if (res.status < 200 || res.status >= 300) {
        return {
          code: typeof data.code === "number" ? data.code : -1,
          output: data.error || data.output || `HTTP ${res.status}`,
        };
      }
      return {
        code: typeof data.code === "number" ? data.code : 0,
        output: data.output || "",
      };
    } catch (err) {
      return {
        code: -1,
        output: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async schedule(): Promise<{ enabled?: boolean; morning?: string; evening?: string; eveningDigest?: boolean } | null> {
    if (!this.configured) return null;
    try {
      const res = await requestUrl({
        url: this.endpoint("/schedule"),
        method: "GET",
        headers: this.headers(),
        throw: false,
      });
      if (res.status < 200 || res.status >= 300) return null;
      return (res.json || null) as { enabled?: boolean; morning?: string; evening?: string; eveningDigest?: boolean } | null;
    } catch {
      return null;
    }
  }

  async testSources(): Promise<SourceTestResult[] | null> {
    if (!this.configured) return null;
    try {
      const res = await requestUrl({
        url: this.endpoint("/sources/test"),
        method: "GET",
        headers: this.headers(),
        throw: false,
      });
      if (res.status < 200 || res.status >= 300) return null;
      const data = (res.json || {}) as { results?: SourceTestResult[] };
      return Array.isArray(data.results) ? data.results : null;
    } catch {
      return null;
    }
  }

  async aiModels(): Promise<{ ok: boolean; models: string[]; error?: string } | null> {
    if (!this.configured) return null;
    try {
      const res = await requestUrl({
        url: this.endpoint("/ai/models"),
        method: "GET",
        headers: this.headers(),
        throw: false,
      });
      if (res.status < 200 || res.status >= 300) return null;
      const data = (res.json || {}) as { ok?: boolean; models?: string[]; error?: string };
      return {
        ok: !!data.ok,
        models: Array.isArray(data.models) ? data.models : [],
        error: data.error,
      };
    } catch {
      return null;
    }
  }

  async aiTest(): Promise<{ ok: boolean; message: string; model?: string } | null> {
    if (!this.configured) return null;
    try {
      const res = await requestUrl({
        url: this.endpoint("/ai/test"),
        method: "POST",
        headers: { ...this.headers(), "Content-Type": "application/json" },
        body: "{}",
        throw: false,
      });
      if (res.status < 200 || res.status >= 300) return null;
      const data = (res.json || {}) as { ok?: boolean; message?: string; model?: string };
      return {
        ok: !!data.ok,
        message: data.message || (data.ok ? "连接成功" : "连接失败"),
        model: data.model,
      };
    } catch {
      return null;
    }
  }

  async saveSchedule(patch: {
    enabled?: boolean;
    morning?: string;
    evening?: string;
    eveningDigest?: boolean;
  }): Promise<boolean> {
    if (!this.configured) return false;
    try {
      const res = await requestUrl({
        url: this.endpoint("/schedule"),
        method: "POST",
        headers: { ...this.headers(), "Content-Type": "application/json" },
        body: JSON.stringify(patch),
        throw: false,
      });
      return res.status >= 200 && res.status < 300;
    } catch {
      return false;
    }
  }

  async saveConfig(partial: any): Promise<boolean> {
    if (!this.configured) return false;
    try {
      const res = await requestUrl({
        url: this.endpoint("/config"),
        method: "POST",
        headers: { ...this.headers(), "Content-Type": "application/json" },
        body: JSON.stringify(partial || {}),
        throw: false,
      });
      return res.status >= 200 && res.status < 300;
    } catch {
      return false;
    }
  }

  async logs(): Promise<string> {
    if (!this.configured) return "";
    try {
      const res = await requestUrl({
        url: this.endpoint("/logs"),
        method: "GET",
        headers: this.headers(),
        throw: false,
      });
      if (res.status < 200 || res.status >= 300) return "";
      return typeof res.text === "string" ? res.text : JSON.stringify(res.json || "");
    } catch {
      return "";
    }
  }
}
