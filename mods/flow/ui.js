// Flow 共享视觉工具与窗口辅助：统一状态排序、Space 着色、标题清理与浮窗速览。

import { div, svg, image } from "gpui-kit";
import { home, shared, setShared, spaces, openOverlay } from "herdr";

const PROJECT_COLOR_KEYS = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
const SPACE_PALETTE = {
  ansi6: "#22a99a",
  ansi3: "#e3814f",
  ansi4: "#5b8def",
  ansi5: "#8b7cf6",
  ansi2: "#3fae6a",
  ansi1: "#d9649a",
};

export const STATUS_RANK = { blocked: 4, done: 3, working: 2, idle: 1 };

// 可拖动顶栏内的控件必须阻断左右键按下冒泡，防止触发窗口拖拽或系统标题栏右键菜单
export function ownPress(el) {
  return el
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_mouse_down("right", (_e, cx) => cx.stop_propagation());
}

// 安全为任意 #rgb / #rrggbb / #rrggbbaa 颜色附加透明度，避免 8 位主题色拼接溢出
export function alphaColor(hex, alphaHex) {
  if (typeof hex !== "string" || !hex.startsWith("#")) return hex;
  if (hex.length === 4) {
    const r = hex[1];
    const g = hex[2];
    const b = hex[3];
    return `#${r}${r}${g}${g}${b}${b}${alphaHex}`;
  }
  if (hex.length >= 7) return `${hex.slice(0, 7)}${alphaHex}`;
  return hex;
}

export function findLayoutNode(node, id) {
  if (!node) return null;
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const found = findLayoutNode(child, id);
    if (found) return found;
  }
  return null;
}

// 兼容官方 spaces/picker 的项目颜色分配表，确保跨布局颜色一致
export function spaceColor(t, space) {
  if (!space || space.name === "~") return t.dim;
  const list = spaces();
  const ids = new Set(list.map((s) => s.id));
  const raw = shared("space.colors");
  const kept = Object.fromEntries(Object.entries(raw && typeof raw === "object" ? raw : {}).filter(([id]) => ids.has(id)));
  let changed = Object.keys(kept).length !== Object.keys(raw ?? {}).length;
  for (const s of list) {
    if (kept[s.id] || s.name === "~") continue;
    const countOf = (key) => Object.values(kept).filter((v) => v === key).length;
    kept[s.id] = PROJECT_COLOR_KEYS.reduce((best, c) => (countOf(c) < countOf(best) ? c : best));
    changed = true;
  }
  if (changed) setShared("space.colors", kept);
  const picked = kept[space.id] ?? PROJECT_COLOR_KEYS[0];
  return picked.startsWith("#") ? picked : (SPACE_PALETTE[picked] ?? t[picked] ?? t.accent);
}

// 去除 Agent 自带的前缀旋转字符或状态标记
export function cleanTitle(raw) {
  return (raw ?? "").replace(/^[^\p{L}\p{N}\p{Ps}\p{Pi}]+/u, "").replace(/^\[ [!.] \] /, "").trim();
}

