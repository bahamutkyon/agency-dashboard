#!/usr/bin/env python3
"""中文字幕流程：本機聽寫 → 台灣繁體 → 標點 → 錯字對照表 → 人工校對 → 從修改學習。

指令：
  python3 subtitles.py transcribe VIDEO [-o OUT.srt] [--model large-v3] [--max-chars 16]
      聽寫（faster-whisper，本機 GPU），寫出三個檔：
        OUT.srt       工作稿，給人在 Subtitle Edit 校對
        OUT.auto.srt  自動稿快照，learn 拿來比對「人改了哪裡」，不要手改
        OUT.raw.srt   模型原始輸出（簡體、未處理），除錯用
  python3 subtitles.py normalize IN.srt [-o OUT.srt]     只做繁體／標點／對照表（給外部 SRT 用）
  python3 subtitles.py learn OUT.srt                     比對 OUT.auto.srt 與校對後的 OUT.srt，把錯字學進對照表
  python3 subtitles.py edit OUT.srt [--video VIDEO]      用 Subtitle Edit 打開校對
  python3 subtitles.py glossary [--add 錯=對 ...]         看／手動加對照表

對照表預設在 ~/.claude/subtitle-glossary.json（環境變數 ZH_SUB_GLOSSARY 可改），不在 skill 資料夾內，
重裝 skill 不會洗掉。只在本機運作，不連網（第一次用某個模型時 faster-whisper 會從 Hugging Face 下載權重）。
"""
from __future__ import annotations

import argparse
import difflib
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple

Cue = Tuple[float, float, str]

DEFAULT_GLOSSARY = os.environ.get("ZH_SUB_GLOSSARY") or str(Path.home() / ".claude" / "subtitle-glossary.json")
# OpenCC s2twp 之後的在地化微調：台灣日常字幕慣用「台」。
LOCAL_OVERRIDES = {"臺": "台"}
_PUNCT_MAP = {",": "，", "?": "？", "!": "！", ";": "；", ":": "："}
_TRAILING_STRIP = "，。、；：,.;: "
_SPLIT_RE = re.compile(r"([，。、；,;.\s]|[！？!?])")

_cc = None


def _opencc():
    global _cc
    if _cc is None:
        try:
            import opencc  # opencc-python-reimplemented
        except ImportError:
            sys.exit("缺少 OpenCC：python3 -m pip install --user opencc-python-reimplemented")
        _cc = opencc.OpenCC("s2twp")
    return _cc


def _is_cjk(ch: str) -> bool:
    return "㐀" <= ch <= "鿿" or "豈" <= ch <= "﫿" or "　" <= ch <= "〿" or "＀" <= ch <= "￯"


def _is_ascii_alnum(ch: str) -> bool:
    return ch.isascii() and ch.isalnum()


def apply_glossary(text: str, glossary: Dict[str, str]) -> str:
    if not glossary:
        return text
    keys = sorted(glossary, key=len, reverse=True)
    pattern = re.compile("|".join(re.escape(k) for k in keys))
    return pattern.sub(lambda m: glossary[m.group(0)], text)


def normalize_text(text: str, glossary: Dict[str, str]) -> str:
    """簡→台灣繁體、CJK 旁的半形標點轉全形、去掉句尾逗號句號、套用錯字對照表。"""
    t = _opencc().convert(text)
    for a, b in LOCAL_OVERRIDES.items():
        t = t.replace(a, b)
    out = []
    for i, ch in enumerate(t):
        if ch in _PUNCT_MAP:
            prev = t[i - 1] if i > 0 else ""
            nxt = t[i + 1] if i + 1 < len(t) else ""
            if (prev and _is_cjk(prev)) or (nxt and _is_cjk(nxt)):
                ch = _PUNCT_MAP[ch]
        out.append(ch)
    t = "".join(out).strip()
    t = t.rstrip(_TRAILING_STRIP)
    return apply_glossary(t, glossary)


