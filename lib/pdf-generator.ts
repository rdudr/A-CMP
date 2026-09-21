import { jsPDF } from "jspdf";
import autoTable, { type CellInput, type RowInput, type Styles, type UserOptions } from "jspdf-autotable";
import type { CompanyProfile, CompressorEntry } from "@/lib/store";

// ─────────────────────────────────────────────────────────────────────────────
// Compressor Efficiency Assessment — PDF
//
// Every figure is laid out through autoTable cells (which wrap), never with
// free `doc.text` at fixed x/y, so long make/model strings, remarks and
// velocity lists can no longer run over each other. The same file is built
// in the browser (Report page) and on the server (email attachment).
//
// The verdict rule mirrors PostMan's compressorCalc: actual SEC more than
// 10 % above design is flagged for attention.
// ─────────────────────────────────────────────────────────────────────────────

const PAGE_W = 210;
const PAGE_H = 297;
const M_LEFT = 14;
const M_RIGHT = 14;
const M_TOP = 24;
const M_BOTTOM = 18;
const CONTENT_W = PAGE_W - M_LEFT - M_RIGHT;

const C = {
  primary: [15, 76, 129] as [number, number, number],
  accent: [3, 105, 161] as [number, number, number],
  ink: [15, 23, 42] as [number, number, number],
  muted: [100, 116, 139] as [number, number, number],
  line: [203, 213, 225] as [number, number, number],
  fill: [241, 245, 249] as [number, number, number],
  fillSoft: [248, 250, 252] as [number, number, number],
  good: [22, 128, 61] as [number, number, number],
  goodBg: [220, 252, 231] as [number, number, number],
  warn: [180, 83, 9] as [number, number, number],
  warnBg: [254, 243, 199] as [number, number, number],
  bad: [185, 28, 28] as [number, number, number],
  badBg: [254, 226, 226] as [number, number, number],
  white: [255, 255, 255] as [number, number, number],
};

const SEC_TOLERANCE_PCT = 10;
const M3MIN_TO_CFM = 35.3147;

type Verdict = { label: string; tone: "good" | "warn" | "bad" | "muted" };

// ── formatting ──────────────────────────────────────────────────────────────

