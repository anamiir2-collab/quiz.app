/* ============================================================
   محرك اختبارات القرآن الكريم — quiz-engine.js
   يحافظ على كل مميزات المحرك الأصلي (الخلط، المساعدات، النقاط،
   النتيجة، المراجعة، PDF، لوحة المفاتيح) ويضيف:
   - تحميل الاختبار من السجل عبر quiz.html?quiz=ID (تحميل فوري لملف واحد)
   - حفظ النتائج والمتابعة لاحقاً في localStorage (دون تصفير السوابق)
   - خلط ترتيب الأسئلة عند إعادة الاختبار
   - عرض مرجع الآية في المراجعة ورابط الاختبار التالي
   ============================================================ */
(function(){
"use strict";

/* ---------- التخزين المحلي ---------- */
var STORE_KEY = "qqProgress_v1";
var PROFILE_KEY = "quranQuizUserName_v1";
var queryParams = new URLSearchParams(window.location.search);
var isReviewMode = queryParams.get("review") === "1";
var challengeDate = queryParams.get("challenge") || "";
function loadStore(){
  try{
    var raw = localStorage.getItem(STORE_KEY);
    if(!raw) return {results:{}, inprogress:{}};
    var data = JSON.parse(raw);
    data.results = data.results || {};
    data.inprogress = data.inprogress || {};
    if (!Array.isArray(data.attempts)) data.attempts = [];
    return data;
  }catch(e){ return {results:{}, inprogress:{}}; }
}
function saveStore(){ try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); return true; } catch(e) { console.error("Unable to save quiz progress", e); return false; } }
var store = loadStore();

/* ---------- عناصر DOM ---------- */
var content = document.getElementById("content");
var dotsRow = document.getElementById("dotsRow");
var helpText = document.getElementById("helpText");
var progressWrap = document.getElementById("progressWrap");
var titleEl = document.getElementById("quizTitle");
var subEl = document.getElementById("quizSubtitle");

/* ---------- أدوات ---------- */
var QUIZ_ID = new URLSearchParams(window.location.search).get("quiz");
function findMeta(id){
  var list = window.QUIZ_REGISTRY || [];
  for(var i=0;i<list.length;i++) if(list[i].id === id) return list[i];
  return null;
}
function surahName(n){
  var list = window.SURAH_REGISTRY || [];
  for(var i=0;i<list.length;i++) if(list[i].n === n) return list[i].name;
  return String(n);
}
function shuffle(arr){
  var a = arr.slice();
  for(var i=a.length-1;i>0;i--){
    var j = Math.floor(Math.random()*(i+1));
    var t = a[i]; a[i]=a[j]; a[j]=t;
  }
  return a;
}
function shuffleQuestionOptions(item){
  var optWithIndex = item.options.map(function(text, idx){
    return {text:text, isCorrect: idx === item.correct};
  });
  var shuffled = shuffle(optWithIndex);
  return {
    q: item.q,
    options: shuffled.map(function(o){ return o.text; }),
    correct: shuffled.findIndex(function(o){ return o.isCorrect; })
  };
}

/* ---------- حالة اللعبة ---------- */
var rawQuestions = [];
var questions = [];
var TOTAL = 0;
var POINTS_PER_Q = 0;
var letters = ["أ","ب","ج","د"];
var current = 0, score = 0, selected = null, answered = false;
var userAnswers = [];
var helpsRemaining = 3;
var userName = (function(){ try { return localStorage.getItem(PROFILE_KEY) || localStorage.getItem("qq_name") || ""; } catch(e) { return ""; } })();
window.addEventListener("qq-profile-updated", function (event) {
  if (event && event.detail && typeof event.detail.name === "string") userName = event.detail.name;
  if (document.getElementById("nameInput") && typeof renderIntro === "function") renderIntro();
});
var quizMeta = null;
var quizData = null;
var isRetake = false;
var savedOrder = null;   // ترتيب محفوظ للمتابعة

/* ---------- مرجع الآية ---------- */
function ayahRef(item){
  if(!item || !item.surahNumber) return "";
  var s = surahName(item.surahNumber);
  if(item.ayahNumber) return s + " — الآية " + item.ayahNumber;
  return "سورة " + s;
}

