// 心流工作台侧栏（role: "studio"）：个人闯关清单、三模式计时器（含超流顺延）、4-4-4-4 呼吸引导、杂念停车库与多周热力图复盘。

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { theme, checking, run } from "herdr";
import {
  DURATION_PRESETS,
  readStore,
  activeTaskOf,
  currentFocusLabel,
  timerMetrics,
  localDateKey,
  formatClock,
  toggleSoundSetting,
  toggleShieldSetting,
  setTimerConfig,
  setIntent,
  startTimer,
  pauseTimer,
  finishSession,
  addTask,
  selectActiveTask,
  toggleTaskDone,
  removeTask,
  addParkingItem,
  promoteParkingToTask,
  removeParkingItem,
  clearShieldedToasts,
  buildHeatmapWeeks,
  computeStreak,
  buildTodayMarkdown,
} from "./store.js";
import { alphaColor, flowIcon, actionPill } from "./ui.js";

const STUDIO_TABS = [
  { id: "tasks", label: "清单" },
  { id: "breathe", label: "呼吸" },
  { id: "parking", label: "停车库" },
  { id: "stats", label: "复盘" },
];

const ESTIMATE_CHOICES = [15, 25, 45, 60];

export default class StudioView extends View {
  init(_props, cx) {
    this.tab = "tasks";
    this.showDone = false;
    this.newEstimate = 25;
    this.copiedReport = false;
    this.intentEditing = false;
    this.breathActive = false;
    this.breathStartedAt = 0;

    this.intentInput = InputState.new({ placeholder: "输入这轮专注要搞定的那一件事…" });
    this.intentInput.on("submit", (_e, cx) => {
      setIntent(this.intentInput.value().trim());
      this.intentEditing = false;
      cx.notify();
    });

    this.taskInput = InputState.new({ placeholder: "添加个人待办（不绑定终端）…" });
    this.taskInput.on("submit", (_e, cx) => {
      const val = this.taskInput.value().trim();
      if (val) {
        addTask(val, this.newEstimate, Date.now());
        this.taskInput.set_value("");
      }
      cx.notify();
    });

    this.parkInput = InputState.new({ placeholder: "记下一闪而过的杂念，稍后再处理…" });
    this.parkInput.on("submit", (_e, cx) => {
      const val = this.parkInput.value().trim();
      if (val) {
        addParkingItem(val, Date.now());
        this.parkInput.set_value("");
      }
      cx.notify();
    });

    if (checking()) return;

    cx.timer.every(5000, (cx) => {
      if (readStore().timer.status === "running") cx.notify();
    });

    cx.timer.every(1000, (cx) => {
      if (this.breathActive && this.tab === "breathe") cx.notify();
    });
  }