const isNum = (v: unknown): v is number => typeof v === "number" && isFinite(v);
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
};
const fmt = (v: unknown, d = 2, unit = ""): string => {
  const n = num(v);
  if (n === null) return "—";
  return `${n.toFixed(d)}${unit ? ` ${unit}` : ""}`;
};
const txt = (v: unknown, fallback = "—"): string => {
  if (v === null || v === undefined) return fallback;
  const s = String(v).trim();
  return s === "" ? fallback : s;
};
const pct = (v: number | null): string => (v === null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)} %`);

function ratedCfm(c: CompressorEntry): number | null {
  const cap = num(c.ratedCapacity);
  if (cap === null || cap <= 0) return null;
  switch (c.ratedCapacityUnit) {
    case "CFM": return cap;
    case "l/s": return cap * 0.06 * M3MIN_TO_CFM;
    case "CMH": return (cap / 60) * M3MIN_TO_CFM;
    case "m3/min":
    default: return cap * M3MIN_TO_CFM;
  }
}

function tankVolumeM3(c: CompressorEntry): number | null {
  const v = num(c.pumpTankVolume);
  if (v === null || v <= 0) return null;
  return c.pumpTankVolumeUnit === "Liters" ? v / 1000 : v;
}

/** Design vs actual for whichever test was done (pump-up wins when both are present, as PostMan does). */
function performance(c: CompressorEntry) {
  const designCfm = ratedCfm(c);
  const ratedKw = num(c.ratedKw);
  const designSec = designCfm && ratedKw ? ratedKw / designCfm : null;
  const designAirGen = designCfm && ratedKw ? designCfm / ratedKw : null;

  let test: "Pump-up" | "FAD" | null = null;
  let actualCfm: number | null = null;
  if (c.pumpActive && num(c.pumpActualFadCfm)) {
    test = "Pump-up";
    actualCfm = num(c.pumpActualFadCfm);
  } else if (c.fadActive && num(c.fadAirDeliveryCfm)) {
    test = "FAD";
    actualCfm = num(c.fadAirDeliveryCfm);
  }
  const measuredKw = num(c.genLoadKw) ?? num(c.measuredKw) ?? (test === "FAD" ? num(c.fadMeasuredPower) : num(c.pumpMeasuredPower));
  const actualSec = actualCfm && measuredKw ? measuredKw / actualCfm : null;
  const actualAirGen = actualCfm && measuredKw ? actualCfm / measuredKw : null;

  const flowDev = designCfm && actualCfm !== null ? ((actualCfm - designCfm) / designCfm) * 100 : null;
  const secDev = designSec && actualSec !== null ? ((actualSec - designSec) / designSec) * 100 : null;
  const genDev = designAirGen && actualAirGen !== null ? ((actualAirGen - designAirGen) / designAirGen) * 100 : null;

  let verdict: Verdict;
  if (!test) verdict = { label: "No test recorded", tone: "muted" };
  else if (secDev === null) verdict = { label: actualCfm !== null ? "Flow measured, no load kW" : "Incomplete", tone: "muted" };
  else if (secDev > SEC_TOLERANCE_PCT) verdict = { label: `SEC ${secDev.toFixed(1)} % above design`, tone: "bad" };
  else if (secDev > 0) verdict = { label: "Within tolerance", tone: "warn" };
  else verdict = { label: "Meets design", tone: "good" };

  return { test, designCfm, designSec, designAirGen, actualCfm, actualSec, actualAirGen, measuredKw, flowDev, secDev, genDev, verdict };
}

// ── drawing helpers ─────────────────────────────────────────────────────────

type Doc = jsPDF & { lastAutoTable?: { finalY: number } };

function toneStyle(tone: Verdict["tone"]): Partial<Styles> {
  switch (tone) {
    case "good": return { textColor: C.good, fillColor: C.goodBg, fontStyle: "bold" };
    case "warn": return { textColor: C.warn, fillColor: C.warnBg, fontStyle: "bold" };
    case "bad": return { textColor: C.bad, fillColor: C.badBg, fontStyle: "bold" };
    default: return { textColor: C.muted, fontStyle: "italic" };
  }
}

function drawChrome(doc: Doc, company: string) {
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    // header band
    doc.setFillColor(...C.primary);
    doc.rect(0, 0, PAGE_W, 14, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...C.white);
    doc.text("A-CMP  ·  Compressor Efficiency Assessment", M_LEFT, 9);
    doc.setFont("helvetica", "normal");
    const right = doc.splitTextToSize(company, 90)[0] as string;
    doc.text(right, PAGE_W - M_RIGHT, 9, { align: "right" });
    // footer
    doc.setDrawColor(...C.line);
    doc.setLineWidth(0.2);
    doc.line(M_LEFT, PAGE_H - 12, PAGE_W - M_RIGHT, PAGE_H - 12);
    doc.setFontSize(7.5);
    doc.setTextColor(...C.muted);
    doc.text("KISEM Laboratory · IIT Gandhinagar · Energy Assessment Programme", M_LEFT, PAGE_H - 7.5);
    doc.text(`Page ${i} of ${pages}`, PAGE_W - M_RIGHT, PAGE_H - 7.5, { align: "right" });
  }
}

function ensureSpace(doc: Doc, y: number, needed: number): number {
  if (y + needed > PAGE_H - M_BOTTOM) {
    doc.addPage();
    return M_TOP;
  }
  return y;
}

function sectionTitle(doc: Doc, y: number, title: string, subtitle?: string): number {
  y = ensureSpace(doc, y, 18);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12.5);
  doc.setTextColor(...C.primary);
  doc.text(title, M_LEFT, y + 4.5);
  doc.setDrawColor(...C.accent);
  doc.setLineWidth(0.6);
  doc.line(M_LEFT, y + 7, M_LEFT + 14, y + 7);
  y += 10;
  if (subtitle) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...C.muted);
    const lines = doc.splitTextToSize(subtitle, CONTENT_W) as string[];
    doc.text(lines, M_LEFT, y + 1);
    y += lines.length * 4 + 1;
  }
  return y + 1;
}

function subTitle(doc: Doc, y: number, title: string): number {
  y = ensureSpace(doc, y, 12);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(...C.ink);
  doc.text(title.toUpperCase(), M_LEFT, y + 3.5);
  return y + 6.5;
}

function baseTable(doc: Doc, y: number, opts: UserOptions): number {
  autoTable(doc, {
    startY: y,
    margin: { left: M_LEFT, right: M_RIGHT, top: M_TOP, bottom: M_BOTTOM },
    theme: "grid",
    styles: { font: "helvetica", fontSize: 8, cellPadding: { top: 1.8, bottom: 1.8, left: 2.2, right: 2.2 }, textColor: C.ink, lineColor: C.line, lineWidth: 0.15, overflow: "linebreak", valign: "middle" },
    headStyles: { fillColor: C.primary, textColor: C.white, fontStyle: "bold", fontSize: 7.8, halign: "left" },
    alternateRowStyles: { fillColor: C.fillSoft },
    ...opts,
  });
  return (doc.lastAutoTable?.finalY ?? y) + 5;
}

/** Label / value pairs, two per row — the name-plate style block. */
function kvTable(doc: Doc, y: number, pairs: [string, string][]): number {
  const body: RowInput[] = [];
  for (let i = 0; i < pairs.length; i += 2) {
    const a = pairs[i];
    const b = pairs[i + 1] ?? ["", ""];
    body.push([
      { content: a[0], styles: { fontStyle: "bold", textColor: C.muted, fillColor: C.fill } },
      { content: a[1] },
      { content: b[0], styles: { fontStyle: "bold", textColor: C.muted, fillColor: C.fill } },
      { content: b[1] },
    ]);
  }
  return baseTable(doc, y, {
    body,
    theme: "grid",
    alternateRowStyles: {},
    pageBreak: body.length <= 8 ? "avoid" : "auto",
    columnStyles: { 0: { cellWidth: 40 }, 1: { cellWidth: 51 }, 2: { cellWidth: 40 }, 3: { cellWidth: 51 } },
  });
}

function paragraph(doc: Doc, y: number, label: string, text: string): number {
  return baseTable(doc, y, {
    body: [[{ content: label, styles: { fontStyle: "bold", textColor: C.muted, fillColor: C.fill } }, { content: text }]],
    alternateRowStyles: {},
    columnStyles: { 0: { cellWidth: 40 }, 1: { cellWidth: CONTENT_W - 40 } },
  });
}

function parseJson<T>(s: unknown, fallback: T): T {
  if (typeof s !== "string" || !s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

// ── the report ──────────────────────────────────────────────────────────────

export function generateCompressorPDF(
  profile: Partial<CompanyProfile> | null | undefined,
  compressors: CompressorEntry[],
  reporterName: string
): ArrayBuffer {
  const doc = new jsPDF({ unit: "mm", format: "a4" }) as Doc;
  const company = txt(profile?.companyName, "Plant");
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
  const perf = compressors.map((c) => ({ c, p: performance(c) }));

  // ── Title block ───────────────────────────────────────────────────────────
  let y = M_TOP + 4;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(...C.primary);
  doc.text("Compressor Efficiency", M_LEFT, y);
  y += 8.5;
  doc.text("Assessment Report", M_LEFT, y);
  y += 9;
  doc.setFontSize(13);
  doc.setTextColor(...C.ink);
  const companyLines = doc.splitTextToSize(company, CONTENT_W) as string[];
  doc.text(companyLines, M_LEFT, y);
  y += companyLines.length * 6 + 1;

  const address = [profile?.area, profile?.district, profile?.state, profile?.pincode].map((s) => txt(s, "")).filter(Boolean).join(", ");
  if (address) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(...C.muted);
    const addrLines = doc.splitTextToSize(address, CONTENT_W) as string[];
    doc.text(addrLines, M_LEFT, y);
    y += addrLines.length * 4.5 + 1;
  }

  y += 3;
  y = baseTable(doc, y, {
    body: [[
      { content: "Field engineer", styles: { fontStyle: "bold", textColor: C.muted, fillColor: C.fill } },
      { content: txt(reporterName, "Field Engineer") },
      { content: "Report date", styles: { fontStyle: "bold", textColor: C.muted, fillColor: C.fill } },
      { content: dateStr },
      { content: "Compressors", styles: { fontStyle: "bold", textColor: C.muted, fillColor: C.fill } },
      { content: String(compressors.length) },
    ]],
    alternateRowStyles: {},
    columnStyles: { 0: { cellWidth: 28 }, 1: { cellWidth: 44 }, 2: { cellWidth: 24 }, 3: { cellWidth: 44 }, 4: { cellWidth: 24 }, 5: { cellWidth: 18 } },
  });

  // ── 1. Plant profile ──────────────────────────────────────────────────────
  y = sectionTitle(doc, y, "1. Plant profile");
  y = kvTable(doc, y, [
    ["Company", company],
    ["Area / zone", txt(profile?.area)],
    ["District", txt(profile?.district)],
    ["State", txt(profile?.state)],
    ["Pincode", txt(profile?.pincode)],
    ["Overall consumption", num(profile?.overallConsumption) !== null ? `${profile?.overallConsumption} kWh / month` : "—"],
  ]);

  // ── 2. Fleet summary ──────────────────────────────────────────────────────
  const totalRatedKw = compressors.reduce((s, c) => s + (num(c.ratedKw) ?? 0), 0);
  const totalRatedCfm = compressors.reduce((s, c) => s + (ratedCfm(c) ?? 0), 0);
  const tested = perf.filter((x) => x.p.test).length;
  const flagged = perf.filter((x) => x.p.verdict.tone === "bad").length;

  y = sectionTitle(doc, y, "2. Fleet summary", "Design ratings from the name-plates and the outcome of each machine's performance test.");
  y = baseTable(doc, y, {
    body: [[
      { content: `${compressors.length}\nCompressors`, styles: { halign: "center", fontSize: 9 } },
      { content: `${totalRatedKw.toFixed(1)} kW\nInstalled rated power`, styles: { halign: "center", fontSize: 9 } },
      { content: `${totalRatedCfm.toFixed(0)} CFM\nRated free air delivery`, styles: { halign: "center", fontSize: 9 } },
      { content: `${tested} of ${compressors.length}\nPerformance tested`, styles: { halign: "center", fontSize: 9 } },
      { content: `${flagged}\nNeed attention`, styles: { halign: "center", fontSize: 9, ...(flagged > 0 ? { textColor: C.bad, fontStyle: "bold" } : { textColor: C.good }) } },
    ]],
    theme: "grid",
    alternateRowStyles: {},
    styles: { cellPadding: 3, lineColor: C.line, lineWidth: 0.15, fillColor: C.fillSoft },
    columnStyles: { 0: { cellWidth: CONTENT_W / 5 }, 1: { cellWidth: CONTENT_W / 5 }, 2: { cellWidth: CONTENT_W / 5 }, 3: { cellWidth: CONTENT_W / 5 }, 4: { cellWidth: CONTENT_W / 5 } },
  });

  y = subTitle(doc, y, "Design ratings");
  y = baseTable(doc, y, {
    head: [["#", "Machine tag", "Make / model", "Type", "Rated kW", "Rated capacity", "Rated CFM", "Rated bar", "Design SEC\nkW/CFM", "Design air gen.\nCFM/kW"]],
    body: perf.map(({ c, p }, i) => [
      String(i + 1),
      txt(c.machineTag),
      txt(c.makeModel),
      txt(c.compressorType),
      fmt(c.ratedKw, 1),
      num(c.ratedCapacity) !== null ? `${c.ratedCapacity} ${txt(c.ratedCapacityUnit, "")}`.trim() : "—",
      fmt(p.designCfm, 1),
      fmt(c.ratedPressure, 1),
      fmt(p.designSec, 3),
      fmt(p.designAirGen, 2),
    ]),
    columnStyles: { 0: { cellWidth: 7, halign: "center" }, 1: { cellWidth: 22 }, 2: { cellWidth: 34 }, 3: { cellWidth: 20 }, 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" }, 7: { halign: "right" }, 8: { halign: "right" }, 9: { halign: "right" } },
  });

  y = subTitle(doc, y, "Performance test results");
  y = baseTable(doc, y, {
    head: [["#", "Machine tag", "Test", "Design CFM", "Actual CFM", "Flow dev.", "Design SEC", "Actual SEC", "SEC dev.", "Verdict"]],
    body: perf.map(({ c, p }, i) => [
      String(i + 1),
      txt(c.machineTag),
      p.test ?? "—",
      fmt(p.designCfm, 1),
      fmt(p.actualCfm, 1),
      pct(p.flowDev),
      fmt(p.designSec, 3),
      fmt(p.actualSec, 3),
      pct(p.secDev),
      { content: p.verdict.label, styles: toneStyle(p.verdict.tone) },
    ]),
    columnStyles: { 0: { cellWidth: 7, halign: "center" }, 1: { cellWidth: 22 }, 2: { cellWidth: 16 }, 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" }, 7: { halign: "right" }, 8: { halign: "right" }, 9: { cellWidth: 34 } },
  });

  doc.setFont("helvetica", "italic");
  doc.setFontSize(7.5);
  doc.setTextColor(...C.muted);
  const note = doc.splitTextToSize(
    `SEC = specific energy consumption (kW per CFM of free air delivered); lower is better. A machine is flagged when its actual SEC is more than ${SEC_TOLERANCE_PCT} % above the design value — overhaul or spares replacement is the usual recommendation.`,
    CONTENT_W
  ) as string[];
  y = ensureSpace(doc, y, note.length * 3.6 + 2);
  doc.text(note, M_LEFT, y);
  y += note.length * 3.6 + 4;

  // ── 3. Compressor detail ──────────────────────────────────────────────────
  perf.forEach(({ c, p }, idx) => {
    if (idx === 0) {
      y = sectionTitle(doc, y, "3. Compressor details", "One block per machine: name-plate, electrical readings, the test as measured, and the design comparison.");
    }

    // machine banner
    y = ensureSpace(doc, y, 40);
    const title = `3.${idx + 1}  ${txt(c.machineTag)}`;
    const sub = [txt(c.makeModel, ""), txt(c.compressorType, ""), c.yearOfManufacture ? `YOM ${c.yearOfManufacture}` : ""].filter(Boolean).join("  ·  ");
    y = baseTable(doc, y, {
      body: [[
        { content: title, styles: { fontStyle: "bold", fontSize: 10.5, textColor: C.white, fillColor: C.accent, cellPadding: { top: 2.5, bottom: 2.5, left: 3, right: 3 } } },
        { content: sub || " ", styles: { fontSize: 8.5, textColor: C.white, fillColor: C.accent, halign: "right", cellPadding: { top: 2.5, bottom: 2.5, left: 3, right: 3 } } },
        { content: p.verdict.label, styles: { ...toneStyle(p.verdict.tone), halign: "center", fontSize: 8, cellPadding: { top: 2.5, bottom: 2.5, left: 3, right: 3 } } },
      ]],
      theme: "plain",
      alternateRowStyles: {},
      columnStyles: { 0: { cellWidth: 60 }, 1: { cellWidth: 82 }, 2: { cellWidth: 40 } },
    });
    y -= 2;

    // name-plate
    y = subTitle(doc, y, "Name-plate & design");
    y = kvTable(doc, y, [
      ["Serial no.", txt(c.serialNo)],
      ["Starter", txt(c.starterType)],
      ["Rated power", `${fmt(c.ratedKw, 2, "kW")}${num(c.ratedHp) !== null ? `  (${fmt(c.ratedHp, 1, "HP")})` : ""}`],
      ["Rated speed", num(c.ratedRpm) !== null ? `${c.ratedRpm} RPM` : "—"],
      ["Rated capacity", num(c.ratedCapacity) !== null ? `${c.ratedCapacity} ${txt(c.ratedCapacityUnit, "")}  (${fmt(p.designCfm, 1, "CFM")})` : "—"],
      ["Rated / process pressure", `${fmt(c.ratedPressure, 1, "bar")}  /  ${fmt(c.processPressure, 1, "bar")}`],
      ["Rated current", fmt(c.ratedCurrent, 1, "A")],
      ["Motor efficiency", num(c.motorEfficiency) !== null ? `${c.motorEfficiency} %` : "—"],
      ["Design SEC", fmt(p.designSec, 3, "kW/CFM")],
      ["Design air generation", fmt(p.designAirGen, 2, "CFM/kW")],
      ["Operating days", num(c.annualOperatingDays) !== null ? `${c.annualOperatingDays} days / year` : "—"],
      ["Power cost", num(c.powerCost) !== null ? `Rs. ${c.powerCost} / kWh` : "—"],
    ]);

    // electrical
    const hasElec = [c.genLoadVoltage, c.genLoadAmp, c.genLoadPf, c.genLoadKw, c.genUnloadVoltage, c.genUnloadAmp, c.genUnloadPf, c.genUnloadKw].some((v) => num(v) !== null);
    if (hasElec) {
      y = subTitle(doc, y, "Electrical readings");
      y = baseTable(doc, y, {
        head: [["Condition", "Voltage (V)", "Current (A)", "Power factor", "Power (kW)", "kVA", "kVAr", "Load factor"]],
        body: [
          ["Load", fmt(c.genLoadVoltage, 1), fmt(c.genLoadAmp, 1), fmt(c.genLoadPf, 2), fmt(c.genLoadKw, 2), fmt(c.kva, 2), fmt(c.kvar, 2), num(c.loadFactor) !== null ? `${Number(c.loadFactor).toFixed(1)} %` : "—"],
          ["Unload", fmt(c.genUnloadVoltage, 1), fmt(c.genUnloadAmp, 1), fmt(c.genUnloadPf, 2), fmt(c.genUnloadKw, 2), "—", "—", "—"],
        ],
        columnStyles: { 0: { fontStyle: "bold", cellWidth: 24 }, 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" }, 7: { halign: "right" } },
      });
    }

    // load / unload hour readings
    const lu = parseJson<Record<string, string[]>>(c.luData, {});
    const luHasData = ["loadHours", "unloadHours", "totalRunHours"].some((k) => (lu[k] || []).some((v) => v !== "" && v !== undefined && v !== null));
    if (luHasData) {
      const first = (k: string) => num((lu[k] || [])[0]);
      const last = (k: string) => { const arr = (lu[k] || []).map(num).filter((v): v is number => v !== null); return arr.length ? arr[arr.length - 1] : null; };
      const delta = (k: string) => { const a = first(k), b = last(k); return a !== null && b !== null && b > a ? b - a : null; };
      const dLoad = delta("loadHours"), dUnload = delta("unloadHours"), dTotal = delta("totalRunHours");
      y = subTitle(doc, y, `Load / unload hour meter (${txt(c.luType, "SD")})`);
      const luBody: RowInput[] = [0, 1, 2].map((i) => [
        `Reading ${i + 1}`,
        txt(lu.date?.[i]), txt(lu.time?.[i]),
        txt(lu.loadHours?.[i]), txt(lu.unloadHours?.[i]), txt(lu.totalRunHours?.[i]),
        txt(lu.band020?.[i]), txt(lu.band2040?.[i]), txt(lu.band4060?.[i]), txt(lu.band6080?.[i]), txt(lu.band80100?.[i]),
      ]);
      luBody.push([
        { content: "Difference (last - first)", styles: { fontStyle: "bold" } }, "", "",
        { content: fmt(dLoad, 1), styles: { fontStyle: "bold" } },
        { content: fmt(dUnload, 1), styles: { fontStyle: "bold" } },
        { content: fmt(dTotal, 1), styles: { fontStyle: "bold" } },
        { content: dLoad !== null && dTotal ? `${((dLoad / dTotal) * 100).toFixed(1)} % loaded` : "", colSpan: 5, styles: { fontStyle: "bold", textColor: C.accent } },
      ]);
      y = baseTable(doc, y, {
        head: [["Reading", "Date", "Time", "Load hrs", "Unload hrs", "Total run hrs", "0–20 %", "20–40 %", "40–60 %", "60–80 %", "80–100 %"]],
        body: luBody,
        styles: { fontSize: 7.4, cellPadding: 1.5 },
        columnStyles: { 0: { cellWidth: 30 } },
      });
    }

    // FAD anemometer test
    if (c.fadActive) {
      y = subTitle(doc, y, "Free air delivery — anemometer test");
      const areaDesc = c.fadAreaType === "Rectangle"
        ? `Rectangle ${txt(c.fadAreaL)} × ${txt(c.fadAreaB)} mm`
        : c.fadAreaType === "Circle"
          ? (num(c.fadAreaDia) !== null ? `Circle, dia ${c.fadAreaDia} m` : num(c.fadAreaRadius) !== null ? `Circle, radius ${c.fadAreaRadius} m` : `Circle, perimeter ${txt(c.fadAreaPeri)} m`)
          : "Direct area entry";
      y = kvTable(doc, y, [
        ["Suction duct", areaDesc],
        ["Suction area", fmt(c.fadSuctionArea, 4, "m²")],
        ["Average velocity", fmt(c.fadAvgVelocity, 2, "m/s")],
        ["Running pressure", fmt(c.fadRunningPressure, 1, "bar")],
        ["Air delivery", `${fmt(c.fadAirDeliveryM3Sec, 4, "m³/s")}  ·  ${fmt(c.fadAirDeliveryM3Hr, 1, "m³/hr")}  ·  ${fmt(c.fadAirDeliveryCfm, 1, "CFM")}`],
        ["Measured power", fmt(c.fadMeasuredPower, 2, "kW")],
      ]);

      const vels = parseJson<number[]>(c.fadVelocities, []);
      if (vels.length) {
        const perRow = 8;
        const rows: RowInput[] = [];
        for (let i = 0; i < vels.length; i += perRow) {
          const slice = vels.slice(i, i + perRow);
          const cells: CellInput[] = slice.map((v, j) => ({ content: `P${i + j + 1}\n${fmt(v, 2)}`, styles: { halign: "center" as const } }));
          while (cells.length < perRow) cells.push("");
          rows.push(cells);
        }
        y = baseTable(doc, y, {
          head: [[{ content: `Velocity traverse — ${vels.length} points (m/s)`, colSpan: perRow, styles: { halign: "left" } }]],
          body: rows,
          styles: { fontSize: 7.4, cellPadding: 1.4 },
          alternateRowStyles: {},
        });
      }
      if (txt(c.fadDescription, "") !== "") y = paragraph(doc, y, "FAD remarks", txt(c.fadDescription));
    }

    // Pump-up test
    if (c.pumpActive) {
      y = subTitle(doc, y, "Free air delivery — receiver pump-up test");
      const volM3 = tankVolumeM3(c);
      const tankDesc = c.pumpTankCalcMethod === "DiaLength"
        ? `from dia ${txt(c.pumpTankDia)} mm × length ${txt(c.pumpTankLength)} mm`
        : c.pumpTankCalcMethod === "PeriLength"
          ? `from perimeter ${txt(c.pumpTankPeri)} mm × length ${txt(c.pumpTankLength)} mm`
          : "entered directly";
      y = kvTable(doc, y, [
        ["Receiver volume", `${fmt(c.pumpTankVolume, 2, txt(c.pumpTankVolumeUnit, ""))}${volM3 !== null ? `  (${volM3.toFixed(3)} m³)` : ""}`],
        ["Volume basis", tankDesc],
        ["Start pressure P1", fmt(c.pumpP1, 1, "bar")],
        ["End pressure P2", fmt(c.pumpP2, 1, "bar")],
        ["Pump-up time", fmt(c.pumpTimeSec, 1, "s")],
        ["Air temperature", num(c.pumpAirTempC) !== null ? `${c.pumpAirTempC} °C  (factor ${fmt(c.pumpTempFactor, 4)})` : "—"],
        ["Load / unload pressure", `${fmt(c.loadPressure, 1, "bar")}  /  ${fmt(c.unloadPressure, 1, "bar")}`],
        ["Running pressure", fmt(c.pumpRunningPressure, 1, "bar")],
        ["Actual FAD", `${fmt(c.pumpActualFadM3Min, 3, "m³/min")}  ·  ${fmt(c.pumpActualFadCfm, 1, "CFM")}`],
        ["Measured power", fmt(c.pumpMeasuredPower ?? c.genLoadKw, 2, "kW")],
      ]);

      const laps = parseJson<Array<{ pressure: number; timeSec: number | null; fadM3Min: number; fadCorrM3Min: number; kwh?: string }>>(c.pumpLapData, []);
      const stamped = laps.filter((l) => isNum(l.timeSec));
      if (stamped.length) {
        y = baseTable(doc, y, {
          head: [["#", "Pressure (bar)", "Lap time (s)", "FAD (m³/min)", "FAD × temp. factor (m³/min)", "FAD (CFM)", "Energy meter (kWh)"]],
          body: laps.map((l, i) => [
            String(i + 1),
            fmt(l.pressure, 1),
            isNum(l.timeSec) ? l.timeSec.toFixed(1) : "—",
            l.fadM3Min > 0 ? l.fadM3Min.toFixed(3) : "—",
            l.fadM3Min > 0 ? l.fadCorrM3Min.toFixed(3) : "—",
            l.fadM3Min > 0 ? (l.fadCorrM3Min * M3MIN_TO_CFM).toFixed(1) : "—",
            txt(l.kwh, ""),
          ]),
          styles: { fontSize: 7.4, cellPadding: 1.5 },
          columnStyles: { 0: { cellWidth: 8, halign: "center" }, 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" } },
        });
      }
      if (txt(c.pumpDescription, "") !== "") y = paragraph(doc, y, "Pump-up remarks", txt(c.pumpDescription));
    }

    // design vs actual
    if (p.test) {
      y = subTitle(doc, y, `Design vs actual (${p.test} test)`);
      const row = (metric: string, design: string, actual: string, dev: number | null, worseWhenHigher: boolean) => {
        let tone: Verdict["tone"] = "muted";
        let label = "—";
        if (dev !== null) {
          const worse = worseWhenHigher ? dev > 0 : dev < 0;
          const beyond = Math.abs(dev) > SEC_TOLERANCE_PCT;
          tone = !worse ? "good" : beyond ? "bad" : "warn";
          label = !worse ? "Better than design" : beyond ? "Attention" : "Within tolerance";
        }
        return [metric, design, actual, pct(dev), { content: label, styles: toneStyle(tone) }] as RowInput;
      };
      y = baseTable(doc, y, {
        head: [["Metric", "Design (rated)", `Actual (${p.test})`, "Deviation", "Status"]],
        body: [
          row("Free air delivery (CFM)", fmt(p.designCfm, 1), fmt(p.actualCfm, 1), p.flowDev, false),
          row("Specific energy (kW/CFM)", fmt(p.designSec, 3), fmt(p.actualSec, 3), p.secDev, true),
          row("Air generation (CFM/kW)", fmt(p.designAirGen, 2), fmt(p.actualAirGen, 2), p.genDev, false),
        ],
        columnStyles: { 0: { cellWidth: 52, fontStyle: "bold" }, 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { cellWidth: 36, halign: "center" } },
      });
    }

    // temperature observations
    const obs: [string, unknown][] = [
      ["Compressor situation", c.obsCompSituation], ["Compressor discharge", c.obsCompDischarge], ["Oil sap", c.obsOilSap],
      ["Oil radiator in", c.obsOilRadiatorIn], ["Oil radiator out", c.obsOilRadiatorOut], ["Air radiator in", c.obsAirRadiatorIn],
      ["Air radiator out", c.obsAirRadiatorOut], ["Final discharge", c.obsCompFinalDischarge], ["Compressor motor", c.obsCompMotor],
    ];
    const obsFilled = obs.filter(([, v]) => num(v) !== null);
    if (obsFilled.length || txt(c.obsThermalImageNo, "") !== "") {
      y = subTitle(doc, y, "Temperature observations (°C)");
      const pairs: [string, string][] = obsFilled.map(([k, v]) => [k, fmt(v, 1)] as [string, string]);
      if (txt(c.obsThermalImageNo, "") !== "") pairs.push(["Thermal image no.", txt(c.obsThermalImageNo)]);
      y = kvTable(doc, y, pairs);
    }

    if (txt(c.description, "") !== "") y = paragraph(doc, y, "General remarks", txt(c.description));

    y = baseTable(doc, y, {
      body: [[{ content: `Recorded by ${txt(c.recordedBy, "—")}  ·  ${c.createdAt ? new Date(c.createdAt).toLocaleString("en-IN") : ""}`, styles: { fontSize: 7, textColor: C.muted, halign: "right", cellPadding: 1 } }]],
      theme: "plain",
      alternateRowStyles: {},
    });
    y += 2;
  });

  if (compressors.length === 0) {
    y = sectionTitle(doc, y, "3. Compressor details");
    y = paragraph(doc, y, "Note", "No compressor has been recorded for this plant yet.");
  }

  drawChrome(doc, company);
  return doc.output("arraybuffer");
}
