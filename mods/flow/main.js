// Flow 布局主入口：按 props().role 分发到各子模块；herdr-app check 时一次性遍历渲染所有角色以覆盖完整代码路径。

import { View, div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { props, checking } from "herdr";
import FlowBar from "./bar.js";
import StudioView from "./studio.js";
import ProjectsView from "./projects.js";
import { AgentsStowView, TriageBarView, SettledTabsView } from "./agents.js";
import { CaptureView, NotesView } from "./notes.js";
import PaneHeaderView from "./pane.js";
import ToastView from "./toast.js";

const ROLES = {
  bar: FlowBar,
  studio: StudioView,
  projects: ProjectsView,
  agents: AgentsStowView,
  "triage-bar": TriageBarView,
  settled: SettledTabsView,
  capture: CaptureView,
  notes: NotesView,
  pane: PaneHeaderView,
  toast: ToastView,
};

export default class FlowMod extends View {
  init(initialProps, cx) {
    const p = props() ?? initialProps ?? {};
    if (checking()) {
      this.checkViews = Object.entries(ROLES).map(([name, RoleClass]) => {
        const instance = new RoleClass();
        instance.init?.({ role: name }, cx);
        return instance;
      });
      return;
    }

    // 根布局设置了 "toast": "flow"，因此系统弹窗通知会直接传入 { title, body, overlay } 且不含 role
    const roleKey = p.role ?? (p.overlay ? "toast" : "bar");
    const RoleClass = ROLES[roleKey] ?? null;
    this.roleName = roleKey;
    this.role = RoleClass ? new RoleClass() : null;
    this.role?.init?.(p, cx);
  }

  render(cx) {
    if (checking()) {
      return v_flex().children(this.checkViews.map((v) => v.render(cx)));
    }
    if (!this.role) return div().child(`flow: 未知角色 "${this.roleName}"`);
    return this.role.render(cx);
  }

  async close(cx) {
    await this.role?.close?.(cx);
  }
}
