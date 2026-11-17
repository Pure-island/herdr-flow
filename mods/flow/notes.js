// 杂念闪记（role: "capture"）与可拖动悬浮便签窗（role: "notes"）：均完全独立于 Agent，随手记录灵光与临时草稿。

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea, TextView } from "gpui-base";
import { theme, props, closeOverlay, nextCommand, checking } from "herdr";
import { readStore, addParkingItem, addTask, saveScratchpad } from "./store.js";
import { ownPress, alphaColor, flowIcon, actionPill } from "./ui.js";

export class CaptureView extends View {
  init(_props, cx) {
    this.text = "";
    this.handle = cx.focus_handle();
    this.input = InputState.new({ placeholder: "记下冒出来的杂念或支线想法（回车收进停车库）…" });
    this.input.on("change", (_e, cx) => {
      this.text = this.input.value();
      cx.notify();
    });
    this.input.on("submit", (event) => {
      const val = this.input.value().trim();
      if (!val) {
        this.close();
        return;
      }
      if (event?.shift) addTask(val, 25, Date.now());
      else addParkingItem(val, Date.now());
      this.close();
    });
    this.input.focus();

    if (checking()) return;
    cx.timer.after(100, () => this.input.focus());
  }

  close() {
    const ov = props()?.overlay;
    if (ov) closeOverlay(ov);
  }

  render() {
    const t = theme();
    return v_flex()
      .id("flow-capture-root")
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape") {
          this.close();
          cx.stop_propagation();
        }
      })
      .w_full()
      .p(16)
      .gap(12)
      .bg(t.popover)
      .text_color(t.foreground)
      .child(
        h_flex()
          .items_center()
          .justify_between()
          .child(
            h_flex()
              .gap(7)
              .items_center()
              .child(flowIcon("bolt", 15, t.accent))
              .child(div().text_size(14).font_semibold().child("杂念闪记")),
          )
          .child(div().text_size(11).text_color(t.dim).child("Enter 存停车库 · Shift+Enter 加入清单 · Esc 关闭")),
      )
      .child(
        Input.new(this.input)
          .h(38)
          .px(10)
          .rounded(8)
          .bg(t.background)
          .border_1()
          .border_color(t.accent)
          .text_size(13)
          .text_color(t.foreground),
      )
      .child(
        h_flex()
          .gap(8)
          .justify_end()
          .child(actionPill(t, "cap-cancel", "取消", false, () => this.close()))
          .child(
            actionPill(t, "cap-task", "加入今日清单", false, () => {
              const val = this.input.value().trim();
              if (val) addTask(val, 25, Date.now());
              this.close();
            }),
          )
          .child(
            actionPill(t, "cap-park", "存入停车库", true, () => {
              const val = this.input.value().trim();
              if (val) addParkingItem(val, Date.now());
              this.close();
            }),
          ),
      );
  }
}

export class NotesView extends View {
  init(_props, cx) {
    this.preview = false;
    this.copied = false;
    this.handle = cx.focus_handle();
    const initial = readStore().scratchpad;
    this.textarea = TextareaState.new({
      placeholder: "随手记：临时命令、参数或草稿（支持 Markdown）",
      value: initial,
    });
    this.textarea.set_soft_wrap(true);
    this.textarea.on("change", (_e, cx) => {
      saveScratchpad(this.textarea.value());
      cx.notify();
    });
    if (checking()) return;
    cx.spawn(async () => {
      for (;;) {
        const cmd = await nextCommand();
        if (cmd === "close_windows") this.close();
      }
    });
  }

  close() {
    const ov = props()?.overlay;
    if (ov) closeOverlay(ov);
  }

  render() {
    const t = theme();
    const content = readStore().scratchpad;
    if (!this.preview && this.textarea.value() !== content) {
      this.textarea.set_value(content);
    }

    return v_flex()
      .id("flow-notes-root")
      .track_focus(this.handle)
      .size_full()
      .min_h(0)
      .bg(t.popover)
      .text_color(t.foreground)
      .child(
        h_flex()
          .h(36)
          .px(12)
          .gap(8)
          .items_center()
          .bg(t.chrome)
          .border_b(1)
          .border_color(t.border)
          .child(flowIcon("note", 14, t.accent))
          .child(div().flex_1().text_size(12.5).font_semibold().child("悬浮便签"))
          .child(
            ownPress(
              div()
                .id("notes-mode")
                .px(7)
                .py(3)
                .rounded(5)
                .bg(this.preview ? alphaColor(t.accent, "22") : t.surface)
                .border_1()
                .border_color(t.border)
                .text_size(11)
                .text_color(this.preview ? t.accent : t.muted)
                .cursor_pointer()
                .hover((s) => s.bg(t.raised))
                .on_click((_e, cx) => {
                  this.preview = !this.preview;
                  cx.notify();
                })
                .child(this.preview ? "编辑" : "预览 MD"),
            ),
          )
          .child(
            ownPress(
              div()
                .id("notes-copy")
                .px(7)
                .py(3)
                .rounded(5)
                .bg(t.surface)
                .border_1()
                .border_color(t.border)
                .text_size(11)
                .text_color(t.muted)
                .cursor_pointer()
                .hover((s) => s.bg(t.raised).text_color(t.foreground))
                .on_click((_e, cx) => {
                  cx.write_to_clipboard(this.textarea.value());
                  this.copied = true;
                  cx.notify();
                  if (!checking()) {
                    cx.timer.after(1400, (cx) => {
                      this.copied = false;
                      cx.notify();
                    });
                  }
                })
                .child(this.copied ? "已复制" : "复制"),
            ),
          )
          .child(
            ownPress(
              div()
                .id("notes-close")
                .size(22)
                .rounded(5)
                .flex()
                .items_center()
                .justify_center()
                .cursor_pointer()
                .hover((s) => s.bg(t.hover))
                .on_click(() => this.close())
                .child(flowIcon("close", 12, t.dim)),
            ),
          ),
      )
      .child(
        ownPress(
          v_flex()
            .flex_1()
            .min_h(0)
            .p(10)
            .when(!this.preview, (el) =>
              el.child(
                Textarea.new(this.textarea)
                  .size_full()
                  .p(8)
                  .rounded(7)
                  .bg(t.background)
                  .border_1()
                  .border_color(t.border)
                  .text_size(12.5)
                  .text_color(t.foreground),
              ),
            )
            .when(this.preview, (el) =>
              el.child(
                v_flex()
                  .flex_1()
                  .min_h(0)
                  .overflow_y_scrollbar()
                  .p(8)
                  .rounded(7)
                  .bg(t.background)
                  .border_1()
                  .border_color(t.border)
                  .child(TextView.markdown("notes-md-view", content || "*暂无内容*").selectable(true)),
              ),
            ),
        ),
      );
  }
}
