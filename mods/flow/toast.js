// 全局通知拦截器（layout.toast = "flow"）：开启专注护盾且计时运行中时，静默吸收非错误类后台通知；其余情况平静展示。

import { View, div, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, closeOverlay, run, theme, checking } from "herdr";
import { readStore, isShieldActive, recordShieldedToast } from "./store.js";

const LEVEL_DOT = { error: "blocked", warning: "working", success: "done", info: "accent" };

export default class ToastView extends View {
  init() {
    this.copied = false;
    const p = props() ?? {};
    const store = readStore();
    this.shielded = !checking() && isShieldActive(store) && p.level !== "error";
    if (this.shielded) {
      recordShieldedToast(p, Date.now());
      if (p.overlay) closeOverlay(p.overlay);
    }
  }

  render() {
    if (this.shielded) return div().size_0();
    const t = theme();
    const p = props() ?? {};
    const login = /^([a-z0-9][a-z0-9_.-]{0,31}) needs login; run hc machine login \1$/.exec(p.body ?? "");
    const command = login ? `hc machine login ${login[1]}` : null;

    return h_flex()
      .id("flow-toast")
      .size_full()
      .px(16)
      .gap(12)
      .items_center()
      .bg(t.popover)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click(() => {
        if (p.action?.name) run(p.action.name, p.action.args ?? {});
        if (p.overlay) closeOverlay(p.overlay);
      })
      .child(
        p.icon
          ? image(p.icon).w(18).h(18).flex_none()
          : div().size(8).rounded_full().flex_none().bg(t[LEVEL_DOT[p.level] ?? "accent"] ?? t.accent),
      )
      .child(
        v_flex()
          .flex_1()
          .min_w(0)
          .overflow_hidden()
          .child(
            div()
              .truncate()
              .font_semibold()
              .text_size(12.8)
              .text_color(t.foreground)
              .child(login ? `${login[1]} 需要重新登录` : (p.title ?? "")),
          )
          .when(!login && Boolean(p.body), (el) =>
            el.child(div().truncate().text_size(11.8).text_color(t.muted).child(p.body ?? "")),
          )
          .when(Boolean(login), (el) =>
            el.child(
              h_flex()
                .gap(8)
                .items_center()
                .child(div().flex_1().min_w(0).truncate().tooltip(command).text_size(11.8).text_color(t.muted).child(command))
                .child(
                  div()
                    .id("flow-toast-copy")
                    .flex_none()
                    .px(6)
                    .py(3)
                    .rounded(4)
                    .bg(t.raised)
                    .text_size(11.5)
                    .text_color(t.foreground)
                    .cursor_pointer()
                    .hover((s) => s.bg(t.hover))
                    .on_click((_e, cx) => {
                      cx.stop_propagation();
                      cx.write_to_clipboard(command);
                      this.copied = true;
                      cx.notify();
                    })
                    .child(this.copied ? "已复制" : "复制"),
                ),
            ),
          ),
      );
  }
}
