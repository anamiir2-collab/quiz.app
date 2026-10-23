# -*- coding: utf-8 -*-
"""
أداة التحقق الآلي من أسئلة اختبارات القرآن.

تفحص كل ملفات الأسئلة في js/data وتتحقق من:
1. سلامة البنية: أربعة اختيارات، رقم الإجابة صحيح، لا خيارات مكررة، حقول ناقصة.
2. مطابقة النص القرآني: كل إجابة صحيحة تُقارن حرفياً بنص Tanzil الموثق.
3. عدم تكرار الأسئلة عبر كل الاختبارات.
4. حدود الآيات: رقم الآية ضمن عدد آيات السورة.
5. إحصاء التغطية: أسئلة كل سورة وكل نوع.

الاستخدام:  python3 tools/verify.py
المخرجات:   تقرير مطبوع + tools/verification-report.md
"""
import io, json, os, re, sys, unicodedata
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from qbank import QuranBank, strip_marks, ROOT

# السور المتنازع في مكيّتها/مدنيتها عند العلماء
DISPUTED_REVELATION = {13, 22, 55, 76, 99, 110}

DOTS_MARKS = ("...............", "............", "……")
PAUSE = {chr(c) for c in range(0x06D6, 0x06F0)}

def bare(s):
    """نسخة مجردة للمقارنة"""
    return "".join(c for c in s if c not in PAUSE and c != "\u0670" and c != " " and c != "\n")

def norm(s):
    return unicodedata.normalize("NFC", s).strip()

