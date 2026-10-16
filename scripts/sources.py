"""取り込むデータの定義（取得・変換で共有する）。

col は元CSVの列名。(B) の GIS データは列名が SAFIELD000… と匿名のため、中身から確認した列を指定している。
page は元データのページ（最終更新日の取得に使う）。
"""
OD_TOP = "https://www.city.niigata.lg.jp/shisei/seisaku/it/open-data/"
GIS = OD_TOP + "opendata-gis/"

LICENSE_NOTE = "クリエイティブ・コモンズ・ライセンス 表示 2.1 日本"

# 避難場所の主データ (A)
SHELTER = dict(
    id="shelter", file="evacuation_space.csv", title="指定緊急避難場所一覧",
    url=OD_TOP + "index.files/151009_evacuation_space.csv", page=OD_TOP + "index.html",
    page_updated_fallback="2026-09-25",
)

# (B) 避難場所系。(A) と突き合わせて、(A) に無いものを別扱いにする
UNLISTED = [
    dict(id="okunai", file="okunaihinanjo.csv", title="屋内避難所", name="SAFIELD000", address="SAFIELD001",
         phone="SAFIELD002", ward="SAFIELD007", sub="屋内避難所",
         url=GIS + "od-gis_kurashibosai/od-gis_okunaihinanjo.files/od_gis_10161_okunaihinanjo.csv",
         page=GIS + "od-gis_kurashibosai/od-gis_okunaihinanjo.html"),
    dict(id="okugai", file="okugaihinan.csv", title="屋外避難場所", name="SAFIELD000", address="SAFIELD001",
         phone="SAFIELD002", ward=None, sub="屋外避難場所",
         url=GIS + "od-gis_kurashibosai/od-gis_okugaihinan.files/od_gis_10162_okugaihinanbasho.csv",
         page=GIS + "od-gis_kurashibosai/od-gis_okugaihinan.html"),
]

TSUNAMI = dict(
    id="tsunami", file="tsunamihinan.csv", title="津波避難ビル", name="SAFIELD001", address="SAFIELD002",
    place="SAFIELD003", capacity="SAFIELD004",
    url=GIS + "od-gis_kurashibosai/od-gis_tsunamihinan.files/od_gis_10171_tsunamihinan.csv",
    page=GIS + "od-gis_kurashibosai/od-gis_tsunamihinan.html",
)

# 点レイヤー（レイヤーID -> 元データのリスト）。sub はポップアップの小見出し
POINTS = {
    "water": [dict(file="kyotenkyusui.csv", title="拠点給水所", name="施設名", address="所在地", sub="拠点給水所",
                   url=GIS + "od-gis_dourosuido/od-gis_kyotenkyusui.files/20250306_kyotenkyusui.csv",
                   page=GIS + "od-gis_dourosuido/od-gis_kyotenkyusui.html", lat="緯度", lon="経度", ward="区名")],
    "aed": [dict(file="aed.csv", title="AED設置施設", name="SAFIELD000", address="SAFIELD001", sub="AED",
                 url=GIS + "od-gis_kenkofukushi/od-gis_aed.files/od_gis_10061_aed.csv",
                 page=GIS + "od-gis_kenkofukushi/od-gis_aed.html")],
    "childcare": [
        dict(file="hoikuen.csv", title="保育園", name="SAFIELD000", address="SAFIELD001", phone="SAFIELD002", sub="保育園",
             url=GIS + "od-gis_kenkofukushi/od-gis_hoikuen.files/od_gis_10031_hoikuen.csv",
             page=GIS + "od-gis_kenkofukushi/od-gis_hoikuen.html"),
        dict(file="kodomoen.csv", title="認定こども園", name="SAFIELD000", address="SAFIELD001", phone="SAFIELD002", sub="認定こども園",
             url=GIS + "od-gis_kenkofukushi/od-gis_kodomoen.files/od_gis_10043_kodomoen.csv",
             page=GIS + "od-gis_kenkofukushi/od-gis_kodomoen.html"),
        dict(file="hoikujigyosho.csv", title="地域型保育事業所", name="SAFIELD000", address="SAFIELD001", phone="SAFIELD002",
             sub="地域型保育事業所",
             url=GIS + "od-gis_kenkofukushi/od-gis_hoikujigyosho.files/od_gis_10044_hoikujigyosho.csv",
             page=GIS + "od-gis_kenkofukushi/od-gis_hoikujigyosho.html"),
        dict(file="yochien.csv", title="幼稚園", name="SAFIELD000", address="SAFIELD001", phone="SAFIELD002", sub="幼稚園",
             url=GIS + "od-gis_kosodate/od-gis_yochien.files/od_gis_10032_yochien.csv",
             page=GIS + "od-gis_kosodate/od-gis_yochien.html"),
        dict(file="jidoclub.csv", title="放課後児童クラブ", name="SAFIELD000", address="SAFIELD002", phone="SAFIELD003",
             sub="放課後児童クラブ",
             url=GIS + "od-gis_kosodate/od-gis_jidoclub.files/od_gis_10041_jidoclub.csv",
             page=GIS + "od-gis_kosodate/od-gis_jidoclub.html"),
        dict(file="jidocenter.csv", title="児童センター等", name="SAFIELD000", address="SAFIELD001", phone="SAFIELD002",
             sub="児童センター等",
             url=GIS + "od-gis_kosodate/od-gis_jidocenter.files/od_gis_10042_jidocenter.csv",
             page=GIS + "od-gis_kosodate/od-gis_jidocenter.html"),
    ],
    "community": [
        dict(file="community.csv", title="公民館", name="SAFIELD000", address="SAFIELD001", phone="SAFIELD002", sub="公民館",
             url=GIS + "od-gis_kosodate/od-gis_community.files/od_gis_10052_communitycenter.csv",
             page=GIS + "od-gis_kosodate/od-gis_community.html"),
        dict(file="communitycent.csv", title="コミュニティセンター等", name="SAFIELD000", address="SAFIELD001",
             phone="SAFIELD002", sub="コミュニティセンター等",
             url=GIS + "od-gis_kosodate/od-gis_communitycent.files/od_gis_10054_communitycenter_etc.csv",
             page=GIS + "od-gis_kosodate/od-gis_communitycent.html"),
        dict(file="library.csv", title="図書館", name="SAFIELD000", address="SAFIELD001", phone="SAFIELD002", sub="図書館",
             url=GIS + "od-gis_kosodate/od-gis_library.files/od_gis_10051_library.csv",
             page=GIS + "od-gis_kosodate/od-gis_library.html"),
    ],
    "park": [dict(file="park.csv", title="公園・緑地", name="SAFIELD000", address="SAFIELD001", sub="公園・緑地",
                  url=GIS + "od-gis_kurashibosai/od-gis_park.files/od_gis_10019_park.csv",
                  page=GIS + "od-gis_kurashibosai/od-gis_park.html")],
}


def all_sources():
    """取得対象の全データ（file, url, page, title を持つ dict）。"""
    out = [SHELTER, *UNLISTED, TSUNAMI]
    for specs in POINTS.values():
        out.extend(specs)
    return out
