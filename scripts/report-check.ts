/**
 * Builds the PDF from realistic data so the layout can be read before it goes
 * to a plant. The screw-compressor figures are the ones on the reference sheet
 * (45 kW, 6.5 bar running, 47.8 kW measured, five suction points), so the
 * printed table can be held against it line by line.
 *
 *   npx tsx scripts/report-check.ts [outDir]
 */
import fs from "node:fs";
import * as XLSX from "xlsx";
import path from "node:path";
import { generateCompressorPDF } from "../lib/pdf-generator";
import { buildCompressorWorkbook } from "../lib/compressor-excel";
import { mainVolume, pumpUpFad } from "../lib/compressor-calc";
import type { CompanyProfile, CompressorEntry } from "../lib/store";

const outDir = process.argv[2] ?? ".";
const stamp = "2026-09-23T06:00:00.000Z";

const profile: CompanyProfile = {
  id: "cmp-1",
  companyName: "Shree Mahadev Silk Mills Pvt. Ltd.",
  area: "Unit-2 Process House",
  district: "Surat",
  state: "Gujarat",
  pincode: "394210",
  overallConsumption: 186000,
  updatedAt: stamp,
};

const base = {
  companyProfileId: profile.id,
  createdAt: stamp,
  updatedAt: stamp,
  createdById: "Rishabh",
  recordedBy: "Rishabh",
  annualOperatingDays: 300,
  powerCost: 8.2,
} as const;

// ── 1. Screw compressor, anemometer (free air delivery) test ────────────────
const velocities = [11.0, 11.5, 14.9, 13.0, 12.7];
const avgV = velocities.reduce((s, v) => s + v, 0) / velocities.length;
const suctionArea = 0.0123;
const m3s = suctionArea * avgV;
const m3hr = m3s * 3600;
const cfm = m3hr / 1.699;

const screw: CompressorEntry = {
  ...base,
  id: "c-screw-1",
  machineTag: "AC-01 (Screw)",
  makeModel: "Elgi EG45",
  serialNo: "EG45-2210",
  compressorType: "Screw",
  yearOfManufacture: "2019",
  ratedCapacity: 8.693,
  ratedCapacityUnit: "m3/min",
  ratedPressure: 13,
  processPressure: 6.5,
  ratedKw: 45,
  ratedHp: 60,
  ratedRpm: 2950,
  ratedCurrent: 82,
  motorEfficiency: 94,
  starterType: "SD",
  genLoadVoltage: 415,
  genLoadAmp: 78,
  genLoadPf: 0.86,
  genLoadKw: 47.8,
  genUnloadVoltage: 415,
  genUnloadAmp: 26,
  genUnloadPf: 0.42,
  genUnloadKw: 7.8,
  fadActive: true,
  fadAreaType: "Circle",
  fadAreaDia: 0.125,
  fadNumPoints: velocities.length,
  fadVelocities: JSON.stringify(velocities),
  fadRunningPressure: 6.5,
  fadMeasuredPower: 47.8,
  fadSuctionArea: suctionArea,
  fadAvgVelocity: avgV,
  fadAirDeliveryM3Sec: m3s,
  fadAirDeliveryM3Hr: m3hr,
  fadAirDeliveryCfm: cfm,
  fadDescription: "Traverse taken at the filter inlet with a vane anemometer, machine on load.",
  luType: "SD",
  luData: JSON.stringify({
    date: ["2026-09-18", "2026-09-19", "2026-09-20"],
    time: ["09:00", "09:00", "09:00"],
    loadHours: ["12450.0", "12462.5", "12474.9"],
    unloadHours: ["3320.0", "3325.5", "3331.2"],
    totalRunHours: ["15770.0", "15788.0", "15806.1"],
  }),
  obsCompDischarge: 78,
  obsCompMotor: 64,
  obsAirRadiatorOut: 41,
  obsThermalImageNo: "IR-0417",
  description: "Air filter differential rising; due for replacement at the next service.",
};

// ── 2. Reciprocating compressor, receiver pump-up test with pipe volumes ────
const pumpLaps = [0, 1, 2, 3, 4, 5, 5.5, 6, 6.5].map((pressure, i) => ({
  pressure,
  timeSec: i === 0 ? 0 : Number((i * 14.6 + i * i * 0.9).toFixed(1)),
  fadM3Min: 0,
  fadCorrM3Min: 0,
  kwh: (1042.5 + i * 0.09).toFixed(2),
}));

