// 叙々苑の駐車場あり店舗を公式サイトから取得し、他チェーンと同じ列構成の CSV / GeoJSON / KML に出力する。
//
// 公式サイトに駐車場の項目はないため、店舗検索 (www.jojoen.co.jp/shopsearch/) に載る各店舗ページの
// 「アクセス」欄に「駐車」の記載がある店舗を駐車場ありとする（専用・無料・提携・入居ビルの駐車場など）。
// 駐車場の条件（無料時間など）は facilities に入れる。
//
// 店舗ページに座標がないため、住所を国土地理院の住所検索 API で座標に変換する（番地レベル）。
//
// 使い方: node scrapers/scrape_jojoen.mjs
// 出力:   stores/jojoen/tokyo_parking.{csv,geojson,kml}
import { cityOf, httpGet, httpGetJson, mapsUrl, nfkc, outPath, run, sleep, sortBy, squash, stripTags, writeOutputs } from "./export_util.mjs";

const BASE = "https://www.jojoen.co.jp";
const PREFECTURE = "東京都";
const CHAIN = "叙々苑";
const WAIT_SEC = 1;
const GSI_URL = "https://msearch.gsi.go.jp/address-search/AddressSearch?q=";

/** 店舗ページの <dt>見出し</dt><dd>本文</dd> を見出し → テキストにする */
function fields(html) {
  const out = {};
  for (const [, dt, dd] of html.matchAll(/<dt>([^<]*)<\/dt>\s*<dd>(.*?)<\/dd>/gs)) {
    out[squash(dt)] ??= nfkc(squash(stripTags(dd.replace(/<br\s*\/?>/gi, " "), " ")));
  }
  return out;
}

async function geocode(address) {
  // 建物名・階数を除いた番地までで検索する
  const q = address.replace(/^(.*?\d+(?:-\d+)*).*$/, "$1");
  const res = await httpGetJson(GSI_URL + encodeURIComponent(q));
  if (!res.length) throw new Error(`座標が見つかりません: ${address}`);
  const [lng, lat] = res[0].geometry.coordinates;
  return [lat, lng];
}

async function main() {
  const searchUrl = `${BASE}/shopsearch/?no=tab1`;
  const search = await httpGet(searchUrl);
  const paths = [...new Set([...search.matchAll(/href="(\/shop\/jojoen\/[^"#?]+?)\/?"/g)].map((m) => m[1]))]
    .filter((p) => !p.endsWith("-bento")); // 弁当販売店は除く
  console.log(`${CHAIN}: 店舗ページ${paths.length}件。東京都の店舗の「アクセス」欄で駐車場の記載を確認します…`);

  const rows = [];
  let tokyo = 0;
  for (const p of paths) {
    await sleep(WAIT_SEC);
    const url = `${BASE}${p}/`;
    // コメントアウトされた古い案内を拾わないよう、先に HTML コメントを除く
    const html = (await httpGet(url, { referer: searchUrl })).replace(/<!--.*?-->/gs, "");
    const f = fields(html);
    const address = (f["住所"] || "").replace(/[−―‐ー](?=\d)/g, "-");
    if (!address.startsWith(PREFECTURE)) continue;
    tokyo++;
    // <title>叙々苑 | 店舗情報 | 叙々苑 練馬関町店</title> の最後の部分が店名
    const name = nfkc(squash(stripTags(html.match(/<title>(.*?)<\/title>/s)?.[1] ?? ""))).split("|").pop().trim();
    const access = f["アクセス"] || "";
    const hasParking = access.includes("駐車");
    console.log(`  ${name} ${hasParking ? "駐車場あり" : "-"}`);
    if (!hasParking) continue;

    await sleep(WAIT_SEC);
    const [lat, lng] = await geocode(address);
    // 駐車場の条件はアクセス欄に書かれているので、リンク文言を除いてそのまま残す
    const parkingNote = access.replace(/\s*(詳細はこちら|周辺地図はこちら)\s*\([^)]*\)/g, "").trim();
    rows.push({
      id: `jojoen_${p.split("/").pop()}`,
      chain: CHAIN,
      name,
      prefecture: PREFECTURE,
      city: cityOf(address, PREFECTURE),
      postal_code: "", // 公式データに項目なし
      address,
      phone: (f["TEL"] || "").split(" ")[0],
      latitude: lat,
      longitude: lng,
      // 「【営業時間変更のお知らせ】」などの告知は除く
      hours: (f["営業時間"] || "").split(/\s*[【※]/)[0].replace(/(?<=\d)\s*~\s*(?=\d)/g, "-").trim(),
      parking: true,
      is_24h: false,
      drive_thru: false,
      kids_menu: "", // 公式データに項目なし
      table_seats: /テーブル/.test(f["フロア"] || ""),
      takeout_only: false,
      facilities: `アクセス: ${parkingNote}`,
      official_url: url,
      google_maps_url: mapsUrl(lat, lng),
    });
  }
  console.log(`${PREFECTURE}: ${tokyo}店舗のうち駐車場あり${rows.length}店舗`);

  writeOutputs(sortBy(rows, (r) => r.address), outPath("jojoen"), `${CHAIN} ${PREFECTURE} 駐車場あり店舗`);
}

run(main);
