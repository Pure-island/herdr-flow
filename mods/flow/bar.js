// Flow 顶栏（role: "bar"）：融合无数字环境光条、项目全景入口、收敛标签栏、心流锚点与 Agent 收纳胶囊。

import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex, ScrollHandle } from "gpui-base";
import {
  spaces,
  panes,
  agents,
  terminals,
  run,
  theme,
  layout,
  settings,
  openOverlay,
  nextCommand,
  checking,
  setAgentOrder,
  setWindowTitle,
  window as herdrWin,
} from "herdr";
import {
  readStore,
  timerMetrics,
  currentFocusLabel,
  isShieldActive,
  startTimer,
  pauseTimer,
  finishSession,
  checkOvertimeChime,
} from "./store.js";
import {
  ownPress,
  alphaColor,
  findLayoutNode,
  spaceColor,
  cleanTitle,
  flowIcon,
  buildAgentGroups,
  openTriageWindow,
  openProjectsModal,
  openAgentsModal,
  openCaptureModal,
  openNotesWindow,
} from "./ui.js";

function tabLabel(tab, lead) {
  const prog = lead?.program?.name;
  const fallback = tab.named ? tab.name : (prog ?? "Terminal");
  if (!lead?.program?.agent) return fallback;
  const live = cleanTitle(lead.title);
  const isPath = /^[~/]|^[A-Za-z]:\\/.test((lead.title ?? "").replace(/^[^\p{L}\p{N}~/]+/u, ""));
  const telling = live
    && live !== lead.terminal
    && live !== prog
    && !isPath
    && !live.includes("@")
    && live.toLowerCase() !== lead.program.key;
  return (tab.name === prog || !tab.named) && telling ? live : fallback;
}

export default class FlowBar extends View {
  init(_props, cx) {
    this.pressedTab = null;
    this.scroll = ScrollHandle.new();
    this.selectedTabId = null;
    this.selectedTabIndex = -1;
    this.lastWindowTitle = null;
    this.swipe = { acc: 0, steps: 0, at: 0, last: 0 };

    if (checking()) return;

    // 低频 5 秒刷新：更新无数字分钟进度条并检测是否跨入超流阶段
    cx.timer.every(5000, (cx) => {
      checkOvertimeChime(Date.now());
      cx.notify();
    });

    cx.spawn(async (cx) => {
      for (;;) {
        const cmd = await nextCommand();
        this.handleCommand(cmd);
        cx.notify();
      }
    });
  }

  handleCommand(cmd) {
    if (cmd === "projects") openProjectsModal();
    else if (cmd === "agents") openAgentsModal();
    else if (cmd === "capture") openCaptureModal();
    else if (cmd === "notes") openNotesWindow();
    else if (cmd === "triage") {
      const groups = buildAgentGroups(agents(), terminals());
      const first = groups.needsYou[0] ?? groups.sorted[0];
      if (first) openTriageWindow(first.address);
      else openAgentsModal();
    } else if (cmd === "toggle_focus") {
      const store = readStore();
      const now = Date.now();
      if (store.timer.status === "running") pauseTimer(now);
      else startTimer(store.timer.mode, store.timer.targetMinutes, now);
    }
  }

  onWheel(e) {
    if (e.delta_lines) {
      if (e.delta_lines.y) run(e.delta_lines.y > 0 ? "tab.prev" : "tab.next");
      return;
    }
    const s = this.swipe;
    const now = Date.now();
    if (e.touch_phase === "started" || now - s.at > 250 || e.delta.y * s.acc < 0) {
      s.acc = 0;
      s.steps = 0;
    }
    s.at = now;
    s.acc += e.delta.y;
    const need = s.steps ? 60 : 20;
    if (Math.abs(s.acc) < need || now - s.last < 100) return;
    s.acc -= Math.sign(s.acc) * need;
    s.steps += 1;
    s.last = now;
    run(e.delta.y > 0 ? "tab.prev" : "tab.next");
  }