export function shortenPath(cwd) {
  if (!cwd) return "";
  const norm = cwd.replace(/\\/g, "/");
  const h = (home() ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
  if (h && norm === h) return "~";
  if (h && norm.startsWith(`${h}/`)) return `~${norm.slice(h.length)}`;
  return cwd;
}

export function ageText(ms) {
  if (!ms || ms <= 0) return "";
  const diff = Math.max(0, Date.now() - ms);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  return hr < 24 ? `${hr}h` : `${Math.floor(hr / 24)}d`;
}

export function programIcon(program, size, color) {
  if (!program?.icon) return null;
  return program.tint
    ? svg(program.icon).size(size).flex_none().text_color(color)
    : image(program.icon).w(size).h(size).flex_none();
}

export function flowIcon(name, size, color) {
  return svg(`mods/flow/icons/${name}.svg`).size(size).flex_none().text_color(color);
}

export function statusColor(t, status) {
  if (status === "blocked") return t.blocked;
  if (status === "done") return t.done;
  if (status === "working") return t.working;
  return t.dim;
}

export function statusLabel(status) {
  if (status === "blocked") return "待拍板";
  if (status === "done") return "已完工";
  if (status === "working") return "运行中";
  if (status === "idle") return "已闲置";
  return "终端";
}

// 统一按 待拍板 > 已完工 > 运行中 > 已闲置 计算所有可批阅 Agent 队列（含置顶优先）
export function buildAgentGroups(allAgents, allTerminals) {
  const live = allTerminals.filter((x) => x.state === "live");
  const subMap = new Map();
  for (const term of live) {
    if (!term.parent) continue;
    const arr = subMap.get(term.parent) ?? [];
    arr.push(term);
    subMap.set(term.parent, arr);
  }
  const collectKids = (addr, depth) => {
    const out = [];
    for (const k of subMap.get(addr) ?? []) {
      out.push({ terminal: k, depth });
      out.push(...collectKids(k.address, depth + 1));
    }
    return out;
  };

  const nestedSet = new Set();
  for (const a of allAgents) {
    for (const k of collectKids(a.address, 1)) nestedSet.add(k.terminal.address);
  }
  const topAgents = allAgents.filter((a) => a.pinned || !nestedSet.has(a.address));
  const rankOf = (a) => {
    const kids = collectKids(a.address, 1);
    let best = STATUS_RANK[a.status] ?? 0;
    for (const k of kids) {
      const ks = k.terminal.status === "error" ? "blocked" : k.terminal.status === "done" ? "idle" : k.terminal.status;
      best = Math.max(best, STATUS_RANK[ks] ?? 0);
    }
    return best;
  };
  const sorted = [...topAgents].sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
    return rankOf(b) - rankOf(a) || (b.seq ?? 0) - (a.seq ?? 0);
  });
  return {
    sorted,
    collectKids,
    needsYou: sorted.filter((a) => a.status === "blocked" || a.status === "done"),
    working: sorted.filter((a) => a.status === "working"),
    idle: sorted.filter((a) => a.status === "idle"),
  };
}

// 在当前屏幕上打开/替换悬浮速览批阅窗，底层工作区保持原位不动
export function openTriageWindow(address) {
  if (!address) return;
  openOverlay({
    kind: "window",
    key: "flow-triage",
    width: 0.78,
    height: 0.74,
    layout: {
      id: "flow-triage-root",
      type: "column",
      background: "surface",
      children: [
        {
          id: "flow-triage-head",
          type: "block",
          size: { px: 38 },
          content: { mod: "flow", props: { role: "triage-bar", terminal: address } },
        },
        {
          id: "flow-triage-term",
          type: "block",
          content: { terminal: address },
        },
      ],
    },
  });
}

export function openProjectsModal() {
  openOverlay({
    mod: "flow",
    props: { role: "projects" },
    kind: "dialog",
    width: 0.86,
    height: 0.80,
  });
}

export function openAgentsModal() {
  openOverlay({
    mod: "flow",
    props: { role: "agents" },
    kind: "dialog",
    width: 540,
    height: 580,
  });
}

export function openCaptureModal() {
  openOverlay({
    mod: "flow",
    props: { role: "capture" },
    kind: "dialog",
    width: 480,
  });
}

export function openNotesWindow() {
  openOverlay({
    mod: "flow",
    props: { role: "notes" },
    kind: "window",
    key: "flow-notes",
    keep: true,
    width: 370,
    height: 410,
  });
}

export function actionPill(t, id, label, accent, onClick) {
  return div()
    .id(id)
    .px(10)
    .h(26)
    .rounded(6)
    .flex()
    .items_center()
    .justify_center()
    .cursor_pointer()
    .text_size(12)
    .font_medium()
    .bg(accent ? t.solid : t.raised)
    .border_1()
    .border_color(accent ? t.solid : t.border)
    .text_color(accent ? t.solid_foreground : t.foreground)
    .hover((s) => s.opacity(0.88))
    .on_click(onClick)
    .child(label);
}
