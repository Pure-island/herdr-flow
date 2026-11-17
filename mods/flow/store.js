// Flow 个人心流状态中心：全部状态持久化在 shared("flow.store")，各角色视图共享同一权威数据源。

import { shared, setShared, playSound } from "herdr";

const STORE_KEY = "flow.store";
const MAX_TOASTS = 30;
const MAX_SESSIONS = 400;

export const DURATION_PRESETS = [25, 45, 60, 90];

function pad2(n) {
  return n < 10 ? `0${n}` : String(n);
}

// 使用本地时区生成 YYYY-MM-DD，避免跨零点前统计归属错位
export function localDateKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function formatClock(ms) {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function makeId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeTask(item) {
  return {
    id: typeof item?.id === "string" ? item.id : makeId("task"),
    title: typeof item?.title === "string" ? item.title : "",
    estimateMin: typeof item?.estimateMin === "number" && item.estimateMin > 0 ? item.estimateMin : 25,
    done: Boolean(item?.done),
    createdAt: typeof item?.createdAt === "number" ? item.createdAt : Date.now(),
    completedAt: typeof item?.completedAt === "number" ? item.completedAt : null,
  };
}

function normalizeParking(item) {
  return {
    id: typeof item?.id === "string" ? item.id : makeId("park"),
    text: typeof item?.text === "string" ? item.text : "",
    createdAt: typeof item?.createdAt === "number" ? item.createdAt : Date.now(),
  };
}

function normalizeSession(item) {
  return {
    id: typeof item?.id === "string" ? item.id : makeId("sess"),
    date: typeof item?.date === "string" ? item.date : localDateKey(Date.now()),
    startedAt: typeof item?.startedAt === "number" ? item.startedAt : Date.now(),
    endedAt: typeof item?.endedAt === "number" ? item.endedAt : Date.now(),
    durationMin: typeof item?.durationMin === "number" ? item.durationMin : 0,
    overtimeMin: typeof item?.overtimeMin === "number" ? item.overtimeMin : 0,
    title: typeof item?.title === "string" ? item.title : "自由专注",
    shieldedCount: typeof item?.shieldedCount === "number" ? item.shieldedCount : 0,
  };
}

function normalizeToast(item) {
  return {
    id: typeof item?.id === "string" ? item.id : makeId("toast"),
    title: typeof item?.title === "string" ? item.title : "",
    body: typeof item?.body === "string" ? item.body : "",
    level: typeof item?.level === "string" ? item.level : "info",
    action: item?.action && typeof item.action === "object" ? item.action : null,
    at: typeof item?.at === "number" ? item.at : Date.now(),
  };
}

export function readStore() {
  const raw = shared(STORE_KEY);
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const tr = src.timer && typeof src.timer === "object" ? src.timer : {};
  const mode = tr.mode === "stopwatch" ? "stopwatch" : "countdown";
  const status = tr.status === "running" || tr.status === "paused" ? tr.status : "idle";
  return {
    soundEnabled: src.soundEnabled !== false,
    shieldEnabled: src.shieldEnabled !== false,
    timer: {
      mode,
      targetMinutes: typeof tr.targetMinutes === "number" && tr.targetMinutes > 0 ? tr.targetMinutes : 25,
      status,
      startedAt: typeof tr.startedAt === "number" ? tr.startedAt : null,
      accumulatedMs: typeof tr.accumulatedMs === "number" && tr.accumulatedMs >= 0 ? tr.accumulatedMs : 0,
      activeTaskId: typeof tr.activeTaskId === "string" ? tr.activeTaskId : null,
      intent: typeof tr.intent === "string" ? tr.intent : "",
      overtimeNotified: Boolean(tr.overtimeNotified),
      shieldedCount: typeof tr.shieldedCount === "number" ? tr.shieldedCount : 0,
    },
    tasks: Array.isArray(src.tasks) ? src.tasks.map(normalizeTask).filter((x) => x.title.trim()) : [],
    parkingLot: Array.isArray(src.parkingLot) ? src.parkingLot.map(normalizeParking).filter((x) => x.text.trim()) : [],
    scratchpad: typeof src.scratchpad === "string" ? src.scratchpad : "",
    shieldedToasts: Array.isArray(src.shieldedToasts) ? src.shieldedToasts.map(normalizeToast).slice(0, MAX_TOASTS) : [],
    sessions: Array.isArray(src.sessions) ? src.sessions.map(normalizeSession).slice(-MAX_SESSIONS) : [],
  };
}

export function writeStore(next) {
  setShared(STORE_KEY, next);
  return next;
}

export function isShieldActive(store) {
  return Boolean(store.shieldEnabled && store.timer.status === "running");
}

export function activeTaskOf(store) {
  const undone = store.tasks.filter((x) => !x.done);
  return undone.find((x) => x.id === store.timer.activeTaskId) ?? undone[0] ?? null;
}

export function currentFocusLabel(store) {
  const intent = store.timer.intent.trim();
  if (intent) return intent;
  const task = activeTaskOf(store);
  return task ? task.title : "";
}

export function elapsedMs(timer, now) {
  const live = timer.status === "running" && timer.startedAt ? Math.max(0, now - timer.startedAt) : 0;
  return timer.accumulatedMs + live;
}

export function timerMetrics(timer, now) {
  const ms = elapsedMs(timer, now);
  const elapsedMin = Math.floor(ms / 60000);
  const targetMs = timer.targetMinutes * 60000;
  if (timer.mode === "stopwatch") {
    return {
      elapsedMs: ms,
      elapsedMin,
      remainingMin: 0,
      progressRatio: timer.status === "idle" ? 0 : Math.min(1, (ms % 1800000) / 1800000),
      isOvertime: false,
      overtimeMin: 0,
    };
  }
  const diffMs = targetMs - ms;
  const isOvertime = timer.status !== "idle" && diffMs < 0;
  return {
    elapsedMs: ms,
    elapsedMin,
    remainingMin: Math.max(0, Math.ceil(diffMs / 60000)),
    progressRatio: timer.status === "idle" ? 0 : Math.min(1, ms / targetMs),
    isOvertime,
    overtimeMin: isOvertime ? Math.floor((-diffMs) / 60000) : 0,
  };
}

export function toggleSoundSetting() {
  const store = readStore();
  store.soundEnabled = !store.soundEnabled;
  return writeStore(store);
}

export function toggleShieldSetting() {
  const store = readStore();
  store.shieldEnabled = !store.shieldEnabled;
  return writeStore(store);
}

export function setTimerConfig(mode, targetMinutes) {
  const store = readStore();
  store.timer.mode = mode === "stopwatch" ? "stopwatch" : "countdown";
  if (typeof targetMinutes === "number" && targetMinutes > 0) {
    store.timer.targetMinutes = targetMinutes;
  }
  return writeStore(store);
}

export function setIntent(text) {
  const store = readStore();
  store.timer.intent = text;
  return writeStore(store);
}

export function startTimer(mode, targetMinutes, now) {
  const store = readStore();
  if (mode === "countdown" || mode === "stopwatch") {
    store.timer.mode = mode;
  }
  if (typeof targetMinutes === "number" && targetMinutes > 0) {
    store.timer.targetMinutes = targetMinutes;
  }
  if (store.timer.status === "running") return store;
  const fresh = store.timer.status === "idle";
  store.timer.status = "running";
  store.timer.startedAt = now;
  if (fresh) {
    store.timer.accumulatedMs = 0;
    store.timer.overtimeNotified = false;
    store.timer.shieldedCount = 0;
  }
  return writeStore(store);
}

export function pauseTimer(now) {
  const store = readStore();
  if (store.timer.status !== "running") return store;
  store.timer.accumulatedMs = elapsedMs(store.timer, now);
  store.timer.startedAt = null;
  store.timer.status = "paused";
  return writeStore(store);
}

export function checkOvertimeChime(now) {
  const store = readStore();
  if (store.timer.status !== "running" || store.timer.mode !== "countdown") return false;
  if (store.timer.overtimeNotified) return false;
  const metrics = timerMetrics(store.timer, now);
  if (!metrics.isOvertime) return false;
  store.timer.overtimeNotified = true;
  writeStore(store);
  if (store.soundEnabled) playSound("done");
  return true;
}

export function finishSession(markActiveDone, now) {
  const store = readStore();
  const ms = elapsedMs(store.timer, now);
  const metrics = timerMetrics(store.timer, now);
  const durationMin = Math.round(ms / 60000);
  const active = activeTaskOf(store);
  const title = currentFocusLabel(store) || "自由专注";
  if (durationMin >= 1) {
    store.sessions.push({
      id: makeId("sess"),
      date: localDateKey(now),
      startedAt: now - ms,
      endedAt: now,
      durationMin,
      overtimeMin: metrics.overtimeMin,
      title,
      shieldedCount: store.timer.shieldedCount,
    });
    if (store.sessions.length > MAX_SESSIONS) {
      store.sessions = store.sessions.slice(-MAX_SESSIONS);
    }
  }
  if (markActiveDone && active) {
    active.done = true;
    active.completedAt = now;
    const nextUndone = store.tasks.find((x) => !x.done);
    store.timer.activeTaskId = nextUndone ? nextUndone.id : null;
  }
  store.timer.status = "idle";
  store.timer.startedAt = null;
  store.timer.accumulatedMs = 0;
  store.timer.overtimeNotified = false;
  store.timer.shieldedCount = 0;
  if (store.soundEnabled && durationMin >= 1) playSound("done");
  return writeStore(store);
}

export function addTask(title, estimateMin, now) {
  const clean = title.trim();
  if (!clean) return readStore();
  const store = readStore();
  const task = {
    id: makeId("task"),
    title: clean,
    estimateMin: estimateMin > 0 ? estimateMin : 25,
    done: false,
    createdAt: now,
    completedAt: null,
  };
  store.tasks.unshift(task);
  if (!store.timer.activeTaskId) {
    store.timer.activeTaskId = task.id;
    if (store.timer.status === "idle") store.timer.targetMinutes = task.estimateMin;
  }
  return writeStore(store);
}

export function selectActiveTask(id) {
  const store = readStore();
  const task = store.tasks.find((x) => x.id === id && !x.done);
  if (!task) return store;
  store.timer.activeTaskId = task.id;
  if (store.timer.status === "idle") store.timer.targetMinutes = task.estimateMin;
  return writeStore(store);
}

export function toggleTaskDone(id, now) {
  const store = readStore();
  const task = store.tasks.find((x) => x.id === id);
  if (!task) return store;
  task.done = !task.done;
  task.completedAt = task.done ? now : null;
  if (task.done && store.timer.activeTaskId === id) {
    const nextUndone = store.tasks.find((x) => !x.done);
    store.timer.activeTaskId = nextUndone ? nextUndone.id : null;
  } else if (!task.done && !store.timer.activeTaskId) {
    store.timer.activeTaskId = task.id;
  }
  writeStore(store);
  if (task.done && store.soundEnabled) playSound("done");
  return store;
}

export function removeTask(id) {
  const store = readStore();
  store.tasks = store.tasks.filter((x) => x.id !== id);
  if (store.timer.activeTaskId === id) {
    const nextUndone = store.tasks.find((x) => !x.done);
    store.timer.activeTaskId = nextUndone ? nextUndone.id : null;
  }
  return writeStore(store);
}

export function addParkingItem(text, now) {
  const clean = text.trim();
  if (!clean) return readStore();
  const store = readStore();
  store.parkingLot.unshift({ id: makeId("park"), text: clean, createdAt: now });
  return writeStore(store);
}

export function promoteParkingToTask(id, estimateMin, now) {
  const store = readStore();
  const item = store.parkingLot.find((x) => x.id === id);
  if (!item) return store;
  store.parkingLot = store.parkingLot.filter((x) => x.id !== id);
  const task = {
    id: makeId("task"),
    title: item.text,
    estimateMin: estimateMin > 0 ? estimateMin : 25,
    done: false,
    createdAt: now,
    completedAt: null,
  };
  store.tasks.unshift(task);
  if (!store.timer.activeTaskId) store.timer.activeTaskId = task.id;
  return writeStore(store);
}

export function removeParkingItem(id) {
  const store = readStore();
  store.parkingLot = store.parkingLot.filter((x) => x.id !== id);
  return writeStore(store);
}

export function saveScratchpad(text) {
  const store = readStore();
  store.scratchpad = text;
  return writeStore(store);
}

export function recordShieldedToast(payload, now) {
  const store = readStore();
  const entry = {
    id: makeId("toast"),
    title: typeof payload?.title === "string" ? payload.title : "后台通知",
    body: typeof payload?.body === "string" ? payload.body : "",
    level: typeof payload?.level === "string" ? payload.level : "info",
    action: payload?.action && typeof payload.action === "object" ? payload.action : null,
    at: now,
  };
  store.shieldedToasts = [entry, ...store.shieldedToasts].slice(0, MAX_TOASTS);
  if (store.timer.status === "running") {
    store.timer.shieldedCount += 1;
  }
  return writeStore(store);
}

export function clearShieldedToasts() {
  const store = readStore();
  store.shieldedToasts = [];
  return writeStore(store);
}

// 生成按周一到周日对齐的多周专注热力图数据
export function buildHeatmapWeeks(sessions, weekCount, nowMs) {
  const totals = {};
  const counts = {};
  for (const s of sessions) {
    totals[s.date] = (totals[s.date] ?? 0) + s.durationMin;
    counts[s.date] = (counts[s.date] ?? 0) + 1;
  }
  const today = new Date(nowMs);
  today.setHours(12, 0, 0, 0);
  const todayStr = localDateKey(today.getTime());
  // 将星期偏移归算到周一为 0、周日为 6
  const weekdayMon0 = (today.getDay() + 6) % 7;
  const weekStart = new Date(today.getTime());
  weekStart.setDate(weekStart.getDate() - weekdayMon0 - (weekCount - 1) * 7);

  const weeks = [];
  for (let w = 0; w < weekCount; w++) {
    const col = [];
    for (let d = 0; d < 7; d++) {
      const cellDate = new Date(weekStart.getTime());
      cellDate.setDate(cellDate.getDate() + w * 7 + d);
      const dateStr = localDateKey(cellDate.getTime());
      const minutes = totals[dateStr] ?? 0;
      const count = counts[dateStr] ?? 0;
      const future = dateStr > todayStr;
      let level = 0;
      if (minutes >= 120) level = 4;
      else if (minutes >= 60) level = 3;
      else if (minutes >= 25) level = 2;
      else if (minutes > 0) level = 1;
      col.push({ date: dateStr, minutes, count, level, future });
    }
    weeks.push(col);
  }
  return weeks;
}

export function computeStreak(sessions, nowMs) {
  const activeDates = new Set(sessions.filter((s) => s.durationMin > 0).map((s) => s.date));
  const cursor = new Date(nowMs);
  cursor.setHours(12, 0, 0, 0);
  if (!activeDates.has(localDateKey(cursor.getTime()))) {
    cursor.setDate(cursor.getDate() - 1);
  }
  let streak = 0;
  while (activeDates.has(localDateKey(cursor.getTime()))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export function buildTodayMarkdown(store, nowMs) {
  const todayStr = localDateKey(nowMs);
  const todaySessions = store.sessions.filter((s) => s.date === todayStr);
  const totalMin = todaySessions.reduce((sum, s) => sum + s.durationMin, 0);
  const shielded = todaySessions.reduce((sum, s) => sum + s.shieldedCount, 0);
  const completedToday = store.tasks.filter((t) => t.done && t.completedAt && localDateKey(t.completedAt) === todayStr);
  const pending = store.tasks.filter((t) => !t.done);

  const lines = [
    `# Flow 专注小结 (${todayStr})`,
    "",
    `- 累计专注：**${totalMin} 分钟**（${todaySessions.length} 轮）`,
    `- 挡住后台打扰：**${shielded} 次**`,
    `- 今日完成事项：**${completedToday.length} 项**`,
  ];
  if (completedToday.length) {
    lines.push("", "## 已完成");
    for (const task of completedToday) lines.push(`- [x] ${task.title} (${task.estimateMin}m)`);
  }
  if (todaySessions.length) {
    lines.push("", "## 专注时间轴");
    for (const sess of todaySessions) {
      const extra = sess.overtimeMin > 0 ? `（含超流 +${sess.overtimeMin}m）` : "";
      lines.push(`- ${formatClock(sess.startedAt)}–${formatClock(sess.endedAt)} · ${sess.title} · ${sess.durationMin}m${extra}`);
    }
  }
  if (pending.length) {
    lines.push("", "## 待继续");
    for (const task of pending.slice(0, 8)) lines.push(`- [ ] ${task.title} (${task.estimateMin}m)`);
  }
  if (store.parkingLot.length) {
    lines.push("", "## 杂念停车库");
    for (const item of store.parkingLot.slice(0, 8)) lines.push(`- ${item.text}`);
  }
  return lines.join("\n");
}
