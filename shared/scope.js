/* スコープ次元の純ロジック（DOM 非依存）spec §3.7。
   「同種のものを複数持つ／単一で持つ」を統一的に扱うための、次元の解決・縮退モード判定・
   保存 namespace 算出をここに集約する。シェル（shell.js）はこれを使うだけで、コード上で
   "project" を決め打ち分岐しない（config の dimensions 配列を回して汎用に扱う。CONVENTIONS §3）。 */
(function () {
  "use strict";
  const MK = window.MK;

  const scope = {
    /**
     * 設定された次元一覧（MK_CONFIG.dimensions）を返す。未指定なら空配列。
     * 例: [{ dim: "project", label: "プロジェクト", master: "projects" }]（§3.7.6）
     * @returns {{dim:string,label:string,master:string}[]}
     */
    dims() {
      const cfg = window.MK_CONFIG || {};
      return Array.isArray(cfg.dimensions) ? cfg.dimensions : [];
    },

    /**
     * モジュールの scope 属性から対応する次元 config を引く。
     * @param {("global"|{dim:string}|undefined)} scopeAttr - モジュール def の scope（既定 global）
     * @returns {({dim:string,label:string,master:string})|null} scoped ならその次元、global/未知なら null
     */
    dimOf(scopeAttr) {
      if (!scopeAttr || scopeAttr === "global" || !scopeAttr.dim) return null;
      return scope.dims().find((d) => d.dim === scopeAttr.dim) || null;
    },

    /**
     * 次元の参照マスタ API（MK.projects など）を返す。dim.master 名で汎用に引く。
     * @param {{master:string}} dim
     * @returns {object|null} マスタ API（all/get/create 等）。未解決なら null
     */
    master(dim) {
      return (dim && MK[dim.master]) || null;
    },

    /**
     * 次元のエンティティ一覧（マスタの全件）を返す。
     * @param {{master:string}} dim
     * @returns {object[]}
     */
    entities(dim) {
      const m = scope.master(dim);
      return m && typeof m.all === "function" ? m.all() : [];
    },

    /**
     * 要素数から縮退モードを判定する（§3.7.2）。
     *   0   … "empty"  … 「まず対象を作る」導線
     *   1   … "single" … スイッチャを畳む（その1つを直接表示）
     *   2+  … "multi"  … スイッチャ表示・選択中の文脈で描画
     * @param {number} count
     * @returns {"empty"|"single"|"multi"}
     */
    mode(count) {
      if (!count) return "empty";
      return count === 1 ? "single" : "multi";
    },

    /**
     * 「現在の対象」を正規化する。保存済み id が今も存在すればそれ、無ければ先頭、
     * 要素が無ければ null（§3.7.2/3）。
     * @param {{master:string}} dim
     * @param {string|null} storedId - 設定に保存された現在の対象 id
     * @returns {string|null}
     */
    resolveTarget(dim, storedId) {
      const list = scope.entities(dim);
      if (!list.length) return null;
      if (storedId && list.some((e) => e.id === storedId)) return storedId;
      return list[0].id;
    },

    /**
     * モジュールの保存 namespace を算出する（§3.7.4 ハイブリッド）。
     *   global … "module:<id>"                （従来通り）
     *   scoped … "module:<id>:<targetId>"      （対象別。キーは "mk:module:<id>:<targetId>:v1"）
     * targetId 未定（scoped だが対象なし）のときは global 相当にフォールバックする。
     * @param {string} moduleId
     * @param {("global"|{dim:string}|undefined)} scopeAttr
     * @param {string|null} targetId
     * @returns {string}
     */
    storeNsFor(moduleId, scopeAttr, targetId) {
      const dim = scope.dimOf(scopeAttr);
      if (dim && targetId) return "module:" + moduleId + ":" + targetId;
      return "module:" + moduleId;
    },

    /**
     * 既定の対象 id を返す。対象があれば先頭、無ければ既定エンティティをマスタへ作成して返す。
     * 旧データ移行・旧エンベロープ取込のフォールバック（「既定 PJ へ寄せる」§7 / Issue #25）で使う。
     * @param {{master:string,label:string}} dim
     * @returns {string|null} 対象 id（マスタ未解決なら null）
     */
    ensureDefaultTarget(dim) {
      const master = scope.master(dim);
      if (!master || typeof master.all !== "function") return null;
      const list = master.all();
      if (list.length) return list[0].id;
      return master.create({ name: "既定" + (dim.label || "") }).id;
    },

    /**
     * 旧・非スコープ時代の単一キー（mk:module:<id>:v1）を対象別キー
     * （mk:module:<id>:<targetId>:v1）へ移送する（§3.7.4 / §7）。対象別キーが既に存在する場合は
     * 上書きせず、旧キーだけ除去する（冪等＝再実行しても二重移行しない）。
     * @param {string} moduleId
     * @param {string} targetId - 移送先の対象 id
     * @returns {boolean} 旧キーがあり移送（またはクリーンアップ）した場合 true
     */
    migrateLegacyScoped(moduleId, targetId) {
      const legacyKey = MK.store.keyOf("module:" + moduleId);
      const raw = localStorage.getItem(legacyKey);
      if (raw == null) return false;
      const scopedNs = "module:" + moduleId + ":" + targetId;
      // 対象別キーが未作成のときだけ移送する（既存データを潰さない）。
      if (localStorage.getItem(MK.store.keyOf(scopedNs)) == null) {
        localStorage.setItem(MK.store.keyOf(scopedNs), raw);
      }
      localStorage.removeItem(legacyKey);
      // store キャッシュを整合させる（旧 ns は空・新 ns は次回読込でロードし直す）。
      MK.store._cache["module:" + moduleId] = null;
      delete MK.store._cache[scopedNs];
      return true;
    },
  };

  MK.scope = scope;
})();
