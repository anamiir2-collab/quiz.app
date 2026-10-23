# -*- coding: utf-8 -*-
"""
نواة مولّد أسئلة القرآن: أدوات نصية وبناة الأسئلة.
كل نص قرآني في الأسئلة يُستخرج حرفياً من tools/cache/quran.json
(نص Tanzil الموثق بعد توحيده بأسلوب المشروع) — لا نصوص مُولّدة بالتخمين.
"""
import io, json, os, random, unicodedata
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "tools", "cache")

DAGGER = "\u0670"
HARAKAT_RANGE = range(0x064B, 0x0653)

def norm(s: str) -> str:
    return unicodedata.normalize("NFC", s).strip()

def strip_marks(w: str) -> str:
    """إزالة الحركات والمدة والتطويل — للحفظ والمقارنة"""
    return "".join(c for c in w if ord(c) not in HARAKAT_RANGE and c not in (DAGGER, "\u0640"))

def end_key(w: str):
    """نمط إعرابي مبسّط: (آخر حرف أساسي، آخر حركة) لمطابقة البدائل"""
    base = [c for c in w if ord(c) < 0x064B or c == DAGGER]
    marks = [c for c in w if ord(c) in HARAKAT_RANGE]
    return (base[-1] if base else "", marks[-1] if marks else "")

def word_len(w: str) -> int:
    return len(strip_marks(w))

def load_data():
    with io.open(os.path.join(CACHE, "quran.json"), encoding="utf-8") as f:
        quran = json.load(f)
    with io.open(os.path.join(CACHE, "surahs.json"), encoding="utf-8") as f:
        surahs = json.load(f)
    return quran, surahs

class QuranBank:
    def __init__(self):
        self.quran, self.surahs = load_data()
        self.surah_map = {s["n"]: s for s in self.surahs}
        self.ayah_words = {}      # (s,a) -> [words with tashkeel]
        self.prefix2 = defaultdict(list)   # أول كلمتين معرّيتين -> آيات
        self.prefix1 = defaultdict(list)
        self.endpat = defaultdict(set)     # نمط إعرابي -> كلمات (للمشوشات)
        self.common_words = defaultdict(list)  # نمط إعرابي -> كلمات شائعة عالمية
        self._build_indices()

    def _build_indices(self):
        word_freq = defaultdict(int)
        for key, text in self.quran.items():
            s, a = map(int, key.split(":"))
            words = text.split()
            self.ayah_words[(s, a)] = words
            if len(words) >= 2:
                self.prefix2[(strip_marks(words[0]), strip_marks(words[1]))].append((s, a))
            if words:
                self.prefix1[strip_marks(words[0])].append((s, a))
            for w in words:
                if word_len(w) >= 3:
                    word_freq[w] += 1
        for key, text in self.quran.items():
            for w in set(text.split()):
                if 3 <= word_len(w) <= 8:
                    self.endpat[end_key(w)].add(w)
        # كلمات شائعة عالمية لكل نمط (للسور القصيرة)
        freq_sorted = sorted(word_freq.items(), key=lambda kv: -kv[1])
        for w, f in freq_sorted[:4000]:
            self.common_words[end_key(w)].append(w)

    def ayah(self, s, a):
        return self.quran.get(f"{s}:{a}", "")

    def surah_name(self, s):
        return self.surah_map[s]["name"]

    def surah_ayahs(self, s):
        return self.surah_map[s]["ayahs"]

    # ---------- أدوات الاختيار ----------
    def ayahs_with_prefix(self, s, a, n=2):
        words = self.ayah_words.get((s, a), [])
        if len(words) < n:
            return []
        if n == 2:
            key = (strip_marks(words[0]), strip_marks(words[1]))
            return [x for x in self.prefix2.get(key, []) if x != (s, a)]
        return [x for x in self.prefix1.get(strip_marks(words[0]), []) if x != (s, a)]

    def distractor_fragments(self, s, a, k, rng, want=8):
        """تتمات مرشّحة للجزء الأول: من آيات بنفس البادئة، ثم المجاورة، ثم عشوائية السورة"""
        pool = []
        same_prefix = self.ayahs_with_prefix(s, a, 2) + self.ayahs_with_prefix(s, a, 1)
        rng.shuffle(same_prefix)
        for (s2, a2) in same_prefix:
            w2 = self.ayah_words.get((s2, a2), [])
            if len(w2) > k:
                pool.append((w2[k:], True))  # True = مشابه فعلاً
        neighbors = [(s, a + d) for d in (1, 2, 3) if a + d <= self.surah_ayahs(s)]
        neighbors += [(s, a - d) for d in (1, 2, 3) if a - d >= 1]
        rng.shuffle(neighbors)
        for (s2, a2) in neighbors:
            w2 = self.ayah_words.get((s2, a2), [])
            if len(w2) > k and not any(f[0] == w2[k:] for f in pool):
                pool.append((w2[k:], False))
        total = self.surah_ayahs(s)
        tries = 0
        while len(pool) < want and tries < 60:
            tries += 1
            a2 = rng.randint(1, total)
            w2 = self.ayah_words.get((s, a2), [])
            if len(w2) > k and not any(f[0] == w2[k:] for f in pool):
                pool.append((w2[k:], False))
        return pool

    def similar_word(self, word, s, rng, exclude=None):
        """كلمة بديلة بنفس النمط الإعرابي من السورة ثم من القرآن
        مع تفضيل الكلمات المتشابهة في بدايتها (نفس الحرف الأول أو التعريف بـ ال)"""
        exclude = exclude or set()
        key = end_key(word)
        sb = strip_marks(word)
        starts_with_al = sb.startswith("ال")
        def pref_score(cand):
            cb = strip_marks(cand)
            if starts_with_al and cb.startswith("ال"):
                return 0
            if not starts_with_al and not cb.startswith("ال") and cb[0] == sb[0]:
                return 1
            if starts_with_al == cb.startswith("ال"):
                return 2
            return 3
        candidates = []
        for w in self.endpat.get(key, []):
            if w != word and w not in exclude and abs(word_len(w) - word_len(word)) <= 3:
                candidates.append(w)
        rng.shuffle(candidates)
        if len(candidates) < 3:
            global_c = [w for w in self.common_words.get(key, [])
                        if w != word and w not in exclude and abs(word_len(w) - word_len(word)) <= 3]
            for w in global_c:
                if w not in candidates:
                    candidates.append(w)
        candidates.sort(key=pref_score)
        return candidates

    def truncate(self, words, n=11):
        if len(words) <= n:
            return " ".join(words)
        return " ".join(words[:n]) + " …"


def parse_quiz_file(path):
    """قراءة كائن الاختبار من ملف JS مولّد (بدون تنفيذ)"""
    with io.open(path, encoding="utf-8") as f:
        txt = f.read()
    marker = txt.index("window.QUIZ_DATA[")
    assign = txt.index("=", marker)
    start = txt.index("{", assign)
    depth = 0
    for i in range(start, len(txt)):
        ch = txt[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return json.loads(txt[start:i + 1])
    raise ValueError("لم يُعثر على JSON في " + path)
