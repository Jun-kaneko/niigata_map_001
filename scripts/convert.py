#!/usr/bin/env python3
"""新潟市オープンデータ CSV → GeoJSON 変換スクリプト。

- 文字コードを自動判定して UTF-8 に統一する（UTF-8 / BOM付きUTF-8 / CP932）
- 座標のない行・範囲外の行は出力せず、除外件数を変換ログに残す（推測補完はしない）
- 災害種別の値は正規化表で変換し、表にない値が出たら失敗する（市が値の種類を増やしたことに気づくため）
- 同じ入力から常に同じ出力になる（冪等）。取得日は data/raw/fetch-log.json から読む

使い方: python3 scripts/convert.py
"""
import csv
import io
import json
import math
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"
OUT_DIR = ROOT / "public" / "data"
DOCS_DIR = ROOT / "docs"

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sources import POINTS, SHELTER, TSUNAMI, UNLISTED  # noqa: E402

# 新潟市を含む範囲（依頼書の目安）
LAT_RANGE = (37.6, 38.1)
LON_RANGE = (138.7, 139.4)

# (A) の災害種別列。キーは画面・GeoJSONで使う短い名前
DISASTERS = {
    "flood": "災害種別_洪水",
    "tsunami": "災害種別_津波",
    "quake": "災害種別_地震",
    "landslide": "災害種別_崖崩れ、土石流及び地滑り",
    "fire": "災害種別_大規模な火事",
    "storm_surge": "災害種別_高潮",
    "inland_flood": "災害種別_内水氾濫",
    "volcano": "災害種別_火山現象",
}

# 災害種別の値の正規化（段階1で全行を集計した値の種類）。意味は市の説明が確認できた範囲だけ:
#   yes: ○ ／ cond: 階数・場所の条件つき（文言をそのまま表示） ／ unknown: × と －（意味未確認のため「不明」）
#   nodata: 空欄
STATUS_YES, STATUS_COND, STATUS_UNKNOWN, STATUS_NODATA = "yes", "cond", "unknown", "nodata"
VALUE_MAP = {
    "○": STATUS_YES,
    "2階以上": STATUS_COND, "3階以上": STATUS_COND, "4階以上": STATUS_COND,
    "全階可": STATUS_COND, "体育館": STATUS_COND,
    "×": STATUS_UNKNOWN, "－": STATUS_UNKNOWN,
    "": STATUS_NODATA,
}

SHELTER_REQUIRED = ["名称", "名称_カナ", "所在地_連結表記", "所在地_市区町村", "緯度", "経度",
                    "電話番号", "URL", "指定避難所との重複", "想定収容人数", "備考", *DISASTERS.values()]

AUX_PREFIX = "(補助避難所)"
UNAVAILABLE_SUFFIX = "（現在使用不可）"

_DIGITS = str.maketrans("０１２３４５６７８９", "0123456789")


class ConvertError(Exception):
    pass


def decode_bytes(data):
    """(テキスト, 文字コード名, BOMの有無)。UTF-8 を先に試し、だめなら CP932。"""
    bom = data.startswith(b"\xef\xbb\xbf")
    for enc in ("utf-8-sig", "cp932"):
        try:
            return data.decode(enc), enc, bom
        except UnicodeDecodeError:
            continue
    raise ConvertError("文字コードを判定できません")


def parse_rows(text):
    rows = list(csv.reader(io.StringIO(text)))
    if not rows:
        return [], []
    header = [h.strip() for h in rows[0]]
    return header, [dict(zip(header, r)) for r in rows[1:] if any(c.strip() for c in r)]


def read_csv(name):
    data = (RAW_DIR / name).read_bytes()
    text, _, _ = decode_bytes(data)
    return parse_rows(text)


def normalize_disaster(value):
    v = (value or "").strip()
    if v not in VALUE_MAP:
        raise ConvertError(f"災害種別の未知の値: {v!r}（正規化表 VALUE_MAP に無い）")
    return VALUE_MAP[v]


def parse_capacity(text):
    """「3012人（1平方メートルあたり1人）」→ 3012。取り出せなければ None。"""
    m = re.match(r"\s*([0-9,，]+)\s*人", (text or "").translate(_DIGITS))
    return int(re.sub(r"[,，]", "", m[1])) if m else None


def split_name(raw):
    """名称から「補助避難所」「現在使用不可」の印を取り、(表示名, 補助, 使用不可) を返す。"""
    name = raw.strip()
    aux = name.startswith(AUX_PREFIX)
    if aux:
        name = name[len(AUX_PREFIX):].strip()
    unavailable = UNAVAILABLE_SUFFIX in name
    if unavailable:
        name = name.replace(UNAVAILABLE_SUFFIX, "").strip()
    return name, aux, unavailable