/* ---------- تحميل بيانات الاختبار ---------- */
function loadQuizScript(file, cb){
  var sc = document.createElement("script");
  /* مسارات الملفات في السجل نسبية لمجلد js/ */
  sc.src = "js/" + file;
  sc.onload = cb;
  sc.onerror = function(){
    subEl.textContent = "تعذر تحميل ملف الأسئلة — تأكد من الرابط";
    content.innerHTML = '<div class="intro"><p>حدث خطأ في تحميل ملف الاختبار: ' + file + '</p>' +
      '<div class="controls" style="justify-content:center;"><a class="btn btn-ghost" href="index.html">العودة للقائمة</a></div></div>';
  };
  document.body.appendChild(sc);
}

function init(){
  if(!QUIZ_ID){
    window.location.href = "index.html";
    return;
  }
  quizMeta = findMeta(QUIZ_ID);
  if(!quizMeta){
    subEl.textContent = "لم يُعثر على الاختبار المطلوب";
    content.innerHTML = '<div class="intro"><p>الاختبار غير موجود في السجل: <b>' + QUIZ_ID + '</b></p>' +
      '<div class="controls" style="justify-content:center;"><a class="btn btn-ghost" href="index.html">العودة للقائمة</a></div></div>';
    return;
  }
  loadQuizScript(quizMeta.file, function(){
    quizData = (window.QUIZ_DATA || {})[QUIZ_ID];
    if(!quizData || !quizData.questions || !quizData.questions.length){
      subEl.textContent = "بيانات الاختبار غير متوفرة";
      return;
    }
    rawQuestions = quizData.questions;
    if (isReviewMode) {
      var lastMistakeAttempt = (store.attempts || []).slice().reverse().find(function (attempt) {
        return attempt && attempt.quizId === QUIZ_ID && attempt.type !== "review" && Array.isArray(attempt.answers) && attempt.answers.some(function (a) { return a && a.correct === false && Number.isInteger(a.sourceIdx); });
      });
      var missedIds = [];
      if (lastMistakeAttempt) lastMistakeAttempt.answers.forEach(function (a) {
        if (a && a.correct === false && Number.isInteger(a.sourceIdx) && missedIds.indexOf(a.sourceIdx) === -1) missedIds.push(a.sourceIdx);
      });
      if (!missedIds.length) {
        subEl.textContent = "لا توجد أخطاء محفوظة بالتفصيل لهذا الاختبار";
        content.textContent = "لا توجد أخطاء سابقة محفوظة يمكن مراجعتها لهذا الاختبار. أكمل اختبارًا جديدًا أولًا، ثم ارجع إلى المراجعة الذكية.";
        var back = document.createElement("a"); back.className = "btn btn-ghost"; back.href = "index.html#review"; back.textContent = "العودة للمراجعة"; content.appendChild(back);
        return;
      }
      rawQuestions = rawQuestions.map(function (q, index) { var copy = Object.assign({}, q); copy.__sourceIdx = index; return copy; }).filter(function (q) { return missedIds.indexOf(q.__sourceIdx) !== -1; });
    }
    TOTAL = rawQuestions.length;
    POINTS_PER_Q = 100 / TOTAL;
    titleEl.textContent = "✦ " + quizData.title + " ✦";
    subEl.textContent = TOTAL + " سؤالاً — " + (quizMeta.range ? quizMeta.range[0] + " - " + quizMeta.range[1] : "") +
      (quizMeta.surahs && quizMeta.surahs.length ? " — السور: " + quizMeta.surahs.map(surahName).join("، ") : "");
    document.title = quizData.title;
    renderIntro();
  });
}

/* ---------- دعم لوحة المفاتيح ---------- */
function handleKeydown(e){
  if(answered){
    if(e.key === "Enter"){ e.preventDefault(); nextQuestion(); }
    return;
  }
  var keyMap = {"1":0,"2":1,"3":2,"4":3,"ا":0,"ب":1,"ج":2,"د":3,"أ":0};
  if(keyMap[e.key] !== undefined){
    e.preventDefault();
    selectOption(keyMap[e.key]);
  }
  if(e.key === "Enter" && selected !== null){
    e.preventDefault();
    confirmAnswer();
  }
}
function attachKeyHandler(){ document.addEventListener("keydown", handleKeydown); }
function detachKeyHandler(){ document.removeEventListener("keydown", handleKeydown); }

