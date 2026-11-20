// 牛角の駐車場あり店舗を公式の店舗検索（レインズ map.reins.co.jp）から取得し、
// 他チェーンと同じ列構成の CSV / GeoJSON / KML に出力する。
//
// 一覧ページ (map.reins.co.jp/gyukaku/tokyo) の各店舗 data-store 属性から東京都の店舗を選び、
// 詳細ページの「備考」に「駐車場：あり」とある店舗を抽出する。
// 郵便番号・住所・座標は詳細ページの JSON-LD (LocalBusiness) から取る。
// 営業時間は詳細ページに並ぶ直近 7 日分（日付ごと）を曜日別にまとめる。
// その 7 日に祝日が含まれる曜日は「月(祝)」のように印を付ける（祝日は holidays-jp で判定）。
//
// 使い方: node scrapers/scrape_gyukaku.mjs
// 出力:   stores/gyukaku/tokyo_parking.{csv,geojson,kml}
import { cityOf, htmlUnescape, httpGet, httpGetJson, mapsUrl, nfkc, outPath, run, sleep, sortBy, squash, stripTags, writeOutputs } from "./export_util.mjs";

const BASE = "https://map.reins.co.jp";
const PREFECTURE = "東京都";
const CHAIN = "牛角";
const WAIT_SEC = 1;
const DAYS = ["月", "火", "水", "木", "金", "土", "日"];
const HOLIDAYS_URL = "https://holidays-jp.github.io/api/v1/date.json";

/** 詳細ページの「見出し → 本文 HTML」を取り出す */
function sections(html) {
  const out = {};
  const re = /<div class="content-name">(.*?)<\/div>(.*?)(?=<div class="content-name">|<\/section>)/gs;
  for (const [, name, body] of html.matchAll(re)) out[squash(stripTags(name))] = body;
  return out;
}

/** 「2026/11/20　金曜日　16:00～23:00」の並びを「月 … / 火 …」にまとめる */
function formatHours(body, holidays) {
  const byDay = {}, holidayDays = new Set();
  const re = /(\d{4})\/(\d{1,2})\/(\d{1,2})\s*(.)曜日\s*([^\n]+)/g;
  for (const [, y, m, dd, d, t] of nfkc(stripTags(body ?? "")).matchAll(re)) {
    byDay[d] = squash(t).replace(/~/g, "-");
    if (`${y}-${m.padStart(2, "0")}-${dd.padStart(2, "0")}` in holidays) holidayDays.add(d);
  }
  if (!Object.keys(byDay).length) return "";
  return DAYS.map((d) => `${d}${holidayDays.has(d) ? "(祝)" : ""} ${byDay[d] || "-"}`).join(" / ");
}

async function main() {
  const holidays = await httpGetJson(HOLIDAYS_URL).catch(() => ({})); // 取れなければ印なし
  const listUrl = `${BASE}/gyukaku/tokyo`;
  const html = await httpGet(listUrl);
  const all = [...html.matchAll(/data-store="([^"]*)"\s*data-href="([^"]+)"/g)]
    .map(([, json, href]) => ({ ...JSON.parse(htmlUnescape(json)), href }));
  const shops = all.filter((s) => s.area === PREFECTURE);
  console.log(`${PREFECTURE}: ${CHAIN}全${shops.length}店舗。詳細ページで駐車場の有無を確認します…`);

  const rows = [];
  for (const [i, s] of shops.entries()) {
    await sleep(WAIT_SEC);
    const url = BASE + s.href;
    const detail = await httpGet(url, { referer: listUrl });
    const sec = sections(detail);
    const notes = nfkc(stripTags(sec["備考"] ?? "", "\n"));
    const hasParking = /駐車場\s*[:：]\s*あり/.test(notes);
    console.log(`  [${i + 1}/${shops.length}] ${s.store_name} ${hasParking ? "駐車場あり" : "-"}`);
    if (!hasParking) continue;

    const ld = [...detail.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)]
      .flatMap((m) => [JSON.parse(m[1])].flat())
      .find((o) => o["@type"] === "LocalBusiness");
    if (!ld?.geo) throw new Error(`店舗データ (JSON-LD) が見つかりません: ${url}`);
    const a = ld.address;
    const address = nfkc(`${a.addressRegion}${a.addressLocality}${a.streetAddress}`).replace(/(?<=\d)[ｰー−―‐](?=\d)/g, "-");
    const lat = Number(ld.geo.latitude), lng = Number(ld.geo.longitude);
    const hours = formatHours(sec["営業時間"], holidays);
    const linkTexts = (body) => [...(body ?? "").matchAll(/<a[^>]*>(.*?)<\/a>/gs)].map((m) => squash(stripTags(m[1])));
    const services = linkTexts(sec["設備・ サービス"] ?? sec["設備・サービス"]);
    const facilities = [
      ...services,
      ...notes.split("\n").map((l) => l.trim()).filter((l) => /[:：]\s*あり/.test(l)).map((l) => l.replace(/\s*[:：]\s*あり$/, "")),
      ...linkTexts(sec["テイクアウト・ デリバリー"] ?? sec["テイクアウト・デリバリー"]),
      ...linkTexts(sec["決済方法"]),
    ];
    rows.push({
      id: `gyukaku_${s.id}`,
      chain: CHAIN,
      name: nfkc(ld.name),
      prefecture: PREFECTURE,
      city: cityOf(address, PREFECTURE),
      postal_code: a.postalCode || "",
      address,
      phone: ld.telephone || s.phone || "",
      latitude: lat,
      longitude: lng,
      hours,
      parking: true,
      is_24h: false,
      drive_thru: false,
      kids_menu: "", // 公式データに項目なし（「お子様用備品あり」は食器等）
      table_seats: "", // 公式データに項目なし
      takeout_only: false,
      facilities: [...new Set(facilities.filter(Boolean))].join(" / "),
      official_url: url,
      google_maps_url: mapsUrl(lat, lng),
    });
  }

  writeOutputs(sortBy(rows, (r) => r.address), outPath("gyukaku"), `${CHAIN} ${PREFECTURE} 駐車場あり店舗`);
}

run(main);
