// カンリー（can-ly）の店舗ページ基盤を使うチェーン（ロイヤルホスト・大戸屋）の
// 駐車場あり店舗を公式店舗一覧から取得し、他チェーンと同じ列構成の CSV / GeoJSON / KML に出力する。
//
// - ロイヤルホスト: locations.royalhost.jp
// - 大戸屋ごはん処: store.ootoya.com
//
// 都道府県ページ（ページング有り）から店舗一覧を集め、各店舗の詳細ページの
// 「サービス・施設」で「駐車場」にチェックがある店舗を抽出する。
//
// 使い方: node scrapers/scrape_canly.mjs [royalhost|ootoya ...]   (既定: 全ブランド)
// 出力:   stores/<brand>/tokyo_parking.{csv,geojson,kml}
import { brandArgs, cityOf, httpGet, mapsUrl, outPath, pyQuote, run, sleep, sortBy, writeOutputs } from "./export_util.mjs";

const PREFECTURE = "東京都";
const WAIT_SEC = 1;
const DAYS = [["MONDAY", "月"], ["TUESDAY", "火"], ["WEDNESDAY", "水"], ["THURSDAY", "木"],
  ["FRIDAY", "金"], ["SATURDAY", "土"], ["SUNDAY", "日"]];
// 店舗の設備としてまとめるチェック項目のセクション名
const FACILITY_SECTIONS = ["サービス・施設", "決済方法"];
const CHECKBOX_COMPONENTS = ["checkBoxOnOffLabel", "checkBoxIconText"];

// slug: [ベース URL, チェーン名, id 接頭辞]
const BRANDS = {
  royalhost: ["https://locations.royalhost.jp/", "ロイヤルホスト", "rhs"],
  ootoya: ["https://store.ootoya.com/", "大戸屋", "oty"],
};

async function fetchPage(url) {
  const html = await httpGet(url);
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
  if (!m) throw new Error(`__NEXT_DATA__ が見つかりません: ${url}`);
  return [html, JSON.parse(m[1]).props.pageProps];
}

const hhmm = (t) => (t ? t.slice(0, 5) : "");

function formatHours(bh) {
  const byDay = {};
  for (const h of bh) {
    if (h.openTime && h.closeTime) (byDay[h.name] ??= []).push(`${hhmm(h.openTime)}-${hhmm(h.closeTime)}`);
  }
  const parts = DAYS.map(([k, lbl]) => `${lbl} ${(byDay[k] || []).join(",") || "-"}`);
  const allDay = DAYS.every(([k]) => {
    const v = byDay[k] || [];
    return v.length === 1 && (v[0] === "00:00-00:00" || v[0] === "00:00-24:00");
  });
  return [parts.join(" / "), allDay];
}

/** セクション名 → チェックされた項目ラベル */
function checkedItems(shop) {
  const out = {};
  for (const c of shop.cmsItemValues || []) {
    const content = c.content || {};
    const comp = content.componentName;
    if (!CHECKBOX_COMPONENTS.includes(comp)) continue;
    const items = (content[comp] || {}).items || [];
    (out[content.title || ""] ??= []).push(...items.filter((i) => i.checked).map((i) => i.label));
  }
  return out;
}

async function exportBrand(slug) {
  const [base, chain, prefix] = BRANDS[slug];
  const prefUrl = base + pyQuote(PREFECTURE) + "/";

  const [, first] = await fetchPage(prefUrl);
  let shops = [...first.shops];
  for (let page = 2; page <= (first.maxPage || 1); page++) {
    await sleep(WAIT_SEC);
    shops.push(...(await fetchPage(`${prefUrl}?page=${page}`))[1].shops);
  }
  shops = [...new Map(shops.map((s) => [s.storeCode, s])).values()];
  if (shops.length !== first.totalCount) {
    console.log(`警告: 一覧件数 ${shops.length} が totalCount ${first.totalCount} と一致しません`);
  }
  console.log(`${PREFECTURE}: ${chain}全${shops.length}店舗。詳細ページで駐車場の有無を確認します…`);

  const rows = [];
  for (const [i, s] of shops.entries()) {
    await sleep(WAIT_SEC);
    const url = `${base}detail/${s.storeCode}/`;
    const [html, props] = await fetchPage(url);
    const d = props.shop;
    const sections = checkedItems(d);
    const service = sections["サービス・施設"] || [];
    const hasParking = service.includes("駐車場");
    console.log(`  [${i + 1}/${shops.length}] ${d.nameKanji} ${hasParking ? "駐車場あり" : "-"}`);
    if (!hasParking) continue;
    const fac = FACILITY_SECTIONS.flatMap((sec) => sections[sec] || []);
    const lat = Number(d.latitude), lng = Number(d.longitude);
    const [hours, is24h] = formatHours(d.businessHours || []);
    const address = d.address.trim();
    const telM = html.match(/href="tel:([\p{Nd}+-]+)"/u);
    rows.push({
      id: `${prefix}_${d.storeCode}`,
      chain,
      name: d.nameKanji,
      prefecture: PREFECTURE,
      city: cityOf(address, PREFECTURE),
      postal_code: (d.zipCode || "").replace(/^〒+/, ""),
      address,
      phone: d.tel || (telM ? telM[1] : ""),
      latitude: lat,
      longitude: lng,
      hours,
      parking: true,
      is_24h: is24h,
      drive_thru: "", // 公式データに項目なし
      kids_menu: "", // 公式データに項目なし
      table_seats: "", // 公式データに項目なし
      takeout_only: "", // 公式データに項目なし
      facilities: fac.join(" / "),
      official_url: url,
      google_maps_url: mapsUrl(lat, lng),
    });
  }

  writeOutputs(sortBy(rows, (r) => r.address), outPath(slug), `${chain} ${PREFECTURE} 駐車場あり店舗`);
}

async function main() {
  for (const slug of brandArgs(BRANDS)) await exportBrand(slug);
}

run(main);
