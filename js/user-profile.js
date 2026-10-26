/* One-time local profile for Quran Quiz. No network requests are made. */
(function () {
  "use strict";
  var KEY = "quranQuizUserName_v1";
  var pageIsHome = /(^|\/)index\.html$/.test(location.pathname) || location.pathname.endsWith("/") || !location.pathname.split("/").pop();
  var name = "";
  var copy = {
    title: "Welcome to Your Quran Journey",
    subtitle: "What should we call you?",
    placeholder: "اكتب اسمك هنا",
    start: "Start Your Journey",
    save: "حفظ الاسم",
    edit: "تعديل الاسم",
    required: "من فضلك اكتب اسمك أولًا.",
    storageError: "تعذر حفظ الاسم على هذا الجهاز. تأكد من السماح بالتخزين المحلي في المتصفح ثم حاول مرة أخرى.",
    greeting: "أهلًا بعودتك، ",
    motivation: "واصل التعلّم والمراجعة وتقوية صلتك بالقرآن الكريم.",
    cancel: "إلغاء"
  };
  function readName() {
    try { return (localStorage.getItem(KEY) || "").trim(); }
    catch (e) { return null; }
  }
  function writeName(value) {
    try {
      localStorage.setItem(KEY, value);
      return localStorage.getItem(KEY) === value;
    } catch (e) { return false; }
  }
  function make(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function showNameDialog(editing) {
    var old = document.getElementById("qq-name-overlay");
    if (old) old.remove();
    var overlay = make("div", "qq-name-overlay");
    overlay.id = "qq-name-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "qq-name-title");
    var panel = make("section", "qq-name-panel");
    var ornament = make("div", "qq-name-ornament", "۞");
    ornament.setAttribute("aria-hidden", "true");
    var title = make("h2", "", copy.title);
    title.id = "qq-name-title";
    var subtitle = make("p", "qq-name-subtitle", copy.subtitle);
    var form = make("form", "qq-name-form");
    var input = make("input", "qq-name-input");
    input.type = "text";
    input.name = "displayName";
    input.autocomplete = "name";
    input.maxLength = 60;
    input.required = true;
    input.value = editing ? name : "";
    input.placeholder = copy.placeholder;
    input.setAttribute("aria-label", copy.subtitle);
    var error = make("p", "qq-name-error", "");
    error.setAttribute("role", "alert");
    var submit = make("button", "qq-name-submit", editing ? copy.save : copy.start);
    submit.type = "submit";
    form.appendChild(input);
    form.appendChild(error);
    form.appendChild(submit);
    panel.appendChild(ornament);
    panel.appendChild(title);
    panel.appendChild(subtitle);
    panel.appendChild(form);
    if (editing) {
      var cancel = make("button", "qq-name-cancel", copy.cancel);
      cancel.type = "button";
      cancel.addEventListener("click", function () { overlay.remove(); });
      panel.appendChild(cancel);
    }
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var value = input.value.trim().replace(/\s+/g, " ");
      if (!value) {
        error.textContent = copy.required;
        input.setAttribute("aria-invalid", "true");
        input.focus();
        return;
      }
      if (!writeName(value)) {
        error.textContent = copy.storageError;
        return;
      }
      name = value;
      overlay.remove();
      renderPersonalization();
    });
    input.addEventListener("input", function () {
      if (input.value.trim()) {
        error.textContent = "";
        input.removeAttribute("aria-invalid");
      }
    });
    window.setTimeout(function () { input.focus(); }, 50);
  }
  function renderPersonalization() {
    var header = document.querySelector(".arch-header");
    if (!header) return;
    var personal = document.getElementById("qq-personal-greeting");
    if (!personal) {
      personal = make("div", "qq-personal-greeting");
      personal.id = "qq-personal-greeting";
      var subtitle = header.querySelector(".subtitle, p");
      if (subtitle && subtitle.parentNode === header) subtitle.insertAdjacentElement("afterend", personal);
      else header.appendChild(personal);
    }
    personal.replaceChildren();
    var greeting = make("div", "qq-greeting", copy.greeting + name + "!");
    var motivation = make("div", "qq-motivation", copy.motivation);
    personal.appendChild(greeting);
    personal.appendChild(motivation);
    var edit = document.getElementById("qq-edit-name");
    if (!edit) {
      edit = make("button", "qq-edit-name", copy.edit);
      edit.id = "qq-edit-name";
      edit.type = "button";
      edit.addEventListener("click", function () { showNameDialog(true); });
      header.appendChild(edit);
    }
  }
  function init() {
    var stored = readName();
    if (stored === null) {
      var warning = make("div", "qq-storage-warning", copy.storageError);
      warning.setAttribute("role", "alert");
      document.body.appendChild(warning);
      showNameDialog(false);
      return;
    }
    name = stored;
    if (!name) showNameDialog(false);
    else renderPersonalization();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();