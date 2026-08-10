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
  let timelineNode = null; // タイムラインカード（部分更新でカードごと差し替える対象・CONVENTIONS §2.5-4）

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

    timelineNode = timelineCard();
    root.appendChild(ui.stack([toolbar(members), timelineNode, actionsCard()]));
  }

  // 記録の削除（確認なし＋取り消しトースト・CONVENTIONS §2.5-3）。
  // ピッカーは「記録があるメンバー」しか非アクティブを載せないため、退職者の最後の1件を消すと
  // 選択が別人へ飛ぶ。復元しても選択が戻らないと、戻した記録が画面に出ない ── 削除直後に
  // 自動選択されたメンバーがまだ選ばれているときだけ、元のメンバーへ選択を戻す（goals と同じ扱い）。
  function removeEntryWithUndo(entry) {
    const wasSelected = selectedMemberId === entry.memberId;
    const removed = L().removeEntry(entry.id);
    render(); // 空振り（既に消えている）でも画面をストアへ合わせ直す
    if (!removed) return; // 空振りでトーストを出すと、その取り消しが別の1件を復元しかねない
    const autoPicked = selectedMemberId; // 削除後の render が選び直したメンバー
    const label = entry.date ? entry.date + " の 1on1 記録" : "1on1 記録"; // date 欠落でも文が崩れない
    MK.ui.undoDeleteToast(label + "を削除しました", () => L().undoDelete(), () => {
      if (wasSelected && selectedMemberId === autoPicked) selectedMemberId = entry.memberId;
      render();
    });
  }

  // タイムラインカードだけを差し替える（未完アクションのチェックで各記録の「アクション N/total 未完」
  // 表示が変わるため。項目数は不変で高さも変わらないのでスクロールは飛ばない）。CONVENTIONS §2.5-4。
  function refreshTimeline() {
    if (!timelineNode) return;
    const fresh = timelineCard();
    timelineNode.replaceWith(fresh);
    timelineNode = fresh;
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
  // このカードは未完（done=false）のアクションだけを並べる。チェックで完了にした行は条件から外れる
  // ので、全再描画せず該当行を除去し件数見出しだけ更新する（行内で完結・CONVENTIONS §2.5-4）。
  function actionsCard() {
    const open = L().openActionsOf(selectedMemberId);
    const head = el("h3", { text: actionsHeadText(open.length) });
    const card = ui.card([head]);
    if (!open.length) { card.appendChild(ui.emptyState("未完のアクションはありません")); return card; }
    const ul = el("ul", { class: "mk-list" });
    open.forEach(({ entry, action }) => ul.appendChild(actionRow(entry, action, head, ul, card)));
    card.appendChild(ul);
    return card;
  }

  function actionsHeadText(n) { return "未完アクション（" + n + "）"; }

  // 掴んだ行の実体が別経路（CSV 取込・JSON 取込・同一タブの別画面での削除）で消えていたときの応答。
  // 無言で元値へ戻すと「なぜか編集が効かない行」に見えるので、消えた事実を伝えて画面をストアへ
  // 合わせ直す（削除の空振りを render で合わせ直す removeEntryWithUndo と同じ扱い）。
  // 文言は「記録が消えた」と「記録は在るがそのアクションだけ消えた」の両方を含むので中立にする
  // ── updateAction はどちらも false で返し、view は区別できない。onCommit へ返せるよう false を返す。
  function rejectStale() { MK.ui.toast("このアクションは見つかりません（記録が更新・削除された可能性があります）", "info"); render(); return false; }

  function actionRow(entry, action, head, ul, card) {
    const meta = [el("span", { class: "sub", text: entry.date })];
    if (action.due) meta.push(el("span", { class: "chip", text: "〜" + action.due }));
    // アクションの文言はインライン編集（Enter/blur 確定・Esc 取消。CONVENTIONS §2.5-2）。このカードは
    // 「いま追いかけている約束」の一覧で微修正の頻度が高いのに、記録編集モーダルの奥にしか手が無かった。
    // 期限（due）と記録本体（実施日・本文・温度感）はモーダル継続。
    const textEdit = ui.inlineEdit({
      value: action.text,
      onCommit: (next) => {
        if (!next) { MK.ui.toast("アクションを入力してください", "error"); return false; } // 空は拒否＝元値へ
        if (!L().updateAction(entry.id, action.id, { text: next })) return rejectStale(); // 消えていたら元値へ＋画面を合わせ直す
        action.text = next; // logic が同じオブジェクトを更新済みで今は冗長。store のキャッシュ共有に
                            // 依存せず、この行を掴んだ後続処理が旧文言を読まないようにする防御
        return true; // 未完のままなので行はこの場に残る。タイムラインの表示（本文冒頭・未完件数）も変わらない
      },
    });
    const info = el("div", { class: "grow" }, [
      textEdit,
      el("div", { class: "sub" }, meta),
    ]);
    const cb = ui.checkbox(action.done);
    const li = el("li", { class: "mk-row" }, [cb, info]);
    cb.addEventListener("change", () => {
      L().toggleAction(entry.id, action.id);
      // 完了にすると未完一覧から外れる → 行を除去し見出しの件数を更新（0件なら空状態へ）。
      const stillOpen = L().openActionsOf(selectedMemberId).some((o) => o.entry.id === entry.id && o.action.id === action.id);
      if (!stillOpen) {
        li.remove();
        const remaining = ul.querySelectorAll(".mk-row").length;
        head.textContent = actionsHeadText(remaining);
        if (!remaining) { ul.remove(); card.appendChild(ui.emptyState("未完のアクションはありません")); }
      }
      refreshTimeline(); // 記録側の「アクション N/total 未完」表示を揃える
    });
    return li;
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
    const grow = el("div", { class: "grow" }, [
      el("div", { text: bodyPreview }),
      el("div", { class: "sub" }, meta),
    ]);
    // モーダルへの導線は明示のボタン（questions / techstack / todo と同じ形・CONVENTIONS §2.5-2）。
    // 行全体クリックは、同じ画面（未完アクションカード）に行内編集口が並んだ時点で誤爆のもとになる。
    const editBtn = ui.button("編集", { variant: "btn-ghost", title: "実施日・話したこと・温度感・アクションを編集", onClick: () => openEditor(e) });
    // 本文プレビュー＋ボタンが並ぶので、375px ではボタンを次の行へ逃がす（.mk-row-dense・§2.2）。
    return el("li", { class: "mk-row mk-row-dense" }, [grow, editBtn]);
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
    // 削除は確認を挟まず即実行し、取り消しトーストを出す（CONVENTIONS §2.5-3）。先にモーダルを
    // 閉じてから出す（モーダルの裏にトーストが隠れないように）。
    if (!isNew) actions.push({ label: "削除", variant: "btn-danger", onClick: (close) => { close(); removeEntryWithUndo(entry); } });
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
    unmount() { root = null; timelineNode = null; },
    summary() { return L().summary(); },
    summaryFor(entityType, id) { return L().summaryFor(entityType, id); },
    searchItems() { return L().searchItems(); },
    exportData() { return L().exportData(); },
    importData(data, mode) { L().importData(data, mode); },
    loadSample() { L().loadSample(); },
  });
})();
