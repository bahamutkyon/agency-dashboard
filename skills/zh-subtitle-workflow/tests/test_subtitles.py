"""zh-subtitle-workflow 純邏輯測試（不跑模型、不碰 GPU）。

執行：python3 -m unittest discover -s skills/zh-subtitle-workflow/tests
"""
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
import subtitles as st  # noqa: E402


class NormalizeTests(unittest.TestCase):
    def test_simplified_to_taiwan_traditional(self):
        self.assertEqual(st.normalize_text("欢迎来到今天的开箱视频", {}), "歡迎來到今天的開箱影片")

    def test_taiwan_everyday_tai_not_formal_tai(self):
        # OpenCC s2twp 會把「台」轉成「臺」；台灣字幕日常用「台」
        self.assertEqual(st.normalize_text("一台真空管前级", {}), "一台真空管前級")

    def test_half_width_punct_between_cjk_becomes_full_width(self):
        self.assertEqual(st.normalize_text("大家好,欢迎", {}), "大家好，歡迎")
        self.assertEqual(st.normalize_text("真的吗?好", {}), "真的嗎？好")

    def test_ascii_punct_inside_latin_kept(self):
        self.assertEqual(st.normalize_text("版本 1.5,OK", {}), "版本 1.5,OK")

    def test_trailing_cue_punct_removed(self):
        self.assertEqual(st.normalize_text("低頻也很飽滿。", {}), "低頻也很飽滿")
        self.assertEqual(st.normalize_text("好,", {}), "好")

    def test_question_mark_at_end_kept(self):
        self.assertEqual(st.normalize_text("你喜歡嗎?", {}), "你喜歡嗎？")

    def test_glossary_applied_after_conversion(self):
        g = {"6SM7": "6SN7", "LP Audio": "LP audio"}
        self.assertEqual(st.normalize_text("使用三颗6SM7,欢迎来到LP Audio", g), "使用三顆6SN7，歡迎來到LP audio")

    def test_glossary_longest_match_first(self):
        g = {"真空": "X", "真空管前級": "真空管前級（Pre）"}
        self.assertEqual(st.normalize_text("真空管前级", g), "真空管前級（Pre）")


class SplitTests(unittest.TestCase):
    def test_short_cue_untouched(self):
        self.assertEqual(st.split_long_cues([(0.0, 2.0, "大家好")], max_chars=16), [(0.0, 2.0, "大家好")])

    def test_long_cue_split_at_punct_with_proportional_time(self):
        cues = st.split_long_cues([(0.0, 10.0, "今天要開箱的是一台真空管前級，使用三顆6SN7搭配203A後級")], max_chars=16)
        self.assertEqual([c[2] for c in cues], ["今天要開箱的是一台真空管前級", "使用三顆6SN7搭配203A後級"])
        self.assertAlmostEqual(cues[0][0], 0.0)
        self.assertAlmostEqual(cues[-1][1], 10.0)
        self.assertAlmostEqual(cues[0][1], cues[1][0])
        self.assertTrue(0.0 < cues[0][1] < 10.0)

    def test_long_cue_without_punct_hard_split(self):
        cues = st.split_long_cues([(0.0, 4.0, "一" * 40)], max_chars=16)
        self.assertTrue(all(len(c[2]) <= 16 for c in cues))
        self.assertEqual("".join(c[2] for c in cues), "一" * 40)


class SrtTests(unittest.TestCase):
    def test_roundtrip(self):
        cues = [(0.24, 2.76, "大家好"), (62.5, 65.0, "第二句")]
        text = st.format_srt(cues)
        self.assertIn("00:00:00,240 --> 00:00:02,760", text)
        self.assertIn("00:01:02,500 --> 00:01:05,000", text)
        self.assertEqual(st.parse_srt(text), cues)

    def test_parse_handles_bom_crlf_and_multiline(self):
        text = "﻿1\r\n00:00:01,000 --> 00:00:02,000\r\n第一行\r\n第二行\r\n\r\n"
        self.assertEqual(st.parse_srt(text), [(1.0, 2.0, "第一行\n第二行")])


