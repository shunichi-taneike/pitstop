// モスバーガーの駐車場あり店舗を公式店舗検索 (www.mos.jp/shop/) から取得し、
// 他チェーンと同じ列構成の CSV / GeoJSON / KML に出力する。
//
// 店舗検索ページが読み込む全国店舗データ /data/shop/shop.json から、
// 都道府県コード 13（東京都）・モスバーガー業態・営業期間内・
// 設備 sv07（駐車場）= 1 の店舗を抽出する。
//
// 使い方: node scrapers/scrape_mos.mjs
// 出力:   stores/mos/tokyo_parking.{csv,geojson,kml}
import { httpGetJson, mapsUrl, nfkc, outPath, run, sortBy, todayIso, writeOutputs } from "./export_util.mjs";

const DATA = "https://www.mos.jp/data/shop/shop.json";
const DETAIL = (cd) => `https://www.mos.jp/shop/detail/?shop_cd=${cd}`;
const PREF_CD = "13", PREFECTURE = "東京都";
// モスバーガー業態（緑モス・赤モス・モスカフェ・プレミアム・特選メニュー）。あえん・マザーリーフ等は除外
const MOS_BUS_CDS = new Set(["MOS_GREEN", "MOS_RED", "MOS_CF", "MOS_PR", "MOS_SH"]);
const SERVICES = { // 店舗検索ページの「設備・サービス」チェックボックス名
  sv01: "朝モス", sv02: "ネット注文（お持ち帰り）", sv03: "こどモスプロジェクト", sv04: "お届けサービス",
  sv05: "MOSグッズ販売", sv06: "モスカフェ", sv07: "駐車場", sv08: "ドライブスルー",
  sv09: "お届けサービス（ネット注文）", sv10: "お席で注文", sv11: "コンセント席あり", sv12: "d Wi-Fi",
  sv13: "電話注文（お持ち帰り）", sv14: "アルコール", sv16: "バーコード決済", sv17: "電子マネー",
  sv18: "クレジットカード", sv19: "特別メニュー", sv20: "dポイント",
};

const clean = (s) => nfkc(s).trim();
const span = (o, c) => (o && c ? `${o}-${c}` : "-");

async function main() {
  const { shops } = await httpGetJson(DATA, { referer: "https://www.mos.jp/shop/search/" });
  const today = todayIso();
  const tokyo = shops.filter((s) => s.pref_cd === PREF_CD && MOS_BUS_CDS.has(s.bus_cd)
    && s.openingday <= today && today <= s.closingday);
  const parking = tokyo.filter((s) => s.sv07 === 1);
  console.log(`${PREFECTURE}: モスバーガー全${tokyo.length}店舗中 駐車場あり ${parking.length}店舗`);

  const rows = sortBy(parking, (s) => s.addr_all).map((s) => {
    const lat = Number(s.lat), lng = Number(s.lon);
    const wd = span(s.wday_open, s.wday_close);
    const hours = [..."月火水木金"].map((d) => `${d} ${wd}`)
      .concat(`土 ${span(s.sat_open, s.sat_close)}`, `日・祝 ${span(s.hol_open, s.hol_close)}`);
    const notes = ["wday_comment", "sat_comment", "hol_comment"].map((k) => clean((s[k] || "").replace(/<[^>]+>/g, " ")));
    const hoursText = hours.join(" / ") + [...new Set(notes.filter(Boolean))].map((n) => `（${n}）`).join("");
    const tel = [s.tel1, s.tel2, s.tel3].filter(Boolean).join("-");
    return {
      id: `mos_${s.shop_cd}`,
      chain: "モスバーガー",
      name: clean(s.name),
      prefecture: PREFECTURE,
      city: clean(s.city_name),
      postal_code: s.zip1 && s.zip2 ? `${s.zip1}-${s.zip2}` : "",
      address: clean(s.addr_all),
      phone: tel,
      latitude: lat,
      longitude: lng,
      hours: hoursText,
      parking: true,
      is_24h: ["00:00-24:00", "00:00-23:59"].includes(wd),
      drive_thru: s.sv08 === 1,
      kids_menu: "", // 公式データに項目なし
      table_seats: "", // 公式データに項目なし
      takeout_only: "", // 公式データに項目なし
      facilities: Object.entries(SERVICES).filter(([k]) => s[k] === 1).map(([, label]) => label).join(" / "),
      official_url: DETAIL(s.shop_cd),
      google_maps_url: mapsUrl(lat, lng),
    };
  });

  writeOutputs(rows, outPath("mos"), `モスバーガー ${PREFECTURE} 駐車場あり店舗`);
}

run(main);
