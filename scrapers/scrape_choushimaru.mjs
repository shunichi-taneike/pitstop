// すし銚子丸の駐車場あり店舗を公式店舗ページ (stores.choushimaru.co.jp) から取得し、
// 他チェーンと同じ列構成の CSV / GeoJSON / KML に出力する。
//
// 都道府県ページから店舗一覧を集め、各店舗ページのデータ（Yext）の
// c_locationFeatures に「駐車場」を含む項目がある店舗を抽出する
// （「駐車場:22台」「駐車場:(共用)」「駐車場有」など。「駐車場:無し」は除外）。
// ブランドは「すし銚子丸」「すし銚子丸 雅」を対象とし、別ブランドの YASUKE は除外する。
//
// 使い方: node scrapers/scrape_choushimaru.mjs
// 出力:   stores/choushimaru/tokyo_parking.{csv,geojson,kml}
import { httpGet, mapsUrl, nfkc, outPath, pyQuote, run, sleep, sortBy, squash, writeOutputs } from "./export_util.mjs";

const BASE = "https://stores.choushimaru.co.jp/";
const PREFECTURE = "東京都";
const WAIT_SEC = 1;
const BRANDS = ["すし銚子丸", "すし銚子丸_雅"];
const DAYS = [["monday", "月"], ["tuesday", "火"], ["wednesday", "水"], ["thursday", "木"],
  ["friday", "金"], ["saturday", "土"], ["sunday", "日"]];

const clean = (s) => squash(nfkc(s));

async function fetchDocument(p) {
  const page = await httpGet(BASE + pyQuote(p));
  const m = page.match(/pageProps: JSON\.parse\(decodeURIComponent\("(.*?)"\)\)/s);
  if (!m) throw new Error(`pageProps が見つかりません: ${p}`);
  return JSON.parse(decodeURIComponent(m[1])).document;
}

function parkingFeature(features) {
  for (const f of features) {
    if (f.includes("駐車場") && !/無し|なし|無$/.test(f)) return clean(f);
  }
  return null;
}

function formatHours(hours) {
  return DAYS.map(([key, label]) => {
    const day = hours[key] || {};
    if (day.isClosed) return `${label} 定休日`;
    return `${label} ` + ((day.openIntervals || []).map((i) => `${i.start}-${i.end}`).join(",") || "-");
  }).join(" / ");
}

/** "+81 3 5673 5300" → "03-5673-5300" */
function phoneJp(e164) {
  if (!e164) return "";
  const parts = e164.replaceAll("+81", "").split(/\s+/).filter(Boolean);
  if (parts.length) parts[0] = "0" + parts[0];
  return parts.join("-");
}

async function main() {
  const region = await fetchDocument(PREFECTURE);
  const slugs = region.dm_directoryChildren.flatMap((c) => (c.dm_directoryChildren || []).map((s) => s.slug));
  console.log(`${PREFECTURE}: 全${slugs.length}店舗。各店舗ページで駐車場の有無を確認します…`);

  const rows = [], otherBrand = [];
  for (const [i, slug] of slugs.entries()) {
    await sleep(WAIT_SEC);
    const d = await fetchDocument(slug);
    const features = d.c_locationFeatures || [];
    const pk = parkingFeature(features);
    if (!BRANDS.includes(d.c_brandName)) {
      otherBrand.push(d.name);
      continue;
    }
    console.log(`  [${i + 1}/${slugs.length}] ${d.name} ${pk || "-"}`);
    if (!pk) continue;
    const a = d.address;
    const coord = d.yextDisplayCoordinate || {};
    const lat = coord.latitude, lng = coord.longitude;
    rows.push({
      id: `csm_${d.id}`,
      chain: "銚子丸",
      name: clean(d.name),
      prefecture: PREFECTURE,
      city: a.city ?? "",
      postal_code: a.postalCode ?? "",
      address: a.region + a.city + a.line1 + (a.line2 ? " " + a.line2 : ""),
      phone: phoneJp(d.mainPhone),
      latitude: lat,
      longitude: lng,
      hours: formatHours(d.hours || {}),
      parking: true,
      is_24h: false,
      drive_thru: "", // 公式データに項目なし
      kids_menu: "", // 公式データに項目なし
      table_seats: "", // 公式データに項目なし
      takeout_only: "", // 公式データに項目なし
      facilities: features.map(clean).join(" / "),
      official_url: BASE + pyQuote(slug),
      google_maps_url: mapsUrl(lat, lng),
    });
  }

  if (otherBrand.length) console.log(`別ブランドのため除外: ${otherBrand.join(", ")}`);
  writeOutputs(sortBy(rows, (r) => r.address), outPath("choushimaru"), `銚子丸 ${PREFECTURE} 駐車場あり店舗`);
}

run(main);
