/* One-time local profile for Quran Quiz. No network requests are made. */
(function () {
  "use strict";

  var KEY = "quranQuizUserName_v1";
  var MAX_NAME_LENGTH = 60;

  // Determine if we're on the home page (index.html or root)
  var pathSegments = location.pathname.split("/");
  var lastSegment = pathSegments[pathSegments.length - 1];
  var pageIsHome =
    /(^|\/)index\.html$/.test(location.pathname) ||
    location.pathname.endsWith("/") ||
    !lastSegment;

  var name = "";
  var overlayKeydownHandler = null; // for cleanup

  var copy = {
    title: "Welcome to Your Quran Journey",
    subtitle: "What should we call you?",
    placeholder: "اكتب اسمك هنا",
    start: "Start Your Journey",
    save: "حفظ الاسم",
    edit: "تعديل الاسم",
    required: "من فضلك اكتب اسمك أولًا.",
    storageError:
      "تعذر حفظ الاسم على هذا الجهاز. تأكد من السماح بالتخزين المحلي في المتصفح ثم حاول مرة أخرى.",
    greeting: "أهلًا بعودتك، ",
    motivation: "واصل التعلّم والمراجعة وتقوية صلتك بالقرآن الكريم.",
    cancel: "إلغاء",
    invalidChars: "الاسم يحتوي على رموز غير مسموحة.",
    tooLong: "الاسم طويل جدًا. الحد الأقصى " + MAX_NAME_LENGTH + " حرفًا."
  };

  /* ---------- Storage ---------- */
  function readName() {
    try {
      return (localStorage.getItem(KEY) || "").trim();
    } catch (e) {
      return null;
    }
  }

  function writeName(value) {
    try {
      localStorage.setItem(KEY, value);
      if (localStorage.getItem(KEY) !== value) return false;
      // Keep the quiz engine legacy name in sync for backward compatibility.
      try { localStorage.setItem("qq_name", value); } catch (legacyError) {}
      return true;
    } catch (e) {
      return false;
    }
  }

  function clearName() {
    try {
      localStorage.removeItem(KEY);
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ---------- Helpers ---------- */
  function make(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /**
   * Sanitize a name: trim, collapse whitespace, remove control/invisible chars.
   * Returns null if invalid, otherwise the cleaned value.
   */
  function sanitizeName(raw) {
    if (typeof raw !== "string") return null;
    // Remove control chars & zero-width characters, collapse spaces
    var cleaned = raw
      .replace(/[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!cleaned) return { error: "required", value: "" };
    if (cleaned.length > MAX_NAME_LENGTH) {
      return { error: "tooLong", value: cleaned };
    }
    return { error: null, value: cleaned };
  }

  /* ---------- Focus trap (accessibility) ---------- */
  function trapFocus(overlay) {
    var focusableSelectors = [
      "a[href]",
      "button:not([disabled])",
      "input:not([disabled])",
      "textarea:not([disabled])",
      "select:not([disabled])",
      '[tabindex]:not([tabindex="-1"])'
    ].join(",");

    overlayKeydownHandler = function (event) {
      if (event.key === "Escape") {
        var cancelBtn = overlay.querySelector(".qq-name-cancel");
        if (cancelBtn) cancelBtn.click();
        return;
      }
      if (event.key !== "Tab") return;

      var focusable = Array.prototype.slice
        .call(overlay.querySelectorAll(focusableSelectors))
        .filter(function (el) {
          return el.offsetParent !== null;
        });
      if (!focusable.length) return;

      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      var active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", overlayKeydownHandler);
  }

  function releaseFocus(overlay) {
    if (overlayKeydownHandler) {
      document.removeEventListener("keydown", overlayKeydownHandler);
      overlayKeydownHandler = null;
    }
  }

  /* ---------- Dialog ---------- */
  function showNameDialog(editing) {
    var old = document.getElementById("qq-name-overlay");
    if (old) {
      releaseFocus(old);
      old.remove();
    }

    var previouslyFocused = document.activeElement;

    var overlay = make("div", "qq-name-overlay");
    overlay.id = "qq-name-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "qq-name-title");
    overlay.setAttribute("aria-describedby", "qq-name-subtitle");

    var panel = make("section", "qq-name-panel");

    var ornament = make("div", "qq-name-ornament", "۞");
    ornament.setAttribute("aria-hidden", "true");

    var title = make("h2", "", copy.title);
    title.id = "qq-name-title";

    var subtitle = make("p", "qq-name-subtitle", copy.subtitle);
    subtitle.id = "qq-name-subtitle";

    var form = make("form", "qq-name-form");
    form.setAttribute("novalidate", "true");

    var input = make("input", "qq-name-input");
    input.type = "text";
    input.name = "displayName";
    input.autocomplete = "name";
    input.maxLength = MAX_NAME_LENGTH;
    input.required = true;
    input.value = editing ? name : "";
    input.placeholder = copy.placeholder;
    input.setAttribute("aria-label", copy.subtitle);
    input.setAttribute("aria-describedby", "qq-name-error");

    var error = make("p", "qq-name-error", "");
    error.id = "qq-name-error";
    error.setAttribute("role", "alert");
    error.setAttribute("aria-live", "polite");

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
      cancel.addEventListener("click", function () {
        releaseFocus(overlay);
        overlay.remove();
        if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus();
      });
      panel.appendChild(cancel);
    }

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    // Trap focus + remember cleanup
    trapFocus(overlay);

    form.addEventListener("submit", function (event) {
      event.preventDefault();

      var result = sanitizeName(input.value);
      if (result.error === "required") {
        error.textContent = copy.required;
        input.setAttribute("aria-invalid", "true");
        input.focus();
        return;
      }
      if (result.error === "tooLong") {
        error.textContent = copy.tooLong;
        input.setAttribute("aria-invalid", "true");
        input.focus();
        return;
      }

      if (!writeName(result.value)) {
        error.textContent = copy.storageError;
        return;
      }

      name = result.value;
      releaseFocus(overlay);
      overlay.remove();
      renderPersonalization();
      try { window.dispatchEvent(new CustomEvent("qq-profile-updated", { detail: { name: name } })); } catch (e) {}
    });

    input.addEventListener("input", function () {
      if (input.value.trim()) {
        error.textContent = "";
        input.removeAttribute("aria-invalid");
      }
    });

    window.setTimeout(function () {
      input.focus();
      input.select();
    }, 50);
  }

  /* ---------- Personalization ---------- */
  function renderPersonalization() {
    var header = document.querySelector(".arch-header");
    if (!header) return;

    var personal = document.getElementById("qq-personal-greeting");
    if (!personal) {
      personal = make("div", "qq-personal-greeting");
      personal.id = "qq-personal-greeting";
      var subtitle = header.querySelector(".subtitle, p");
      if (subtitle && subtitle.parentNode === header) {
        subtitle.insertAdjacentElement("afterend", personal);
      } else {
        header.appendChild(personal);
      }
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
      edit.setAttribute("aria-label", copy.edit);
      edit.addEventListener("click", function () {
        showNameDialog(true);
      });
      header.appendChild(edit);
    }
  }

  /* ---------- Public profile API for the dashboard ---------- */
  window.QQUserProfile = {
    getName: function () { return name || readName() || ""; },
    edit: function () { showNameDialog(true); }
  };

  /* ---------- Init ---------- */
  function init() {
    var stored = readName();

    if (stored === null) {
      // localStorage unavailable
      var warning = make("div", "qq-storage-warning", copy.storageError);
      warning.setAttribute("role", "alert");
      document.body.appendChild(warning);
      showNameDialog(false);
      return;
    }

    name = stored;
    if (!name) {
      showNameDialog(false);
    } else {
      renderPersonalization();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
