/* ===== منطق الصفحة الرئيسية ===== */
(function(){
  "use strict";

  var SURAH_LIST = window.SURAH_REGISTRY || [];
  var QUIZ_LIST = window.QUIZ_REGISTRY || [];
  var STORE_KEY = "qqProgress_v1";

  /* ---------- التخزين المحلي ---------- */
  function loadStore(){
    try{
      var raw = localStorage.getItem(STORE_KEY);
      if(!raw) return {results:{}, inprogress:{}};
      var data = JSON.parse(raw);
      data.results = data.results || {};
      data.inprogress = data.inprogress || {};
      return data;
    }catch(e){ return {results:{}, inprogress:{}}; }
  }
  var store = loadStore();

  function quizBest(id){
    var r = store.results[id];
    return r ? r.best : null;
  }
  function quizAttempts(id){
    var r = store.results[id];
    return r ? r.attempts : 0;
  }
  function hasInProgress(id){
    return !!store.inprogress[id];
  }

  /* ---------- أدوات ---------- */
  function el(tag, cls, html){
    var e = document.createElement(tag);
    if(cls) e.className = cls;
    if(html !== undefined) e.innerHTML = html;
    return e;
  }
  function quizUrl(id){ return "quiz.html?quiz=" + encodeURIComponent(id); }
  function surahById(n){
    for(var i=0;i<SURAH_LIST.length;i++) if(SURAH_LIST[i].n === n) return SURAH_LIST[i];
    return null;
  }
  function groupSurahsNames(surahs){
    return surahs.map(function(n){ return surahById(n) ? surahById(n).name : n; }).join("، ");
  }

  /* ---------- الإحصاءات ---------- */
  function updateStats(){
    var totalQ = 0, done = 0;
    QUIZ_LIST.forEach(function(m){ totalQ += m.count; });
    Object.keys(store.results).forEach(function(id){ done++; });
    document.getElementById("statQuizzes").textContent = QUIZ_LIST.length;
    document.getElementById("statQuestions").textContent = totalQ;
    document.getElementById("statDone").textContent = done;
  }

  /* ---------- فلتر الأجزاء ---------- */
  function buildJuzSelect(){
    var sel = document.getElementById("juzSelect");
    for(var j=1;j<=30;j++){
      var opt = document.createElement("option");
      opt.value = j;
      opt.textContent = "الجزء " + j;
      sel.appendChild(opt);
    }
  }

  /* ---------- بطاقات المجموعات ---------- */
  var GROUP_META = {
    "short-group": {icon:"◫", desc:"سور قصيرة مجمعة بترتيب المصحف في اختبار واحد"},
    "review": {icon:"✦", desc:"مراجعة شاملة تجمع أسئلة من سور الجزء كله"},
    "author": {icon:"★", desc:"الاختبار الأصلي للمشروع"}
  };
  function renderGroups(){
    var grid = document.getElementById("groupsGrid");
    grid.innerHTML = "";
    QUIZ_LIST.forEach(function(m){
      if(m.group !== "short-group" && m.group !== "review") return;
      var card = el("div", "group-card");
      var best = quizBest(m.id);
      var done = best !== null;
      var prog = hasInProgress(m.id) ? " • لديك اختبار غير مكتمل" : "";
      card.innerHTML =
        '<div class="g-title">' + (GROUP_META[m.group].icon) + " " + m.title + '</div>' +
        '<div class="g-meta">' + m.count + ' سؤالاً — السور: ' + groupSurahsNames(m.surahs) + '</div>' +
        '<div class="g-desc">' + GROUP_META[m.group].desc + '</div>' +
        '<div class="g-progress">' + (done ? ("✓ أكملته — أفضل نتيجة: " + best) : "لم يُكمل بعد") + prog + '</div>';
      card.addEventListener("click", function(){ window.location.href = quizUrl(m.id); });
      grid.appendChild(card);
    });
  }

  /* ---------- بطاقات السور ---------- */
  function surahJuzsLabel(juzs){
    if(!juzs || !juzs.length) return "";
    if(juzs.length === 1) return "الجزء " + juzs[0];
    return "الأجزاء " + juzs[0] + "-" + juzs[juzs.length-1];
  }
  function quizRangeLabel(m){
    if(!m.range) return "";
    if(m.surahs && m.surahs.length === 1){
      var s = surahById(m.surahs[0]);
      if(s && m.range[0] === 1 && m.range[1] === s.ayahs) return "السورة كاملة";
    }
    return "الآيات " + m.range[0] + "-" + m.range[1];
  }

  function renderSurahCard(s){
    var card = el("div", "surah-card");
    var quizzes = s.quizzes || [];
    var doneCount = quizzes.filter(function(q){ return quizBest(q.id) !== null; }).length;
    var pct = quizzes.length ? Math.round(doneCount / quizzes.length * 100) : 0;
    var catCls = s.category === "طويلة" ? "cat-long" : (s.category === "متوسطة" ? "cat-mid" : "cat-short");

    var head = el("div", "surah-head");
    head.innerHTML =
      '<div class="surah-num">' + s.n + '</div>' +
      '<div class="surah-info">' +
        '<div class="surah-name">سورة ' + s.name + '</div>' +
        '<div class="surah-meta">' +
          '<span class="tag">' + s.ayahs + ' آية</span>' +
          '<span class="tag ' + (s.revelation === "مكية" ? "cat-makki" : "cat-madani") + '">' + s.revelation + '</span>' +
          '<span class="tag ' + catCls + '">' + s.category + '</span>' +
          '<span class="tag">' + surahJuzsLabel(s.juzs) + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="surah-progress">' +
        (quizzes.length ? (doneCount + "/" + quizzes.length) : "—") +
        '<div class="bar"><div class="fill" style="width:' + pct + '%"></div></div>' +
      '</div>';
    card.appendChild(head);

    var list = el("div", "surah-quizzes");
    if(!quizzes.length){
      list.innerHTML = '<div class="q-sub" style="padding:6px 4px;">تُدرس هذه السورة ضمن مجموعات السور القصيرة أعلاه — شارك فيها إن أحببت</div>';
    }
    quizzes.forEach(function(q){
      var best = quizBest(q.id);
      var row = el("div", "quiz-row");
      var sub = (q.range ? quizRangeLabel(q) : "") + " • " + q.count + " سؤالاً";
      if(best !== null) sub += " • <span class='q-best'>أفضل نتيجة: " + best + " (" + quizAttempts(q.id) + " محاولات)</span>";
      if(hasInProgress(q.id)) sub += " • ⏸ متوقف";
      row.innerHTML =
        '<div class="q-info">' +
          '<div class="q-title">' + q.title + '</div>' +
          '<div class="q-sub">' + sub + '</div>' +
        '</div>' +
        '<button class="q-btn' + (best !== null ? " done" : "") + '">' +
          (hasInProgress(q.id) ? "متابعة ⏵" : (best !== null ? "إعادة ↻" : "ابدأ ◀")) +
        '</button>';
      row.querySelector(".q-btn").addEventListener("click", function(ev){
        ev.stopPropagation();
        window.location.href = quizUrl(q.id);
      });
      list.appendChild(row);
    });
    card.appendChild(list);

    head.addEventListener("click", function(){
      var isOpen = card.classList.contains("open");
      document.querySelectorAll(".surah-card.open").forEach(function(c){ c.classList.remove("open"); });
      if(!isOpen) card.classList.add("open");
    });
    return card;
  }

  /* ---------- الفلترة ---------- */
  var state = {cat:"all", juz:"all", q:""};
  function applyFilter(){
    var grid = document.getElementById("surahGrid");
    grid.innerHTML = "";
    var visible = 0;
    SURAH_LIST.forEach(function(s){
      if(state.cat !== "all" && s.category !== state.cat) return;
      if(state.juz !== "all" && s.juzs.indexOf(parseInt(state.juz, 10)) === -1) return;
      if(state.q){
        var q = state.q.trim();
        var numMatch = (/^\d+$/).test(q) && String(s.n) === String(parseInt(q, 10));
        var nameMatch = s.name.indexOf(q) !== -1;
        if(!numMatch && !nameMatch) return;
      }
      grid.appendChild(renderSurahCard(s));
      visible++;
    });
    document.getElementById("emptyState").style.display = visible ? "none" : "block";
  }

  function bindControls(){
    document.getElementById("searchInput").addEventListener("input", function(e){
      state.q = e.target.value;
      applyFilter();
    });
    document.getElementById("juzSelect").addEventListener("change", function(e){
      state.juz = e.target.value;
      applyFilter();
    });
    document.querySelectorAll("#catChips .chip").forEach(function(chip){
      chip.addEventListener("click", function(){
        document.querySelectorAll("#catChips .chip").forEach(function(c){ c.classList.remove("active"); });
        chip.classList.add("active");
        state.cat = chip.getAttribute("data-cat");
        applyFilter();
      });
    });
  }

  /* ---------- البدء ---------- */
  buildJuzSelect();
  renderGroups();
  applyFilter();
  updateStats();
  bindControls();
})();
