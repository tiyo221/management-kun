/* モジュール dashboard（プロジェクト・ダッシュボード＝横断集約ビュー）— ロジック（集約計算）。DOM/UI に触れない。CONVENTIONS §1
   1つの Project を主語に、マスタ共有している各領域の情報を読み取り専用で集約する（Issue #78）。
   データ源は共有マスタ（MK.projects / MK.allocations / MK.products）と、project-scoped モジュール（wbs）の
   対象別データ。自前の永続データは持たず、編集は各モジュール側で行う（重複実装しない）。 */
(function () {
  "use strict";
  const MK = window.MK;

  /**
   * Project ステータスキーを表示ラベルへ変換する純関数（未知値はキーをそのまま返す）。
   * ラベル定義は projects マスタの公開定義（MK.projects.STATUSES / statusLabel）を単一ソースとする（Issue #105）。
   * @param {string} key - ステータスキー（"active" | "archived"）
   * @returns {string} 表示ラベル
   */
  function projectStatusLabel(key) {
    return MK.projects.statusLabel(key);
  }

  /**
   * 指定 Project の WBS 進捗サマリを集約する（読み取り専用）。データ源は wbs の対象別データ
   * （mk:module:wbs:<projectId>:v1）で、wbs の純関数（isParent）を再利用して葉タスクを判定する。
   * 「今日」に依存する期限超過の判定は基準日を引数で受け取り、決定的テストを可能にする（spec §3.6 / TESTING §1）。
   * @param {string} projectId - 対象プロジェクトのID
   * @param {string} today - 期限超過判定の基準日（YYYY-MM-DD）
   * @returns {{empty: boolean, leaves: number, done: number, inprogress: number, overall: number, overdue: number}}
   *   葉タスク皆無なら empty=true。葉タスク数・完了数・進行中数・平均進捗率(%)・期限超過数（未完かつ終了日が基準日より前）
   */
  function wbsSummary(projectId, today) {
    const W = MK.logic && MK.logic.wbs;
    const tasks = (W && typeof W.exportData === "function" && W.exportData(projectId).tasks) || [];
    // 葉タスク（子を持たないタスク）だけを進捗集計の母数にする（wbs.stats と同じ定義）。
    const leaves = tasks.filter((t, i) => !W.isParent(tasks, i));
    let done = 0, inprogress = 0, sum = 0, overdue = 0;
    leaves.forEach((t) => {
      if (t.status === "done") done++;
      else if (t.status === "inprogress") inprogress++;
      sum += Number(t.progress) || 0;
      // 期限超過＝未完（done 以外）かつ終了日が基準日より前。判定は wbs.isOverdue に単一定義（#181）。
      if (W.isOverdue(t, today)) overdue++;
    });
    return {
      empty: leaves.length === 0,
      leaves: leaves.length,
      done,
      inprogress,
      overall: leaves.length ? Math.round(sum / leaves.length) : 0,
      overdue,
    };
  }

  /**
   * 指定 Project へのアロケーション（供給計画）を集約する（読み取り専用）。データ源は共有マスタ
   * MK.allocations。誰が何%割り当たっているかを、基準日時点で期間内かどうかの active フラグ付きで返す。
   * @param {string} projectId - 対象プロジェクトのID
   * @param {string} today - 期間内判定の基準日（YYYY-MM-DD）
   * @returns {{allocation: Object, member: (Object|null), memberName: string, active: boolean}[]}
   *   アロケーション・対象メンバー（削除済みなら null）・表示名・基準日時点で期間内か
   */
  function allocationsFor(projectId, today) {
    const list = MK.allocations ? MK.allocations.forTarget(projectId) : [];
    return list.map((a) => {
      const member = a.memberId && MK.people ? MK.people.get(a.memberId) : null;
      const active = !!(a.startDate && a.endDate && a.startDate <= today && today <= a.endDate);
      return { allocation: a, member, memberName: member ? member.name : "(不明なメンバー)", active };
    });
  }

  /**
   * 指定 Project に紐づく Product 一覧を集約する（読み取り専用。Product⇄Project の緩い紐付け・Issue #55）。
   * データ源は共有マスタ MK.products の projectIds。
   * @param {string} projectId - 対象プロジェクトのID
   * @returns {Object[]} 紐づく Product レコードの一覧
   */
  function productsFor(projectId) {
    if (!MK.products || typeof MK.products.all !== "function") return [];
    return MK.products.all().filter((p) => (p.projectIds || []).indexOf(projectId) >= 0);
  }

  MK.logic = MK.logic || {};
  MK.logic.dashboard = { projectStatusLabel, wbsSummary, allocationsFor, productsFor };
})();
