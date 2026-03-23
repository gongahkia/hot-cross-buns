import "clsx";
import { $ as attr, e as escape_html, a0 as attr_class, a1 as ensure_array_like, _ as derived, a2 as store_get, a3 as attr_style, a4 as unsubscribe_stores, a5 as stringify } from "../../chunks/index2.js";
import { w as writable } from "../../chunks/index.js";
import { invoke } from "@tauri-apps/api/core";
import { t as theme } from "../../chunks/theme.js";
import "@tauri-apps/plugin-dialog";
import "@tauri-apps/plugin-fs";
function html(value) {
  var html2 = String(value ?? "");
  var open = "<!---->";
  return open + html2 + "<!---->";
}
const lists = writable([]);
const metrics = {
  startedAt: typeof performance !== "undefined" ? performance.now() : 0,
  bootstrapCompletedAt: null,
  selectedListHydratedAt: null,
  firstInteractiveAt: null
};
function publish() {
  if (typeof window !== "undefined") {
    window.__TICKCLONE_STARTUP_METRICS__ = { ...metrics };
  }
}
publish();
const tasks = writable([]);
const taskMutationVersion = writable(0);
function removeTaskTree(items, taskId) {
  return items.filter((task) => task.id !== taskId && task.parentTaskId !== taskId);
}
function bumpTaskMutationVersion() {
  taskMutationVersion.update((value) => value + 1);
}
async function editTask(id, fields) {
  const updated = await invoke("update_task", {
    id,
    title: fields.title ?? null,
    content: fields.content ?? null,
    priority: fields.priority ?? null,
    status: fields.status ?? null,
    dueDate: fields.dueDate ?? null,
    dueTimezone: fields.dueTimezone ?? null,
    recurrenceRule: fields.recurrenceRule ?? null,
    sortOrder: fields.sortOrder ?? null
  });
  tasks.update(
    (current) => current.map((task) => task.id === id ? updated : task)
  );
  bumpTaskMutationVersion();
  return updated;
}
async function moveTask(id, newListId, sortOrder) {
  const moved = await invoke("move_task", {
    id,
    newListId,
    newSortOrder: sortOrder
  });
  tasks.update((current) => removeTaskTree(current, id));
  bumpTaskMutationVersion();
  return moved;
}
const tags = writable([]);
const selectedListId = writable(null);
const selectedTaskId = writable(null);
const currentView = writable("list");
function SyncSettings($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let { open = false } = $$props;
    let serverUrl = "";
    let authToken = "";
    let deviceId = "";
    let autoSync = false;
    let syncing = false;
    let syncConflicts = [];
    let lastSyncedLabel = derived(() => {
      return null;
    });
    function prettyConflictValue(raw) {
      try {
        return JSON.stringify(JSON.parse(raw), null, 2);
      } catch {
        return raw;
      }
    }
    function conflictLabel(conflict) {
      return `${conflict.entityType}.${conflict.fieldName}`;
    }
    if (open) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div class="sync-overlay svelte-1s8uli6"><div class="sync-panel svelte-1s8uli6" role="dialog" aria-label="Sync Settings"><div class="panel-header svelte-1s8uli6"><h2 class="panel-title svelte-1s8uli6">Sync Settings</h2> <button class="panel-close svelte-1s8uli6" aria-label="Close">✕</button></div> <div class="panel-body svelte-1s8uli6"><div class="field svelte-1s8uli6"><label class="field-label svelte-1s8uli6" for="sync-server-url">Server URL</label> <input id="sync-server-url" class="field-input svelte-1s8uli6" type="text" placeholder="https://api.example.com/sync"${attr("value", serverUrl)}/></div> <div class="field svelte-1s8uli6"><label class="field-label svelte-1s8uli6" for="sync-auth-token">Auth Token</label> <input id="sync-auth-token" class="field-input svelte-1s8uli6" type="password" placeholder="Paste your auth token..."${attr("value", authToken)}/> <button class="magic-link-btn svelte-1s8uli6">${escape_html("Login with Magic Link")}</button> `);
      {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]--></div> <div class="field svelte-1s8uli6"><label class="field-label svelte-1s8uli6" for="sync-device-id">Device ID</label> <input id="sync-device-id" class="field-input svelte-1s8uli6" type="text"${attr("value", deviceId)} readonly=""/></div> <div class="field field-row svelte-1s8uli6"><span class="field-label svelte-1s8uli6">Auto Sync (every 60s)</span> <button${attr_class("toggle-btn svelte-1s8uli6", void 0, { "toggle-on": autoSync })}${attr("aria-pressed", autoSync)} aria-label="Toggle auto sync"><span class="toggle-knob svelte-1s8uli6"></span></button></div> <div class="sync-actions svelte-1s8uli6"><button class="sync-now-btn svelte-1s8uli6"${attr("disabled", syncing, true)}>`);
      {
        $$renderer2.push("<!--[-1-->");
        $$renderer2.push(`Sync Now`);
      }
      $$renderer2.push(`<!--]--></button></div> <div class="health-card svelte-1s8uli6"><div class="health-title svelte-1s8uli6">Sync Health</div> <div class="health-grid svelte-1s8uli6"><div class="health-metric svelte-1s8uli6"><span class="health-label svelte-1s8uli6">Pending changes</span> <strong class="svelte-1s8uli6">${escape_html(0)}</strong></div> <div class="health-metric svelte-1s8uli6"><span class="health-label svelte-1s8uli6">Open conflicts</span> <strong class="svelte-1s8uli6">${escape_html(0)}</strong></div></div> `);
      {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]--></div> `);
      if (lastSyncedLabel()) {
        $$renderer2.push("<!--[0-->");
        $$renderer2.push(`<div class="last-synced svelte-1s8uli6">Last synced: ${escape_html(lastSyncedLabel())}</div>`);
      } else {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]--> `);
      {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]--> `);
      {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]--> <div class="portability-card svelte-1s8uli6"><div class="health-title svelte-1s8uli6">Portability</div> <div class="portability-actions svelte-1s8uli6"><button class="secondary-btn svelte-1s8uli6">Export JSON</button> <button class="secondary-btn svelte-1s8uli6">Export CSV</button> <button class="secondary-btn svelte-1s8uli6">Import JSON</button></div> <p class="field-hint svelte-1s8uli6">JSON is the full-fidelity backup format. CSV exports active tasks for interoperability.</p> `);
      {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]--> `);
      {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]--></div> `);
      if (syncConflicts.length > 0) {
        $$renderer2.push("<!--[0-->");
        $$renderer2.push(`<div class="conflicts-card svelte-1s8uli6"><div class="health-title svelte-1s8uli6">Conflict Review</div> <!--[-->`);
        const each_array = ensure_array_like(syncConflicts);
        for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
          let conflict = each_array[$$index];
          $$renderer2.push(`<div class="conflict-item svelte-1s8uli6"><div class="conflict-header svelte-1s8uli6"><strong>${escape_html(conflictLabel(conflict))}</strong> <span class="conflict-meta svelte-1s8uli6">${escape_html(conflict.entityId)}</span></div> <div class="conflict-columns svelte-1s8uli6"><div class="conflict-column svelte-1s8uli6"><span class="health-label svelte-1s8uli6">Local</span> <pre class="svelte-1s8uli6">${escape_html(prettyConflictValue(conflict.localValue))}</pre></div> <div class="conflict-column svelte-1s8uli6"><span class="health-label svelte-1s8uli6">Remote</span> <pre class="svelte-1s8uli6">${escape_html(prettyConflictValue(conflict.remoteValue))}</pre></div></div> <div class="conflict-actions svelte-1s8uli6"><button class="secondary-btn svelte-1s8uli6">Keep Local</button> <button class="secondary-btn svelte-1s8uli6">Apply Remote</button> <button class="ghost-btn svelte-1s8uli6">Dismiss</button></div></div>`);
        }
        $$renderer2.push(`<!--]--></div>`);
      } else {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]--></div></div></div>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]-->`);
  });
}
function Sidebar($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    var $$store_subs;
    let showSyncSettings = false;
    let inboxList = derived(() => store_get($$store_subs ??= {}, "$lists", lists).find((l) => l.isInbox));
    let userLists = derived(() => store_get($$store_subs ??= {}, "$lists", lists).filter((l) => !l.isInbox).sort((a, b) => a.sortOrder - b.sortOrder));
    function taskCountForList(listId) {
      return store_get($$store_subs ??= {}, "$tasks", tasks).filter((t) => t.listId === listId && t.status === 0).length;
    }
    $$renderer2.push(`<aside class="sidebar svelte-129hoe0"><div class="sidebar-header svelte-129hoe0"><h2 class="svelte-129hoe0">TickClone</h2></div> <nav class="sidebar-nav svelte-129hoe0"><button${attr_class("nav-item svelte-129hoe0", void 0, {
      "active": store_get($$store_subs ??= {}, "$currentView", currentView) === "today"
    })}><span class="nav-icon svelte-129hoe0">${html("&#9728;")}</span> <span class="nav-label svelte-129hoe0">Today</span></button> <button${attr_class("nav-item svelte-129hoe0", void 0, {
      "active": store_get($$store_subs ??= {}, "$currentView", currentView) === "week"
    })}><span class="nav-icon svelte-129hoe0">${html("&#128198;")}</span> <span class="nav-label svelte-129hoe0">Week</span></button> <button${attr_class("nav-item svelte-129hoe0", void 0, {
      "active": store_get($$store_subs ??= {}, "$currentView", currentView) === "calendar"
    })}><span class="nav-icon svelte-129hoe0">${html("&#128197;")}</span> <span class="nav-label svelte-129hoe0">Calendar</span></button></nav> <div class="sidebar-divider svelte-129hoe0"></div> <div class="sidebar-section svelte-129hoe0"><div class="section-header svelte-129hoe0"><span class="section-title svelte-129hoe0">Lists</span></div> `);
    if (inboxList()) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<button${attr_class("list-item svelte-129hoe0", void 0, {
        "active": store_get($$store_subs ??= {}, "$currentView", currentView) === "list" && store_get($$store_subs ??= {}, "$selectedListId", selectedListId) === inboxList().id
      })}><span class="nav-icon svelte-129hoe0">${html("&#128229;")}</span> <span class="list-name svelte-129hoe0">Inbox</span> `);
      if (taskCountForList(inboxList().id) > 0) {
        $$renderer2.push("<!--[0-->");
        $$renderer2.push(`<span class="task-count svelte-129hoe0">${escape_html(taskCountForList(inboxList().id))}</span>`);
      } else {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]--></button>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> <!--[-->`);
    const each_array = ensure_array_like(userLists());
    for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
      let list = each_array[$$index];
      $$renderer2.push(`<button${attr_class("list-item svelte-129hoe0", void 0, {
        "active": store_get($$store_subs ??= {}, "$currentView", currentView) === "list" && store_get($$store_subs ??= {}, "$selectedListId", selectedListId) === list.id
      })}><span class="list-color-dot svelte-129hoe0"${attr_style("", { "background-color": list.color ?? "#cba6f7" })}></span> <span class="list-name svelte-129hoe0">${escape_html(list.name)}</span> `);
      if (taskCountForList(list.id) > 0) {
        $$renderer2.push("<!--[0-->");
        $$renderer2.push(`<span class="task-count svelte-129hoe0">${escape_html(taskCountForList(list.id))}</span>`);
      } else {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]--></button>`);
    }
    $$renderer2.push(`<!--]--> `);
    {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> <button class="new-list-btn svelte-129hoe0"><span class="nav-icon svelte-129hoe0">+</span> <span class="nav-label svelte-129hoe0">New List</span></button></div> <div class="sidebar-divider svelte-129hoe0"></div> <div class="sidebar-section svelte-129hoe0"><button class="section-header section-toggle svelte-129hoe0"><span class="section-title svelte-129hoe0">Tags</span> <span class="toggle-arrow svelte-129hoe0">${escape_html("▾")}</span></button> `);
    {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<!--[-->`);
      const each_array_1 = ensure_array_like(store_get($$store_subs ??= {}, "$tags", tags));
      for (let $$index_1 = 0, $$length = each_array_1.length; $$index_1 < $$length; $$index_1++) {
        let tag = each_array_1[$$index_1];
        $$renderer2.push(`<div class="tag-item svelte-129hoe0"><span class="tag-color-dot svelte-129hoe0"${attr_style("", { "background-color": tag.color ?? "#f5c2e7" })}></span> <span class="tag-name svelte-129hoe0">${escape_html(tag.name)}</span></div>`);
      }
      $$renderer2.push(`<!--]--> `);
      if (store_get($$store_subs ??= {}, "$tags", tags).length === 0) {
        $$renderer2.push("<!--[0-->");
        $$renderer2.push(`<div class="empty-hint svelte-129hoe0">No tags yet</div>`);
      } else {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]-->`);
    }
    $$renderer2.push(`<!--]--></div> <div class="sidebar-spacer svelte-129hoe0"></div> <div class="sidebar-footer svelte-129hoe0"><button class="gear-btn svelte-129hoe0" aria-label="Toggle theme"${attr("title", store_get($$store_subs ??= {}, "$theme", theme) === "system" ? "Theme: System" : store_get($$store_subs ??= {}, "$theme", theme) === "dark" ? "Theme: Dark" : "Theme: Light")}>`);
    if (store_get($$store_subs ??= {}, "$theme", theme) === "dark") {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M14.3 10.5A6.5 6.5 0 0 1 5.5 1.7a6.5 6.5 0 1 0 8.8 8.8Z" fill="currentColor"></path></svg>`);
    } else if (store_get($$store_subs ??= {}, "$theme", theme) === "light") {
      $$renderer2.push("<!--[1-->");
      $$renderer2.push(`<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><circle cx="8" cy="8" r="3" fill="currentColor"></circle><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path></svg>`);
    } else {
      $$renderer2.push("<!--[-1-->");
      $$renderer2.push(`<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect x="1.5" y="2" width="13" height="9" rx="1.5" stroke="currentColor" stroke-width="1.5" fill="none"></rect><path d="M5.5 14h5M8 11v3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path></svg>`);
    }
    $$renderer2.push(`<!--]--></button> <button class="gear-btn svelte-129hoe0" aria-label="Sync settings" title="Sync settings"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M6.6 1.2A.6.6 0 0 1 7.2.6h1.6a.6.6 0 0 1 .6.6v.94a5.4 5.4 0 0 1 1.36.56l.66-.66a.6.6 0 0 1 .85 0l1.13 1.13a.6.6 0 0 1 0 .85l-.66.66c.24.42.42.88.56 1.36h.94a.6.6 0 0 1 .6.6v1.6a.6.6 0 0 1-.6.6h-.94a5.4 5.4 0 0 1-.56 1.36l.66.66a.6.6 0 0 1 0 .85l-1.13 1.13a.6.6 0 0 1-.85 0l-.66-.66c-.42.24-.88.42-1.36.56v.94a.6.6 0 0 1-.6.6H7.2a.6.6 0 0 1-.6-.6v-.94a5.4 5.4 0 0 1-1.36-.56l-.66.66a.6.6 0 0 1-.85 0L2.6 12.37a.6.6 0 0 1 0-.85l.66-.66A5.4 5.4 0 0 1 2.7 9.5h-.94a.6.6 0 0 1-.6-.6V7.3a.6.6 0 0 1 .6-.6h.94c.14-.48.32-.94.56-1.36l-.66-.66a.6.6 0 0 1 0-.85L3.73 2.7a.6.6 0 0 1 .85 0l.66.66c.42-.24.88-.42 1.36-.56V1.2ZM8 10.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Z" fill="currentColor"></path></svg></button></div></aside> `);
    SyncSettings($$renderer2, {
      open: showSyncSettings
    });
    $$renderer2.push(`<!---->`);
    if ($$store_subs) unsubscribe_stores($$store_subs);
  });
}
function TaskDetail($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let task = null;
    let titleValue = "";
    let contentValue = "";
    let dueDateValue = "";
    let dueTimeValue = "";
    let recurrenceValue = "";
    let newSubtaskTitle = "";
    let visible = false;
    const priorityLabels = ["None", "Low", "Med", "High"];
    const priorityColors = ["#6c7086", "#94e2d5", "#f9e2af", "#f38ba8"];
    const recurrencePresets = [
      { value: "", label: "None" },
      { value: "RRULE:FREQ=DAILY", label: "Daily" },
      { value: "RRULE:FREQ=WEEKLY", label: "Weekly" },
      { value: "RRULE:FREQ=MONTHLY", label: "Monthly" },
      { value: "RRULE:FREQ=YEARLY", label: "Yearly" }
    ];
    let allTasks = [];
    let allLists = [];
    tasks.subscribe((v) => allTasks = v);
    tags.subscribe((v) => v);
    lists.subscribe((v) => allLists = v);
    let currentTaskId = null;
    selectedTaskId.subscribe((id) => {
      currentTaskId = id;
      if (id) {
        const found = allTasks.find((t) => t.id === id) ?? null;
        task = found;
        if (found) {
          titleValue = found.title;
          contentValue = found.content ?? "";
          dueDateValue = found.dueDate ? found.dueDate.slice(0, 10) : "";
          dueTimeValue = found.dueDate && found.dueDate.length > 10 ? found.dueDate.slice(11, 16) : "";
          recurrenceValue = found.recurrenceRule ?? "";
        }
        requestAnimationFrame(() => {
          visible = true;
        });
      } else {
        visible = false;
        task = null;
      }
    });
    let subtasks = derived(() => task ? allTasks.filter((t) => t.parentTaskId === task.id) : []);
    function onRecurrenceChange(e) {
      const target = e.target;
      recurrenceValue = target.value;
      if (task) {
        editTask(task.id, { recurrenceRule: recurrenceValue || void 0 });
      }
    }
    async function handleMoveTask(e) {
      const target = e.target;
      if (!task) return;
      const newListId = target.value;
      if (newListId !== task.listId) {
        await moveTask(task.id, newListId, task.sortOrder);
      }
    }
    function formatDate(iso) {
      try {
        return new Date(iso).toLocaleDateString(void 0, { year: "numeric", month: "short", day: "numeric" });
      } catch {
        return iso;
      }
    }
    if (currentTaskId) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div${attr_class("task-detail-overlay svelte-1flxhdg", void 0, { "visible": visible })}></div> <aside${attr_class("task-detail-panel svelte-1flxhdg", void 0, { "visible": visible })}>`);
      if (task) {
        $$renderer2.push("<!--[0-->");
        $$renderer2.push(`<div class="panel-header svelte-1flxhdg"><span class="panel-title svelte-1flxhdg">Task Details</span> <button class="close-btn svelte-1flxhdg" aria-label="Close panel">✕</button></div> <div class="panel-body svelte-1flxhdg"><section class="field-group svelte-1flxhdg"><label class="field-label svelte-1flxhdg" for="task-title">Title</label> <input id="task-title" class="field-input title-input svelte-1flxhdg" type="text"${attr("value", titleValue)}/></section> <section class="field-group svelte-1flxhdg"><label class="field-label svelte-1flxhdg" for="task-content">Notes</label> <textarea id="task-content" class="field-input content-textarea svelte-1flxhdg" rows="4" placeholder="Add notes...">`);
        const $$body = escape_html(contentValue);
        if ($$body) {
          $$renderer2.push(`${$$body}`);
        }
        $$renderer2.push(`</textarea></section> <section class="field-group svelte-1flxhdg"><span class="field-label svelte-1flxhdg">Priority</span> <div class="priority-row svelte-1flxhdg"><!--[-->`);
        const each_array = ensure_array_like(priorityLabels);
        for (let i = 0, $$length = each_array.length; i < $$length; i++) {
          let label = each_array[i];
          $$renderer2.push(`<button${attr_class("priority-btn svelte-1flxhdg", void 0, { "active": task.priority === i })}${attr_style(`--priority-color: ${stringify(priorityColors[i])}`)}>${escape_html(label)}</button>`);
        }
        $$renderer2.push(`<!--]--></div></section> <section class="field-group svelte-1flxhdg"><span class="field-label svelte-1flxhdg">Due Date</span> <div class="date-row svelte-1flxhdg"><input class="field-input date-input svelte-1flxhdg" type="date"${attr("value", dueDateValue)}/> <input class="field-input time-input svelte-1flxhdg" type="time"${attr("value", dueTimeValue)}/></div></section> <section class="field-group svelte-1flxhdg"><label class="field-label svelte-1flxhdg" for="task-recurrence">Recurrence</label> `);
        $$renderer2.select(
          {
            id: "task-recurrence",
            class: "field-input",
            value: recurrenceValue,
            onchange: onRecurrenceChange
          },
          ($$renderer3) => {
            $$renderer3.push(`<!--[-->`);
            const each_array_1 = ensure_array_like(recurrencePresets);
            for (let $$index_1 = 0, $$length = each_array_1.length; $$index_1 < $$length; $$index_1++) {
              let preset = each_array_1[$$index_1];
              $$renderer3.option({ value: preset.value }, ($$renderer4) => {
                $$renderer4.push(`${escape_html(preset.label)}`);
              });
            }
            $$renderer3.push(`<!--]-->`);
          },
          "svelte-1flxhdg"
        );
        $$renderer2.push(`</section> <section class="field-group svelte-1flxhdg"><span class="field-label svelte-1flxhdg">Tags</span> <div class="tags-container svelte-1flxhdg"><!--[-->`);
        const each_array_2 = ensure_array_like(task.tags);
        for (let $$index_2 = 0, $$length = each_array_2.length; $$index_2 < $$length; $$index_2++) {
          let tag = each_array_2[$$index_2];
          $$renderer2.push(`<span class="tag-pill svelte-1flxhdg"${attr_style(`background: ${stringify(tag.color ?? "#cba6f7")}`)}>${escape_html(tag.name)} <button class="tag-remove-btn svelte-1flxhdg"${attr("aria-label", `Remove tag ${stringify(tag.name)}`)}>✕</button></span>`);
        }
        $$renderer2.push(`<!--]--> <div class="tag-add-wrapper svelte-1flxhdg"><button class="tag-add-btn svelte-1flxhdg" aria-label="Add tag">+</button> `);
        {
          $$renderer2.push("<!--[-1-->");
        }
        $$renderer2.push(`<!--]--></div></div></section> <section class="field-group svelte-1flxhdg"><span class="field-label svelte-1flxhdg">Subtasks</span> <div class="subtasks-list svelte-1flxhdg"><!--[-->`);
        const each_array_4 = ensure_array_like(subtasks());
        for (let $$index_4 = 0, $$length = each_array_4.length; $$index_4 < $$length; $$index_4++) {
          let sub = each_array_4[$$index_4];
          $$renderer2.push(`<div class="subtask-item svelte-1flxhdg"><input type="checkbox"${attr("checked", sub.status === 1, true)} class="svelte-1flxhdg"/> <span${attr_class("subtask-title svelte-1flxhdg", void 0, { "completed": sub.status === 1 })}>${escape_html(sub.title)}</span></div>`);
        }
        $$renderer2.push(`<!--]--> <div class="subtask-add-row svelte-1flxhdg"><input class="field-input subtask-input svelte-1flxhdg" type="text" placeholder="Add subtask..."${attr("value", newSubtaskTitle)}/> <button class="subtask-add-btn svelte-1flxhdg">Add</button></div></div></section> <section class="field-group svelte-1flxhdg"><label class="field-label svelte-1flxhdg" for="task-list">List</label> `);
        $$renderer2.select(
          {
            id: "task-list",
            class: "field-input",
            value: task.listId,
            onchange: handleMoveTask
          },
          ($$renderer3) => {
            $$renderer3.push(`<!--[-->`);
            const each_array_5 = ensure_array_like(allLists);
            for (let $$index_5 = 0, $$length = each_array_5.length; $$index_5 < $$length; $$index_5++) {
              let list = each_array_5[$$index_5];
              $$renderer3.option({ value: list.id }, ($$renderer4) => {
                $$renderer4.push(`${escape_html(list.name)}`);
              });
            }
            $$renderer3.push(`<!--]-->`);
          },
          "svelte-1flxhdg"
        );
        $$renderer2.push(`</section></div> <div class="panel-footer svelte-1flxhdg"><span class="created-date svelte-1flxhdg">Created ${escape_html(formatDate(task.createdAt))}</span> <button class="delete-btn svelte-1flxhdg">Delete task</button></div>`);
      } else {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]--></aside>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]-->`);
  });
}
function ShortcutsModal($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let { open = false } = $$props;
    const shortcuts = [
      { key: "N", description: "Focus quick-add input" },
      { key: "Esc", description: "Close panel / deselect" },
      { key: "Del / Backspace", description: "Delete selected task" },
      {
        key: "1 / 2 / 3",
        description: "Set priority (Low / Med / High)"
      },
      { key: "0", description: "Clear priority" },
      { key: "T", description: "Switch to Today view" },
      { key: "C", description: "Switch to Calendar view" },
      { key: "?", description: "Show this help" }
    ];
    if (open) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div class="shortcuts-overlay svelte-wxg2uc"><div class="shortcuts-modal svelte-wxg2uc" role="dialog" aria-label="Keyboard shortcuts"><div class="modal-header svelte-wxg2uc"><h2 class="modal-title svelte-wxg2uc">Keyboard Shortcuts</h2> <button class="modal-close svelte-wxg2uc" aria-label="Close">✕</button></div> <div class="shortcuts-grid svelte-wxg2uc"><!--[-->`);
      const each_array = ensure_array_like(shortcuts);
      for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
        let shortcut = each_array[$$index];
        $$renderer2.push(`<div class="shortcut-row svelte-wxg2uc"><kbd class="shortcut-key svelte-wxg2uc">${escape_html(shortcut.key)}</kbd> <span class="shortcut-desc svelte-wxg2uc">${escape_html(shortcut.description)}</span></div>`);
      }
      $$renderer2.push(`<!--]--></div> <div class="modal-footer svelte-wxg2uc"><span class="footer-hint svelte-wxg2uc">Press <kbd class="inline-kbd svelte-wxg2uc">Esc</kbd> to close</span></div></div></div>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]-->`);
  });
}
function SearchBar($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let query = "";
    $$renderer2.push(`<div class="search-container svelte-yyldap"><div class="search-input-wrapper svelte-yyldap"><svg class="search-icon svelte-yyldap" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M11.5 7a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM10.7 11.4a6 6 0 1 1 .7-.7l3.15 3.15a.5.5 0 0 1-.7.7L10.7 11.4Z" fill="currentColor"></path></svg> <input class="search-input svelte-yyldap" type="text" placeholder="Search tasks..."${attr("value", query)}/></div> `);
    {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--></div>`);
  });
}
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let showShortcuts = false;
    $$renderer2.push(`<div class="app svelte-1uha8ag">`);
    Sidebar($$renderer2);
    $$renderer2.push(`<!----> <main class="content svelte-1uha8ag"><header class="toolbar svelte-1uha8ag"><span class="toolbar-title svelte-1uha8ag">TickClone</span> `);
    SearchBar($$renderer2);
    $$renderer2.push(`<!----></header> <div class="main-area svelte-1uha8ag">`);
    {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<p class="empty-state svelte-1uha8ag">Loading your workspace...</p>`);
    }
    $$renderer2.push(`<!--]--></div></main></div> `);
    TaskDetail($$renderer2);
    $$renderer2.push(`<!----> `);
    ShortcutsModal($$renderer2, { open: showShortcuts });
    $$renderer2.push(`<!---->`);
  });
}
export {
  _page as default
};
