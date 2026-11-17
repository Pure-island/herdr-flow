// 项目全景浏览器（role: "projects"）：跨本机与远端机器一览所有 Space、Git 分支与脏改动、运行程序，支持键盘导航与不切桌面速览。

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, ScrollHandle } from "gpui-base";
import {
  spaces,
  panes,
  agents,
  machines,
  run,
  exec,
  hc,
  theme,
  props,
  closeOverlay,
  pickFolder,
  openOverlay,
  checking,
} from "herdr";
import {
  alphaColor,
  spaceColor,
  shortenPath,
  flowIcon,
  programIcon,
  statusColor,
  statusLabel,
  openTriageWindow,
  actionPill,
} from "./ui.js";

const GIT_CONCURRENCY = 4;

function parseGitStatus(stdout) {
  let branch = null;
  let ahead = 0;
  let behind = 0;
  let dirty = 0;
  for (const raw of (stdout ?? "").split(/\r?\n/)) {
    if (!raw) continue;
    if (raw.startsWith("# branch.head ")) {
      const head = raw.slice(14).trim();
      if (head && head !== "(detached)") branch = head;
    } else if (raw.startsWith("# branch.ab ")) {
      const match = /\+(\d+)\s+-(\d+)/.exec(raw);
      if (match) {
        ahead = Number(match[1]);
        behind = Number(match[2]);
      }
    } else if (!raw.startsWith("#")) {
      dirty += 1;
    }
  }
  return { branch, ahead, behind, dirty, isRepo: true };
}

export default class ProjectsView extends View {
  init(_props, cx) {
    this.filter = "";
    this.scope = "all";
    this.selectedIndex = 0;
    this.cols = 3;
    this.gitMap = {};
    this.gitLoading = new Set();
    this.remoteHosts = [];
    this.scroll = ScrollHandle.new();
    this.handle = cx.focus_handle();
    this.input = InputState.new({ placeholder: "搜索项目名、路径、分支、机器或程序名…" });
    this.input.on("change", (_e, cx) => {
      this.filter = this.input.value().trim().toLowerCase();
      this.selectedIndex = 0;
      cx.notify();
    });
    this.input.on("submit", () => {
      const cards = this.filteredCards();
      const chosen = cards[this.selectedIndex];
      if (chosen) this.switchToSpace(chosen.space.id);
    });
    this.input.focus();

    if (checking()) return;

    cx.timer.after(120, () => this.input.focus());
    this.loadRemoteMachines(cx);
    this.refreshGitForSpaces(cx);
  }

  close() {
    const ov = props()?.overlay;
    if (ov) closeOverlay(ov);
  }

  switchToSpace(spaceId) {
    this.close();
    run("space.select", { id: spaceId });
  }

  peekSpace(spaceCard) {
    if (!spaceCard.leadTerminal) return;
    this.close();
    openTriageWindow(spaceCard.leadTerminal);
  }

  loadRemoteMachines(cx) {
    cx.spawn(async (cx) => {
      try {
        const res = await hc(["machine", "ls", "--json"]);
        if (res.code === 0) {
          const parsed = JSON.parse(res.stdout);
          this.remoteHosts = (parsed.machines ?? [])
            .filter((m) => m.state === "connected" && !m.temporary)
            .map((m) => m.name);
        }
      } catch {}
      cx.notify();
    });
  }

  spaceFolder(space, allPanes) {
    const tabSet = new Set((space.tabs ?? []).map((tab) => tab.id));
    return allPanes.find((p) => tabSet.has(p.tab) && p.cwd)?.cwd || space.folder || "";
  }

