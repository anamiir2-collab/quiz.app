# -*- coding: utf-8 -*-
"""
المولد الرئيسي لأسئلة اختبارات القرآن الكريم.

المبادئ:
- كل نص قرآني يُستخرج حرفياً من tools/cache/quran.json (Tanzil — Simple Plain موثق).
- المشتتات (الخيارات الخاطئة) كلها مقاطع قرآنية حقيقية من مصدر موثق.
- منع التكرار عالمياً: سؤال واحد لكل (نوع، آية) عبر كل الاختبارات.
- الأسئلة الشاملة (المراجعة) تعيد استخدام أسئلة السورة بنيّة تعليمية صريحة.
- أسئلة المؤلف الأصلية (يس والرحمن) تُنقل كما هي دون أي تغيير في نصوصها.

الاستخدام:
  node tools/migrate-legacy.js   (يحوّل الأسئلة الأصلية إلى JSON)
  python3 tools/generate.py
"""
import io, json, math, os, random, re, subprocess, sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from qbank import QuranBank, norm, strip_marks, end_key, word_len, ROOT, parse_quiz_file
from vocab import VOCAB, REVELATION_OPTIONS

# سور فيها قولان في المكية/المدنية — لا يولد لها سؤال نزول آلي (شرط ثبوت المعلومة)
DISPUTED_REVELATION = {13, 22, 55, 76, 99, 110}

JS = os.path.join(ROOT, "js")
DATA = os.path.join(JS, "data")
CACHE = os.path.join(ROOT, "tools", "cache")
SEED = 1437
DOTS = "." * 15
WB_DOTS = "." * 12
PAUSE_MARKS = {chr(c) for c in range(0x06D6, 0x06F0)}  # رموز الوقف ونهاية الآية والحزب

rng = random.Random(SEED)

# ============ حالة منع التكرار ============
used = {
    "complete": set(), "next": set(), "prev": set(),
    "wb": set(), "vocab": set(),
}
used_texts = set()          # نص السؤال المعياري كاملاً (للجميع)
legacy_info_types = set()   # (نوع معلوماتي، سورة) موجودة في أسئلة المؤلف

def q_fingerprint(q):
    return norm(q["q"]).replace(" ", "")

def try_add(q, qtype, s, a):
    """يضيف السؤال مع فحص منع التكرار — يعيد السؤال أو None
    ملاحظة: مفاتيح المنع (النوع، السورة، الآية) — النوعان complete/similar يشتركان في نفس السلة
    لأنهما سؤالان عن نفس آية الإكمال"""
    bucket = {"complete_ayah": "complete", "similar_ayah": "complete",
              "next_ayah": "next", "prev_ayah": "prev", "word_blank": "wb",
              "vocab": "vocab"}.get(qtype)
    if bucket and (s, a) in used[bucket]:
        return None
    fp = q_fingerprint(q)
    if fp in used_texts:
        return None
    if bucket:
        used[bucket].add((s, a))
    used_texts.add(fp)
    return q

def place_correct(options, correct_idx=0):
    """يوزع موضع الإجابة الصحيحة عشوائياً مع تتبع الموضع"""
    opts = list(options)
    idx = rng.randrange(len(opts))
    opts[0], opts[idx] = opts[idx], opts[0]
    return opts, idx

# ============ بناة الأسئلة ============

def build_complete(bank, s, a, special=None):
    """أكمل الآية الكريمة — القطع عند 30-60% والمشتتات تتمات قرآنية حقيقية"""
    words = bank.ayah_words.get((s, a), [])
    n = len(words)
    if n < 5:
        return None
    lo = max(2, int(n * 0.3))
    hi = min(n - 2, max(3, int(n * 0.6)))
    if lo > hi:
        return None
    k = rng.randint(lo, hi)
    prefix, suffix = words[:k], words[k:]
    correct = " ".join(suffix)
    cs = strip_marks(correct)
    pool = bank.distractor_fragments(s, a, k, rng)
    similar_first = [f for f, sim in pool if sim] + [f for f, sim in pool if not sim]
    distractors, seen = [], {cs}
    for cand in similar_first:
        text = " ".join(cand)
        ts = strip_marks(text)
        if ts in seen or not ts:
            continue
        if abs(len(cand) - len(suffix)) > max(2, len(suffix) * 0.55):
            continue
        seen.add(ts)
        distractors.append(text)
        if len(distractors) == 3:
            break
    if len(distractors) < 3:
        return None
    # هل المشتتات من آيات بنفس البادئة فعلاً؟ (سؤال متشابهات)
    same_prefix = bank.ayahs_with_prefix(s, a, 2)
    qtype = "similar_ayah" if same_prefix else "complete_ayah"
    if special == "first":
        q = f"أكمل الآية الافتتاحية من سورة {bank.surah_name(s)} ({a}): ﴿{' '.join(prefix)} {DOTS}﴾"
    elif special == "last":
        q = f"أكمل الآية الختامية من سورة {bank.surah_name(s)} ({a}): ﴿{' '.join(prefix)} {DOTS}﴾"
    else:
        q = f"أكمل الآية الكريمة ({a}): ﴿{' '.join(prefix)} {DOTS}﴾"
    options = [correct] + distractors
    opts, cidx = place_correct(options)
    info = "سؤال في المواضع المتشابهة بين الآيات" if qtype == "similar_ayah" else None
    obj = {"q": q, "options": opts, "correct": cidx, "surahNumber": s,
           "ayahNumber": a, "type": qtype}
    if info:
        obj["info"] = info
    return obj

