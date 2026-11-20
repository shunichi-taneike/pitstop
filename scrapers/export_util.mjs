// 各チェーンの取得スクリプトで共通の処理（HTTP 取得・文字列処理・出力）。
//
// rows（オブジェクトの配列、列は FIELDS）を <out>.csv / .geojson / .kml に書き出す。
// 出力先は outPath() で stores/<chain>/<pref>_parking を得る。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const UA = "Mozilla/5.0 (compatible; store-map-script)";
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."); // プロジェクトルート（scrapers/ の親）
export const FIELDS = ["id", "chain", "name", "prefecture", "city", "postal_code", "address", "phone", "latitude",
  "longitude", "hours", "parking", "is_24h", "drive_thru", "kids_menu", "table_seats", "takeout_only", "facilities",
  "official_url", "google_maps_url"];

// ---------------------------------------------------------------- HTTP

export const sleep = (sec) => new Promise((r) => setTimeout(r, sec * 1000));

export async function httpGet(url, { referer, headers = {}, timeoutSec = 60 } = {}) {
  const h = { "User-Agent": UA, ...headers };
  if (referer) h.Referer = referer;
  const res = await fetch(url, { headers: h, signal: AbortSignal.timeout(timeoutSec * 1000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return await res.text();
}

export async function httpGetJson(url, opts) {
  return JSON.parse(await httpGet(url, opts));
}

// ---------------------------------------------------------------- 文字列処理

/** Unicode NFKC 正規化 */
export const nfkc = (s) => (s ?? "").normalize("NFKC");

/** Python の str.strip(chars) 相当。chars 省略時は空白を除去 */
export function strip(s, chars) {
  if (chars === undefined) return s.trim();
  const set = new Set([...chars]);
  const arr = [...s];
  let a = 0, b = arr.length;
  while (a < b && set.has(arr[a])) a++;
  while (b > a && set.has(arr[b - 1])) b--;
  return arr.slice(a, b).join("");
}

export const removePrefix = (s, p) => (s.startsWith(p) ? s.slice(p.length) : s);

/** 連続する空白を 1 つの半角スペースにまとめて前後を除去 */
export const squash = (s) => s.replace(/\s+/g, " ").trim();

const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ensp: " ", emsp: " ",
  thinsp: " ", zwnj: "‌", zwj: "‍", shy: "­", mdash: "—", ndash: "–", hellip: "…",
  yen: "¥", copy: "©", reg: "®", trade: "™", times: "×", divide: "÷", middot: "·", bull: "•", deg: "°",
  plusmn: "±", sect: "§", para: "¶", laquo: "«", raquo: "»", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  larr: "←", rarr: "→", uarr: "↑", darr: "↓",
};

/** Python の html.unescape 相当（数値参照と主要な名前付き参照） */
export function htmlUnescape(s) {
  return s.replace(/&(#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/g, (m, body) => {
    if (body[0] === "#") {
      const cp = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    return NAMED_ENTITIES[body] ?? m;
  });
}

/** タグを除去して実体参照を戻す */
export const stripTags = (s, repl = "") => htmlUnescape((s ?? "").replace(/<[^>]+>/g, repl));

/** Python の urllib.parse.quote（safe="/"）相当 */
export const pyQuote = (s) =>
  encodeURIComponent(s).replace(/%2F/g, "/").replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

/** 住所（都道府県付き）から市区町村を取り出す */
export function cityOf(address, prefecture) {
  const m = removePrefix(address, prefecture).match(/^(.+?郡.+?[町村]|.+?[市区]|.+?[町村])/);
  return m ? m[1] : "";
}

/** ローカル日付の YYYY-MM-DD */
export function todayIso() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** コードポイント順の文字列比較（Python の str の比較と同じ順序） */
export function compareStr(a, b) {
  const x = [...a], y = [...b];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i].codePointAt(0) - y[i].codePointAt(0);
    if (d) return d;
  }
  return x.length - y.length;
}

/** key 関数で安定ソート（元の配列は変更しない） */
export const sortBy = (arr, key) => [...arr].sort((a, b) => compareStr(key(a), key(b)));

/** 文字列中の start 位置から始まる JSON 値を 1 つ取り出す（Python の JSONDecoder.raw_decode 相当） */
export function rawDecodeJson(s, start = 0) {
  while (/\s/.test(s[start])) start++;
  const open = s[start];
  const close = open === "{" ? "}" : open === "[" ? "]" : null;
  if (!close) throw new Error("JSON の開始位置ではありません");
  let depth = 0, inStr = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      depth--;
      if (depth === 0) return JSON.parse(s.slice(start, i + 1));
    }
  }
  throw new Error("JSON が閉じていません");
}

// ---------------------------------------------------------------- 出力

export function mapsUrl(lat, lng) {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

/** 出力先のベースパス stores/<chain>/<pref>_parking（拡張子なし）。フォルダは自動作成 */
export function outPath(chainSlug, prefSlug = "tokyo") {
  const d = path.join(ROOT, "stores", chainSlug);
  fs.mkdirSync(d, { recursive: true });
  return path.join(d, `${prefSlug}_parking`);
}

/** ブランド指定の引数を検証（未指定なら全ブランド） */
export function brandArgs(brands) {
  const slugs = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(brands);
  const unknown = slugs.filter((s) => !(s in brands));
  if (unknown.length) {
    console.error(`未対応のブランド: ${unknown.join(", ")}（対応: ${Object.keys(brands).join(", ")}）`);
    process.exit(1);
  }
  return slugs;
}

const xmlEscape = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function csvCell(v) {
  const s = typeof v === "boolean" ? String(v).toUpperCase() : v == null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function writeOutputs(rows, out, title) {
  const lines = [FIELDS.join(","), ...rows.map((r) => FIELDS.map((k) => csvCell(r[k])).join(","))];
  fs.writeFileSync(`${out}.csv`, "﻿" + lines.map((l) => l + "\r\n").join(""), "utf8");

  const geo = {
    type: "FeatureCollection",
    features: rows.map((r) => {
      const props = {};
      for (const [k, v] of Object.entries(r)) if (k !== "latitude" && k !== "longitude") props[k] = v;
      return { type: "Feature", geometry: { type: "Point", coordinates: [r.longitude, r.latitude] }, properties: props };
    }),
  };
  fs.writeFileSync(`${out}.geojson`, JSON.stringify(geo, null, 1), "utf8");

  const marks = rows.map((r) => {
    const desc = `${xmlEscape(r.address)}<br>TEL: ${xmlEscape(r.phone)}<br>営業時間: ${xmlEscape(r.hours)}`
      + `<br>${xmlEscape(r.facilities)}<br><a href="${r.official_url}">公式ページ</a>`;
    return `<Placemark><name>${xmlEscape(r.name)}</name><description><![CDATA[${desc}]]></description>`
      + `<Point><coordinates>${r.longitude},${r.latitude},0</coordinates></Point></Placemark>`;
  });
  fs.writeFileSync(`${out}.kml`,
    '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document>'
    + `<name>${xmlEscape(title)}</name>${marks.join("")}</Document></kml>\n`, "utf8");

  console.log(`${rows.length}店舗 -> ${out}.{csv,geojson,kml}`);
}

/** main を実行し、例外時は終了コード 1 で終える */
export function run(main) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
