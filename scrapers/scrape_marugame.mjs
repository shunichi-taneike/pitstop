// 丸亀製麺の駐車場あり店舗を公式店舗検索 (stores.marugame.com) から取得し、
// 吉野家データと同じ列構成の CSV / GeoJSON / KML に出力する。
//
// 使い方: node scrapers/scrape_marugame.mjs [都道府県名]   (既定: 東京都)
// 出力:   stores/marugame/<slug>_parking.{csv,geojson,kml}
import { httpGet, mapsUrl, outPath, pyQuote, run, sleep, writeOutputs } from "./export_util.mjs";

const BASE = "https://stores.marugame.com/";
const WAIT_SEC = 1; // 詳細ページ取得の間隔
const PREF_SLUGS = { "東京都": "tokyo" };

const DAYS = [["monday", "月"], ["tuesday", "火"], ["wednesday", "水"], ["thursday", "木"],
  ["friday", "金"], ["saturday", "土"], ["sunday", "日"]];
const SERVICE_LABELS = {
  CASHLESS_AVAILABLE: "キャッシュレス対応", TAKEAWAY: "テイクアウト", MOBILE_ORDER: "モバイルオーダー",
  DELIVERY_SERVICE: "デリバリーサービス", DRIVE_THRU: "ドライブスルー", PARKING: "駐車場",
};

async function fetchDocument(p) {
  const url = BASE + pyQuote(p);
  const html = await httpGet(url, { timeoutSec: 30 });
  const m = html.match(/pageProps: JSON\.parse\(decodeURIComponent\("(.*?)"\)\)/s);
  if (!m) throw new Error(`pageProps が見つかりません: ${url}`);
  return JSON.parse(decodeURIComponent(m[1])).document;
}

function formatHours(hours) {
  const parts = [];
  let allDay = true;
  for (const [key, label] of DAYS) {
    const day = hours[key] || {};
    if (day.isClosed) {
      parts.push(`${label} 定休日`);
      allDay = false;
      continue;
    }
    const iv = day.openIntervals || [];
    parts.push(`${label} ` + iv.map((i) => `${i.start}-${i.end}`).join(","));
    if (!(iv.length === 1 && iv[0].start === "00:00" && ["23:59", "24:00"].includes(iv[0].end))) allDay = false;
  }
  return [parts.join(" / "), Object.keys(hours).length > 0 && allDay];
}

async function main() {
  const pref = process.argv[2] || "東京都";
  const slug = PREF_SLUGS[pref] ?? pref;
  const region = await fetchDocument(pref);
  const stores = region.dm_directoryChildren.flatMap((city) => city.dm_directoryChildren || []);
  const parking = stores.filter((s) => (s.c_cp_ServicesList || []).includes("PARKING"));
  console.log(`${pref}: 全${stores.length}店舗中 駐車場あり ${parking.length}店舗。詳細を取得します…`);

  const rows = [];
  for (const [i, s] of parking.entries()) {
    await sleep(WAIT_SEC);
    const d = await fetchDocument(s.slug);
    const a = d.address;
    const coord = d.yextDisplayCoordinate || s.yextDisplayCoordinate;
    const lat = coord.latitude, lng = coord.longitude;
    const services = d.c_cp_ServicesList || [];
    const [hours, is24h] = formatHours(d.hours || {});
    const kids = (d.c_menuLinks || []).some((m) => m.c_kidsOnly && m.c_activeOnPages);
    rows.push({
      id: `mgm_${d.id}`,
      chain: "丸亀製麺",
      name: d.name,
      prefecture: a.region,
      city: a.city,
      postal_code: a.postalCode ?? "",
      address: a.region + a.city + a.line1 + (a.line2 ? " " + a.line2 : ""),
      phone: (d.t_mainPhone || {}).label ?? "",
      latitude: lat,
      longitude: lng,
      hours,
      parking: true,
      is_24h: is24h,
      drive_thru: services.includes("DRIVE_THRU"),
      kids_menu: kids,
      table_seats: "", // 公式データに項目なし
      takeout_only: "", // 公式データに項目なし
      facilities: services.map((x) => SERVICE_LABELS[x] ?? x).join(" / "),
      official_url: BASE + pyQuote(d.slug),
      google_maps_url: mapsUrl(lat, lng),
    });
    console.log(`  [${i + 1}/${parking.length}] ${d.name}`);
  }

  writeOutputs(rows, outPath("marugame", slug), `丸亀製麺 ${pref} 駐車場あり店舗`);
}

run(main);
