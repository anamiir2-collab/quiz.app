/* Quran Quiz learning platform — additive layer over the existing quiz engine/data. */
(function () {
  "use strict";

  var STORE_KEY = "qqProgress_v1";
  var PROFILE_KEY = "quranQuizUserName_v1";
  var BOOKMARK_KEY = "qqBookmarks_v1";
  var PLAN_KEY = "qqRevisionPlans_v1";
  var SETTINGS_KEY = "qqSettings_v1";
  var ATTEMPT_VERSION = 1;
  var activeView = "home";
  var SURAH_LIST = window.SURAH_REGISTRY || [];
  var QUIZ_LIST = window.QUIZ_REGISTRY || [];
  var viewLabels = {
    home: "الرئيسية", surahs: "اختبارات السور", achievements: "الإنجازات", profile: "الملف الشخصي",
    review: "المراجعة الذكية", stats: "إحصائياتي", daily: "تحدي اليوم", history: "سجل الاختبارات",
    plan: "خطة المراجعة", bookmarks: "المحفوظات", backup: "النسخ الاحتياطي"
  };

  function safeRead(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : fallback;
    } catch (e) { return fallback; }
  }
  function safeWrite(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { return false; }
  }
  function getStore() {
    var data = safeRead(STORE_KEY, { results: {}, inprogress: {} });
    if (!data.results || typeof data.results !== "object") data.results = {};
    if (!data.inprogress || typeof data.inprogress !== "object") data.inprogress = {};
    if (!Array.isArray(data.attempts)) data.attempts = [];
    return data;
  }
  function persistStore(data) { return safeWrite(STORE_KEY, data); }
  function getName() {
    try { return (localStorage.getItem(PROFILE_KEY) || localStorage.getItem("qq_name") || "").trim(); }
    catch (e) { return ""; }
  }
  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function node(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function findSurah(n) { return SURAH_LIST.find(function (s) { return s.n === Number(n); }); }
  function findQuiz(id) { return QUIZ_LIST.find(function (q) { return q.id === id; }); }
  function quizUrl(id, extra) { return "quiz.html?quiz=" + encodeURIComponent(id) + (extra || ""); }
  function surahNameList(q) {
    return (q.surahs || []).map(function (n) { var s = findSurah(n); return s ? s.name : "سورة " + n; }).join("، ");
  }
  function allAttempts() {
    return getStore().attempts.filter(function (a) {
      return a && typeof a === "object" && a.quizId && Number.isFinite(Number(a.score));
    }).sort(function (a, b) { return Number(b.ts || 0) - Number(a.ts || 0); });
  }
  function completedQuizCount() {
    var s = getStore();
    return Object.keys(s.results).filter(function (id) { return s.results[id] && Number(s.results[id].attempts) > 0; }).length;
  }
  function summary() {
    var attempts = allAttempts();
    var answers = attempts.reduce(function (acc, a) {
      (a.answers || []).forEach(function (x) {
        if (x && typeof x.correct === "boolean") { acc.total++; if (x.correct) acc.correct++; }
      });
      return acc;
    }, { total: 0, correct: 0 });
    var surahs = {};
    attempts.forEach(function (a) { (a.surahs || (findQuiz(a.quizId) || {}).surahs || []).forEach(function (n) { surahs[n] = true; }); });
    return {
      attempts: attempts, answers: summarySafeNumber(summaryCount(attempts)),
      totalAttempts: attempts.length, completedQuizzes: completedQuizCount(),
      answered: summarySafeNumber(summaryAnswerCount(attempts, "total")),
      correct: summarySafeNumber(summaryAnswerCount(attempts, "correct")),
      wrong: summarySafeNumber(summaryAnswerCount(attempts, "wrong")),
      accuracy: summaryAnswerCount(attempts, "total") ? Math.round(summaryAnswerCount(attempts, "correct") / summaryAnswerCount(attempts, "total") * 100) : 0,
      surahs: Object.keys(surahs).length, uniqueSurahs: surahs
    };
  }
  function summaryCount(attempts) { return attempts.length; }
  function summarySafeNumber(v) { return Number.isFinite(Number(v)) ? Number(v) : 0; }
  function summaryAnswerCount(attempts, type) {
    return attempts.reduce(function (n, a) {
      return n + (a.answers || []).filter(function (x) {
        if (!x || typeof x.correct !== "boolean") return false;
        return type === "total" || (type === "correct" ? x.correct : !x.correct);
      }).length;
    }, 0);
  }
  function dateLabel(ts) {
    if (!ts || !Number.isFinite(Number(ts))) return "التاريخ غير متاح";
    try { return new Date(Number(ts)).toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" }); }
    catch (e) { return new Date(Number(ts)).toLocaleString(); }
  }
  function localDateKey(date) {
    var d = date || new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function bookmarks() {
    var b = safeRead(BOOKMARK_KEY, []);
    return Array.isArray(b) ? b.filter(function (x) { return x && x.id && (x.type === "quiz" || x.type === "surah"); }) : [];
  }
  function plans() {
    var p = safeRead(PLAN_KEY, []);
    return Array.isArray(p) ? p.filter(function (x) { return x && x.id && x.quizId; }) : [];
  }
  function showMessage(container, text, type) {
    var message = node("p", "qp-message " + (type || "info"), text);
    message.setAttribute("role", type === "error" ? "alert" : "status");
    container.prepend(message);
    window.setTimeout(function () { if (message.parentNode) message.remove(); }, 5000);
  }
  function makeCard(title, body, action, label) {
    var card = node("article", "qp-card");
    var h = node("h3", "", title);
    var p = node("p", "", body);
    card.append(h, p);
    if (action && label) {
      var btn = node("button", "qp-btn", label);
      btn.type = "button"; btn.addEventListener("click", action); card.appendChild(btn);
    }
    return card;
  }
  function statCard(label, value, detail) {
    var card = node("div", "qp-stat");
    card.append(node("span", "qp-stat-label", label), node("strong", "qp-stat-value", String(value)), node("small", "", detail || ""));
    return card;
  }
  function statGrid(items) {
    var grid = node("div", "qp-stat-grid");
    items.forEach(function (it) { grid.appendChild(statCard(it[0], it[1], it[2] || "")); });
    return grid;
  }
  function heading(title, subtitle) {
    var wrap = node("div", "qp-section-heading");
    wrap.append(node("h2", "", title));
    if (subtitle) wrap.appendChild(node("p", "", subtitle));
    return wrap;
  }
  function empty(text) { return node("p", "qp-empty", text); }
  function button(label, fn, cls) {
    var b = node("button", "qp-btn" + (cls ? " " + cls : ""), label);
    b.type = "button"; b.addEventListener("click", fn); return b;
  }
  function selectControl(labelText, options, name) {
    var label = node("label", "qp-field");
    label.appendChild(node("span", "", labelText));
    var select = node("select");
    select.name = name;
    options.forEach(function (o) {
      var op = node("option", "", o.label); op.value = o.value; select.appendChild(op);
    });
    label.appendChild(select); return { label: label, input: select };
  }
  function addBookmark(type, id) {
    var current = bookmarks();
    if (current.some(function (b) { return b.type === type && String(b.id) === String(id); })) return false;
    var title = type === "quiz" ? ((findQuiz(id) || {}).title || id) : ("سورة " + ((findSurah(id) || {}).name || id));
    current.unshift({ type: type, id: String(id), title: title, createdAt: Date.now() });
    return safeWrite(BOOKMARK_KEY, current);
  }
  function removeBookmark(type, id) {
    return safeWrite(BOOKMARK_KEY, bookmarks().filter(function (b) { return !(b.type === type && String(b.id) === String(id)); }));
  }
  function setView(id, push) {
    if (!viewLabels[id]) id = "home";
    activeView = id;
    document.querySelectorAll(".qp-view").forEach(function (v) { v.hidden = v.dataset.view !== id; });
    document.querySelectorAll("[data-qp-nav]").forEach(function (b) {
      var active = b.getAttribute("data-qp-nav") === id;
      b.classList.toggle("active", active);
      if (active) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
    if (push !== false && location.hash !== "#" + id) {
      try { history.pushState({ qpView: id }, "", "#" + id); } catch (e) {}
    }
    renderView(id);
    window.scrollTo(0, 0);
  }
  function go(id) { setView(id, true); }
  var viewContainers = {};
  function createView(id) {
    var view = node("section", "qp-view");
    view.dataset.view = id; view.id = "qp-view-" + id; view.hidden = true;
    viewContainers[id] = view;
    return view;
  }
  function buildShell() {
    var frame = document.querySelector(".frame");
    var header = frame && frame.querySelector(".arch-header");
    if (!frame || !header || document.getElementById("qp-navigation")) return false;
    var nav = node("nav", "qp-navigation");
    nav.id = "qp-navigation"; nav.setAttribute("aria-label", "التنقل الرئيسي");
    [
      ["home", "⌂", "الرئيسية"], ["surahs", "۞", "اختبارات السور"],
      ["achievements", "✦", "الإنجازات"], ["profile", "◉", "الملف الشخصي"]
    ].forEach(function (it) {
      var b = button(it[1] + " " + it[2], function () { go(it[0]); }, "qp-nav-item");
      b.setAttribute("data-qp-nav", it[0]); nav.appendChild(b);
    });
    header.insertAdjacentElement("afterend", nav);

    var originalNodes = [
      document.querySelector(".stats-row"), document.querySelector(".toolbar"),
      document.querySelectorAll(".section-title")[0], document.getElementById("groupsGrid"),
      document.querySelectorAll(".section-title")[1], document.getElementById("surahGrid"),
      document.getElementById("emptyState")
    ].filter(Boolean);
    var surahView = createView("surahs");
    originalNodes.forEach(function (el) { surahView.appendChild(el); });
    var footer = frame.querySelector(".home-footer");
    if (footer) surahView.appendChild(footer);

    var views = ["home", "achievements", "profile", "review", "stats", "daily", "history", "plan", "bookmarks", "backup"];
    views.forEach(function (id) { frame.appendChild(createView(id)); });
    frame.appendChild(surahView);

    var shortcuts = node("div", "qp-shortcuts");
    [
      ["review", "المراجعة الذكية", "راجع الأسئلة التي أخطأت فيها سابقًا"],
      ["stats", "إحصائياتي", "تابع نتائجك وتقدمك الفعلي"],
      ["daily", "تحدي اليوم", "اختبار اختياري يتغير كل يوم"],
      ["history", "سجل الاختبارات", "ارجع إلى محاولاتك المسجلة"],
      ["plan", "خطة المراجعة", "نظّم المراجعة على طريقتك"],
      ["bookmarks", "المحفوظات", "ارجع إلى السور والاختبارات المحفوظة"],
      ["backup", "النسخ الاحتياطي", "صدّر بياناتك أو استعد نسخة سابقة"]
    ].forEach(function (x) { shortcuts.appendChild(makeCard(x[1], x[2], function () { go(x[0]); }, "فتح")); });
    var home = viewContainers.home;
    home.appendChild(node("div", "qp-hero", "رحلتك مع القرآن الكريم"));
    home.querySelector(".qp-hero").appendChild(node("p", "", "تعلّم ومراجعة بهدوء، وتابع تقدمك من خلال بياناتك المحفوظة على هذا الجهاز."));
    var actions = node("div", "qp-home-actions");
    actions.append(button("ابدأ اختبارًا", function () { go("surahs"); }, "qp-btn-primary"));
    actions.append(button("راجع أخطاءك", function () { go("review"); }));
    home.appendChild(actions);
    home.appendChild(heading("ملخص التقدم", "الأرقام هنا تُحسب من سجلات التطبيق المتاحة."));
    home.appendChild(statGrid([
      ["اختبارات مكتملة", "—", "الاختبارات التي لها نتيجة محفوظة"],
      ["إجابات مسجلة", "—", "من المحاولات التفصيلية الجديدة"],
      ["الدقة", "—", "من الإجابات المسجلة بالتفصيل"],
      ["السور المتدرّب عليها", "—", "حسب سجلات المحاولات"]
    ]));
    home.appendChild(heading("أدوات التعلّم", "اختر ما يناسب وقتك."));
    home.appendChild(shortcuts);

    viewContainers.achievements.appendChild(heading("الإنجازات", "تُفتح الشارات عند تحقق شروطها من سجلاتك الفعلية."));
    viewContainers.profile.appendChild(heading("الملف الشخصي", "اسمك وتقدمك محفوظان محليًا على هذا المتصفح."));
    viewContainers.review.appendChild(heading("المراجعة الذكية", "تعرض الأخطاء التي تم تسجيل تفاصيلها في المحاولات الجديدة."));
    viewContainers.stats.appendChild(heading("إحصائياتي", "المحاولات القديمة قد تحتوي على نتيجة إجمالية فقط؛ لا نستنتج منها إجابات غير محفوظة."));
    viewContainers.daily.appendChild(heading("تحدي اليوم", "تحدٍ اختياري بلا عقوبة عند تفويت أي يوم."));
    viewContainers.history.appendChild(heading("سجل الاختبارات", "تُعرض المحاولات التفصيلية الجديدة والنتائج القديمة المتاحة."));
    viewContainers.plan.appendChild(heading("خطة المراجعة", "أنشئ خطة بسيطة تعتمد على اختبار موجود بالفعل."));
    viewContainers.bookmarks.appendChild(heading("المحفوظات", "احفظ اختبارًا أو سورة للرجوع إليها لاحقًا."));
    viewContainers.backup.appendChild(heading("النسخ الاحتياطي وإدارة البيانات", "احتفظ بنسخة من تقدمك قبل الاستعادة أو إعادة الضبط."));
    frame.appendChild(node("footer", "qp-footer", "اختبارات القرآن الكريم · تُحفظ بيانات التعلّم محليًا على جهازك."));
    return true;
  }

  function renderHome() {
    var s = summary(), home = viewContainers.home;
    var grid = home.querySelector(".qp-stat-grid");
    if (grid) {
      grid.replaceChildren();
      [
        ["اختبارات مكتملة", s.completedQuizzes, "اختبارات لها نتيجة محفوظة"],
        ["إجابات مسجلة", s.answered, "من المحاولات التفصيلية الجديدة"],
        ["الدقة", s.answered ? s.accuracy + "%" : "—", s.answered ? s.correct + " صحيحة من " + s.answered : "تظهر بعد تسجيل إجابات تفصيلية"],
        ["السور المتدرّب عليها", s.surahs, "من السجلات المتاحة"]
      ].forEach(function (it) { grid.appendChild(statCard(it[0], it[1], it[2])); });
    }
    var hero = home.querySelector(".qp-hero");
    var name = getName();
    hero.textContent = name ? "أهلًا يا " + name : "رحلتك مع القرآن الكريم";
    var sub = node("p", "", "واصل التعلّم والمراجعة على قدر وقتك، وستجد هنا ملخصًا لتقدمك المسجّل.");
    hero.appendChild(sub);
    var continueArea = home.querySelector(".qp-continue");
    if (continueArea) continueArea.remove();
    var store = getStore();
    var unfinished = Object.keys(store.inprogress).find(function (id) { return store.inprogress[id] && findQuiz(id); });
    var cont = node("div", "qp-card qp-continue");
    cont.appendChild(node("h3", "", "متابعة التعلّم"));
    cont.appendChild(node("p", "", unfinished ? "لديك اختبار غير مكتمل: " + (findQuiz(unfinished).title) : "ابدأ اختبارًا من السور المتاحة، أو افتح أحد الاختبارات المحفوظة."));
    if (unfinished) cont.appendChild(button("متابعة الاختبار", function () { location.href = quizUrl(unfinished); }, "qp-btn-primary"));
    else cont.appendChild(button("تصفّح الاختبارات", function () { go("surahs"); }, "qp-btn-primary"));
    home.insertBefore(cont, home.querySelector(".qp-home-actions"));
  }

  function renderAchievements() {
    var view = viewContainers.achievements, s = summary(), attempts = s.attempts;
    var earned = [
      { id: "first", title: "أول اختبار", desc: "إكمال اختبار واحد", ok: attempts.some(function (a) { return a.type !== "review"; }) },
      { id: "five", title: "خطوات ثابتة", desc: "إكمال خمسة اختبارات", ok: attempts.filter(function (a) { return a.type !== "review"; }).length >= 5 },
      { id: "review", title: "بداية المراجعة", desc: "إكمال جلسة مراجعة مسجلة", ok: attempts.some(function (a) { return a.type === "review"; }) },
      { id: "accuracy", title: "دقة مميزة", desc: "تحقيق 90% على الأقل في محاولة مكتملة", ok: attempts.some(function (a) { return Number(a.score) >= 90 && a.type !== "review"; }) },
      { id: "explorer", title: "مستكشف السور", desc: "التدرّب على 10 سور مختلفة", ok: s.surahs >= 10 }
    ];
    view.replaceChildren(view.querySelector(".qp-section-heading"));
    view.appendChild(statGrid([
      ["اختبارات مكتملة", s.completedQuizzes, "من النتائج المحفوظة"],
      ["إجابات صحيحة", s.correct, "من المحاولات التفصيلية"],
      ["الدقة الإجمالية", s.answered ? s.accuracy + "%" : "—", "لا تتوفر نسبة مفصلة قبل تسجيل الإجابات"]
    ]));
    var grid = node("div", "qp-achievement-grid");
    earned.forEach(function (b) {
      var card = node("article", "qp-achievement" + (b.ok ? " earned" : " locked"));
      card.append(node("div", "qp-achievement-mark", b.ok ? "✓" : "◇"), node("h3", "", b.title), node("p", "", b.desc), node("small", "", b.ok ? "تم تحقيق الشرط" : "لم يتحقق الشرط بعد"));
      grid.appendChild(card);
    });
    view.appendChild(grid);
  }

  function renderProfile() {
    var view = viewContainers.profile, s = summary(), name = getName();
    view.replaceChildren(view.querySelector(".qp-section-heading"));
    var card = node("article", "qp-card qp-profile-card");
    card.append(node("h3", "", "الاسم المحفوظ"), node("p", "", name || "لم يتم حفظ اسم بعد."));
    card.appendChild(button("تعديل الاسم", function () {
      if (window.QQUserProfile && typeof window.QQUserProfile.edit === "function") window.QQUserProfile.edit();
      else showMessage(view, "ميزة تعديل الاسم غير متاحة في هذه الصفحة.", "error");
    }));
    view.appendChild(card);
    view.appendChild(statGrid([
      ["اختبارات مكتملة", s.completedQuizzes, ""], ["إجابات مسجلة", s.answered, ""],
      ["الدقة", s.answered ? s.accuracy + "%" : "—", ""], ["السور المتدرّب عليها", s.surahs, ""]
    ]));
    var tools = node("div", "qp-shortcuts");
    [
      ["الخطة", "إدارة خطة المراجعة", "plan"], ["المحفوظات", "السور والاختبارات المحفوظة", "bookmarks"],
      ["النسخ الاحتياطي", "تصدير أو استعادة البيانات", "backup"]
    ].forEach(function (x) { tools.appendChild(makeCard(x[0], x[1], function () { go(x[2]); }, "فتح")); });
    view.appendChild(tools);
  }

  function renderReview() {
    var view = viewContainers.review, attempts = allAttempts(), rows = [];
    view.replaceChildren(view.querySelector(".qp-section-heading"));
    attempts.forEach(function (a) {
      (a.answers || []).forEach(function (ans) {
        if (ans && ans.correct === false && ans.question && ans.correctAnswer) rows.push({ attempt: a, answer: ans });
      });
    });
    if (!rows.length) {
      view.appendChild(empty("لا توجد أخطاء محفوظة بالتفصيل حتى الآن. بعد إكمال اختبار جديد ستظهر هنا الأسئلة التي أخطأت فيها، إن وُجدت."));
      return;
    }
    rows.slice(0, 100).forEach(function (row) {
      var card = node("article", "qp-card qp-review-card");
      card.append(node("p", "qp-meta", (row.attempt.title || row.attempt.quizId) + " · " + dateLabel(row.attempt.ts)));
      card.append(node("h3", "", row.answer.question));
      card.append(node("p", "qp-wrong", "إجابتك: " + (row.answer.selectedText || "غير متاحة")));
      card.append(node("p", "qp-correct", "الإجابة الصحيحة: " + row.answer.correctAnswer));
      card.appendChild(button("إعادة اختبار السورة / الاختبار", function () { location.href = quizUrl(row.attempt.quizId, "&review=1"); }));
      view.appendChild(card);
    });
  }

  function renderStats() {
    var view = viewContainers.stats, s = summary(), attempts = s.attempts;
    view.replaceChildren(view.querySelector(".qp-section-heading"));
    view.appendChild(statGrid([
      ["اختبارات مكتملة", s.completedQuizzes, "اختبارات لها نتيجة محفوظة"],
      ["إجابات", s.answered, "من المحاولات التفصيلية المسجلة"],
      ["صحيحة", s.correct, "الإجابات الصحيحة المسجلة"],
      ["غير صحيحة", s.wrong, "الإجابات غير الصحيحة المسجلة"],
      ["الدقة", s.answered ? s.accuracy + "%" : "—", "الصحيحة ÷ الإجابات المسجلة"],
      ["سور مختلفة", s.surahs, "حسب معرفات السور في السجلات"]
    ]));
    if (!attempts.length) {
      view.appendChild(empty("ستظهر الرسوم والاتجاهات بعد إكمال اختبارات جديدة. نتائجك القديمة محفوظة، لكنها لا تحتوي على سجل تفصيلي لكل محاولة."));
      return;
    }
    view.appendChild(heading("أحدث النتائج", "درجة كل محاولة مكتملة مسجلة بالتفصيل."));
    var chart = node("div", "qp-score-chart");
    attempts.slice(0, 10).reverse().forEach(function (a) {
      var bar = node("div", "qp-score-row");
      bar.append(node("span", "qp-score-label", (a.title || a.quizId).replace(/^سورة /, "").slice(0, 28)));
      var track = node("div", "qp-score-track"), fill = node("div", "qp-score-fill");
      fill.style.width = Math.max(0, Math.min(100, Number(a.score) || 0)) + "%";
      track.appendChild(fill); bar.appendChild(track);
      bar.append(node("strong", "qp-score-number", Math.round(Number(a.score) || 0) + "%"));
      chart.appendChild(bar);
    });
    view.appendChild(chart);
    var surahPerf = {};
    attempts.forEach(function (a) {
      var ids = a.surahs || (findQuiz(a.quizId) || {}).surahs || [];
      ids.forEach(function (id) {
        if (!surahPerf[id]) surahPerf[id] = { n: 0, sum: 0 };
        surahPerf[id].n++; surahPerf[id].sum += Number(a.score) || 0;
      });
    });
    view.appendChild(heading("الأداء حسب السورة", "متوسط درجات المحاولات التي تتضمن السورة؛ الاختبارات المجمعة قد تشمل أكثر من سورة."));
    Object.keys(surahPerf).sort(function (a,b) { return Number(a)-Number(b); }).forEach(function (id) {
      var surah = findSurah(id), perf = surahPerf[id];
      view.appendChild(node("p", "qp-performance-row", "سورة " + (surah ? surah.name : id) + " — متوسط " + Math.round(perf.sum / perf.n) + "% (" + perf.n + " محاولات)"));
    });
  }

  function renderDaily() {
    var view = viewContainers.daily, day = localDateKey(), s = getStore();
    view.replaceChildren(view.querySelector(".qp-section-heading"));
    var candidates = QUIZ_LIST.filter(function (q) { return q && q.id && Number(q.count) >= 3 && Number(q.count) <= 15; });
    if (!candidates.length) candidates = QUIZ_LIST.filter(function (q) { return q && q.id && Number(q.count) > 0 && Number(q.count) <= 25; });
    if (!candidates.length) { view.appendChild(empty("لا توجد اختبارات قصيرة صالحة متاحة لتحدي اليوم.")); return; }
    var seed = 0; for (var i = 0; i < day.length; i++) seed = (seed * 31 + day.charCodeAt(i)) >>> 0;
    var quiz = candidates[seed % candidates.length];
    var done = s.attempts.some(function (a) { return a && a.type === "daily" && a.challengeDate === day; });
    var card = node("article", "qp-card qp-daily-card");
    card.append(node("span", "qp-pill", day), node("h3", "", "تحدي اليوم: " + quiz.title), node("p", "", Number(quiz.count) + " سؤالًا من اختبار موجود في بنك الأسئلة. التحدي اختياري ولا توجد عقوبة عند تفويته."));
    if (done) card.append(node("p", "qp-success", "أكملت تحدي اليوم بالفعل. يمكنك مراجعة نتيجتك في سجل الاختبارات."));
    else card.appendChild(button("ابدأ التحدي", function () { location.href = quizUrl(quiz.id, "&challenge=" + encodeURIComponent(day)); }, "qp-btn-primary"));
    view.appendChild(card);
  }

  function renderHistory() {
    var view = viewContainers.history, s = getStore(), attempts = allAttempts();
    view.replaceChildren(view.querySelector(".qp-section-heading"));
    var filter = node("select", "qp-history-filter");
    [["all","كل السجلات"],["daily","تحدي اليوم"],["standard","اختبارات عادية"],["review","المراجعة"]].forEach(function (o) {
      var opt = node("option", "", o[1]); opt.value = o[0]; filter.appendChild(opt);
    });
    var list = node("div", "qp-history-list");
    function draw() {
      list.replaceChildren();
      var detailed = attempts.filter(function (a) { return filter.value === "all" || (filter.value === "standard" ? !a.type || a.type === "standard" : a.type === filter.value); });
      detailed.forEach(function (a) {
        var card = node("article", "qp-card qp-history-card");
        card.append(node("h3", "", a.title || a.quizId), node("p", "qp-meta", dateLabel(a.ts)),
          node("p", "", "النتيجة " + Math.round(Number(a.score) || 0) + "% · " + (a.correct || 0) + " صحيحة · " + (a.wrong || 0) + " غير صحيحة · " + (a.total || (a.answers || []).length) + " سؤالًا"));
        card.appendChild(button("فتح الاختبار مجددًا", function () { location.href = quizUrl(a.quizId); }));
        list.appendChild(card);
      });
      if (!detailed.length) list.appendChild(empty("لا توجد محاولات تفصيلية مطابقة لهذا الاختيار."));
    }
    filter.addEventListener("change", draw);
    view.append(filter, list);
    var legacyIds = Object.keys(s.results || {}).filter(function (id) { return s.results[id] && Number(s.results[id].attempts) > 0; });
    if (legacyIds.length) {
      view.appendChild(heading("نتائج محفوظة من الإصدارات السابقة", "هذه ملخصات موجودة أصلًا، وليست سجلًا لكل محاولة."));
      legacyIds.forEach(function (id) {
        var q = findQuiz(id), r = s.results[id];
        var card = node("article", "qp-card qp-legacy-result");
        card.append(node("h3", "", q ? q.title : id), node("p", "", "أفضل نتيجة: " + r.best + "% · آخر نتيجة: " + r.last + "% · عدد المحاولات: " + r.attempts),
          node("p", "qp-meta", dateLabel(r.ts)));
        view.appendChild(card);
      });
    }
    draw();
  }

  function renderPlan() {
    var view = viewContainers.plan, current = plans(), attempts = allAttempts();
    view.replaceChildren(view.querySelector(".qp-section-heading"));
    var form = node("form", "qp-form");
    var quizSelect = selectControl("اختبار المراجعة", QUIZ_LIST.map(function (q) { return { value: q.id, label: q.title + " (" + q.count + " سؤالًا)" }; }), "quizId");
    var goalSelect = selectControl("عدد الجلسات المستهدف أسبوعيًا", [1,2,3,4,5,6,7].map(function (n) { return { value: String(n), label: String(n) }; }), "weeklyGoal");
    var questionsSelect = selectControl("هدف الأسئلة لكل جلسة", [5,10,15,20,25].map(function (n) { return { value: String(n), label: String(n) + " سؤالًا (هدف إرشادي)" }; }), "targetQuestions");
    form.append(quizSelect.label, goalSelect.label, questionsSelect.label, button("حفظ الخطة", function () {
      var q = findQuiz(quizSelect.input.value);
      if (!q) { showMessage(view, "اختَر اختبارًا صالحًا.", "error"); return; }
      var p = current.find(function (x) { return x.quizId === q.id; });
      if (p) {
        p.weeklyGoal = Number(goalSelect.input.value); p.targetQuestions = Number(questionsSelect.input.value); p.updatedAt = Date.now();
      } else {
        current.unshift({ id: "plan-" + Date.now(), quizId: q.id, title: q.title, weeklyGoal: Number(goalSelect.input.value), targetQuestions: Number(questionsSelect.input.value), createdAt: Date.now(), updatedAt: Date.now() });
      }
      if (!safeWrite(PLAN_KEY, current)) showMessage(view, "تعذر حفظ الخطة. تحقق من مساحة التخزين المتاحة.", "error");
      else renderView("plan");
    }, "qp-btn-primary"));
    form.addEventListener("submit", function (e) { e.preventDefault(); });
    view.appendChild(form);
    if (!current.length) { view.appendChild(empty("لم تنشئ خطة بعد. اختر اختبارًا وحدد هدفك الأسبوعي.")); return; }
    current.forEach(function (p) {
      var sessions = attempts.filter(function (a) { return a.quizId === p.quizId && Number(a.ts) >= Number(p.createdAt || 0) && (!a.type || a.type === "standard"); }).length;
      var card = node("article", "qp-card qp-plan-card");
      card.append(node("h3", "", p.title), node("p", "", "الهدف الأسبوعي: " + p.weeklyGoal + " جلسات · هدف الأسئلة: " + p.targetQuestions + " (إرشادي)"),
        node("p", "qp-success", "جلسات مكتملة منذ إنشاء الخطة: " + sessions));
      card.appendChild(button("ابدأ المراجعة", function () { location.href = quizUrl(p.quizId); }, "qp-btn-primary"));
      card.appendChild(button("حذف الخطة", function () {
        if (!window.confirm("هل تريد حذف هذه الخطة؟ لن تُحذف نتائج الاختبارات.")) return;
        safeWrite(PLAN_KEY, plans().filter(function (x) { return x.id !== p.id; })); renderView("plan");
      }, "qp-btn-danger"));
      view.appendChild(card);
    });
  }

  function renderBookmarks() {
    var view = viewContainers.bookmarks, current = bookmarks();
    view.replaceChildren(view.querySelector(".qp-section-heading"));
    var form = node("form", "qp-form");
    var typeSelect = selectControl("نوع المحفوظ", [{value:"quiz",label:"اختبار"},{value:"surah",label:"سورة"}], "type");
    var itemSelect = selectControl("العنصر", [], "item");
    function updateOptions() {
      itemSelect.input.replaceChildren();
      (typeSelect.input.value === "quiz" ? QUIZ_LIST.map(function (q) { return {value:q.id,label:q.title}; }) : SURAH_LIST.map(function (s) { return {value:String(s.n),label:"سورة " + s.name}; }))
        .forEach(function (o) { var op = node("option", "", o.label); op.value = o.value; itemSelect.input.appendChild(op); });
    }
    typeSelect.input.addEventListener("change", updateOptions); updateOptions();
    form.append(typeSelect.label, itemSelect.label, button("إضافة للمحفوظات", function () {
      if (!itemSelect.input.value) return;
      if (!addBookmark(typeSelect.input.value === "quiz" ? "quiz" : "surah", itemSelect.input.value)) {
        showMessage(view, "العنصر محفوظ بالفعل أو تعذر الحفظ.", "info"); return;
      }
      renderView("bookmarks");
    }, "qp-btn-primary"));
    form.addEventListener("submit", function (e) { e.preventDefault(); });
    view.appendChild(form);
    current.forEach(function (b) {
      var valid = b.type === "quiz" ? !!findQuiz(b.id) : !!findSurah(b.id);
      var card = node("article", "qp-card qp-bookmark-card");
      card.append(node("h3", "", b.title), node("p", "qp-meta", "أُضيف " + dateLabel(b.createdAt)));
      if (!valid) card.appendChild(node("p", "qp-message error", "العنصر الأصلي لم يعد موجودًا في البيانات الحالية."));
      else card.appendChild(button("فتح", function () {
        if (b.type === "quiz") location.href = quizUrl(b.id);
        else { go("surahs"); var s = findSurah(b.id); var search = document.getElementById("searchInput"); if (search && s) { search.value = s.name; search.dispatchEvent(new Event("input")); } }
      }));
      card.appendChild(button("إزالة", function () { removeBookmark(b.type, b.id); renderView("bookmarks"); }, "qp-btn-danger"));
      view.appendChild(card);
    });
    if (!current.length) view.appendChild(empty("لم تحفظ أي سورة أو اختبار بعد."));
  }

  function downloadText(filename, content, mime) {
    try {
      var blob = new Blob([content], { type: mime || "application/json;charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var a = node("a"); a.href = url; a.download = filename; a.style.display = "none";
      document.body.appendChild(a); a.click(); a.remove(); window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      return true;
    } catch (e) { return false; }
  }
  function buildBackup() {
    var store = getStore();
    return {
      app: "quran-quiz", schemaVersion: 1, exportedAt: new Date().toISOString(),
      profile: { displayName: getName() }, progress: store,
      bookmarks: bookmarks(), revisionPlans: plans(),
      settings: safeRead(SETTINGS_KEY, {}),
      note: "Question banks are bundled with the application and are not duplicated in this backup."
    };
  }
  function renderBackup() {
    var view = viewContainers.backup;
    view.replaceChildren(view.querySelector(".qp-section-heading"));
    view.appendChild(makeCard("تصدير نسخة احتياطية", "يشمل الاسم والتقدم والنتائج التفصيلية والمحفوظات والخطط والإعدادات.", function () {
      var ok = downloadText("quran-quiz-backup-" + localDateKey() + ".json", JSON.stringify(buildBackup(), null, 2));
      showMessage(view, ok ? "تم تجهيز ملف النسخة الاحتياطية للتنزيل." : "تعذر إنشاء الملف في هذا المتصفح.", ok ? "success" : "error");
    }, "Export Backup"));
    var form = node("form", "qp-form");
    var label = node("label", "qp-field");
    label.appendChild(node("span", "", "ملف النسخة الاحتياطية JSON"));
    var input = node("input"); input.type = "file"; input.accept = ".json,application/json"; input.required = true;
    label.appendChild(input);
    form.append(label, button("Restore Backup", function () {
      var file = input.files && input.files[0];
      if (!file) { showMessage(view, "اختَر ملف JSON أولًا.", "error"); return; }
      var reader = new FileReader();
      reader.onload = function () {
        var imported;
        try { imported = JSON.parse(String(reader.result || "")); } catch (e) { showMessage(view, "الملف ليس JSON صالحًا.", "error"); return; }
        if (!imported || imported.app !== "quran-quiz" || imported.schemaVersion !== 1 || !imported.progress || typeof imported.progress !== "object" || !imported.progress.results || !imported.progress.inprogress || !Array.isArray(imported.bookmarks) || !Array.isArray(imported.revisionPlans)) {
          showMessage(view, "صيغة النسخة غير مدعومة أو ينقصها بيانات أساسية. لم يتم تغيير بياناتك.", "error"); return;
        }
        if (!window.confirm("سيتم استبدال تقدمك الحالي بالبيانات الموجودة في النسخة. سننزّل نسخة من البيانات الحالية أولًا. هل تريد المتابعة؟")) return;
        downloadText("quran-quiz-before-restore-" + localDateKey() + ".json", JSON.stringify(buildBackup(), null, 2));
        var nextStore = imported.progress;
        if (!nextStore.results || !nextStore.inprogress) { showMessage(view, "بيانات التقدم غير صالحة.", "error"); return; }
        if (!Array.isArray(nextStore.attempts)) nextStore.attempts = [];
        try {
          if (!persistStore(nextStore) || !safeWrite(BOOKMARK_KEY, imported.bookmarks) || !safeWrite(PLAN_KEY, imported.revisionPlans) || !safeWrite(SETTINGS_KEY, imported.settings || {})) throw new Error("storage");
          if (imported.profile && typeof imported.profile.displayName === "string") {
            localStorage.setItem(PROFILE_KEY, imported.profile.displayName);
            localStorage.setItem("qq_name", imported.profile.displayName);
          }
          showMessage(view, "تمت استعادة النسخة. ستُحدّث الواجهة الآن.", "success");
          window.setTimeout(function () { location.reload(); }, 700);
        } catch (e) { showMessage(view, "تعذرت الاستعادة بالكامل بسبب مشكلة في التخزين. احتفظ بنسخة الأمان التي تم تنزيلها.", "error"); }
      };
      reader.onerror = function () { showMessage(view, "تعذر قراءة الملف.", "error"); };
      reader.readAsText(file);
    }, "qp-btn-primary"));
    form.addEventListener("submit", function (e) { e.preventDefault(); });
    view.appendChild(form);
    view.appendChild(heading("إعادة ضبط التقدم", "لن يتم حذف ملفات الأسئلة أو بيانات التطبيقات الأخرى. يمكنك الاحتفاظ باسمك."));
    view.appendChild(button("تصدير ثم إعادة ضبط التقدم", function () {
      if (!window.confirm("سيتم تصدير نسخة احتياطية ثم حذف نتائج الاختبارات وسجل المحاولات والمحفوظات وخطط المراجعة. سيبقى اسمك وملفات الأسئلة كما هي. هل تريد المتابعة؟")) return;
      downloadText("quran-quiz-before-reset-" + localDateKey() + ".json", JSON.stringify(buildBackup(), null, 2));
      var old = getStore();
      old.results = {}; old.inprogress = {}; old.attempts = [];
      try {
        if (!persistStore(old) || !safeWrite(BOOKMARK_KEY, []) || !safeWrite(PLAN_KEY, [])) throw new Error("storage");
        showMessage(view, "تمت إعادة ضبط تقدم التطبيق فقط.", "success");
        window.setTimeout(function () { location.reload(); }, 700);
      } catch (e) { showMessage(view, "تعذر إكمال إعادة الضبط بسبب مشكلة في التخزين.", "error"); }
    }, "qp-btn-danger"));
  }

  function renderView(id) {
    if (id === "home") renderHome();
    if (id === "achievements") renderAchievements();
    if (id === "profile") renderProfile();
    if (id === "review") renderReview();
    if (id === "stats") renderStats();
    if (id === "daily") renderDaily();
    if (id === "history") renderHistory();
    if (id === "plan") renderPlan();
    if (id === "bookmarks") renderBookmarks();
    if (id === "backup") renderBackup();
  }

  function init() {
    if (!buildShell()) return;
    var hash = (location.hash || "").replace(/^#/, "");
    setView(viewLabels[hash] ? hash : (viewContainers[hash] ? hash : "home"), false);
    window.addEventListener("popstate", function () {
      var id = (location.hash || "").replace(/^#/, "");
      setView(viewContainers[id] || viewLabels[id] ? id : "home", false);
    });
    window.addEventListener("qq-profile-updated", function () { renderView(activeView); });
    window.addEventListener("storage", function (e) {
      if (e.key === STORE_KEY || e.key === PROFILE_KEY || e.key === BOOKMARK_KEY || e.key === PLAN_KEY) renderView(activeView);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();