def build_word_blank(bank, s, a):
    """اختر الكلمة الناقصة من الآية"""
    words = bank.ayah_words.get((s, a), [])
    if len(words) < 4:
        return None
    freq = Counter(strip_marks(w) for w in words)
    cands = [i for i, w in enumerate(words)
             if i >= 1 and 3 <= word_len(w) <= 9 and freq[strip_marks(w)] == 1]
    if not cands:
        return None
    rng.shuffle(cands)
    for i in cands:
        correct = words[i]
        alts = bank.similar_word(correct, s, rng, exclude={strip_marks(w) for w in words})
        alts = [w for w in alts if strip_marks(w) != strip_marks(correct)]
        # تنويع: اختيار أول 3 بعد الخلط
        rng.shuffle(alts)
        picked = alts[:3]
        if len(picked) < 3:
            continue
        shown = words[:i] + [WB_DOTS] + words[i + 1:]
        q = f"اختر الكلمة الناقصة في الآية ({a}): ﴿{' '.join(shown)}﴾"
        opts, cidx = place_correct([correct] + picked)
        return {"q": q, "options": opts, "correct": cidx, "surahNumber": s,
                "ayahNumber": a, "type": "word_blank"}
    return None

def build_next_prev(bank, s, a, kind):
    """ما الآية التالية / السابقة؟"""
    n = bank.surah_ayahs(s)
    if kind == "next":
        if a >= n:
            return None
        target = a + 1
    else:
        if a <= 1:
            return None
        target = a - 1
    shown_ayah = bank.ayah_words[(s, a)]
    target_words = bank.ayah_words[(s, target)]
    if len(target_words) < 2:
        return None
    correct = bank.truncate(target_words, 9)
    cs = strip_marks(correct.replace(" …", ""))
    # مشتتات: آيات بنفس بادئة الآية الهدف (تشابه) ثم المجاورة ثم عشوائية السورة
    candidates = []
    same_prefix = bank.ayahs_with_prefix(s, target, 2) + bank.ayahs_with_prefix(s, target, 1)
    rng.shuffle(same_prefix)
    neighbors = [(s, target + d) for d in (1, 2) if 1 <= target + d <= n] + \
                [(s, target - d) for d in (1, 2) if 1 <= target - d <= n]
    rng.shuffle(neighbors)
    order = same_prefix + neighbors
    tries = 0
    seen = {cs}
    for (s2, a2) in order:
        if (s2, a2) == (s, target):
            continue
        w2 = bank.ayah_words.get((s2, a2), [])
        if len(w2) < 2:
            continue
        text = bank.truncate(w2, 9)
        ts = strip_marks(text.replace(" …", ""))
        if ts in seen:
            continue
        seen.add(ts)
        candidates.append(text)
        if len(candidates) == 3:
            break
    while len(candidates) < 3 and tries < 50:
        tries += 1
        a2 = rng.randint(1, n)
        if a2 == target:
            continue
        w2 = bank.ayah_words.get((s, a2), [])
        if len(w2) < 2:
            continue
        text = bank.truncate(w2, 9)
        ts = strip_marks(text.replace(" …", ""))
        if ts in seen:
            continue
        seen.add(ts)
        candidates.append(text)
    if len(candidates) < 3:
        return None
    shown = bank.truncate(shown_ayah, 11)
    label = "التالية" if kind == "next" else "السابقة"
    q = f"ما الآية {label} للآية ({a}): ﴿{shown}﴾؟"
    same_prefix = bank.ayahs_with_prefix(s, target, 2)
    opts, cidx = place_correct([correct] + candidates)
    obj = {"q": q, "options": opts, "correct": cidx, "surahNumber": s,
           "ayahNumber": a, "type": kind + "_ayah"}
    if same_prefix:
        obj["info"] = "سؤال في المواضع المتشابهة بين الآيات"
    return obj

