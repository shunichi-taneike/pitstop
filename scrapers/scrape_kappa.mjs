// かっぱ寿司の駐車場あり店舗を公式店舗検索 (www.kappasushi.jp/shop2) から取得し、
// 他チェーンと同じ列構成の CSV / GeoJSON / KML に出力する。
//
// 店舗検索ページが読み込む全国店舗データ /master_data/json/shoplist.json から、
// 都道府県が東京都かつ facility4（検索ページの「駐車場あり」= park）が 1 の店舗を抽出する。
//
// 使い方: node scrapers/scrape_kappa.mjs
// 出力:   stores/kappa/tokyo_parking.{csv,geojson,kml}
import { httpGetJson, mapsUrl, nfkc, outPath, run, sortBy, squash, strip, stripTags, writeOutputs } from "./export_util.mjs";

const DATA = "https://www.kappasushi.jp/master_data/json/shoplist.json";
const DETAIL = (code) => `https://www.kappasushi.jp/shop/${code}`;
const PREFECTURE = "東京都";
// 検索ページの JS（institution[] の判定・アイコン表示）での対応
const FACILITIES = {
  facility1: "バリアフリー", facility2: "エレベーターあり", facility3: "多目的トイレ",
  facility4: "駐車場", facility5: "その他昇降機あり",
};

const text = (s) => strip(squash(nfkc(stripTags((s || "").replace(/<br\s*\/?>/g, " / ")))), " /");

async function main() {
  const stores = (await httpGetJson(DATA, { referer: "https://www.kappasushi.jp/shop2" })).Store;
  const tokyo = stores.filter((s) => s.prefecture === PREFECTURE);
  const parking = tokyo.filter((s) => s.facility4 === "1");
  console.log(`${PREFECTURE}: 全${tokyo.length}店舗中 駐車場あり ${parking.length}店舗（全国 ${stores.length}店舗）`);

  const rows = parking.map((s) => {
    const lat = Number(s.latitude), lng = Number(s.longitude);
    const city = text(s.city);
    // 「三鷹店 ※都市型」の「※都市型」等は業態区分なので店名から除く
    const name = text(s.name).replace(/\s*※.*$/, "");
    const seats = text(s.seats);
    const facilities = Object.entries(FACILITIES).filter(([k]) => s[k] === "1").map(([, label]) => label);
    if (/^\d+$/.test(seats)) facilities.push(`客席 ${seats}席`);
    return {
      id: `kps_${s.code}`,
      chain: "かっぱ寿司",
      name: `かっぱ寿司 ${name}`,
      prefecture: PREFECTURE,
      city,
      postal_code: "", // 公式データに項目なし
      address: PREFECTURE + city + text(s.address),
      phone: text(s.tel),
      latitude: lat,
      longitude: lng,
      hours: text(s.open_time).replace(/[～~]/g, "-"),
      parking: true,
      is_24h: false,
      drive_thru: "", // 公式データに項目なし
      kids_menu: "", // 公式データに項目なし
      table_seats: "", // 公式データに項目なし
      takeout_only: "", // 公式データに項目なし
      facilities: facilities.join(" / "),
      official_url: DETAIL(s.code),
      google_maps_url: mapsUrl(lat, lng),
    };
  });

  writeOutputs(sortBy(rows, (r) => r.address), outPath("kappa"), `かっぱ寿司 ${PREFECTURE} 駐車場あり店舗`);
}

run(main);
