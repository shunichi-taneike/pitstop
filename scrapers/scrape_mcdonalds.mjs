// マクドナルドの駐車場あり店舗を公式店舗検索 (map.mcdonalds.co.jp) から取得し、
// 他チェーンと同じ列構成の CSV / GeoJSON / KML に出力する。
//
// 店舗検索ページが内部で使う /api/poi?bounds=... を東京都を囲む範囲で取得し
// （取りこぼし防止のため 4 分割して取得・統合）、住所が東京都で始まり
// condition_values の「駐車場あり」が 1 の店舗を抽出する。
// 営業時間・電話番号・郵便番号・駐車台数は各店舗の詳細ページから取得する。
//
// 使い方: node scrapers/scrape_mcdonalds.mjs
// 出力:   stores/mcdonalds/tokyo_parking.{csv,geojson,kml}
import { cityOf, httpGet, httpGetJson, mapsUrl, nfkc, outPath, run, sleep, sortBy, squash, stripTags, writeOutputs } from "./export_util.mjs";

const BASE = "https://map.mcdonalds.co.jp";
const PREFECTURE = "東京都";
const WAIT_SEC = 1;
// 東京都（本土部）を囲む範囲を 4 分割（south, west, north, east）
const TILES = ["35.40,138.90,35.675,139.425", "35.40,139.425,35.675,139.95",
  "35.675,138.90,35.95,139.425", "35.675,139.425,35.95,139.95"];

/** 検索ページの絞り込み項目（data-index は 1 始まり）→ condition_values の添字 */
async function conditionLabels() {
  const page = await httpGet(BASE + "/");
  const re = /<li data-index="(\d+)">\s*<div class="icon[^"]*"><\/div>\s*<div class="switch[^"]*"><\/div>\s*<div class="condition">([^<]*)<\/div>/g;
  const labels = new Map();
  for (const m of page.matchAll(re)) labels.set(m[2].trim(), Number(m[1]) - 1);
  return labels;
}

const text = (s) => squash(stripTags(s));

async function main() {
  const labels = await conditionLabels();
  if (!labels.has("駐車場あり")) throw new Error(`絞り込み項目に「駐車場あり」が見つかりません: ${[...labels.keys()]}`);
  const pois = new Map();
  for (const b of TILES) {
    await sleep(WAIT_SEC);
    for (const p of await httpGetJson(`${BASE}/api/poi?bounds=${b}`, { referer: BASE + "/" })) pois.set(p.id, p);
  }
  const tokyo = [...pois.values()].filter((p) => nfkc(p.address).startsWith(PREFECTURE));
  const parking = tokyo.filter((p) => p.condition_values[labels.get("駐車場あり")] === 1);
  console.log(`${PREFECTURE}: 全${tokyo.length}店舗中 駐車場あり ${parking.length}店舗。詳細を取得します…`);

  const rows = [];
  for (const [i, p] of sortBy(parking, (x) => x.key).entries()) {
    await sleep(WAIT_SEC);
    const url = `${BASE}/map/${p.key}`;
    const page = await httpGet(url);
    const cv = p.condition_values;
    const on = [...labels].filter(([, idx]) => idx < cv.length && cv[idx] === 1).map(([label]) => label);
    const spaces = page.match(/<div class="spec parking">.*?<span class="value">([^<]*)<\/span>/s);
    const zipM = page.match(/<li class="postalCode">.*?<span class="text">([^<]*)<\/span>/s);
    const telM = page.match(/<li class="phone">.*?<span class="text">(.*?)<\/span>/s);
    // 営業時間表: 行（平日/土曜/休日）× 列（店内/ドライブスルー/…）。店内の列を使う
    const hours = [...page.matchAll(/<tr>\s*<th>([^<]+)<\/th>\s*<td[^>]*>(.*?)<\/td>/gs)]
      .map((r) => `${text(r[1])} ${text(r[2]).replaceAll("〜", "-")}`);
    const facilities = on.filter((x) => x !== "駐車場あり");
    facilities.push("駐車場" + (spaces && !["", "0"].includes(spaces[1]) ? ` ${spaces[1]}台` : ""));
    const address = nfkc(p.address).trim();
    const lat = p.latitude, lng = p.longitude;
    rows.push({
      id: `mcd_${p.key}`,
      chain: "マクドナルド",
      name: `マクドナルド ${p.name}`,
      prefecture: PREFECTURE,
      city: cityOf(address, PREFECTURE),
      postal_code: zipM ? text(zipM[1]) : "",
      address,
      phone: telM ? text(telM[1]) : "",
      latitude: lat,
      longitude: lng,
      hours: hours.join(" / "),
      parking: true,
      is_24h: on.includes("24時間営業"),
      drive_thru: on.includes("ドライブスルー"),
      kids_menu: "", // 公式データに項目なし（ハッピーセットは全店共通のため）
      table_seats: "", // 公式データに項目なし
      takeout_only: "", // 公式データに項目なし
      facilities: facilities.join(" / "),
      official_url: url,
      google_maps_url: mapsUrl(lat, lng),
    });
    console.log(`  [${i + 1}/${parking.length}] ${rows.at(-1).name}`);
  }

  writeOutputs(sortBy(rows, (r) => r.address), outPath("mcdonalds"), `マクドナルド ${PREFECTURE} 駐車場あり店舗`);
}

run(main);