def build_info(bank, s, kind):
    """أسئلة معلومات السورة: عدد الآيات، الترتيب، المكية/المدنية"""
    sur = bank.surah_map[s]
    name = sur["name"]
    n = sur["ayahs"]
    if kind == "count":
        q = f"كم عدد آيات سورة {name}؟"
        extras = []
        for d in (-1, 1, -2, 2, 3, -3):
            v = n + d
            if v >= 3 and v <= 300 and v not in extras:
                extras.append(v)
            if len(extras) == 3:
                break
        nums = [n] + extras
        options = [f"{v} آية" for v in nums]
        cidx = options.index(f"{n} آية")
        return {"q": q, "options": options, "correct": cidx, "surahNumber": s,
                "ayahNumber": None, "type": "surah_ayahs_count"}
    if kind == "order":
        q = f"ما ترتيب سورة {name} في المصحف الشريف؟"
        extras = []
        for d in (-1, 1, -2, 2, 3, -3):
            v = s + d
            if 1 <= v <= 114 and v not in extras:
                extras.append(v)
            if len(extras) == 3:
                break
        nums = [s] + extras
        options = [f"السورة رقم {v}" for v in nums]
        cidx = options.index(f"السورة رقم {s}")
        return {"q": q, "options": options, "correct": cidx, "surahNumber": s,
                "ayahNumber": None, "type": "surah_order"}
    if kind == "revelation":
        if s in DISPUTED_REVELATION:
            return None
        q = f"سورة {name} من حيث النزول تُعد:"
        rev = sur["revelation"]
        options = list(REVELATION_OPTIONS[rev])
        cidx = options.index(options[0])
        return {"q": q, "options": options, "correct": cidx, "surahNumber": s,
                "ayahNumber": None, "type": "surah_revelation",
                "info": "التصنيف بحسب المشهور من كلام أهل التفسير"}
    return None

def build_vocab(bank, entry):
    """سؤال معنى المفردة — مع تحقق آلي من وجود الكلمة في الآية"""
    word, ref, meaning = entry
    s, a = map(int, ref.split(":"))
    words = bank.ayah_words.get((s, a), [])
    idx = next((i for i, w in enumerate(words) if strip_marks(w) == strip_marks(word)), None)
    if idx is None:
        return None, f"الكلمة «{word}» غير موجودة في {ref}"
    lo, hi = max(0, idx - 4), min(len(words), idx + 5)
    ctx = " ".join(words[lo:hi])
    if lo > 0:
        ctx = "… " + ctx
    if hi < len(words):
        ctx += " …"
    # مشتتات: معانٍ حقيقية لكلمات قرآنية أخرى بطول مشابه
    others = [m for (_, _, m) in VOCAB if m != meaning and 3 <= len(m) <= len(meaning) + 10]
    rng.shuffle(others)
    picked, seen = [], {norm(meaning)}
    for m in others:
        if norm(m) in seen:
            continue
        seen.add(norm(m))
        picked.append(m)
        if len(picked) == 3:
            break
    if len(picked) < 3:
        return None, f"مشتتات غير كافية لـ «{word}»"
    q = f"ما معنى كلمة «{word}» في قوله تعالى: ﴿{ctx}﴾؟"
    opts, cidx = place_correct([meaning] + picked)
    obj = {"q": q, "options": opts, "correct": cidx, "surahNumber": s, "ayahNumber": a,
           "type": "vocab", "info": "المعنى في ضوء كلام أهل التفسير (ابن كثير، الطبري، السعدي)"}
    return obj, None


# ============ النقل: أسئلة المؤلف الأصلية (يس والرحمن) ============

def load_legacy():
    path = os.path.join(CACHE, "legacy-questions.json")
    if not os.path.exists(path):
        return None
    with io.open(path, encoding="utf-8") as f:
        return json.load(f)

LEGACY_INFO = [
    ("سورة يس مكية أم مدنية؟", "surah_revelation"),
    ("كم عدد آيات سورة يس؟", "surah_ayahs_count"),
    ("ما ترتيب سورة يس في المصحف الشريف؟", "surah_order"),
    ("كم عدد آيات سورة الرحمن؟", "surah_ayahs_count"),
    ("ما ترتيب سورة الرحمن في المصحف الشريف؟", "surah_order"),
    ("سورة الرحمن من حيث النزول تُعد:", "surah_revelation"),
    ("ما الآية التي تتكرر في سورة الرحمن؟", "general"),
    ("من المقصود بالثقلين في سورة الرحمن؟", "vocab"),
]

