/* تحويل أسئلة المؤلف الأصلية (questions-36.js و questions-55.js) إلى JSON
   لاستخدامها في نظام النقل داخل tools/generate.py */
const fs = require("fs");
const path = require("path");

global.window = {};
require(path.join(__dirname, "..", "js", "questions-36.js"));
const q36 = global.window.QUIZ_QUESTIONS;
global.window.QUIZ_QUESTIONS = undefined;
require(path.join(__dirname, "..", "js", "questions-55.js"));
const q55 = global.window.QUIZ_QUESTIONS;

const out = path.join(__dirname, "cache", "legacy-questions.json");
fs.writeFileSync(out, JSON.stringify({ "36": q36, "55": q55 }, null, 1), "utf-8");
console.log("legacy questions:", (q36 || []).length, "+", (q55 || []).length, "->", out);
