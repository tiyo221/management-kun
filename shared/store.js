/* localStorage 永続化・マイグレーション spec §4.1 / §4.5 / §10.1 */
(function () {
  "use strict";
  const MK = window.MK;

  const SCHEMA_VERSION = 1;

  function keyOf(ns) { return "mk:" + ns + ":v1"; }

  const store = {
    SCHEMA_VERSION,
    keyOf,
    _cache: {},   // ns -> object | null
    errors: [],   // 破損キーの記録

    // 起動時に全 mk: キーを個別 try/parse（壊れても他へ波及させない・§10.1）
    load() {
      this.errors = [];
      const namespaces = ["people", "projects", "allocations", "settings"];
      Object.keys(MK.modules).forEach((id) => namespaces.push("module:" + id));
      namespaces.forEach((ns) => {
        const raw = localStorage.getItem(keyOf(ns));
        if (raw == null) { this._cache[ns] = null; return; }
        try {
          this._cache[ns] = this._migrate(ns, JSON.parse(raw));
        } catch (e) {
          this._cache[ns] = null;
          this.errors.push({ ns, key: keyOf(ns), message: String(e) });
          console.error("破損データ:", keyOf(ns), e);
        }
      });
    },

    // ns ごとのマイグレーション連鎖を昇順適用（§4.5）
    _migrate(ns, data) {
      const chain = MK.migrations[ns] || [];
      let cur = data;
      chain.forEach((step) => {
        const v = cur && cur.version ? cur.version : 1;
        if (v < step.to) { cur = step.up(cur); cur.version = step.to; }
      });
      return cur;
    },

    // 起動時の load() は既知モジュールの "module:<id>" のみ prewarm する。scoped の
    // 対象別キー "module:<id>:<targetId>"（§3.7.4）は対象が実行時に決まるため、キャッシュ
    // 未登録なら localStorage から遅延ロードする（破損は §10.1 と同じく個別に握りつぶす）。
    read(ns) {
      if (ns in this._cache) return this._cache[ns];
      const raw = localStorage.getItem(keyOf(ns));
      if (raw == null) { this._cache[ns] = null; return null; }
      try {
        this._cache[ns] = this._migrate(ns, JSON.parse(raw));
      } catch (e) {
        this._cache[ns] = null;
        this.errors.push({ ns, key: keyOf(ns), message: String(e) });
        console.error("破損データ:", keyOf(ns), e);
      }
      return this._cache[ns];
    },

    write(ns, value) {
      this._cache[ns] = value;
      try {
        localStorage.setItem(keyOf(ns), JSON.stringify(value));
      } catch (e) {
        console.error("保存失敗:", keyOf(ns), e);
        if (MK.ui) MK.ui.toast("保存に失敗しました: " + ns, "error");
      }
    },

    // モジュール用スコープアクセサ（自分の名前空間のみ・spec §3.5）
    scope(ns) {
      const self = this;
      return {
        get() { return self.read(ns); },
        set(value) { self.write(ns, value); },
      };
    },
  };

  MK.store = store;
})();