  renderHero(t, store, metrics, now) {
    const activeTask = activeTaskOf(store);
    const label = currentFocusLabel(store);
    const isRunning = store.timer.status === "running";
    const isPaused = store.timer.status === "paused";
    const isIdle = store.timer.status === "idle";

    let readout = `${store.timer.targetMinutes} 分钟倒计时`;
    let statusBadge = "准备就绪";
    let badgeTone = t.dim;
    if (store.timer.mode === "stopwatch" && isIdle) {
      readout = "自由正计时";
    } else if (!isIdle) {
      if (metrics.isOvertime) {
        readout = `超流顺延 +${metrics.overtimeMin} 分钟`;
        statusBadge = "超流延续中";
        badgeTone = t.blocked;
      } else if (store.timer.mode === "stopwatch") {
        readout = `已专注 ${metrics.elapsedMin} 分钟`;
        statusBadge = isRunning ? "正计时中" : "已暂停";
        badgeTone = isRunning ? t.accent : t.muted;
      } else {
        readout = `剩余 ${metrics.remainingMin} 分钟`;
        statusBadge = isRunning ? "深潜中" : "已暂停";
        badgeTone = isRunning ? t.accent : t.muted;
      }
    }

    const barWidth = metrics.isOvertime || store.timer.mode === "stopwatch"
      ? "100%"
      : `${Math.max(isIdle ? 0 : 4, Math.min(100, Math.round(metrics.progressRatio * 100)))}%`;

    return v_flex()
      .p(12)
      .gap(10)
      .rounded(10)
      .bg(t.raised)
      .border_1()
      .border_color(metrics.isOvertime ? alphaColor(t.blocked, "66") : isRunning ? alphaColor(t.accent, "55") : t.border)
      .child(
        h_flex()
          .items_center()
          .justify_between()
          .gap(6)
          .child(
            div()
              .px(7)
              .py(2)
              .rounded(999)
              .bg(alphaColor(badgeTone, "22"))
              .text_size(11)
              .font_semibold()
              .text_color(badgeTone)
              .child(statusBadge),
          )
          .child(
            h_flex()
              .gap(5)
              .items_center()
              .child(
                div()
                  .id("studio-shield-toggle")
                  .px(6)
                  .py(2)
                  .rounded(5)
                  .bg(store.shieldEnabled ? alphaColor(t.accent, "20") : t.surface)
                  .border_1()
                  .border_color(store.shieldEnabled ? alphaColor(t.accent, "44") : t.border)
                  .text_size(10.5)
                  .text_color(store.shieldEnabled ? t.accent : t.dim)
                  .cursor_pointer()
                  .tooltip("专注期间自动把非致命弹窗收进信箱")
                  .on_click(() => toggleShieldSetting())
                  .child(store.shieldEnabled ? "护盾开" : "护盾关"),
              )
              .child(
                div()
                  .id("studio-sound-toggle")
                  .px(6)
                  .py(2)
                  .rounded(5)
                  .bg(t.surface)
                  .border_1()
                  .border_color(t.border)
                  .text_size(10.5)
                  .text_color(store.soundEnabled ? t.muted : t.dim)
                  .cursor_pointer()
                  .tooltip("切换完成与到点柔和提示音")
                  .on_click(() => toggleSoundSetting())
                  .child(store.soundEnabled ? "音效开" : "静音"),
              ),
          ),
      )
      .when(!this.intentEditing, (el) =>
        el.child(
          v_flex()
            .id("studio-intent-display")
            .gap(2)
            .cursor_pointer()
            .hover((s) => s.opacity(0.88))
            .on_click((_e, cx) => {
              this.intentInput.set_value(store.timer.intent || "");
              this.intentEditing = true;
              this.intentInput.focus();
              cx.notify();
            })
            .child(
              div()
                .text_size(14.5)
                .font_semibold()
                .text_color(label ? t.foreground : t.muted)
                .child(label || "点击写下此刻唯一的专注目标"),
            )
            .when(Boolean(activeTask && store.timer.intent.trim()), (sub) =>
              sub.child(div().text_size(11).text_color(t.dim).child(`关联待办：${activeTask.title}`)),
            ),
        ),
      )
      .when(this.intentEditing, (el) =>
        el.child(
          h_flex()
            .gap(6)
            .items_center()
            .child(
              Input.new(this.intentInput)
                .flex_1()
                .h(30)
                .px(8)
                .rounded(6)
                .bg(t.background)
                .border_1()
                .border_color(t.accent)
                .text_size(12.5)
                .text_color(t.foreground),
            )
            .child(
              actionPill(t, "studio-intent-save", "确定", true, (_e, cx) => {
                setIntent(this.intentInput.value().trim());
                this.intentEditing = false;
                cx.notify();
              }),
            ),
        ),
      )
      .child(
        v_flex()
          .gap(5)
          .child(
            h_flex()
              .items_baseline()
              .justify_between()
              .child(div().text_size(17).font_semibold().text_color(t.foreground).child(readout))
              .when(!isIdle, (el) =>
                el.child(div().text_size(11).text_color(t.dim).child(`已累计 ${metrics.elapsedMin}m`)),
              ),
          )
          .child(
            div()
              .w_full()
              .h(4)
              .rounded(2)
              .bg(t.background)
              .overflow_hidden()
              .when(!isIdle, (el) =>
                el.child(div().w(barWidth).h_full().rounded(2).bg(metrics.isOvertime ? t.blocked : t.accent)),
              ),
          ),
      )
      .child(
        h_flex()
          .gap(5)
          .items_center()
          .flex_wrap()
          .children(
            DURATION_PRESETS.map((min) => {
              const on = store.timer.mode === "countdown" && store.timer.targetMinutes === min;
              return div()
                .id(`studio-preset-${min}`)
                .px(7)
                .py(3)
                .rounded(5)
                .cursor_pointer()
                .text_size(11)
                .bg(on ? alphaColor(t.accent, "24") : t.surface)
                .border_1()
                .border_color(on ? t.accent : t.border)
                .text_color(on ? t.accent : t.muted)
                .hover((s) => s.bg(t.hover))
                .on_click(() => setTimerConfig("countdown", min))
                .child(`${min}m`);
            }),
          )
          .child(
            div()
              .id("studio-preset-stopwatch")
              .px(7)
              .py(3)
              .rounded(5)
              .cursor_pointer()
              .text_size(11)
              .bg(store.timer.mode === "stopwatch" ? alphaColor(t.accent, "24") : t.surface)
              .border_1()
              .border_color(store.timer.mode === "stopwatch" ? t.accent : t.border)
              .text_color(store.timer.mode === "stopwatch" ? t.accent : t.muted)
              .hover((s) => s.bg(t.hover))
              .on_click(() => setTimerConfig("stopwatch", store.timer.targetMinutes))
              .child("正计时"),
          ),
      )
      .child(
        h_flex()
          .gap(7)
          .items_center()
          .child(
            actionPill(
              t,
              "studio-timer-main",
              isRunning ? "暂停专注" : isPaused ? "继续专注" : "开始专注",
              !isRunning,
              () => {
                if (isRunning) pauseTimer(now);
                else startTimer(store.timer.mode, store.timer.targetMinutes, now);
              },
            ),
          )
          .when(!isIdle, (el) =>
            el.child(
              actionPill(t, "studio-timer-done", activeTask ? "结束并勾选当前项" : "完成本轮", isRunning, () =>
                finishSession(Boolean(activeTask), now),
              ),
            ),
          ),
      );
  }

