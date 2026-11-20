// 天丼てんやの駐車場あり店舗を公式店舗案内 (www.tenya.co.jp/shop/) から取得し、
// 他チェーンと同じ列構成の CSV / GeoJSON / KML に出力する。
//
// 都道府県ページ → 市区町村ページ → 店舗ページをたどり、店舗ページの
// 「店舗施設情報」に駐車場アイコン（<span class="parking">）がある店舗を抽出する。
// 座標は店舗ページの地図（Google マップ埋め込み）の q= パラメータから取得する。
//
// 使い方: node scrapers/scrape_tenya.mjs
// 出力:   stores/tenya/tokyo_parking.{csv,geojson,kml}
import { cityOf, httpGet, mapsUrl, nfkc, outPath, run, sleep, sortBy, squash, strip, stripTags, writeOutputs } from "./export_util.mjs";

const BASE = "https://www.tenya.co.jp";
const PREF_SLUG = "tokyo", PREFECTURE = "東京都";
const WAIT_SEC = 1;
const FACILITY_CLASSES = { kids: "お子様メニュー", soba: "そばメニュー", noSmoking: "終日禁煙", parking: "駐車場" };

const text = (s) => squash(nfkc(stripTags(s.replace(/<br\s*\/?>/g, " "))));
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function get(url) {
  await sleep(WAIT_SEC);
  // HTML コメント内にテンプレートの説明（「駐車場あり」等）があるため除去してから解析する
  return (await httpGet(url)).replace(/<!--.*?-->/gs, "");
}

/** Python の str[a:b]（find の -1 を含む）と同じ切り出し */
const pySlice = (s, a, b) => s.slice(a, b ?? undefined);

async function main() {
  const prefUrl = `${BASE}/shop/${PREF_SLUG}/`;
  const prefPage = await get(prefUrl);
  const cityRe = new RegExp(`href="((?:${escapeRe(BASE)})?/shop/${PREF_SLUG}/[a-z0-9_-]+/)"`, "g");
  const cityUrls = [...new Set([...prefPage.matchAll(cityRe)].map((m) => new URL(m[1], prefUrl).href))].sort();
  let storeUrls = [];
  const storeRe = new RegExp(`href="([^"]*/shop/${PREF_SLUG}/[a-z0-9_-]+/[a-z0-9_-]+\\.html)"`, "g");
  for (const cu of cityUrls) {
    const page = await get(cu);
    storeUrls.push(...[...page.matchAll(storeRe)].map((m) => new URL(m[1], cu).href));
  }
  storeUrls = [...new Set(storeUrls)].sort();
  const totalM = (await httpGet(`${BASE}/shop/`)).match(new RegExp(`${PREFECTURE}（(\\d+)）`));
  console.log(`${PREFECTURE}: 市区町村 ${cityUrls.length}、店舗 ${storeUrls.length}`
    + (totalM ? `（店舗案内トップの表示件数 ${totalM[1]}）` : ""));

  const dash = /\s*[~-]\s*/g;
  const rows = [];
  for (const [i, url] of storeUrls.entries()) {
    const page = await get(url);
    const classes = new Set([...page.matchAll(/<dt class="icon storeInfo"><span class="([^"]+)">/g)].map((m) => m[1]));
    const nameM = page.match(/<h4 class="shopName">(.*?)<\/h4>/s);
    const shopName = nameM ? text(nameM[1]) : url;
    const name = shopName.includes("てんや") ? shopName : `天丼てんや ${shopName}`;
    console.log(`  [${i + 1}/${storeUrls.length}] ${name} ${classes.has("parking") ? "駐車場あり" : "-"}`);
    if (!classes.has("parking")) continue;

    const box = pySlice(page, page.indexOf('class="detailBox"'), page.indexOf('class="openBox"'));
    const lis = [...box.matchAll(/<li>(.*?)<\/li>/gs)].map((m) => text(m[1]));
    const addrLi = lis.find((x) => x.startsWith("〒") || x.includes(PREFECTURE)) ?? "";
    // 郵便番号の区切りに長音記号等が使われている店舗がある（例: 〒136ー0071）
    const zipM = addrLi.match(/^〒?\s*(\d{3})[-ー−‐－―](\d{4})\s*(.*)/s);
    let address = (zipM ? zipM[3] : addrLi).replaceAll("　", " ").trim();
    if (address && !address.startsWith(PREFECTURE)) address = PREFECTURE + address; // 都名が省略されている店舗
    const tel = lis.find((x) => x.startsWith("TEL"))?.replaceAll("TEL:", "").trim() ?? "";

    const openBox = pySlice(page, page.indexOf('class="openBox"'),
      page.includes('class="shopNote"') ? page.indexOf('class="shopNote"') : null);
    let hours = [...openBox.matchAll(/<dt>(.*?)<\/dt>\s*<dd>(.*?)<\/dd>/gs)]
      .map((m) => strip(text(m[1]), "【】") + " " + text(m[2]).replace(dash, "-")).join(" / ");
    if (!hours) { // 「月）11:00～20:00<br>火）…」形式の店舗
      const p = openBox.match(/<p>(.*?)<\/p>/s);
      if (p) {
        hours = p[1].split(/<br\s*\/?>/).filter((x) => text(x)).map(text)
          .map((x) => x.replace(/^(.+?)[)）]\s*/s, "$1 ").replace(dash, "-")).join(" / ");
      }
    }
    const coord = page.match(/[?&]q=([\d.]+),([\d.]+)/);
    if (!coord) {
      console.log(`    座標が見つからないためスキップ: ${url}`);
      continue;
    }
    const lat = Number(coord[1]), lng = Number(coord[2]);
    const seg = url.split("/");
    rows.push({
      id: `tny_${seg.at(-2)}_${seg.at(-1).replace(/\.html$/, "")}`,
      chain: "てんや",
      name,
      prefecture: PREFECTURE,
      city: cityOf(address, PREFECTURE),
      postal_code: zipM ? `${zipM[1]}-${zipM[2]}` : "",
      address,
      phone: tel,
      latitude: lat,
      longitude: lng,
      hours,
      parking: true,
      is_24h: false,
      drive_thru: "", // 公式データに項目なし
      kids_menu: classes.has("kids"),
      table_seats: "", // 公式データに項目なし
      takeout_only: "", // 公式データに項目なし
      facilities: Object.entries(FACILITY_CLASSES).filter(([c]) => classes.has(c)).map(([, label]) => label).join(" / "),
      official_url: url,
      google_maps_url: mapsUrl(lat, lng),
    });
  }

  writeOutputs(sortBy(rows, (r) => r.address), outPath("tenya"), `てんや ${PREFECTURE} 駐車場あり店舗`);
}

run(main);