  refreshGitForSpaces(cx) {
    const allPanes = panes();
    const targets = [];
    for (const space of spaces()) {
      const folder = this.spaceFolder(space, allPanes);
      if (!folder) continue;
      const key = `${space.machine ?? "local"}::${folder}`;
      if (key in this.gitMap || this.gitLoading.has(key)) continue;
      this.gitLoading.add(key);
      targets.push({ key, folder, machine: space.machine });
    }
    if (!targets.length) return;

    cx.spawn(async (cx) => {
      let cursor = 0;
      const worker = async () => {
        while (cursor < targets.length) {
          const item = targets[cursor];
          cursor += 1;
          try {
            const opts = item.machine
              ? { cwd: item.folder, on: item.machine, timeout: 8000 }
              : { cwd: item.folder, timeout: 8000 };
            const res = await exec("git", ["status", "--porcelain=v2", "--branch"], opts);
            if (res.code === 0) {
              this.gitMap[item.key] = parseGitStatus(res.stdout);
            } else {
              this.gitMap[item.key] = { branch: null, ahead: 0, behind: 0, dirty: 0, isRepo: false };
            }
          } catch {
            this.gitMap[item.key] = { branch: null, ahead: 0, behind: 0, dirty: 0, isRepo: false };
          } finally {
            this.gitLoading.delete(item.key);
          }
        }
      };
      const workers = [];
      for (let i = 0; i < Math.min(GIT_CONCURRENCY, targets.length); i++) workers.push(worker());
      await Promise.all(workers);
      cx.notify();
    });
  }

  buildCards() {
    const allPanes = panes();
    const allAgents = agents();
    return spaces().map((space) => {
      const folder = this.spaceFolder(space, allPanes);
      const gitKey = `${space.machine ?? "local"}::${folder}`;
      const git = this.gitMap[gitKey] ?? null;
      const tabSet = new Set((space.tabs ?? []).map((tab) => tab.id));
      const spacePanes = allPanes.filter((p) => tabSet.has(p.tab));
      const spaceAgents = allAgents.filter((a) => a.space === space.id);
      const activeTab = space.tabs.find((tab) => tab.active) ?? space.tabs[0] ?? null;
      const leadPane = spacePanes.find((p) => p.focused && p.terminal)
        ?? spacePanes.find((p) => p.program?.agent && p.terminal)
        ?? spacePanes.find((p) => p.terminal)
        ?? null;
      const uniquePrograms = [];
      const seenProg = new Set();
      for (const p of spacePanes) {
        if (!p.program) continue;
        if (seenProg.has(p.program.key)) continue;
        seenProg.add(p.program.key);
        uniquePrograms.push(p.program);
      }
      const blockedCount = spaceAgents.filter((a) => a.status === "blocked").length;
      const doneCount = spaceAgents.filter((a) => a.status === "done").length;
      const workingCount = spaceAgents.filter((a) => a.status === "working").length;
      const settledCount = space.tabs.filter((tab) => tab.settled).length;
      return {
        space,
        folder,
        git,
        activeTab,
        leadTerminal: leadPane?.terminal ?? null,
        programs: uniquePrograms,
        blockedCount,
        doneCount,
        workingCount,
        settledCount,
      };
    });
  }

  filteredCards() {
    const cards = this.buildCards();
    return cards.filter((c) => {
      if (this.scope === "attention" && c.blockedCount + c.doneCount === 0 && c.space.status !== "blocked" && c.space.status !== "done") return false;
      if (this.scope === "working" && c.workingCount === 0 && c.space.status !== "working") return false;
      if (this.scope === "local" && c.space.machine !== null) return false;
      if (this.scope.startsWith("machine:") && c.space.machine !== this.scope.slice(8)) return false;

      if (!this.filter) return true;
      const branch = c.git?.branch ?? c.space.branch ?? "";
      const progs = c.programs.map((p) => p.name).join(" ");
      const tabNames = c.space.tabs.map((tab) => tab.name).join(" ");
      const hay = [c.space.name, c.folder, c.space.machine ?? "local 本机", branch, progs, tabNames].join(" ").toLowerCase();
      return hay.includes(this.filter);
    });
  }

