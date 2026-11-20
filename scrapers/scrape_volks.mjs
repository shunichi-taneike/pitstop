// ステーキハウス フォルクスの駐車場あり店舗を公式サイトから取得し、
// 他チェーンと同じ列構成の CSV / GeoJSON / KML に出力する。
//
// 都道府県別の店舗一覧 (www.volks-steak.jp/shop_list.html?pref=13) の
// 「施設/実施内容」アイコンに「駐車場」がある店舗を抽出し、
// 緯度経度は各店舗の詳細ページに埋め込まれた Google マップ（!2d 経度 !3d 緯度）から取る。
//
// 使い方: node scrapers/scrape_volks.mjs
// 出力:   stores/volks/tokyo_parking.{csv,geojson,kml}
import { cityOf, httpGet, mapsUrl, nfkc, outPath, run, sleep, sortBy, squash, stripTags, writeOutputs } from "./export_util.mjs";

const BASE = "https://www.volks-steak.jp/";
const PREF_CODE = "13", PREFECTURE = "東京都";
const CHAIN = "フォルクス";
const WAIT_SEC = 1;

// 一覧の 1 行（<tr>…</tr>）から店舗情報を取り出す
function parseRow(tr) {
  const name = tr.match(/<td class="shoplist_name"><a href="shop_detail\.html\?snum=(\d+)">(.*?)<\/a>/s);
  if (!name) return null;
  const tds = [...tr.matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map((m) => m[1]);
  // 列: 店舗名 / 予約 / 住所・TEL / 営業時間 / 分煙情報 / 施設 / テイクアウト・宅配
  const [address, phone = ""] = stripTags(tds[2], "\n").split("\n").map((s) => s.trim()).filter(Boolean);
  // 行頭の記号は店舗により「◆」「・」が混在するので除き、途中の「◆」は区切りにする
  const hours = squash(stripTags(tds[3], " ")).replace(/^[◆・･]\s*/, "").replace(/\s*◆\s*/g, " / ");
  const alts = (html) => [...(html ?? "").matchAll(/alt="([^"]+)"/g)].map((m) => m[1]);
  return {
    snum: name[1],
    name: stripTags(name[2]).trim(),
    address: nfkc(address).replace(/－/g, "-"),
    phone: nfkc(phone),
    hours: nfkc(hours),
    icons: alts(tds[5]),
    delivery: alts(tds[6]),
  };
}

async function main() {
  const listUrl = `${BASE}shop_list.html?pref=${PREF_CODE}`;
  // コメントアウトされた古いリンク等を誤って拾わないよう、先に HTML コメントを除く
  const html = (await httpGet(listUrl)).replace(/<!--.*?-->/gs, "");
  const shops = [...html.matchAll(/<tr>(.*?)<\/tr>/gs)].map((m) => parseRow(m[1])).filter(Boolean);
  const parking = shops.filter((s) => s.icons.includes("駐車場"));
  console.log(`${PREFECTURE}: ${CHAIN}全${shops.length}店舗のうち駐車場あり${parking.length}店舗。詳細ページで位置を取得します…`);

  const rows = [];
  for (const [i, s] of parking.entries()) {
    await sleep(WAIT_SEC);
    const url = `${BASE}shop_detail.html?snum=${s.snum}`;
    const detail = await httpGet(url, { referer: listUrl });
    const m = detail.match(/maps\/embed\?pb=[^"]*?!2d(-?[\d.]+)!3d(-?[\d.]+)/);
    if (!m) throw new Error(`地図の座標が見つかりません: ${url}`);
    const lng = Number(m[1]), lat = Number(m[2]);
    console.log(`  [${i + 1}/${parking.length}] ${s.name} ${lat},${lng}`);
    rows.push({
      id: `volks_${s.snum}`,
      chain: CHAIN,
      name: `${CHAIN} ${s.name}`,
      prefecture: PREFECTURE,
      city: cityOf(s.address, PREFECTURE),
      postal_code: "", // 公式データに項目なし
      address: s.address,
      phone: s.phone,
      latitude: lat,
      longitude: lng,
      hours: s.hours,
      parking: true,
      is_24h: false,
      drive_thru: false,
      kids_menu: "", // 店舗ごとの公式データなし
      table_seats: "", // 店舗ごとの公式データなし
      takeout_only: false,
      facilities: [...s.icons, ...s.delivery].join(" / "),
      official_url: url,
      google_maps_url: mapsUrl(lat, lng),
    });
  }

  writeOutputs(sortBy(rows, (r) => r.address), outPath("volks"), `${CHAIN} ${PREFECTURE} 駐車場あり店舗`);
}

run(main);
