import * as XLSX from "xlsx";
import { Capacitor } from "@capacitor/core";
import type { CompanyProfile, CompressorEntry } from "@/lib/store";
import { mainVolume } from "@/lib/compressor-calc";

// The Capacitor plugins are imported lazily so this module can also run on
// the server, where the email route attaches the same workbook.

// ─────────────────────────────────────────────────────────────────────────────
// A-CMP team-exchange workbook
//
// Two sheets:
//   "Company Profile"    Field / Value pairs (PostMan reads "Company Name" to
//                        check the file belongs to the report's plant)
//   "Compressor Entries" one row per compressor, columns = the record's own
//                        field names, so a file round-trips losslessly between
//                        team members AND drops straight into PostMan's
//                        importACmp (docs/POSTMAN.md).
//
// Keep this list, docs/POSTMAN.md and PostMan's importACmp in step.
// ─────────────────────────────────────────────────────────────────────────────

export const ACMP_FORMAT = "A-CMP v1";
export const SHEET_PROFILE = "Company Profile";
export const SHEET_ENTRIES = "Compressor Entries";

export const COMPRESSOR_FIELDS = [
  "id", "machineTag", "makeModel", "serialNo", "compressorType", "yearOfManufacture",
  "ratedCapacity", "ratedCapacityUnit", "ratedPressure", "processPressure",
  "ratedKw", "ratedHp", "ratedRpm", "ratedCurrent", "motorEfficiency",
  "annualOperatingDays", "powerCost", "starterType", "designedSec", "designedAirGen",
  "v1", "v2", "v3", "i1", "i2", "i3", "pf", "measuredKw", "kva", "kvar", "loadFactor",
  "genLoadVoltage", "genLoadAmp", "genLoadPf", "genLoadKw",
  "genUnloadVoltage", "genUnloadAmp", "genUnloadPf", "genUnloadKw",
  "fadActive", "fadAreaType", "fadAreaL", "fadAreaB", "fadAreaDia", "fadAreaPeri", "fadAreaRadius", "fadAreaDirect",
  "fadNumPoints", "fadVelocities", "fadRunningPressure", "fadMeasuredPower", "fadSuctionArea", "fadAvgVelocity",
  "fadAirDeliveryM3Sec", "fadAirDeliveryM3Hr", "fadAirDeliveryCfm", "fadActualSec", "fadActualAirGen", "fadDescription",
  "luType", "luData", "loadPressure", "unloadPressure",
  "pumpActive", "pumpP1", "pumpP2", "pumpTimeSec", "pumpAirTempC", "pumpTempFactor", "pumpLapData",
  "pumpTankVolume", "pumpTankVolumeUnit", "pumpTankCalcMethod", "pumpTankDia", "pumpTankLength", "pumpTankPeri",
  "pumpInletPipeActive", "pumpInletPipePeri", "pumpInletPipeLength",
  "pumpOutletPipeActive", "pumpOutletPipePeri", "pumpOutletPipeLength", "pumpMainVolumeM3",
  "pumpActualFadM3Min", "pumpActualFadCfm", "pumpRunningPressure", "pumpMeasuredPower", "pumpDescription",
  "fad", "operatingPressure", "inletTemp", "outletTemp", "specificPower", "operatingHours", "receiverTankPressure", "noLoadCurrent",
  "photoPath", "description", "recordedBy",
  "obsCompSituation", "obsCompDischarge", "obsOilSap", "obsOilRadiatorIn", "obsOilRadiatorOut",
  "obsAirRadiatorIn", "obsAirRadiatorOut", "obsCompFinalDischarge", "obsCompMotor", "obsThermalImageNo",
  "createdAt", "updatedAt", "createdById",
] as const;

// Columns PostMan needs that are not stored as-is on the record. They are
// written after the record fields and ignored when a file is imported back.
export const DERIVED_FIELDS = [
  "pumpTankVolumeM3", "pumpInletPipeVolumeM3", "pumpOutletPipeVolumeM3", "pumpMainVolumeM3Calc",
  "luLoadHours", "luUnloadHours", "luTotalHours",
] as const;

