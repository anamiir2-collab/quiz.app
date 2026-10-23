# -*- coding: utf-8 -*-
"""
تجهيز النص القرآني الموثوق (Tanzil — Simple Plain) وتوحيده بأسلوب المشروع.

المصدر: ملف التنزيل الرسمي من tanzil.net (quranType=simple-plain).
الرخصة: Creative Commons Attribution 3.0 — الإسناد للمشروع مطلوب ويُذكر في README
والتطبيق. تغيير النص ممنوع؛ ما نفعله هنا هو فقط:
  1) توحيد ترتيب علامات التشكيل (NFC) — مكافئ يونيكودياً بلا تغيير المحتوى.
  2) إزالة الألف الخنجرية (ٰ U+0670) ما عدا كلمة الرَّحْمَٰن — وهذا هو الأسلوب
     الإملائي المعتمد في ملفات الأسئلة الأصلية للمشروع (الرَّحْمَٰنُ / هَذَا / عَلَى).
المخرجات:
  tools/cache/quran.json        : {"سورة:آية": "النص الموحد"}
  tools/cache/surahs.json       : بيانات السور الـ114
"""
import io, json, os, re, unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache")

DAGGER_ALEF = "\u0670"
MEEM = "\u0645"

def normalize(text: str) -> str:
    s = unicodedata.normalize("NFC", text)
    s = s.replace("\u200f", "").replace("\u200e", "").replace("\u200d", "").replace("\ufeff", "")
    # إزالة الألف الخنجرية ما لم تكن بعد ميم (الرَّحْمَٰن)
    # ملاحظة: الخنجرية تتبع حركة الميم، فنبحث عن الحرف الأساسي متجاوزين علامات التشكيل
    HARAKAT = set(range(0x064B, 0x0653)) | {0x0670}
    out = []
    for ch in s:
        if ch == DAGGER_ALEF:
            prev_base = ""
            for prev in reversed(out):
                if ord(prev) not in HARAKAT:
                    prev_base = prev
                    break
            if prev_base == MEEM:
                out.append(ch)
            # وإلا تُحذف (عَلَىٰ → عَلَى، هَٰذَا → هَذَا ...)
        else:
            out.append(ch)
    return "".join(out).strip()

def main():
    # 1) النص الأصلي من Tanzil
    with io.open(os.path.join(CACHE, "tanzil-simple-plain.txt"), encoding="utf-8") as f:
        lines = [normalize(l.rstrip("\n")) for l in f if l.strip() and not l.startswith("#")]

    # 2) أعداد آيات السور من بيانات المصدر المرجعي
    with io.open(os.path.join(CACHE, "surah-meta.json"), encoding="utf-8") as f:
        meta = json.load(f)["data"]
    counts = [(s["number"], s["numberOfAyahs"], s["revelationType"]) for s in meta]
    assert sum(c for _, c, _ in counts) == len(lines) == 6236, "خطأ في عدد الأسطر"

    BISMILLAH = normalize("بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ")
    quran = {}
    i = 0
    for sn, cnt, rev in counts:
        for an in range(1, cnt + 1):
            t = lines[i]
            if an == 1 and sn not in (1, 9) and t.startswith(BISMILLAH + " "):
                t = normalize(t[len(BISMILLAH):])
            quran[f"{sn}:{an}"] = t
            i += 1

    assert not quran["2:1"].startswith(BISMILLAH), "البسملة لم تُزال من البقرة!"
    assert quran["1:1"] == BISMILLAH, "خطأ في الفاتحة"
    assert normalize("إِلَٰهَ") == "إِلَهَ" and normalize("عَلَىٰ") == "عَلَى"
    assert "الرَّحْمَٰن" in quran["1:1"] and "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ" == quran["1:1"]

    with io.open(os.path.join(CACHE, "quran.json"), "w", encoding="utf-8") as f:
        json.dump(quran, f, ensure_ascii=False, separators=(",", ":"))

    # 3) بيانات السور: الاسم العربي النظيف ثابت مع التحقق من العدد والنوع
    names = load_names()
    surahs = []
    for sn, cnt, rev in counts:
        assert sn in names, f"اسم السورة {sn} مفقود"
        surahs.append({
            "n": sn, "name": names[sn], "ayahs": cnt,
            "revelation": "مكية" if rev == "Meccan" else "مدنية",
        })
    with io.open(os.path.join(CACHE, "surahs.json"), "w", encoding="utf-8") as f:
        json.dump(surahs, f, ensure_ascii=False, indent=1)

    # 4) تقرير سريع
    total_words = sum(len(t.split()) for t in quran.values())
    print(f"OK — 114 سورة، 6236 آية، {total_words} كلمة")
    print("عينات:")
    for k in ["1:1", "2:255", "36:40", "55:1", "112:1"]:
        print(" ", k, quran[k][:60])

def load_names():
    """الأسماء العربية القياسية للسور (نص نظيف بلا تشكيل) — مع جدول خاص بالأسماء المركبة."""
    A = "آل عمران"
    names = ["الفاتحة","البقرة",A,"النساء","المائدة","الأنعام","الأعراف","الأنفال","التوبة","يونس",
             "هود","يوسف","الرعد","إبراهيم","الحجر","النحل","الإسراء","الكهف","مريم","طه",
             "الأنبياء","الحج","المؤمنون","النور","الفرقان","الشعراء","النمل","القصص","العنكبوت","الروم",
             "لقمان","السجدة","الأحزاب","سبأ","فاطر","يس","الصافات","ص","الزمر","غافر",
             "فصلت","الشورى","الزخرف","الدخان","الجاثية","الأحقاف","محمد","الفتح","الحجرات","ق",
             "الذاريات","الطور","النجم","القمر","الرحمن","الواقعة","الحديد","المجادلة","الحشر","الممتحنة",
             "الصف","الجمعة","المنافقون","التغابن","الطلاق","التحريم","الملك","القلم","الحاقة","المعارج",
             "نوح","الجن","المزمل","المدثر","القيامة","الإنسان","المرسلات","النبأ","النازعات","عبس",
             "التكوير","الانفطار","المطففين","الانشقاق","البروج","الطارق","الأعلى","الغاشية","الفجر","البلد",
             "الشمس","الليل","الضحى","الشرح","التين","العلق","القدر","البينة","الزلزلة","العاديات",
             "القارعة","التكاثر","العصر","الهمزة","الفيل","قريش","الماعون","الكوثر","الكافرون","النصر",
             "المسد","الإخلاص","الفلق","الناس"]
    assert len(names) == 114
    return {i + 1: n for i, n in enumerate(names)}

if __name__ == "__main__":
    main()