def match_key(name):
    """(A) と (B) の名称照合用。印・空白・全角半角の差を除く。"""
    n = unicodedata.normalize("NFKC", name)
    n = n.replace("(補助避難所)", "").replace("（現在使用不可）", "").replace("(現在使用不可)", "")
    return re.sub(r"\s+", "", n)


def clean_text(s):
    return re.sub(r"\s+", " ", (s or "").translate(_DIGITS).replace("　", " ")).strip()


def to_coord(lat, lon):
    """(経度, 緯度) か、不正なら理由の文字列。"""
    try:
        y, x = float(lat), float(lon)
    except (TypeError, ValueError):
        return "座標なし"
    if not (LAT_RANGE[0] <= y <= LAT_RANGE[1] and LON_RANGE[0] <= x <= LON_RANGE[1]):
        return "範囲外"
    return [round(x, 6), round(y, 6)]


def dist_m(a, b):
    dy = (a[1] - b[1]) * 111000
    dx = (a[0] - b[0]) * 111000 * math.cos(math.radians(37.9))
    return math.hypot(dx, dy)


def feature(coord, props):
    return {"type": "Feature", "geometry": {"type": "Point", "coordinates": coord}, "properties": props}


def convert_shelters(log):
    header, rows = read_csv(SHELTER["file"])
    missing = [c for c in SHELTER_REQUIRED if c not in header]
    if missing:
        raise ConvertError(f"{SHELTER['file']}: 列が見つかりません: {missing}")
    feats, excluded = [], {}
    for i, r in enumerate(rows, start=1):
        coord = to_coord(r["緯度"], r["経度"])
        if isinstance(coord, str):
            excluded[coord] = excluded.get(coord, 0) + 1
            log.append(f"- 除外({coord}): {r['名称']}")
            continue
        name, aux, unavailable = split_name(r["名称"])
        dz = {}
        for key, col in DISASTERS.items():
            raw = r[col].strip()
            dz[key] = [normalize_disaster(raw), raw]
        cap_text = r["想定収容人数"].strip()
        feats.append(feature(coord, {
            "id": f"s{i}",
            "name": name,
            "kana": r["名称_カナ"].strip(),
            "address": clean_text(r["所在地_連結表記"]),
            "ward": r["所在地_市区町村"].replace("新潟市", "").strip(),
            "phone": r["電話番号"].strip(),
            "url": r["URL"].strip(),
            "aux": aux,
            "unavailable": unavailable,
            "dup": r["指定避難所との重複"].strip() == "1",
            "cap_text": cap_text,
            "cap_num": parse_capacity(cap_text),
            "note": r["備考"].strip(),
            "sub": "指定緊急避難場所",
            "dz": dz,
        }))
    return feats, len(rows), excluded


def points_from(spec, log, prefix):
    """(B) 系の点データを共通の形に変換する。"""
    header, rows = read_csv(spec["file"])
    lat_c, lon_c = spec.get("lat", "latitude"), spec.get("lon", "longitude")
    for need in (lat_c, lon_c, spec["name"], spec["address"]):
        if need not in header:
            raise ConvertError(f"{spec['file']}: 列 {need} が見つかりません")
    out, excluded = [], {}
    for i, r in enumerate(rows, start=1):
        coord = to_coord(r[lat_c], r[lon_c])
        name = clean_text(r[spec["name"]])
        if isinstance(coord, str):
            excluded[coord] = excluded.get(coord, 0) + 1
            log.append(f"- 除外({coord}): {spec['title']} {name}")
            continue
        props = {"id": f"{prefix}{i}", "name": name, "address": clean_text(r[spec["address"]]),
                 "sub": spec["sub"] if "sub" in spec else spec["title"]}
        for key in ("phone", "ward"):
            col = spec.get(key)
            if col and col in r:
                props[key] = clean_text(r[col])
        out.append(feature(coord, props))
    return out, len(rows), excluded


def points_tsunami(log):
    spec = TSUNAMI
    header, rows = read_csv(spec["file"])
    out, excluded = [], {}
    for i, r in enumerate(rows, start=1):
        coord = to_coord(r["latitude"], r["longitude"])
        name = clean_text(r[spec["name"]])
        if isinstance(coord, str):
            excluded[coord] = excluded.get(coord, 0) + 1
            log.append(f"- 除外({coord}): 津波避難ビル {name}")
            continue
        out.append(feature(coord, {
            "id": f"t{i}", "name": name, "address": clean_text(r[spec["address"]]),
            "sub": "津波避難ビル", "place": clean_text(r[spec["place"]]),
            "capacity": clean_text(r[spec["capacity"]]),
        }))
    return out, len(rows), excluded


