/* モジュール techstack — ビュー（描画・イベント）。計算/取込は MK.logic.techstack に委譲。CONVENTIONS §1 */
(function () {
  "use strict";
  const MK = window.MK;
  const el = MK.util.el;
  const ui = MK.ui;
  const L = () => MK.logic.techstack;
  // MK.ui.removeWithUndo（§2.5-3 の定型）へ渡す削除・復元の口。logic 側は削除できたか／復元できたかを
  // boolean で返す契約なので、そのまま噛み合う。
  const undoApi = () => ({ remove: (id) => L().removeItem(id), undoRemove: () => L().undoDelete() });

  let root = null;
  let ring = "all";
  let category = "all";
  let search = "";
  let listHost = null;   // 一覧の器（行単位の部分更新の対象。全再描画は render()）
  const badgeEls = {};   // リングタブの件数バッジ（行操作後に textContent だけ差し替える）

  function render() {
    if (!root) return;
    root.innerHTML = "";
    root.appendChild(ui.sectionTitle("技術スタック"));

    // クイック追加（Enter で評価（Assess）に投入）
    const capture = ui.input({ placeholder: "技術名を入力して Enter（評価に追加）", onEnter: (v) => { if (v.trim()) { L().addItem(v); render(); } } });

    // ツールバー（CSV）
    const bar = ui.toolbar([
      ui.button("CSV出力", { onClick: () => { MK.io.downloadText("techstack-" + MK.util.todayISO().replace(/-/g, "") + ".csv", MK.io.csv.stringify(L().buildCSVRows()), "text/csv"); MK.ui.toast("技術スタックCSVを書き出しました", "success"); } }),
      ui.button("CSV取込", { onClick: () => MK.io.pickCsvFile((rows) => { const n = L().applyCSV(rows); ring = "all"; category = "all"; render(); MK.ui.toast(n + " 件の技術を取り込みました", "success"); }) }),
    ]);

    // リングタブ（件数バッジ）
    const c = L().counts();
    const tabsBar = ui.toolbar([]);
    tabsBar.appendChild(pill("全て", "all", c.all));
    L().RINGS.forEach((r) => tabsBar.appendChild(pill(r.label, r.key, c[r.key])));

    // カテゴリフィルタ＋検索。選択中カテゴリが編集/削除で消えたら "all" へ正規化する
    // （select 表示とフィルタ状態を一致させる）
    const cats = L().categories();
    if (category !== "all" && cats.indexOf(category) < 0) category = "all";
    const filterBar = ui.toolbar([]);
    const catSel = ui.select(
      [{ value: "all", label: "全カテゴリ" }].concat(cats.map((x) => ({ value: x, label: x }))),
      category,
      (v) => { category = v; render(); });
    filterBar.appendChild(ui.field("カテゴリ", catSel));
    const searchBox = ui.input({ placeholder: "検索…", value: search });
    searchBox.style.maxWidth = "220px";
    searchBox.addEventListener("input", () => { search = searchBox.value; renderList(listHost); });
    filterBar.appendChild(searchBox);

    listHost = ui.card([], { flush: true });
    renderList(listHost);

    root.appendChild(ui.stack([capture, bar, tabsBar, filterBar, listHost]));
  }

  function pill(label, key, count) {
    const badge = el("span", { class: "badge badge-count", text: String(count || 0) });
    badgeEls[key] = badge;
    const b = el("button", { class: "pill-tab" + (ring === key ? " active" : "") }, [label + " ", badge]);
    b.addEventListener("click", () => { ring = key; render(); });
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

  // 行内の変更後の後始末: 件数バッジを更新し、この行が今のリングタブ／カテゴリ／検索から外れたら
  // 取り除く。タブ切替・フィルタ変更・取込のような「画面の意味が変わる操作」は render() でよいが、
  // インライン編集・リング変更は行だけ触る（CONVENTIONS §2.5-4）。
  function afterRowChange(row, id) {
    refreshBadges();
    const stays = L().filtered(ring, category, search).some((x) => x.id === id);
    if (!stays) { row.remove(); ensureNotEmpty(); }
  }

  function renderList(host) {
    host.innerHTML = "";
    const list = L().filtered(ring, category, search);
    if (!list.length) {
      // 全体で0件（初回）と、絞り込みの結果0件を区別してガイドする。リング変更・技術名の編集で
      // 行が絞り込みから外れて0件になる経路（afterRowChange → ensureNotEmpty）でも通る。
      if (!L().counts().all) host.appendChild(ui.emptyState("技術がありません。技術名を入力して追加してください。"));
      else host.appendChild(ui.emptyState("条件に合う技術はありません"));
      return;
    }
    const ul = el("ul", { class: "mk-list" });
    list.forEach((it) => ul.appendChild(itemRow(it)));
    host.appendChild(ul);
  }

  function itemRow(it) {
    const row = el("li", { class: "mk-row mk-row-dense" });

    // 技術名（インライン編集。Enter/blur 確定・Esc 取消。CONVENTIONS §2.5-2）
    const nameEdit = ui.inlineEdit({
      value: it.name,
      onCommit: (next) => {
        if (!next) { MK.ui.toast("技術名を入力してください", "error"); return false; } // 空は拒否＝元値へ
        L().updateItem(it.id, { name: next });
        it.name = next; // 行が握るのは描画時のスナップショット。削除トーストが旧名を出さないよう揃える
        afterRowChange(row, it.id); // 検索中は技術名の変更で一致から外れうる
        return true;
      },
    });

    // リング（採用状況）は行内 select。Adopt / Trial / Assess / Hold を行き来させるのがこのモジュールの
    // 主眼なので、モーダルの4番目の欄に埋めない（CONVENTIONS §2.5-2）。
    const ringSel = ui.select(L().RINGS.map((r) => ({ value: r.key, label: r.label })), it.ring, (v) => {
      L().updateItem(it.id, { ring: v });
      it.ring = v;
      afterRowChange(row, it.id); // リングタブで絞り込み中なら、外れた行を取り除く
    });
    ringSel.classList.add("mk-row-control", "mk-row-select");

    // 付随情報（カテゴリ・バージョン・見直し期限・タグ・メモ）は表示のみ。編集は「編集」モーダルで。
    // リングはもう select が示しているので chip では出さない（同じ情報を二重に置かない）。
    const meta = [];
    if (it.category) meta.push(el("span", { class: "chip", text: it.category }));
    if (it.version) meta.push(el("span", { class: "sub", text: "v" + it.version }));
    if (it.reviewDate) {
      const st = L().deadlineStatus(it.reviewDate);
      const cls = st === "overdue" ? "chip chip-danger" : st === "soon" ? "chip chip-warn" : "chip";
      const prefix = st === "overdue" ? "期限超過 " : st === "soon" ? "見直し間近 " : "見直し ";
      meta.push(el("span", { class: cls, text: prefix + it.reviewDate }));
    }
    (it.tags || []).forEach((t) => meta.push(el("span", { class: "chip", text: "#" + t })));
    if (it.note) meta.push(el("span", { class: "sub", text: it.note }));

    const grow = el("div", { class: "grow" }, [nameEdit, meta.length ? el("div", { class: "sub" }, meta) : null]);

    // 技術名のクリックはインライン編集が取るため、モーダルへの導線は明示のボタンにする
    // （skills / todo の「編集」「詳細」と同じ形）。
    const editBtn = ui.button("編集", { variant: "btn-ghost", title: "カテゴリ・バージョン・メモ・見直し期限・タグを編集" });
    editBtn.addEventListener("click", () => openEditor(it));

    [grow, ringSel, editBtn].forEach((n) => row.appendChild(n));
    return row;
  }

  function openEditor(it) {
    const f = {};
    f.name = ui.input({ value: it.name });
    f.category = ui.input({ value: it.category });
    f.version = ui.input({ value: it.version });
    f.ring = ui.select(L().RINGS.map((r) => ({ value: r.key, label: r.label })), it.ring);
    f.note = ui.textarea(it.note);
    f.reviewDate = ui.input({ type: "date", value: it.reviewDate || "" });
    f.tags = ui.input({ value: (it.tags || []).join(", ") });

    const body = ui.stack([
      ui.field("技術名", f.name),
      ui.field("カテゴリ", f.category),
      ui.field("バージョン", f.version),
      ui.field("採用状況（リング）", f.ring),
      ui.field("メモ（用途・所感・移行方針）", f.note),
      ui.field("見直し期限（EOL・任意）", f.reviewDate),
      ui.field("タグ（カンマ区切り）", f.tags),
    ]);

    MK.ui.modal({
      title: "技術を編集", body,
      actions: [
        // 削除は確認を挟まず即実行し、取り消しトーストを出す（CONVENTIONS §2.5-3）。先にモーダルを
        // 閉じてから出す（モーダルの裏にトーストが隠れないように）。
        { label: "削除", variant: "btn-danger", onClick: (close) => {
            close();
            MK.ui.removeWithUndo(undoApi(), it.id, "「" + it.name + "」を削除しました", render);
          } },
        { label: "キャンセル", variant: "btn-secondary", onClick: (close) => close() },
        { label: "保存", variant: "btn-primary", onClick: (close) => {
            const name = f.name.value.trim();
            if (!name) { MK.ui.toast("技術名を入力してください", "error"); return; }
            L().updateItem(it.id, {
              name, category: f.category.value.trim(), version: f.version.value.trim(),
              ring: f.ring.value, note: f.note.value, reviewDate: f.reviewDate.value,
              tags: f.tags.value.split(",").map((s) => s.trim()).filter(Boolean),
            });
            close(); render();
          } },
      ],
    });
  }

  MK.registerModule("techstack", {
    title: "技術スタック",
    icon: "🧰",
    description: "使っている技術スタックを棚卸しする",
    mount(container) { root = el("div"); container.appendChild(root); render(); },
    unmount() { root = null; },
    summary() { return L().summary(); },
    searchItems() { return L().searchItems(); },
    exportData() { return L().exportData(); },
    importData(data, mode) { L().importData(data, mode); },
    loadSample() { L().loadSample(); },
  });
})();
