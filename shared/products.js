/* プロダクト管理（Product マスタ）spec §4.4 / Issue #37。
   将来 §3.7 の Product スコープ次元のマスタ（dimensions[].master === "products"）になる「器」。
   People / Project とは別ドメインの横断マスタで、シェルレベルの「マスタ」グループに置く（§3.6 / §6.4）。
   本ファイルは DOM 非依存の純ストア／整形ロジック（people.js / projects.js と同格）。 */
(function () {
  "use strict";
  const MK = window.MK;
  const NS = "products";

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

  function data() {
    const d = MK.store.read(NS);
    if (!d || !Array.isArray(d.products)) return { version: 1, products: [] };
    return d;
  }
  function persist(d) {
    MK.store.write(NS, d);
    MK.bus.emit("masters:changed", { domain: "products" });
  }

  /**
   * プロダクトマスタ API。将来 Product 次元のエンティティ供給元（scope.master）にもなる。
   * id 体系は `prod_<epoch>_<rand>`（§4.7）で、将来 `mk:module:<id>:<productId>:v1` の targetId になりうる。
   */
  const products = {
    STATUSES,
    normalizeStatus,
    normalizeProjectIds,

    /** @returns {object[]} 全プロダクトの複製配列 */
    all() { return data().products.slice(); },
    /** @param {string} id @returns {object|null} 一致するプロダクト、無ければ null */
    get(id) { return data().products.find((p) => p.id === id) || null; },

    /**
     * ステータス別および全体の件数を集計する。
     * @returns {Object.<string, number>} `all` と各ステータスキーの件数マップ
     */
    counts() {
      const c = { all: 0 };
      STATUSES.forEach((s) => (c[s.key] = 0));
      data().products.forEach((p) => { c.all++; c[p.status] = (c[p.status] || 0) + 1; });
      return c;
    },

    /**
     * プロダクトを1件作成して保存する。status は正規化する。
     * @param {Object} [attrs] - 上書きする初期属性
     * @returns {object} 作成したプロダクト
     * ※ store へ保存する副作用あり。
     */
    create(attrs) {
      const d = data();
      const now = MK.util.nowISO();
      const p = Object.assign(
        { id: MK.util.uid("prod"), name: "", status: "planned", owner: "", summary: "", repo: "", tags: [], projectIds: [], createdAt: now, updatedAt: now },
        attrs || {}
      );
      if (!p.id) p.id = MK.util.uid("prod");
      p.status = normalizeStatus(p.status);
      p.projectIds = normalizeProjectIds(p.projectIds);
      d.products.push(p);
      persist(d);
      return p;
    },

    /**
     * 指定プロダクトを部分更新して保存する（updatedAt を現在時刻で更新、status は正規化）。
     * @param {string} id - 対象 id
     * @param {Object} patch - 上書きするフィールド
     * @returns {object|null} 更新後のプロダクト、該当なしなら null
     * ※ store へ保存する副作用あり。
     */
    update(id, patch) {
      const d = data();
      const p = d.products.find((x) => x.id === id);
      if (!p) return null;
      Object.assign(p, patch);
      if (Object.prototype.hasOwnProperty.call(patch, "status")) p.status = normalizeStatus(patch.status);
      if (Object.prototype.hasOwnProperty.call(patch, "projectIds")) p.projectIds = normalizeProjectIds(patch.projectIds);
      p.updatedAt = MK.util.nowISO();
      persist(d);
      return p;
    },

    /**
     * 指定プロダクトを削除して保存する。
     * @param {string} id - 対象 id
     * @returns {void}
     * ※ store へ保存する副作用あり。
     */
    remove(id) {
      const d = data();
      d.products = d.products.filter((p) => p.id !== id);
      persist(d);
    },

    /**
     * 名寄せ（spec §8.3）。プロダクト名の正規化キー完全一致で引く。
     * @param {string} name
     * @returns {object|null}
     */
    resolve(name) {
      const key = MK.util.normalizeKey(name);
      if (!key) return null;
      return data().products.find((p) => MK.util.normalizeKey(p.name) === key) || null;
    },
    /**
     * 完全一致がなければ新規作成して id を返す（spec §8.4）。将来 Product 次元の対象解決に使う。
     * @param {string} name
     * @returns {string|null} プロダクト id（空名は null）
     */
    resolveOrCreate(name) {
      if (!name || !String(name).trim()) return null;
      const found = this.resolve(name);
      if (found) return found.id;
      return this.create({ name: String(name).trim() }).id;
    },

    /**
     * 全プロダクトを置き換えて保存する（バックアップ復元・CSV 取込用）。
     * @param {object[]} list
     * @returns {void}
     * ※ store へ保存する副作用あり（全置換）。
     */
    replaceAll(list) {
      const products = (Array.isArray(list) ? list : []).map((p) => Object.assign({}, p, { projectIds: normalizeProjectIds(p.projectIds) }));
      persist({ version: 1, products: products });
    },

    /**
     * projectIds のうち、存在しない Project 参照を除いた配列を返す（Project 削除後の表示用ガード）。
     * @param {object} p - プロダクト
     * @returns {object[]} 存在する Project の配列
     */
    relatedProjects(p) {
      return normalizeProjectIds(p && p.projectIds).map((id) => MK.projects.get(id)).filter(Boolean);
    },

    // ---- CSV（DOM 非依存の純整形/取込。ファイル選択・DL はシェルの view 側）----
    /**
     * プロダクトをCSV行データ（ヘッダ＋各行）に整形する。
     * @returns {string[][]} 2次元配列のCSV行データ
     */
    buildCSVRows() {
      const rows = [["プロダクト名", "ステータス", "責任者", "概要", "リポジトリ", "タグ", "関連プロジェクト"]];
      this.all().forEach((p) => rows.push([
        p.name, p.status, p.owner || "", p.summary || "", p.repo || "", (p.tags || []).join(" "),
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
      const list = body.map((r) => ({
        id: MK.util.uid("prod"), name: (r[0] || "").trim(), status: statusFromCSV(r[1]),
        owner: (r[2] || "").trim(), summary: (r[3] || "").trim(), repo: (r[4] || "").trim(),
        tags: (r[5] || "").split(/[\s,]+/).map((t) => t.trim()).filter(Boolean),
        projectIds: (r[6] || "").split(/[\s,]+/).map((t) => t.trim()).filter(Boolean).map((n) => MK.projects.resolveOrCreate(n)).filter(Boolean),
        createdAt: now, updatedAt: now,
      }));
      this.replaceAll(list);
      return list.length;
    },
  };

  MK.products = products;
})();
