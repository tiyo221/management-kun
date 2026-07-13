/* プロダクト管理（Product マスタ）spec §4.4 / Issue #37。
   将来 §3.7 の Product スコープ次元のマスタ（dimensions[].master === "products"）になる「器」。
   People / Project とは別ドメインの横断マスタで、シェルレベルの「マスタ」グループに置く（§3.6 / §6.4）。
   本ファイルは DOM 非依存の純ストア／整形ロジック（people.js / projects.js と同格）。 */
(function () {
  "use strict";
  const MK = window.MK;

  /**
   * プロダクトの状態（ステータス）定義。key＝内部値、label＝表示名。表示順もこの配列順に従う。
   * @typedef {Object} Status
   * @property {string} key - 内部キー（"planned" | "active" | "maintenance" | "sunset"）
   * @property {string} label - 画面表示名
   */
  const STATUSES = [
    { key: "planned", label: "計画中（Planned）" },
    { key: "active", label: "稼働中（Active）" },
    { key: "maintenance", label: "保守（Maintenance）" },
    { key: "sunset", label: "終息（Sunset）" },
  ];
  const STATUS_KEYS = STATUSES.map((s) => s.key);

  /**
   * status を正規化する（未知・未指定は "planned" に寄せる）。
   * @param {string} status - ステータスキー候補
   * @returns {string} 正規化したステータスキー
   */
  function normalizeStatus(status) {
    const s = String(status == null ? "" : status).trim().toLowerCase();
    return STATUS_KEYS.indexOf(s) >= 0 ? s : "planned";
  }

  /**
   * projectIds を正規化する（配列以外は空配列、要素は文字列化して重複除去）。
   * 存在しない Project id もここでは弾かない（Project 削除後の破綻防止は表示側で MK.projects.get のガードにより行う）。
   * @param {*} ids
   * @returns {string[]}
   */
  function normalizeProjectIds(ids) {
    if (!Array.isArray(ids)) return [];
    const seen = {};
    const out = [];
    ids.forEach((id) => {
      const s = String(id == null ? "" : id).trim();
      if (!s || seen[s]) return;
      seen[s] = true;
      out.push(s);
    });
    return out;
  }

  /**
   * ownerId を正規化する（空・未指定は null に寄せる）。People 側の実在チェックはしない
   * （削除後も id を保持し、表示側の `ownerPerson` がガードする。§4.4 Product / Issue #56）。
   * @param {*} id
   * @returns {string|null}
   */
  function normalizeOwnerId(id) {
    const s = String(id == null ? "" : id).trim();
    return s || null;
  }

  // CRUD 骨格・名寄せ（resolve/resolveOrCreate）は共通ファクトリから供給する（Issue #185・spec §4.4.1）。
  // products 固有の正規化（status/projectIds/ownerId）と createdAt/updatedAt は保存前フックで差し込み、
  // counts/relatedProjects/ownerPerson/移行/CSV は下で Object.assign する。id 体系は `prod_<epoch>_<rand>`
  // （§4.7）で、将来 Product 次元のエンティティ供給元（scope.master）・`mk:module:<id>:<productId>:v1` の
  // targetId になりうる。
  const products = MK.masters.define("products", {
    collKey: "products",
    prefix: "prod",
    resolvable: true,
    // createdAt/updatedAt は生成時刻に依存するため関数で都度評価する。
    defaults: function () {
      const now = MK.util.nowISO();
      return { name: "", status: "planned", owner: "", ownerId: null, summary: "", repo: "", tags: [], projectIds: [], createdAt: now, updatedAt: now };
    },
    // create 時の正規化（status/projectIds/ownerId を既定へ寄せる）。
    onCreate: function (p) {
      p.status = normalizeStatus(p.status);
      p.projectIds = normalizeProjectIds(p.projectIds);
      p.ownerId = normalizeOwnerId(p.ownerId);
    },
    // update 時は patch に含まれるキーだけ正規化し、updatedAt を現在時刻で更新する。
    onUpdate: function (p, patch) {
      if (Object.prototype.hasOwnProperty.call(patch, "status")) p.status = normalizeStatus(patch.status);
      if (Object.prototype.hasOwnProperty.call(patch, "projectIds")) p.projectIds = normalizeProjectIds(patch.projectIds);
      if (Object.prototype.hasOwnProperty.call(patch, "ownerId")) p.ownerId = normalizeOwnerId(patch.ownerId);
      p.updatedAt = MK.util.nowISO();
    },
    // replaceAll（バックアップ復元・CSV 取込）時は projectIds/ownerId のみ正規化する（従来どおり）。
    onReplace: function (p) {
      return Object.assign({}, p, { projectIds: normalizeProjectIds(p.projectIds), ownerId: normalizeOwnerId(p.ownerId) });
    },
  });

  Object.assign(products, {
    STATUSES,
    normalizeStatus,
    normalizeProjectIds,

    /**
     * ステータス別および全体の件数を集計する。
     * @returns {Object.<string, number>} `all` と各ステータスキーの件数マップ
     */
    counts() {
      const c = { all: 0 };
      STATUSES.forEach((s) => (c[s.key] = 0));
      this.all().forEach((p) => { c.all++; c[p.status] = (c[p.status] || 0) + 1; });
      return c;
    },

    /**
     * projectIds のうち、存在しない Project 参照を除いた配列を返す（Project 削除後の表示用ガード）。
     * @param {object} p - プロダクト
     * @returns {object[]} 存在する Project の配列
     */
    relatedProjects(p) {
      return normalizeProjectIds(p && p.projectIds).map((id) => MK.projects.get(id)).filter(Boolean);
    },

    /**
     * 責任者（People 参照）を返す。未設定・削除済み参照は null（表示側の破綻防止・Issue #56）。
     * @param {object} p - プロダクト
     * @returns {object|null} People メンバー、無ければ null
     */
    ownerPerson(p) {
      const id = p && p.ownerId;
      return id ? MK.people.get(id) : null;
    },

    /**
     * 旧・自由文字列 `owner` を People マスタへ一度だけ名寄せ移行する（`ownerId` 未設定のもののみ対象）。
     * 同名の既存 People があれば集約、無ければ新規作成（`resolveOrCreate`・spec §8.4）。冪等。
     * @returns {number} 移行した件数
     * ※ store へ保存する副作用あり（対象が1件以上ある場合のみ）。
     */
    migrateOwnerToPeople() {
      const list = this.all();
      let moved = 0;
      list.forEach((p) => {
        if (p.ownerId || !p.owner || !String(p.owner).trim()) return;
        p.ownerId = MK.people.resolveOrCreate(p.owner);
        moved++;
      });
      if (moved) this.replaceAll(list); // 保存＋masters:changed 発火は replaceAll に一任
      return moved;
    },

    // ---- CSV（DOM 非依存の純整形/取込。ファイル選択・DL はシェルの view 側）----
    /**
     * プロダクトをCSV行データ（ヘッダ＋各行）に整形する。
     * @returns {string[][]} 2次元配列のCSV行データ
     */
    buildCSVRows() {
      const rows = [["プロダクト名", "ステータス", "責任者", "概要", "リポジトリ", "タグ", "関連プロジェクト"]];
      this.all().forEach((p) => rows.push([
        p.name, p.status, (this.ownerPerson(p) || {}).name || "", p.summary || "", p.repo || "", (p.tags || []).join(" "),
        this.relatedProjects(p).map((proj) => proj.name).join(" "),
      ]));
      return rows;
    },
    /**
     * CSV行データからプロダクトを取り込み、全置換して保存する。プロダクト名が空の行はスキップする。
     * ステータスは key（planned 等）または日本語ラベル先頭語（計画/稼働/保守/終息）を受け付け、
     * 不明なら "planned" に寄せる。タグは空白またはカンマ区切り。
     * 関連プロジェクトは空白/カンマ区切りの名前で、`MK.projects.resolveOrCreate` により id 解決（未登録名は新規作成）。
     * @param {string[][]} rows - CSV行データ（1行目はヘッダ）
     * @returns {number} 取り込んだ件数
     * ※ store へ保存する副作用あり（全置換）。
     */
    applyCSV(rows) {
      const statusFromCSV = (v) => {
        const s = String(v == null ? "" : v).trim();
        const byLabel = { "計画": "planned", "稼働": "active", "保守": "maintenance", "終息": "sunset" };
        if (byLabel[s]) return byLabel[s];
        return normalizeStatus(s);
      };
      const now = MK.util.nowISO();
      const body = rows.slice(1).filter((r) => r.length >= 1 && (r[0] || "").trim());
      const list = body.map((r) => {
        const ownerName = (r[2] || "").trim();
        return {
          id: MK.util.uid("prod"), name: (r[0] || "").trim(), status: statusFromCSV(r[1]),
          ownerId: ownerName ? MK.people.resolveOrCreate(ownerName) : null,
          summary: (r[3] || "").trim(), repo: (r[4] || "").trim(),
          tags: (r[5] || "").split(/[\s,]+/).map((t) => t.trim()).filter(Boolean),
          projectIds: (r[6] || "").split(/[\s,]+/).map((t) => t.trim()).filter(Boolean).map((n) => MK.projects.resolveOrCreate(n)).filter(Boolean),
          createdAt: now, updatedAt: now,
        };
      });
      this.replaceAll(list);
      return list.length;
    },
  });

  MK.products = products;
})();
