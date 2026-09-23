import { jsPDF } from "jspdf";
import autoTable, { type CellInput, type RowInput, type Styles, type UserOptions } from "jspdf-autotable";
import type { CompanyProfile, CompressorEntry } from "@/lib/store";
import { lapEnergy, mainVolume, parseLaps, pipeAreaM2 } from "@/lib/compressor-calc";

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

/** Rated pressure in bar, whatever the name-plate was entered in. */
function ratedBar(c: CompressorEntry): number | null {
  return num(c.ratedPressure);
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

// ── charts, drawn as vectors so they stay sharp and need no browser ─────────

function niceMax(v: number): number {
  if (!isFinite(v) || v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}

function chartFrame(doc: Doc, x: number, y: number, w: number, h: number, title: string, unit?: string) {
  doc.setFillColor(...C.white);
  doc.setDrawColor(...C.line);
  doc.setLineWidth(0.25);
  doc.roundedRect(x, y, w, h, 1.5, 1.5, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...C.ink);
  doc.text(title, x + 3, y + 5);
  if (unit) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(...C.muted);
    doc.text(unit, x + w - 3, y + 5, { align: "right" });
  }
}

/** Vertical bars with the value printed over each one — the suction-velocity chart. */
function barChart(doc: Doc, x: number, y: number, w: number, h: number, o: { title: string; unit?: string; labels: string[]; values: number[]; xTitle?: string }) {
  chartFrame(doc, x, y, w, h, o.title, o.unit);
  const px = x + 13, py = y + 9, pw = w - 17, ph = h - (o.xTitle ? 22 : 17);
  const max = niceMax(Math.max(0, ...o.values));
  doc.setLineWidth(0.15);
  for (let i = 0; i <= 4; i++) {
    const gy = py + ph - (ph * i) / 4;
    doc.setDrawColor(...C.line);
    doc.line(px, gy, px + pw, gy);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.5);
    doc.setTextColor(...C.muted);
    doc.text(((max * i) / 4).toFixed(max < 10 ? 1 : 0), px - 1.5, gy + 1, { align: "right" });
  }
  const slot = pw / Math.max(o.values.length, 1);
  const bw = Math.min(11, slot * 0.6);
  o.values.forEach((v, i) => {
    const cx = px + i * slot + slot / 2;
    const bh = max > 0 ? (Math.max(0, v) / max) * ph : 0;
    doc.setFillColor(...C.accent);
    doc.rect(cx - bw / 2, py + ph - bh, bw, bh, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(5.8);
    doc.setTextColor(...C.ink);
    doc.text(v.toFixed(2), cx, py + ph - bh - 1.4, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.8);
    doc.setTextColor(...C.muted);
    doc.text(o.labels[i] ?? String(i + 1), cx, py + ph + 3.6, { align: "center" });
  });
  if (o.xTitle) {
    doc.setFontSize(5.8);
    doc.setTextColor(...C.muted);
    doc.text(o.xTitle, x + w / 2, y + h - 2.5, { align: "center" });
  }
}

/**
 * The suction port as it was traversed: a circle for a round duct, a rectangle
 * for a rectangular one, with the measurement points numbered where they were
 * taken. An odd count puts the last point in the centre, which is how a round
 * duct is normally traversed (four around the wall plus one in the middle).
 */
function portDiagram(doc: Doc, x: number, y: number, w: number, h: number, shape: "Circle" | "Rectangle", points: number, caption: string) {
  chartFrame(doc, x, y, w, h, "Suction port", `${points} point${points === 1 ? "" : "s"}`);
  const cx = x + w / 2, cy = y + (h - 6) / 2 + 5;
  const boxW = Math.min(w - 16, 46), boxH = Math.min(h - 20, 34);
  const spots: [number, number][] = [];

  if (shape === "Circle") {
    const r = Math.min(boxW, boxH) / 2;
    doc.setFillColor(219, 234, 254);
    doc.setDrawColor(...C.accent);
    doc.setLineWidth(0.4);
    doc.circle(cx, cy, r, "FD");
    const centre = points % 2 === 1;
    const ring = centre ? points - 1 : points;
    for (let i = 0; i < ring; i++) {
      const a = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(ring, 1);
      spots.push([cx + Math.cos(a) * r * 0.62, cy + Math.sin(a) * r * 0.62]);
    }
    if (centre) spots.push([cx, cy]);
  } else {
    doc.setFillColor(219, 234, 254);
    doc.setDrawColor(...C.accent);
    doc.setLineWidth(0.4);
    doc.rect(cx - boxW / 2, cy - boxH / 2, boxW, boxH, "FD");
    const cols = Math.ceil(Math.sqrt(points));
    const rows = Math.ceil(points / cols);
    for (let i = 0; i < points; i++) {
      const r = Math.floor(i / cols), c = i % cols;
      const inRow = Math.min(cols, points - r * cols);
      spots.push([
        cx - boxW / 2 + (boxW * (c + 1)) / (inRow + 1),
        cy - boxH / 2 + (boxH * (r + 1)) / (rows + 1),
      ]);
    }
  }

  spots.forEach(([sx, sy], i) => {
    doc.setFillColor(...C.white);
    doc.setDrawColor(...C.primary);
    doc.setLineWidth(0.3);
    doc.roundedRect(sx - 3, sy - 2.4, 6, 4.8, 0.8, 0.8, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.2);
    doc.setTextColor(...C.primary);
    doc.text(String(i + 1), sx, sy + 1.5, { align: "center" });
  });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(5.8);
  doc.setTextColor(...C.muted);
  doc.text(doc.splitTextToSize(caption, w - 6)[0] as string, x + w / 2, y + h - 2.5, { align: "center" });
}

/** Pressure against elapsed time, with the energy-meter readings marked. */
function pressureTimeChart(doc: Doc, x: number, y: number, w: number, h: number, laps: Array<{ pressure: number; timeSec: number | null; kwh?: string }>) {
  chartFrame(doc, x, y, w, h, "Receiver pressure vs time", "bar against seconds");
  const pts = laps
    .map((l) => ({ t: num(l.timeSec), p: num(l.pressure), kwh: num(l.kwh) }))
    .filter((l): l is { t: number; p: number; kwh: number | null } => l.t !== null && l.p !== null)
    .sort((a, b) => a.t - b.t);
  if (pts.length < 2) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(7);
    doc.setTextColor(...C.muted);
    doc.text("Not enough lap times recorded to plot.", x + w / 2, y + h / 2, { align: "center" });
    return;
  }
  const px = x + 13, py = y + 9, pw = w - 18, ph = h - 20;
  const tMax = niceMax(Math.max(...pts.map((p) => p.t)));
  const pMax = niceMax(Math.max(...pts.map((p) => p.p)));
  const X = (t: number) => px + (t / tMax) * pw;
  const Y = (p: number) => py + ph - (p / pMax) * ph;

  doc.setLineWidth(0.15);
  for (let i = 0; i <= 4; i++) {
    const gy = py + ph - (ph * i) / 4;
    doc.setDrawColor(...C.line);
    doc.line(px, gy, px + pw, gy);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.5);
    doc.setTextColor(...C.muted);
    doc.text(((pMax * i) / 4).toFixed(1), px - 1.5, gy + 1, { align: "right" });
  }
  for (let i = 0; i <= 4; i++) {
    const t = (tMax * i) / 4;
    doc.setFontSize(5.5);
    doc.setTextColor(...C.muted);
    doc.text(t.toFixed(0), X(t), py + ph + 3.4, { align: "center" });
  }

  doc.setDrawColor(...C.accent);
  doc.setLineWidth(0.5);
  for (let i = 1; i < pts.length; i++) doc.line(X(pts[i - 1].t), Y(pts[i - 1].p), X(pts[i].t), Y(pts[i].p));
  pts.forEach((p) => {
    doc.setFillColor(...C.accent);
    doc.circle(X(p.t), Y(p.p), 0.8, "F");
  });

  // energy-meter readings along the top, where they were taken
  const withKwh = pts.filter((p) => p.kwh !== null);
  if (withKwh.length) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(5);
    doc.setTextColor(...C.warn);
    withKwh.forEach((p, i) => {
      if (i % Math.ceil(withKwh.length / 6) !== 0 && i !== withKwh.length - 1) return;
      doc.text(`${p.kwh!.toFixed(2)}`, X(p.t), Y(p.p) - 2, { align: "center" });
    });
    doc.setTextColor(...C.muted);
    doc.text("kWh readings shown above the curve", x + w / 2, y + h - 2.5, { align: "center" });
  } else {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.5);
    doc.setTextColor(...C.muted);
    doc.text("Elapsed time (s)", x + w / 2, y + h - 2.5, { align: "center" });
  }
}

