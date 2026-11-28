# /// script
# requires-python = ">=3.10"
# dependencies = ["requests", "opencc-python-reimplemented", "imageio-ffmpeg", "numpy", "onnxruntime"]
# ///
"""Refresh the playable Eason Chan catalogue: uv run scripts/catalog.py.

Only track IDs, display titles, and vocal offsets are published. Provider previews
are decoded in memory, checked for a ten-second vocal window, and discarded.
"""
import argparse
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import re
import subprocess
import tempfile
import time
import unicodedata

import imageio_ffmpeg
import numpy as np
import onnxruntime as ort
from opencc import OpenCC
import requests

ARTIST = 75172
BASE = "https://api.deezer.com"
ROOT = Path(__file__).resolve().parents[1]
MODEL_URL = "https://raw.githubusercontent.com/snakers4/silero-vad/master/src/silero_vad/data/silero_vad.onnx"
SIMPLIFY = OpenCC("t2s")
KNOWN = {7278824: 6.3, 1100108: 12.9, 13675223: 2.4, 13675222: 8.6,
         672506742: 18.9, 1571246282: 18, 1100103: 7.2, 1100105: 9}

# Some labels supply official Chinese songs as pinyin or English titles.
# FEAR and DREAMS localizations follow the HK release (Apple album 1831490372).
ALIASES = dict(line.split("|") for line in """
Warrior of the Darkness|孤勇者
Tuo Fei Lun|陀飞轮
Wu Ren Zhi Jing|无人之境
Yi Si Bu Gua|一丝不挂
Xin Fu|心腹
Wei Zhi Su|味之素
Da Ren|大人
Tian Xia Mo Shuang|天下无双
Shang Xin|伤信
Wo De Kuai Le Shi Dai|我的快乐时代
Wo De Shi Jie Mo Ri|我的世界末日
Huang Jin Shi Dai|黄金时代
Wo Shen Me Dou Mei You|我什么都没有
我甚么都没有|我什么都没有
Bei Duo Fen Yu Wo|贝多芬与我
Shi Dai Qu|时代曲
Shi Guang Dao Liu Er Shi Nian|时光倒流二十年
Xing Fu Mo Tian Lun|幸福摩天轮
Happy Ferris Wheel|幸福摩天轮
Mei Yi Ge Ming Tian|每一个明天
Na Yi Ye You Mei You Xue|那一夜有没有说
Na Yi Ye You Mei You Shuo|那一夜有没有说
Na Yi Ye You Mei You Shui|那一夜有没有说
Fan Gao Chao|反高潮
Bitter Gourd|苦瓜
Mei Li You Zui|美丽有罪
Xin Sheng Huo|新生活
Tian Yi Ban, De Yi Ban|天一半，地一半
Yu Wo Chang Zai|与我常在
Qing Xiang Xin Wo|请相信我
Jin Ri|今日
Zuo Ri|昨日
Jin Tian Deng Wo Lai|今天等我来
Hei Ye Bu Zai Lai|黑夜不再来
Ru Guo Zhe Yi Miao Zhong Ni Gen Wo Jiang Ni Bu Ai Wo|如果这一秒钟你跟我讲你不爱我
Dang Zhe De Qiu Mei You Hua|当这地球没有花
Chao Ren De Zhu Ti Qu|超人的主题曲
Theme of Ultraman|超人的主题曲
Di Wu Ge Xian Dai Hua|第五个现代化
Xun Kai Xin|寻开心
Deng|等
Yao Yuan De Ta|遥远的她
La Ji|垃圾
Bu Zai Rang Ni Gudan|不再让你孤单
Fen Dou|奋斗
Fei Zou Bu Ke|非走不可
Liang Zhong Jiang Fa|两种讲法
Kuai Gao Chang Da|快高长大
Chun Guang Zha Xie|春光乍泄
Gen Wo Zou Hao Ma|跟我走好吗
An Shou Ben Fen|安守本分
Ai Mei You Zuo You|爱没有左右
Ai Shang Ni Shi Wo Yan Jing De Cuo|爱上你是我眼睛的错
Di Ren|敌人
Hui Jue|回绝
Dang Xin Zhong You Lian Ai Gan Jiao|当心中有恋爱感觉
Dao Ci Yi You|到此一游
You Li Fen Zi|游离分子
Wo Pa Ni Bu Ken|我怕你不肯
Zhong Wu Yi Bai Ri|终于一百日
Bao Yong Zhe Fen Chong|抱拥这分钟
De Yu Zhou|地狱咒
Piao Piao Piao Piao|飘飘飘飘
He Ping Fan Dian|和平饭店
Wo Men Bu Ku Le|我们不哭了
Qi Shi Wo Ji De|其实我记得
Tian Wang|天网
Duo Yi Dian|多一点
Xiang Xin Xiang Yi|相信相依
Mud Yeah Jeah|乜嘢啫
See Doi Gui Lun|时代巨轮
Been Sick Lung|变色龙
Because Of Love|因为爱情
A Dance For Tomorrow|致明日的舞
a space odyssey|2001太空漫游
man vs god|人神斗
imagine a world without flowers|当这地球没有花
lies|谎言
will it ever stop|时代巨轮
what if|想听
black hole|黑洞
tequila|龙舌兰
wish we still were|异梦
if you don’t love me|如果这一秒钟你跟我讲你不爱我
what will it take|黑夜不再来
just let me be|开不了心
farewell saha|告别娑婆
the end|完
today|今日
it hasn’t happened yet|梦的可能
monologue|一个灵魂的独白
wander|任我行
marathon|人生马拉松
believe in me|请相信我
seasons|四季
forget with me|常在·忘记
grown up|大人
distant future|七百年后
ferris wheel|幸福摩天轮
long live us|我们万岁
""".strip().splitlines())
ALIASES = {k.casefold(): v for k, v in ALIASES.items()}
NON_VOCAL = re.compile(
    r"instrumental|karaoke|interlude|overture|mozart.s requiem|\bintro\b|"
    r"纯音乐|伴奏版|卡拉OK|串烧|medley|\s\+\s|NG take", re.I
)
VERSION = re.compile(r"\s*[（(](?:国(?:语)?|粤(?:语)?|英(?:语)?|[^)]*?(?:主题曲|主打歌|推广曲|广告歌|片头曲|片尾曲|remix|live|version|remaster|演唱会|remix|重唱版|feat\.|zhu ti qu|pian tou qu|pian wei qu)[^)]*)[)）]", re.I)