  onKeyDown(e, cx) {
    if (e.key === "escape") {
      this.close();
      cx.stop_propagation();
      return;
    }
    const cards = this.filteredCards();
    if (!cards.length) return;
    let next = this.selectedIndex;
    if (e.key === "right") next = Math.min(cards.length - 1, this.selectedIndex + 1);
    else if (e.key === "left") next = Math.max(0, this.selectedIndex - 1);
    else if (e.key === "down") next = Math.min(cards.length - 1, this.selectedIndex + this.cols);
    else if (e.key === "up") next = Math.max(0, this.selectedIndex - this.cols);
    else if (e.key === "enter") {
      this.switchToSpace(cards[this.selectedIndex].space.id);
      cx.stop_propagation();
      return;
    } else return;

    this.selectedIndex = next;
    this.scroll.scroll_to_item(Math.floor(next / this.cols));
    cx.stop_propagation();
    cx.notify();
  }

  createLocalSpace(cx) {
    cx.spawn(async () => {
      const picked = await pickFolder({ prompt: "打开项目文件夹" });
      if (picked) {
        this.close();
        run("space.new", { folder: picked });
      }
    });
  }

  renderCard(t, card, idx, selected) {
    const s = card.space;
    const color = spaceColor(t, s);
    const branch = card.git?.branch ?? s.branch ?? null;
    const dirty = card.git?.dirty ?? 0;
    const ahead = card.git?.ahead ?? 0;
    const behind = card.git?.behind ?? 0;
    const shortFolder = shortenPath(card.folder) || "默认目录";
    const urgentTone = card.blockedCount > 0 ? t.blocked : card.doneCount > 0 ? t.done : card.workingCount > 0 ? t.working : null;
    const urgentText = card.blockedCount > 0
      ? `${card.blockedCount} 待拍板`
      : card.doneCount > 0
        ? `${card.doneCount} 已完工`
        : card.workingCount > 0
          ? `${card.workingCount} 运行中`
          : null;

    return v_flex()
      .id(`proj-card-${s.id}`)
      .flex_1()
      .min_w(0)
      .p(12)
      .gap(8)
      .rounded(10)
      .bg(selected ? t.raised : t.surface)
      .border_1()
      .border_color(selected ? t.accent : s.active ? alphaColor(color, "88") : t.border)
      .cursor_pointer()
      .hover((st) => st.bg(t.raised).border_color(t.input))
      .on_click(() => this.switchToSpace(s.id))
      .child(
        h_flex()
          .gap(8)
          .items_center()
          .child(div().w(4).h(18).rounded(2).flex_none().bg(color))
          .child(div().flex_1().min_w(0).truncate().text_size(13.5).font_semibold().text_color(t.foreground).child(s.name))
          .when(s.active, (el) =>
            el.child(div().px(6).py(2).rounded(5).bg(alphaColor(t.accent, "22")).text_size(10.5).font_medium().text_color(t.accent).child("当前")),
          )
          .child(
            div()
              .px(6)
              .py(2)
              .rounded(5)
              .bg(t.chrome)
              .border_1()
              .border_color(t.border)
              .text_size(10.5)
              .text_color(s.machine ? t.accent : t.dim)
              .child(s.machine ?? "本机"),
          ),
      )
      .child(div().truncate().text_size(11.5).text_color(t.dim).child(shortFolder))
      .child(
        h_flex()
          .gap(6)
          .items_center()
          .min_h(20)
          .when(Boolean(branch), (el) =>
            el.child(
              h_flex()
                .px(6)
                .py(2)
                .gap(4)
                .rounded(5)
                .bg(t.chrome)
                .border_1()
                .border_color(t.border)
                .items_center()
                .child(flowIcon("diff", 11, t.muted))
                .child(div().max_w(120).truncate().text_size(11).text_color(t.muted).child(branch)),
            ),
          )
          .when(dirty > 0, (el) =>
            el.child(div().px(6).py(2).rounded(5).bg(alphaColor(t.blocked, "20")).text_size(11).text_color(t.blocked).child(`~${dirty} 改动`)),
          )
          .when(ahead > 0 || behind > 0, (el) =>
            el.child(div().text_size(11).text_color(t.dim).child(`${ahead > 0 ? `↑${ahead}` : ""}${behind > 0 ? ` ↓${behind}` : ""}`.trim())),
          )
          .when(Boolean(urgentText), (el) =>
            el.child(
              h_flex()
                .px(6)
                .py(2)
                .gap(4)
                .rounded(5)
                .bg(alphaColor(urgentTone, "22"))
                .items_center()
                .child(div().size(6).rounded_full().bg(urgentTone))
                .child(div().text_size(11).font_medium().text_color(urgentTone).child(urgentText)),
            ),
          ),
      )
      .child(
        h_flex()
          .gap(6)
          .items_center()
          .justify_between()
          .pt(4)
          .border_t(1)
          .border_color(alphaColor(t.border, "88"))
          .child(
            h_flex()
              .flex_1()
              .min_w(0)
              .gap(6)
              .items_center()
              .children(
                card.programs.slice(0, 4).map((prog) => {
                  const pic = programIcon(prog, 13, t.muted);
                  return pic ?? div().text_size(11).text_color(t.dim).child(prog.name);
                }),
              )
              .child(
                div()
                  .truncate()
                  .text_size(11.5)
                  .text_color(t.dim)
                  .child(`${s.tabs.length} 标签${card.settledCount > 0 ? ` (${card.settledCount}收纳)` : ""}`),
              ),
          )
          .child(
            h_flex()
              .gap(5)
              .flex_none()
              .when(Boolean(card.leadTerminal), (el) =>
                el.child(
                  h_flex()
                    .id(`proj-peek-${s.id}`)
                    .px(7)
                    .h(22)
                    .gap(4)
                    .items_center()
                    .rounded(5)
                    .bg(t.chrome)
                    .border_1()
                    .border_color(t.border)
                    .text_size(11)
                    .text_color(t.muted)
                    .hover((st) => st.bg(t.hover).text_color(t.foreground))
                    .on_click((_e, cx) => {
                      cx.stop_propagation();
                      this.peekSpace(card);
                    })
                    .child(flowIcon("eye", 11, t.muted))
                    .child("速览"),
                ),
              )
              .child(
                div()
                  .id(`proj-tab-${s.id}`)
                  .px(7)
                  .h(22)
                  .flex()
                  .items_center()
                  .rounded(5)
                  .bg(t.chrome)
                  .border_1()
                  .border_color(t.border)
                  .text_size(11)
                  .text_color(t.muted)
                  .hover((st) => st.bg(t.hover).text_color(t.foreground))
                  .on_click((_e, cx) => {
                    cx.stop_propagation();
                    this.close();
                    run("tab.new", { space: s.id, focus: true });
                  })
                  .child("+标签"),
              ),
          ),
      );
  }

