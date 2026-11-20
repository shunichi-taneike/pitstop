// びっくりドンキーの駐車場あり店舗を公式店舗検索 (www.bikkuri-donkey.com/shop/) から取得し、
// 他チェーンと同じ列構成の CSV / GeoJSON / KML に出力する。
//
// 店舗検索ページには全国の店舗が data 属性付きで埋め込まれている
// （data-pref=都道府県、data-search=設備キーワード、data-latlng=座標）。
// data-pref が tokyo かつ data-search に parking を含む店舗を抽出し、
// 各店舗の詳細ページから住所（都道府県付き）・営業時間・駐車台数を補う。
//
// 使い方: node scrapers/scrape_bikkuri.mjs
// 出力:   stores/bikkuri/tokyo_parking.{csv,geojson,kml}
import { cityOf, httpGet, mapsUrl, nfkc, outPath, run, sleep, sortBy, squash, strip, stripTags, writeOutputs } from "./export_util.mjs";

const BASE = "https://www.bikkuri-donkey.com";
const PREF_SLUG = "tokyo", PREFECTURE = "東京都";
const WAIT_SEC = 1;
const FACILITY_TOKENS = { // data-search のキーワード → 表示名（検索ページのラベル）
  morning: "モーニング", web_reservation: "WEB来店予約", online_order: "ネット注文", delivery: "宅配",
  takeout: "テイクアウト", wifi: "Wi-Fi", consent_seat: "コンセント席", baby_sheet: "ベビーシート",
  multi_purpose_toilet: "多目的トイレ", barrier_free: "車イス入店", wheelchair_parking: "車イス駐車場",
  raised_floor_seat: "小上がり席", smoking_room: "喫煙室", credit_card: "クレジット",
  e_payment: "電子マネー", qr_payment: "QRコード決済", auto_register: "自動精算機",
};

const text = (s) => strip(squash(nfkc(stripTags(s.replace(/<br\s*\/?>/g, " / ")))), " /");

function field(page, heading) {
  const m = page.match(new RegExp(`<h4>${heading}</h4>\\s*<p>(.*?)</p>`, "s"));
  return m ? text(m[1]) : "";
}

async function main() {
  const page = await httpGet(`${BASE}/shop/?from=shop&pref=${PREF_SLUG}`);
  const re = /<div class="[^"]*shop_wrap" name="shop_(\d+)" data-latlng="([^"]*)" data-pref="([^"]*)" data-search="([^"]*)">(.*?)<\/a>\s*<\/div>/gs;
  const cards = [...page.matchAll(re)].map((m) => m.slice(1));
  const tokyo = cards.filter((c) => c[2] === PREF_SLUG);
  const parking = tokyo.filter((c) => c[3].includes("__parking__"));
  console.log(`${PREFECTURE}: 全${tokyo.length}店舗中 駐車場あり ${parking.length}店舗（全国 ${cards.length}店舗）`);

  const rows = [];
  for (const [i, [no, latlng, , tokens, card]] of parking.entries()) {
    await sleep(WAIT_SEC);
    const url = `${BASE}/shop/shop_${no}/`;
    const detail = await httpGet(url);
    const nameM = card.match(/<h4>(.*?)<\/h4>/s);
    const name = nameM ? `びっくりドンキー ${text(nameM[1])}` : url;
    let address = field(detail, "住所");
    if (!address.startsWith(PREFECTURE)) address = PREFECTURE + address;
    const [lat, lng] = latlng.split(",").map(Number);
    const spaces = field(detail, "駐車場台数");
    const toks = new Set(strip(tokens, "_").split("__"));
    rows.push({
      id: `bkd_${no}`,
      chain: "びっくりドンキー",
      name,
      prefecture: PREFECTURE,
      city: cityOf(address, PREFECTURE),
      postal_code: "", // 公式データに項目なし
      address,
      phone: field(detail, "電話番号"),
      latitude: lat,
      longitude: lng,
      hours: "毎日 " + field(detail, "営業時間").replace(/[～~]/g, "-"),
      parking: true,
      is_24h: false,
      drive_thru: "", // 公式データに項目なし
      kids_menu: "", // 公式データに項目なし（全店共通の「おこさま」メニューあり）
      table_seats: "", // 公式データに項目なし
      takeout_only: "", // 公式データに項目なし
      facilities: [...Object.entries(FACILITY_TOKENS).filter(([t]) => toks.has(t)).map(([, label]) => label),
        "駐車場" + (/^\d+$/.test(spaces) ? ` ${spaces}台` : "")].join(" / "),
      official_url: url,
      google_maps_url: mapsUrl(lat, lng),
    });
    console.log(`  [${i + 1}/${parking.length}] ${name}`);
  }

  writeOutputs(sortBy(rows, (r) => r.address), outPath("bikkuri"), `びっくりドンキー ${PREFECTURE} 駐車場あり店舗`);
}

run(main);