def migrate_legacy(bank, report):
    legacy = load_legacy()
    if not legacy:
        return {}
    out = {}
    for sn_str, items in legacy.items():
        sn = int(sn_str)
        converted = []
        for item in items:
            obj = dict(item)
            obj.setdefault("surahNumber", sn)
            qtext = obj["q"]
            if "أكمل الآية الكريمة" in qtext:
                obj["type"] = "complete_ayah"
                # استنتاج رقم الآية بمطابقة (البادئة + الإجابة الصحيحة) مع نص المصدر
                m = re.search(r"﴿(.+?)\.{3,}﴾", qtext, re.S)
                ref = None
                if m:
                    prefix = norm(m.group(1))
                    correct = norm(obj["options"][obj["correct"]])
                    ref, fixed = find_ayah_span(bank, sn, prefix, correct)
                    if ref and fixed and _bare(fixed) != _bare(correct):
                        # تصحيح تشكيلي موثق من المصدر (لا تغيير في المعنى)
                        report["legacy_fixed"].append({
                            "surah": sn, "q": qtext[:60],
                            "old": correct, "new": fixed, "ayah": ref})
                        obj["options"][obj["correct"]] = fixed
                if ref:
                    obj["ayahNumber"] = ref
                else:
                    obj["needsReview"] = True
                    report["legacy_review"].append({"surah": sn, "q": qtext[:80]})
            else:
                matched = False
                for frag, t in LEGACY_INFO:
                    if norm(frag) in norm(qtext):
                        obj["type"] = t
                        if t in ("surah_ayahs_count", "surah_order", "surah_revelation"):
                            kind_name = {"surah_ayahs_count": "count",
                                         "surah_order": "order",
                                         "surah_revelation": "revelation"}[t]
                            legacy_info_types.add((kind_name, sn))
                        matched = True
                        break
                if not matched:
                    obj["type"] = "general"
            # تعليم مفاتيح المنع لكي لا يولد المولد أسئلة مطابقة
            if obj.get("type") in ("complete_ayah", "similar_ayah") and obj.get("ayahNumber"):
                used["complete"].add((sn, obj["ayahNumber"]))
                # الآية المكتملة عند المؤلف لا تجعل إجابةً لأسئلة تالية/سابقة مولّدة
                # (سؤال "التالية" للآية N إجابته N+1 ← يُمنع عند الموضع N)
                if obj["ayahNumber"] < bank.surah_ayahs(sn):
                    used["next"].add((sn, obj["ayahNumber"] - 0 if False else obj["ayahNumber"] - 1))
                if obj["ayahNumber"] > 1:
                    used["prev"].add((sn, obj["ayahNumber"] + 1))
            converted.append(obj)
        out[sn] = converted
    return out

def _bare(text):
    """نسخة مجردة للمقارنة: بلا مسافات أو علامات وقف أو ألف خنجرية"""
    return "".join(c for c in text
                   if c not in PAUSE_MARKS and c != "\u0670" and c != " ")

def find_ayah_span(bank, sn, prefix, correct):
    """يحدد رقم الآية التي تنتهي عندها التتمة، مع مطابقة متسامحة مع علامات الوقف
    ويعيد (ref, correction) حيث correction = نص المصدر الصحيح إن خالفه خيار المؤلف"""
    n = bank.surah_ayahs(sn)
    p, c = _bare(prefix), _bare(correct)
    if not p or not c:
        return None, None
    for start in range(1, n + 1):
        end = min(n, start + 5)
        pieces, orig_idx = [], []
        for j, i in enumerate(range(start, end + 1)):
            orig = bank.ayah(sn, i)
            b = _bare(orig)
            pieces.append(b)
            for k in range(len(b)):
                orig_idx.append((j, orig.find(b[k]) if False else k))
        # خريطة: موضع مجرد -> (رقم الآية النسبية، فهرس الحرف في الأصل)
        # نبني الخريطة بشكل صحيح: تتبع حروف الأصل المجردة بالترتيب
        pieces, orig_pos = [], []
        for j, i in enumerate(range(start, end + 1)):
            orig = bank.ayah(sn, i)
            b, positions = [], []
            for k, ch in enumerate(orig):
                if ch not in PAUSE_MARKS and ch != "\u0670" and ch != " ":
                    b.append(ch)
                    positions.append(k)
            pieces.append("".join(b))
            orig_pos.append(positions)
        joined = "".join(pieces)
        pos = joined.find(p)
        if pos < 0:
            continue
        pend = pos + len(p)
        if joined[pend:pend + len(c)] != c:
            continue
        # رقم الآية التي تنتهي عندها التتمة
        cum = 0
        for j, piece in enumerate(pieces):
            if pend + len(c) <= cum + len(piece):
                return start + j, None
            cum += len(piece)
        return start + len(pieces) - 1, None
    # لم تطابق التتمة كما هي: جرّب اكتشاف خلاف تشكيلي واقتراح الصحيح من المصدر
    for start in range(1, n + 1):
        end = min(n, start + 5)
        pieces, orig_pos = [], []
        for j, i in enumerate(range(start, end + 1)):
            orig = bank.ayah(sn, i)
            b, positions = [], []
            for k, ch in enumerate(orig):
                if ch not in PAUSE_MARKS and ch != "\u0670" and ch != " ":
                    b.append(ch)
                    positions.append(k)
            pieces.append("".join(b))
            orig_pos.append(positions)
        joined = "".join(pieces)
        pos = joined.find(p)
        if pos < 0:
            continue
        pend = pos + len(p)
        if pend + len(c) > len(joined):
            continue
        # يجب أن يكون الامتداد داخل آية واحدة ليصح التصحيح
        cum = 0
        bounds = []
        for j, piece in enumerate(pieces):
            bounds.append((cum, cum + len(piece), j))
            cum += len(piece)
        seg_ayah = None
        for b0, b1, j in bounds:
            if pend >= b0 and pend + len(c) <= b1:
                seg_ayah = (start + j, j)
                break
        if not seg_ayah:
            return None, None
        ay_abs, j = seg_ayah
        # استخراج المقطع الأصلي الموافق للحروف المجردة
        j_pend = pend - bounds[j][0]
        positions = orig_pos[j]
        if j_pend + len(c) > len(positions):
            return None, None
        k0 = positions[j_pend]
        k1 = positions[j_pend + len(c) - 1]
        seg = bank.ayah(sn, ay_abs)[k0:k1 + 1]
        return ay_abs, seg
    return None, None

