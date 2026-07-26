/* モジュール todo — ビュー（描画・イベント）。業務計算は MK.logic.todo に委譲。CONVENTIONS §1 */
(function () {
  "use strict";
  const MK = window.MK;
  const el = MK.util.el;
  const ui = MK.ui;
  const L = () => MK.logic.todo;

  let root = null;
  let filter = "inbox"; // 初期表示は Inbox（GTD 思想＝Inbox Zero を後押し・追加直後のタスクが消えない・Issue #164）。「全て」タブは残す
  let search = "";
  let sort = "created"; // 並び順（created=追加日順 / due=締め切り順 / project=プロジェクト別 / context=コンテキスト別）
  let listHost = null; // 一覧の器（行単位の部分更新の対象。全再描画は render()）
  const badgeEls = {}; // ステータスタブの件数バッジ（行操作後に textContent だけ差し替える）

  function render() {
    if (!root) return;
    root.innerHTML = "";
    root.appendChild(ui.sectionTitle("ToDo"));

    // 主操作（Inbox の仕分け＝spec/modules/todo.md）を最短にするため、最上段はクイックキャプチャ。
    // CSV 入出力など低頻度の操作は画面最下部へ退避する（CONVENTIONS §2.5-5）。
    const capture = ui.input({ placeholder: "やることを入力して Enter（Inbox に追加）", onEnter: (v) => { if (v.trim()) { L().addTask(v); render(); } } });

    // ステータスタブ（件数バッジ）
    const c = L().counts();
    const tabsBar = ui.toolbar([]);
    tabsBar.appendChild(pill("全て", "all", c.all));
    L().STATUSES.forEach((s) => tabsBar.appendChild(pill(s.label, s.key, c[s.key])));
    const sortSel = ui.select([
      { value: "created", label: "追加日順" },
      { value: "due", label: "締め切り順" },
      { value: "project", label: "プロジェクト別" },
      { value: "context", label: "コンテキスト別" },
    ], sort, (v) => { sort = v; renderList(listHost); });
    sortSel.style.maxWidth = "150px";
    tabsBar.appendChild(sortSel);
    const searchBox = ui.input({ placeholder: "検索…", value: search });
    searchBox.style.maxWidth = "220px";
    searchBox.addEventListener("input", () => { search = searchBox.value; renderList(listHost); });
    tabsBar.appendChild(searchBox);

    listHost = ui.card([], { flush: true });
    renderList(listHost);

    // 低頻度操作（CSV）は最下部（CONVENTIONS §2.5-5）
    const footer = el("div", { class: "mk-todo-footer" }, [
      ui.button("CSV出力", { onClick: () => { MK.io.downloadText("todo-" + MK.util.todayISO().replace(/-/g, "") + ".csv", MK.io.csv.stringify(L().buildCSVRows()), "text/csv"); MK.ui.toast("ToDo CSV を書き出しました", "success"); } }),
      ui.button("CSV取込", { onClick: () => MK.io.pickCsvFile((rows) => { const r = L().applyCSV(rows); filter = "all"; search = ""; render(); MK.ui.toast("取込 " + r.ok + " 件" + (r.skip ? " / スキップ " + r.skip + " 件" : ""), r.skip ? "info" : "success"); }) }),
    ]);

    root.appendChild(ui.stack([capture, tabsBar, listHost, footer]));
  }

  function pill(label, key, count) {
    const badge = el("span", { class: "badge badge-count", text: String(count || 0) });
    badgeEls[key] = badge;
    const b = el("button", { class: "pill-tab" + (filter === key ? " active" : "") }, [label + " ", badge]);
    b.addEventListener("click", () => { filter = key; render(); });
    return b;
  }

  // 件数バッジだけ更新する（行操作でタブを再構築しないため。CONVENTIONS §2.5-4）
  function refreshBadges() {
    const c = L().counts();
    Object.keys(badgeEls).forEach((k) => { badgeEls[k].textContent = String((k === "all" ? c.all : c[k]) || 0); });
  }

  // 行が消えて0件になったら空状態を出す（listHost だけの更新＝スクロールは飛ばない）
  function ensureNotEmpty() {
    if (listHost && !listHost.querySelector(".mk-row")) renderList(listHost);
  }

  // 行内の変更後の後始末: 件数バッジを更新し、この行が今のフィルタ/検索から外れたら取り除く。
  // フィルタ・タブ・取込のような「画面の意味が変わる操作」は render() で全再描画してよいが、
  // チェック/ステータス/インライン編集は行だけ触る（CONVENTIONS §2.5-4）。
  function afterRowChange(row, id) {
    refreshBadges();
    const stays = L().filtered(filter, search, sort).some((x) => x.id === id);
    if (!stays) { row.remove(); ensureNotEmpty(); }
  }

  // 詳細（メモ・コンテキスト・プロジェクト）を編集し直したら、行を作り直して chip 表示を反映する。
  function rebuildRow(row, id) {
    const t = L().tasks().find((x) => x.id === id);
    if (!t) { row.remove(); refreshBadges(); ensureNotEmpty(); return; }
    const fresh = taskRow(t);
    row.replaceWith(fresh);
    afterRowChange(fresh, id);
  }

  function renderList(host) {
    host.innerHTML = "";
    const items = L().filtered(filter, search, sort);
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
    const row = el("li", { class: "mk-row mk-todo-row" });

    // 完了チェック
    const cb = ui.checkbox(t.status === "done");
    // ステータス select（主操作＝Inbox の仕分けを1アクションで。CONVENTIONS §2.5-1）
    const statusSel = ui.select(L().STATUSES.map((s) => ({ value: s.key, label: s.label })), t.status);
    statusSel.classList.add("mk-todo-control", "mk-todo-status");

    // タイトル（インライン編集。Enter/blur 確定・Esc 取消。CONVENTIONS §2.5-2）
    const titleEdit = ui.inlineEdit({
      value: t.title,
      onCommit: (next) => {
        if (!next) { MK.ui.toast("タイトルを入力してください", "error"); return false; } // 空は拒否＝元値へ
        L().updateTask(t.id, { title: next });
        afterRowChange(row, t.id); // 検索中はタイトル変更で一致から外れうる
        return true;
      },
    });
    titleEdit.classList.toggle("mk-done", t.status === "done");

    // 付随情報（コンテキスト・プロジェクト）は表示のみ。編集は「詳細」モーダルで（3項目まとめて）。
    const meta = [];
    (t.contexts || []).forEach((cx) => meta.push(el("span", { class: "chip", text: cx })));
    const pn = L().projectNameOf(t.projectId);
    if (pn) meta.push(el("span", { class: "chip", text: "📁 " + pn }));
    const grow = el("div", { class: "grow" }, [titleEdit, meta.length ? el("div", { class: "sub" }, meta) : null]);

    // 期日（行内編集。頻度が高い単項目はモーダルへ入れない。CONVENTIONS §2.5-2）
    const dueInput = el("input", { class: "text-input mk-todo-control mk-todo-due", type: "date" });
    dueInput.value = t.due || "";

    const detailBtn = ui.button("詳細", { variant: "btn-ghost", title: "メモ・コンテキスト・プロジェクトを編集" });
    const delBtn = ui.button("✕", { variant: "btn-ghost", title: "削除" });

    // 完了・ステータス変更後に行内の見た目（チェック/select/取り消し線）を現在値へ揃える
    function syncVisual() {
      const nt = L().tasks().find((x) => x.id === t.id);
      if (!nt) return;
      cb.checked = nt.status === "done";
      statusSel.value = nt.status;
      titleEdit.classList.toggle("mk-done", nt.status === "done");
    }

    cb.addEventListener("change", () => { L().toggleDone(t.id, cb.checked); syncVisual(); afterRowChange(row, t.id); });
    statusSel.addEventListener("change", () => { L().setStatus(t.id, statusSel.value); syncVisual(); afterRowChange(row, t.id); });
    dueInput.addEventListener("change", () => { L().updateTask(t.id, { due: dueInput.value || null }); afterRowChange(row, t.id); });
    detailBtn.addEventListener("click", () => openDetail(t, row));
    delBtn.addEventListener("click", () => {
      L().removeTask(t.id);
      row.remove(); refreshBadges(); ensureNotEmpty();
      MK.ui.undoToast("削除しました", () => {
        if (L().undoDelete()) render(); // 元の位置へ戻すため全再描画（1回の明示操作なのでコスト許容）
        else MK.ui.toast("元に戻せませんでした（他の変更が入っています）", "error");
      });
    });

    [cb, grow, statusSel, dueInput, detailBtn, delBtn].forEach((n) => row.appendChild(n));
    return row;
  }

  // 詳細編集モーダル（3項目以上の同時編集にだけモーダルを使う。CONVENTIONS §2.5-2）。
  // タイトル・ステータス・期日は行内で編集するため、ここには置かない。
  function openDetail(t, row) {
    const f = {};
    f.notes = ui.textarea(t.notes);
    f.contexts = ui.input({ value: (t.contexts || []).join(", ") });
    f.project = ui.input({ value: L().projectNameOf(t.projectId) });
    const body = ui.stack([
      ui.field("メモ", f.notes),
      ui.field("コンテキスト（カンマ区切り）", f.contexts),
      ui.field("プロジェクト（名前）", f.project),
    ]);
    MK.ui.modal({
      title: "詳細を編集", body,
      actions: [
        { label: "キャンセル", variant: "btn-secondary", onClick: (close) => close() },
        { label: "保存", variant: "btn-primary", onClick: (close) => {
            L().updateTask(t.id, {
              notes: f.notes.value,
              contexts: f.contexts.value.split(",").map((s) => s.trim()).filter(Boolean),
              projectId: L().resolveProject(f.project.value),
            });
            close(); rebuildRow(row, t.id);
          } },
      ],
    });
  }

  MK.registerModule("todo", {
    title: "ToDo",
    icon: "✅",
    description: "日々のやることを整理して前に進める",
    mount(container) { root = el("div"); container.appendChild(root); render(); },
    unmount() { root = null; listHost = null; },
    summary() { return L().summary(); },
    searchItems() { return L().searchItems(); },
    exportData() { return L().exportData(); },
    importData(data, mode) { L().importData(data, mode); },
    loadSample() { L().loadSample(); },
  });
})();
