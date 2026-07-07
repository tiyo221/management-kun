/* モジュール questions — ビュー（描画・イベント）。業務計算は MK.logic.questions に委譲。CONVENTIONS §1 */
(function () {
  "use strict";
  const MK = window.MK;
  const el = MK.util.el;
  const ui = MK.ui;
  const L = () => MK.logic.questions;

  let root = null;
  let filter = "all";
  let search = "";

  function render() {
    if (!root) return;
    root.innerHTML = "";
    root.appendChild(ui.sectionTitle("わからないこと"));

    // クイック追加（Enter で未解決に投入）
    const capture = ui.input({ placeholder: "わからないことを入力して Enter（未解決に追加）", onEnter: (v) => { if (v.trim()) { L().addItem(v); render(); } } });

    // ツールバー（CSV）
    const bar = ui.toolbar([
      ui.button("CSV出力", { onClick: () => { MK.io.downloadText("questions-" + MK.util.todayISO().replace(/-/g, "") + ".csv", MK.io.csv.stringify(L().buildCSVRows()), "text/csv"); MK.ui.toast("わからないことCSVを書き出しました", "success"); } }),
      ui.button("CSV取込", { onClick: () => MK.io.pickCsvFile((rows) => { const n = L().applyCSV(rows); filter = "all"; render(); MK.ui.toast(n + " 件のわからないことを取り込みました", "success"); }) }),
    ]);

    // ステータスタブ（件数バッジ）。「ナレッジ」＝答えありの解決済み（Issue #81）
    const c = L().counts();
    const tabsBar = ui.toolbar([]);
    tabsBar.appendChild(pill("全て", "all", c.all));
    tabsBar.appendChild(pill("未解決", "open", c.open));
    tabsBar.appendChild(pill("調査中", "investigating", c.investigating));
    tabsBar.appendChild(pill("ナレッジ", "knowledge", c.knowledge));
    const searchBox = ui.input({ placeholder: "検索…（タイトル・タグ・答え）", value: search });
    searchBox.style.maxWidth = "220px";
    searchBox.addEventListener("input", () => { search = searchBox.value; renderList(listHost); });
    tabsBar.appendChild(searchBox);

    const listHost = ui.card([], { flush: true });
    renderList(listHost);

    root.appendChild(ui.stack([capture, bar, tabsBar, listHost]));
  }

  function pill(label, key, count) {
    const b = el("button", { class: "pill-tab" + (filter === key ? " active" : "") }, [
      label + " ", el("span", { class: "badge badge-count", text: String(count || 0) }),
    ]);
    b.addEventListener("click", () => { filter = key; render(); });
    return b;
  }

  function labelOf(statusKey) {
    const s = L().STATUSES.find((x) => x.key === statusKey);
    return s ? s.label : statusKey;
  }

  function renderList(host) {
    host.innerHTML = "";
    const list = filter === "knowledge" ? L().knowledge(search) : L().filtered(filter, search);
    if (!list.length) {
      host.appendChild(ui.emptyState(filter === "knowledge"
        ? "ナレッジはまだありません。解決した質問に答えを残すとここに貯まります"
        : "わからないことはありません"));
      return;
    }
    const ul = el("ul", { class: "mk-list" });
    list.forEach((it) => ul.appendChild(itemRow(it)));
    host.appendChild(ul);
  }

  function itemRow(it) {
    // 答えありの解決済み＝ナレッジは Q→A カードで描く（取り消し線は使わない）
    if (L().isKnowledge(it)) return knowledgeCard(it);

    const meta = [];
    meta.push(el("span", { class: "chip", text: labelOf(it.status) }));
    (it.tags || []).forEach((t) => meta.push(el("span", { class: "chip", text: "#" + t })));

    const title = el("div", { text: it.title });
    const grow = el("div", { class: "grow", style: "cursor:pointer;" }, [title, meta.length ? el("div", { class: "sub" }, meta) : null]);
    grow.addEventListener("click", () => openEditor(it));

    const children = [grow];
    // 未解決／調査中：解決＝ナレッジ化の導線。答えなしで閉じた resolved は「答えを書く」で昇格させる
    const cta = it.status === "resolved" ? "答えを書く" : "解決";
    children.push(ui.button(cta, { onClick: () => openResolve(it) }));
    return el("li", { class: "mk-row" }, children);
  }

  // ナレッジ（Q→A）カード。質問を見出し、答えを主役に描く
  function knowledgeCard(it) {
    const q = el("div", { class: "mk-know-q", text: it.title });
    const a = el("div", { class: "mk-know-a", text: it.resolvedNote });
    const tags = (it.tags || []).map((t) => el("span", { class: "chip", text: "#" + t }));
    const card = el("li", { class: "mk-know-card" }, [q, a, tags.length ? el("div", { class: "mk-know-tags" }, tags) : null]);
    card.addEventListener("click", () => openEditor(it));
    return card;
  }

  // 「どう解決したか」を必ず残してナレッジ化し、ナレッジタブへ遷移する（答え必須）
  function openResolve(it) {
    const note = ui.textarea(it.resolvedNote || "");
    MK.ui.modal({
      title: "どう解決した？（ナレッジにする）",
      body: ui.stack([
        el("div", { class: "sub", text: it.title }),
        ui.field("答え（後で読んで分かるように書く）", note),
      ]),
      actions: [
        { label: "キャンセル", variant: "btn-secondary", onClick: (close) => close() },
        { label: "ナレッジにする", variant: "btn-primary", onClick: (close) => {
            if (!note.value.trim()) { MK.ui.toast("どう解決したかを残してください", "error"); return; }
            L().resolve(it.id, note.value);
            filter = "knowledge";
            close(); render();
            MK.ui.toast("ナレッジに追加しました", "success");
          } },
      ],
    });
  }

  function openEditor(it) {
    const f = {};
    f.title = ui.input({ value: it.title });
    f.detail = ui.textarea(it.detail);
    f.status = ui.select(L().STATUSES.map((s) => ({ value: s.key, label: s.label })), it.status);
    f.tags = ui.input({ value: (it.tags || []).join(", ") });
    f.resolvedNote = ui.textarea(it.resolvedNote);

    const noteField = ui.field("答え（後で読んで分かるように書く）", f.resolvedNote);
    const syncNote = () => { noteField.style.display = f.status.value === "resolved" ? "" : "none"; };
    f.status.addEventListener("change", syncNote);

    const body = ui.stack([
      ui.field("わからないこと", f.title),
      ui.field("背景・メモ", f.detail),
      ui.field("ステータス", f.status),
      ui.field("タグ（カンマ区切り）", f.tags),
      noteField,
    ]);
    syncNote();

    MK.ui.modal({
      title: "わからないことを編集", body,
      actions: [
        { label: "削除", variant: "btn-danger", onClick: (close) => MK.ui.confirm("この項目を削除しますか？").then((ok) => { if (ok) { L().removeItem(it.id); close(); render(); } }) },
        { label: "キャンセル", variant: "btn-secondary", onClick: (close) => close() },
        { label: "保存", variant: "btn-primary", onClick: (close) => {
            const title = f.title.value.trim();
            if (!title) { MK.ui.toast("わからないことを入力してください", "error"); return; }
            L().updateItem(it.id, {
              title, detail: f.detail.value, status: f.status.value,
              tags: f.tags.value.split(",").map((s) => s.trim()).filter(Boolean),
              resolvedNote: f.resolvedNote.value,
            });
            close(); render();
          } },
      ],
    });
  }

  MK.registerModule("questions", {
    title: "わからないこと",
    icon: "❓",
    description: "わからないことを書き出して解消する",
    mount(container) { root = el("div"); container.appendChild(root); render(); },
    unmount() { root = null; },
    summary() { return L().summary(); },
    searchItems() { return L().searchItems(); },
    exportData() { return L().exportData(); },
    importData(data, mode) { L().importData(data, mode); },
    loadSample() { L().loadSample(); },
  });
})();