def api(url):
    for attempt in range(4):
        try:
            response = requests.get(url, timeout=(6, 16))
            response.raise_for_status()
            data = response.json()
            if "error" in data:
                raise ValueError(str(data["error"]))
            return data
        except (requests.RequestException, ValueError):
            if attempt == 3:
                raise
            time.sleep(2**attempt)


def pages(url):
    rows = []
    while url:
        data = api(url)
        rows.extend(data["data"])
        url = data.get("next")
    return rows


def song_name(track):
    title = unicodedata.normalize("NFKC", SIMPLIFY.convert(track["title_short"])).strip()
    if title.startswith("Warrior of the Darkness"):
        return "孤勇者"
    if track["title_short"].startswith("这样很好"):
        return "这样很好"
    if title.startswith("《同舟之情》"):
        return "同舟之情"
    if title.startswith("夕阳无限好"):
        return "夕阳无限好"
    if title.startswith("K歌之王 AIR"):
        return "K歌之王"
    if title == "Mud Yeah Jeah (乜嘢啫)":
        return "乜嘢啫"
    title = VERSION.sub("", title).strip()
    return ALIASES.get(title.casefold(), title)


def candidates(albums, album_lists, top):
    grouped = defaultdict(dict)
    for album, tracks in zip([*albums, {"title": ""}], [*album_lists, top]):
        for track in tracks:
            if track["artist"]["id"] != ARTIST or not track.get("preview") or track.get("duration", 0) < 35:
                continue
            if NON_VOCAL.search(SIMPLIFY.convert(track["title"])):
                continue
            name = song_name(track)
            if not name:
                continue
            key = re.sub(r"[\W_]+", "", name.casefold())
            live = re.search(r"live|concert|stage|唱会|fear and dreams", track["title"]+" "+album["title"], re.I)
            score = (track["id"] in KNOWN, not live, not track.get("title_version"), track.get("rank", 0))
            existing = grouped[key].get(track["id"])
            if not existing or score > existing[0]:
                grouped[key][track["id"]] = (score, name, track)
    return grouped


def vocal_detector():
    cache = Path(tempfile.gettempdir())/"eason-voice-model"/"vad.onnx"
    if not cache.exists():
        response = requests.get(MODEL_URL, timeout=30)
        response.raise_for_status()
        cache.parent.mkdir(exist_ok=True)
        cache.write_bytes(response.content)
    options = ort.SessionOptions()
    options.intra_op_num_threads = options.inter_op_num_threads = 1
    return ort.InferenceSession(str(cache), options, providers=["CPUExecutionProvider"])


