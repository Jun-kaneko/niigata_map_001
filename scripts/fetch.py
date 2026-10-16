#!/usr/bin/env python3
"""新潟市オープンデータ CSV の取得。

- 取得・検証に成功したファイルだけ data/raw/ に置き換える（失敗時は既存を残す）
- 内容が変わったファイルだけ取得日を更新する（data/raw/fetch-log.json）
- 元ページの「最終更新日」も記録する（取れなければ前回値を残す）
- 1つでも失敗したら終了コード 1（GitHub Actions で通知に使う）

使い方: python3 scripts/fetch.py
"""
import hashlib
import json
import re
import sys
import time
import urllib.request
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from convert import RAW_DIR, decode_bytes, parse_rows  # noqa: E402
from sources import all_sources  # noqa: E402

USER_AGENT = "niigata-uchinochika-map/1.0 (open data fetch; weekly)"
MIN_BYTES = 200


def download(url, retries=3):
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=60) as r:
                if r.status != 200:
                    raise RuntimeError(f"HTTP {r.status}")
                return r.read()
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 * (i + 1))
    raise RuntimeError(f"取得失敗: {url}: {last}")


def page_updated(url):
    """ページ内の「最終更新日：2022年4月1日」を ISO 形式で返す。取れなければ None。"""
    try:
        html = download(url).decode("utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        return None
    m = re.search(r"最終更新日[：:]\s*(\d{4})年(\d{1,2})月(\d{1,2})日", html)
    return f"{int(m[1]):04d}-{int(m[2]):02d}-{int(m[3]):02d}" if m else None


def validate(data):
    if len(data) < MIN_BYTES:
        raise ValueError(f"ファイルが小さすぎます ({len(data)} bytes)")
    text, _, _ = decode_bytes(data)
    header, records = parse_rows(text)
    if not any(h in header for h in ("緯度", "latitude")):
        raise ValueError("緯度列が見つかりません")
    if not records:
        raise ValueError("データ行がありません")


def main():
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    log_path = RAW_DIR / "fetch-log.json"
    log = json.loads(log_path.read_text(encoding="utf-8")) if log_path.exists() else {}
    today = date.today().isoformat()
    failures = []
    for spec in all_sources():
        name = spec["file"]
        try:
            data = download(spec["url"])
            validate(data)
        except Exception as e:  # noqa: BLE001
            failures.append(f"{name}: {e}")
            print(f"[FAIL] {name}: {e}", file=sys.stderr)
            continue
        entry = log.get(name, {})
        digest = hashlib.sha256(data).hexdigest()
        updated = page_updated(spec["page"]) if "evacuation" not in name else None
        entry["pageUpdated"] = updated or entry.get("pageUpdated") or spec.get("page_updated_fallback")
        if entry.get("sha256") == digest:
            print(f"[SAME] {name}")
        else:
            (RAW_DIR / name).write_bytes(data)
            entry.update(sha256=digest, fetchedAt=today)
            print(f"[NEW ] {name}")
        entry["url"] = spec["url"]
        log[name] = entry
    log_path.write_text(json.dumps(log, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    if failures:
        print("取得に失敗したファイル:\n  " + "\n  ".join(failures), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
