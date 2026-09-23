/* Runs PostMan's own A-CMP importer over the workbook this app now writes and
   prints what it made of it. PostMan's browser-only bits are stubbed; the
   importer and compressorCalc are its real code.
     node scripts/_import-check.mjs <workbook.xlsx> <path to PostMAN clone>   */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import * as XLSX from "xlsx";

const ROOT = process.argv[3];
const FILES = ["p3_core.js","p4_registry.js","p5_ui.js","p6_forms.js","p7_modules.js","p8_sld.js","p9_charts.js","p10_report.js","p11_sections.js","p16_reco.js","p17_baseline.js","p17b_ghg.js","p18_ebill.js","p19_pq.js","p19b_pqlink.js","p20_thermox.js","p21_sources.js","p14_custom.js","p15_bills.js","p12_pages.js","p13_boot.js"];

const noop = () => {};
const el = new Proxy(
  {
    appendChild: noop, setAttribute: noop, addEventListener: noop, removeChild: noop, insertBefore: noop,
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    style: {}, dataset: {}, children: [], childNodes: [], value: "", textContent: "", innerHTML: "",
    querySelector: () => el, querySelectorAll: () => [], getContext: () => null, focus: noop, click: noop, remove: noop,
  },
  { get: (t, k) => (k in t ? t[k] : () => el) }
);
const documentStub = {
  createElement: () => el, createElementNS: () => el, getElementById: () => el,
  querySelector: () => el, querySelectorAll: () => [], addEventListener: noop,
  body: el, head: el, documentElement: el,
};

const ctx = {
  XLSX, console, Math, JSON, Date, parseFloat, parseInt, isNaN, isFinite, Number, String, Array, Object, RegExp, Error,
  document: documentStub, navigator: { userAgent: "node" },
  localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
  location: { href: "http://localhost/", origin: "http://localhost", search: "" },
  setTimeout, clearTimeout, setInterval, clearInterval, alert: noop, confirm: () => true, prompt: () => null,
  atob: (b) => Buffer.from(b, "base64").toString("binary"),
  btoa: (s) => Buffer.from(s, "binary").toString("base64"),
  requestAnimationFrame: noop, getComputedStyle: () => ({}),
  addEventListener: noop, removeEventListener: noop, dispatchEvent: noop,
  matchMedia: () => ({ matches: false, addEventListener: noop, addListener: noop }),
};
ctx.window = ctx;
ctx.globalThis = ctx;
vm.createContext(ctx);

// Each file on its own, with its failures tolerated: PostMan's boot wants a
// real DOM, and all this check needs is the importer and the arithmetic.
ctx.S = { company: {}, compressor: [], meta: {} };
for (const f of FILES) {
  try {
    vm.runInContext(fs.readFileSync(path.join(ROOT, "src", f), "utf8"), ctx, { filename: f });
  } catch (e) {
    if (!/is not a function|is not defined|Cannot read/.test(e.message)) console.log(`(${f}: ${e.message})`);
  }
}

if (typeof ctx.importACmp !== "function") {
  console.error("importACmp not available — stubbing went wrong");
  process.exit(1);
}

ctx.S.company.name = "Shree Mahadev Silk Mills Pvt. Ltd.";
ctx.S.compressor = [];

const wb = XLSX.read(fs.readFileSync(process.argv[2]), { type: "buffer" });
console.log("detected as A-CMP workbook:", ctx.isACmpWorkbook(wb));
console.log("import log:", ctx.importACmp(wb));

for (const k of ctx.S.compressor) {
  const calc = ctx.compressorCalc ? ctx.compressorCalc(k) : {};
  const f = (v, d) => (typeof v === "number" && isFinite(v) ? v.toFixed(d) : "—");
  console.log(
    `  ${k.tag}: volume used ${f(k.tankVol, 3)} m3 · actual ${f(calc.actualCfm, 1)} CFM · design ${f(calc.designCfm, 1)} CFM · SEC ${f(calc.actualSec, 3)} kW/CFM`
  );
}

