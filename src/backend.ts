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

/**
 * 本地完整版后端的唯一入口。
 *
 * 插件不 spawn、不读项目目录，只请求 127.0.0.1。
 * 没有后端时所有调用都会快速失败，界面退回简单模式。
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
      return { code: -1, output: "完整版后端未配置" };
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
