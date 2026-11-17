// Agent 三级收纳系统：
// 1. AgentsStowView（role: "agents"）：按「待你处理 / 后台运行中 / 已闲置归档」三级分流，支持终端末行摘要预览与一键收纳闲置标签；
// 2. TriageBarView（role: "triage-bar"）：悬浮速览批阅窗顶栏，支持 ◀ 1/N ▶ 连续快批而不切走底层主桌面；
// 3. SettledTabsView（role: "settled"）：顶栏收纳的后台标签列表。

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import {
  agents,
  terminals,
  panes,
  spaces,
  run,
  hc,
  theme,
  props,
  closeOverlay,
  nextCommand,
  checking,
  setAgentOrder,
} from "herdr";
import { readStore, clearShieldedToasts, formatClock } from "./store.js";
import {
  ownPress,
  alphaColor,
  cleanTitle,
  flowIcon,
  programIcon,
  statusColor,
  statusLabel,
  buildAgentGroups,
  openTriageWindow,
  actionPill,
} from "./ui.js";

function extractLastLine(text) {
  const lines = (text ?? "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return lines.length ? lines[lines.length - 1] : "";
}

function isExeOrPath(raw) {
  return /^[~/]|^[A-Za-z]:\\/.test((raw ?? "").replace(/^[^\p{L}\p{N}~/]+/u, ""));
}

function agentDisplayName(agent, tabMap) {
  const tab = tabMap.get(agent.tab);
  if (tab?.named) return tab.name;
  const live = cleanTitle(agent.title);
  const prog = agent.program?.name;
  const telling = live
    && live !== agent.address
    && live !== prog
    && !isExeOrPath(agent.title)
    && !live.includes("@")
    && live.toLowerCase() !== agent.program?.key;
  return telling ? live : (prog || agent.tab_name || agent.address);
}

export class AgentsStowView extends View {
  init(_props, cx) {
    this.showIdle = false;
    this.expandedSubs = new Set();
    this.snippets = {};
    this.fetching = new Set();
    this.handle = cx.focus_handle();

    if (checking()) return;
    this.fetchSnippets(cx);
  }

  close() {
    const ov = props()?.overlay;
    if (ov) closeOverlay(ov);
  }

  fetchSnippets(cx) {
    const groups = buildAgentGroups(agents(), terminals());
    const targets = groups.needsYou.filter((a) => {
      const key = `${a.address}::${a.seq ?? 0}`;
      return !(key in this.snippets) && !this.fetching.has(key);
    });
    if (!targets.length) return;

    for (const a of targets) this.fetching.add(`${a.address}::${a.seq ?? 0}`);
    cx.spawn(async (cx) => {
      await Promise.all(
        targets.slice(0, 8).map(async (a) => {
          const key = `${a.address}::${a.seq ?? 0}`;
          try {
            const res = await hc(["read", a.address, "--lines", "10"]);
            this.snippets[a.address] = res.code === 0 ? extractLastLine(res.stdout) : "";
            this.snippets[key] = this.snippets[a.address];
          } catch {
            this.snippets[key] = "";
          } finally {
            this.fetching.delete(key);
          }
        }),
      );
      cx.notify();
    });
  }

  settleIdleTabsInSpace() {
    const activeSpace = spaces().find((s) => s.active);
    if (!activeSpace) return;
    for (const tab of activeSpace.tabs) {
      if (!tab.active && !tab.settled && tab.status !== "blocked" && tab.status !== "working") {
        run("tab.settle", { id: tab.id });
      }
    }
  }

  renderSubRow(t, sub) {
    const k = sub.terminal;
    const pic = programIcon(k.program, 12, t.muted);
    const st = k.status === "error" ? "blocked" : k.status === "done" ? "idle" : k.status;
    return h_flex()
      .id(`stow-sub-${k.address}`)
      .h(26)
      .pl(22 + (sub.depth - 1) * 10)
      .pr(8)
      .gap(6)
      .items_center()
      .rounded(6)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click(() => {
        this.close();
        openTriageWindow(k.address);
      })
      .child(div().size(5).rounded_full().flex_none().bg(statusColor(t, st)))
      .when(Boolean(pic), (el) => el.child(pic))
      .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.muted).child(k.name || k.template || k.program?.name || k.address))
      .child(div().text_size(10.5).text_color(statusColor(t, st)).child(statusLabel(st)));
  }

  render() {
    const t = theme();
    const store = readStore();
    const allAgents = agents();
    const allTerms = terminals();
    const groups = buildAgentGroups(allAgents, allTerms);
    setAgentOrder(groups.sorted.map((a) => a.address));

    const tabMap = new Map(spaces().flatMap((s) => s.tabs).map((tab) => [tab.id, tab]));
    const activeSpace = spaces().find((s) => s.active);
    const settleableCount = activeSpace
      ? activeSpace.tabs.filter((tab) => !tab.active && !tab.settled && tab.status !== "blocked" && tab.status !== "working").length
      : 0;

    const renderNeedsCard = (a) => {
      const pic = programIcon(a.program, 14, t.foreground);
      const tone = statusColor(t, a.status);
      const snippet = this.snippets[a.address] ?? "";
      const name = agentDisplayName(a, tabMap);
      return v_flex()
        .id(`stow-need-${a.address}`)
        .p(10)
        .gap(5)
        .rounded(9)
        .bg(t.surface)
        .border_1()
        .border_color(a.status === "blocked" ? alphaColor(t.blocked, "66") : t.border)
        .cursor_pointer()
        .hover((s) => s.bg(t.raised).border_color(t.input))
        .on_click(() => {
          this.close();
          openTriageWindow(a.address);
        })
        .child(
          h_flex()
            .gap(7)
            .items_center()
            .child(div().size(7).rounded_full().flex_none().bg(tone))
            .when(Boolean(pic), (el) => el.child(pic))
            .child(div().text_size(12).font_semibold().text_color(t.muted).child(a.space_name || "项目"))
            .child(div().text_size(11.5).text_color(t.dim).child("·"))
            .child(div().flex_1().min_w(0).truncate().text_size(12.5).font_semibold().text_color(t.foreground).child(name))
            .child(div().px(6).py(2).rounded(5).bg(alphaColor(tone, "22")).text_size(10.5).font_semibold().text_color(tone).child(statusLabel(a.status)))
            .child(
              div()
                .id(`stow-jump-${a.address}`)
                .p(3)
                .rounded(5)
                .tooltip("切换到该工作区")
                .hover((s) => s.bg(t.hover))
                .on_click((_e, cx) => {
                  cx.stop_propagation();
                  this.close();
                  run("pane.focus", { pane: a.pane });
                })
                .child(flowIcon("external", 12, t.dim)),
            ),
        )
        .when(Boolean(snippet), (el) =>
          el.child(div().pl(14).truncate().text_size(11.5).text_color(t.dim).child(snippet)),
        );
    };

    const renderCompactRow = (a, showSettle) => {
      const pic = programIcon(a.program, 13, t.muted);
      const kids = groups.collectKids(a.address, 1);
      const expanded = this.expandedSubs.has(a.address);
      const tab = tabMap.get(a.tab);
      const canSettle = showSettle && tab && !tab.active && !tab.settled;
      return v_flex()
        .gap(2)
        .child(
          h_flex()
            .id(`stow-row-${a.address}`)
            .h(30)
            .px(8)
            .gap(7)
            .items_center()
            .rounded(7)
            .cursor_pointer()
            .hover((s) => s.bg(t.hover))
            .on_click(() => {
              this.close();
              openTriageWindow(a.address);
            })
            .child(div().size(6).rounded_full().flex_none().bg(statusColor(t, a.status)))
            .when(Boolean(pic), (el) => el.child(pic))
            .child(div().text_size(11.8).text_color(t.dim).child(a.space_name || ""))
            .child(div().flex_1().min_w(0).truncate().text_size(12.2).text_color(t.foreground).child(agentDisplayName(a, tabMap)))
            .when(kids.length > 0, (el) =>
              el.child(
                div()
                  .id(`stow-kids-${a.address}`)
                  .px(6)
                  .py(1)
                  .rounded(5)
                  .bg(t.surface)
                  .border_1()
                  .border_color(t.border)
                  .text_size(10.5)
                  .text_color(t.muted)
                  .hover((s) => s.bg(t.raised))
                  .on_click((_e, cx) => {
                    cx.stop_propagation();
                    if (expanded) this.expandedSubs.delete(a.address);
                    else this.expandedSubs.add(a.address);
                    cx.notify();
                  })
                  .child(`+${kids.length} 子任务`),
              ),
            )
            .when(canSettle, (el) =>
              el.child(
                div()
                  .id(`stow-tab-settle-${a.address}`)
                  .px(6)
                  .py(2)
                  .rounded(5)
                  .text_size(10.5)
                  .text_color(t.dim)
                  .hover((s) => s.bg(t.raised).text_color(t.foreground))
                  .on_click((_e, cx) => {
                    cx.stop_propagation();
                    run("tab.settle", { id: tab.id });
                  })
                  .child("收纳"),
              ),
            ),
        )
        .when(expanded && kids.length > 0, (el) => el.children(kids.map((sub) => this.renderSubRow(t, sub))));
    };

    return v_flex()
      .id("flow-agents-root")
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape") {
          this.close();
          cx.stop_propagation();
        }
      })
      .size_full()
      .min_h(0)
      .p(16)
      .gap(12)
      .bg(t.popover)
      .text_color(t.foreground)
      .child(
        h_flex()
          .items_center()
          .justify_between()
          .gap(8)
          .child(
            h_flex()
              .gap(8)
              .items_center()
              .child(flowIcon("inbox", 16, t.accent))
              .child(div().text_size(15).font_semibold().child("Agent 三级收纳"))
              .child(div().text_size(11.5).text_color(t.dim).child("点卡片浮窗快批，不打断当前桌面")),
          )
          .child(
            h_flex()
              .gap(6)
              .when(settleableCount > 0, (el) =>
                el.child(actionPill(t, "stow-settle-idle", `收纳闲置 (${settleableCount})`, false, () => this.settleIdleTabsInSpace())),
              )
              .when(groups.needsYou.length > 0, (el) =>
                el.child(
                  actionPill(t, "stow-batch-triage", `连批待办 (${groups.needsYou.length}) ▶`, true, () => {
                    this.close();
                    openTriageWindow(groups.needsYou[0].address);
                  }),
                ),
              )
              .child(
                div()
                  .id("stow-esc")
                  .px(6)
                  .py(3)
                  .rounded(5)
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
        v_flex()
          .flex_1()
          .min_h(0)
          .overflow_y_scrollbar()
          .gap(12)
          .pr(4)
          .when(store.shieldedToasts.length > 0, (el) =>
            el.child(
              v_flex()
                .p(10)
                .gap(6)
                .rounded(9)
                .bg(alphaColor(t.accent, "12"))
                .border_1()
                .border_color(alphaColor(t.accent, "38"))
                .child(
                  h_flex()
                    .justify_between()
                    .items_center()
                    .child(div().text_size(11.5).font_semibold().text_color(t.accent).child(`🛡 专注护盾已拦截 (${store.shieldedToasts.length})`))
                    .child(
                      div()
                        .id("stow-clear-shield")
                        .px(6)
                        .py(2)
                        .rounded(4)
                        .text_size(11)
                        .text_color(t.dim)
                        .cursor_pointer()
                        .hover((s) => s.bg(t.hover).text_color(t.foreground))
                        .on_click(() => clearShieldedToasts())
                        .child("清空"),
                    ),
                )
                .children(
                  store.shieldedToasts.slice(0, 6).map((item) =>
                    h_flex()
                      .id(`shield-item-${item.id}`)
                      .px(6)
                      .py(4)
                      .gap(8)
                      .rounded(6)
                      .items_center()
                      .cursor_pointer()
                      .hover((s) => s.bg(t.hover))
                      .on_click(() => {
                        if (item.action?.name) {
                          this.close();
                          run(item.action.name, item.action.args ?? {});
                        }
                      })
                      .child(div().text_size(10.5).text_color(t.dim).child(formatClock(item.at)))
                      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.foreground).child(item.title))
                      .when(Boolean(item.body), (b) => b.child(div().max_w(160).truncate().text_size(11).text_color(t.dim).child(item.body))),
                  ),
                ),
            ),
          )
          .child(
            v_flex()
              .gap(6)
              .child(div().text_size(11.5).font_semibold().text_color(t.muted).child(`① 待你处理 (${groups.needsYou.length})`))
              .when(groups.needsYou.length === 0, (el) =>
                el.child(
                  div()
                    .p(12)
                    .rounded(8)
                    .bg(t.surface)
                    .border_1()
                    .border_color(t.border)
                    .text_size(12)
                    .text_color(t.dim)
                    .child("此刻没有卡住或刚完工等待确认的 Agent，放心继续心流工作。"),
                ),
              )
              .children(groups.needsYou.map(renderNeedsCard)),
          )
          .when(groups.working.length > 0, (el) =>
            el.child(
              v_flex()
                .gap(4)
                .child(div().text_size(11.5).font_semibold().text_color(t.muted).child(`② 后台运行中 (${groups.working.length})`))
                .children(groups.working.map((a) => renderCompactRow(a, false))),
            ),
          )
          .when(groups.idle.length > 0, (el) =>
            el.child(
              v_flex()
                .gap(4)
                .child(
                  h_flex()
                    .id("stow-idle-toggle")
                    .h(26)
                    .px(6)
                    .gap(6)
                    .items_center()
                    .rounded(6)
                    .cursor_pointer()
                    .hover((s) => s.bg(t.hover))
                    .on_click((_e, cx) => {
                      this.showIdle = !this.showIdle;
                      cx.notify();
                    })
                    .child(flowIcon(this.showIdle ? "chevron-down" : "chevron-right", 12, t.dim))
                    .child(div().text_size(11.5).font_semibold().text_color(t.dim).child(`③ 已阅与闲置归档 (${groups.idle.length})`)),
                )
                .when(this.showIdle, (subEl) => subEl.children(groups.idle.map((a) => renderCompactRow(a, true)))),
            ),
          ),
      );
  }
}

