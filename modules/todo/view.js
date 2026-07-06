/* モジュール todo — ビュー（描画・イベント）。業務計算は MK.logic.todo に委譲。CONVENTIONS §1 */
(function () {
  "use strict";
  const MK = window.MK;
  const el = MK.util.el;
  const ui = MK.ui;
  const L = () => MK.logic.todo;

  let root = null;
  let filter = "all";
  let search = "";

  function render() {
    if (!root) return;
    root.innerHTML = "";
    root.appendChild(ui.sectionTitle("ToDo"));

    // ツールバー（CSV）
    const bar = ui.toolbar([
      ui.button("CSV出力", { onClick: () => { MK.io.downloadText("todo-" + MK.util.todayISO().replace(/-/g, "") + ".csv", MK.io.csv.stringify(L().buildCSVRows()), "text/csv"); MK.ui.toast("ToDo CSV を書き出しました", "success"); } }),
      ui.button("CSV取込", { onClick: () => MK.io.pickCsvFile((rows) => { const r = L().applyCSV(rows); filter = "all"; search = ""; render(); MK.ui.toast("取込 " + r.ok + " 件" + (r.skip ? " / スキップ " + r.skip + " 件" : ""), r.skip ? "info" : "success"); }) }),
    ]);

    // クイックキャプチャ
    const capture = ui.input({ placeholder: "やることを入力して Enter（Inbox に追加）", onEnter: (v) => { if (v.trim()) { L().addTask(v); render(); } } });

    // ステータスタブ（件数バッジ）
    const c = L().counts();
    const tabsBar = ui.toolbar([]);
    tabsBar.appendChild(pill("全て", "all", c.all));
    L().STATUSES.forEach((s) => tabsBar.appendChild(pill(s.label, s.key, c[s.key])));
    const searchBox = ui.input({ placeholder: "検索…", value: search });
    searchBox.style.maxWidth = "220px";
    searchBox.addEventListener("input", () => { search = searchBox.value; renderList(listHost); });
    tabsBar.appendChild(searchBox);

    const listHost = ui.card([], { flush: true });
    renderList(listHost);

    root.appendChild(ui.stack([bar, capture, tabsBar, listHost]));
  }

  function pill(label, key, count) {
    const b = el("button", { class: "pill-tab" + (filter === key ? " active" : "") }, [
      label + " ", el("span", { class: "badge badge-count", text: String(count || 0) }),
    ]);
    b.addEventListener("click", () => { filter = key; render(); });
    return b;
  }

  function renderList(host) {
    host.innerHTML = "";
    const items = L().filtered(filter, search);
    if (!items.length) {
      // 全体で0件（初回）と、フィルタ/検索の結果0件を区別してガイドする
      if (!L().counts().all) host.appendChild(ui.emptyState({
        title: "まだタスクがありません",
        hint: "上の入力欄にやることを書いて Enter を押すと、最初のタスクが Inbox に追加されます。",
      }));
      else host.appendChild(ui.emptyState("該当するタスクはありません"));
      return;
    }
    const list = el("ul", { class: "mk-list" });
    items.forEach((t) => list.appendChild(taskRow(t)));
    host.appendChild(list);
  }

  function taskRow(t) {
    const cb = el("input", { type: "checkbox" });
    cb.checked = t.status === "done";
    cb.addEventListener("change", () => { L().toggleDone(t.id, cb.checked); render(); });

    const meta = [];
    (t.contexts || []).forEach((cx) => meta.push(el("span", { class: "chip", text: cx })));
    const pn = L().projectNameOf(t.projectId);
    if (pn) meta.push(el("span", { class: "chip", text: "📁 " + pn }));
    if (t.due) meta.push(el("span", { class: "sub", text: "〜" + t.due }));

    const title = el("div", { class: t.status === "done" ? "mk-done" : "", text: t.title });
    const grow = el("div", { class: "grow", style: "cursor:pointer;" }, [title, meta.length ? el("div", { class: "sub" }, meta) : null]);
    grow.addEventListener("click", () => openEditor(t));

    return el("li", { class: "mk-row" }, [cb, grow]);
  }

  function openEditor(t) {
    const f = {};
    f.title = ui.input({ value: t.title });
    f.notes = ui.textarea(t.notes);
    f.status = ui.select(L().STATUSES.map((s) => ({ value: s.key, label: s.label })), t.status);
    f.contexts = ui.input({ value: (t.contexts || []).join(", ") });
    f.project = ui.input({ value: L().projectNameOf(t.projectId) });
    f.due = ui.input({ type: "date", value: t.due || "" });
    const body = ui.stack([
      ui.field("タイトル", f.title),
      ui.field("メモ", f.notes),
      ui.field("ステータス", f.status),
      ui.field("コンテキスト（カンマ区切り）", f.contexts),
      ui.field("プロジェクト（名前）", f.project),
      ui.field("期日", f.due),
    ]);
    MK.ui.modal({
      title: "タスクを編集", body,
      actions: [
        { label: "削除", variant: "btn-danger", onClick: (close) => MK.ui.confirm("このタスクを削除しますか？").then((ok) => { if (ok) { L().removeTask(t.id); close(); render(); } }) },
        { label: "キャンセル", variant: "btn-secondary", onClick: (close) => close() },
        { label: "保存", variant: "btn-primary", onClick: (close) => {
            const title = f.title.value.trim();
            if (!title) { MK.ui.toast("タイトルを入力してください", "error"); return; }
            L().updateTask(t.id, {
              title, notes: f.notes.value, status: f.status.value,
              contexts: f.contexts.value.split(",").map((s) => s.trim()).filter(Boolean),
              projectId: L().resolveProject(f.project.value),
              due: f.due.value || null,
            });
            close(); render();
          } },
      ],
    });
  }

  MK.registerModule("todo", {
    title: "ToDo",
    icon: "✅",
    description: "日々のやることを整理して前に進める",
    mount(container) { root = el("div"); container.appendChild(root); render(); },
    unmount() { root = null; },
    summary() { return L().summary(); },
    searchItems() { return L().searchItems(); },
    exportData() { return L().exportData(); },
    importData(data, mode) { L().importData(data, mode); },
    loadSample() { L().loadSample(); },
  });
})();
