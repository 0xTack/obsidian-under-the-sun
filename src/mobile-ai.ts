import { requestUrl } from "obsidian";

export interface MobileAIConfig {
  aiEnabled: boolean;
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  reasoningEffort: string;
}

const INTERPRET_PROMPT = `你是资深新闻评论编辑，按下面的方法分析一条新闻，不要复述新闻。严格按格式输出，不要加多余文字：
一句话：不超过 40 字，概括最核心的事实与意义。
===
【事实】只写材料中确定的事实；材料不足时补一句「尚不清楚：…」
【报道评价】用 1-2 句判断报道本身：信源是否单一、是否缺关键背景、标题是否夸大；只写能判断的
【核心矛盾】这件事真正的冲突是什么
【利益与权力】谁获利、谁承担成本、谁有决定权、谁没有发言权
【原因】为什么会发生
【反方】反对这个判断的人，最强的理由是什么
【判断】一句话给出你的判断
【更大的问题】从个案上升到什么更普遍的问题
要求：材料不足时明确说「已知信息有限」，不要编造；每节不超过两句；总字数 300-500。`;

const CHAT_PROMPT = `你是新闻分析助手，正在和用户讨论一条具体新闻。
规则：
1. 只基于下面提供的材料、已有判断和对话历史回答，不要编造。
2. 区分事实、推断和判断；不知道就说不知道。
3. 回答简洁，先直接回答，再补依据。
4. 用户要判断时，给出可检验的判断、置信度和最强反方。
5. 不要重复整篇解读，不要把话说满。`;

export class MobileAI {
  config: MobileAIConfig;
  error = "";

  constructor(config: MobileAIConfig) {
    this.config = config;
  }

  available(): boolean {
    return !!(
      this.config.aiEnabled &&
      this.config.apiKey.trim() &&
      this.config.model.trim()
    );
  }

  private async post(
    messages: Array<{ role: string; content: string }>,
    maxTokens: number,
    temperature: number
  ): Promise<string> {
    if (!this.available()) {
      this.error = "AI 未启用或没有 API Key";
      return "";
    }
    const payload: any = {
      model: this.config.model,
      temperature,
      max_tokens: maxTokens,
      messages,
    };
    if (this.config.reasoningEffort) {
      payload.reasoning_effort = this.config.reasoningEffort;
    }
    try {
      const res = await requestUrl({
        url: `${this.config.apiBaseUrl.replace(/\/+$/, "")}/chat/completions`,
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        throw: false,
      });
      if (res.status < 200 || res.status >= 300) {
        this.error = `HTTP ${res.status}: ${(res.text || "").slice(0, 200)}`;
        return "";
      }
      const data = JSON.parse(res.text);
      return String(data?.choices?.[0]?.message?.content || "").trim();
    } catch (err) {
      this.error = String(err);
      return "";
    }
  }

  async translate(text: string): Promise<string> {
    const query = (text || "").trim();
    if (!query || !this.available()) return "";
    return this.post(
      [
        {
          role: "system",
          content:
            "你是严谨的新闻翻译。把用户给出的外文新闻标题或摘要翻译成简体中文。" +
            "只输出译文，不要解释，不要保留原文，不要加引号。人名、机构名、数字和日期保持准确。",
        },
        { role: "user", content: query.slice(0, 2000) },
      ],
      1200,
      0
    );
  }

  async interpret(title: string, summary = ""): Promise<string> {
    return this.post(
      [
        { role: "system", content: INTERPRET_PROMPT },
        {
          role: "user",
          content: `标题：${title}\n摘要：${(summary || "（无摘要）").slice(
            0,
            600
          )}\n正文：${(summary || "（无正文）").slice(0, 1500)}`,
        },
      ],
      4000,
      0.3
    );
  }

  async chat(
    title: string,
    summary = "",
    messages: Array<{ role: string; content: string }> = [],
    insight = ""
  ): Promise<string> {
    const history = messages
      .slice(-20)
      .filter((message) => ["user", "assistant"].includes(message.role))
      .map((message) => ({
        role: message.role,
        content: String(message.content || "").slice(0, 4000),
      }))
      .filter((message) => message.content);
    const system =
      CHAT_PROMPT +
      `\n新闻标题：${title}\n摘要：${(summary || "（无摘要）").slice(
        0,
        800
      )}\n已有判断：${insight || "（还没有判断卡）"}`;
    return this.post(
      [{ role: "system", content: system }, ...history],
      2000,
      0.4
    );
  }

  async test(): Promise<{ ok: boolean; message: string }> {
    const text = await this.post(
      [
        {
          role: "user",
          content: "只回复两个字：可用",
        },
      ],
      500,
      0
    );
    return {
      ok: !!text,
      message: text || this.error || "没有返回内容",
    };
  }
}
