/* Builds the workbook A-CMP's own export writes, from a realistic plant,
   and drops it where PostMan's importer can be pointed at it. The point of
   this script is that it uses the app's real code, so the check is of the
   contract and not of a fixture somebody hand-wrote to match. */
import fs from "node:fs";
import * as ACMP from "../lib/compressor-excel";
import type { CompanyProfile, CompressorEntry } from "../lib/store";

const profile = {
  id: "p1",
  companyName: "Shree Mahadev Silk Mills Pvt. Ltd.",
  area: "GIDC Pandesara", district: "Surat", state: "Gujarat", pincode: "395023",
  overallConsumption: 1850000,
} as unknown as CompanyProfile;

const base = {
  companyProfileId: "p1", ratedCapacityUnit: "CFM", starterType: "DOL",
  annualOperatingDays: 330, powerCost: 8.62, recordedBy: "R. Patel",
} as Partial<CompressorEntry>;

const compressors = [
  { ...base, id:"c1", machineTag:"AC-01", makeModel:"Elgi EG55", serialNo:"EG55-2291",
    compressorType:"Screw", yearOfManufacture:"2018", ratedCapacity:212, ratedPressure:7.5,
    ratedKw:55, ratedHp:75, motorEfficiency:93, designedSec:0.1240, designedAirGen:8.06,
    genLoadVoltage:415, genLoadAmp:78, genLoadPf:0.89, genLoadKw:49.9,
    genUnloadVoltage:415, genUnloadAmp:22, genUnloadPf:0.72, genUnloadKw:11.4,
    fadTestType:"FAD", fadSuctionArea:0.0412, fadAirVelocity:24.1,
    fadAirDeliveryCfm:198.23, fadActualSec:0.1452, fadActualAirGen:6.89,
    obsThermalImageNo:"IR-114", obsCompDischarge:88.6,
    description:"Aftercooler fins choked with lint.",
  },
  { ...base, id:"c2", machineTag:"AC-02", makeModel:"Ingersoll Rand R45", serialNo:"IR45-7740",
    compressorType:"Screw", yearOfManufacture:"2015", ratedCapacity:180, ratedPressure:7.0,
    ratedKw:45, ratedHp:60, motorEfficiency:91, designedSec:0.1310, designedAirGen:7.63,
    genLoadVoltage:412, genLoadAmp:64, genLoadPf:0.88, genLoadKw:40.2,
    genUnloadVoltage:412, genUnloadAmp:19, genUnloadPf:0.70, genUnloadKw:9.6,
    fadTestType:"PumpUp", pumpTankVolume:2000, pumpTankVolumeUnit:"litre",
    pumpInitialPressure:0, pumpFinalPressure:7, pumpTimeTaken:96, pumpAirTemp:41,
    pumpActualFadCfm:170.45, fadActualSec:0.1672,
    obsThermalImageNo:"IR-115", obsCompDischarge:94.2,
    description:"Loaded well under half the running hours.",
  },
] as unknown as CompressorEntry[];

const { base64, filename } = ACMP.buildExcelBase64(profile, compressors, "R. Patel");
fs.mkdirSync("/home/claude/apps/_bridge", { recursive: true });
fs.writeFileSync("/home/claude/apps/_bridge/acmp-from-app.xlsx", Buffer.from(base64, "base64"));
console.log(`format ${ACMP.ACMP_FORMAT} -> ${filename}  (${Math.round(base64.length * 0.75 / 1024)} KB)`);
