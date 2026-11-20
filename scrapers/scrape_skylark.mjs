// すかいらーくグループ（ガスト・ジョナサン）の駐車場あり店舗を公式店舗検索
// (store-info.skylark.co.jp) から取得し、他チェーンと同じ列構成の CSV / GeoJSON / KML に出力する。
//
// 店舗検索が内部で使う /api/point/{geohash}/ を、東京都をカバーする geohash（xn6, xn7）
// について取得し、住所が「東京都」で始まり、指定ブランドのカテゴリ（ステーキガスト等の
// 別業態は別カテゴリ）かつ「駐車場（有無）フラグ」= 1 の店舗を抽出する。
//
// 使い方: node scrapers/scrape_skylark.mjs [gusto|jonathan ...]   (既定: 全ブランド)
// 出力:   stores/<brand>/tokyo_parking.{csv,geojson,kml}
import { brandArgs, cityOf, httpGetJson, mapsUrl, nfkc, outPath, run, sleep, sortBy, writeOutputs } from "./export_util.mjs";

const API = (gh) => `https://store-info.skylark.co.jp/api/point/${gh}/`;
const REFERER = "https://store-info.skylark.co.jp/skylark/";
const PREFECTURE = "東京都";
const GEOHASHES = ["xn6", "xn7"];
const WAIT_SEC = 1;

// slug: [カテゴリコード, チェーン名, id 接頭辞, 詳細ページのパス]
const BRANDS = {
  gusto: ["0101", "ガスト", "gst", "gusto"],
  jonathan: ["0103", "ジョナサン", "jnt", "jonathan"],
};

const FACILITY_FLAGS = {
  "全日２４時間フラグ": "24時間営業", "持ち帰りフラグ": "テイクアウト", "宅配フラグ": "宅配",
  "ｗｉ－ｆｉ（有無）フラグ": "Wi-Fi", "コンセント席フラグ": "コンセント席", "個室フラグ": "個室",
  "座敷フラグ": "座敷", "おむつ替え台フラグ": "おむつ替え台", "多目的トイレフラグ": "多目的トイレ",
  "車椅子対応フラグ": "車椅子対応", "身障者用駐車場フラグ": "身障者用駐車場", "ペット同伴可": "ペット同伴可",
  "完全禁煙フラグ": "完全禁煙", "から好し併設店（有無）フラグ": "から好し併設",
};

const clean = (s) => nfkc(s).trim();
const hm = (s) => (s ? clean(s).replaceAll("～", "-").replaceAll("~", "-") : "-");

function cleanName(name) {
  // 「ガスト 小平回田店（から好し取扱店）」→「ガスト 小平回田店」（取扱は facilities に記載）
  name = clean(name).replaceAll("(", "（").replaceAll(")", "）");
  return name.replace(/（[^）]*）/g, "").replace(/\s+/g, " ").trim();
}

async function fetchPoints() {
  const items = new Map();
  for (const [i, gh] of GEOHASHES.entries()) {
    if (i) await sleep(WAIT_SEC);
    for (const p of (await httpGetJson(API(gh), { referer: REFERER })).items) items.set(p.id, p);
  }
  return [...items.values()];
}

function exportBrand(points, slug) {
  const [category, chain, prefix, urlPath] = BRANDS[slug];
  const stores = points.filter((p) => p.address.startsWith(PREFECTURE)
    && p.extra_fields["カテゴリ"] === category && p.extra_fields["削除フラグ"] !== "1");
  const parking = stores.filter((p) => p.extra_fields["駐車場（有無）フラグ"] === "1");
  console.log(`${PREFECTURE}: ${chain}全${stores.length}店舗中 駐車場あり ${parking.length}店舗`);

  const rows = sortBy(parking, (p) => p.address).map((p) => {
    const ef = p.extra_fields;
    const lat = p.latitude, lng = p.longitude;
    const address = clean(p.address);
    const weekday = hm(ef["平日"]);
    const hours = [..."月火水木金"].map((d) => `${d} ${weekday}`)
      .concat(`土 ${hm(ef["土曜日"])}`, `日・祝 ${hm(ef["日曜・祝日"])}`).join(" / ");
    const facilities = Object.entries(FACILITY_FLAGS).filter(([k]) => ef[k] === "1").map(([, label]) => label);
    if (p.name.includes("から好し取扱店")) facilities.push("から好し取扱");
    facilities.push("駐車場");
    return {
      id: `${prefix}_${p.key}`,
      chain,
      name: cleanName(p.name),
      prefecture: PREFECTURE,
      city: cityOf(address, PREFECTURE),
      postal_code: "", // 公式データに項目なし
      address,
      phone: ef["電話番号"] || "",
      latitude: lat,
      longitude: lng,
      hours,
      parking: true,
      is_24h: ef["全日２４時間フラグ"] === "1",
      drive_thru: "", // 公式データに項目なし
      kids_menu: "", // 公式データに項目なし
      table_seats: "", // 公式データに項目なし
      takeout_only: "", // 公式データに項目なし
      facilities: facilities.join(" / "),
      official_url: `https://store-info.skylark.co.jp/${urlPath}/map/${p.key}/`,
      google_maps_url: mapsUrl(lat, lng),
    };
  });

  writeOutputs(rows, outPath(slug), `${chain} ${PREFECTURE} 駐車場あり店舗`);
}

async function main() {
  const slugs = brandArgs(BRANDS);
  const points = await fetchPoints();
  for (const slug of slugs) exportBrand(points, slug);
}

run(main);
