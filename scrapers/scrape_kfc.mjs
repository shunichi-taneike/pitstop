// ケンタッキーフライドチキンの駐車場あり店舗を公式店舗検索 (search.kfc.co.jp) から取得し、
// 他チェーンと同じ列構成の CSV / GeoJSON / KML に出力する。
//
// 店舗検索ページが内部で使う /api/points/{geohash} を、東京都をカバーする
// geohash（xn6, xn7）について取得し、都道府県が東京都かつ「パーキング」= 1 の
// 店舗を抽出する。OPEN日 が未来の（未開店の）店舗は除外する。
//
// 使い方: node scrapers/scrape_kfc.mjs
// 出力:   stores/kfc/tokyo_parking.{csv,geojson,kml}
import { httpGetJson, mapsUrl, outPath, run, sleep, sortBy, todayIso, writeOutputs } from "./export_util.mjs";

const API = (gh) => `https://search.kfc.co.jp/api/points/${gh}`;
const REFERER = "https://search.kfc.co.jp/";
const DETAIL = (key) => `https://search.kfc.co.jp/points/${key}`;
const PREFECTURE = "東京都";
const GEOHASHES = ["xn6", "xn7"];
const WAIT_SEC = 1;
const FACILITY_FLAGS = {
  "ドライブスルー": "ドライブスルー", "お届けケンタッキー": "お届けケンタッキー",
  "クレジットカード": "クレジットカード", "電子マネー": "電子マネー", "交通系ICカード": "交通系IC",
  "QRコード決済": "QRコード決済",
};

async function main() {
  const items = new Map();
  for (const [i, gh] of GEOHASHES.entries()) {
    if (i) await sleep(WAIT_SEC);
    for (const p of (await httpGetJson(API(gh), { referer: REFERER })).items) items.set(p.id, p);
  }

  const today = todayIso();
  const tokyo = [...items.values()].filter((p) => p.extra_fields["都道府県"] === PREFECTURE);
  let parking = tokyo.filter((p) => p.extra_fields["パーキング"] === "1");
  const notOpen = parking.filter((p) => (p.extra_fields["OPEN日"] || "").slice(0, 10) > today);
  parking = parking.filter((p) => !notOpen.includes(p));
  console.log(`${PREFECTURE}: 全${tokyo.length}店舗中 駐車場あり ${parking.length}店舗`
    + (notOpen.length ? `（未開店 ${notOpen.length}店舗を除外: ${notOpen.map((p) => p.name).join(", ")}）` : ""));

  const rows = sortBy(parking, (p) => p.address).map((p) => {
    const ef = p.extra_fields;
    const lat = p.latitude, lng = p.longitude;
    const wd = ef["平日営業時間"] || "-", we = ef["土日祝営業時間"] || "-";
    const hours = [..."月火水木金"].map((d) => `${d} ${wd}`).concat(`土・日・祝 ${we}`).join(" / ");
    const facilities = Object.entries(FACILITY_FLAGS).filter(([k]) => ef[k] === "1").map(([, label]) => label);
    facilities.push("駐車場");
    return {
      id: `kfc_${p.key}`,
      chain: "KFC",
      name: `ケンタッキーフライドチキン ${p.name}`,
      prefecture: PREFECTURE,
      city: ef["市区町村"] || "",
      postal_code: ef["郵便番号"] || "",
      address: p.address.trim(),
      phone: ef.tel || "",
      latitude: lat,
      longitude: lng,
      hours,
      parking: true,
      // 24時間営業の項目はないため営業時間から判断
      is_24h: ["0:00-24:00", "00:00-24:00"].includes(wd) && we === wd,
      drive_thru: ef["ドライブスルー"] === "1",
      kids_menu: "", // 公式データに項目なし
      table_seats: "", // 公式データに項目なし
      takeout_only: "", // 公式データに項目なし
      facilities: facilities.join(" / "),
      official_url: DETAIL(p.key),
      google_maps_url: mapsUrl(lat, lng),
    };
  });

  writeOutputs(rows, outPath("kfc"), `KFC ${PREFECTURE} 駐車場あり店舗`);
}

run(main);