/** The photo's layout: design parameters on the left, what was measured on the right. */
function designVsMeasuredTable(doc: Doc, y: number, design: [string, string][], measured: [string, string][], footer: [string, string, string, string][]): number {
  const rows = Math.max(design.length, measured.length);
  const body: RowInput[] = [];
  for (let i = 0; i < rows; i++) {
    const d = design[i] ?? ["", ""];
    const m = measured[i] ?? ["", ""];
    body.push([
      { content: d[0], styles: { textColor: C.ink } },
      { content: d[1], styles: { halign: "right", fontStyle: "bold" } },
      { content: m[0], styles: { textColor: C.ink } },
      { content: m[1], styles: { halign: "right", fontStyle: "bold" } },
    ]);
  }
  for (const [a, b, c2, d2] of footer) {
    body.push([
      { content: a, styles: { fontStyle: "bold", fillColor: C.fill } },
      { content: b, styles: { halign: "right", fontStyle: "bold", fillColor: C.fill } },
      { content: c2, styles: { fontStyle: "bold", fillColor: C.fill } },
      { content: d2, styles: { halign: "right", fontStyle: "bold", fillColor: C.fill } },
    ]);
  }
  return baseTable(doc, y, {
    head: [[
      { content: "Design Parameters", colSpan: 2, styles: { halign: "center" } },
      { content: "Measurement Parameters", colSpan: 2, styles: { halign: "center" } },
    ]],
    body,
    alternateRowStyles: {},
    columnStyles: { 0: { cellWidth: 46 }, 1: { cellWidth: 25 }, 2: { cellWidth: 60 }, 3: { cellWidth: 51 } },
  });
}

