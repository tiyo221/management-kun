/* モジュール techstack — ビュー（描画・イベント）。計算/取込は MK.logic.techstack に委譲。CONVENTIONS §1 */
(function () {
  "use strict";
  const MK = window.MK;
  const el = MK.util.el;
  const ui = MK.ui;
  const L = () => MK.logic.techstack;

  let root = null;
  let ring = "all";
  let category = "all";
  let search = "";

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

    const listHost = ui.card([], { flush: true });
    renderList(listHost);

    root.appendChild(ui.stack([capture, bar, tabsBar, filterBar, listHost]));
  }

  function pill(label, key, count) {
    const b = el("button", { class: "pill-tab" + (ring === key ? " active" : "") }, [
      label + " ", el("span", { class: "badge badge-count", text: String(count || 0) }),
    ]);
    b.addEventListener("click", () => { ring = key; render(); });
    return b;
  }

  function labelOf(ringKey) {
    const r = L().RINGS.find((x) => x.key === ringKey);
    return r ? r.label : ringKey;
  }

  function renderList(host) {
    host.innerHTML = "";
    const list = L().filtered(ring, category, search);
    if (!list.length) { host.appendChild(ui.emptyState("技術がありません。技術名を入力して追加してください。")); return; }
    const ul = el("ul", { class: "mk-list" });
    list.forEach((it) => ul.appendChild(itemRow(it)));
    host.appendChild(ul);
  }

  function itemRow(it) {
    const meta = [];
    meta.push(el("span", { class: "chip", text: labelOf(it.ring) }));
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

    const title = el("div", { text: it.name });
    const grow = el("div", { class: "grow", style: "cursor:pointer;" }, [title, meta.length ? el("div", { class: "sub" }, meta) : null]);
    grow.addEventListener("click", () => openEditor(it));

    return el("li", { class: "mk-row" }, [grow]);
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
        { label: "削除", variant: "btn-danger", onClick: (close) => MK.ui.confirm("この技術を削除しますか？").then((ok) => { if (ok) { L().removeItem(it.id); close(); render(); } }) },
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
    exportData() { return L().exportData(); },
    importData(data, mode) { L().importData(data, mode); },
    loadSample() { L().loadSample(); },
  });
})();
