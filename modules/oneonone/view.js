/* モジュール oneonone（1on1メモ）— ビュー（描画・イベント）。業務計算は MK.logic.oneonone に委譲。CONVENTIONS §1
   メンバーを選び、その人の 1on1 タイムライン（新しい順）と未完アクションを俯瞰する（Issue #33）。
   メンバー参照は MK.people 経由。マスタは書き換えない。マスタ変更（masters:changed）で再描画する。 */
(function () {
  "use strict";
  const MK = window.MK;
  const el = MK.util.el;
  const ui = MK.ui;
  const L = () => MK.logic.oneonone;

  let root = null;
  let selectedMemberId = null;

  // 選択肢に載せるメンバー: アクティブなメンバー＋（非アクティブでも）記録が残るメンバー。
  // 退職者でも過去ログを閲覧できるようにしつつ、通常はアクティブのみが並ぶ（Issue #33 の配慮）。
  function pickerMembers() {
    const all = MK.people.all();
    const byId = {};
    all.forEach((m) => (byId[m.id] = m));
    const referenced = {};
    L().entries().forEach((e) => (referenced[e.memberId] = true));
    const list = all.filter((m) => m.active !== false || referenced[m.id]);
    // 記録があるのにマスタから消えた（参照切れ）メンバーもプレースホルダで残す（堅牢性）。
    Object.keys(referenced).forEach((id) => { if (!byId[id]) list.push({ id, name: "(不明なメンバー)", active: false, _missing: true }); });
    return list;
  }

  function memberName(id) {
    const m = MK.people.get(id);
    if (m) return m.name || "(無名)";
    return "(不明なメンバー)";
  }

  function render() {
    if (!root) return;
    root.innerHTML = "";
    root.appendChild(ui.sectionTitle("1on1"));

    const members = pickerMembers();
    if (!members.length) {
      root.appendChild(ui.emptyState("メンバーがいません。「人」マスタで追加してください。"));
      return;
    }

    // 選択の維持（削除・退職で消えたら先頭へ）
    if (!selectedMemberId || !members.some((m) => m.id === selectedMemberId)) selectedMemberId = members[0].id;

    root.appendChild(ui.stack([toolbar(members), timelineCard(), actionsCard()]));
  }

  function toolbar(members) {
    const bar = ui.toolbar([]);
    const picker = ui.select(
      members.map((m) => ({ value: m.id, label: m.name + (m.active === false ? "（退職）" : "") })),
      selectedMemberId,
      (v) => { selectedMemberId = v; render(); }
    );
    picker.style.maxWidth = "240px";
    bar.appendChild(ui.field("メンバー", picker));
    bar.appendChild(ui.button("＋ 1on1 を記録", { variant: "btn-primary", onClick: () => openEditor(null) }));
    // CSV（メンバー名寄せ・アクションは1セル複数行）
    bar.appendChild(ui.button("CSV出力", { onClick: () => { MK.io.downloadText("oneonone-" + MK.util.todayISO().replace(/-/g, "") + ".csv", MK.io.csv.stringify(L().buildCSVRows()), "text/csv"); MK.ui.toast("1on1 CSV を書き出しました", "success"); } }));
    bar.appendChild(ui.button("CSV取込", { onClick: () => MK.io.pickCsvFile((rows) => { const r = L().applyCSV(rows); render(); MK.ui.toast("取込 " + r.ok + " 件" + (r.skip ? " / スキップ " + r.skip + " 件" : ""), r.skip ? "info" : "success"); }) }));
    return bar;
  }

  // ---- 未完アクション（選択メンバー） ----
  function actionsCard() {
    const open = L().openActionsOf(selectedMemberId);
    const head = el("h3", { text: "未完アクション（" + open.length + "）" });
    if (!open.length) return ui.card([head, ui.emptyState("未完のアクションはありません")]);
    const ul = el("ul", { class: "mk-list" });
    open.forEach(({ entry, action }) => ul.appendChild(actionRow(entry, action)));
    return ui.card([head, ul]);
  }

  function actionRow(entry, action) {
    const cb = ui.checkbox(action.done);
    cb.addEventListener("change", () => { L().toggleAction(entry.id, action.id); render(); });
    const meta = [el("span", { class: "sub", text: entry.date })];
    if (action.due) meta.push(el("span", { class: "chip", text: "〜" + action.due }));
    const info = el("div", { class: "grow" }, [
      el("div", { text: action.text }),
      el("div", { class: "sub" }, meta),
    ]);
    return el("li", { class: "mk-row" }, [cb, info]);
  }

  // ---- タイムライン（選択メンバー） ----
  function timelineCard() {
    const list = L().entriesOf(selectedMemberId);
    const last = L().lastDateOf(selectedMemberId);
    const head = el("h3", { text: memberName(selectedMemberId) + " の 1on1" + (last ? "（最終 " + last + "）" : "") });
    if (!list.length) return ui.card([head, ui.emptyState("まだ記録がありません。「＋ 1on1 を記録」から追加してください。")]);
    const ul = el("ul", { class: "mk-list" });
    list.forEach((e) => ul.appendChild(entryRow(e)));
    return ui.card([head, ul]);
  }

  function moodLabel(key) { const m = L().MOODS.find((x) => x.key === key); return m ? m.label : null; }

  function entryRow(e) {
    const meta = [el("span", { class: "chip", text: e.date })];
    const ml = moodLabel(e.mood);
    if (ml) meta.push(el("span", { class: "chip", text: ml }));
    const openN = (e.actions || []).filter((a) => !a.done).length;
    if (e.actions && e.actions.length) meta.push(el("span", { class: "sub", text: "アクション " + openN + "/" + e.actions.length + " 未完" }));

    const bodyPreview = (e.body || "").split("\n")[0] || "（本文なし）";
    const grow = el("div", { class: "grow", style: "cursor:pointer;" }, [
      el("div", { text: bodyPreview }),
      el("div", { class: "sub" }, meta),
    ]);
    grow.addEventListener("click", () => openEditor(e));
    return el("li", { class: "mk-row" }, [grow]);
  }

  // ---- エントリ編集モーダル ----
  function openEditor(entry) {
    const isNew = !entry;
    const f = {};
    f.date = ui.input({ type: "date", value: entry ? entry.date : MK.util.todayISO() });
    f.body = ui.textarea(entry ? entry.body : "");
    f.mood = ui.select(
      [{ value: "", label: "（未設定）" }].concat(L().MOODS.map((m) => ({ value: m.key, label: m.label }))),
      entry ? (entry.mood || "") : ""
    );

    // アクション編集エリア（追加・削除可能な行の集合）
    const actionsHost = el("div", { class: "mk-stack" });
    const rows = []; // { id, textEl, doneEl, dueEl, wrap }
    function addActionRow(a) {
      a = a || {};
      const textEl = ui.input({ value: a.text || "", placeholder: "ネクストアクション" });
      const doneEl = ui.checkbox(a.done);
      const dueEl = ui.input({ type: "date", value: a.due || "" });
      dueEl.style.maxWidth = "160px";
      const rec = { id: a.id || null, textEl, doneEl, dueEl };
      const del = ui.button("削除", { variant: "btn-ghost", onClick: () => { rec.removed = true; wrap.remove(); } });
      const wrap = el("div", { class: "mk-row" }, [doneEl, textEl, dueEl, del]);
      rec.wrap = wrap;
      rows.push(rec);
      actionsHost.appendChild(wrap);
    }
    ((entry && entry.actions) || []).forEach(addActionRow);
    const addBtn = ui.button("＋ アクション追加", { variant: "btn-secondary", onClick: () => addActionRow(null) });

    function collectActions() {
      return rows.filter((r) => !r.removed).map((r) => ({
        id: r.id, text: r.textEl.value, done: r.doneEl.checked, due: r.dueEl.value || null,
      }));
    }

    const body = ui.stack([
      ui.field("実施日", f.date),
      ui.field("話したこと", f.body),
      ui.field("温度感", f.mood),
      ui.field("ネクストアクション", el("div", { class: "mk-stack" }, [actionsHost, addBtn])),
    ]);

    const actions = [];
    if (!isNew) actions.push({ label: "削除", variant: "btn-danger", onClick: (close) => MK.ui.confirm("この 1on1 記録を削除しますか？").then((ok) => { if (ok) { L().removeEntry(entry.id); close(); render(); } }) });
    actions.push({ label: "キャンセル", variant: "btn-secondary", onClick: (close) => close() });
    actions.push({ label: "保存", variant: "btn-primary", onClick: (close) => {
      const date = f.date.value || MK.util.todayISO();
      const patch = { date, body: f.body.value, mood: f.mood.value || null, actions: collectActions() };
      if (isNew) L().addEntry(Object.assign({ memberId: selectedMemberId }, patch));
      else L().updateEntry(entry.id, patch);
      close();
      render();
    } });

    MK.ui.modal({ title: isNew ? "1on1 を記録" : "1on1 を編集", body, actions });
  }

  // マスタ変更（人の追加・退職・削除）で選択肢と表示名が変わるため再描画する。
  MK.bus.on("masters:changed", () => { if (root) render(); });

  MK.registerModule("oneonone", {
    title: "1on1",
    icon: "🗣",
    description: "1on1の記録を残して振り返る",
    mount(container) { root = el("div"); container.appendChild(root); render(); },
    unmount() { root = null; },
    summary() { return L().summary(); },
    summaryFor(entityType, id) { return L().summaryFor(entityType, id); },
    exportData() { return L().exportData(); },
    importData(data, mode) { L().importData(data, mode); },
    loadSample() { L().loadSample(); },
  });
})();