  render() {
    const t = theme();
    const cards = this.filteredCards();
    this.selectedIndex = Math.max(0, Math.min(this.selectedIndex, Math.max(0, cards.length - 1)));
    const allCards = this.buildCards();
    const attentionTotal = allCards.filter((c) => c.blockedCount + c.doneCount > 0).length;
    const workingTotal = allCards.filter((c) => c.workingCount > 0).length;

    const filterChip = (id, label) => {
      const on = this.scope === id;
      return div()
        .id(`proj-scope-${id}`)
        .px(9)
        .h(25)
        .rounded(999)
        .flex()
        .items_center()
        .cursor_pointer()
        .text_size(11.8)
        .bg(on ? alphaColor(t.accent, "24") : t.surface)
        .border_1()
        .border_color(on ? t.accent : t.border)
        .text_color(on ? t.accent : t.muted)
        .hover((s) => s.bg(t.raised).text_color(t.foreground))
        .on_click((_e, cx) => {
          this.scope = id;
          this.selectedIndex = 0;
          cx.notify();
        })
        .child(label);
    };

    const machineList = [...new Set([...this.remoteHosts, ...machines().map((m) => m.name).filter(Boolean)])];

    // 将卡片切分成等列宽网格行
    const rows = [];
    for (let i = 0; i < cards.length; i += this.cols) {
      const slice = cards.slice(i, i + this.cols);
      const rowChildren = slice.map((c, offset) => this.renderCard(t, c, i + offset, i + offset === this.selectedIndex));
      while (rowChildren.length < this.cols) rowChildren.push(div().flex_1().min_w(0));
      rows.push(h_flex().w_full().gap(10).children(rowChildren));
    }

    return v_flex()
      .id("flow-projects-root")
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.onKeyDown(e, cx))
      .on_size_change((size, cx) => {
        const nextCols = size.width >= 960 ? 3 : 2;
        if (nextCols !== this.cols) {
          this.cols = nextCols;
          cx.notify();
        }
      })
      .size_full()
      .min_h(0)
      .p(18)
      .gap(12)
      .bg(t.popover)
      .text_color(t.foreground)
      .child(
        h_flex()
          .items_center()
          .justify_between()
          .gap(10)
          .child(
            h_flex()
              .gap(8)
              .items_center()
              .child(flowIcon("grid", 16, t.accent))
              .child(div().text_size(15.5).font_semibold().child("项目全景"))
              .child(div().text_size(12).text_color(t.dim).child(`共 ${allCards.length} 个 Space · ↑↓←→ 导航 · Enter 切换`)),
          )
          .child(
            h_flex()
              .gap(8)
              .items_center()
              .child(actionPill(t, "proj-new-local", "+ 打开文件夹", false, (_e, cx) => this.createLocalSpace(cx)))
              .when(machineList.length > 0, (el) =>
                el.child(
                  actionPill(t, "proj-new-remote", "+ 远端项目", false, () => {
                    this.close();
                    run("space.new", { machine: machineList[0] });
                  }),
                ),
              )
              .child(
                div()
                  .id("proj-esc")
                  .px(7)
                  .py(4)
                  .rounded(6)
                  .text_size(11.5)
                  .text_color(t.dim)
                  .cursor_pointer()
                  .hover((s) => s.bg(t.hover).text_color(t.foreground))
                  .on_click(() => this.close())
                  .child("Esc"),
              ),
          ),
      )
      .child(
        h_flex()
          .h(36)
          .px(10)
          .gap(8)
          .items_center()
          .rounded(8)
          .bg(t.background)
          .border_1()
          .border_color(t.input)
          .child(flowIcon("search", 14, t.dim))
          .child(Input.new(this.input).flex_1().text_size(13).text_color(t.foreground)),
      )
      .child(
        h_flex()
          .gap(6)
          .flex_wrap()
          .items_center()
          .child(filterChip("all", `全部 (${allCards.length})`))
          .child(filterChip("attention", `待处理 (${attentionTotal})`))
          .child(filterChip("working", `运行中 (${workingTotal})`))
          .child(filterChip("local", "本机"))
          .children(machineList.map((m) => filterChip(`machine:${m}`, `@${m}`))),
      )
      .child(
        rows.length > 0
          ? v_flex()
              .flex_1()
              .min_h(0)
              .overflow_y_scrollbar()
              .track_scroll(this.scroll)
              .gap(10)
              .pr(4)
              .children(rows)
          : v_flex()
              .flex_1()
              .items_center()
              .justify_center()
              .gap(8)
              .child(div().text_size(13.5).text_color(t.muted).child("没有匹配的项目 Space"))
              .child(div().text_size(12).text_color(t.dim).child("试试清空筛选条件，或点击右上角新建项目")),
      );
  }
}