export class TriageBarView extends View {
  init(_props, cx) {
    if (checking()) return;
    cx.spawn(async () => {
      for (;;) {
        const cmd = await nextCommand();
        if (cmd === "close_windows" && props()?.overlay) closeOverlay(props().overlay);
      }
    });
  }

  render() {
    const t = theme();
    const p = props() ?? {};
    const addr = p.terminal;
    const allAgents = agents();
    const allTerms = terminals();
    const allPanes = panes();
    const groups = buildAgentGroups(allAgents, allTerms);
    const queue = groups.sorted.map((a) => a.address);
    if (addr && !queue.includes(addr)) queue.unshift(addr);

    const idx = Math.max(0, queue.indexOf(addr));
    const prevAddr = queue.length > 1 ? queue[(idx - 1 + queue.length) % queue.length] : null;
    const nextAddr = queue.length > 1 ? queue[(idx + 1) % queue.length] : null;
    const agent = allAgents.find((a) => a.address === addr) ?? null;
    const term = allTerms.find((x) => x.address === addr) ?? null;
    const hasPane = allPanes.some((pn) => pn.terminal === addr);
    const st = agent?.status ?? term?.status ?? null;
    const pic = programIcon(agent?.program ?? term?.program, 14, t.foreground);
    const tabMap = new Map(spaces().flatMap((s) => s.tabs).map((tab) => [tab.id, tab]));
    const title = agent
      ? agentDisplayName(agent, tabMap)
      : (term?.name || term?.template || (!isExeOrPath(term?.title) ? cleanTitle(term?.title) : "") || term?.program?.name || addr || "");

    const navBtn = (id, label, target) => ownPress(
      div()
        .id(id)
        .h(24)
        .px(8)
        .rounded(6)
        .flex()
        .items_center()
        .bg(t.surface)
        .border_1()
        .border_color(t.border)
        .text_size(11.5)
        .text_color(target ? t.foreground : t.dim)
        .when(Boolean(target), (el) => el.cursor_pointer().hover((s) => s.bg(t.raised)).on_click(() => openTriageWindow(target)))
        .child(label),
    );

    return h_flex()
      .size_full()
      .px(12)
      .gap(8)
      .items_center()
      .bg(t.chrome)
      .border_b(1)
      .border_color(t.border)
      .child(div().size(7).rounded_full().flex_none().bg(statusColor(t, st)))
      .when(Boolean(pic), (el) => el.child(pic))
      .when(Boolean(agent?.space_name), (el) =>
        el.child(div().text_size(12).font_semibold().text_color(t.muted).child(agent.space_name)),
      )
      .child(div().flex_1().min_w(0).truncate().text_size(12.5).font_semibold().text_color(t.foreground).child(title))
      .when(Boolean(st), (el) =>
        el.child(div().px(6).py(2).rounded(5).bg(alphaColor(statusColor(t, st), "22")).text_size(10.5).text_color(statusColor(t, st)).child(statusLabel(st))),
      )
      .when(queue.length > 0, (el) =>
        el.child(div().text_size(11.5).text_color(t.dim).child(`${idx + 1} / ${queue.length}`)),
      )
      .child(navBtn("triage-prev", "◀ 上一个", prevAddr))
      .child(navBtn("triage-next", "下一个 ▶", nextAddr))
      .when(Boolean(agent?.tab), (el) =>
        el.child(
          ownPress(
            div()
              .id("triage-settle")
              .h(24)
              .px(8)
              .rounded(6)
              .flex()
              .items_center()
              .bg(t.surface)
              .border_1()
              .border_color(t.border)
              .text_size(11.5)
              .text_color(t.muted)
              .cursor_pointer()
              .hover((s) => s.bg(t.raised).text_color(t.foreground))
              .on_click(() => {
                run("tab.settle", { id: agent.tab });
                if (nextAddr && nextAddr !== addr) openTriageWindow(nextAddr);
                else if (p.overlay) closeOverlay(p.overlay);
              })
              .child("收纳后台"),
          ),
        ),
      )
      .child(
        ownPress(
          div()
            .id("triage-go")
            .h(24)
            .px(8)
            .rounded(6)
            .flex()
            .items_center()
            .bg(t.raised)
            .border_1()
            .border_color(t.input)
            .text_size(11.5)
            .text_color(t.foreground)
            .cursor_pointer()
            .hover((s) => s.bg(t.selected))
            .on_click(() => {
              run(hasPane ? "pane.focus" : "terminal.keep", { terminal: addr });
              if (p.overlay) closeOverlay(p.overlay);
            })
            .child(hasPane ? "↗ 切去工作区" : "↗ 固定为标签"),
        ),
      )
      .child(
        ownPress(
          div()
            .id("triage-close")
            .size(24)
            .rounded(6)
            .flex()
            .items_center()
            .justify_center()
            .cursor_pointer()
            .hover((s) => s.bg(t.hover))
            .on_click(() => {
              if (p.overlay) closeOverlay(p.overlay);
            })
            .child(flowIcon("close", 13, t.muted)),
        ),
      );
  }
}

