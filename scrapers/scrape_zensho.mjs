// ゼンショーグループ（すき家・ココス・はま寿司）の駐車場あり店舗を公式店舗検索から取得し、
// 他チェーンと同じ列構成の CSV / GeoJSON / KML に出力する。
//
// - すき家: maps.sukiya.jp（店舗の電話番号は非公開）
// - ココス: maps.cocos-jpn.co.jp
// - はま寿司: maps.hama-sushi.co.jp
//
// 店舗検索ページが内部で使う POST /api/search に「住所: 東京都」「設備: 駐車場」を
// 指定して一覧（座標付き）を取得し、各店舗の詳細ページから郵便番号・電話番号・
// 設備・お子様メニューの有無を補う。
//
// 使い方: node scrapers/scrape_zensho.mjs [sukiya|cocos|hamasushi ...]   (既定: 全ブランド)
// 出力:   stores/<brand>/tokyo_parking.{csv,geojson,kml}
import { UA, brandArgs, cityOf, httpGet, mapsUrl, nfkc, outPath, run, sleep, sortBy, squash, stripTags, writeOutputs } from "./export_util.mjs";

const PREFECTURE = "東京都";
const WAIT_SEC = 1;

// slug: [ベース URL, チェーン名, id 接頭辞]
const BRANDS = {
  sukiya: ["https://maps.sukiya.jp", "すき家", "sky"],
  cocos: ["https://maps.cocos-jpn.co.jp", "ココス", "ccs"],
  hamasushi: ["https://maps.hama-sushi.co.jp", "はま寿司", "hms"],
};

const text = (s) => squash(nfkc(stripTags(s.replace(/<br[^>]*>/g, " "))));

/** 一覧を取得。検索条件はセッションに保持されるため Cookie を引き継ぎ、morelist で残り件数を追加取得する */
async function searchAll(base) {
  const cookies = new Map();
  const headers = { "User-Agent": UA, "X-Requested-With": "XMLHttpRequest", Referer: `${base}/jp/address.html`,
    "Content-Type": "application/x-www-form-urlencoded" };

  async function post(params) {
    const h = { ...headers };
    if (cookies.size) h.Cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(`${base}/api/search`, { method: "POST", headers: h, body: new URLSearchParams(params),
      signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${base}/api/search`);
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const eq = pair.indexOf("=");
      cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
    return await res.json();
  }

  let d = await post([["address", PREFECTURE], ["facility[]", "parking_flag"]]);
  const total = Number(d.list.match(/検索結果：<strong>(\d+)<\/strong>/)[1]);
  if (d.mapdata.length < total) {
    await sleep(WAIT_SEC);
    d = await post([["morelist", String(total - d.mapdata.length)]]);
  }
  const lis = [...d.list.matchAll(/<li>(.*?)<\/li>/gs)].map((m) => m[1]);
  if (d.mapdata.length !== total || lis.length !== total) {
    throw new Error(`件数不一致: total=${total} mapdata=${d.mapdata.length} list=${lis.length}`);
  }
  return [d.mapdata, lis];
}

async function exportBrand(slug) {
  const [base, chain, prefix] = BRANDS[slug];
  const [mapdata, lis] = await searchAll(base);
  // 一覧 HTML から link → 住所
  const addrByLink = new Map();
  for (const li of lis) {
    const link = li.match(/href="([^"]+)"/)[1];
    addrByLink.set(link, text(li.match(/<dt>住所：<\/dt><dd>(.*?)<\/dd>/s)[1]));
  }
  console.log(`${PREFECTURE}: ${chain} 駐車場あり ${mapdata.length}店舗。詳細を取得します…`);

  const rows = [];
  for (const [i, m] of mapdata.entries()) {
    if (m.brand !== chain) continue;
    const address = addrByLink.get(m.link);
    if (!address.startsWith(PREFECTURE)) continue;
    await sleep(WAIT_SEC);
    const url = base + m.link;
    const page = await httpGet(url);
    const zipM = page.match(/<span class="zip-code">〒?([\p{Nd}-]+)<\/span>/u);
    const telM = page.match(/href="tel:([\p{Nd}-]+)"/u);
    const svcM = page.match(/<h3>サービス・設備<\/h3>(.*?)(?:<h3>|$)/s);
    const facilities = [...(svcM ? svcM[1] : "").matchAll(/<span class="name">(.*?)<\/span>/gs)].map((x) => text(x[1]));
    const kids = /<span class="name">お子様メニュー<br[^>]*>あり<\/span>/.test(page);
    const options = m.options || [];
    const hours = ["business_hour1", "business_hour2", "business_hour3"].map((k) => text(m[k] || "")).join(" ").trim();
    const lat = Number(m.lat), lng = Number(m.lng);
    const shopNo = m.link.match(/\/(\d+)\.html/)[1];
    rows.push({
      id: `${prefix}_${shopNo}`,
      chain,
      name: `${chain} ${text(m.name)}`,
      prefecture: PREFECTURE,
      city: cityOf(address, PREFECTURE),
      postal_code: zipM ? zipM[1] : "",
      address,
      phone: telM ? telM[1] : "", // すき家は公式サイトで非公開
      latitude: lat,
      longitude: lng,
      // 「月-金 10:00-…」のように曜日指定で始まる場合は「毎日」を付けない
      hours: hours ? (/^[月火水木金土日平]/.test(hours) ? "" : "毎日 ") + hours.replace(/[～~]/g, "-").replace(/\s+/g, " ") : "",
      parking: true,
      is_24h: options.includes("24時間営業") || hours.includes("24時間"),
      drive_thru: facilities.some((f) => f.startsWith("ドライブスルー")),
      kids_menu: kids,
      table_seats: "", // 公式データに項目なし
      takeout_only: "", // 公式データに項目なし
      facilities: [...new Set([...facilities, ...options.filter((o) => !facilities.includes(o))])].join(" / "),
      official_url: url,
      google_maps_url: mapsUrl(lat, lng),
    });
    console.log(`  [${i + 1}/${mapdata.length}] ${rows.at(-1).name}`);
  }

  writeOutputs(sortBy(rows, (r) => r.address), outPath(slug), `${chain} ${PREFECTURE} 駐車場あり店舗`);
}

async function main() {
  for (const slug of brandArgs(BRANDS)) await exportBrand(slug);
}

run(main);
