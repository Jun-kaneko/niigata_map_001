import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import convert as c  # noqa: E402

RAW = Path(__file__).resolve().parent.parent.parent / "data" / "raw"


class DecodeTest(unittest.TestCase):
    def test_utf8_bom(self):
        text, enc, bom = c.decode_bytes("﻿名称,緯度\n".encode("utf-8"))
        self.assertTrue(bom)
        self.assertEqual(text, "名称,緯度\n")

    def test_cp932(self):
        text, enc, _ = c.decode_bytes("名称,緯度\n".encode("cp932"))
        self.assertEqual(enc, "cp932")
        self.assertEqual(text, "名称,緯度\n")


class CoordTest(unittest.TestCase):
    def test_ok(self):
        self.assertEqual(c.to_coord("37.9", "139.0"), [139.0, 37.9])

    def test_missing(self):
        self.assertEqual(c.to_coord("", "139.0"), "座標なし")

    def test_out_of_range(self):
        self.assertEqual(c.to_coord("35.0", "139.0"), "範囲外")
        # 緯度経度の入れ替わりも範囲外として除外される
        self.assertEqual(c.to_coord("139.0", "37.9"), "範囲外")


class NormalizeTest(unittest.TestCase):
    def test_every_observed_value(self):
        # 段階1の全行集計で見つかった値の種類をすべて網羅する
        expected = {"○": "yes", "2階以上": "cond", "3階以上": "cond", "4階以上": "cond", "全階可": "cond",
                    "体育館": "cond", "×": "unknown", "－": "unknown", "": "nodata"}
        for raw, status in expected.items():
            self.assertEqual(c.normalize_disaster(raw), status, raw)

    def test_unknown_value_fails(self):
        with self.assertRaises(c.ConvertError):
            c.normalize_disaster("△")
        with self.assertRaises(c.ConvertError):
            c.normalize_disaster("5階以上")

    def test_raw_data_has_no_unknown_values(self):
        _, rows = c.read_csv("evacuation_space.csv")
        for r in rows:
            for col in c.DISASTERS.values():
                c.normalize_disaster(r[col])


class CapacityTest(unittest.TestCase):
    def test_parse(self):
        self.assertEqual(c.parse_capacity("3012人（1平方メートルあたり1人）"), 3012)
        self.assertEqual(c.parse_capacity("１，２００人（1平方メートルあたり1人）"), 1200)

    def test_none(self):
        self.assertIsNone(c.parse_capacity(""))
        self.assertIsNone(c.parse_capacity("不明"))


class NameFlagTest(unittest.TestCase):
    def test_aux(self):
        self.assertEqual(c.split_name("(補助避難所)豊栄武道館"), ("豊栄武道館", True, False))

    def test_unavailable(self):
        self.assertEqual(c.split_name("坂井輪中学校（現在使用不可）"), ("坂井輪中学校", False, True))

    def test_plain(self):
        self.assertEqual(c.split_name("葛塚小学校"), ("葛塚小学校", False, False))

    def test_match_key_ignores_marks(self):
        self.assertEqual(c.match_key("(補助避難所)豊栄武道館"), c.match_key("豊栄武道館"))


class OutputTest(unittest.TestCase):
    def test_idempotent(self):
        out = Path(__file__).resolve().parent.parent.parent / "public" / "data" / "shelter.geojson"
        before = out.read_text(encoding="utf-8")
        c.main()
        self.assertEqual(before, out.read_text(encoding="utf-8"))

    def test_shelter_flags(self):
        fc = json.loads((c.OUT_DIR / "shelter.geojson").read_text(encoding="utf-8"))
        props = [f["properties"] for f in fc["features"]]
        self.assertEqual(sum(p["aux"] for p in props), 22)
        self.assertEqual(sum(p["unavailable"] for p in props), 1)
        self.assertTrue(all(isinstance(p["cap_num"], int) for p in props))


if __name__ == "__main__":
    unittest.main()