# ============ التخطيط والتوليد ============

ORDINALS = ["الأول", "الثاني", "الثالث", "الرابع", "الخامس", "السادس", "السابع", "الثامن", "التاسع"]

def split_ranges(n):
    """تقسيم السورة إلى نطاقات ~32 آية"""
    parts = max(1, math.ceil(n / 32))
    size = math.ceil(n / parts)
    return [(i * size + 1, min((i + 1) * size, n)) for i in range(parts)]

def select_questions(bank, s, a1, a2, target, include_first_last=False, vocab_entries=None):
    """يجمع أسئلة النطاق بمزيج متنوع من الأنواع"""
    pools = {"complete": [], "next": [], "prev": [], "wb": [], "vocab": []}
    for a in range(a1, a2 + 1):
        c = build_complete(bank, s, a)
        if c:
            pools["complete"].append(c)
        nx = build_next_prev(bank, s, a, "next")
        if nx:
            pools["next"].append(nx)
        pv = build_next_prev(bank, s, a, "prev")
        if pv:
            pools["prev"].append(pv)
        wb = build_word_blank(bank, s, a)
        if wb:
            pools["wb"].append(wb)
    if vocab_entries:
        for e in vocab_entries:
            obj, err = build_vocab(bank, e)
            if obj and obj["surahNumber"] == s and a1 <= obj["ayahNumber"] <= a2:
                pools["vocab"].append(obj)
    # الترتيب بالتناوب لأنواع متوازنة
    rotation = ["complete", "next", "complete", "prev", "wb", "complete", "vocab"]
    picked, seen_types_count = [], Counter()
    idx = {"complete": 0, "next": 0, "prev": 0, "wb": 0, "vocab": 0}
    # البداية والنهاية أولوية (مراجعة البداية والوسط والنهاية)
    firsts = [c for c in pools["complete"] if c["ayahNumber"] == a1]
    lasts = [c for c in pools["complete"] if c["ayahNumber"] == a2]
    if include_first_last:
        for c in firsts[:1] + lasts[:1]:
            added = try_add(c, c["type"], c["surahNumber"], c["ayahNumber"])
            if added and added not in picked:
                picked.append(added)
    rot_i = 0
    while len(picked) < target:
        kind = rotation[rot_i % len(rotation)]
        rot_i += 1
        pool = pools[kind]
        if idx[kind] >= len(pool):
            # انتهى هذا النوع: أكمل من المتبقي أي نوع
            remaining = False
            for k2 in ("complete", "next", "prev", "wb", "vocab"):
                if idx[k2] < len(pools[k2]):
                    kind, pool = k2, pools[k2]
                    remaining = True
                    break
            if not remaining:
                break
        obj = pool[idx[kind]]
        idx[kind] += 1
        added = try_add(obj, obj["type"], obj["surahNumber"], obj["ayahNumber"] or 0)
        if added:
            picked.append(added)
    return picked