/* ---------- شريط التقدم ---------- */
function updateHelpText(){
  helpText.textContent = "🌙 المساعدات المتبقية: " + helpsRemaining;
}
function buildDots(){
  dotsRow.innerHTML = "";
  for(var i=0;i<TOTAL;i++){
    var d = document.createElement("div");
    d.className = "dot";
    d.id = "dot-" + i;
    dotsRow.appendChild(d);
  }
}
function updateDots(forResult){
  for(var i=0;i<TOTAL;i++){
    var d = document.getElementById("dot-" + i);
    if(!d) continue;
    d.classList.remove("done","current","wrong-dot");
    if(i < current){
      if(forResult){
        var ans = userAnswers.find(function(a){ return a.idx === i; });
        d.classList.add(ans && ans.correct ? "done" : "wrong-dot");
      } else {
        d.classList.add("done");
      }
    } else if(i === current && !forResult){
      d.classList.add("current");
    }
  }
}
function triggerAnimation(){
  content.classList.remove("animate-in");
  void content.offsetWidth;
  content.classList.add("animate-in");
}

/* ---------- حفظ التقدم أثناء الاختبار ---------- */
function saveProgress(){
  if (isReviewMode) return;
  store.inprogress[QUIZ_ID] = {
    order: questions.map(function(q){ return q.__srcIdx; }),
    answers: userAnswers.map(function(a){
      return {idx:a.idx, correct:a.correct, chosen:a.chosen};
    }),
    current: current, score: score, helps: helpsRemaining,
    ts: Date.now()
  };
  saveStore();
}
function clearProgress(){
  if (isReviewMode) return;
  if(store.inprogress[QUIZ_ID]){
    delete store.inprogress[QUIZ_ID];
    saveStore();
  }
}

