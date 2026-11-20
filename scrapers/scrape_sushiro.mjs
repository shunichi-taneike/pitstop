// スシローの駐車場あり店舗を公式店舗検索 (www.akindo-sushiro.co.jp/shop/) から取得し、
// 他チェーンと同じ列構成の CSV / GeoJSON / KML に出力する。
//
// 店舗検索の「都道府県・設備から探す」（?mode=service&pref=13&parking=1）の結果一覧から
// 店舗 ID を集め、各店舗の詳細ページに埋め込まれた店舗データ（const item = {...}）から
// 郵便番号・住所・座標・電話番号・営業時間・サービスを取得する。
//
// 使い方: node scrapers/scrape_sushiro.mjs
// 出力:   stores/sushiro/tokyo_parking.{csv,geojson,kml}
import { httpGet, mapsUrl, nfkc, outPath, rawDecodeJson, run, sleep, sortBy, squash, stripTags, writeOutputs } from "./export_util.mjs";

const BASE = "https://www.akindo-sushiro.co.jp/shop/";
const PREF_ID = "13", PREFECTURE = "東京都";
const WAIT_SEC = 1;

const text = (s) => squash(nfkc(stripTags((s || "").replace(/<br\s*\/?>|\n/g, " "))));

async function main() {
  const page = await httpGet(`${BASE}?mode=service&pref=${PREF_ID}&parking=1`);
  const countM = page.match(/<span class="result-count__num">(\d+)<\/span>/);
  const result = page.slice(page.indexOf('id="ResultList"'));
  const ids = [...new Set([...result.matchAll(/href="detail\.php\?id=(\d+)" class="common-shop-list__panel"/g)].map((m) => m[1]))];
  const total = countM ? Number(countM[1]) : null;
  console.log(`${PREFECTURE}: 駐車場あり ${ids.length}店舗（検索結果の表示件数 ${total}）`);
  if (total !== null && total !== ids.length) console.log("警告: 表示件数と取得件数が一致しません");

  const rows = [];
  for (const [i, sid] of ids.entries()) {
    await sleep(WAIT_SEC);
    const url = `${BASE}detail.php?id=${sid}`;
    const detail = await httpGet(url);
    const at = detail.search(/const item = /);
    if (at < 0) {
      console.log(`  店舗データが見つからないためスキップ: ${url}`);
      continue;
    }
    const item = rawDecodeJson(detail, at + "const item = ".length);
    const services = [...detail.matchAll(/<li class="cate\d+"><span>(.*?)<\/span><\/li>/gs)].map((m) => text(m[1]));
    if (item.pref_id !== PREF_ID || !services.includes("駐車場あり")) {
      console.log(`  [${i + 1}/${ids.length}] ${item.name} 対象外（都道府県 ${item.pref_id} / ${services}）`);
      continue;
    }
    const lat = Number(item.lat), lng = Number(item.lng);
    const city = text(item.city_name || "");
    const address = PREFECTURE + city + text(item.address);
    const hours = text(item.hours).replace(/[～~]/g, "-");
    const name = text(item.name);
    rows.push({
      id: `srr_${sid}`,
      chain: "スシロー",
      name: name.startsWith("スシロー") || name.startsWith("デジロー") ? name : `スシロー ${name}`,
      prefecture: PREFECTURE,
      city,
      postal_code: item.zip1 && item.zip2 ? `${item.zip1}-${item.zip2}` : "",
      address,
      phone: item.tel || "",
      latitude: lat,
      longitude: lng,
      hours,
      parking: true,
      is_24h: false,
      drive_thru: "", // 公式データに項目なし
      kids_menu: "", // 公式データに項目なし
      table_seats: "", // 公式データに項目なし
      takeout_only: "", // 公式データに項目なし
      facilities: services.join(" / "),
      official_url: url,
      google_maps_url: mapsUrl(lat, lng),
    });
    console.log(`  [${i + 1}/${ids.length}] ${rows.at(-1).name}`);
  }

  writeOutputs(sortBy(rows, (r) => r.address), outPath("sushiro"), `スシロー ${PREFECTURE} 駐車場あり店舗`);
}

run(main);
