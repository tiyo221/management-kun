/* モジュール releases — ビュー（描画・イベント）。計算/CRUD は MK.logic.releases に委譲。CONVENTIONS §1 */
(function () {
  "use strict";
  const MK = window.MK;
  const el = MK.util.el;
  const ui = MK.ui;
  const L = () => MK.logic.releases;

  let root = null;
  let productId = "all";
  let status = "all";

  function render() {
    if (!root) return;
    root.innerHTML = "";
    root.appendChild(ui.sectionTitle("リリース"));

    // ツールバー（追加）
    const bar = ui.toolbar([
      ui.button("リリースを追加", { variant: "btn-primary", onClick: () => {
        if (!MK.products.all().length) { MK.ui.toast("プロダクトがありません。先に「📦 プロダクト」マスタで登録してください", "error"); return; }
        openEditor(null);
      } }),
    ]);

    // プロダクトフィルタ。選択中プロダクトがマスタから消えたら "all" へ正規化する
    const products = MK.products.all();
    if (productId !== "all" && !products.some((p) => p.id === productId)) productId = "all";
    const filterBar = ui.toolbar([]);
    const prodSel = ui.select(
      [{ value: "all", label: "全プロダクト" }].concat(products.map((p) => ({ value: p.id, label: p.name }))),
      productId,
      (v) => { productId = v; render(); });
    filterBar.appendChild(ui.field("プロダクト", prodSel));

    // ステータスタブ（件数バッジ。選択中プロダクト内の件数を出す）
    const c = L().counts(productId);
    const tabsBar = ui.toolbar([]);
    tabsBar.appendChild(pill("全て", "all", c.all));
    L().STATUSES.forEach((s) => tabsBar.appendChild(pill(s.label, s.key, c[s.key])));

    const listHost = ui.card([], { flush: true });
    renderList(listHost);

    root.appendChild(ui.stack([bar, filterBar, tabsBar, listHost]));
  }

  function pill(label, key, count) {
    const b = el("button", { class: "pill-tab" + (status === key ? " active" : "") }, [
      label + " ", el("span", { class: "badge badge-count", text: String(count || 0) }),
    ]);
    b.addEventListener("click", () => { status = key; render(); });
    return b;
  }

  function labelOf(statusKey) {
    const s = L().STATUSES.find((x) => x.key === statusKey);
    return s ? s.label : statusKey;
  }

  function renderList(host) {
    host.innerHTML = "";
    const list = L().timeline(productId, status);
    if (!list.length) { host.appendChild(ui.emptyState("リリースがありません。「リリースを追加」から登録してください。")); return; }
    const ul = el("ul", { class: "mk-list" });
    list.forEach((r) => ul.appendChild(itemRow(r)));
    host.appendChild(ul);
  }

  function itemRow(r) {
    const date = L().effectiveDate(r);
    const meta = [];
    meta.push(el("span", { class: "chip", text: labelOf(r.status) }));
    meta.push(el("span", { class: "chip", text: "📦 " + (L().productName(r) || "（削除済みプロダクト）") }));
    if (r.plannedDate) meta.push(el("span", { class: "sub", text: "予定 " + r.plannedDate }));
    if (r.actualDate) meta.push(el("span", { class: "sub", text: "実施 " + r.actualDate }));
    if (r.note) meta.push(el("span", { class: "sub", text: r.note }));

    const title = el("div", {}, [
      el("span", { class: "sub", text: (date || "日付未定") + "　" }),
      el("span", { text: r.version }),
    ]);
    const grow = el("div", { class: "grow", style: "cursor:pointer;" }, [title, el("div", { class: "sub" }, meta)]);
    grow.addEventListener("click", () => openEditor(r));

    return el("li", { class: "mk-row" }, [grow]);
  }

  /**
   * リリースの追加/編集モーダルを開く。rel=null で新規追加。
   */
  function openEditor(rel) {
    const isNew = !rel;
    const products = MK.products.all();
    const prodOptions = products.map((p) => ({ value: p.id, label: p.name }));
    // 参照先プロダクトが削除済みでも、編集で意図せず付け替えないよう元の id を選択肢に残す
    if (rel && rel.productId && !products.some((p) => p.id === rel.productId)) {
      prodOptions.unshift({ value: rel.productId, label: "（削除済みプロダクト）" });
    }

    const f = {};
    f.productId = ui.select(prodOptions, rel ? rel.productId : (productId !== "all" ? productId : prodOptions[0].value));
    f.version = ui.input({ value: rel ? rel.version : "", placeholder: "例: v1.2.0 / 夏の大型アップデート" });
    f.status = ui.select(L().STATUSES.map((s) => ({ value: s.key, label: s.label })), rel ? rel.status : "planned");
    f.plannedDate = ui.input({ type: "date", value: rel ? rel.plannedDate : "" });
    f.actualDate = ui.input({ type: "date", value: rel ? rel.actualDate : "" });
    f.note = ui.textarea(rel ? rel.note : "");

    const body = ui.stack([
      ui.field("プロダクト", f.productId),
      ui.field("バージョン / 名称", f.version),
      ui.field("ステータス", f.status),
      ui.field("予定日", f.plannedDate),
      ui.field("実施日", f.actualDate),
      ui.field("メモ", f.note),
    ]);

    const actions = [];
    if (!isNew) {
      actions.push({ label: "削除", variant: "btn-danger", onClick: (close) => MK.ui.confirm("このリリースを削除しますか？").then((ok) => { if (ok) { L().removeRelease(rel.id); close(); render(); } }) });
    }
    actions.push({ label: "キャンセル", variant: "btn-secondary", onClick: (close) => close() });
    actions.push({ label: "保存", variant: "btn-primary", onClick: (close) => {
      const version = f.version.value.trim();
      if (!version) { MK.ui.toast("バージョン / 名称を入力してください", "error"); return; }
      const attrs = {
        productId: f.productId.value, version, status: f.status.value,
        plannedDate: f.plannedDate.value, actualDate: f.actualDate.value, note: f.note.value,
      };
      if (isNew) L().addRelease(attrs); else L().updateRelease(rel.id, attrs);
      close(); render();
    } });

    MK.ui.modal({ title: isNew ? "リリースを追加" : "リリースを編集", body, actions });
  }

  MK.registerModule("releases", {
    title: "リリース",
    icon: "🚀",
    description: "リリースの予定と実績を管理する",
    mount(container) { root = el("div"); container.appendChild(root); render(); },
    unmount() { root = null; },
    summary() { return L().summary(); },
    exportData() { return L().exportData(); },
    importData(data, mode) { L().importData(data, mode); },
    loadSample() { L().loadSample(); },
  });
})();
