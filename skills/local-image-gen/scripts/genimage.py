#!/usr/bin/env python3
"""本機生圖（MiniMax H3-Image）：LocModel 或 ComfyUI，自動挑開著的那個。

指令（每個都輸出一行 JSON）：
  genimage.py status
  genimage.py generate --prompt "..." [--aspect 9:16 | --width W --height H] [--megapixels 1.0]
                       [--steps 6] [--seed N] [--count 1] [--backend auto|locmodel|comfyui]
                       [--name 檔名前綴] [--out-dir D:\\AI\\dashboard]

只用標準函式庫。顯卡同時只能跑一個後端：LocModel 生圖頁開著就用它，否則用 ComfyUI。
"""
import argparse
import base64
import json
import math
import os
import random
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

LOCMODEL_URL = os.environ.get("LOCAL_IMAGE_LOCMODEL_URL", "http://127.0.0.1:8790")
COMFY_URL = os.environ.get("LOCAL_IMAGE_COMFY_URL", "http://127.0.0.1:8188")
DEFAULT_OUT_DIR = os.environ.get("LOCAL_IMAGE_OUT_DIR", r"D:\AI\dashboard")

COMFY_UNET = "minimax_h3_image_pruned-Q8_0.gguf"
COMFY_CLIP = "qwen3vl_32b_minimax_h3-Q4_K_M.gguf"  # 工作用一律原版編碼器
COMFY_VAE = "minimax_h3_image_vae_fp16.safetensors"

MAX_PIXELS = 16_800_000  # 模型原生上限約 16 MP
ASPECT_RE = re.compile(r"^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$")


class BackendUnavailable(RuntimeError):
    pass


# ---------- 純邏輯 ----------

def _r32(x):
    return max(32, int(round(x / 32.0)) * 32)


def resolve_size(aspect=None, megapixels=None, width=None, height=None):
    """回傳 (寬, 高)，都是 32 的倍數。給寬高就用寬高；否則用比例＋百萬像素（預設 1:1、1 MP）。"""
    if (width is None) != (height is None):
        raise ValueError("寬和高要一起給，或改用 --aspect")
    if width is not None:
        w, h = _r32(width), _r32(height)
    else:
        m = ASPECT_RE.match(aspect or "1:1")
        if not m:
            raise ValueError(f"比例格式錯誤：{aspect!r}（例如 9:16、4:5、16:9）")
        a, b = float(m.group(1)), float(m.group(2))
        if a <= 0 or b <= 0:
            raise ValueError(f"比例格式錯誤：{aspect!r}")
        px = (megapixels or 1.048576) * 1e6
        w = _r32(math.sqrt(px * a / b))
        h = _r32(math.sqrt(px * b / a))
    if w * h > MAX_PIXELS:
        raise ValueError(f"{w}x{h} 超過模型上限（約 16 MP）")
    return w, h


def choose_backend(status, preferred="auto"):
    if preferred in ("locmodel", "comfyui"):
        if status.get(preferred):
            return preferred
        raise BackendUnavailable(_how_to_start(preferred))
    if status.get("locmodel"):
        return "locmodel"
    if status.get("comfyui"):
        return "comfyui"
    raise BackendUnavailable("LocModel 和 ComfyUI 都沒開。請使用者擇一打開：" + _how_to_start("locmodel")
                             + "；或 " + _how_to_start("comfyui") + "。兩個不要同時生圖（顯卡記憶體不夠）。")


def _how_to_start(name):
    if name == "locmodel":
        return "LocModel 打開「畫圖」頁並生成一張（生圖引擎才會啟動，127.0.0.1:8790）"
    return "ComfyUI 桌面版打開（127.0.0.1:8188），並先關掉 LocModel 的畫圖頁"


def _safe(name):
    name = re.sub(r'[\\/:*?"<>|\s]+', "_", name or "img").strip("._")
    return (name or "img")[:60]


def next_output_path(out_dir, name, seed):
    base = f"{time.strftime('%Y%m%d-%H%M%S')}_{_safe(name)}_s{seed}"
    path = os.path.join(out_dir, base + ".png")
    i = 2
    while os.path.exists(path):
        path = os.path.join(out_dir, f"{base}_{i}.png")
        i += 1
    return path


def locmodel_payload(prompt, width, height, steps=6, seed=0):
    return {"prompt": prompt, "width": width, "height": height, "steps": steps, "seed": seed, "cfg_scale": 1}


def comfy_graph(prompt, width, height, steps=6, seed=0, prefix="dashboard/img"):
    return {
        "1": {"class_type": "UnetLoaderGGUF", "inputs": {"unet_name": COMFY_UNET}},
        "2": {"class_type": "CLIPLoaderGGUF", "inputs": {"clip_name": COMFY_CLIP, "type": "minimax"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": COMFY_VAE}},
        "5": {"class_type": "MiniMaxH3ImageConditioning",
              "inputs": {"clip": ["2", 0], "vae": ["3", 0], "prompt": prompt, "width": width, "height": height}},
        "6": {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["5", 0]}},
        "7": {"class_type": "KSampler", "inputs": {
            "model": ["1", 0], "positive": ["5", 0], "negative": ["6", 0], "latent_image": ["5", 1],
            "seed": seed, "steps": steps, "cfg": 1, "sampler_name": "euler", "scheduler": "simple", "denoise": 1}},
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["7", 0], "vae": ["3", 0]}},
        "9": {"class_type": "SaveImage", "inputs": {"images": ["8", 0], "filename_prefix": prefix}},
    }


def comfy_output_dir(argv):
    argv = list(argv or [])
    for i, a in enumerate(argv):
        if a == "--output-directory" and i + 1 < len(argv):
            return argv[i + 1]
        if a.startswith("--output-directory="):
            return a.split("=", 1)[1]
    return None


