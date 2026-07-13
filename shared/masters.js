/* 共有マスタ CRUD ファクトリ（Issue #185）spec §4.4.1（マスタ共通契約）。
   People / Project / Product / Allocation / Demand の5マスタで完全に重複していた CRUD 骨格
   （data / persist / all / get / create / update / remove / replaceAll と、名寄せの
   resolve / resolveOrCreate）を1か所へ集約する。`store.collection`（#139）・`renderMaster`（#138）
   と同じ「同型は共通化・固有だけ差し込む」方針の延長。各マスタファイルは固有メソッド
   （products の正規化・timestamps・counts、allocations/demands の集計純関数、CSV 等）だけを
   define() の戻り値へ足す。DOM 非依存。 */
(function () {
  "use strict";
  const MK = window.MK;

  // 登録済み共有マスタのレジストリ（Issue #187）。define() が呼ばれるたびに
  // { key, api } を読込順（people→projects→products→allocations→demands）で積む。
  // io.js のエンベロープ入出力はこの配列を1ループで舐めることで、マスタの手書き列挙
  // （scope ゼロ化5行・取込5ブロック）を畳む。key は ns（＝エンベロープのプロパティ名）。
  // 未ロードのマスタは define() されないので配列に載らず、取り回しから自然に外れる
  // （旧 `MK.products && …` ガードと同じ「無ければ触らない」を担保する）。
  const registry = [];

  /**
   * 共有マスタの CRUD 骨格を組み立てて返す。
   * @param {string} ns - ストア名前空間（`mk:<ns>:v1`。複数形小文字。例 "people"）。
   * @param {Object} opts
   * @param {string} opts.collKey - ルート配列プロパティ名（例 "members" / "projects"）。
   * @param {string} opts.prefix - id 採番プレフィックス（§4.7。例 "m" / "p" / "prod"）。
   * @param {string} [opts.domain=ns] - `masters:changed` の domain ペイロード（既定は ns）。
   * @param {number} [opts.version=1] - 既定データの schema バージョン。
   * @param {Object|Function} [opts.defaults] - create の既定属性（id を除く）。関数なら都度評価
   *   （createdAt/updatedAt のように呼び出し時刻へ依存する既定に使う）。
   * @param {Function} [opts.onCreate] - `(item) => void`。create の保存前フック（正規化）。
   * @param {Function} [opts.onUpdate] - `(item, patch) => void`。update の Object.assign 後・保存前フック。
   * @param {Function} [opts.onReplace] - `(item) => item`。replaceAll で各要素に適用する整形。
   * @param {boolean} [opts.resolvable] - true のとき名寄せ resolve / resolveOrCreate を生やす
   *   （name 必須マスタ＝people/projects/products のみ。参照で成立する allocations/demands には生やさない）。
   * @returns {Object} マスタ API（固有メソッドは呼び出し側が追記する）。
   */
  function define(ns, opts) {
    opts = opts || {};
    const collKey = opts.collKey;
    const prefix = opts.prefix;
    const domain = opts.domain || ns;
    const version = opts.version == null ? 1 : opts.version;
    const makeDefaults = typeof opts.defaults === "function"
      ? opts.defaults
      : function () { return Object.assign({}, opts.defaults); };
    const onCreate = opts.onCreate;
    const onUpdate = opts.onUpdate;
    const onReplace = opts.onReplace;

    // store 読取→配列検証→既定 { version, [collKey]: [] } 返却（各マスタで同一だった data()）。
    function data() {
      const d = MK.store.read(ns);
      if (d && Array.isArray(d[collKey])) return d;
      const init = { version };
      init[collKey] = [];
      return init;
    }
    // store 保存＋変更通知（§4.4.1 A。localStorage は直接触らず必ず store 経由）。
    function persist(d) {
      MK.store.write(ns, d);
      MK.bus.emit("masters:changed", { domain });
    }

    const api = {
      all() { return data()[collKey].slice(); },
      get(id) { return data()[collKey].find((x) => x.id === id) || null; },

      create(attrs) {
        const d = data();
        const item = Object.assign({ id: MK.util.uid(prefix) }, makeDefaults(), attrs || {});
        if (!item.id) item.id = MK.util.uid(prefix);
        if (onCreate) onCreate(item);
        d[collKey].push(item);
        persist(d);
        return item;
      },

      update(id, patch) {
        const d = data();
        const item = d[collKey].find((x) => x.id === id);
        if (!item) return null;
        Object.assign(item, patch);
        if (onUpdate) onUpdate(item, patch || {});
        persist(d);
        return item;
      },

      remove(id) {
        const d = data();
        d[collKey] = d[collKey].filter((x) => x.id !== id);
        persist(d);
      },

      replaceAll(list) {
        let arr = Array.isArray(list) ? list : [];
        if (onReplace) arr = arr.map(onReplace);
        const out = { version };
        out[collKey] = arr;
        persist(out);
      },
    };

    // 名寄せ（§8.3 / §8.4）。name を持つマスタだけに生やす（参照で成立するマスタには生やさない）。
    if (opts.resolvable) {
      api.resolve = function (name) {
        const key = MK.util.normalizeKey(name);
        if (!key) return null;
        return data()[collKey].find((x) => MK.util.normalizeKey(x.name) === key) || null;
      };
      api.resolveOrCreate = function (name) {
        if (!name || !String(name).trim()) return null; // 空名は null（§8.4）
        const found = this.resolve(name);
        if (found) return found.id;
        return this.create({ name: String(name).trim() }).id;
      };
    }

    registry.push({ key: ns, api });
    return api;
  }

  MK.masters = { define, registry };
})();
