"""local-image-gen 純邏輯測試（不連 LocModel / ComfyUI、不碰 GPU）。

執行：python3 -m unittest discover -s skills/local-image-gen/tests
"""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
import genimage as gi  # noqa: E402


class SizeTests(unittest.TestCase):
    def test_explicit_size_rounds_to_multiple_of_32(self):
        self.assertEqual(gi.resolve_size(width=1000, height=1500), (992, 1504))

    def test_aspect_and_megapixels(self):
        w, h = gi.resolve_size(aspect="9:16", megapixels=1.0)
        self.assertEqual((w % 32, h % 32), (0, 0))
        self.assertLess(w, h)
        self.assertAlmostEqual(w / h, 9 / 16, delta=0.02)
        self.assertAlmostEqual(w * h / 1e6, 1.0, delta=0.08)

    def test_default_is_square_one_megapixel(self):
        self.assertEqual(gi.resolve_size(), (1024, 1024))

    def test_rejects_bad_aspect(self):
        with self.assertRaises(ValueError):
            gi.resolve_size(aspect="wide")

    def test_rejects_too_large(self):
        with self.assertRaises(ValueError):
            gi.resolve_size(width=8192, height=8192)

    def test_one_side_only_is_an_error(self):
        with self.assertRaises(ValueError):
            gi.resolve_size(width=1024)


class BackendTests(unittest.TestCase):
    def test_auto_prefers_locmodel_when_both_up(self):
        self.assertEqual(gi.choose_backend({"locmodel": True, "comfyui": True}, "auto"), "locmodel")

    def test_auto_falls_back_to_comfyui(self):
        self.assertEqual(gi.choose_backend({"locmodel": False, "comfyui": True}, "auto"), "comfyui")

    def test_none_up_raises_with_instruction(self):
        with self.assertRaises(gi.BackendUnavailable) as cm:
            gi.choose_backend({"locmodel": False, "comfyui": False}, "auto")
        self.assertIn("LocModel", str(cm.exception))
        self.assertIn("ComfyUI", str(cm.exception))

    def test_explicit_backend_must_be_up(self):
        with self.assertRaises(gi.BackendUnavailable):
            gi.choose_backend({"locmodel": False, "comfyui": True}, "locmodel")


class OutputPathTests(unittest.TestCase):
    def test_never_overwrites(self):
        with tempfile.TemporaryDirectory() as d:
            p1 = gi.next_output_path(d, "amp ad", 42)
            open(p1, "wb").close()
            p2 = gi.next_output_path(d, "amp ad", 42)
            self.assertNotEqual(p1, p2)
            self.assertTrue(p1.endswith(".png") and p2.endswith(".png"))

    def test_unsafe_chars_removed_from_name(self):
        with tempfile.TemporaryDirectory() as d:
            p = gi.next_output_path(d, 'a/b:c*?"<>|', 1)
            self.assertEqual(os.path.dirname(p), d)
            for ch in '/:*?"<>|':
                self.assertNotIn(ch, os.path.basename(p))

    def test_default_out_dir_is_on_d_drive(self):
        self.assertTrue(gi.DEFAULT_OUT_DIR.upper().startswith("D:"))


class PayloadTests(unittest.TestCase):
    def test_locmodel_payload(self):
        p = gi.locmodel_payload("a cat", 832, 1216, steps=6, seed=7)
        self.assertEqual((p["prompt"], p["width"], p["height"], p["steps"], p["seed"], p["cfg_scale"]),
                         ("a cat", 832, 1216, 6, 7, 1))

    def test_comfy_graph_uses_gguf_loaders_and_normal_encoder(self):
        g = gi.comfy_graph("a cat", 832, 1216, steps=6, seed=7, prefix="dash/x")
        types = {n["class_type"] for n in g.values()}
        self.assertIn("UnetLoaderGGUF", types)
        self.assertIn("CLIPLoaderGGUF", types)
        self.assertIn("MiniMaxH3ImageConditioning", types)
        clip = next(n for n in g.values() if n["class_type"] == "CLIPLoaderGGUF")
        self.assertEqual(clip["inputs"]["type"], "minimax")
        self.assertNotIn("Sakura", clip["inputs"]["clip_name"])  # 工作用一律原版編碼器
        cond = next(n for n in g.values() if n["class_type"] == "MiniMaxH3ImageConditioning")
        self.assertEqual((cond["inputs"]["width"], cond["inputs"]["height"]), (832, 1216))
        ks = next(n for n in g.values() if n["class_type"] == "KSampler")
        self.assertEqual((ks["inputs"]["steps"], ks["inputs"]["cfg"], ks["inputs"]["seed"]), (6, 1, 7))

    def test_output_dir_from_comfy_argv(self):
        argv = ["main.py", "--enable-manager", "--output-directory", r"D:\AI\ComfyUI"]
        self.assertEqual(gi.comfy_output_dir(argv), r"D:\AI\ComfyUI")
        self.assertIsNone(gi.comfy_output_dir(["main.py"]))


if __name__ == "__main__":
    unittest.main()