# ---------- 連線 ----------

def _get(url, timeout=3):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return r.read()


def _post_json(url, data, timeout=900):
    req = urllib.request.Request(url, data=json.dumps(data).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def probe():
    st = {}
    try:
        _get(LOCMODEL_URL + "/sdapi/v1/options")
        st["locmodel"] = True
    except Exception:
        st["locmodel"] = False
    try:
        st["comfyui_argv"] = json.loads(_get(COMFY_URL + "/api/system_stats"))["system"].get("argv")
        st["comfyui"] = True
    except Exception:
        st["comfyui"] = False
    return st


def gen_locmodel(prompt, w, h, steps, seed, out_path):
    d = _post_json(LOCMODEL_URL + "/sdapi/v1/txt2img", locmodel_payload(prompt, w, h, steps, seed))
    if not d.get("images"):
        raise RuntimeError(f"LocModel 沒回傳圖片：{str(d)[:300]}")
    with open(out_path, "wb") as f:
        f.write(base64.b64decode(d["images"][0]))


def gen_comfy(prompt, w, h, steps, seed, out_path, argv):
    prefix = "dashboard_tmp/" + os.path.splitext(os.path.basename(out_path))[0]
    try:
        pid = _post_json(COMFY_URL + "/prompt", {"prompt": comfy_graph(prompt, w, h, steps, seed, prefix)}, timeout=30)["prompt_id"]
    except urllib.error.HTTPError as e:
        raise RuntimeError("ComfyUI 拒絕工作流程：" + e.read().decode(errors="replace")[:800])
    t0 = time.time()
    while time.time() - t0 < 1800:
        time.sleep(2)
        h_ = json.loads(_get(f"{COMFY_URL}/history/{pid}", timeout=10))
        if pid not in h_:
            continue
        item = h_[pid]
        if item["status"].get("status_str") != "success":
            msgs = [m[1] for m in item["status"].get("messages", []) if m[0] == "execution_error"]
            raise RuntimeError("ComfyUI 執行失敗：" + (msgs[0].get("exception_message", "")[:600] if msgs else "未知"))
        imgs = [im for o in item["outputs"].values() for im in o.get("images", [])]
        if not imgs:
            raise RuntimeError("ComfyUI 沒產出圖片")
        im = imgs[0]
        q = urllib.parse.urlencode({"filename": im["filename"], "subfolder": im.get("subfolder", ""), "type": im.get("type", "output")})
        with open(out_path, "wb") as f:
            f.write(_get(f"{COMFY_URL}/view?{q}", timeout=60))
        # 搬到統一資料夾後刪掉 ComfyUI 那份，避免同一張圖留兩份
        od = comfy_output_dir(argv)
        if od:
            src = os.path.join(od, im.get("subfolder", ""), im["filename"])
            try:
                if os.path.getsize(src) == os.path.getsize(out_path):
                    os.remove(src)
                    if im.get("subfolder"):
                        os.rmdir(os.path.join(od, im["subfolder"]))  # 只有空資料夾才刪得掉
            except OSError:
                pass
        return
    raise RuntimeError("ComfyUI 超過 30 分鐘沒完成")


# ---------- CLI ----------

def _emit(obj, code=0):
    print(json.dumps(obj, ensure_ascii=False))
    sys.exit(code)


def main(argv=None):
    ap = argparse.ArgumentParser(description="本機生圖（MiniMax H3-Image）")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status")
    g = sub.add_parser("generate")
    g.add_argument("--prompt", required=True)
    g.add_argument("--aspect")
    g.add_argument("--megapixels", type=float)
    g.add_argument("--width", type=int)
    g.add_argument("--height", type=int)
    g.add_argument("--steps", type=int, default=6)
    g.add_argument("--seed", type=int)
    g.add_argument("--count", type=int, default=1)
    g.add_argument("--backend", choices=["auto", "locmodel", "comfyui"], default="auto")
    g.add_argument("--name", default="img")
    g.add_argument("--out-dir", default=DEFAULT_OUT_DIR)
    a = ap.parse_args(argv)

    st = probe()
    if a.cmd == "status":
        _emit({"locmodel": st["locmodel"], "comfyui": st["comfyui"], "out_dir": DEFAULT_OUT_DIR,
               "comfyui_output_dir": comfy_output_dir(st.get("comfyui_argv"))})

    try:
        w, h = resolve_size(a.aspect, a.megapixels, a.width, a.height)
        backend = choose_backend(st, a.backend)
    except (ValueError, BackendUnavailable) as e:
        _emit({"ok": False, "error": str(e)}, 2)
    if not 1 <= a.count <= 8:
        _emit({"ok": False, "error": "--count 要在 1～8"}, 2)
    os.makedirs(a.out_dir, exist_ok=True)
    seed0 = a.seed if a.seed is not None else random.randint(1, 2**31 - 1)
    files, t0 = [], time.time()
    try:
        for i in range(a.count):
            seed = seed0 + i
            out = next_output_path(a.out_dir, a.name, seed)
            if backend == "locmodel":
                gen_locmodel(a.prompt, w, h, a.steps, seed, out)
            else:
                gen_comfy(a.prompt, w, h, a.steps, seed, out, st.get("comfyui_argv"))
            files.append({"path": out, "seed": seed})
    except Exception as e:
        _emit({"ok": False, "backend": backend, "error": str(e), "files": files}, 1)
    _emit({"ok": True, "backend": backend, "width": w, "height": h, "steps": a.steps,
           "files": files, "seconds": round(time.time() - t0, 1)})


if __name__ == "__main__":
    main()
