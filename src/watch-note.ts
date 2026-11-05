/**
 * 跟踪笔记的原位修改。
 *
 * 手机端没有 Python，不能调 `watch-stop` / `watch-start` / `watch-sort`。
 * 这三件事本质上只是改笔记，所以抽成纯函数，手机和电脑都能直接执行。
 */

export type WatchOrder = "newest" | "oldest";

function setFrontmatterValue(data: string, key: string, value: string): string {
  const line = new RegExp(`^${key}:\\s*.*$`, "m");
  if (line.test(data)) return data.replace(line, `${key}: ${value}`);
  if (!data.startsWith("---\n")) return data;
  const end = data.indexOf("\n---", 4);
  if (end === -1) return data;
  return `${data.slice(0, end + 1)}${key}: ${value}\n${data.slice(end + 1)}`;
}

function statusSpan(watchId: number, active: boolean): string {
  const cls = active ? "it-watch-status is-active" : "it-watch-status";
  const label = active ? "追踪中" : "已停止追踪";
  const cmd = active ? "watch-stop" : "watch-start";
  const action = active ? "停止追踪" : "重新追踪";
  return (
    `<span class="${cls}">${label}` +
    `<span class="it-watch-menu">` +
    `<a href="obsidian://info-tracker?cmd=${cmd}&watch=${watchId}">${action}</a>` +
    `</span></span>`
  );
}

const STATUS_RE =
  /<span class="it-watch-status(?: is-active)?">[\s\S]*?<span class="it-watch-menu">[\s\S]*?<\/span><\/span>/;

function setStatusSpan(data: string, watchId: number, active: boolean): string {
  if (STATUS_RE.test(data)) {
    return data.replace(STATUS_RE, statusSpan(watchId, active));
  }
  return data;
}

function sortLine(watchId: number, order: WatchOrder): string {
  if (order === "newest") {
    return `> **最近**\u3000[最初](obsidian://info-tracker?cmd=watch-sort&watch=${watchId}&order=oldest)`;
  }
  return `> [最近](obsidian://info-tracker?cmd=watch-sort&watch=${watchId}&order=newest)\u3000**最初**`;
}

function reorderTimeline(lines: string[], order: WatchOrder): string[] {
  const heading = lines.findIndex((line) => line.trim() === "## 时间线");
  if (heading === -1) return lines;

  const starts: number[] = [];
  let sectionEnd = lines.length;
  for (let i = heading + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) {
      sectionEnd = i;
      break;
    }
    if (/^> - /.test(lines[i])) starts.push(i);
  }
  if (starts.length < 2) return lines;

  let regionEnd = starts[starts.length - 1] + 1;
  while (regionEnd < sectionEnd && /^>/.test(lines[regionEnd])) regionEnd++;

  // 时间线末尾的空引用行（`>`）不属于任何一条事件，留在原处
  let contentEnd = regionEnd;
  while (contentEnd > starts[0] && /^>\s*$/.test(lines[contentEnd - 1])) contentEnd--;

  const chunks: string[][] = [];
  let current: string[] = [];
  for (let i = starts[0]; i < contentEnd; i++) {
    if (/^> - /.test(lines[i]) && current.length) {
      chunks.push(current);
      current = [];
    }
    current.push(lines[i]);
  }
  if (current.length) chunks.push(current);
  if (chunks.length < 2) return lines;

  chunks.reverse();
  return [
    ...lines.slice(0, starts[0]),
    ...chunks.reduce((all, chunk) => all.concat(chunk), []),
    ...lines.slice(contentEnd),
  ];
}

export function setWatchActiveInNote(
  data: string,
  watchId: number,
  active: boolean
): string {
  const next = setFrontmatterValue(data, "active", active ? "1" : "0");
  return setStatusSpan(next, watchId, active);
}

export function setWatchOrderInNote(
  data: string,
  watchId: number,
  order: WatchOrder
): string {
  const current = (/^order:\s*(newest|oldest)\s*$/m.exec(data)?.[1] || "newest") as WatchOrder;
  let next = setFrontmatterValue(data, "order", order);

  const lines = next.split("\n");
  const index = lines.findIndex(
    (line) => line.includes("cmd=watch-sort") && line.includes(`watch=${watchId}`)
  );
  if (index >= 0) lines[index] = sortLine(watchId, order);

  const reordered = current === order ? lines : reorderTimeline(lines, order);
  next = reordered.join("\n");
  return next;
}

export function watchNoteItemId(data: string): number | null {
  const match = /^item_id:\s*(\d+)\s*$/m.exec(data);
  return match ? Number(match[1]) : null;
}

export function setDigestTrackedInNote(
  data: string,
  itemId: number,
  tracked: boolean
): string {
  const marker = `<!-- t:${itemId} -->`;
  if (!data.includes(marker)) return data;
  const box = tracked ? "- [x]" : "- [ ]";
  return data
    .split("\n")
    .map((line) =>
      line.includes(marker) ? line.replace(/- \[[ xX]\]/, box) : line
    )
    .join("\n");
}
