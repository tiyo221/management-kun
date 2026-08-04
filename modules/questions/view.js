/* モジュール questions — ビュー（描画・イベント）。業務計算は MK.logic.questions に委譲。CONVENTIONS §1 */
(function () {
  "use strict";
  const MK = window.MK;
  const el = MK.util.el;
  const ui = MK.ui;
  const L = () => MK.logic.questions;

  let root = null;
  let filter = "open";
  let search = "";
  let listHost = null;             // 一覧の器（行単位の部分更新の対象。全再描画は render()）
  const badges = ui.countBadges(); // ステータスタブの件数バッジ（行操作後に数字だけ差し替える・#299）

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
    // 2軸: 未解決/調査中=バックログ、わかった=解決した全部（集約）、ナレッジ=そのうち答えありの部分集合
    L().STATUSES.forEach((s) => tabsBar.appendChild(pill(s.label, s.key, c[s.key])));
    tabsBar.appendChild(pill("ナレッジ", "knowledge", c.knowledge));
    const searchBox = ui.input({ placeholder: "検索…（タイトル・詳細・タグ・答え）", value: search });
    searchBox.style.maxWidth = "220px";
    searchBox.addEventListener("input", () => { search = searchBox.value; renderList(listHost); });
    tabsBar.appendChild(searchBox);

    listHost = ui.card([], { flush: true });
    renderList(listHost);

    root.appendChild(ui.stack([capture, bar, tabsBar, listHost]));
  }

  function pill(label, key, count) {
    const b = el("button", { class: "pill-tab" + (filter === key ? " active" : "") }, [label + " ", badges.make(key, count)]);
    b.addEventListener("click", () => { filter = key; render(); });
    return b;
  }

  // 現在のタブ・検索での一覧。renderList と「その行が残るか」の判定で同じものを見る
  // （ナレッジタブだけ別の絞り込みなので、2か所に分けて書くとずれる）。
  function currentList() { return filter === "knowledge" ? L().knowledge(search) : L().filtered(filter, search); }

  // 行が消えて0件になったら空状態を出す（listHost だけの更新＝スクロールは飛ばない）。
  // ナレッジは .mk-row ではなく .mk-know-card で描くので、両方を見て「行が無い」を判定する。
  function ensureNotEmpty() {
    if (listHost && !listHost.querySelector(".mk-row, .mk-know-card")) renderList(listHost);
  }

  // 行内の変更後の後始末: 件数バッジを更新し、この行が今のタブ／検索から外れたら取り除く。
  // タブ切替・取込のような「画面の意味が変わる操作」は render() でよいが、インライン編集・
  // ステータス変更は行だけ触る（CONVENTIONS §2.5-4）。
  function afterRowChange(row, id) {
    badges.refresh(L().counts());
    if (!currentList().some((x) => x.id === id)) { row.remove(); ensureNotEmpty(); }
  }

  // 行を作り直して差し替える。ステータス変更は見た目の種類まで変えうるので必要 ──
  // 答えのある項目を resolved にすると itemRow は Q→A のナレッジカードを返す（別レイアウト）。
  function rebuildRow(row, id) {
    const it = L().items().find((x) => x.id === id);
    if (!it) { row.remove(); badges.refresh(L().counts()); ensureNotEmpty(); return; }
    const fresh = itemRow(it);
    row.replaceWith(fresh);
    afterRowChange(fresh, id);
  }

  function renderList(host) {
    host.innerHTML = "";
    const list = currentList();
    if (!list.length) {
      host.appendChild(ui.emptyState(emptyMessage()));
      return;
    }
    // 「わかった」ビューは達成ログ。何件をナレッジ化できているかを一目で出す（2軸の可視化）。
    // 検索中は絞り込み結果と全体件数がズレて紛らわしいので出さない。
    if (filter === "resolved" && !search) {
      const c = L().counts();
      host.appendChild(el("div", { class: "mk-know-progress sub", text: "ナレッジ化 " + c.knowledge + " / " + c.resolved }));
    }
    const ul = el("ul", { class: "mk-list" });
    list.forEach((it) => ul.appendChild(itemRow(it)));
    host.appendChild(ul);
  }

  // 「まだ無い」と「絞り込んだ結果0件」を区別する。ステータスを行内 select で変えると
  // その行が今のタブから外れて0件になる経路（afterRowChange → ensureNotEmpty）が増えたため、
  // 一律「わからないことはありません」だと、消えたのではなく最初から無いように読めてしまう。
  function emptyMessage() {
    if (search) return "条件に合うものはありません";
    if (filter === "knowledge") return "ナレッジはまだありません。解決した質問に答えを残すとここに貯まります";
    if (filter === "resolved") return "まだ「わかった」はありません";
    if (filter !== "all" && L().counts().all) return "このステータスのものはありません";
    return "わからないことはありません";
  }

  function itemRow(it) {
    // 答えありの解決済み＝ナレッジは Q→A カードで描く（取り消し線は使わない）
    if (L().isKnowledge(it)) return knowledgeCard(it);

    const row = el("li", { class: "mk-row mk-row-dense" });

    // タイトル（インライン編集。Enter/blur 確定・Esc 取消。CONVENTIONS §2.5-2）
    const titleEdit = ui.inlineEdit({
      value: it.title,
      onCommit: (next) => {
        if (!next) { MK.ui.toast("わからないことを入力してください", "error"); return false; } // 空は拒否＝元値へ
        L().updateItem(it.id, { title: next });
        it.title = next; // 行が握るのは描画時のスナップショット。削除トーストが旧題を出さないよう揃える
        afterRowChange(row, it.id); // 検索中はタイトル変更で一致から外れうる
        return true;
      },
    });

    // ステータスは行内 select。わからないことを未解決→調査中→わかったと転がしていくのが
    // このモジュールの主眼なので、モーダルの3番目の欄に埋めない（CONVENTIONS §2.5-2）。
    const statusSel = ui.select(L().STATUSES.map((s) => ({ value: s.key, label: s.label })), it.status, (v) => {
      L().updateItem(it.id, { status: v });
      it.status = v;
      // 答えのある項目を resolved にすると描き方がナレッジカードへ変わるので、行ごと作り直す。
      rebuildRow(row, it.id);
    });
    statusSel.classList.add("mk-row-control", "mk-row-select");
    statusSel.title = "ステータスを変更";

    // ステータスは select が示しているので chip では出さない（同じ情報を二重に置かない）。
    const meta = (it.tags || []).map((t) => el("span", { class: "chip", text: "#" + t }));
    const grow = el("div", { class: "grow" }, [titleEdit, meta.length ? el("div", { class: "sub" }, meta) : null]);

    // タイトルのクリックはインライン編集が取るため、モーダルへの導線は明示のボタンにする。
    const editBtn = ui.button("編集", { variant: "btn-ghost", title: "背景・メモ・タグ・答えを編集" });
    editBtn.addEventListener("click", () => openEditor(it));

    // 未解決／調査中：解決＝ナレッジ化の導線。答えなしで閉じた resolved は「答えを書く」で昇格させる
    const cta = it.status === "resolved" ? "答えを書く" : "解決";
    [grow, statusSel, editBtn, ui.button(cta, { onClick: () => openResolve(it) })].forEach((n) => row.appendChild(n));
    return row;
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

  // 解決＝「わかった」に移す。答えは任意。書けば即ナレッジ（→ナレッジタブ）、空ならキャプチャ待ちの
  // わかった（→わかったタブ）。答え必須はナレッジ化の定義側（isKnowledge）で担保し、入口では強制しない。
  function openResolve(it) {
    const note = ui.textarea(it.resolvedNote || "");
    MK.ui.modal({
      title: "解決する",
      body: ui.stack([
        el("div", { class: "sub", text: it.title }),
        ui.field("答え（書くとナレッジになる。空でもOK・あとで書ける）", note),
      ]),
      actions: [
        { label: "キャンセル", variant: "btn-secondary", onClick: (close) => close() },
        { label: "解決にする", variant: "btn-primary", onClick: (close) => {
            const v = note.value.trim();
            L().resolve(it.id, v);
            search = ""; // 遷移先で新しい項目が絞り込みに埋もれないようリセット
            if (v) { filter = "knowledge"; MK.ui.toast("ナレッジに追加しました", "success"); }
            else { filter = "resolved"; MK.ui.toast("「わかった」に移しました。あとで答えを書けます", "success"); }
            close(); render();
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
        // 先にモーダルを閉じてから削除＋取り消しトースト（確認は挟まない・CONVENTIONS §2.5-3。
        // モーダルの裏にトーストが隠れないよう閉じる方を先にする）。
        { label: "削除", variant: "btn-danger", onClick: (close) => {
          close();
          MK.ui.removeWithUndo(
            { remove: (id) => L().removeItem(id), undoRemove: () => L().undoDelete() },
            it.id,
            "「" + (it.title || "無題") + "」を削除しました",
            render
          );
        } },
        { label: "キャンセル", variant: "btn-secondary", onClick: (close) => close() },
        { label: "保存", variant: "btn-primary", onClick: (close) => {
            const title = f.title.value.trim();
            if (!title) { MK.ui.toast("わからないことを入力してください", "error"); return; }
            L().updateItem(it.id, {
              title, detail: f.detail.value, status: f.status.value,
              tags: f.tags.value.split(",").map((s) => s.trim()).filter(Boolean),
              resolvedNote: f.resolvedNote.value.trim(), // resolve() 経由と保存形を揃える
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
    // listHost / バッジとも手放す。残すと、インライン編集中にモジュールを切り替えたときに
    // blur の確定が afterRowChange を通り、画面に無い器やデタッチ済みのバッジへ書き込む。
    unmount() { root = null; listHost = null; badges.clear(); },
    summary() { return L().summary(); },
    searchItems() { return L().searchItems(); },
    exportData() { return L().exportData(); },
    importData(data, mode) { L().importData(data, mode); },
    loadSample() { L().loadSample(); },
  });
})();