  renderTasksTab(t, store, now) {
    const activeTask = activeTaskOf(store);
    const pending = store.tasks.filter((x) => !x.done);
    const done = store.tasks.filter((x) => x.done);

    const taskRow = (task) => {
      const selected = !task.done && activeTask?.id === task.id;
      return h_flex()
        .id(`task-row-${task.id}`)
        .px(8)
        .py(7)
        .gap(8)
        .items_center()
        .rounded(8)
        .bg(selected ? t.selected : t.background)
        .border_1()
        .border_color(selected ? alphaColor(t.accent, "66") : t.border)
        .hover((s) => s.bg(selected ? t.selected : t.raised))
        .child(
          div()
            .id(`task-check-${task.id}`)
            .size(16)
            .flex_none()
            .rounded(4)
            .flex()
            .items_center()
            .justify_center()
            .cursor_pointer()
            .bg(task.done ? t.done : t.surface)
            .border_1()
            .border_color(task.done ? t.done : t.input)
            .on_click((_e, cx) => {
              cx.stop_propagation();
              toggleTaskDone(task.id, now);
            })
            .when(task.done, (el) => el.child(flowIcon("check", 11, t.accent_foreground))),
        )
        .child(
          div()
            .id(`task-pick-${task.id}`)
            .flex_1()
            .min_w(0)
            .cursor_pointer()
            .on_click(() => {
              if (!task.done) selectActiveTask(task.id);
            })
            .child(
              div()
                .truncate()
                .text_size(12.5)
                .text_color(task.done ? t.dim : t.foreground)
                .child(task.title),
            ),
        )
        .child(
          div()
            .px(5)
            .py(1)
            .rounded(4)
            .bg(t.surface)
            .text_size(10.5)
            .text_color(selected ? t.accent : t.dim)
            .child(`${task.estimateMin}m`),
        )
        .child(
          div()
            .id(`task-del-${task.id}`)
            .p(2)
            .rounded(4)
            .cursor_pointer()
            .hover((s) => s.bg(t.hover))
            .on_click((_e, cx) => {
              cx.stop_propagation();
              removeTask(task.id);
            })
            .child(flowIcon("close", 11, t.dim)),
        );
    };

    return v_flex()
      .gap(10)
      .child(
        v_flex()
          .gap(6)
          .child(
            h_flex()
              .gap(6)
              .items_center()
              .child(
                Input.new(this.taskInput)
                  .flex_1()
                  .h(32)
                  .px(9)
                  .rounded(7)
                  .bg(t.background)
                  .border_1()
                  .border_color(t.input)
                  .text_size(12.2)
                  .text_color(t.foreground),
              )
              .child(
                div()
                  .id("task-add-btn")
                  .h(32)
                  .px(12)
                  .rounded(7)
                  .flex()
                  .items_center()
                  .justify_center()
                  .cursor_pointer()
                  .bg(t.solid)
                  .text_size(14)
                  .font_semibold()
                  .text_color(t.solid_foreground)
                  .hover((s) => s.opacity(0.88))
                  .on_click((_e, cx) => {
                    const val = this.taskInput.value().trim();
                    if (val) {
                      addTask(val, this.newEstimate, now);
                      this.taskInput.set_value("");
                    }
                    cx.notify();
                  })
                  .child("+"),
              ),
          )
          .child(
            h_flex()
              .gap(5)
              .items_center()
              .child(div().text_size(11).text_color(t.dim).child("预估时长:"))
              .children(
                ESTIMATE_CHOICES.map((min) => {
                  const on = this.newEstimate === min;
                  return div()
                    .id(`task-est-${min}`)
                    .px(6)
                    .py(2)
                    .rounded(4)
                    .cursor_pointer()
                    .text_size(10.5)
                    .bg(on ? alphaColor(t.accent, "22") : t.surface)
                    .text_color(on ? t.accent : t.dim)
                    .on_click((_e, cx) => {
                      this.newEstimate = min;
                      cx.notify();
                    })
                    .child(`${min}m`);
                }),
              ),
          ),
      )
      .when(pending.length === 0, (el) =>
        el.child(
          div()
            .p(12)
            .rounded(8)
            .bg(t.background)
            .border_1()
            .border_color(t.border)
            .text_size(12)
            .text_color(t.dim)
            .child("清单清空了。写下接下来要攻克的小目标，或直接用上方计时器开始自由专注。"),
        ),
      )
      .children(pending.map(taskRow))
      .when(done.length > 0, (el) =>
        el.child(
          v_flex()
            .pt(4)
            .gap(5)
            .child(
              h_flex()
                .id("task-done-toggle")
                .gap(6)
                .items_center()
                .cursor_pointer()
                .on_click((_e, cx) => {
                  this.showDone = !this.showDone;
                  cx.notify();
                })
                .child(flowIcon(this.showDone ? "chevron-down" : "chevron-right", 12, t.dim))
                .child(div().text_size(11.5).text_color(t.dim).child(`已完成 (${done.length})`)),
            )
            .when(this.showDone, (sub) => sub.children(done.map(taskRow))),
        ),
      );
  }