const STRING_FIELDS = new Set<string>([
  "id", "machineTag", "makeModel", "serialNo", "compressorType", "yearOfManufacture", "ratedCapacityUnit",
  "starterType", "fadAreaType", "fadVelocities", "fadDescription", "luType", "luData", "pumpLapData",
  "pumpTankVolumeUnit", "pumpTankCalcMethod", "pumpDescription", "photoPath", "description", "recordedBy",
  "obsThermalImageNo", "createdAt", "updatedAt", "createdById",
]);
const BOOL_FIELDS = new Set<string>(["fadActive", "pumpActive", "pumpInletPipeActive", "pumpOutletPipeActive"]);

const PROFILE_ROWS: [string, keyof CompanyProfile][] = [
  ["Company Name", "companyName"],
  ["Area / Zone", "area"],
  ["District", "district"],
  ["State", "state"],
  ["Pincode", "pincode"],
  ["Overall Consumption (kWh/Month)", "overallConsumption"],
];

// ── Derived figures ─────────────────────────────────────────────────────────

export { tankVolumeM3, mainVolume, pipeVolumeM3 } from "@/lib/compressor-calc";

/** Load / unload / total run hours from the 3-reading table: last reading − first reading. */
export function luHours(c: CompressorEntry): { load: number | null; unload: number | null; total: number | null } {
  const out = { load: null as number | null, unload: null as number | null, total: null as number | null };
  if (!c.luData) return out;
  let rows: any;
  try { rows = JSON.parse(c.luData); } catch { return out; }
  const diff = (key: string) => {
    const arr: string[] = Array.isArray(rows?.[key]) ? rows[key] : [];
    const nums = arr.map((x) => parseFloat(x)).filter((n) => isFinite(n));
    if (nums.length < 2) return null;
    const d = nums[nums.length - 1] - nums[0];
    return d > 0 ? d : null;
  };
  out.load = diff("loadHours");
  out.unload = diff("unloadHours");
  out.total = diff("totalRunHours");
  return out;
}

// ── Export ──────────────────────────────────────────────────────────────────