class LearnTests(unittest.TestCase):
    def test_learns_latin_token_not_single_letter(self):
        before = [(0, 1, "使用三顆6SM7")]
        after = [(0, 1, "使用三顆6SN7")]
        self.assertEqual(st.learn_corrections(before, after), {"6SM7": "6SN7"})

    def test_case_only_edit_keeps_preceding_word_as_context(self):
        # 只學「Audio→audio」會把 Warm Audio 這類品牌名也改掉
        before = [(0, 1, "歡迎來到LP Audio")]
        after = [(0, 1, "歡迎來到LP audio")]
        self.assertEqual(st.learn_corrections(before, after), {"LP Audio": "LP audio"})

    def test_case_only_edit_without_preceding_word_is_skipped(self):
        before = [(0, 1, "Audio 很重要")]
        after = [(0, 1, "audio 很重要")]
        self.assertEqual(st.learn_corrections(before, after), {})

    def test_learns_short_cjk_substitution(self):
        before = [(0, 1, "歡迎私訊詢問價格"), (1, 2, "整體聲音很溫暖")]
        after = [(0, 1, "歡迎私訊詢問價錢"), (1, 2, "整體聲音很溫潤")]
        self.assertEqual(st.learn_corrections(before, after), {"價格": "價錢", "溫暖": "溫潤"})

    def test_ignores_punctuation_and_whitespace_only_edits(self):
        before = [(0, 1, "大家好，歡迎")]
        after = [(0, 1, "大家好 歡迎")]
        self.assertEqual(st.learn_corrections(before, after), {})

    def test_ignores_rewritten_sentences(self):
        before = [(0, 1, "今天天氣很好")]
        after = [(0, 1, "我們開始介紹這台機器的特色")]
        self.assertEqual(st.learn_corrections(before, after), {})

    def test_ignores_half_rewritten_sentence_even_if_each_edit_is_short(self):
        # 後半句整個換掉（每段替換都很短）——這是改寫內容，不是錯字
        before = [(0, 1, "今天天氣很好")]
        after = [(0, 1, "今天心情不錯")]
        self.assertEqual(st.learn_corrections(before, after), {})

    def test_ignores_pure_deletions_and_insertions(self):
        before = [(0, 1, "那個就是這台前級")]
        after = [(0, 1, "這台前級")]
        self.assertEqual(st.learn_corrections(before, after), {})

    def test_aligns_by_time_when_cue_counts_differ(self):
        before = [(0, 2, "大家好"), (2, 4, "使用三顆6SM7"), (4, 6, "搭配203A")]
        after = [(0, 2, "大家好"), (2, 6, "使用三顆6SN7搭配203A")]
        self.assertEqual(st.learn_corrections(before, after), {"6SM7": "6SN7"})


class GlossaryTests(unittest.TestCase):
    def test_merge_and_persist(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "g.json")
            added = st.merge_glossary(p, {"6SM7": "6SN7"})
            self.assertEqual(added, {"6SM7": "6SN7"})
            self.assertEqual(st.load_glossary(p), {"6SM7": "6SN7"})
            # 重複的不算新增；right 本身不能被當成錯字（避免 A→B、B→A 打架）
            added = st.merge_glossary(p, {"6SM7": "6SN7", "6SN7": "6SM7"})
            self.assertEqual(added, {})
            with open(p, encoding="utf-8") as f:
                self.assertEqual(json.load(f)["corrections"], {"6SM7": "6SN7"})

    def test_missing_file_is_empty(self):
        self.assertEqual(st.load_glossary(os.path.join(tempfile.gettempdir(), "nope-zh-sub.json")), {})

    def test_prompt_terms_from_glossary(self):
        self.assertEqual(st.prompt_from_glossary({"6SM7": "6SN7", "LP Audio": "LP audio", "x": "6SN7"}), "6SN7、LP audio")


if __name__ == "__main__":
    unittest.main()
