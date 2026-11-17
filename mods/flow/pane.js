// 悬浮分屏标题条（role: "pane"）：默认隐藏（reveal: "hover"），鼠标移到终端上沿才浮现路径与分屏操作。

import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { panes, props, run, theme } from "herdr";
import { flowIcon, programIcon, shortenPath, statusColor } from "./ui.js";

export default class PaneHeaderView extends View {
  button(t, id, iconName, tip, command, args) {
    return div()
      .id(id)
      .p(3)
      .rounded(5)
      .cursor_pointer()
      .tooltip(tip)
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        run(command, args);
      })
      .child(flowIcon(iconName, 13, t.muted));
  }

  render() {
    const t = theme();
    const paneId = props()?.pane;
    const p = panes().find((item) => item.pane === paneId);
    if (!p) return div();

    const pic = programIcon(p.program, 13, t.muted);
    const title = ((p.program?.agent || p.program?.shell) && p.program.name) || p.title || p.program?.name || "shell";
    const dir = shortenPath(p.cwd);

    return h_flex()
      .id(`flow-pane-head-${paneId}`)
      .size_full()
      .px(10)
      .gap(8)
      .items_center()
      .bg(t.surface)
      .border_b(1)
      .border_color(t.border)
      .text_size(11.8)
      .on_click(() => run("pane.focus", { pane: paneId }))
      .when(Boolean(p.status), (el) => el.child(div().size(6).rounded_full().flex_none().bg(statusColor(t, p.status))))
      .when(Boolean(pic), (el) => el.child(pic))
      .child(div().font_semibold().text_color(t.foreground).child(title))
      .when(Boolean(dir), (el) => el.child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(dir)))
      .when(!dir, (el) => el.child(div().flex_1()))
      .when(Boolean(p.branch), (el) =>
        el.child(div().px(6).py(1).rounded(4).bg(t.chrome).border_1().border_color(t.border).text_size(11).text_color(t.muted).child(p.branch)),
      )
      .child(this.button(t, `pane-sr-${paneId}`, "split-right", "向右分屏", "pane.split", { pane: paneId, direction: "right" }))
      .child(this.button(t, `pane-sd-${paneId}`, "split-down", "向下分屏", "pane.split", { pane: paneId, direction: "down" }))
      .child(this.button(t, `pane-zm-${paneId}`, p.zoomed ? "unzoom" : "zoom", p.zoomed ? "还原分屏" : "放大当前分屏", "pane.zoom", { pane: paneId }))
      .child(this.button(t, `pane-cl-${paneId}`, "close", "关闭分屏", "pane.close", { pane: paneId }));
  }
}