class Verifier:
    def __init__(self):
        self.bank = QuranBank()
        self.errors = []
        self.warnings = []
        self.duplicates = []
        self.seen_questions = {}
        self.stats = Counter()
        self.per_surah = defaultdict(Counter)
        self.per_type = Counter()
        self.file_count = 0

    def err(self, quiz_id, qi, msg):
        self.errors.append(f"[{quiz_id}] سؤال {qi}: {msg}")

    def warn(self, quiz_id, qi, msg):
        self.warnings.append(f"[{quiz_id}] سؤال {qi}: {msg}")

    # ---------- تحقق البنية ----------
    def check_structure(self, quiz_id, qi, q):
        opts = q.get("options")
        if not isinstance(opts, list) or len(opts) != 4:
            self.err(quiz_id, qi, "عدد الاختيارات ليس 4")
            return False
        c = q.get("correct")
        if not isinstance(c, int) or not (0 <= c < len(opts)):
            self.err(quiz_id, qi, "رقم الإجابة الصحيحة خارج النطاق")
            return False
        bare_opts = [bare(o) for o in opts]
        if len(set(bare_opts)) != 4:
            self.warn(quiz_id, qi, "خيارات مكررة نصياً")
        if not q.get("q"):
            self.err(quiz_id, qi, "نص السؤال فارغ")
            return False
        t = q.get("type")
        if not t:
            self.warn(quiz_id, qi, "حقل type ناقص")
        sn = q.get("surahNumber")
        if sn is not None:
            an = q.get("ayahNumber")
            max_ayah = self.bank.surah_ayahs(sn) if sn in self.bank.surah_map else None
            if max_ayah is None:
                self.err(quiz_id, qi, f"رقم سورة غير صحيح: {sn}")
            elif an is not None and not (1 <= an <= max_ayah):
                self.err(quiz_id, qi, f"الآية {an} خارج نطاق السورة {sn} ({max_ayah} آية)")
        return True

    # ---------- تحقق الأنواع ----------
    def check_question(self, quiz_id, qi, q):
        t = q.get("type", "general")
        sn = q.get("surahNumber")
        an = q.get("ayahNumber")
        correct = q["options"][q["correct"]]

        if t in ("complete_ayah", "similar_ayah"):
            qtext = q["q"]
            if "﴿" in qtext and "﴾" in qtext:
                inner = qtext[qtext.index("﴿") + 1:qtext.rindex("﴾")]
                m_parts = re.split(r"[.…]{3,}", inner)
                if len(m_parts) >= 2:
                    prefix = norm(m_parts[0])
                    full = prefix + " " + correct
                    fb = bare(full)
                    ayah_bare = bare(self.bank.ayah(sn, an)) if sn and an else ""
                    if not ayah_bare:
                        self.err(quiz_id, qi, "لا مرجع آية للتحقق")
                    elif fb == ayah_bare:
                        pass  # ✓ مطابقة تامة
                    elif ayah_bare.startswith(fb) or fb in bare(" ".join(
                            self.bank.ayah(sn, i) for i in range(max(1, an - 2), min(self.bank.surah_ayahs(sn), an + 3) + 1))):
                        self.warn(quiz_id, qi, "النص مطابق مع امتداد/اختصار طفيف")
                    else:
                        self.err(quiz_id, qi, f"الإجابة لا تطابق نص {sn}:{an}")
                else:
                    self.warn(quiz_id, qi, "لا توجد نقاط القص في نص السؤال")
            # فحص التشابه: إذا كان مشتت مطابقاً لتمة آية أخرى بنفس البادئة فهذا مقصود
        elif t in ("next_ayah", "prev_ayah"):
            target = an + 1 if t == "next_ayah" else an - 1
            ay = self.bank.ayah(sn, target) if sn and target >= 1 else ""
            shown = correct.replace(" …", "")
            if not ay:
                self.err(quiz_id, qi, "لا توجد آية هدف للتحقق")
            elif not bare(ay).startswith(bare(shown)):
                self.err(quiz_id, qi, f"الإجابة ليست الآية {target} من السورة {sn}")
        elif t == "word_blank":
            ay = self.bank.ayah(sn, an)
            w = bare(correct)
            ay_words = [bare(x) for x in ay.split()]
            if w not in ay_words:
                self.err(quiz_id, qi, f"الكلمة «{correct}» ليست في نص {sn}:{an}")
            # نص السؤال يجب أن يساوي الآية مع إحلال النقاط
            qtext = q["q"]
            if "﴿" in qtext:
                inner = qtext[qtext.index("﴿") + 1:qtext.rindex("﴾")]
                parts = re.split(r"[.…]{3,}", inner)
                if len(parts) >= 2:
                    before, after = parts[0], parts[-1]
                    rebuilt = bare(before) + w + bare(after)
                    if rebuilt != bare(ay):
                        self.err(quiz_id, qi, "نص السؤال لا يطابق الآية مع إحلال الكلمة")
        elif t == "surah_ayahs_count":
            n = self.bank.surah_ayahs(sn)
            if not correct.startswith(str(n)):
                self.err(quiz_id, qi, f"عدد آيات {sn} المعلن ({n}) لا يطابق الإجابة ({correct})")
        elif t == "surah_order":
            if f"رقم {sn}" not in correct:
                self.err(quiz_id, qi, f"ترتيب السورة {sn} لا يطابق الإجابة ({correct})")
        elif t == "surah_revelation":
            rev = self.bank.surah_map[sn]["revelation"]
            if sn in DISPUTED_REVELATION:
                # فيها قولان: يكفي ألا يخالف الإجابة أحد القولين المعتبرين
                ok = correct.startswith("مكية") or correct.startswith("مدنية")
                if not ok:
                    self.err(quiz_id, qi, "إجابة النزول ليست من القولين المعتبرين")
            elif not correct.startswith(rev):
                self.err(quiz_id, qi, f"نوع السورة {sn} ({rev}) لا يطابق الإجابة ({correct})")
        elif t == "vocab":
            ay = self.bank.ayah(sn, an) if sn and an else ""
            if bare(correct).replace(" ", "") == "":
                self.err(quiz_id, qi, "معنى فارغ")
            if not q.get("info"):
                self.warn(quiz_id, qi, "سؤال معنى بلا مصدر info")
        elif t == "general":
            self.warn(quiz_id, qi, "سؤال عام بدون تحقق نصي آلي")
        return t

    # ---------- تشغيل ----------
    def run(self):
        data_dir = os.path.join(ROOT, "js", "data")
        for dirpath, _, filenames in sorted(os.walk(data_dir)):
            for fn in sorted(filenames):
                if not fn.endswith(".js"):
                    continue
                path = os.path.join(dirpath, fn)
                self.file_count += 1
                try:
                    quiz = parse(path)
                except Exception as e:
                    self.errors.append(f"[{fn}] فشل تحليل الملف: {e}")
                    continue
                qid = quiz.get("id", fn)
                for qi, q in enumerate(quiz.get("questions", [])):
                    self.stats["total"] += 1
                    if not self.check_structure(qid, qi, q):
                        continue
                    t = self.check_question(qid, qi, q)
                    self.per_type[t] += 1
                    if q.get("surahNumber"):
                        self.per_surah[q["surahNumber"]][t] += 1
                    fp = bare(q["q"]) + "|" + bare(q["options"][q["correct"]])
                    # ملفات المراجعة الشاملة مسموح تكرارها بنيّاً ولا تدخل سجل البصمات
                    if qid.endswith("-x") or "-rv-" in qid:
                        continue
                    if fp in self.seen_questions:
                        self.duplicates.append(
                            f"[{qid}] سؤال {qi} مكرر من [{self.seen_questions[fp]}]")
                    else:
                        self.seen_questions[fp] = f"{qid}#{qi}"

    def report(self):
        total = self.stats["total"]
        print("=" * 60)
        print(f"الملفات: {self.file_count} | الأسئلة: {total}")
        print(f"أخطاء: {len(self.errors)} | تحذيرات: {len(self.warnings)} | تكرارات: {len(self.duplicates)}")
        if self.errors:
            print("\n— الأخطاء —")
            for e in self.errors[:40]:
                print(" ✗", e)
        if self.duplicates:
            print("\n— التكرارات —")
            for d in self.duplicates[:20]:
                print(" ⚠", d)
        if self.warnings:
            print(f"\n— عينة تحذيرات ({len(self.warnings)}) —")
            for w in self.warnings[:12]:
                print(" ⚠", w)
        # تغطية السور
        zero = [s for s in self.bank.surah_map if sum(self.per_surah[s].values()) == 0]
        print("\n— تغطية السور —")
        print(f"سور بلا أسئلة: {len(zero)} → {zero[:10]}")
        counts = {s: sum(c.values()) for s, c in self.per_surah.items()}
        print(f"متوسط الأسئلة للسورة: {sum(counts.values()) / max(1, len(counts)):.1f}")
        # كتابة التقرير
        with io.open(os.path.join(ROOT, "tools", "verification-report.md"), "w", encoding="utf-8") as f:
            f.write("# تقرير التحقق الآلي من الأسئلة\n\n")
            f.write(f"- عدد الملفات: **{self.file_count}**\n- عدد الأسئلة: **{total}**\n")
            f.write(f"- الأخطاء: **{len(self.errors)}**\n- التحذيرات: **{len(self.warnings)}**\n")
            f.write(f"- الأسئلة المكررة بين الاختبارات: **{len(self.duplicates)}** (مسموح في المراجعات الشاملة)\n\n")
            f.write("## توزيع الأسئلة على الأنواع\n\n")
            for t, c in self.per_type.most_common():
                f.write(f"- {t}: {c}\n")
            f.write("\n## أسئلة كل سورة\n\n| السورة | الأسئلة | أكمل | تالية | سابقة | كلمة ناقصة | متشابهات | معانٍ | معلومات |\n|---|---|---|---|---|---|---|---|---|\n")
            for s in range(1, 115):
                c = self.per_surah[s]
                tot = sum(c.values())
                name = self.bank.surah_name(s)
                f.write(f"| {s}. {name} | {tot} | {c['complete_ayah']} | {c['next_ayah']} | {c['prev_ayah']} | {c['word_blank']} | {c['similar_ayah']} | {c['vocab']} | {c['surah_ayahs_count']+c['surah_order']+c['surah_revelation']} |\n")
            if self.errors:
                f.write("\n## الأخطاء\n\n")
                f.writelines(f"- {e}\n" for e in self.errors)
        print("\nكُتب التقرير: tools/verification-report.md")
        return len(self.errors)


def parse(path):
    """استخراج كائن الاختبار من ملف JS"""
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
    raise ValueError("JSON غير مكتمل")


if __name__ == "__main__":
    v = Verifier()
    v.run()
    sys.exit(1 if v.report() > 0 else 0)