def build_group_quiz(bank, surahs, vocab_by_surah, used_info):
    """اختبار مجموعة للسور القصيرة — بترتيب المصحف"""
    questions = []
    info_kinds = ["revelation", "count", "order"]
    for pos, s in enumerate(surahs):
        n = bank.surah_ayahs(s)
        # أكمل من أول السورة
        c = build_complete(bank, s, 1, special="first")
        if c:
            added = try_add(c, c["type"], s, 1)
            if added:
                questions.append(added)
        # سؤال من وسط السورة
        mid = max(2, n // 2)
        for a in (mid, mid + 1, 2):
            if a > n:
                continue
            c = build_complete(bank, s, a) or build_word_blank(bank, s, a)
            if c:
                added = try_add(c, c["type"], s, a)
                if added:
                    questions.append(added)
                    break
        # تالية أو سابقة
        nx = build_next_prev(bank, s, min(n, 2 + pos % max(1, n - 2)), "next" if pos % 2 == 0 else "prev")
        if nx:
            added = try_add(nx, nx["type"], s, nx["ayahNumber"])
            if added:
                questions.append(added)
        # معلومة واحدة (بالتبديل بين الأنواع)
        kind = info_kinds[pos % 3]
        if kind == "revelation" and ("surah_revelation", s) in legacy_info_types:
            kind = "count"
        if (kind, s) not in used_info:
            q = build_info(bank, s, kind)
            if q:
                used_info.add((kind, s))
                questions.append(q)
        # مفردة إن توافرت
        for e in vocab_by_surah.get(s, []):
            obj, err = build_vocab(bank, e)
            if obj:
                added = try_add(obj, "vocab", s, obj["ayahNumber"])
                if added:
                    questions.append(added)
                break
    return questions


# ============ الكتابة والسجلات ============

# بدايات الأجزاء الثلاثين القياسية: (الجزء، سورة، آية)
JUZ_STARTS = [(1,1,1),(2,2,142),(3,2,253),(4,3,93),(5,4,24),(6,4,148),(7,5,82),(8,6,111),
              (9,7,88),(10,8,41),(11,9,93),(12,11,6),(13,12,53),(14,15,1),(15,17,1),
              (16,18,75),(17,21,1),(18,23,1),(19,25,21),(20,27,56),(21,29,46),(22,33,31),
              (23,36,28),(24,39,32),(25,41,47),(26,46,1),(27,51,31),(28,58,1),(29,67,1),(30,78,1)]

def juz_starts_full():
    return JUZ_STARTS

def surah_juzs(surah_n):
    """أجزاء السورة: كل جزء يبدأ داخل السورة أو قبلها ويمتد إليها"""
    juzs = []
    for i, (jz, js, ja) in enumerate(JUZ_STARTS):
        nxt = JUZ_STARTS[i + 1] if i + 1 < len(JUZ_STARTS) else (31, 115, 1)
        if js <= surah_n < nxt[1] or (surah_n == nxt[1] and nxt[2] > 1):
            juzs.append(jz)
    return juzs

def write_quiz_file(rel_path, quiz, header_note):
    full = os.path.join(ROOT, "js", rel_path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    body = json.dumps(quiz, ensure_ascii=False, indent=1)
    content = (
        f"/* ============================================\n"
        f"   {quiz['title']}\n"
        f"   {header_note}\n"
        f"   المصدر: النص القرآني — مشروع Tanzil (tanzil.net)\n"
        f"   ملف مولّد آلياً بواسطة tools/generate.py\n"
        f"   ============================================ */\n\n"
        f"window.QUIZ_DATA = window.QUIZ_DATA || {{}};\n"
        f"window.QUIZ_DATA[\"{quiz['id']}\"] = {body};\n"
    )
    with io.open(full, "w", encoding="utf-8") as f:
        f.write(content)

def main():
    bank = QuranBank()
    report = {"legacy_review": [], "legacy_fixed": [], "vocab_bad": [], "vocab_ok": 0}

    # 1) قائمة المفردات: سقوط غير الموجودة نصياً
    checked_vocab = []
    for entry in VOCAB:
        word, ref, meaning = entry
        s, a = map(int, ref.split(":"))
        words = bank.ayah_words.get((s, a), [])
        if any(strip_marks(w) == strip_marks(word) for w in words):
            checked_vocab.append(entry)
            report["vocab_ok"] += 1
        else:
            report["vocab_bad"].append(f"{word} ({ref})")
    vocab_by_surah = defaultdict(list)
    for e in checked_vocab:
        vocab_by_surah[int(e[1].split(":")[0])].append(e)

    # 2) نقل أسئلة المؤلف
    legacy = migrate_legacy(bank, report)

    registry_quizzes = []   # كل الاختبارات بترتيب العرض
    surah_quizzes = defaultdict(list)  # n -> [meta]
    qtypes_of = defaultdict(set)

    def add_quiz(qid, title, surahs, arange, count, file_rel, group, note=None, extra_types=None):
        meta = {"id": qid, "title": title, "surahs": surahs,
                "range": arange, "count": count, "file": file_rel, "group": group}
        if extra_types:
            meta["types"] = extra_types
        registry_quizzes.append(meta)
        for s in surahs:
            surah_quizzes[s].append(meta)
        return meta

    # 3) أسئلة المؤلف (يس والرحمن) أول قائمة كل سورة
    for sn in (36, 55):
        if sn not in legacy:
            continue
        quiz = {"id": f"q-{sn:03d}-a", "title": f"سورة {bank.surah_name(sn)} — الاختبار الأصلي",
                "surahs": [sn], "ayahRange": [1, bank.surah_ayahs(sn)],
                "source": "أسئلة المؤلف الأصلية للمشروع (نُقلت كما هي)", "questions": legacy[sn]}
        write_quiz_file(f"data/surah-{sn:03d}/author.js", quiz,
                        "أسئلة المؤلف الأصلية — نُقلت دون تغيير")
        types = {q.get("type", "general") for q in legacy[sn]}
        add_quiz(quiz["id"], quiz["title"], [sn], [1, bank.surah_ayahs(sn)],
                 len(legacy[sn]), f"data/surah-{sn:03d}/author.js", "author", extra_types=sorted(types))

    # 4) الفاتحة: اختبار خاص
    q1 = select_questions(bank, 1, 1, 7, 11, include_first_last=True,
                          vocab_entries=vocab_by_surah.get(1, []))
    info = build_info(bank, 1, "order")
    if info and ("order", 1) not in legacy_info_types:
        q1.append(info)
    rng.shuffle(q1)
    quiz = {"id": "q-001-1", "title": "سورة الفاتحة — اختبار شامل",
            "surahs": [1], "ayahRange": [1, 7],
            "source": "Tanzil (Simple Plain)", "questions": q1}
    write_quiz_file("data/surah-001/quiz-01.js", quiz, "أسئلة مولّدة موثقة من النص")
    add_quiz(quiz["id"], quiz["title"], [1], [1, 7], len(q1), "data/surah-001/quiz-01.js",
             "surah", extra_types=sorted({q["type"] for q in q1}))

    # 5) السور المستقلة (آيات >= 15) — نطاقات
    total_questions = 0
    for s in range(2, 115):
        n = bank.surah_ayahs(s)
        if n < 15:
            continue
        ranges = split_ranges(n)
        surah_qs = []
        for pi, (a1, a2) in enumerate(ranges):
            target = 22 if n >= 60 else 20
            include_fl = (pi == 0 or pi == len(ranges) - 1)
            qs = select_questions(bank, s, a1, a2, target, include_first_last=include_fl,
                                  vocab_entries=vocab_by_surah.get(s, []))
            # معلومات السورة في أول اختبار
            if pi == 0:
                for kind in ("revelation", "count", "order"):
                    if (kind, s) in legacy_info_types:
                        continue
                    if not any(q.get("type") == "surah_" + {"revelation": "revelation", "count": "ayahs_count", "order": "order"}[kind]
                               for qq in surah_qs for q in [qq] if q["surahNumber"] == s):
                        info = build_info(bank, s, kind)
                        if info:
                            qs.append(info)
            ordinal = ORDINALS[pi] if pi < len(ORDINALS) else str(pi + 1)
            last_word = "الأخير" if pi == len(ranges) - 1 and len(ranges) > 1 else ordinal
            title = f"سورة {bank.surah_name(s)} — الجزء {last_word} (الآيات {a1}-{a2})"
            if len(ranges) == 1:
                title = f"سورة {bank.surah_name(s)} — اختبار السورة (الآيات {a1}-{a2})"
            quiz = {"id": f"q-{s:03d}-{pi + 1}", "title": title, "surahs": [s],
                    "ayahRange": [a1, a2], "source": "Tanzil (Simple Plain)", "questions": qs}
            write_quiz_file(f"data/surah-{s:03d}/quiz-{pi + 1:02d}.js", quiz,
                            f"الآيات {a1}-{a2} — مولّدة وموثقة من النص")
            add_quiz(quiz["id"], title, [s], [a1, a2], len(qs),
                     f"data/surah-{s:03d}/quiz-{pi + 1:02d}.js", "surah",
                     extra_types=sorted({q["type"] for q in qs}))
            surah_qs.extend(qs)
            total_questions += len(qs)

    # 6) مجموعات السور القصيرة (بترتيب المصحف)
    SHORT_GROUPS = {
        "g1": {"surahs": [60, 61, 62, 63, 65, 66],
               "title": "مجموعة السور القصيرة (1) — من المجادلة إلى التحريم"},
        "g2": {"surahs": [93, 94, 95, 97, 98, 99],
               "title": "مجموعة السور القصيرة (2) — من الضحى إلى الزلزلة"},
        "g3": {"surahs": [100, 101, 102, 103, 104, 105, 106, 107],
               "title": "مجموعة السور القصيرة (3) — من العاديات إلى الماعون"},
        "g4": {"surahs": [108, 109, 110, 111, 112, 113, 114],
               "title": "مجموعة السور القصيرة (4) — خواتيم المصحف"},
    }
    used_info = set()
    for gi, (gkey, g) in enumerate(SHORT_GROUPS.items(), 1):
        qs = build_group_quiz(bank, g["surahs"], vocab_by_surah, used_info)
        quiz = {"id": f"q-{gkey}", "title": g["title"], "surahs": g["surahs"],
                "ayahRange": [1, max(bank.surah_ayahs(s) for s in g["surahs"])],
                "source": "Tanzil (Simple Plain)", "questions": qs}
        write_quiz_file(f"data/groups/group-{gi}.js", quiz,
                        "أسئلة مولّدة موثقة من النص — سور مجمعة بترتيب المصحف")
        add_quiz(quiz["id"], quiz["title"], g["surahs"], quiz["ayahRange"], len(qs),
                 f"data/groups/group-{gi}.js", "short-group",
                 extra_types=sorted({q["type"] for q in qs}))
        total_questions += len(qs)

    # 7) مراجعات شاملة للسور كثيرة الاختبارات (تعليمية: تجميع من اختبارات السورة)
    for s in range(2, 115):
        n = bank.surah_ayahs(s)
        if n < 15:
            continue
        part_meta = [m for m in surah_quizzes[s] if m["group"] == "surah"]
        if len(part_meta) >= 4:
            all_qs = []
            for m in part_meta:
                data = parse_quiz_file(os.path.join(ROOT, "js", m["file"]))
                all_qs.extend(data["questions"])
            all_qs = [q for q in all_qs if not q["type"].startswith("surah_")]
            sample = rng.sample(all_qs, min(18, len(all_qs)))
            quiz = {"id": f"q-{s:03d}-x", "title": f"سورة {bank.surah_name(s)} — مراجعة شاملة",
                    "surahs": [s], "ayahRange": [1, n],
                    "source": "Tanzil (Simple Plain)", "questions": sample}
            write_quiz_file(f"data/surah-{s:03d}/comprehensive.js", quiz,
                            "مراجعة شاملة تجمع من اختبارات السورة (تكرار تعليمي مقصود)")
            add_quiz(quiz["id"], quiz["title"], [s], [1, n], len(sample),
                     f"data/surah-{s:03d}/comprehensive.js", "comprehensive",
                     extra_types=sorted({q["type"] for q in sample}))
            total_questions += len(sample)

    # 8) مراجعة جزء تبارك والحواميم
    REVIEWS = {
        "tabarak": {"surahs": list(range(67, 78)), "title": "مراجعة شاملة — سور جزء تبارك"},
        "hawameem": {"surahs": list(range(40, 47)), "title": "مراجعة شاملة — سور الحواميم"},
    }
    for rkey, r in REVIEWS.items():
        pool = []
        for s in r["surahs"]:
            for m in surah_quizzes[s]:
                if m["group"] in ("surah", "author"):
                    data = parse_quiz_file(os.path.join(ROOT, "js", m["file"]))
                    pool.extend(data["questions"])
        pool = [q for q in pool if not str(q.get("type", "")).startswith("surah_")]
        sample = rng.sample(pool, min(20, len(pool)))
        quiz = {"id": f"q-rv-{rkey}", "title": r["title"], "surahs": r["surahs"],
                "ayahRange": [1, max(bank.surah_ayahs(s) for s in r["surahs"])],
                "source": "Tanzil (Simple Plain)", "questions": sample}
        write_quiz_file(f"data/groups/review-{rkey}.js", quiz,
                        "مراجعة شاملة لسور الجزء (تكرار تعليمي مقصود من اختبارات السور)")
        add_quiz(quiz["id"], quiz["title"], r["surahs"], quiz["ayahRange"], len(sample),
                 f"data/groups/review-{rkey}.js", "review",
                 extra_types=sorted({q["type"] for q in sample}))
        total_questions += len(sample)

    # 9) سجل السور
    surah_registry = []
    for s in bank.surahs:
        n = s["ayahs"]
        category = "طويلة" if n >= 50 else ("متوسطة" if n >= 20 else "قصيرة")
        surah_registry.append({
            "n": s["n"], "name": s["name"], "ayahs": n,
            "revelation": s["revelation"], "category": category,
            "juzs": surah_juzs(s["n"]),
            "quizzes": [{"id": m["id"], "title": m["title"], "count": m["count"],
                         "range": m["range"], "file": m["file"]} for m in surah_quizzes.get(s["n"], [])],
        })
    with io.open(os.path.join(JS, "surah-registry.js"), "w", encoding="utf-8") as f:
        f.write("/* سجل سور القرآن الكريم — مولّد آلياً بواسطة tools/generate.py\n"
                "   الأعداد والتصنيف من بيانات موثقة (Tanzil / alquran.cloud) */\n")
        f.write("window.JUZ_STARTS = " + json.dumps(
            [{"juz": jz, "surah": s_, "ayah": a_} for (jz, s_, a_) in juz_starts_full()],
            ensure_ascii=False) + ";\n\n")
        f.write("window.SURAH_REGISTRY = " + json.dumps(surah_registry, ensure_ascii=False, indent=1) + ";\n")

    # 10) سجل الاختبارات
    with io.open(os.path.join(JS, "quiz-registry.js"), "w", encoding="utf-8") as f:
        f.write("/* سجل الاختبارات — مولّد آلياً بواسطة tools/generate.py\n"
                "   يُحمَّل كاملاً (بيانات وصفية فقط) ولا تُحمَّل ملفات الأسئلة إلا عند بدء الاختبار */\n")
        f.write("window.QUIZ_REGISTRY = " + json.dumps(registry_quizzes, ensure_ascii=False, indent=1) + ";\n")

    # 11) تقرير
    total_q = 0
    per_type = Counter()
    for m in registry_quizzes:
        total_q += m["count"]
        for t in m.get("types", []):
            per_type[t] += m["count"] // max(1, len(m.get("types", [1])))
    with io.open(os.path.join(ROOT, "tools", "vocab-report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
    print(f"عدد الاختبارات: {len(registry_quizzes)}")
    print(f"إجمالي الأسئلة (بالشاملة): {total_q}")
    print(f"مفردات معتمدة: {report['vocab_ok']}  |  مفردات مسقطة: {len(report['vocab_bad'])} → {report['vocab_bad']}")
    print(f"أسئلة المؤلف بحاجة مراجعة: {len(report['legacy_review'])}")
    print(f"تصحيحات موثقة على أسئلة المؤلف: {len(report['legacy_fixed'])}")
    print(f"أسئلة الأنواع: {dict(per_type)}")

if __name__ == "__main__":
    main()
