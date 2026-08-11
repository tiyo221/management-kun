/* モジュール releases — ビュー（描画・イベント）。計算/CRUD は MK.logic.releases に委譲。CONVENTIONS §1 */
(function () {
  "use strict";
  const MK = window.MK;
  const el = MK.util.el;
  const ui = MK.ui;
  const L = () => MK.logic.releases;
  // MK.ui.removeWithUndo（§2.5-3 の定型）へ渡す削除・復元の口。logic 側は削除できたか／復元できたかを
  // boolean で返す契約なので、そのまま噛み合う。
  const undoApi = () => ({ remove: (id) => L().removeRelease(id), undoRemove: () => L().undoDelete() });

  let root = null;
  let productId = "all";
  let status = "all";
  let listHost = null;             // 一覧の器（行単位の部分更新の対象。全再描画は render()）
  const badges = ui.countBadges(); // ステータスタブの件数バッジ（行操作後に数字だけ差し替える・#299）

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

    listHost = ui.card([], { flush: true });
    renderList(listHost);

    root.appendChild(ui.stack([bar, filterBar, tabsBar, listHost]));
  }

  function pill(label, key, count) {
    const b = el("button", { class: "pill-tab" + (status === key ? " active" : "") }, [label + " ", badges.make(key, count)]);
    b.addEventListener("click", () => { status = key; render(); });
    return b;
  }

  // 行が消えて0件になったら空状態を出す（listHost だけの更新＝スクロールは飛ばない）
  function ensureNotEmpty() {
    if (listHost && !listHost.querySelector(".mk-row")) renderList(listHost);
  }

  // 行内の変更後の後始末: 件数バッジを更新し、この行が今のプロダクトフィルタ／ステータスタブから
  // 外れたら取り除く。タブ切替・フィルタ変更のような「画面の意味が変わる操作」は render() でよいが、
  // インライン編集・ステータス変更は行だけ触る（CONVENTIONS §2.5-4）。
  function afterRowChange(row, id) {
    badges.refresh(L().counts(productId));
    if (!L().timeline(productId, status).some((x) => x.id === id)) { row.remove(); ensureNotEmpty(); }
  }

  function renderList(host) {
    host.innerHTML = "";
    const list = L().timeline(productId, status);
    if (!list.length) { host.appendChild(ui.emptyState(emptyMessage())); return; }
    const ul = el("ul", { class: "mk-list" });
    list.forEach((r) => ul.appendChild(itemRow(r)));
    host.appendChild(ul);
  }

  // 「まだ無い」と「絞り込んだ結果0件」を区別する。ステータスを行内 select で変えるとその行が
  // 今のタブから外れて0件になる経路（afterRowChange → ensureNotEmpty）が増えたため、一律
  // 「リリースがありません」だと、消えたのではなく最初から無いように読めてしまう。
  function emptyMessage() {
    if (!L().counts("all").all) return "リリースがありません。「リリースを追加」から登録してください。";
    return "条件に合うリリースはありません";
  }

  function itemRow(r) {
    const row = el("li", { class: "mk-row mk-row-dense" });
    const date = L().effectiveDate(r);

    // ステータスは select が示すので chip では出さない（同じ情報を二重に置かない）
    const meta = [];
    meta.push(el("span", { class: "chip", text: "📦 " + (L().productName(r) || "（削除済みプロダクト）") }));
    if (r.plannedDate) meta.push(el("span", { class: "sub", text: "予定 " + r.plannedDate }));
    if (r.actualDate) meta.push(el("span", { class: "sub", text: "実施 " + r.actualDate }));
    if (r.note) meta.push(el("span", { class: "sub", text: r.note }));

    // バージョン / 名称はインライン編集（Enter/blur 確定・Esc 取消。CONVENTIONS §2.5-2）。
    // 表記ゆれを直すために6項目のモーダルを開かせない。
    const versionEdit = ui.inlineEdit({
      value: r.version,
      onCommit: (next) => {
        if (!next) { MK.ui.toast("バージョン / 名称を入力してください", "error"); return false; } // 空は拒否＝元値へ
        if (!L().updateRelease(r.id, { version: next })) return rejectStale(); // 消えていたら元値へ＋画面を合わせ直す
        r.version = next; // logic が同じオブジェクトを更新済みで今は冗長。store のキャッシュ共有に
                          // 依存せず、削除トーストが旧名を出さないようにする防御
        return true; // 並びは effectiveDate 順で、名称では並べ替えないため行はその場に留まる（§2.5-4）
      },
    });

    const title = el("div", {}, [
      el("span", { class: "sub", text: (date || "日付未定") + "　" }),
      versionEdit,
    ]);
    const grow = el("div", { class: "grow" }, [title, el("div", { class: "sub" }, meta)]);

    // ステータスは行内 select。予定→完了と転がしていくのが運用中に最も繰り返す操作なので、
    // モーダルの3番目の欄に埋めない（CONVENTIONS §2.5-2）。
    const statusSel = ui.select(L().STATUSES.map((s) => ({ value: s.key, label: s.label })), r.status, (v) => {
      if (!L().updateRelease(r.id, { status: v })) { rejectStale(); return; }
      r.status = v;
      // 表示日（effectiveDate）は予定日／実施日から決まるのでステータスでは動かない。
      // ステータスタブで絞り込み中なら、外れた行を取り除いて件数バッジを更新する。
      afterRowChange(row, r.id);
    });
    statusSel.classList.add("mk-row-control", "mk-row-select");
    statusSel.title = "ステータスを変更";

    // バージョンのクリックはインライン編集が取るため、モーダルへの導線は明示のボタンにする。
    const editBtn = ui.button("編集", { variant: "btn-ghost", title: "まとめて編集（プロダクト・バージョン / 名称・ステータス・予定日・実施日・メモ）", onClick: () => openEditor(r) });

    [grow, statusSel, editBtn].forEach((n) => row.appendChild(n));
    return row;
  }

  // 掴んだ行の実体が別経路（CSV 取込・JSON 取込・同一タブの別画面での削除）で消えていたときの応答。
  // 無言で元値へ戻すと「なぜか編集が効かない行」に見えるので、消えた事実を伝えて画面をストアへ
  // 合わせ直す。onCommit へそのまま返せるよう false を返す。
  function rejectStale() { MK.ui.toast("このリリースは見つかりません（削除された可能性があります）", "info"); render(); return false; }

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
      // 削除は確認を挟まず即実行し、取り消しトーストを出す（CONVENTIONS §2.5-3）。先にモーダルを
      // 閉じてから出す（モーダルの裏にトーストが隠れないように）。
      actions.push({ label: "削除", variant: "btn-danger", onClick: (close) => {
        close();
        MK.ui.removeWithUndo(undoApi(), rel.id, "「" + rel.version + "」を削除しました", render);
      } });
    }
    actions.push({ label: "キャンセル", variant: "btn-secondary", onClick: (close) => close() });
    actions.push({ label: "保存", variant: "btn-primary", onClick: (close) => {
      const version = f.version.value.trim();
      if (!version) { MK.ui.toast("バージョン / 名称を入力してください", "error"); return; }
      const attrs = {
        productId: f.productId.value, version, status: f.status.value,
        plannedDate: f.plannedDate.value, actualDate: f.actualDate.value, note: f.note.value,
      };
      const saved = isNew ? L().addRelease(attrs) : L().updateRelease(rel.id, attrs);
      // addRelease が null を返すのは productId が空のときだけ（version は直上で検証済み）。プロダクト
      // 0件では「リリースを追加」自体を止めているので実際には到達しないが、必須不足で黙って閉じない防御。
      if (isNew && !saved) { MK.ui.toast("プロダクトを選択してください", "error"); return; }
      close();
      if (!saved) { rejectStale(); return; } // 編集中に別経路で消えていた（行内編集と同じ応答にする）
      // 保存した1件が絞り込みから外れるなら、絞り込みをその1件へ寄せてから描き直す
      // （CONVENTIONS §2.5-2）。releases は techstack / questions と違い**投入先がモーダルで選べる**
      // ので、寄せ先は固定値ではなく「保存した値」になる。寄せないと、「予定」タブを開いたまま
      // 完了で追加した／別プロダクトへ付け替えた行が、保存できているのに一覧から消える。
      // **寄せるのは実際に弾いている軸だけ**。両方を書き換えると、「全プロダクト」で開いていた人が
      // ステータス違いで追加しただけで1プロダクトへ絞り込まれ、他プロダクトの行が黙って消える。
      if (!L().timeline(productId, status).some((x) => x.id === saved.id)) {
        if (productId !== "all" && productId !== saved.productId) productId = saved.productId;
        if (status !== "all" && status !== saved.status) status = saved.status;
      }
      render();
    } });

    MK.ui.modal({ title: isNew ? "リリースを追加" : "リリースを編集", body, actions });
  }

  MK.registerModule("releases", {
    title: "リリース",
    icon: "🚀",
    description: "リリースの予定と実績を管理する",
    mount(container) { root = el("div"); container.appendChild(root); render(); },
    // listHost / バッジとも手放す。残すと、モジュールを切り替えたあとに blur で確定したインライン編集が
    // 消えた行を踏んで rejectStale() → render() へ抜け、画面に無い器・デタッチ済みのバッジへ書き込む
    // （ステータス変更 → afterRowChange → ensureNotEmpty も同じ器を触る）。
    unmount() { root = null; listHost = null; badges.clear(); },
    summary() { return L().summary(); },
    searchItems() { return L().searchItems(); },
    exportData() { return L().exportData(); },
    importData(data, mode) { L().importData(data, mode); },
    loadSample() { L().loadSample(); },
  });
})();