  syncWindowTitle(space, store, metrics) {
    if (checking()) return;
    const label = currentFocusLabel(store);
    const spaceName = space ? space.name : "Herdr";
    let title = `Herdr · ${spaceName}`;
    if (store.timer.status === "running") {
      const stateWord = metrics.isOvertime ? `超流 +${metrics.overtimeMin}m` : "专注中";
      title = label ? `${stateWord} · ${label} — ${spaceName}` : `${stateWord} — ${spaceName}`;
    } else if (label) {
      title = `${label} — ${spaceName}`;
    }
    if (title !== this.lastWindowTitle) {
      this.lastWindowTitle = title;
      setWindowTitle(title);
    }
  }

  iconBtn(t, id, iconName, tip, active, onClick) {
    return ownPress(
      div()
        .id(id)
        .size(26)
        .flex_none()
        .rounded(6)
        .flex()
        .items_center()
        .justify_center()
        .cursor_pointer()
        .bg(active ? t.selected : t.chrome)
        .text_color(active ? t.foreground : t.dim)
        .tooltip(tip)
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click(onClick)
        .child(flowIcon(iconName, 14, active ? t.accent : t.muted)),
    );
  }

  render() {
    const t = theme();
    const now = Date.now();
    const store = readStore();
    const metrics = timerMetrics(store.timer, now);
    const allSpaces = spaces();
    const activeSpace = allSpaces.find((s) => s.active) ?? allSpaces[0] ?? null;
    const allPanes = panes();
    const allTabs = activeSpace?.tabs ?? [];
    const settledTabs = allTabs.filter((tab) => tab.settled && !tab.active && tab.status !== "blocked");
    const visibleTabs = allTabs.filter((tab) => !tab.settled || tab.active || tab.status === "blocked");
    const activeTabIndex = visibleTabs.findIndex((tab) => tab.active);
    const activeTabId = visibleTabs[activeTabIndex]?.id ?? null;

    if (activeTabId !== this.selectedTabId || activeTabIndex !== this.selectedTabIndex) {
      this.selectedTabId = activeTabId;
      this.selectedTabIndex = activeTabIndex;
      if (activeTabIndex >= 0) this.scroll.scroll_to_item(activeTabIndex);
    }

    this.syncWindowTitle(activeSpace, store, metrics);

    const groups = buildAgentGroups(agents(), terminals());
    setAgentOrder(groups.sorted.map((a) => a.address));

    const blockedCount = groups.sorted.filter((a) => a.status === "blocked").length;
    const doneCount = groups.sorted.filter((a) => a.status === "done").length;
    const workingCount = groups.sorted.filter((a) => a.status === "working").length;
    const urgentCount = blockedCount + doneCount;
    const firstUrgent = groups.needsYou[0] ?? null;

    const root = layout();
    const w = herdrWin();
    const sidebarNode = findLayoutNode(root, "sidebar");
    const studioOpen = Boolean(sidebarNode && !sidebarNode.hidden);
    const panelNode = findLayoutNode(root, "panel");
    const bodyNode = findLayoutNode(root, "panel-body");
    const panelActive = panelNode && !panelNode.hidden ? bodyNode?.active ?? null : null;

    const lightsPadding = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights
      ? Math.max(10, (root.traffic_lights[0] + 68) / (settings().zoom || 1))
      : 10;

    // 顶部无数字环境光条：空闲时保持极淡基准线，超流期自动转为暖琥珀呼吸提示
    const trackBg = alphaColor(t.border, "55");
    let progressTrack = div().w_full().h(2).flex_none().bg(trackBg);
    if (store.timer.status !== "idle") {
      if (metrics.isOvertime) {
        progressTrack = div()
          .w_full()
          .h(2)
          .flex_none()
          .bg(trackBg)
          .child(div().id("flow-overtime-bar").w("100%").h_full().bg(t.blocked).loop("opacity", { from: 0.45, to: 1.0, period: 1800 }));
      } else if (store.timer.mode === "stopwatch") {
        progressTrack = div()
          .w_full()
          .h(2)
          .flex_none()
          .bg(trackBg)
          .child(div().id("flow-stopwatch-bar").w("100%").h_full().bg(t.accent).loop("opacity", { from: 0.35, to: 0.9, period: 2400 }));
      } else {
        const pct = Math.max(2, Math.min(100, Math.round(metrics.progressRatio * 100)));
        progressTrack = div()
          .w_full()
          .h(2)
          .flex_none()
          .bg(trackBg)
          .child(div().w(`${pct}%`).h_full().bg(t.accent));
      }
    }

    const spaceDotColor = activeSpace ? spaceColor(t, activeSpace) : t.dim;
    const spaceBtn = ownPress(
      h_flex()
        .id("flow-projects-btn")
        .h(27)
        .px(9)
        .gap(6)
        .flex_none()
        .items_center()
        .rounded(7)
        .bg(t.surface)
        .border_1()
        .border_color(t.border)
        .cursor_pointer()
        .tooltip("项目全景视图（Ctrl+Shift+G）")
        .hover((s) => s.bg(t.raised).border_color(t.input))
        .on_click(() => openProjectsModal())
        .child(div().size(7).rounded_full().flex_none().bg(spaceDotColor))
        .child(div().max_w(128).truncate().text_size(12.3).font_semibold().text_color(t.foreground).child(activeSpace ? activeSpace.name : "所有项目"))
        .when(Boolean(activeSpace?.machine), (el) =>
          el.child(div().px(4).py(1).rounded(4).bg(t.raised).text_size(10.5).text_color(t.dim).child(activeSpace.machine)),
        )
        .when(Boolean(activeSpace?.branch), (el) =>
          el.child(div().max_w(72).truncate().text_size(11).text_color(t.dim).child(activeSpace.branch)),
        )
        .child(flowIcon("grid", 12, t.dim)),
    );

    const renderTab = (tab, index) => {
      const lead = allPanes.find((p) => p.tab === tab.id && p.program?.agent) ?? allPanes.find((p) => p.tab === tab.id);
      const program = lead?.program;
      const name = tabLabel(tab, lead);
      const urgentDot = tab.status === "blocked" ? t.blocked : tab.status === "done" ? t.done : tab.status === "working" ? t.working : null;
      return h_flex()
        .id(`flow-tab-${tab.id}`)
        .h(27)
        .px(9)
        .gap(6)
        .rounded(7)
        .items_center()
        .flex_none()
        .text_size(12)
        .cursor_pointer()
        .border_1()
        .border_color(tab.active ? t.border : t.chrome)
        .bg(tab.active ? t.raised : t.chrome)
        .text_color(tab.active ? t.foreground : t.muted)
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_mouse_down("left", (e, cx) => {
          cx.stop_propagation();
          this.pressedTab = index;
          if (e.click_count === 2) run("tab.rename", { id: tab.id });
        })
        .on_mouse_up("left", () => {
          const from = this.pressedTab;
          this.pressedTab = null;
          if (from !== null && from !== index && activeSpace) {
            const targetIdx = activeSpace.tabs.findIndex((x) => x.id === tab.id);
            if (targetIdx >= 0) run("tab.move", { id: visibleTabs[from].id, index: targetIdx + 1 });
          } else {
            run("tab.select", { id: tab.id });
          }
        })
        .on_mouse_down("right", (_e, cx) => {
          cx.stop_propagation();
          if (activeSpace) {
            openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: tab.id, space: activeSpace.id } } });
          }
        })
        .when(Boolean(program?.icon), (el) =>
          el.child(program.tint ? svg(program.icon).size(13).flex_none().text_color(t.muted) : image(program.icon).w(13).h(13).flex_none()),
        )
        .child(div().max_w(140).truncate().child(tab.zoomed ? `${name} Z` : name))
        .when(Boolean(urgentDot), (el) => el.child(div().size(6).rounded_full().flex_none().bg(urgentDot)))
        .when(allTabs.length > 1 && tab.active, (el) =>
          el.child(
            ownPress(
              div()
                .id(`flow-settle-${tab.id}`)
                .p(2)
                .rounded(4)
                .text_color(t.dim)
                .tooltip("收纳到后台（继续运行）")
                .hover((s) => s.bg(t.hover).text_color(t.foreground))
                .on_click((_e, cx) => {
                  cx.stop_propagation();
                  run("tab.settle", { id: tab.id });
                })
                .child(flowIcon("settle", 11, t.dim)),
            ),
          ),
        )
        .when(tab.active, (el) =>
          el.child(
            ownPress(
              div()
                .id(`flow-close-${tab.id}`)
                .p(2)
                .rounded(4)
                .text_color(t.dim)
                .hover((s) => s.bg(t.hover).text_color(t.foreground))
                .on_click((_e, cx) => {
                  cx.stop_propagation();
                  run("tab.close", { id: tab.id });
                })
                .child(flowIcon("close", 11, t.dim)),
            ),
          ),
        );
    };

    const settledBtn = settledTabs.length > 0
      ? ownPress(
          h_flex()
            .id("flow-settled-btn")
            .h(25)
            .px(7)
            .gap(4)
            .flex_none()
            .items_center()
            .rounded(6)
            .bg(t.surface)
            .border_1()
            .border_color(t.border)
            .text_size(11.5)
            .text_color(t.muted)
            .cursor_pointer()
            .tooltip("查看已收纳在后台运行的标签")
            .hover((s) => s.bg(t.raised).text_color(t.foreground))
            .on_click(() => openOverlay({ mod: "flow", props: { role: "settled" }, kind: "popup", width: 320, height: 340 }))
            .child(`+${settledTabs.length} 后台`),
        )
      : null;

    // 中心心流锚点胶囊：不显示跳秒，仅给出柔和的剩余/累计分钟数与当前唯一意图
    const focusLabel = currentFocusLabel(store);
    let timerText = store.timer.mode === "stopwatch" ? "正计时" : `${store.timer.targetMinutes}m`;
    let timerTextColor = t.dim;
    let anchorDotColor = t.dim;
    if (store.timer.status === "running") {
      if (metrics.isOvertime) {
        timerText = `超流 +${metrics.overtimeMin}m`;
        timerTextColor = t.blocked;
        anchorDotColor = t.blocked;
      } else if (store.timer.mode === "stopwatch") {
        timerText = `已专注 ${metrics.elapsedMin}m`;
        timerTextColor = t.accent;
        anchorDotColor = t.accent;
      } else {
        timerText = `剩 ${metrics.remainingMin}m`;
        timerTextColor = t.accent;
        anchorDotColor = t.accent;
      }
    } else if (store.timer.status === "paused") {
      timerText = `暂停 ${metrics.elapsedMin}m`;
      timerTextColor = t.muted;
      anchorDotColor = t.muted;
    }

    const focusAnchor = ownPress(
      h_flex()
        .id("flow-anchor")
        .h(27)
        .px(8)
        .gap(6)
        .flex_none()
        .items_center()
        .rounded(999)
        .bg(store.timer.status === "running" ? t.raised : t.surface)
        .border_1()
        .border_color(store.timer.status === "running" ? (metrics.isOvertime ? alphaColor(t.blocked, "66") : alphaColor(t.accent, "55")) : t.border)
        .child(
          h_flex()
            .id("flow-anchor-open-studio")
            .gap(6)
            .items_center()
            .cursor_pointer()
            .tooltip("打开/收起心流工作台（Ctrl+Shift+B）")
            .on_click(() => run("layout.toggle", { id: "sidebar" }))
            .child(div().size(7).rounded_full().flex_none().bg(anchorDotColor))
            .child(div().max_w(160).truncate().text_size(12).text_color(focusLabel ? t.foreground : t.muted).child(focusLabel || "设定心流目标"))
            .child(div().text_size(11.5).font_medium().text_color(timerTextColor).child(timerText)),
        )
        .child(
          div()
            .id("flow-anchor-toggle")
            .p(3)
            .rounded(999)
            .cursor_pointer()
            .tooltip(store.timer.status === "running" ? "暂停专注" : "开始专注")
            .hover((s) => s.bg(t.hover))
            .on_click(() => {
              const s = readStore();
              const tNow = Date.now();
              if (s.timer.status === "running") pauseTimer(tNow);
              else startTimer(s.timer.mode, s.timer.targetMinutes, tNow);
            })
            .child(flowIcon(store.timer.status === "running" ? "pause" : "play", 11, t.foreground)),
        )
        .when(store.timer.status !== "idle", (el) =>
          el.child(
            div()
              .id("flow-anchor-finish")
              .p(3)
              .rounded(999)
              .cursor_pointer()
              .tooltip("结束本轮并计入复盘")
              .hover((s) => s.bg(t.hover))
              .on_click(() => finishSession(false, Date.now()))
              .child(flowIcon("check", 11, t.done)),
          ),
        ),
    );

    // 右侧 Agent 收纳胶囊：零动画常驻，仅在有待拍板或已完工时亮起
    const hasUrgent = urgentCount > 0;
    const stowBg = blockedCount > 0 ? alphaColor(t.blocked, "20") : doneCount > 0 ? alphaColor(t.done, "20") : t.surface;
    const stowBorder = blockedCount > 0 ? alphaColor(t.blocked, "66") : doneCount > 0 ? alphaColor(t.done, "66") : t.border;
    const stowDot = blockedCount > 0 ? t.blocked : doneCount > 0 ? t.done : workingCount > 0 ? t.working : t.dim;
    let stowLabel = `Agent (${groups.sorted.length})`;
    if (blockedCount > 0 && doneCount > 0) stowLabel = `${blockedCount} 待拍板 · ${doneCount} 已完工`;
    else if (blockedCount > 0) stowLabel = `${blockedCount} 待拍板`;
    else if (doneCount > 0) stowLabel = `${doneCount} 已完工`;
    else if (workingCount > 0) stowLabel = `${workingCount} 运行中`;

    const agentStowPill = ownPress(
      h_flex()
        .id("flow-agent-stow")
        .h(27)
        .px(9)
        .gap(6)
        .flex_none()
        .items_center()
        .rounded(999)
        .bg(stowBg)
        .border_1()
        .border_color(stowBorder)
        .cursor_pointer()
        .tooltip("打开 Agent 三级收纳抽屉（Ctrl+Shift+A）")
        .hover((s) => s.opacity(0.9))
        .on_click(() => openAgentsModal())
        .child(div().size(7).rounded_full().flex_none().bg(stowDot))
        .child(div().text_size(11.8).font_medium().text_color(hasUrgent ? t.foreground : t.muted).child(stowLabel)),
    );

    const quickTriageBtn = firstUrgent
      ? ownPress(
          div()
            .id("flow-quick-triage")
            .h(27)
            .px(8)
            .flex_none()
            .rounded(7)
            .flex()
            .items_center()
            .bg(t.solid)
            .text_size(11.5)
            .font_semibold()
            .text_color(t.solid_foreground)
            .cursor_pointer()
            .tooltip("不切换当前工作区，浮窗连批待办 Agent")
            .hover((s) => s.opacity(0.88))
            .on_click(() => openTriageWindow(firstUrgent.address))
            .child("快批 ▶"),
        )
      : null;

    const shieldActive = isShieldActive(store);
    const shieldPill = (shieldActive || store.shieldedToasts.length > 0)
      ? ownPress(
          h_flex()
            .id("flow-shield-pill")
            .h(26)
            .px(7)
            .gap(4)
            .flex_none()
            .items_center()
            .rounded(6)
            .bg(shieldActive ? alphaColor(t.accent, "1a") : t.surface)
            .border_1()
            .border_color(shieldActive ? alphaColor(t.accent, "44") : t.border)
            .cursor_pointer()
            .tooltip(shieldActive ? "专注护盾已开启：非致命通知将静默收纳" : "查看专注期间收纳的通知")
            .hover((s) => s.bg(t.raised))
            .on_click(() => openAgentsModal())
            .child(flowIcon("shield", 12, shieldActive ? t.accent : t.dim))
            .when(store.shieldedToasts.length > 0, (el) =>
              el.child(div().text_size(11).text_color(t.foreground).child(String(store.shieldedToasts.length))),
            ),
        )
      : null;

    const togglePanel = (childId) => {
      if (panelActive === childId) run("layout.hide", { id: "panel" });
      else {
        run("layout.select", { stack: "panel-body", child: childId });
        run("layout.show", { id: "panel" });
      }
    };

    return v_flex()
      .size_full()
      .bg(t.chrome)
      .border_b(1)
      .border_color(t.border)
      .child(progressTrack)
      .child(
        h_flex()
          .flex_1()
          .w_full()
          .min_w(0)
          .px(8)
          .pl(lightsPadding)
          .gap(6)
          .items_center()
          .on_mouse_up("left", () => { this.pressedTab = null; })
          .on_scroll_wheel((e) => this.onWheel(e))
          .child(spaceBtn)
          .child(
            h_flex()
              .id("flow-tab-scroll")
              .flex_1()
              .min_w(0)
              .h_full()
              .items_center()
              .gap(4)
              .overflow_x_scrollbar()
              .track_scroll(this.scroll)
              .on_size_change((_size, cx) => {
                if (activeTabIndex >= 0) {
                  this.scroll.scroll_to_item(activeTabIndex);
                  cx.notify();
                }
              })
              .children(visibleTabs.map(renderTab)),
          )
          .when(Boolean(settledBtn), (el) => el.child(settledBtn))
          .child(
            this.iconBtn(t, "flow-tab-new", "plus", "新建标签页", false, () =>
              openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 }),
            ),
          )
          .child(focusAnchor)
          .child(this.iconBtn(t, "flow-studio-btn", "target", "心流工作台（Ctrl+Shift+B）", studioOpen, () => run("layout.toggle", { id: "sidebar" })))
          .child(this.iconBtn(t, "flow-capture-btn", "bolt", "杂念闪记（Ctrl+Shift+I）", false, () => openCaptureModal()))
          .child(this.iconBtn(t, "flow-notes-btn", "note", "悬浮便签窗（Ctrl+Shift+M）", false, () => openNotesWindow()))
          .when(Boolean(shieldPill), (el) => el.child(shieldPill))
          .child(agentStowPill)
          .when(Boolean(quickTriageBtn), (el) => el.child(quickTriageBtn))
          .child(this.iconBtn(t, "flow-diff-btn", "diff", "代码改动", panelActive === "changes", () => togglePanel("changes")))
          .child(this.iconBtn(t, "flow-files-btn", "files", "项目文件", panelActive === "files", () => togglePanel("files")))
          .when(Boolean(w?.buttons), (el) =>
            el
              .child(this.iconBtn(t, "flow-win-min", "win-min", "最小化", false, () => run("window.minimize")))
              .child(this.iconBtn(t, "flow-win-max", w.maximized ? "win-restore" : "win-max", w.maximized ? "还原" : "最大化", false, () => run("window.maximize")))
              .child(this.iconBtn(t, "flow-win-close", "win-close", "关闭窗口", false, () => run("window.close"))),
          ),
      );
  }
}
