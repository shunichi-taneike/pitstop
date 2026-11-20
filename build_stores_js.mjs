// stores/<chain>/ 以下のデータから地図ページ用の stores.js を生成する。
//
// 各チェーンのフォルダ構成:
//   stores/<chain>/meta.json               {"chain": 表示名, "color": ボタン色, "order": 並び順}
//   stores/<chain>/icon.(png|svg)          地図ピン・一覧のアイコン
//   stores/<chain>/<pref>_parking.geojson  取得スクリプト（scrapers/）の出力
//
// 新しいチェーンはフォルダを追加するだけで地図に反映される（このスクリプトの変更は不要）。
//
// 使い方: node build_stores_js.mjs
// 出力:   stores.js（window.CHAINS と window.STORES）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const STORES_DIR = path.join(ROOT, "stores");
const DST = path.join(ROOT, "stores.js");

// 公式データに項目がない場合は空文字 → false 扱い
const asBool = (v) => v === true || v === "TRUE";
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function loadChains() {
  const chains = [];
  for (const name of fs.readdirSync(STORES_DIR)) {
    const metaPath = path.join(STORES_DIR, name, "meta.json");
    if (fs.existsSync(metaPath)) chains.push({ folder: path.join(STORES_DIR, name), name, meta: readJson(metaPath) });
  }
  return chains.sort((a, b) => (a.meta.order ?? 9999) - (b.meta.order ?? 9999) || cmp(a.name, b.name));
}

function main() {
  const chainsJs = {}, stores = [];
  for (const { folder, name, meta } of loadChains()) {
    const files = fs.readdirSync(folder).sort(cmp);
    const icon = files.find((f) => f.startsWith("icon."));
    if (!icon) throw new Error(`アイコンがありません: ${folder}/icon.(png|svg)`);
    chainsJs[meta.chain] = { icon: `stores/${name}/${icon}`, color: meta.color };

    let count = 0;
    for (const src of files.filter((f) => f.endsWith("_parking.geojson"))) {
      const geo = readJson(path.join(folder, src));
      for (const f of geo.features) {
        const p = f.properties;
        if (p.chain !== meta.chain) {
          throw new Error(`${name}/${src}: chain が meta.json と一致しません（${p.chain} != ${meta.chain}）`);
        }
        const [lng, lat] = f.geometry.coordinates;
        stores.push({
          id: p.id,
          chain: p.chain,
          name: p.name,
          city: p.city,
          address: p.address,
          phone: p.phone,
          hours: p.hours,
          lat,
          lng,
          is_24h: asBool(p.is_24h),
          drive_thru: asBool(p.drive_thru),
          kids_menu: asBool(p.kids_menu),
          table_seats: asBool(p.table_seats),
          facilities: p.facilities || "",
          url: p.official_url,
        });
        count++;
      }
    }
    console.log(`${name.padEnd(12)} ${meta.chain}: ${count} stores`);
  }

  fs.writeFileSync(DST,
    "// build_stores_js.mjs で生成。直接編集しないこと。\n"
    + "window.CHAINS = " + JSON.stringify(chainsJs, null, 1) + ";\n"
    + "window.STORES = " + JSON.stringify(stores, null, 1) + ";\n", "utf8");
  console.log(`total ${Object.keys(chainsJs).length} chains / ${stores.length} stores -> stores.js`);
}

main();