const recipBase: CompressorEntry = {
  ...base,
  id: "c-recip-1",
  machineTag: "AC-02 (Recip)",
  makeModel: "Ingersoll Rand 7100",
  serialNo: "IR-7100-884",
  compressorType: "Reciprocating",
  yearOfManufacture: "2014",
  ratedCapacity: 3.4,
  ratedCapacityUnit: "m3/min",
  ratedPressure: 12,
  processPressure: 7,
  ratedKw: 22,
  ratedHp: 30,
  ratedRpm: 1450,
  ratedCurrent: 42,
  motorEfficiency: 91,
  starterType: "DOL",
  genLoadVoltage: 412,
  genLoadAmp: 41,
  genLoadPf: 0.82,
  genLoadKw: 24.0,
  pumpActive: true,
  pumpP1: 0,
  pumpP2: 6.5,
  pumpTimeSec: 186.4,
  pumpAirTempC: 38,
  pumpTempFactor: 273 / (273 + 38),
  pumpLapData: JSON.stringify(pumpLaps),
  pumpTankVolume: 1000,
  pumpTankVolumeUnit: "Liters",
  pumpTankCalcMethod: "PeriLength",
  pumpTankPeri: 3770,
  pumpTankLength: 2500,
  // the pipe either side of the receiver, measured with a tape
  pumpInletPipeActive: true,
  pumpInletPipePeri: 250,
  pumpInletPipeLength: 6000,
  pumpOutletPipeActive: true,
  pumpOutletPipePeri: 315,
  pumpOutletPipeLength: 14000,
  loadPressure: 6.0,
  unloadPressure: 6.5,
  pumpRunningPressure: 6.2,
  pumpMeasuredPower: 24.0,
  pumpDescription: "Receiver isolated from the header; pump-up timed from atmospheric.",
  obsCompDischarge: 96,
  obsCompMotor: 71,
};

const mv = mainVolume(recipBase);
const fad = pumpUpFad(mv.total, recipBase.pumpP1, recipBase.pumpP2, recipBase.pumpTimeSec, recipBase.pumpAirTempC);
const recip: CompressorEntry = {
  ...recipBase,
  pumpMainVolumeM3: mv.total,
  pumpActualFadM3Min: fad.corrM3Min,
  pumpActualFadCfm: fad.corrCfm,
};

const compressors = [screw, recip];

const pdf = generateCompressorPDF(profile, compressors, "Rishabh");
const pdfPath = path.join(outDir, "ACMP_report_check.pdf");
fs.writeFileSync(pdfPath, Buffer.from(pdf));

const wb = buildCompressorWorkbook(profile, compressors, "Rishabh");
const xlsxPath = path.join(outDir, "ACMP_workbook_check.xlsx");
XLSX.writeFile(wb, xlsxPath);

console.log(`PDF    ${pdfPath}  (${(pdf.byteLength / 1024).toFixed(1)} kB)`);
console.log(`XLSX   ${xlsxPath}`);
console.log("");
console.log("Screw (anemometer):");
console.log(`  avg velocity ${avgV.toFixed(2)} m/s · area ${suctionArea} m² · ${m3s.toFixed(3)} m³/s · ${m3hr.toFixed(1)} m³/hr · ${cfm.toFixed(1)} CFM`);
console.log(`  design CFM ${(8.693 * 35.3147).toFixed(1)} · design kW/CFM ${(45 / (8.693 * 35.3147)).toFixed(3)} · actual kW/CFM ${(47.8 / cfm).toFixed(3)} · actual CFM/kW ${(cfm / 47.8).toFixed(2)}`);
console.log("");
console.log("Recip (pump-up):");
console.log(`  tank ${mv.tank?.toFixed(3)} + inlet ${mv.inlet?.toFixed(4)} + outlet ${mv.outlet?.toFixed(4)} = main ${mv.total?.toFixed(3)} m³`);
console.log(`  FAD ${fad.m3min?.toFixed(3)} m³/min → corrected ${fad.corrM3Min?.toFixed(3)} m³/min = ${fad.corrCfm?.toFixed(1)} CFM (factor ${fad.tempFactor?.toFixed(4)})`);
console.log(`  without the pipes the same test would read ${(((mv.tank ?? 0) * 6.5) / ((186.4 / 60) * 1.013) * (fad.tempFactor ?? 1) * 35.3147).toFixed(1)} CFM`);