  renderBreatheTab(t, now) {
    const elapsedSec = this.breathActive ? Math.floor((now - this.breathStartedAt) / 1000) : 0;
    const cyclePos = elapsedSec % 16;
    const cycles = Math.floor(elapsedSec / 16);

    let phaseName = "4-4-4-4 箱式深呼吸";
    let hint = "心绪太乱进不去状态时，跟着圆环静心 30 秒再开工";
    let countdown = "准备";
    let orbSize = 76;
    let ringColor = t.accent;

    if (this.breathActive) {
      if (cyclePos < 4) {
        phaseName = "缓慢吸气";
        hint = "用鼻子平稳吸满腹部";
        countdown = `${4 - cyclePos}s`;
        orbSize = 128;
        ringColor = t.accent;
      } else if (cyclePos < 8) {
        phaseName = "屏息稳住";
        hint = "肩颈放松，稳住气息";
        countdown = `${4 - (cyclePos - 4)}s`;
        orbSize = 128;
        ringColor = t.done;
      } else if (cyclePos < 12) {
        phaseName = "均匀呼气";
        hint = "把杂念随呼气慢慢放空";
        countdown = `${4 - (cyclePos - 8)}s`;
        orbSize = 74;
        ringColor = t.working;
      } else {
        phaseName = "静默停顿";
        hint = "停留四拍，感受安静";
        countdown = `${4 - (cyclePos - 12)}s`;
        orbSize = 74;
        ringColor = t.dim;
      }
    }

    return v_flex()
      .p(14)
      .gap(14)
      .items_center()
      .rounded(10)
      .bg(t.background)
      .border_1()
      .border_color(t.border)
      .child(
        div()
          .size(144)
          .flex()
          .items_center()
          .justify_center()
          .child(
            div()
              .id("studio-breath-orb")
              .w(orbSize)
              .h(orbSize)
              .rounded_full()
              .bg(alphaColor(ringColor, "24"))
              .border(2)
              .border_color(ringColor)
              .transition("width", { duration: 950, easing: "ease-in-out" })
              .transition("height", { duration: 950, easing: "ease-in-out" })
              .flex()
              .items_center()
              .justify_center()
              .child(div().text_size(18).font_semibold().text_color(t.foreground).child(countdown)),
          ),
      )
      .child(
        v_flex()
          .items_center()
          .gap(4)
          .child(div().text_size(14.5).font_semibold().text_color(t.foreground).child(phaseName))
          .child(div().text_size(11.8).text_color(t.dim).child(hint))
          .when(this.breathActive, (el) =>
            el.child(div().text_size(11).text_color(t.muted).child(`已完成 ${cycles} 个循环`)),
          ),
      )
      .child(
        actionPill(
          t,
          "studio-breath-btn",
          this.breathActive ? "结束呼吸引导" : "开始 30 秒收心呼吸",
          !this.breathActive,
          (_e, cx) => {
            this.breathActive = !this.breathActive;
            if (this.breathActive) this.breathStartedAt = Date.now();
            cx.notify();
          },
        ),
      );
  }

