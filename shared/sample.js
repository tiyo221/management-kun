/* サンプルデータ — 動作確認用の初期データ投入。インラインのみ（外部取得なし）spec §3.3 */
(function () {
  "use strict";
  const MK = window.MK;

  const PEOPLE = [
    { name: "佐藤 花子", role: "PM", color: "#5645d4" },
    { name: "鈴木 一郎", role: "エンジニア", color: "#0075de" },
    { name: "田中 美咲", role: "デザイナー", color: "#dd5b00" },
    { name: "高橋 健", role: "エンジニア", color: "#1aae39" },
  ];
  const PROJECTS = [
    { name: "新製品ローンチ", color: "#5645d4" },
    { name: "サイトリニューアル", color: "#0075de" },
    { name: "社内勉強会", color: "#1aae39" },
  ];
  const PRODUCTS = [
    { name: "マネジメントくん", status: "active", owner: "自分", summary: "モジュール型の管理ツール", repo: "github.com/example/mk", tags: ["internal"] },
    { name: "勤怠管理システム", status: "maintenance", owner: "田中 美咲", summary: "社内向け勤怠打刻・集計", tags: ["internal"] },
    { name: "顧客ポータル", status: "active", owner: "佐藤 花子", summary: "契約者向けのセルフサービス画面", tags: ["web"] },
    { name: "次期基盤PoC", status: "planned", owner: "自分", summary: "新アーキ検証用の試作", tags: ["poc"] },
    { name: "旧レポート出力", status: "sunset", summary: "後継へ移行中・段階的に停止", tags: ["legacy"] },
  ];

  MK.sample = {
    // 人・プロジェクトのマスタを投入し、実装済み各モジュールに自分のサンプルを入れさせる
    load() {
      MK.people.replaceAll(PEOPLE.map((p) =>
        Object.assign({ id: MK.util.uid("m"), role: "", color: "", note: "", active: true }, p)));
      MK.projects.replaceAll(PROJECTS.map((p) =>
        Object.assign({ id: MK.util.uid("p"), color: "", status: "active", note: "" }, p)));
      const now = MK.util.nowISO();
      // owner（旧・自由文字列）を People マスタへ名寄せして ownerId を持たせる（人詳細の関連プロダクト集約・#83 が使う）。
      // resolve のみ（新規作成しない）＝ People に居ない owner（"自分" 等）は未設定のまま。
      MK.products.replaceAll(PRODUCTS.map((p) => {
        const owner = p.owner ? MK.people.resolve(p.owner) : null;
        return Object.assign({ id: MK.util.uid("prod"), status: "planned", owner: "", ownerId: owner ? owner.id : null, summary: "", repo: "", tags: [], createdAt: now, updatedAt: now }, p);
      }));
      // 各モジュールが loadSample を持っていれば呼ぶ（projects 投入後なので名寄せが既存に一致する）
      MK.moduleOrder.forEach((id) => {
        const mod = MK.modules[id];
        if (mod && typeof mod.loadSample === "function") mod.loadSample();
      });
    },
  };
})();