/* ---------- شاشة المقدمة ---------- */
function renderIntro(){
  progressWrap.style.display = "none";
  detachKeyHandler();

  var saved = isReviewMode ? null : store.inprogress[QUIZ_ID];
  var resumeBtn = saved
    ? '<button class="btn btn-ghost" onclick="window.__qz.resume()">⏸ متابعة الاختبار السابق (' + saved.current + " من " + TOTAL + ')</button>'
    : "";
  var bestInfo = store.results[QUIZ_ID]
    ? '<p class="keyboard-hint">🏆 أفضل نتيجة سابقة: ' + store.results[QUIZ_ID].best + " من 100 — عدد المحاولات: " + store.results[QUIZ_ID].attempts + '</p>'
    : "";

  content.innerHTML = '\
    <div class="intro">\
      <h2>✦ بسم الله نبدأ ✦</h2>\
      <p>' + (isReviewMode ? "مراجعة الأسئلة التي أخطأت فيها" : (challengeDate ? "تحدي اليوم" : "اختبار")) + ' : <b>' + quizData.title + '</b> — ' + TOTAL + ' سؤالاً</p>\
      ' + (userName ? '<p class="keyboard-hint">الاختبار باسم: <b>' + userName.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;") + '</b></p>' : '<input type="text" id="nameInput" class="name-input" placeholder="اكتب اسمك هنا" maxlength="60">') + '\
      <p class="keyboard-hint">💡 يمكنك استخدام لوحة المفاتيح: أرقام 1-4 أو حروف أ ب ج د للإجابة، و Enter للتأكيد والانتقال</p>\
      ' + bestInfo + '\
      <div class="controls" style="justify-content:center; flex-wrap:wrap; gap:10px;">\
        <button class="btn" onclick="window.__qz.start()">' + (saved ? "ابدأ من جديد ◀" : "ابدأ الاختبار ◀") + '</button>\
        ' + resumeBtn + '\
      </div>\
    </div>';
  var nameInput = document.getElementById("nameInput");
  if (nameInput) {
    nameInput.focus();
    nameInput.addEventListener("keydown", function(e){
      if(e.key === "Enter"){ e.preventDefault(); window.__qz.start(); }
    });
  }
}

function prepareQuestions(order){
  questions = (order || rawQuestions.map(function(_, i){ return i; })).map(function(i){
    var q = shuffleQuestionOptions(rawQuestions[i]);
    q.__srcIdx = Number.isInteger(rawQuestions[i].__sourceIdx) ? rawQuestions[i].__sourceIdx : i;   /* للترتيب المحفوظ عند المتابعة */
    return q;
  });
}

function startQuiz(){
  var nameInput = document.getElementById("nameInput");
  var val = nameInput ? nameInput.value.trim() : userName;
  userName = val || "الطالب";
  try { localStorage.setItem("qq_name", userName); localStorage.setItem(PROFILE_KEY, userName); } catch(e) { /* quiz can continue if storage is unavailable */ }
  isRetake = false;
  prepareQuestions(null);
  resetState();
  progressWrap.style.display = "block";
  buildDots();
  renderQuestion();
}

function resetState(){
  current = 0; score = 0; selected = null; answered = false;
  userAnswers.length = 0; helpsRemaining = 3;
}

function resumeQuiz(){
  var saved = isReviewMode ? null : store.inprogress[QUIZ_ID];
  if(!saved){ startQuiz(); return; }
  isRetake = false;
  savedOrder = saved.order;
  prepareQuestions(savedOrder);
  current = saved.current; score = saved.score;
  helpsRemaining = saved.helps;
  userAnswers = saved.answers.slice();
  progressWrap.style.display = "block";
  buildDots();
  renderQuestion();
}

/* ---------- عرض السؤال ---------- */
function renderQuestion(){
  answered = false;
  selected = null;
  var item = questions[current];

  updateDots(false);
  updateHelpText();
  triggerAnimation();
  attachKeyHandler();

  var optionsHtml = item.options.map(function(opt, i){
    return '<div class="option" data-idx="' + i + '" onclick="window.__qz.select(' + i + ')">' +
      '<span class="letter">' + letters[i] + '</span>' +
      '<span class="opt-text">' + opt + '</span></div>';
  }).join("");

  var helpBtnHtml = helpsRemaining > 0
    ? '<div class="help-bar"><button class="help-btn" id="helpBtn" onclick="window.__qz.help()">🌙 حذف إجابة خاطئة (' + helpsRemaining + ' متبقية)</button></div>'
    : "";

  content.innerHTML = '\
    <div class="question-box">\
      <div class="question-num">السؤال ' + (current + 1) + " من " + TOTAL + " — " + ayahRef(item) + '</div>\
      <div class="question-text">' + item.q + '</div>\
    </div>' + helpBtnHtml +
    '<div class="options" id="optionsWrap">' + optionsHtml + '</div>' +
    '<div class="feedback" id="feedback"></div>' +
    '<div class="controls">\
      <button class="btn btn-ghost" id="confirmBtn" onclick="window.__qz.confirm()" disabled>تأكيد الإجابة</button>\
      <button class="btn" id="nextBtn" onclick="window.__qz.next()" style="display:none;">' +
        (current === TOTAL - 1 ? "عرض النتيجة النهائية" : "السؤال التالي ◀") +
      '</button>\
    </div>';
}

/* ---------- المساعدة ---------- */
function useHelp(){
  if(helpsRemaining <= 0 || answered) return;
  var item = questions[current];
  var wrongIndices = [];
  for(var i=0;i<item.options.length;i++){
    if(i !== item.correct){
      var el = document.querySelector('.option[data-idx="' + i + '"]');
      if(el && !el.classList.contains("removed")) wrongIndices.push(i);
    }
  }
  if(wrongIndices.length === 0) return;
  var pick = wrongIndices[Math.floor(Math.random()*wrongIndices.length)];
  var target = document.querySelector('.option[data-idx="' + pick + '"]');
  target.classList.add("removed");
  target.onclick = null;
  helpsRemaining--;
  updateHelpText();
  saveProgress();
  if(helpsRemaining <= 0){
    var bar = document.querySelector(".help-bar");
    if(bar) bar.remove();
  } else {
    var btn = document.getElementById("helpBtn");
    if(btn) btn.textContent = "🌙 حذف إجابة خاطئة (" + helpsRemaining + " متبقية)";
  }
}

/* ---------- اختيار وتأكيد ---------- */
function selectOption(idx){
  if(answered) return;
  var el = document.querySelector('.option[data-idx="' + idx + '"]');
  if(el && el.classList.contains("removed")) return;
  selected = idx;
  document.querySelectorAll(".option").forEach(function(o){ o.classList.remove("selected"); });
  if(el) el.classList.add("selected");
  document.getElementById("confirmBtn").disabled = false;
}

function confirmAnswer(){
  if(selected === null || answered) return;
  answered = true;
  /* ملاحظة: لا نفصل معالج لوحة المفاتيح هنا — يعالج حالة الإجابة (Enter للانتقال) */
  var item = questions[current];
  var isCorrect = selected === item.correct;
  if(isCorrect) score += POINTS_PER_Q;
  userAnswers.push({idx:current, correct:isCorrect, chosen:selected});
  document.querySelectorAll(".option").forEach(function(el, i){
    el.onclick = null;
    if(i === selected){
      el.classList.remove("selected");
      el.classList.add("locked");
    } else {
      el.classList.add("disabled");
    }
  });
  var fb = document.getElementById("feedback");
  fb.classList.add("show", "neutral-fb");
  fb.innerHTML = "✔ تم تسجيل إجابتك — ستعرف نتيجتك في النهاية";
  document.getElementById("confirmBtn").style.display = "none";
  document.getElementById("nextBtn").style.display = "inline-block";
  saveProgress();
}

function nextQuestion(){
  current++;
  if(current >= TOTAL){ showResult(); } else { renderQuestion(); }
}

/* ---------- النتيجة ---------- */
function showResult(){
  detachKeyHandler();
  updateDots(true);
  progressWrap.style.display = "none";
  clearProgress();

  var finalScore = Math.round(score);
  var correctCount = userAnswers.filter(function(a){ return a.correct; }).length;
  var wrongCount = TOTAL - correctCount;

  var title, msg, emoji;
  if(finalScore >= 90){
    emoji = "🌟"; title = "ممتاز، بارك الله فيك!";
    msg = "حفظٌ متقن وفهمٌ عميق. أنت على الطريق الصحيح، فاستمر في المراجعة الدائمة، وجعل الله هذه الآيات نوراً لك في الدنيا والآخرة.";
  } else if(finalScore >= 70){
    emoji = "✨"; title = "جيد جدًا، أحسنت!";
    msg = "نتيجة طيبة تدل على حفظ جيد. راجع الآيات التي أخطأت فيها مرة أخرى بتمعن، فبقليل من المراجعة تصل إلى الإتقان الكامل بإذن الله.";
  } else if(finalScore >= 50){
    emoji = "📖"; title = "جيد، وتحتاج إلى مزيد من المراجعة";
    msg = "بداية طيبة، لكن هذا الاختبار يستحق منك وقتاً أطول في الحفظ والتدبر. اقرأ الآيات بترتيل واستمع إليها من قارئ متقن، وستجد تحسناً ملحوظاً في المرة القادمة.";
  } else {
    emoji = "🕌"; title = "لا بأس، البداية دائماً هي الأصعب";
    msg = "لا تحزن، فكل حافظ للقرآن بدأ من الصفر. خصص وقتاً يومياً لتلاوة الآيات وتكرارها، وستجد نفسك قريباً تحفظها عن ظهر قلب بإذن الله تعالى.";
  }

  /* حفظ النتيجة (لا تُمحى النتائج السابقة عند إضافة اختبارات جديدة) */
  var completedAt = Date.now();
  if (!isReviewMode) {
    var prev = store.results[QUIZ_ID] || {best: 0, attempts: 0};
    store.results[QUIZ_ID] = {
      best: Math.max(prev.best, finalScore),
      last: finalScore,
      attempts: prev.attempts + 1,
      ts: completedAt
    };
  }
  var attemptAnswers = userAnswers.map(function (ans) {
    var item = questions[ans.idx];
    return {
      sourceIdx: item && Number.isInteger(item.__srcIdx) ? item.__srcIdx : ans.idx,
      question: item ? item.q : "",
      options: item && Array.isArray(item.options) ? item.options.slice() : [],
      selectedIndex: ans.chosen,
      selectedText: item && item.options ? item.options[ans.chosen] : "",
      correctIndex: item ? item.correct : null,
      correctAnswer: item && item.options ? item.options[item.correct] : "",
      correct: !!ans.correct,
      reference: item ? ayahRef(item) : ""
    };
  });
  if (!Array.isArray(store.attempts)) store.attempts = [];
  store.attempts.push({
    id: "attempt-" + completedAt + "-" + Math.random().toString(36).slice(2, 8),
    quizId: QUIZ_ID, title: quizData.title, surahs: (quizMeta.surahs || []).slice(),
    ts: completedAt, total: TOTAL, correct: correctCount, wrong: wrongCount, score: finalScore,
    answers: attemptAnswers, type: isReviewMode ? "review" : (challengeDate ? "daily" : "standard"),
    challengeDate: challengeDate || null, schemaVersion: 1
  });
  saveStore();

  var reviewHtml = userAnswers.map(function(ans){
    var item = questions[ans.idx];
    var rowClass = ans.correct ? "correct-fb" : "incorrect-fb";
    var yourAnswer = "(" + letters[ans.chosen] + ") " + item.options[ans.chosen];
    var correctAnswer = "(" + letters[item.correct] + ") " + item.options[item.correct];
    var info = item.info ? '<div class="review-a">📌 ' + item.info + '</div>' : "";
    return '<div class="review-item ' + rowClass + '">' +
      '<div class="review-q">' + (ans.idx + 1) + ". " + item.q + '</div>' +
      '<div class="review-a">إجابتك: ' + yourAnswer + " " + (ans.correct ? "✔" : "✘") + '</div>' +
      (ans.correct ? "" : '<div class="review-correct-answer">الإجابة الصحيحة: ' + correctAnswer + '</div>') +
      '<div class="review-a">📍 ' + ayahRef(item) + '</div>' + info +
      '</div>';
  }).join("");

  /* الاختبار التالي في نفس السورة */
  var nextQuizMeta = null;
  var list = window.QUIZ_REGISTRY || [];
  var myIdx = list.findIndex(function(m){ return m.id === QUIZ_ID; });
  for(var i = myIdx + 1; i < list.length; i++){
    var m = list[i];
    if(m.group === "author" || m.group === "surah"){
      if(m.surahs.length === 1 && quizMeta.surahs.indexOf(m.surahs[0]) !== -1){ nextQuizMeta = m; break; }
    }
  }
  var nextBtnHtml = nextQuizMeta
    ? '<a class="btn btn-ghost" href="quiz.html?quiz=' + nextQuizMeta.id + '">الاختبار التالي ◀</a>'
    : '<a class="btn btn-ghost" href="index.html">العودة للقائمة ◀</a>';

  triggerAnimation();
  content.innerHTML = '\
    <div class="result" id="resultMain">\
      <p style="font-family:\'Reem Kufi\', sans-serif; color:var(--terracotta); margin-bottom:6px; font-size:1.05rem;">نتيجة الطالب: ' + userName + '</p>\
      <div class="score-circle">\
        <div class="num">' + finalScore + '</div>\
        <div class="den">من 100</div>\
      </div>\
      <h2>' + emoji + " " + title + " " + emoji + '</h2>\
      <div class="stats">\
        <span style="color:#1e6b3a;">✔ صحيحة: ' + correctCount + '</span>\
        <span style="color:#8a3b28;">✘ خاطئة: ' + wrongCount + '</span>\
      </div>\
      <div class="divider"></div>\
      <p class="msg">' + msg + '</p>\
      <div class="controls" style="justify-content:center; flex-wrap:wrap; gap:10px;">\
        <button class="btn" onclick="window.__qz.restart()">🔄 إعادة الاختبار</button>\
        <button class="btn btn-ghost" onclick="window.__qz.toggleReview()">📋 مراجعة الإجابات</button>\
        <button class="btn" id="pdfBtn" onclick="window.__qz.pdf()">📄 تحميل الأسئلة PDF</button>\
        ' + nextBtnHtml + '\
      </div>\
      <div id="reviewList" style="display:none; text-align:right; margin-top:20px;">\
        ' + reviewHtml + '\
        <div class="controls" style="justify-content:center; margin-top:14px;">\
          <button class="btn btn-ghost" onclick="window.__qz.toggleReview()">↩ رجوع للنتيجة</button>\
        </div>\
      </div>\
    </div>';
}

function toggleReview(){
  var el = document.getElementById("reviewList");
  var main = document.getElementById("resultMain");
  var isHidden = el.style.display === "none";
  el.style.display = isHidden ? "block" : "none";
  if(!isHidden) main.scrollIntoView({behavior:"smooth", block:"start"});
}

/* ---------- إعادة الاختبار (بترتيب أسئلة واختيارات جديد) ---------- */
function restartQuiz(){
  isRetake = true;
  /* خلط ترتيب الأسئلة ثم خلط اختيارات كل سؤال */
  prepareQuestions(shuffle(rawQuestions.map(function(_, i){ return i; })));
  resetState();
  progressWrap.style.display = "block";
  buildDots();
  renderQuestion();
}

/* ---------- تحميل الأسئلة PDF (الميزة الأصلية) ---------- */
function downloadQuestionsPDF(){
  var btn = document.getElementById("pdfBtn");
  if(!btn) return;
  btn.classList.add("loading");
  btn.textContent = "⏳ جارٍ تجهيز الملف...";

  var pdfContainer = document.createElement("div");
  pdfContainer.setAttribute("dir", "rtl");
  pdfContainer.style.cssText = "\
    position: fixed; top: -9999px; left: 0; width: 210mm;\
    padding: 18mm 16mm; background: #fff;\
    font-family: 'Amiri', 'Traditional Arabic', 'Times New Roman', serif;\
    color: #2c211a; line-height: 2; font-size: 13px;";

  var questionsHTML = "";
  for(var i=0;i<rawQuestions.length;i++){
    var item = rawQuestions[i];
    questionsHTML += '\
      <div style="margin-bottom: 14px; page-break-inside: avoid;">\
        <div style="font-weight: bold; color: #073331; font-size: 14px; margin-bottom: 4px; line-height: 2.2;">' +
          (i+1) + ". " + item.q +
        '</div>\
        <div style="padding-right: 16px;">' +
          item.options.map(function(opt, oi){
            var isCorrect = oi === item.correct;
            return '<div style="padding: 2px 0; color: ' + (isCorrect ? "#1e6b3a" : "#2c211a") +
              '; font-weight: ' + (isCorrect ? "bold" : "normal") + ';">' +
              (isCorrect ? "✔ " : "&nbsp;&nbsp;&nbsp;") + opt + '</div>';
          }).join("") +
        '</div>\
      </div>' +
      (i < rawQuestions.length - 1 ? '<div style="border-bottom: 1px dashed #e0d5c0; margin: 10px 0;"></div>' : "");
  }

  pdfContainer.innerHTML = '\
    <div style="text-align: center; margin-bottom: 20px;">\
      <div style="font-size: 22px; font-weight: bold; color: #073331; margin-bottom: 6px;">✦ ' + quizData.title + ' ✦</div>\
      <div style="font-size: 14px; color: #b5563a; margin-bottom: 4px;">' + TOTAL + ' سؤالاً مع الإجابات الصحيحة</div>\
      <div style="font-size: 12px; color: #888; margin-bottom: 10px;">تصميم وإعداد: أمير أنور — 01066227553</div>\
      <div style="width: 80px; height: 2px; background: #c9a34e; margin: 10px auto;"></div>\
      <div style="font-size: 11px; color: #999; margin-bottom: 16px;">(الإجابة الصحيحة مُشار إليها بعلامة ✔ باللون الأخضر)</div>\
    </div>' + questionsHTML + '\
    <div style="border-top: 2px solid #c9a34e; margin-top: 24px; padding-top: 14px; text-align: center;">\
      <div style="font-size: 12px; color: #888; margin-bottom: 8px;">✦  تصميم وإعداد: أمير أنور محمد ✦</div>\
      <div style="font-size: 11px; color: #aaa; direction: ltr;">01066227553</div>\
      <div style="font-size: 11px; color: #999; margin-top: 8px; max-width: 400px; margin-left: auto; margin-right: auto;">\
        اللهم اجعل القرآن العظيم ربيع قلوبنا ونور صدورنا وجلاء أحزاننا\
      </div>\
    </div>';

  document.body.appendChild(pdfContainer);

  var opt = {
    margin: [8, 8, 8, 8],
    filename: "أسئلة-" + quizData.title.replace(/[\\/:*?"<>|]/g, "") + ".pdf",
    image: {type:"jpeg", quality:0.98},
    html2canvas: {scale:2, useCORS:true, letterRendering:true},
    jsPDF: {unit:"mm", format:"a4", orientation:"portrait"},
    pagebreak: {mode:["avoid-all","css","legacy"]}
  };

  html2pdf().set(opt).from(pdfContainer).save().then(function(){
    document.body.removeChild(pdfContainer);
    btn.classList.remove("loading");
    btn.textContent = "📄 تحميل الأسئلة PDF";
  }).catch(function(){
    document.body.removeChild(pdfContainer);
    btn.classList.remove("loading");
    btn.textContent = "📄 تحميل الأسئلة PDF";
    alert("حدث خطأ أثناء تحميل الملف، حاول مرة أخرى");
  });
}

/* ---------- واجهة عامة (الأزرار onclick) ---------- */
window.__qz = {
  start: startQuiz,
  resume: resumeQuiz,
  select: selectOption,
  confirm: confirmAnswer,
  next: nextQuestion,
  help: useHelp,
  restart: restartQuiz,
  toggleReview: toggleReview,
  pdf: downloadQuestionsPDF
};

init();
})();