def split_long_cues(cues: List[Cue], max_chars: int = 16) -> List[Cue]:
    """太長的字幕在標點處切開，時間依字數比例分配；沒有標點就硬切。"""
    result: List[Cue] = []
    for start, end, text in cues:
        if len(text) <= max_chars:
            result.append((start, end, text))
            continue
        pieces: List[str] = []
        buf = ""
        for tok in _SPLIT_RE.split(text):
            if not tok:
                continue
            if _SPLIT_RE.fullmatch(tok):
                if tok in "！？!?":
                    buf += tok
                if buf.strip():
                    pieces.append(buf.strip())
                buf = ""
            else:
                buf += tok
        if buf.strip():
            pieces.append(buf.strip())
        chunks: List[str] = []
        for p in pieces:
            while len(p) > max_chars:
                chunks.append(p[:max_chars])
                p = p[max_chars:]
            if p:
                chunks.append(p)
        total = sum(len(c) for c in chunks) or 1
        t = start
        for i, c in enumerate(chunks):
            nt = end if i == len(chunks) - 1 else start + (end - start) * (sum(len(x) for x in chunks[: i + 1]) / total)
            result.append((round(t, 3), round(nt, 3), c))
            t = nt
    return result


def _ts(sec: float) -> str:
    ms = int(round(sec * 1000))
    h, ms = divmod(ms, 3600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _parse_ts(s: str) -> float:
    h, m, rest = s.strip().replace(".", ",").split(":")
    sec, ms = rest.split(",")
    return int(h) * 3600 + int(m) * 60 + int(sec) + int(ms) / 1000


def format_srt(cues: List[Cue]) -> str:
    return "\n".join(f"{i}\n{_ts(s)} --> {_ts(e)}\n{t}\n" for i, (s, e, t) in enumerate(cues, 1))


def parse_srt(text: str) -> List[Cue]:
    text = text.lstrip("﻿").replace("\r\n", "\n").replace("\r", "\n")
    cues: List[Cue] = []
    for block in re.split(r"\n\s*\n", text.strip()):
        lines = block.split("\n")
        idx = next((i for i, l in enumerate(lines) if "-->" in l), None)
        if idx is None:
            continue
        a, b = lines[idx].split("-->")
        body = "\n".join(lines[idx + 1:]).strip()
        cues.append((_parse_ts(a), _parse_ts(b.split()[0]), body))
    return cues


def _meaningful(s: str) -> str:
    return re.sub(r"[\s，。、；：！？,.;:!?「」『』（）()\-—…~～]", "", s)


def _pair_texts(before: List[Cue], after: List[Cue]) -> List[Tuple[str, str]]:
    if len(before) == len(after):
        return [(b[2], a[2]) for b, a in zip(before, after)]
    pairs = []
    for s, e, t in after:
        joined = "".join(bt for bs, be, bt in before if s <= (bs + be) / 2 < e)
        pairs.append((joined, t))
    return pairs


def learn_corrections(before: List[Cue], after: List[Cue], max_len: int = 8) -> Dict[str, str]:
    """比對自動稿與人工校對稿，找出「把 A 改成 B」的短替換（錯字），忽略標點、增刪、整句重寫。"""
    learned: Dict[str, str] = {}
    for b, a in _pair_texts(before, after):
        if b == a or not b or not a:
            continue
        sm = difflib.SequenceMatcher(None, b, a, autojunk=False)
        if sm.ratio() < 0.5:
            continue
        for op, i1, i2, j1, j2 in sm.get_opcodes():
            if op != "replace":
                continue
            # 英數字詞擴到完整 token（6SM7→6SN7，而不是 M→N）
            while i1 > 0 and j1 > 0 and b[i1 - 1] == a[j1 - 1] and _is_ascii_alnum(b[i1 - 1]) and (_is_ascii_alnum(b[i1]) or _is_ascii_alnum(a[j1])):
                i1 -= 1
                j1 -= 1
            while i2 < len(b) and j2 < len(a) and b[i2] == a[j2] and _is_ascii_alnum(b[i2]) and (_is_ascii_alnum(b[i2 - 1]) or _is_ascii_alnum(a[j2 - 1])):
                i2 += 1
                j2 += 1
            wrong, right = b[i1:i2], a[j1:j2]
            # 只改大小寫的英文字（Audio→audio）：單獨記會誤傷品牌名，帶上前一個英文字當語境，沒有就不學
            if wrong != right and wrong.isascii() and wrong.lower() == right.lower():
                k = i1
                while k > 0 and b[k - 1] == " ":
                    k -= 1
                w = k
                while w > 0 and _is_ascii_alnum(b[w - 1]):
                    w -= 1
                if w == k:
                    continue
                ctx = b[w:i1]
                wrong, right = ctx + wrong, ctx + right
            # 單一中文字的替換太容易誤傷，帶上前一個（或後一個）相同字變成詞
            if len(wrong) == 1 and len(right) == 1 and _is_cjk(wrong):
                if i1 > 0 and j1 > 0 and b[i1 - 1] == a[j1 - 1]:
                    wrong, right = b[i1 - 1] + wrong, a[j1 - 1] + right
                elif i2 < len(b) and j2 < len(a) and b[i2] == a[j2]:
                    wrong, right = wrong + b[i2], right + a[j2]
                else:
                    continue
            if not _meaningful(wrong) or not _meaningful(right) or _meaningful(wrong) == _meaningful(right):
                continue
            if len(wrong) > max_len or len(right) > max_len:
                continue
            learned[wrong.strip()] = right.strip()
    return learned


def load_glossary(path: str) -> Dict[str, str]:
    try:
        with open(path, encoding="utf-8") as f:
            return dict(json.load(f).get("corrections", {}))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def merge_glossary(path: str, new: Dict[str, str]) -> Dict[str, str]:
    """加進對照表，回傳真正新增的。已存在的、或會跟既有規則互相打架的（A→B 又 B→A）不加。"""
    g = load_glossary(path)
    added: Dict[str, str] = {}
    for wrong, right in new.items():
        if not wrong or wrong == right or g.get(wrong) == right:
            continue
        if wrong in g.values() or right in g or wrong in added.values() or right in added:
            continue
        added[wrong] = right
    if added:
        g.update(added)
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"corrections": g}, f, ensure_ascii=False, indent=2)
    return added