def find_match(feat, shelters):
    """(A) の中で同じ施設と思われるもの。名称一致かつ200m以内、または50m以内で名称が似る場合のみ。"""
    key = match_key(feat["properties"]["name"])
    here = feat["geometry"]["coordinates"]
    best = None
    for s in shelters:
        d = dist_m(here, s["geometry"]["coordinates"])
        same_name = match_key(s["properties"]["name"]) == key
        if (same_name and d < 200) or d < 50:
            if best is None or d < best[0]:
                best = (d, s)
    return best[1] if best else None


def write_json(path, obj):
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n",
                    encoding="utf-8")


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    fetch_log = {}
    p = RAW_DIR / "fetch-log.json"
    if p.exists():
        fetch_log = json.loads(p.read_text(encoding="utf-8"))
    log = ["# 変換ログ", "", "（`python3 scripts/convert.py` が自動生成）", ""]
    manifest = {}

    def meta(spec, rows, excluded):
        fl = fetch_log.get(spec["file"], {})
        return {"title": spec["title"], "file": spec["file"], "url": spec.get("url", ""), "page": spec.get("page", ""),
                "pageUpdated": fl.get("pageUpdated") or spec.get("page_updated_fallback", ""),
                "fetchedAt": fl.get("fetchedAt", ""), "rows": rows, "excluded": sum(excluded.values()),
                "excludedReasons": excluded}

    # (A) 主データ
    shelters, rows, exc = convert_shelters(log)
    sources = {"shelter": [meta(SHELTER, rows, exc)]}

    # (B) 津波避難ビル: (A) にあるものは (A) に情報を足し、無いものだけ別レイヤーにする
    tsunami_all, rows, exc = points_tsunami(log)
    sources["tsunami"] = [meta(TSUNAMI, rows, exc)]
    tsunami_only, t_matched = [], 0
    for t in tsunami_all:
        m = find_match(t, shelters)
        if m:
            t_matched += 1
            m["properties"]["tsunami_bldg"] = {"place": t["properties"]["place"], "capacity": t["properties"]["capacity"]}
        else:
            tsunami_only.append(t)

    # (B) 屋内避難所・屋外避難場所: (A) に無いものだけ「(A) 未収録」
    unlisted, u_stat = [], {}
    sources["unlisted"] = []
    for spec in UNLISTED:
        feats, rows, exc = points_from(spec, log, spec["id"][0])
        kept = [f for f in feats if not find_match(f, shelters)]
        for f in kept:
            f["properties"]["unlisted"] = True
        u_stat[spec["id"]] = (len(feats), len(kept))
        unlisted.extend(kept)
        sources["unlisted"].append(meta(spec, rows, exc))

    layers = {"shelter": shelters, "unlisted": unlisted, "tsunami": tsunami_only}
    for lid, specs in POINTS.items():
        feats = []
        sources[lid] = []
        for spec in specs:
            f, rows, exc = points_from(spec, log, f"{lid[0]}{len(feats)}_")
            feats.extend(f)
            sources[lid].append(meta(spec, rows, exc))
        layers[lid] = feats

    for lid, feats in layers.items():
        write_json(OUT_DIR / f"{lid}.geojson", {"type": "FeatureCollection", "features": feats})
        manifest[lid] = {"count": len(feats), "sources": sources[lid]}
    manifest["_summary"] = {
        "tsunamiBuildingsInShelter": t_matched,
        "unlisted": {k: {"rows": a, "notInShelter": b} for k, (a, b) in u_stat.items()},
        "auxCount": sum(1 for s in shelters if s["properties"]["aux"]),
        "unavailableCount": sum(1 for s in shelters if s["properties"]["unavailable"]),
    }
    write_json(OUT_DIR / "manifest.json", manifest)

    log.append("## 件数")
    log.append("")
    for lid, m in manifest.items():
        if lid.startswith("_"):
            continue
        ex = sum(s["excluded"] for s in m["sources"])
        log.append(f"- {lid}: 地図 {m['count']} 件（座標なし・範囲外で除外 {ex} 件）")
    log.append(f"- 津波避難ビルのうち (A) と同じ施設と判定: {t_matched} 件（(A) に情報を追加）")
    for k, (a, b) in u_stat.items():
        log.append(f"- {k}: {a} 件中 (A) に無いもの {b} 件を「(A) 未収録」として表示")
    (DOCS_DIR / "convert-log.md").write_text("\n".join(log) + "\n", encoding="utf-8")
    print("\n".join(log))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except ConvertError as e:
        print(f"変換エラー: {e}", file=sys.stderr)
        sys.exit(1)
