// デニーズの駐車場あり店舗を公式店舗検索 (shop.dennys.jp) から取得し、
// 他チェーンと同じ列構成の CSV / GeoJSON / KML に出力する。
//
// 店舗検索ページが内部で使う /api/point/{geohash}/ を、東京都をカバーする
// geohash（xn6, xn7）について取得し、住所が「東京都」で始まり
// 「駐車場あり」= 1 の店舗を抽出する。
//
// 使い方: node scrapers/scrape_dennys.mjs
// 出力:   stores/dennys/tokyo_parking.{csv,geojson,kml}
import { cityOf, httpGetJson, mapsUrl, outPath, run, sleep, sortBy, writeOutputs } from "./export_util.mjs";

const API = (gh) => `https://shop.dennys.jp/api/point/${gh}/`;
const DETAIL = (key) => `https://shop.dennys.jp/map/${key}/`;
const PREFECTURE = "東京都";
const GEOHASHES = ["xn6", "xn7"]; // 東京都（本土部）をカバーする 3 桁 geohash
const WAIT_SEC = 1;

const DAYS = [["月曜日", "月"], ["火曜日", "火"], ["水曜日", "水"], ["木曜日", "木"],
  ["金曜日", "金"], ["土曜日", "土"], ["日曜日", "日"]];
// facilities 列に出す設備フラグ（値が "1" のもの）
const FACILITY_KEYS = ["24時間営業", "ドリンクバー", "出前サービス", "コンセント", "Wi-Fi", "全席禁煙",
  "パーティールームまたは個室あり", "ベビーシート", "だれでもトイレ", "車椅子対応の入り口", "EV充電器"];

function cleanName(name) {
  // 「デニーズ 浅草国際通り店　※11月26日(木)は…」のような告知文を除去
  name = name.split(/[※＊]/)[0];
  return name.replaceAll("　", " ").replace(/\s+/g, " ").trim();
}

async function main() {
  const items = new Map();
  for (const [i, gh] of GEOHASHES.entries()) {
    if (i) await sleep(WAIT_SEC);
    const d = await httpGetJson(API(gh), { referer: "https://shop.dennys.jp/" });
    for (const p of d.items) items.set(p.id, p);
  }
  const tokyo = [...items.values()].filter((p) => p.address.startsWith(PREFECTURE));
  const parking = tokyo.filter((p) => (p.extra_fields || {})["駐車場あり"] === "1");
  const unknown = tokyo.filter((p) => (p.extra_fields || {})["駐車場あり"] == null);
  console.log(`${PREFECTURE}: 全${tokyo.length}店舗中 駐車場あり ${parking.length}店舗（駐車場情報なし ${unknown.length}店舗は除外）`);

  const rows = sortBy(parking, (p) => p.address).map((p) => {
    const ef = p.extra_fields;
    const lat = p.latitude, lng = p.longitude;
    const hours = DAYS.map(([k, lbl]) => `${lbl} ${ef[k + "の営業時間"] || "-"}`).join(" / ");
    const facilities = FACILITY_KEYS.filter((k) => ef[k] === "1");
    facilities.push("駐車場" + (ef["駐車場台数"] ? ` ${ef["駐車場台数"]}` : ""));
    return {
      id: `dny_${p.key}`,
      chain: "デニーズ",
      name: cleanName(p.name),
      prefecture: PREFECTURE,
      city: cityOf(p.address, PREFECTURE),
      postal_code: ef["郵便番号"] || "",
      address: p.address.trim(),
      phone: ef["電話番号"] || "",
      latitude: lat,
      longitude: lng,
      hours,
      parking: true,
      is_24h: ef["24時間営業"] === "1",
      drive_thru: "", // 公式データに項目なし
      kids_menu: "", // 公式データに項目なし
      table_seats: "", // 公式データに項目なし
      takeout_only: "", // 公式データに項目なし
      facilities: facilities.join(" / "),
      official_url: DETAIL(p.key),
      google_maps_url: mapsUrl(lat, lng),
    };
  });

  writeOutputs(rows, outPath("dennys"), `デニーズ ${PREFECTURE} 駐車場あり店舗`);
}

run(main);