def vocal_window(model, recording, known):
    pcm = subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-v", "error", "-i", "pipe:0",
                           "-f", "s16le", "-ar", "16000", "-ac", "1", "pipe:1"],
                          input=recording, capture_output=True, timeout=18, check=True).stdout
    x = np.frombuffer(pcm, dtype="<i2").astype(np.float32)/32768
    if len(x) < 160_000:
        return None
    if known is not None and len(x) >= (known+10)*16000:
        return known
    state = np.zeros((2, 1, 128), dtype=np.float32)
    context = np.zeros(64, dtype=np.float32)
    sr = np.array(16000, dtype=np.int64)
    probabilities = []
    for i in range(0, len(x)-512, 512):
        chunk = x[i:i+512]
        params = {"input": np.r_[context, chunk][None, :], "state": state, "sr": sr}
        probability, state = model.run(None, params)
        probabilities.append(float(probability[0, 0]))
        context = chunk[-64:]
    speech = np.array(probabilities)
    width = 313  # ten seconds in frames
    if len(speech) < width or speech.max() < .40:
        return None
    # Score every 128 ms, with extra weight on the opening syllables.
    starts = np.arange(0, len(speech)-width+1, 4)
    def average(scores, frames):
        cumulative = np.r_[0, np.cumsum(scores)]
        return (cumulative[starts+frames]-cumulative[starts])/frames
    quality = .65*average(speech > .4, width) + .35*average(speech, 40)
    best = quality.argmax()
    return round(float(starts[best])*.032, 2) if quality[best] >= .20 else None


def choose_recording(model, versions):
    for _, name, track in sorted(versions.values(), key=lambda row: row[0], reverse=True):
        try:
            preview = requests.get(track["preview"], timeout=(6, 14))
            if preview.status_code in (401, 403):
                fresh = api(f"{BASE}/track/{track['id']}")
                if not fresh.get("preview") or fresh["artist"]["id"] != ARTIST:
                    continue
                preview = requests.get(fresh["preview"], timeout=(6, 14))
            preview.raise_for_status()
            offset = vocal_window(model, preview.content, KNOWN.get(track["id"]))
            if offset is not None:
                return {"name": name, "id": track["id"], "offset": offset}
        except (requests.RequestException, ValueError, subprocess.SubprocessError):
            continue
    return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--metadata-cache", type=Path, help="optional directory for temporary API metadata")
    args = parser.parse_args()
    def metadata(name, url):
        if args.metadata_cache is None:
            return pages(url)
        path = args.metadata_cache/(name+".json")
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
        rows = pages(url)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
        return rows
    albums = metadata("albums", f"{BASE}/artist/{ARTIST}/albums?limit=100")
    top = metadata("top", f"{BASE}/artist/{ARTIST}/top?limit=100")
    with ThreadPoolExecutor(max_workers=5) as pool:
        tracks = list(pool.map(lambda a: metadata(str(a["id"]), a["tracklist"]+"?limit=100"), albums))
    groups = candidates(albums, tracks, top)
    print(f"{len(albums)} releases; {sum(map(len, tracks))} album entries; {len(top)} artist top entries; "
          f"{len(groups)} distinct eligible titles before audio checks", flush=True)
    model = vocal_detector()
    selections = []
    with ThreadPoolExecutor(max_workers=5) as pool:
        for i, item in enumerate(pool.map(lambda versions: choose_recording(model, versions), groups.values()), 1):
            if item:
                selections.append(item)
            if i % 30 == 0:
                print(f"Checked {i}/{len(groups)}, playable {len(selections)}", flush=True)
    if len(selections) < 100:
        raise RuntimeError("Too few playable songs; preserving the previous catalogue.")
    target = ROOT/"dist"/"catalog.json"
    hot_names = {song["name"] for song in json.loads(target.read_text(encoding="utf-8")) if song.get("hot")}
    for song in selections:
        if song["name"] in hot_names:
            song["hot"] = True
    if sum(song.get("hot", False) for song in selections) < 10:
        raise RuntimeError("Too few playable hot songs; preserving the previous catalogue.")
    ordered = sorted(selections, key=lambda t: t["name"])
    staged = target.with_suffix(".tmp")
    staged.write_text(json.dumps(ordered, ensure_ascii=False, separators=(",", ":"))+"\n", encoding="utf-8")
    staged.replace(target)
    print(f"Published {len(ordered)} playable titles", flush=True)


if __name__ == "__main__":
    main()