def prompt_from_glossary(g: Dict[str, str]) -> str:
    """對照表裡的正確詞，當成聽寫提示（讓模型先認得這些專有名詞）。"""
    seen: List[str] = []
    for v in g.values():
        if v not in seen:
            seen.append(v)
    return "、".join(seen)


def _stem(srt: str) -> Path:
    p = Path(srt)
    return p.with_suffix("") if p.suffix.lower() == ".srt" else p


def cmd_transcribe(args) -> int:
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        sys.exit("缺少 faster-whisper：python3 -m pip install --user faster-whisper nvidia-cublas-cu12 \"nvidia-cudnn-cu12>=9,<10\" \"av<16\"")
    _add_cuda_dll_dirs()
    out = Path(args.output) if args.output else Path(args.video).with_suffix(".srt")
    stem = _stem(str(out))
    glossary = load_glossary(args.glossary)
    terms = prompt_from_glossary(glossary)
    prompt = "以下是台灣繁體中文的影片字幕。" + (f"可能出現的詞：{terms}。" if terms else "")
    try:
        model = WhisperModel(args.model, device="cuda", compute_type="float16")
    except Exception as e:  # 沒有 GPU 時退回 CPU（慢很多）
        print(f"GPU 載入失敗，改用 CPU：{e}", file=sys.stderr)
        model = WhisperModel(args.model, device="cpu", compute_type="int8")
    segments, info = model.transcribe(args.video, language=args.language, initial_prompt=prompt,
                                      vad_filter=True, beam_size=5)
    raw: List[Cue] = [(s.start, s.end, s.text.strip()) for s in segments if s.text.strip()]
    Path(f"{stem}.raw.srt").write_text(format_srt(raw), encoding="utf-8")
    cues = [(s, e, normalize_text(t, glossary)) for s, e, t in raw]
    cues = [c for c in split_long_cues(cues, args.max_chars) if c[2]]
    text = format_srt(cues)
    Path(f"{stem}.auto.srt").write_text(text, encoding="utf-8")
    out.write_text(text, encoding="utf-8")
    print(json.dumps({"status": "ok", "srt": str(out), "auto": f"{stem}.auto.srt", "raw": f"{stem}.raw.srt",
                      "cues": len(cues), "duration": round(info.duration, 2), "model": args.model,
                      "glossary_terms": len(glossary)}, ensure_ascii=False))
    return 0


