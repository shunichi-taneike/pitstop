// NAVITIME 提供の公式店舗案内を使うチェーン（松屋・松のや・かつや・はなまるうどん）の駐車場あり店舗を取得し、
// 他チェーンと同じ列構成の CSV / GeoJSON / KML に出力する。
//
// 店舗案内ページが内部で使う /api/proxy2/shop/list に「住所: 東京都（13）」
// 「カテゴリ: ブランド」「add=detail」を指定してページングで全件取得し、
// 詳細フラグ「駐車場あり」（はなまるうどんは「駐車場」）が true の店舗を抽出する。
//
// - 松屋・松のや: 松屋フーズ公式の店舗案内 (pkg.navitime.co.jp/matsuyafoods/)
//   ※ 2026年11月時点、www.matsuyafoods.co.jp は不正アクセス対応のため停止中だが、
//     この店舗案内は稼働している。
// - かつや: アークランドサービス公式の店舗検索 (shop.arclandservice.co.jp/ae-shop/)
// - はなまるうどん: 公式の店舗検索 (stores.hanamaruudon.com/hanamaru/)
//
// 使い方: node scrapers/scrape_navitime.mjs [matsuya|matsunoya|katsuya|hanamaru ...]   (既定: 全ブランド)
// 出力:   stores/<brand>/tokyo_parking.{csv,geojson,kml}
import { brandArgs, cityOf, httpGetJson, mapsUrl, nfkc, outPath, run, sleep, sortBy, writeOutputs } from "./export_util.mjs";

const PREF_CODE = "13", PREFECTURE = "東京都";
const PAGE_SIZE = 50;
const WAIT_SEC = 1;

const MATSUYA_DAYS = [["月", "00081"], ["火", "00082"], ["水", "00083"], ["木", "00084"],
  ["金", "00085"], ["土", "00086"], ["日", "00087"]];
const MATSUYA_FACILITIES = ["24時間営業", "ドライブスルー", "テーブル席あり", "バリアフリー", "セルフサービス",
  "お席でタッチパネル注文", "松弁デリバリー", "Suica対応", "dポイント"];

// parkingFlag: 駐車場の有無を表す詳細フラグのラベル（店舗案内ごとに異なる）
const brand = (chain, prefix, base, category, facilities, parkingFlag = "駐車場あり") =>
  ({ chain, prefix, base, category, facilities, parkingFlag });

const BRANDS = {
  matsuya: brand("松屋", "mty", "https://pkg.navitime.co.jp/matsuyafoods", "0101", MATSUYA_FACILITIES),
  matsunoya: brand("松のや", "mny", "https://pkg.navitime.co.jp/matsuyafoods", "0203", MATSUYA_FACILITIES),
  katsuya: brand("かつや", "kty", "https://shop.arclandservice.co.jp/ae-shop", "01",
    ["テイクアウト", "デリバリー", "ネット注文", "朝メニュー", "ランチメニュー", "券売機",
      "ドライブスルー", "ペット同伴可", "クレジットカード", "交通系IC", "iD", "QR決済"]),
  hanamaru: brand("はなまるうどん", "hnm", "https://stores.hanamaruudon.com/hanamaru", "01",
    ["テイクアウト", "デリバリーサービス", "モバイルオーダー", "お子様メニュー", "おでん",
      "株主優待券", "交通系", "PayPay"], "駐車場"),
};

const clean = (s) => nfkc(s).trim();
const stripTags = (s) => clean((s || "").replace(/<[^>]+>/g, " ")).replaceAll("  ", " ");

async function fetchAll(b) {
  const items = [];
  let offset = 0, total = null;
  while (total === null || offset < total) {
    if (offset) await sleep(WAIT_SEC);
    const q = new URLSearchParams({ address: PREF_CODE, category: b.category, add: "detail",
      datum: "wgs84", limit: PAGE_SIZE, offset });
    const d = await httpGetJson(`${b.base}/api/proxy2/shop/list?${q}`, { referer: `${b.base}/spot/list?address=${PREF_CODE}` });
    total = d.count.total;
    items.push(...d.items);
    offset += PAGE_SIZE;
    if (!d.items.length) break;
  }
  if (items.length !== total) throw new Error(`件数不一致: total=${total} 取得=${items.length}`);
  return items;
}

async function exportBrand(slug) {
  const b = BRANDS[slug];
  const shops = (await fetchAll(b)).filter((s) => clean(s.address_name).startsWith(PREFECTURE)
    && (s.categories || []).some((c) => c.code === b.category));

  const rows = [];
  let closed = 0;
  for (const s of shops) {
    const texts = {}, tlabels = {}, flags = {};
    for (const d of s.details || []) {
      for (const t of d.texts || []) { texts[t.code] = t.value; tlabels[t.label] = t.value; }
      for (const f of d.flags || []) flags[f.label] = f.value;
    }
    if (flags["【GBP】閉業"]) { closed++; continue; }
    if (!flags[b.parkingFlag]) continue;
    const lat = s.coord.lat, lng = s.coord.lon;
    const address = clean(s.address_name);
    const hours = slug === "matsuya" || slug === "matsunoya"
      ? MATSUYA_DAYS.map(([lbl, code]) => `${lbl} ${texts[code] || "-"}`).join(" / ")
      : `毎日 ${stripTags(tlabels["営業時間"])}`.replaceAll("～", "-").replaceAll("~", "-");
    const parking = "駐車場" + (tlabels["駐車場"] ? ` ${clean(tlabels["駐車場"])}` : "");
    // 電話番号は構造化項目を優先し、空のときだけ詳細テキストを使う
    const phone = s.phone || stripTags(tlabels["電話番号"]);
    const pc = s.postal_code || "";
    const flagOrBlank = (label) => (label in flags ? Boolean(flags[label]) : "");
    rows.push({
      id: `${b.prefix}_${s.code}`,
      chain: b.chain,
      name: clean(s.name),
      prefecture: PREFECTURE,
      city: cityOf(address, PREFECTURE),
      postal_code: pc.length === 7 ? `${pc.slice(0, 3)}-${pc.slice(3)}` : pc,
      address,
      phone,
      latitude: lat,
      longitude: lng,
      hours,
      parking: true,
      is_24h: Boolean(flags["24時間営業"]),
      drive_thru: flagOrBlank("ドライブスルー"),
      kids_menu: flagOrBlank("お子様メニュー"),
      table_seats: flagOrBlank("テーブル席あり"),
      takeout_only: "", // 公式データに項目なし
      facilities: [...b.facilities.filter((f) => flags[f]), parking].join(" / "),
      official_url: `${b.base}/spot/detail?code=${s.code}`,
      google_maps_url: mapsUrl(lat, lng),
    });
  }

  console.log(`${PREFECTURE}: ${b.chain}全${shops.length}店舗中 駐車場あり ${rows.length}店舗`
    + (closed ? `（閉業 ${closed}店舗を除外）` : ""));
  writeOutputs(sortBy(rows, (r) => r.address), outPath(slug), `${b.chain} ${PREFECTURE} 駐車場あり店舗`);
}

async function main() {
  for (const [i, slug] of brandArgs(BRANDS).entries()) {
    if (i) await sleep(WAIT_SEC);
    await exportBrand(slug);
  }
}

run(main);