  renderParkingTab(t, store, now) {
    return v_flex()
      .gap(10)
      .child(
        h_flex()
          .gap(6)
          .items_center()
          .child(
            Input.new(this.parkInput)
              .flex_1()
              .h(32)
              .px(9)
              .rounded(7)
              .bg(t.background)
              .border_1()
              .border_color(t.input)
              .text_size(12.2)
              .text_color(t.foreground),
          )
          .child(
            div()
              .id("park-add-btn")
              .h(32)
              .px(11)
              .rounded(7)
              .flex()
              .items_center()
              .justify_center()
              .cursor_pointer()
              .bg(t.solid)
              .text_size(12)
              .font_medium()
              .text_color(t.solid_foreground)
              .hover((s) => s.opacity(0.88))
              .on_click((_e, cx) => {
                const val = this.parkInput.value().trim();
                if (val) {
                  addParkingItem(val, now);
                  this.parkInput.set_value("");
                }
                cx.notify();
              })
              .child("停放"),
          ),
      )
      .when(store.parkingLot.length === 0, (el) =>
        el.child(
          div()
            .p(12)
            .rounded(8)
            .bg(t.background)
            .border_1()
            .border_color(t.border)
            .text_size(12)
            .text_color(t.dim)
            .child("杂念停车库还是空的。写代码时突发奇想直接按 Ctrl+Shift+I 扔进来，休息时再决定要不要转为待办。"),
        ),
      )
      .children(
        store.parkingLot.map((item) =>
          v_flex()
            .id(`park-item-${item.id}`)
            .p(9)
            .gap(6)
            .rounded(8)
            .bg(t.background)
            .border_1()
            .border_color(t.border)
            .child(div().text_size(12.3).text_color(t.foreground).child(item.text))
            .child(
              h_flex()
                .justify_between()
                .items_center()
                .child(div().text_size(10.5).text_color(t.dim).child(formatClock(item.createdAt)))
                .child(
                  h_flex()
                    .gap(6)
                    .child(
                      div()
                        .id(`park-promote-${item.id}`)
                        .px(6)
                        .py(2)
                        .rounded(4)
                        .bg(t.surface)
                        .border_1()
                        .border_color(t.border)
                        .text_size(11)
                        .text_color(t.accent)
                        .cursor_pointer()
                        .hover((s) => s.bg(t.raised))
                        .on_click(() => promoteParkingToTask(item.id, 25, now))
                        .child("→ 转为待办"),
                    )
                    .child(
                      div()
                        .id(`park-del-${item.id}`)
                        .px(6)
                        .py(2)
                        .rounded(4)
                        .text_size(11)
                        .text_color(t.dim)
                        .cursor_pointer()
                        .hover((s) => s.bg(t.hover).text_color(t.foreground))
                        .on_click(() => removeParkingItem(item.id))
                        .child("删除"),
                    ),
                ),
            ),
        ),
      )
      .when(store.shieldedToasts.length > 0, (el) =>
        el.child(
          v_flex()
            .p(9)
            .gap(6)
            .rounded(8)
            .bg(alphaColor(t.accent, "12"))
            .border_1()
            .border_color(alphaColor(t.accent, "38"))
            .child(
              h_flex()
                .justify_between()
                .items_center()
                .child(div().text_size(11.5).font_semibold().text_color(t.accent).child(`静默收件箱 (${store.shieldedToasts.length})`))
                .child(
                  div()
                    .id("park-clear-shield")
                    .text_size(11)
                    .text_color(t.dim)
                    .cursor_pointer()
                    .on_click(() => clearShieldedToasts())
                    .child("清空"),
                ),
            )
            .children(
              store.shieldedToasts.slice(0, 5).map((note) =>
                h_flex()
                  .id(`park-note-${note.id}`)
                  .gap(6)
                  .items_center()
                  .cursor_pointer()
                  .hover((s) => s.opacity(0.85))
                  .on_click(() => {
                    if (note.action?.name) run(note.action.name, note.action.args ?? {});
                  })
                  .child(div().text_size(10.5).text_color(t.dim).child(formatClock(note.at)))
                  .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.foreground).child(note.title)),
              ),
            ),
        ),
      );
  }

  renderStatsTab(t, store, now) {
    const todayStr = localDateKey(now);
    const todaySessions = store.sessions.filter((s) => s.date === todayStr);
    const todayMin = todaySessions.reduce((sum, s) => sum + s.durationMin, 0);
    const shieldedToday = todaySessions.reduce((sum, s) => sum + s.shieldedCount, 0);
    const completedToday = store.tasks.filter((x) => x.done && x.completedAt && localDateKey(x.completedAt) === todayStr).length;
    const streak = computeStreak(store.sessions, now);
    const weeks = buildHeatmapWeeks(store.sessions, 10, now);

    const levelColor = (cell) => {
      if (cell.future) return t.chrome;
      if (cell.level === 4) return t.done;
      if (cell.level === 3) return alphaColor(t.done, "b0");
      if (cell.level === 2) return alphaColor(t.done, "70");
      if (cell.level === 1) return alphaColor(t.done, "38");
      return t.background;
    };

    const metricBox = (label, value, tone) =>
      v_flex()
        .flex_1()
        .p(9)
        .gap(3)
        .rounded(8)
        .bg(t.background)
        .border_1()
        .border_color(t.border)
        .child(div().text_size(10.5).text_color(t.dim).child(label))
        .child(div().text_size(16).font_semibold().text_color(tone).child(value));

    return v_flex()
      .gap(10)
      .child(
        h_flex()
          .gap(7)
          .child(metricBox("今日专注", `${todayMin}m`, t.accent))
          .child(metricBox("完成事项", `${completedToday} 项`, t.done))
          .child(metricBox("连续天数", `${streak} 天`, t.foreground)),
      )
      .child(
        h_flex()
          .px(10)
          .py(7)
          .justify_between()
          .items_center()
          .rounded(8)
          .bg(t.background)
          .border_1()
          .border_color(t.border)
          .child(div().text_size(11.5).text_color(t.muted).child("今日专注护盾已帮你挡住打扰"))
          .child(div().text_size(12.5).font_semibold().text_color(t.accent).child(`${shieldedToday} 次`)),
      )
      .child(
        v_flex()
          .p(10)
          .gap(8)
          .rounded(9)
          .bg(t.background)
          .border_1()
          .border_color(t.border)
          .child(
            h_flex()
              .justify_between()
              .items_center()
              .child(div().text_size(11.5).font_semibold().text_color(t.muted).child("近 10 周专注热力图"))
              .child(div().text_size(10.5).text_color(t.dim).child("少 → 多")),
          )
          .child(
            h_flex()
              .gap(5)
              .items_start()
              .child(
                v_flex()
                  .gap(4)
                  .pt(1)
                  .children(
                    ["一", "", "三", "", "五", "", "日"].map((d) =>
                      div().h(13).flex().items_center().text_size(9.5).text_color(t.dim).child(d),
                    ),
                  ),
              )
              .child(
                h_flex()
                  .gap(4)
                  .children(
                    weeks.map((week, wi) =>
                      v_flex()
                        .gap(4)
                        .children(
                          week.map((cell, di) =>
                            div()
                              .id(`hm-${wi}-${di}`)
                              .size(13)
                              .rounded(3)
                              .bg(levelColor(cell))
                              .border_1()
                              .border_color(cell.future ? alphaColor(t.border, "44") : t.border)
                              .tooltip(`${cell.date} · ${cell.minutes} 分钟（${cell.count} 轮）`),
                          ),
                        ),
                    ),
                  ),
              ),
          ),
      )
      .child(
        actionPill(
          t,
          "studio-export-md",
          this.copiedReport ? "已复制今日 Markdown 小结 ✓" : "复制今日 Markdown 复盘小结",
          true,
          (_e, cx) => {
            cx.write_to_clipboard(buildTodayMarkdown(store, now));
            this.copiedReport = true;
            cx.notify();
            if (!checking()) {
              cx.timer.after(1800, (cx) => {
                this.copiedReport = false;
                cx.notify();
              });
            }
          },
        ),
      )
      .when(todaySessions.length > 0, (el) =>
        el.child(
          v_flex()
            .gap(5)
            .child(div().text_size(11.5).font_semibold().text_color(t.muted).child("今日心流记录"))
            .children(
              [...todaySessions].reverse().slice(0, 6).map((sess) =>
                h_flex()
                  .px(8)
                  .py(6)
                  .gap(8)
                  .items_center()
                  .rounded(7)
                  .bg(t.background)
                  .border_1()
                  .border_color(t.border)
                  .child(div().text_size(10.5).text_color(t.dim).child(`${formatClock(sess.startedAt)}–${formatClock(sess.endedAt)}`))
                  .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.foreground).child(sess.title))
                  .child(
                    div()
                      .text_size(11)
                      .text_color(sess.overtimeMin > 0 ? t.blocked : t.done)
                      .child(`${sess.durationMin}m`),
                  ),
              ),
            ),
        ),
      );
  }

  render() {
    const t = theme();
    const now = Date.now();
    const store = readStore();
    const metrics = timerMetrics(store.timer, now);

    return v_flex()
      .size_full()
      .min_h(0)
      .p(10)
      .gap(10)
      .rounded(10)
      .bg(t.surface)
      .border_1()
      .border_color(t.border)
      .text_color(t.foreground)
      .child(
        h_flex()
          .items_center()
          .justify_between()
          .px(2)
          .child(
            h_flex()
              .gap(6)
              .items_center()
              .child(flowIcon("target", 14, t.accent))
              .child(div().text_size(13).font_semibold().child("Flow 心流工作台")),
          )
          .child(
            div()
              .id("studio-collapse")
              .px(6)
              .py(2)
              .rounded(5)
              .text_size(11)
              .text_color(t.dim)
              .cursor_pointer()
              .hover((s) => s.bg(t.hover).text_color(t.foreground))
              .on_click(() => run("layout.hide", { id: "sidebar" }))
              .child("收起"),
          ),
      )
      .child(this.renderHero(t, store, metrics, now))
      .child(
        h_flex()
          .p(3)
          .gap(3)
          .rounded(8)
          .bg(t.chrome)
          .border_1()
          .border_color(t.border)
          .children(
            STUDIO_TABS.map((item) => {
              const on = this.tab === item.id;
              let badge = "";
              if (item.id === "tasks") {
                const n = store.tasks.filter((x) => !x.done).length;
                if (n > 0) badge = ` (${n})`;
              } else if (item.id === "parking" && store.parkingLot.length > 0) {
                badge = ` (${store.parkingLot.length})`;
              }
              return div()
                .id(`studio-tab-${item.id}`)
                .flex_1()
                .h(26)
                .rounded(6)
                .flex()
                .items_center()
                .justify_center()
                .cursor_pointer()
                .text_size(11.8)
                .font_medium()
                .bg(on ? t.raised : t.chrome)
                .text_color(on ? t.foreground : t.dim)
                .hover((s) => s.text_color(t.foreground))
                .on_click((_e, cx) => {
                  this.tab = item.id;
                  cx.notify();
                })
                .child(`${item.label}${badge}`);
            }),
          ),
      )
      .child(
        v_flex()
          .flex_1()
          .min_h(0)
          .overflow_y_scrollbar()
          .pr(2)
          .when(this.tab === "tasks", (el) => el.child(this.renderTasksTab(t, store, now)))
          .when(this.tab === "breathe", (el) => el.child(this.renderBreatheTab(t, now)))
          .when(this.tab === "parking", (el) => el.child(this.renderParkingTab(t, store, now)))
          .when(this.tab === "stats", (el) => el.child(this.renderStatsTab(t, store, now))),
      );
  }
}