/** Formula, the numbers put into it, and the answer — so a reader can follow the sum. */
function calcSummary(doc: Doc, y: number, title: string, steps: Array<[string, string, string]>): number {
  y = subTitle(doc, y, title);
  return baseTable(doc, y, {
    head: [["Quantity", "Formula", "Substitution", "Result"]],
    body: steps.map(([q, f, sr]) => {
      const [sub, res] = sr.split("|");
      return [
        { content: q, styles: { fontStyle: "bold" as const } },
        { content: f, styles: { fontSize: 7, textColor: C.muted } },
        { content: sub ?? "", styles: { fontSize: 7 } },
        { content: res ?? "", styles: { halign: "right" as const, fontStyle: "bold" as const, textColor: C.primary } },
      ];
    }),
    styles: { fontSize: 7.6, cellPadding: 1.6 },
    columnStyles: { 0: { cellWidth: 40 }, 1: { cellWidth: 52 }, 2: { cellWidth: 56 }, 3: { cellWidth: 34 } },
  });
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

  // ── Plant compressor profile ──────────────────────────────────────────────
  // What the plant actually runs, taken as a whole: how the installed power and
  // the air it makes are split between the machines, and what each costs to run.
  if (compressors.length > 0) {
    y = subTitle(doc, y, "Plant compressor profile");
    const measuredTotalKw = perf.reduce((s, { p }) => s + (p.measuredKw ?? 0), 0);
    const actualTotalCfm = perf.reduce((s, { p }) => s + (p.actualCfm ?? 0), 0);
    const plantSec = actualTotalCfm > 0 && measuredTotalKw > 0 ? measuredTotalKw / actualTotalCfm : null;
    const plantDesignSec = totalRatedCfm > 0 && totalRatedKw > 0 ? totalRatedKw / totalRatedCfm : null;

    y = baseTable(doc, y, {
      head: [["#", "Machine tag", "Type", "Rated kW", "Share of plant kW", "Rated CFM", "Share of plant air", "Actual CFM", "Actual kW/CFM", "Status"]],
      body: perf.map(({ c, p }, i) => {
        const rKw = num(c.ratedKw) ?? 0;
        const rCfm = ratedCfm(c) ?? 0;
        return [
          String(i + 1),
          txt(c.machineTag),
          txt(c.compressorType),
          fmt(rKw, 1),
          totalRatedKw > 0 ? `${((rKw / totalRatedKw) * 100).toFixed(1)} %` : "—",
          fmt(rCfm, 0),
          totalRatedCfm > 0 ? `${((rCfm / totalRatedCfm) * 100).toFixed(1)} %` : "—",
          fmt(p.actualCfm, 1),
          fmt(p.actualSec, 3),
          { content: p.verdict.label, styles: toneStyle(p.verdict.tone) },
        ];
      }),
      foot: [[
        { content: "Plant total", colSpan: 3, styles: { fontStyle: "bold" } },
        { content: totalRatedKw.toFixed(1), styles: { halign: "right", fontStyle: "bold" } },
        { content: "100 %", styles: { halign: "right", fontStyle: "bold" } },
        { content: totalRatedCfm.toFixed(0), styles: { halign: "right", fontStyle: "bold" } },
        { content: "100 %", styles: { halign: "right", fontStyle: "bold" } },
        { content: actualTotalCfm > 0 ? actualTotalCfm.toFixed(1) : "—", styles: { halign: "right", fontStyle: "bold" } },
        { content: plantSec !== null ? plantSec.toFixed(3) : "—", styles: { halign: "right", fontStyle: "bold" } },
        { content: plantDesignSec !== null && plantSec !== null ? (plantSec > plantDesignSec ? "Above design" : "At or below design") : "—", styles: { halign: "center", fontStyle: "bold" } },
      ]],
      footStyles: { fillColor: C.fill, textColor: C.ink },
      styles: { fontSize: 7.4, cellPadding: 1.5 },
      columnStyles: { 0: { cellWidth: 7, halign: "center" }, 1: { cellWidth: 24 }, 2: { cellWidth: 20 }, 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" }, 7: { halign: "right" }, 8: { halign: "right" }, 9: { cellWidth: 28 } },
    });

    // Installed power and measured air side by side, machine by machine.
    const tags = perf.map(({ c }) => txt(c.machineTag, "—"));
    const chartH = 46;
    y = ensureSpace(doc, y, chartH + 6);
    const half = (CONTENT_W - 4) / 2;
    barChart(doc, M_LEFT, y, half, chartH, {
      title: "Rated power by machine",
      unit: "kW",
      labels: tags,
      values: perf.map(({ c }) => num(c.ratedKw) ?? 0),
    });
    barChart(doc, M_LEFT + half + 4, y, half, chartH, {
      title: "Air delivery — rated vs measured",
      unit: "CFM",
      labels: tags,
      values: perf.map(({ p }) => p.actualCfm ?? p.designCfm ?? 0),
    });
    y += chartH + 5;

    if (plantSec !== null && plantDesignSec !== null) {
      const gap = ((plantSec - plantDesignSec) / plantDesignSec) * 100;
      y = paragraph(
        doc,
        y,
        "Plant reading",
        `Taken together the tested machines draw ${measuredTotalKw.toFixed(1)} kW to make ${actualTotalCfm.toFixed(0)} CFM, a plant specific energy consumption of ${plantSec.toFixed(3)} kW/CFM against ${plantDesignSec.toFixed(3)} kW/CFM by name-plate — ${Math.abs(gap).toFixed(1)} % ${gap > 0 ? "above" : "below"} design. ${gap > SEC_TOLERANCE_PCT ? "Worth taking the flagged machines in hand first: they carry most of that gap." : "The fleet is running close to its design figures."}`
      );
    }
  }

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

      // The traverse as it was taken: the velocities beside the port they came from.
      if (vels.length) {
        const shape: "Circle" | "Rectangle" | null =
          c.fadAreaType === "Circle" ? "Circle" : c.fadAreaType === "Rectangle" ? "Rectangle" : null;
        const chartH = 46;
        y = ensureSpace(doc, y, chartH + 6);
        const diagW = shape ? 54 : 0;
        const barW = CONTENT_W - (shape ? diagW + 4 : 0);
        barChart(doc, M_LEFT, y, barW, chartH, {
          title: "Suction velocities",
          unit: "m/s",
          labels: vels.map((_, i) => String(i + 1)),
          values: vels.map((v) => num(v) ?? 0),
          xTitle: "Measurement points",
        });
        if (shape) {
          portDiagram(doc, M_LEFT + barW + 4, y, diagW, chartH, shape, vels.length, shape === "Circle" ? "Round duct" : "Rectangular duct");
        }
        y += chartH + 5;
      }

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
      // How the figures were arrived at.
      const avgV = num(c.fadAvgVelocity);
      const areaM2 = num(c.fadSuctionArea);
      const m3s = num(c.fadAirDeliveryM3Sec);
      const cfmFad = num(c.fadAirDeliveryCfm);
      const fadKw = num(c.fadMeasuredPower) ?? num(c.genLoadKw);
      y = calcSummary(doc, y, "Calculation summary — anemometer test", [
        ["Average velocity", "sum of point velocities / number of points", vels.length ? `${vels.map((v) => fmt(v, 2)).join(" + ")} / ${vels.length}|${fmt(avgV, 2)} m/s` : `|${fmt(avgV, 2)} m/s`],
        ["Suction area", c.fadAreaType === "Rectangle" ? "L x B" : c.fadAreaType === "Circle" ? "pi x d^2 / 4" : "entered directly", `|${fmt(areaM2, 4)} m2`],
        ["Air delivery", "area x average velocity", `${fmt(areaM2, 4)} x ${fmt(avgV, 2)}|${fmt(m3s, 4)} m3/s`],
        ["Air delivery", "m3/s x 3600 ; x 35.3147 / 60 for CFM", `${fmt(m3s, 4)} x 3600|${fmt(c.fadAirDeliveryM3Hr, 1)} m3/hr`],
        ["Free air delivery", "m3/hr / 1.699 (m3/hr per CFM)", `${fmt(c.fadAirDeliveryM3Hr, 1)} / 1.699|${fmt(cfmFad, 1)} CFM`],
        ["Actual SEC", "measured power / CFM", `${fmt(fadKw, 2)} / ${fmt(cfmFad, 1)}|${fmt(p.actualSec, 3)} kW/CFM`],
        ["Actual air generation", "CFM / measured power", `${fmt(cfmFad, 1)} / ${fmt(fadKw, 2)}|${fmt(p.actualAirGen, 2)} CFM/kW`],
      ]);

      if (txt(c.fadDescription, "") !== "") y = paragraph(doc, y, "FAD remarks", txt(c.fadDescription));
    }

    // Pump-up test
    if (c.pumpActive) {
      y = subTitle(doc, y, "Free air delivery — receiver pump-up test");
      const mv = mainVolume(c);
      const volM3 = mv.total;
      const tankDesc = c.pumpTankCalcMethod === "DiaLength"
        ? `from dia ${txt(c.pumpTankDia)} mm × length ${txt(c.pumpTankLength)} mm`
        : c.pumpTankCalcMethod === "PeriLength"
          ? `from perimeter ${txt(c.pumpTankPeri)} mm × length ${txt(c.pumpTankLength)} mm`
          : "entered directly";
      const pipeLine = (label: string, active: boolean | undefined, peri: unknown, len: unknown, vol: number | null, periUnit?: string | null, lenUnit?: string | null) =>
        active && vol !== null
          ? [`${label} pipe`, `perimeter ${txt(peri)} ${txt(periUnit, "mm")} × length ${txt(len)} ${txt(lenUnit, "m")}  →  bore ${fmt(pipeAreaM2(peri, periUnit), 5, "m²")}  ·  ${vol.toFixed(4)} m³`] as [string, string]
          : null;
      const pipeRows = [
        pipeLine("Inlet", c.pumpInletPipeActive, c.pumpInletPipePeri, c.pumpInletPipeLength, mv.inlet, c.pumpInletPipePeriUnit, c.pumpInletPipeLenUnit),
        pipeLine("Outlet", c.pumpOutletPipeActive, c.pumpOutletPipePeri, c.pumpOutletPipeLength, mv.outlet, c.pumpOutletPipePeriUnit, c.pumpOutletPipeLenUnit),
      ].filter((r): r is [string, string] => r !== null);
      y = kvTable(doc, y, [
        ["Receiver volume", `${fmt(c.pumpTankVolume, 2, txt(c.pumpTankVolumeUnit, ""))}${mv.tank !== null ? `  (${mv.tank.toFixed(3)} m³)` : ""}`],
        ["Volume basis", tankDesc],
        ...pipeRows,
        ["Main volume used", `${volM3 !== null ? `${volM3.toFixed(3)} m³` : "—"}  =  ${mv.basis}`],
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
      // Pressure against time, with the energy-meter readings marked on it.
      const lapRecords = parseLaps(c.pumpLapData);
      if (lapRecords.filter((l) => num(l.timeSec) !== null).length >= 2) {
        const chartH = 52;
        y = ensureSpace(doc, y, chartH + 6);
        pressureTimeChart(doc, M_LEFT, y, CONTENT_W, chartH, lapRecords);
        y += chartH + 5;
      }

      // What the energy meter did over the run.
      const energy = lapEnergy(lapRecords);
      if (energy.readings > 0) {
        y = subTitle(doc, y, "Energy drawn during the pump-up");
        y = kvTable(doc, y, [
          ["Meter at start", fmt(energy.first, 2, "kWh")],
          ["Meter at end", fmt(energy.last, 2, "kWh")],
          ["Energy used", fmt(energy.used, 3, "kWh")],
          ["Run time", fmt(energy.seconds, 1, "s")],
          ["Average power over the run", fmt(energy.avgKw, 2, "kW")],
          ["Readings taken", `${energy.readings} of ${lapRecords.length} laps`],
        ]);
      }

      const pumpKw = num(c.pumpMeasuredPower) ?? num(c.genLoadKw) ?? energy.avgKw;
      y = calcSummary(doc, y, "Calculation summary — pump-up test", [
        ["Main volume", "tank + inlet pipe + outlet pipe", `${mv.basis}|${volM3 !== null ? `${volM3.toFixed(3)} m³` : "—"}`],
        ["Pipe bore", "perimeter^2 / (4 x pi)", pipeRows.length
          ? `${[
              c.pumpInletPipeActive ? `inlet ${fmt(c.pumpInletPipePeri, 0)} mm -> ${fmt(pipeAreaM2(c.pumpInletPipePeri), 5)} m2` : "",
              c.pumpOutletPipeActive ? `outlet ${fmt(c.pumpOutletPipePeri, 0)} mm -> ${fmt(pipeAreaM2(c.pumpOutletPipePeri), 5)} m2` : "",
            ].filter(Boolean).join("; ")}|${fmt((mv.inlet ?? 0) + (mv.outlet ?? 0), 4)} m3`
          : `no pipe measured|—`],
        ["Pressure rise", "P2 - P1", `${fmt(c.pumpP2, 1)} - ${fmt(c.pumpP1, 1)}|${fmt((num(c.pumpP2) ?? 0) - (num(c.pumpP1) ?? 0), 1)} bar`],
        ["Free air delivery", "V x (P2 - P1) / ((t/60) x 1.013)", `${volM3 !== null ? volM3.toFixed(3) : "—"} x ${fmt((num(c.pumpP2) ?? 0) - (num(c.pumpP1) ?? 0), 1)} / ((${fmt(c.pumpTimeSec, 1)}/60) x 1.013)|${fmt(c.pumpActualFadM3Min, 3)} m3/min`],
        ["Temperature correction", "273 / (273 + T)", num(c.pumpAirTempC) !== null ? `273 / (273 + ${fmt(c.pumpAirTempC, 1)})|${fmt(c.pumpTempFactor, 4)}` : `air temperature not recorded|—`],
        ["Free air delivery", "m3/min x 35.3147", `${fmt(c.pumpActualFadM3Min, 3)} x 35.3147|${fmt(c.pumpActualFadCfm, 1)} CFM`],
        ["Actual SEC", "measured power / CFM", `${fmt(pumpKw, 2)} / ${fmt(c.pumpActualFadCfm, 1)}|${fmt(p.actualSec, 3)} kW/CFM`],
        ["Actual air generation", "CFM / measured power", `${fmt(c.pumpActualFadCfm, 1)} / ${fmt(pumpKw, 2)}|${fmt(p.actualAirGen, 2)} CFM/kW`],
      ]);

      if (txt(c.pumpDescription, "") !== "") y = paragraph(doc, y, "Pump-up remarks", txt(c.pumpDescription));
    }

    // The plant's own way of reading a compressor test: design on the left,
    // what the instruments said on the right, the three ratios underneath.
    if (p.test) {
      const isFad = p.test === "FAD";
      y = subTitle(doc, y, `${txt(c.compressorType, "Compressor")} performance  (at ${fmt(c.processPressure ?? c.ratedPressure, 1)} kg/cm² setting)`);
      const designCol: [string, string][] = [
        ["Design Pressure, Bar", fmt(ratedBar(c), 1)],
        ["Motor kW", fmt(c.ratedKw, 1)],
        ["Motor Efficiency, %", fmt(c.motorEfficiency, 1)],
        ["Rated capacity", num(c.ratedCapacity) !== null ? `${c.ratedCapacity} ${txt(c.ratedCapacityUnit, "")}`.trim() : "—"],
        ["Operating days / year", num(c.annualOperatingDays) !== null ? String(c.annualOperatingDays) : "—"],
      ];
      const mv2 = mainVolume(c);
      const measuredCol: [string, string][] = isFad
        ? [
            ["Running Pressure, Bar", fmt(c.fadRunningPressure, 1)],
            ["Measured Power, kW", fmt(num(c.fadMeasuredPower) ?? num(c.genLoadKw), 1)],
            ["Avg Velocity, m/s", fmt(c.fadAvgVelocity, 1)],
            ["Suction Area, Sqm", fmt(c.fadSuctionArea, 4)],
            ["Air Delivery, m³/Sec", fmt(c.fadAirDeliveryM3Sec, 3)],
            ["m³/hr", fmt(c.fadAirDeliveryM3Hr, 1)],
          ]
        : [
            ["Running Pressure, Bar", fmt(c.pumpRunningPressure, 1)],
            ["Measured Power, kW", fmt(num(c.pumpMeasuredPower) ?? num(c.genLoadKw), 1)],
            ["Main volume, m³", mv2.total !== null ? mv2.total.toFixed(3) : "—"],
            ["Pressure rise, Bar", fmt((num(c.pumpP2) ?? 0) - (num(c.pumpP1) ?? 0), 1)],
            ["Pump-up time, s", fmt(c.pumpTimeSec, 1)],
            ["Air Delivery, m³/min", fmt(c.pumpActualFadM3Min, 3)],
          ];
      y = designVsMeasuredTable(doc, y, designCol, measuredCol, [
        ["Design CFM", fmt(p.designCfm, 0), "CFM", fmt(p.actualCfm, 1)],
        ["Design kW/CFM", fmt(p.designSec, 3), "Actual kW/CFM", fmt(p.actualSec, 3)],
        ["Design CFM/kW", fmt(p.designAirGen, 2), "Actual CFM/kW", fmt(p.actualAirGen, 2)],
      ]);

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