export class SettledTabsView extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
  }

  render() {
    const t = theme();
    const p = props() ?? {};
    const activeSpace = spaces().find((s) => s.active);
    const settled = (activeSpace?.tabs ?? []).filter((tab) => tab.settled);

    return v_flex()
      .id("flow-settled-root")
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape" && p.overlay) {
          closeOverlay(p.overlay);
          cx.stop_propagation();
        }
      })
      .w_full()
      .p(10)
      .gap(6)
      .bg(t.popover)
      .text_color(t.foreground)
      .child(
        h_flex()
          .items_center()
          .justify_between()
          .px(4)
          .pb(4)
          .child(div().text_size(12.5).font_semibold().child(`已收纳的后台标签 (${settled.length})`))
          .when(settled.length > 0, (el) =>
            el.child(
              div()
                .id("settled-restore-all")
                .px(6)
                .py(2)
                .rounded(5)
                .text_size(11)
                .text_color(t.accent)
                .cursor_pointer()
                .hover((s) => s.bg(t.hover))
                .on_click(() => {
                  for (const tab of settled) run("tab.unsettle", { id: tab.id });
                  if (p.overlay) closeOverlay(p.overlay);
                })
                .child("全部恢复"),
            ),
          ),
      )
      .children(
        settled.map((tab) =>
          h_flex()
            .id(`settled-item-${tab.id}`)
            .h(30)
            .px(8)
            .gap(8)
            .items_center()
            .rounded(7)
            .cursor_pointer()
            .hover((s) => s.bg(t.hover))
            .on_click(() => {
              run("tab.select", { id: tab.id });
              if (p.overlay) closeOverlay(p.overlay);
            })
            .child(div().size(6).rounded_full().bg(statusColor(t, tab.status)))
            .child(div().flex_1().min_w(0).truncate().text_size(12.2).child(tab.name))
            .when(Boolean(tab.status), (el) =>
              el.child(div().text_size(11).text_color(statusColor(t, tab.status)).child(statusLabel(tab.status))),
            ),
        ),
      );
  }
}
