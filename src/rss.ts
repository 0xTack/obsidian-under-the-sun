import { requestUrl } from "obsidian";

export interface RssItem {
  id: string;
  title: string;
  link: string;
  summary: string;
  feed: string;
  date: string;
  score: number;
  read?: boolean;
  translated?: string;
  translatedTitle?: string;
}

export function stripHtml(input: string): string {
  const text = (input || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  return text
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function hash(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

export function parseDate(value: string): string {
  if (!value) return "";
  const time = Date.parse(value);
  if (Number.isNaN(time)) return "";
  return new Date(time).toISOString();
}

function titleKey(title: string): string {
  return (title || "").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function bigrams(text: string): Set<string> {
  const key = titleKey(text);
  const out = new Set<string>();
  for (let i = 0; i < key.length - 1; i++) out.add(key.slice(i, i + 2));
  return out;
}

function similarTitle(a: string, b: string): boolean {
  const ka = titleKey(a);
  const kb = titleKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  if (ka.length < 8 || kb.length < 8) return false;
  const ga = bigrams(a);
  const gb = bigrams(b);
  if (!ga.size || !gb.size) return false;
  let overlap = 0;
  for (const token of ga) if (gb.has(token)) overlap += 1;
  return overlap / Math.max(ga.size, gb.size) >= 0.82;
}

function scoreOf(item: RssItem, now = Date.now()): number {
  const time = Date.parse(item.date || "");
  const ageHours = time ? Math.max(0, (now - time) / 3600000) : 72;
  const recency = 1 / (1 + ageHours / 18);
  const body = Math.min((item.summary || "").length, 600) / 600;
  const title = Math.min((item.title || "").length, 60) / 60;
  return Number((recency * 0.7 + body * 0.2 + title * 0.1).toFixed(4));
}

export function parseFeed(xml: string, feedUrl: string): RssItem[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const feedTitle =
    doc.querySelector("channel > title")?.textContent?.trim() ||
    doc.querySelector("feed > title")?.textContent?.trim() ||
    hostOf(feedUrl);

  const nodes = Array.from(doc.getElementsByTagName("item")).concat(
    Array.from(doc.getElementsByTagName("entry"))
  );

  const items: RssItem[] = [];
  for (const node of nodes) {
    const title = stripHtml(node.getElementsByTagName("title")[0]?.textContent || "");
    if (!title) continue;

    let link = "";
    const linkEl = node.getElementsByTagName("link")[0];
    if (linkEl) link = linkEl.getAttribute("href") || linkEl.textContent || "";
    if (!link) {
      const guid = node.getElementsByTagName("guid")[0]?.textContent || "";
      if (/^https?:/i.test(guid)) link = guid;
    }

    const summary =
      stripHtml(node.getElementsByTagName("description")[0]?.textContent || "") ||
      stripHtml(node.getElementsByTagName("summary")[0]?.textContent || "") ||
      stripHtml(node.getElementsByTagName("content:encoded")[0]?.textContent || "") ||
      stripHtml(node.getElementsByTagName("content")[0]?.textContent || "");

    const date =
      parseDate(node.getElementsByTagName("pubDate")[0]?.textContent || "") ||
      parseDate(node.getElementsByTagName("updated")[0]?.textContent || "") ||
      parseDate(node.getElementsByTagName("published")[0]?.textContent || "") ||
      parseDate(node.getElementsByTagName("dc:date")[0]?.textContent || "");

    const item: RssItem = {
      id: hash(`${feedTitle}|${title}|${link}`),
      title,
      link,
      summary: summary.slice(0, 600),
      feed: feedTitle,
      date,
      score: 0,
    };
    item.score = scoreOf(item);
    items.push(item);
  }
  return items;
}

export function dedupeItems(items: RssItem[]): RssItem[] {
  const sorted = items
    .slice()
    .sort((a, b) => b.score - a.score || (b.date || "").localeCompare(a.date || ""));
  const kept: RssItem[] = [];
  for (const item of sorted) {
    const duplicate = kept.some(
      (other) =>
        (!!item.link && item.link === other.link) ||
        similarTitle(item.title, other.title)
    );
    if (!duplicate) kept.push(item);
  }
  return kept;
}

export function isMostlyChinese(text: string): boolean {
  const sample = (text || "").slice(0, 300);
  const cjk = (sample.match(/[\u3400-\u9fff]/g) || []).length;
  const letters = (sample.match(/[A-Za-z\u3400-\u9fff]/g) || []).length;
  return letters > 0 && cjk / letters > 0.3;
}

export async function translateText(text: string, target = "zh-CN"): Promise<string> {
  const query = (text || "").trim();
  if (!query || isMostlyChinese(query)) return "";
  try {
    const res = await requestUrl({
      url: `https://api.mymemory.translated.net/get?q=${encodeURIComponent(
        query.slice(0, 450)
      )}&langpair=en|${encodeURIComponent(target)}`,
      method: "GET",
      throw: false,
    });
    if (res.status < 200 || res.status >= 300) return "";
    const data = res.json as {
      responseData?: { translatedText?: string };
    };
    const translated = String(data.responseData?.translatedText || "").trim();
    if (!translated || /MYMEMORY WARNING/i.test(translated)) return "";
    return translated;
  } catch {
    return "";
  }
}