export function buildCompressorWorkbook(
  profile: CompanyProfile | null,
  compressors: CompressorEntry[],
  reporterName?: string | null
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  const profileRows: (string | number)[][] = [["Field", "Value"]];
  for (const [label, key] of PROFILE_ROWS) profileRows.push([label, (profile?.[key] as string | number) ?? ""]);
  profileRows.push(["Exported By", reporterName || ""]);
  profileRows.push(["Export Date", new Date().toLocaleString("en-IN")]);
  profileRows.push(["Format", ACMP_FORMAT]);
  const profSheet = XLSX.utils.aoa_to_sheet(profileRows);
  profSheet["!cols"] = [{ wch: 34 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, profSheet, SHEET_PROFILE);

  const rows = compressors.map((c) => {
    const row: Record<string, string | number | boolean> = {};
    for (const f of COMPRESSOR_FIELDS) {
      const v = (c as any)[f];
      row[f] = v === null || v === undefined ? "" : v;
    }
    const hrs = luHours(c);
    const mv = mainVolume(c);
    row.pumpTankVolumeM3 = mv.tank ?? "";
    row.pumpInletPipeVolumeM3 = mv.inlet ?? "";
    row.pumpOutletPipeVolumeM3 = mv.outlet ?? "";
    // The volume the pump-up FAD is actually worked from: tank + whichever pipes were measured.
    row.pumpMainVolumeM3Calc = mv.total ?? "";
    row.luLoadHours = hrs.load ?? "";
    row.luUnloadHours = hrs.unload ?? "";
    row.luTotalHours = hrs.total ?? "";
    return row;
  });
  const entrySheet = XLSX.utils.json_to_sheet(rows, { header: [...COMPRESSOR_FIELDS, ...DERIVED_FIELDS] });
  entrySheet["!cols"] = [...COMPRESSOR_FIELDS, ...DERIVED_FIELDS].map((f) => ({ wch: Math.max(12, Math.min(28, f.length + 2)) }));
  XLSX.utils.book_append_sheet(wb, entrySheet, SHEET_ENTRIES);

  return wb;
}

export function getExcelFilename(profile: CompanyProfile | null, reporterName?: string | null): string {
  const today = new Date();
  const ddmm = `${String(today.getDate()).padStart(2, "0")}${String(today.getMonth() + 1).padStart(2, "0")}`;
  const company = profile?.companyName ? profile.companyName.replace(/[^\w]+/g, "_").replace(/^_|_$/g, "") : "Plant";
  const who = reporterName ? `_${reporterName.replace(/[^\w]+/g, "_").replace(/^_|_$/g, "")}` : "";
  return `A-CMP_${company}${who}_${ddmm}.xlsx`;
}

export function buildExcelBase64(
  profile: CompanyProfile | null,
  compressors: CompressorEntry[],
  reporterName?: string | null
): { base64: string; filename: string } {
  const wb = buildCompressorWorkbook(profile, compressors, reporterName);
  return { base64: XLSX.write(wb, { type: "base64", bookType: "xlsx" }), filename: getExcelFilename(profile, reporterName) };
}

/**
 * Android: writes the file to Documents (falls back to Cache) and returns its
 *          URI so the caller can hand it to the share sheet.
 * Web:     triggers a browser download and returns the file name.
 */
export async function exportCompressorsExcel(
  profile: CompanyProfile | null,
  compressors: CompressorEntry[],
  reporterName?: string | null
): Promise<string | null> {
  const wb = buildCompressorWorkbook(profile, compressors, reporterName);
  const filename = getExcelFilename(profile, reporterName);

  if (Capacitor.isNativePlatform()) {
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    const base64 = XLSX.write(wb, { type: "base64", bookType: "xlsx" });
    for (const dir of [Directory.Documents, Directory.Cache]) {
      try {
        const result = await Filesystem.writeFile({ path: filename, data: base64, directory: dir, recursive: true });
        return result.uri;
      } catch (e) {
        console.warn(`[excel] write to ${dir} failed, trying next:`, e);
      }
    }
    return null;
  }
  XLSX.writeFile(wb, filename);
  return filename;
}

/** Opens the native share sheet (WhatsApp, Drive, mail…) with the exported file. Android only. */
export async function shareCompressorsExcel(
  profile: CompanyProfile | null,
  compressors: CompressorEntry[],
  reporterName?: string | null
): Promise<boolean> {
  const uri = await exportCompressorsExcel(profile, compressors, reporterName);
  if (!uri || !Capacitor.isNativePlatform()) return false;
  const { Share } = await import("@capacitor/share");
  await Share.share({
    title: `A-CMP data — ${profile?.companyName || "Plant"}`,
    text: `Compressor audit data for ${profile?.companyName || "the plant"} (${compressors.length} compressor${compressors.length === 1 ? "" : "s"}). Import it in A-CMP to merge, or drop it into PostMan.`,
    url: uri,
    dialogTitle: "Share compressor data",
  });
  return true;
}

// ── Import & merge ──────────────────────────────────────────────────────────

export type MergeSummary = {
  added: number;
  updated: number;
  skippedOlder: number;
  profileFieldsFilled: number;
};

const normKey = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

function findSheet(wb: XLSX.WorkBook, name: string): XLSX.WorkSheet | null {
  const want = normKey(name);
  const hit = wb.SheetNames.find((n) => normKey(n) === want);
  return hit ? wb.Sheets[hit] : null;
}

export function isCompressorWorkbook(wb: XLSX.WorkBook): boolean {
  const sh = findSheet(wb, SHEET_ENTRIES);
  if (!sh) return false;
  const head = (XLSX.utils.sheet_to_json<any[]>(sh, { header: 1 })[0] || []).map(normKey);
  return head.includes("machinetag");
}

function parseEntryRow(row: Record<string, any>): CompressorEntry | null {
  const tag = row.machineTag === undefined || row.machineTag === null ? "" : String(row.machineTag).trim();
  if (!tag) return null;

  const e: any = {};
  for (const f of COMPRESSOR_FIELDS) {
    const v = row[f];
    const empty = v === undefined || v === null || v === "";
    if (BOOL_FIELDS.has(f)) {
      e[f] = empty ? false : /^(true|1|yes|y)$/i.test(String(v).trim());
    } else if (STRING_FIELDS.has(f)) {
      e[f] = empty ? null : String(v).trim();
    } else {
      const n = empty ? null : Number(v);
      e[f] = n !== null && isFinite(n) ? n : null;
    }
  }
  e.machineTag = tag;
  if (!e.id) e.id = crypto.randomUUID();
  if (!e.createdAt) e.createdAt = new Date().toISOString();
  if (!e.createdById) e.createdById = "local-user";
  if (!e.starterType) e.starterType = "DOL";
  if (!e.compressorType) e.compressorType = "Screw";
  if (e.ratedKw === null) e.ratedKw = 0;
  return e as CompressorEntry;
}

const stamp = (c: CompressorEntry) => Date.parse(c.updatedAt || c.createdAt || "") || 0;

/**
 * Merges a workbook exported by a team member into the current data.
 * - Compressors are keyed by machine tag; when both sides have the same tag,
 *   the copy saved most recently wins, so re-importing is always safe.
 * - Company fields only fill gaps — the importer's own values stay.
 */
export function mergeCompressorsFromWorkbook(
  wb: XLSX.WorkBook,
  currentProfile: CompanyProfile | null,
  currentCompressors: CompressorEntry[]
): { profile: CompanyProfile | null; compressors: CompressorEntry[]; summary: MergeSummary } {
  if (!isCompressorWorkbook(wb)) {
    throw new Error(`Not an A-CMP data file — no "${SHEET_ENTRIES}" sheet with a machineTag column (sheets: ${wb.SheetNames.join(", ")}).`);
  }
  const summary: MergeSummary = { added: 0, updated: 0, skippedOlder: 0, profileFieldsFilled: 0 };

  // 1. Company profile — fill only missing fields
  let profile = currentProfile ? { ...currentProfile } : null;
  const profSheet = findSheet(wb, SHEET_PROFILE);
  if (profSheet) {
    const imported: Record<string, any> = {};
    for (const r of XLSX.utils.sheet_to_json<any[]>(profSheet, { header: 1 }).slice(1)) {
      if (r && r[0] !== undefined && r[1] !== undefined && r[1] !== "") imported[normKey(r[0])] = r[1];
    }
    const theirName = imported[normKey("Company Name")];
    if (!profile && theirName) {
      profile = { id: crypto.randomUUID(), companyName: "", area: "", district: "", state: "", pincode: "", overallConsumption: "", updatedAt: new Date().toISOString() };
    }
    if (profile) {
      for (const [label, key] of PROFILE_ROWS) {
        const cur = profile[key];
        const inc = imported[normKey(label)];
        if ((cur === "" || cur === null || cur === undefined) && inc !== undefined && inc !== "") {
          (profile as any)[key] = key === "overallConsumption" ? inc : String(inc);
          summary.profileFieldsFilled++;
        }
      }
      profile.updatedAt = new Date().toISOString();
    }
  }

  // 2. Compressors — merge by machine tag, newest save wins
  const merged = [...currentCompressors];
  const byTag = new Map<string, number>();
  merged.forEach((c, i) => byTag.set(normKey(c.machineTag), i));

  const sheet = findSheet(wb, SHEET_ENTRIES)!;
  for (const row of XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "" })) {
    const entry = parseEntryRow(row);
    if (!entry) continue;
    const key = normKey(entry.machineTag);
    const idx = byTag.get(key);
    if (idx === undefined) {
      merged.push(entry);
      byTag.set(key, merged.length - 1);
      summary.added++;
    } else if (stamp(entry) > stamp(merged[idx])) {
      merged[idx] = { ...entry, id: merged[idx].id };
      summary.updated++;
    } else {
      summary.skippedOlder++;
    }
  }

  return { profile, compressors: merged, summary };
}

export function readWorkbookFile(file: File): Promise<XLSX.WorkBook> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        resolve(XLSX.read(e.target?.result, { type: "array" }));
      } catch {
        reject(new Error("That file is not a readable workbook."));
      }
    };
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsArrayBuffer(file);
  });
}