def cmd_normalize(args) -> int:
    glossary = load_glossary(args.glossary)
    cues = parse_srt(Path(args.input).read_text(encoding="utf-8"))
    cues = split_long_cues([(s, e, normalize_text(t, glossary)) for s, e, t in cues], args.max_chars)
    out = Path(args.output) if args.output else Path(args.input)
    out.write_text(format_srt(cues), encoding="utf-8")
    print(json.dumps({"status": "ok", "srt": str(out), "cues": len(cues)}, ensure_ascii=False))
    return 0


def cmd_learn(args) -> int:
    stem = _stem(args.srt)
    auto = Path(f"{stem}.auto.srt")
    if not auto.exists():
        sys.exit(f"找不到自動稿快照 {auto}（只有 transcribe 產生的字幕能學習）")
    before = parse_srt(auto.read_text(encoding="utf-8"))
    after = parse_srt(Path(args.srt).read_text(encoding="utf-8-sig"))
    found = learn_corrections(before, after)
    added = merge_glossary(args.glossary, found)
    print(json.dumps({"status": "ok", "found": found, "added": added, "glossary": args.glossary}, ensure_ascii=False))
    return 0


def find_subtitle_edit() -> Optional[str]:
    candidates = [shutil.which("SubtitleEdit")]
    for base in (os.environ.get("ProgramFiles"), os.environ.get("ProgramFiles(x86)"), os.environ.get("LOCALAPPDATA")):
        if base:
            candidates += [os.path.join(base, "Subtitle Edit", "SubtitleEdit.exe"),
                           os.path.join(base, "Programs", "Subtitle Edit", "SubtitleEdit.exe")]
    return next((c for c in candidates if c and os.path.isfile(c)), None)


def cmd_edit(args) -> int:
    exe = find_subtitle_edit()
    if not exe:
        sys.exit("找不到 Subtitle Edit：winget install --id Nikse.SubtitleEdit -e")
    argv = [exe, str(Path(args.srt).resolve())]
    if args.video:
        argv.append(str(Path(args.video).resolve()))
    subprocess.Popen(argv)
    print(json.dumps({"status": "opened", "editor": exe, "srt": args.srt}, ensure_ascii=False))
    return 0


def cmd_glossary(args) -> int:
    if args.add:
        new = dict(item.split("=", 1) for item in args.add if "=" in item)
        added = merge_glossary(args.glossary, new)
        print(json.dumps({"added": added}, ensure_ascii=False))
    print(json.dumps({"glossary": args.glossary, "corrections": load_glossary(args.glossary)}, ensure_ascii=False, indent=2))
    return 0


def _add_cuda_dll_dirs() -> None:
    """Windows：讓 ctranslate2 找得到 pip 裝的 cuBLAS／cuDNN。"""
    if os.name != "nt":
        return
    import site
    for sp in [site.getusersitepackages(), *site.getsitepackages()]:
        nv = Path(sp) / "nvidia"
        if nv.is_dir():
            for b in nv.glob("*/bin"):
                os.add_dll_directory(str(b))
                os.environ["PATH"] = str(b) + os.pathsep + os.environ.get("PATH", "")


def main(argv: Optional[List[str]] = None) -> int:
    p = argparse.ArgumentParser(description="中文字幕流程（聽寫／繁體／對照表／校對／學習）")
    p.add_argument("--glossary", default=DEFAULT_GLOSSARY)
    sub = p.add_subparsers(dest="cmd", required=True)
    t = sub.add_parser("transcribe")
    t.add_argument("video")
    t.add_argument("-o", "--output")
    t.add_argument("--model", default=os.environ.get("ZH_SUB_MODEL", "large-v3"))
    t.add_argument("--language", default="zh")
    t.add_argument("--max-chars", type=int, default=16)
    n = sub.add_parser("normalize")
    n.add_argument("input")
    n.add_argument("-o", "--output")
    n.add_argument("--max-chars", type=int, default=16)
    l = sub.add_parser("learn")
    l.add_argument("srt")
    e = sub.add_parser("edit")
    e.add_argument("srt")
    e.add_argument("--video")
    g = sub.add_parser("glossary")
    g.add_argument("--add", nargs="*")
    args = p.parse_args(argv)
    return {"transcribe": cmd_transcribe, "normalize": cmd_normalize, "learn": cmd_learn,
            "edit": cmd_edit, "glossary": cmd_glossary}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
