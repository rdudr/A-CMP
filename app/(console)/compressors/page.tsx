"use client";

import React, { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAppStore, CompressorEntry } from "@/lib/store";
import { useAuthStore } from "@/lib/auth-store";
import { Camera, Image as ImageIcon, Check, Info, AlertTriangle, Play, HelpCircle } from "lucide-react";
import { capturePhotoFromDevice, savePhotoLocally, getFormattedDate, sanitizeName } from "@/lib/photo-capture";

// Load / Unload measurement table: 3 reading columns (Val1, Val2, Val3) per parameter row
const emptyLuRows = () => ({
  date: ["", "", ""],
  time: ["", "", ""],
  loadHours: ["", "", ""],
  unloadHours: ["", "", ""],
  totalRunHours: ["", "", ""],
  band020: ["", "", ""],
  band2040: ["", "", ""],
  band4060: ["", "", ""],
  band6080: ["", "", ""],
  band80100: ["", "", ""],
});
type LuRows = ReturnType<typeof emptyLuRows>;
type LuRowKey = keyof LuRows;

export default function CompressorsPage() {
  const [form, setForm] = useState({
    machineTag: "",
    makeModel: "",
    serialNo: "",
    compressorType: "Screw",
    yearOfManufacture: "",
    ratedCapacity: "",
    ratedCapacityUnit: "m3/min", // m3/min, l/s, CFM, CMH
    ratedPressure: "",
    processPressure: "",
    ratedKw: "",
    ratedHp: "",
    ratedRpm: "",
    ratedCurrent: "",
    motorEfficiency: "",
    annualOperatingDays: "",
    powerCost: "",
    starterType: "DOL",

    // Electrical parameters (general)
    genLoadVoltage: "", genLoadAmp: "", genLoadPf: "", genLoadKw: "",
    genUnloadVoltage: "", genUnloadAmp: "", genUnloadPf: "", genUnloadKw: "",

    // FAD Test parameters
    fadActive: false,
    fadAreaType: "Rectangle", // Rectangle, Circle, Direct
    fadAreaL: "",
    fadAreaB: "",
    fadAreaDia: "",
    fadAreaPeri: "",
    fadAreaRadius: "",
    fadAreaDirect: "",
    fadNumPoints: "5",
    fadRunningPressure: "",
    fadMeasuredPower: "",
    fadDescription: "",

    // Pump Up Test parameters
    pumpActive: false,
    pumpP1: "",
    pumpP2: "",
    pumpTimeSec: "",
    pumpTankVolume: "",
    pumpTankVolumeUnit: "Liters", // Liters, m3
    pumpTankCalcMethod: "Direct", // Direct, DiaLength, PeriLength
    pumpTankDia: "",
    pumpTankLength: "",
    pumpTankPeri: "",
    pumpAirTempC: "",
    pumpRunningPressure: "",
    pumpMeasuredPower: "",
    pumpDescription: "",
    // Load / Unload pressures (required when a test is ticked; one decimal)
    loadPressure: "",
    unloadPressure: "",

    // General
    description: "",
    obsCompSituation: "",
    obsCompDischarge: "",
    obsOilSap: "",
    obsOilRadiatorIn: "",
    obsOilRadiatorOut: "",
    obsAirRadiatorIn: "",
    obsAirRadiatorOut: "",
    obsCompFinalDischarge: "",
    obsCompMotor: "",
    obsThermalImageNo: "",
  });

  const [velocities, setVelocities] = useState<string[]>(Array(5).fill(""));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [existingPhotoPath, setExistingPhotoPath] = useState<string | null>(null);

  const [showVolumeHelper, setShowVolumeHelper] = useState(false);
  const [notesActive, setNotesActive] = useState(false);

  // Load / Unload measurement table (rated parameters)
  const [luType, setLuType] = useState<"SD" | "VFD">("SD");
  const [luRows, setLuRows] = useState<LuRows>(emptyLuRows());

  // Pump-Up stopwatch state
  const [swRunning, setSwRunning] = useState(false);
  const [swElapsed, setSwElapsed] = useState(0); // seconds
  const [lapTimes, setLapTimes] = useState<(number | null)[]>([]);
  const [lapKwh, setLapKwh] = useState<string[]>([]);

  const profile = useAppStore((state) => state.profile);
  const compressors = useAppStore((state) => state.compressors);
  const addCompressor = useAppStore((state) => state.addCompressor);
  const updateCompressor = useAppStore((state) => state.updateCompressor);
  const deleteCompressor = useAppStore((state) => state.deleteCompressor);

  // Dynamic point array generator for FAD velocity grid
  useEffect(() => {
    const num = parseInt(form.fadNumPoints) || 0;
    if (num >= 1 && num <= 50) {
      setVelocities((prev) => {
        const next = [...prev];
        if (next.length < num) {
          return [...next, ...Array(num - next.length).fill("")];
        } else if (next.length > num) {
          return next.slice(0, num);
        }
        return next;
      });
    }
  }, [form.fadNumPoints]);

  // Bi-directional Power conversion
  const handleKwChange = (val: string) => {
    const kwVal = parseFloat(val);
    setForm((prev) => ({
      ...prev,
      ratedKw: val,
      ratedHp: !isNaN(kwVal) && val !== "" ? (kwVal / 0.7457).toFixed(2) : "",
    }));
  };

  const handleHpChange = (val: string) => {
    const hpVal = parseFloat(val);
    setForm((prev) => ({
      ...prev,
      ratedHp: val,
      ratedKw: !isNaN(hpVal) && val !== "" ? (hpVal * 0.7457).toFixed(2) : "",
    }));
  };

  // Capacity conversions (Base unit: m3/min)
  const getCapacityInM3Min = (valueStr: string, unit: string): number => {
    const val = parseFloat(valueStr);
    if (isNaN(val) || val <= 0) return 0;
    switch (unit) {
      case "m3/min": return val;
      case "CFM": return val / 35.3147;
      case "l/s": return val * 0.06; // 1 l/s = 0.06 m3/min
      case "CMH": return val / 60; // 1 m3/hr = 1/60 m3/min
      default: return val;
    }
  };

  const ratedCapVal = parseFloat(form.ratedCapacity) || 0;
  const ratedM3Min = getCapacityInM3Min(form.ratedCapacity, form.ratedCapacityUnit);
  const ratedCfmEquivalent = ratedM3Min * 35.3147;
  const ratedLsEquivalent = ratedM3Min / 0.06;
  const ratedCmhEquivalent = ratedM3Min * 60;

  // Design Benchmarks
  const ratedKwVal = parseFloat(form.ratedKw) || 0;
  const designedSec = ratedKwVal > 0 && ratedCfmEquivalent > 0 ? ratedKwVal / ratedCfmEquivalent : 0;
  const designedAirGen = ratedKwVal > 0 && ratedCfmEquivalent > 0 ? ratedCfmEquivalent / ratedKwVal : 0;

  // General Electrical parameter averages (Load)
  const genLoadVoltage = parseFloat(form.genLoadVoltage) || 0;
  const genLoadAmp = parseFloat(form.genLoadAmp) || 0;
  const genLoadPf = parseFloat(form.genLoadPf) || 0;
  const genLoadKw = parseFloat(form.genLoadKw) || 0;

  const calculatedKva = genLoadVoltage > 0 && genLoadAmp > 0 ? (1.732 * genLoadVoltage * genLoadAmp) / 1000 : 0;
  const calculatedKvar = calculatedKva > 0 && genLoadPf > 0 && genLoadPf <= 1 ? calculatedKva * Math.sqrt(1 - genLoadPf * genLoadPf) : 0;
  
  const motorEfficiencyVal = parseFloat(form.motorEfficiency) || 0;
  const fullLoadInputKw = motorEfficiencyVal > 0 ? (ratedKwVal / (motorEfficiencyVal / 100)) : ratedKwVal;
  const calculatedLoadFactor = fullLoadInputKw > 0 ? (genLoadKw / fullLoadInputKw) * 100 : 0;

  // FAD Anemometer solver
  const computeFadSuctionArea = (): number => {
    switch (form.fadAreaType) {
      case "Rectangle": {
        const l = (parseFloat(form.fadAreaL) || 0) / 1000; // Convert mm to m
        const b = (parseFloat(form.fadAreaB) || 0) / 1000; // Convert mm to m
        return l * b;
      }
      case "Circle": {
        if (form.fadAreaDia) {
          const d = parseFloat(form.fadAreaDia) || 0;
          return Math.PI * Math.pow(d / 2, 2);
        } else if (form.fadAreaRadius) {
          const r = parseFloat(form.fadAreaRadius) || 0;
          return Math.PI * Math.pow(r, 2);
        } else if (form.fadAreaPeri) {
          const p = parseFloat(form.fadAreaPeri) || 0;
          return Math.pow(p, 2) / (4 * Math.PI);
        }
        return 0;
      }
      case "Direct":
        return parseFloat(form.fadAreaDirect) || 0;
      default:
        return 0;
    }
  };

  const fadSuctionArea = computeFadSuctionArea();
  const numericVelocities = velocities.map(v => parseFloat(v)).filter(v => !isNaN(v));
  const fadAvgVelocity = numericVelocities.length > 0
    ? numericVelocities.reduce((a, b) => a + b, 0) / numericVelocities.length
    : 0;

  const fadAirDeliveryM3Sec = fadSuctionArea * fadAvgVelocity;
  const fadAirDeliveryM3Hr = fadAirDeliveryM3Sec * 3600;
  const fadAirDeliveryCfm = fadAirDeliveryM3Sec * 2118.88;
  const fadAirDeliveryM3Min = fadAirDeliveryM3Sec * 60;

  const fadMeasuredPowerVal = genLoadKw; // Auto-populated from Load kW
  const fadActualSec = fadAirDeliveryCfm > 0 ? fadMeasuredPowerVal / fadAirDeliveryCfm : 0;
  const fadActualAirGen = fadMeasuredPowerVal > 0 ? fadAirDeliveryCfm / fadMeasuredPowerVal : 0;

  // Load / Unload Calculations
  const parseLuCell = (key: LuRowKey, idx: number) => {
    const val = parseFloat(luRows[key][idx]);
    return isNaN(val) ? 0 : val;
  };

  const loadHrsVal1 = parseLuCell("loadHours", 0);
  const loadHrsVal2 = parseLuCell("loadHours", 1);
  const loadHrsVal3 = parseLuCell("loadHours", 2);
  const calcLoadHrs12 = loadHrsVal2 > loadHrsVal1 ? loadHrsVal2 - loadHrsVal1 : 0;
  const calcLoadHrs13 = loadHrsVal3 > loadHrsVal1 ? loadHrsVal3 - loadHrsVal1 : 0;

  const unloadHrsVal1 = parseLuCell("unloadHours", 0);
  const unloadHrsVal2 = parseLuCell("unloadHours", 1);
  const unloadHrsVal3 = parseLuCell("unloadHours", 2);
  const calcUnloadHrs12 = unloadHrsVal2 > unloadHrsVal1 ? unloadHrsVal2 - unloadHrsVal1 : 0;
  const calcUnloadHrs13 = unloadHrsVal3 > unloadHrsVal1 ? unloadHrsVal3 - unloadHrsVal1 : 0;

  const totalHrsVal1 = parseLuCell("totalRunHours", 0);
  const totalHrsVal2 = parseLuCell("totalRunHours", 1);
  const totalHrsVal3 = parseLuCell("totalRunHours", 2);
  const calcTotalHrs12 = totalHrsVal2 > totalHrsVal1 ? totalHrsVal2 - totalHrsVal1 : 0;
  const calcTotalHrs13 = totalHrsVal3 > totalHrsVal1 ? totalHrsVal3 - totalHrsVal1 : 0;

  const percLoad12 = calcTotalHrs12 > 0 ? (calcLoadHrs12 / calcTotalHrs12) * 100 : 0;
  const percLoad13 = calcTotalHrs13 > 0 ? (calcLoadHrs13 / calcTotalHrs13) * 100 : 0;

  const percUnload12 = calcTotalHrs12 > 0 ? (calcUnloadHrs12 / calcTotalHrs12) * 100 : 0;
  const percUnload13 = calcTotalHrs13 > 0 ? (calcUnloadHrs13 / calcTotalHrs13) * 100 : 0;

  const genUnloadKw = parseFloat(form.genUnloadKw) || 0;

  const dailyLoadUnit12 = genLoadKw * calcLoadHrs12;
  const dailyLoadUnit13 = genLoadKw * calcLoadHrs13;

  const dailyUnloadUnit12 = genUnloadKw * calcUnloadHrs12;
  const dailyUnloadUnit13 = genUnloadKw * calcUnloadHrs13;

  const totalDailyConsumption12 = dailyLoadUnit12 + dailyUnloadUnit12;
  const totalDailyConsumption13 = dailyLoadUnit13 + dailyUnloadUnit13;


  // Pump Up Volume solver
  const computePumpTankVolumeM3 = (): number => {
    if (form.pumpTankCalcMethod === "Direct") {
      const vol = parseFloat(form.pumpTankVolume) || 0;
      if (form.pumpTankVolumeUnit === "Liters") return vol / 1000;
      return vol;
    } else if (form.pumpTankCalcMethod === "DiaLength") {
      const d = (parseFloat(form.pumpTankDia) || 0) / 1000;
      const l = (parseFloat(form.pumpTankLength) || 0) / 1000;
      return Math.PI * Math.pow(d / 2, 2) * l;
    } else if (form.pumpTankCalcMethod === "PeriLength") {
      const p = (parseFloat(form.pumpTankPeri) || 0) / 1000;
      const l = (parseFloat(form.pumpTankLength) || 0) / 1000;
      const r = p / (2 * Math.PI);
      return Math.PI * Math.pow(r, 2) * l;
    }
    return 0;
  };

  const pumpTankVolumeM3 = computePumpTankVolumeM3();
  const pumpP1 = parseFloat(form.pumpP1) || 0;
  const pumpP2 = parseFloat(form.pumpP2) || 0;
  const pumpTimeSec = parseFloat(form.pumpTimeSec) || 0;

  const pumpActualFadM3Min = pumpTimeSec > 0
    ? (pumpTankVolumeM3 * (pumpP2 - pumpP1)) / ((pumpTimeSec / 60) * 1.013)
    : 0;
  const pumpActualFadCfm = pumpActualFadM3Min * 35.3147;

  // Dynamic tank volume unit synchronization for dimensions helper
  useEffect(() => {
    if (form.pumpTankCalcMethod !== "Direct" && pumpTankVolumeM3 > 0) {
      setForm(prev => ({
        ...prev,
        pumpTankVolume: (form.pumpTankVolumeUnit === "Liters" ? pumpTankVolumeM3 * 1000 : pumpTankVolumeM3).toFixed(2)
      }));
    }
  }, [form.pumpTankCalcMethod, form.pumpTankDia, form.pumpTankLength, form.pumpTankPeri, form.pumpTankVolumeUnit]);

  // Temperature Correction Factor = 273 / (273 + T)
  const pumpAirTempVal = parseFloat(form.pumpAirTempC);
  const pumpTempFactor = !isNaN(pumpAirTempVal) ? 273 / (273 + pumpAirTempVal) : 0;

  // Pressure rows: 0 → 5 bar in 1.0 steps, then 5.5 → P2 in 0.5 steps
  const pumpPressureRows = React.useMemo(() => {
    const p2 = parseFloat(form.pumpP2) || 0;
    if (p2 <= 0) return [] as number[];
    const rows: number[] = [];
    for (let p = 0; p <= Math.min(5, p2) + 1e-9; p += 1) rows.push(p);
    for (let p = 5.5; p <= p2 + 1e-9; p += 0.5) rows.push(parseFloat(p.toFixed(1)));
    if (Math.abs(rows[rows.length - 1] - p2) > 1e-9) rows.push(p2);
    return rows;
  }, [form.pumpP2]);

  // Keep lap slots in sync with the pressure rows
  useEffect(() => {
    setLapTimes((prev) => pumpPressureRows.map((_, i) => prev[i] ?? null));
    setLapKwh((prev) => pumpPressureRows.map((_, i) => prev[i] ?? ""));
  }, [pumpPressureRows]);

  // Stopwatch ticker
  useEffect(() => {
    if (!swRunning) return;
    const startedAt = Date.now() - swElapsed * 1000;
    const id = setInterval(() => setSwElapsed((Date.now() - startedAt) / 1000), 100);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swRunning]);

  const nextLapIndex = lapTimes.findIndex((t) => t === null);

  function handleLap() {
    if (!swRunning || nextLapIndex === -1) return;
    const stamped = parseFloat(swElapsed.toFixed(1));
    setLapTimes((prev) => {
      const next = [...prev];
      next[nextLapIndex] = stamped;
      return next;
    });
    // Last row filled → stop the watch and feed the total pump-up duration
    if (nextLapIndex === lapTimes.length - 1) {
      setSwRunning(false);
      setForm((prev) => ({ ...prev, pumpTimeSec: stamped.toString() }));
    }
  }

  function handleSwReset() {
    setSwRunning(false);
    setSwElapsed(0);
    setLapTimes(pumpPressureRows.map(() => null));
    setLapKwh(pumpPressureRows.map(() => ""));
  }

  const formatSw = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = (s % 60).toFixed(1).padStart(4, "0");
    return `${m.toString().padStart(2, "0")}:${sec}`;
  };

  // Per-row FAD: V(m³) × ΔP / ((t/60) × 1.013), corrected with the temperature factor
  const pumpLapRows = pumpPressureRows.map((p, i) => {
    const t = lapTimes[i];
    const fad = t && t > 0 && p > 0 && pumpTankVolumeM3 > 0
      ? (pumpTankVolumeM3 * p) / ((t / 60) * 1.013)
      : 0;
    return {
      pressure: p,
      timeSec: t,
      fadM3Min: fad,
      fadCorrM3Min: fad * (pumpTempFactor > 0 ? pumpTempFactor : 1),
      kwh: lapKwh[i] || "",
    };
  });

  // Calculate Power and FAD at Load/Unload
  const idxP2 = pumpPressureRows.findIndex((p) => p === parseFloat(form.pumpP2));
  const idxLoad = pumpPressureRows.findIndex((p) => p === parseFloat(form.loadPressure));
  let pumpPowerAtLoadUnload: number | null = null;
  let pumpFadAtLoadUnloadM3Min: number | null = null;
  
  if (idxP2 !== -1 && idxLoad !== -1 && idxP2 !== idxLoad) {
    const kwhP2 = parseFloat(lapKwh[idxP2]);
    const kwhLoad = parseFloat(lapKwh[idxLoad]);
    const timeP2 = lapTimes[idxP2];
    const timeLoad = lapTimes[idxLoad];
    
    if (timeP2 !== null && timeLoad !== null && timeP2 !== timeLoad) {
      if (!isNaN(kwhP2) && !isNaN(kwhLoad)) {
        pumpPowerAtLoadUnload = ((kwhP2 - kwhLoad) / (timeP2 - timeLoad)) * 3600;
      }
      
      const p2Val = parseFloat(form.pumpP2);
      const loadVal = parseFloat(form.loadPressure);
      if (pumpTankVolumeM3 > 0) {
        pumpFadAtLoadUnloadM3Min = (pumpTankVolumeM3 * (p2Val - loadVal)) / (((timeP2 - timeLoad) / 60) * 1.013);
      }
    }
  }

  // One-decimal-only inputs (Load / Unload pressure)
  const setOneDecimal = (key: "loadPressure" | "unloadPressure") => (val: string) => {
    if (/^\d*\.?\d?$/.test(val)) setForm((prev) => ({ ...prev, [key]: val }));
  };

  const updateLuCell = (key: LuRowKey, idx: number, val: string) => {
    setLuRows((prev) => ({ ...prev, [key]: prev[key].map((v, i) => (i === idx ? val : v)) }));
  };

  async function handleCapturePhoto() {
    try {
      const base64 = await capturePhotoFromDevice();
      setCapturedPhoto(base64);
      toast.success("Photo captured successfully");
    } catch (err: any) {
      toast.error(err.message || "Failed to capture photo");
    }
  }

  async function handleSubmit() {
    if (!profile) {
      return toast.error("Please set up the Company / Plant profile first.");
    }
    if (!form.machineTag) return toast.error("Machine Tag / ID is required.");
    if (!form.ratedKw) return toast.error("Rated Power is required.");
    if ((form.fadActive || form.pumpActive) && (!form.loadPressure || !form.unloadPressure)) {
      return toast.error("Load Pressure and Unload Pressure are required when a FAD or Pump-Up test is ticked.");
    }

    let savedPath = existingPhotoPath;
    if (capturedPhoto && capturedPhoto.startsWith("data:")) {
      try {
        const cleanTag = sanitizeName(form.machineTag) || "compressor";
        const cleanCompany = sanitizeName(profile.companyName) || "site";
        const dateStr = getFormattedDate();
        const fileName = `${cleanTag}_${cleanCompany}_${dateStr}`;
        savedPath = await savePhotoLocally(capturedPhoto, fileName);
      } catch (photoErr: any) {
        toast.error("Failed to save photo: " + photoErr.message);
        return;
      }
    }

    const payload: CompressorEntry = {
      id: editingId || crypto.randomUUID(),
      companyProfileId: profile.id,
      machineTag: form.machineTag,
      makeModel: form.makeModel || undefined,
      serialNo: form.serialNo || undefined,
      compressorType: form.compressorType as any || "Screw",
      yearOfManufacture: form.yearOfManufacture || undefined,
      ratedCapacity: ratedCapVal > 0 ? ratedCapVal : undefined,
      ratedCapacityUnit: form.ratedCapacityUnit,
      ratedPressure: form.ratedPressure ? parseFloat(form.ratedPressure) : undefined,
      processPressure: form.processPressure ? parseFloat(form.processPressure) : undefined,
      ratedKw: ratedKwVal,
      ratedHp: form.ratedHp ? parseFloat(form.ratedHp) : undefined,
      ratedRpm: form.ratedRpm ? parseFloat(form.ratedRpm) : undefined,
      ratedCurrent: form.ratedCurrent ? parseFloat(form.ratedCurrent) : undefined,
      motorEfficiency: form.motorEfficiency ? parseFloat(form.motorEfficiency) : undefined,
      annualOperatingDays: form.annualOperatingDays ? parseFloat(form.annualOperatingDays) : undefined,
      powerCost: form.powerCost ? parseFloat(form.powerCost) : undefined,
      starterType: form.starterType as any || "DOL",
      designedSec: designedSec > 0 ? designedSec : undefined,
      designedAirGen: designedAirGen > 0 ? designedAirGen : undefined,

      // Electrical general
      genLoadVoltage: form.genLoadVoltage ? parseFloat(form.genLoadVoltage) : undefined,
      genLoadAmp: form.genLoadAmp ? parseFloat(form.genLoadAmp) : undefined,
      genLoadPf: form.genLoadPf ? parseFloat(form.genLoadPf) : undefined,
      genLoadKw: form.genLoadKw ? parseFloat(form.genLoadKw) : undefined,
      genUnloadVoltage: form.genUnloadVoltage ? parseFloat(form.genUnloadVoltage) : undefined,
      genUnloadAmp: form.genUnloadAmp ? parseFloat(form.genUnloadAmp) : undefined,
      genUnloadPf: form.genUnloadPf ? parseFloat(form.genUnloadPf) : undefined,
      genUnloadKw: form.genUnloadKw ? parseFloat(form.genUnloadKw) : undefined,
      kva: calculatedKva > 0 ? calculatedKva : undefined,
      kvar: calculatedKvar > 0 ? calculatedKvar : undefined,
      loadFactor: calculatedLoadFactor,

      // Load / Unload measurement table
      luType,
      luData: JSON.stringify(luRows),

      // Load / Unload pressures (fed when a test is ticked)
      loadPressure: form.loadPressure ? parseFloat(form.loadPressure) : undefined,
      unloadPressure: form.unloadPressure ? parseFloat(form.unloadPressure) : undefined,

      // FAD Anemometer Test details
      fadActive: form.fadActive,
      fadAreaType: form.fadActive ? form.fadAreaType : undefined,
      fadAreaL: form.fadActive && form.fadAreaType === "Rectangle" ? parseFloat(form.fadAreaL) : undefined,
      fadAreaB: form.fadActive && form.fadAreaType === "Rectangle" ? parseFloat(form.fadAreaB) : undefined,
      fadAreaDia: form.fadActive && form.fadAreaType === "Circle" ? parseFloat(form.fadAreaDia) : undefined,
      fadAreaPeri: form.fadActive && form.fadAreaType === "Circle" ? parseFloat(form.fadAreaPeri) : undefined,
      fadAreaRadius: form.fadActive && form.fadAreaType === "Circle" ? parseFloat(form.fadAreaRadius) : undefined,
      fadAreaDirect: form.fadActive && form.fadAreaType === "Direct" ? parseFloat(form.fadAreaDirect) : undefined,
      fadNumPoints: form.fadActive ? parseInt(form.fadNumPoints) : undefined,
      fadVelocities: form.fadActive ? JSON.stringify(numericVelocities) : undefined,
      fadRunningPressure: form.fadActive ? parseFloat(form.fadRunningPressure) : undefined,
      fadMeasuredPower: form.fadActive ? fadMeasuredPowerVal : undefined,
      fadSuctionArea: form.fadActive ? fadSuctionArea : undefined,
      fadAvgVelocity: form.fadActive ? fadAvgVelocity : undefined,
      fadAirDeliveryM3Sec: form.fadActive ? fadAirDeliveryM3Sec : undefined,
      fadAirDeliveryM3Hr: form.fadActive ? fadAirDeliveryM3Hr : undefined,
      fadAirDeliveryCfm: form.fadActive ? fadAirDeliveryCfm : undefined,
      fadActualSec: form.fadActive ? fadActualSec : undefined,
      fadActualAirGen: form.fadActive ? fadActualAirGen : undefined,
      fadDescription: form.fadActive ? form.fadDescription : undefined,

      // Pump Up Test details
      pumpActive: form.pumpActive,
      pumpP1: form.pumpActive ? pumpP1 : undefined,
      pumpP2: form.pumpActive ? pumpP2 : undefined,
      pumpTimeSec: form.pumpActive ? pumpTimeSec : undefined,
      pumpTankVolume: form.pumpActive ? parseFloat(form.pumpTankVolume) : undefined,
      pumpTankVolumeUnit: form.pumpActive ? form.pumpTankVolumeUnit : undefined,
      pumpTankCalcMethod: form.pumpActive ? form.pumpTankCalcMethod : undefined,
      pumpTankDia: form.pumpActive && form.pumpTankCalcMethod === "DiaLength" ? parseFloat(form.pumpTankDia) : undefined,
      pumpTankLength: form.pumpActive && form.pumpTankCalcMethod !== "Direct" ? parseFloat(form.pumpTankLength) : undefined,
      pumpTankPeri: form.pumpActive && form.pumpTankCalcMethod === "PeriLength" ? parseFloat(form.pumpTankPeri) : undefined,
      pumpActualFadM3Min: form.pumpActive ? pumpActualFadM3Min : undefined,
      pumpActualFadCfm: form.pumpActive ? pumpActualFadCfm : undefined,
      pumpRunningPressure: form.pumpActive && form.pumpRunningPressure ? parseFloat(form.pumpRunningPressure) : undefined,
      pumpMeasuredPower: form.pumpActive && form.pumpMeasuredPower ? parseFloat(form.pumpMeasuredPower) : undefined,
      pumpAirTempC: form.pumpActive && form.pumpAirTempC ? pumpAirTempVal : undefined,
      pumpTempFactor: form.pumpActive && pumpTempFactor > 0 ? pumpTempFactor : undefined,
      pumpLapData: form.pumpActive && pumpLapRows.length > 0 ? JSON.stringify(pumpLapRows) : undefined,
      pumpDescription: form.pumpActive ? form.pumpDescription : undefined,

      photoPath: savedPath || undefined,
      description: form.description || undefined,
      obsCompSituation: form.obsCompSituation ? parseFloat(form.obsCompSituation) : undefined,
      obsCompDischarge: form.obsCompDischarge ? parseFloat(form.obsCompDischarge) : undefined,
      obsOilSap: form.obsOilSap ? parseFloat(form.obsOilSap) : undefined,
      obsOilRadiatorIn: form.obsOilRadiatorIn ? parseFloat(form.obsOilRadiatorIn) : undefined,
      obsOilRadiatorOut: form.obsOilRadiatorOut ? parseFloat(form.obsOilRadiatorOut) : undefined,
      obsAirRadiatorIn: form.obsAirRadiatorIn ? parseFloat(form.obsAirRadiatorIn) : undefined,
      obsAirRadiatorOut: form.obsAirRadiatorOut ? parseFloat(form.obsAirRadiatorOut) : undefined,
      obsCompFinalDischarge: form.obsCompFinalDischarge ? parseFloat(form.obsCompFinalDischarge) : undefined,
      obsCompMotor: form.obsCompMotor ? parseFloat(form.obsCompMotor) : undefined,
      obsThermalImageNo: form.obsThermalImageNo || undefined,
      recordedBy: editingId
        ? (compressors.find(c => c.id === editingId)?.recordedBy || useAuthStore.getState().displayName || "Unknown")
        : (useAuthStore.getState().displayName || "Unknown"),
      createdAt: editingId
        ? (compressors.find(c => c.id === editingId)?.createdAt || new Date().toISOString())
        : new Date().toISOString(),
      createdById: "local-user",
    };

    if (editingId) {
      updateCompressor(editingId, payload);
      toast.success("Compressor entry updated locally");
    } else {
      addCompressor(payload);
      toast.success("Compressor entry added locally");
    }

    resetForm();
  }

  function resetForm() {
    setEditingId(null);
    setForm({
      machineTag: "",
      makeModel: "",
      serialNo: "",
      compressorType: "Screw",
      yearOfManufacture: "",
      ratedCapacity: "",
      ratedCapacityUnit: "m3/min",
      ratedPressure: "",
      processPressure: "",
      ratedKw: "",
      ratedHp: "",
      ratedRpm: "",
      ratedCurrent: "",
      motorEfficiency: "",
      annualOperatingDays: "",
      powerCost: "",
      starterType: "DOL",
      genLoadVoltage: "", genLoadAmp: "", genLoadPf: "", genLoadKw: "",
      genUnloadVoltage: "", genUnloadAmp: "", genUnloadPf: "", genUnloadKw: "",
      fadActive: false,
      fadAreaType: "Rectangle",
      fadAreaL: "",
      fadAreaB: "",
      fadAreaDia: "",
      fadAreaPeri: "",
      fadAreaRadius: "",
      fadAreaDirect: "",
      fadNumPoints: "5",
      fadRunningPressure: "",
      fadMeasuredPower: "",
      fadDescription: "",
      pumpActive: false,
      pumpP1: "",
      pumpP2: "",
      pumpTimeSec: "",
      pumpTankVolume: "",
      pumpTankVolumeUnit: "Liters",
      pumpTankCalcMethod: "Direct",
      pumpTankDia: "",
      pumpTankLength: "",
      pumpTankPeri: "",
      pumpAirTempC: "",
      pumpRunningPressure: "",
      pumpMeasuredPower: "",
      pumpDescription: "",
      loadPressure: "",
      unloadPressure: "",
      description: "",
      obsCompSituation: "",
      obsCompDischarge: "",
      obsOilSap: "",
      obsOilRadiatorIn: "",
      obsOilRadiatorOut: "",
      obsAirRadiatorIn: "",
      obsAirRadiatorOut: "",
      obsCompFinalDischarge: "",
      obsCompMotor: "",
      obsThermalImageNo: "",
    });
    setVelocities(Array(5).fill(""));
    setCapturedPhoto(null);
    setExistingPhotoPath(null);
    setLuType("SD");
    setLuRows(emptyLuRows());
    setNotesActive(false);
    setSwRunning(false);
    setSwElapsed(0);
    setLapTimes([]);
  }

  function handleEdit(c: CompressorEntry) {
    setEditingId(c.id);
    
    // Parse velocities
    let parsedVels = Array(c.fadNumPoints || 5).fill("");
    if (c.fadVelocities) {
      try {
        const arr = JSON.parse(c.fadVelocities);
        if (Array.isArray(arr)) {
          parsedVels = arr.map(v => v.toString());
        }
      } catch {}
    }

    setForm({
      machineTag: c.machineTag || "",
      makeModel: c.makeModel || "",
      serialNo: c.serialNo || "",
      compressorType: c.compressorType || "Screw",
      yearOfManufacture: c.yearOfManufacture || "",
      ratedCapacity: c.ratedCapacity?.toString() || "",
      ratedCapacityUnit: c.ratedCapacityUnit || "m3/min",
      ratedPressure: c.ratedPressure?.toString() || "",
      processPressure: c.processPressure?.toString() || "",
      ratedKw: c.ratedKw?.toString() || "",
      ratedHp: c.ratedHp?.toString() || "",
      ratedRpm: c.ratedRpm?.toString() || "",
      ratedCurrent: c.ratedCurrent?.toString() || "",
      motorEfficiency: c.motorEfficiency?.toString() || "",
      annualOperatingDays: c.annualOperatingDays?.toString() || "",
      powerCost: c.powerCost?.toString() || "",
      starterType: c.starterType || "DOL",
      genLoadVoltage: c.genLoadVoltage?.toString() || "",
      genLoadAmp: c.genLoadAmp?.toString() || "",
      genLoadPf: c.genLoadPf?.toString() || "",
      genLoadKw: c.genLoadKw?.toString() || "",
      genUnloadVoltage: c.genUnloadVoltage?.toString() || "",
      genUnloadAmp: c.genUnloadAmp?.toString() || "",
      genUnloadPf: c.genUnloadPf?.toString() || "",
      genUnloadKw: c.genUnloadKw?.toString() || "",
      fadActive: !!c.fadActive,
      fadAreaType: c.fadAreaType || "Rectangle",
      fadAreaL: c.fadAreaL?.toString() || "",
      fadAreaB: c.fadAreaB?.toString() || "",
      fadAreaDia: c.fadAreaDia?.toString() || "",
      fadAreaPeri: c.fadAreaPeri?.toString() || "",
      fadAreaRadius: c.fadAreaRadius?.toString() || "",
      fadAreaDirect: c.fadAreaDirect?.toString() || "",
      fadNumPoints: (c.fadNumPoints || 5).toString(),
      fadRunningPressure: c.fadRunningPressure?.toString() || "",
      fadMeasuredPower: c.fadMeasuredPower?.toString() || "",
      fadDescription: c.fadDescription || "",
      pumpActive: !!c.pumpActive,
      pumpP1: c.pumpP1?.toString() || "",
      pumpP2: c.pumpP2?.toString() || "",
      pumpTimeSec: c.pumpTimeSec?.toString() || "",
      pumpTankVolume: c.pumpTankVolume?.toString() || "",
      pumpTankVolumeUnit: c.pumpTankVolumeUnit || "Liters",
      pumpTankCalcMethod: c.pumpTankCalcMethod || "Direct",
      pumpTankDia: c.pumpTankDia?.toString() || "",
      pumpTankLength: c.pumpTankLength?.toString() || "",
      pumpTankPeri: c.pumpTankPeri?.toString() || "",
      pumpAirTempC: c.pumpAirTempC?.toString() || "",
      pumpRunningPressure: c.pumpRunningPressure?.toString() || "",
      pumpMeasuredPower: c.pumpMeasuredPower?.toString() || "",
      pumpDescription: c.pumpDescription || "",
      loadPressure: c.loadPressure?.toString() || "",
      unloadPressure: c.unloadPressure?.toString() || "",
      description: c.description || "",
      obsCompSituation: c.obsCompSituation?.toString() || "",
      obsCompDischarge: c.obsCompDischarge?.toString() || "",
      obsOilSap: c.obsOilSap?.toString() || "",
      obsOilRadiatorIn: c.obsOilRadiatorIn?.toString() || "",
      obsOilRadiatorOut: c.obsOilRadiatorOut?.toString() || "",
      obsAirRadiatorIn: c.obsAirRadiatorIn?.toString() || "",
      obsAirRadiatorOut: c.obsAirRadiatorOut?.toString() || "",
      obsCompFinalDischarge: c.obsCompFinalDischarge?.toString() || "",
      obsCompMotor: c.obsCompMotor?.toString() || "",
      obsThermalImageNo: c.obsThermalImageNo || "",
    });

    setVelocities(parsedVels);
    setExistingPhotoPath(c.photoPath || null);
    setCapturedPhoto(null);
    setLuType(c.luType === "VFD" ? "VFD" : "SD");
    try {
      setLuRows({ ...emptyLuRows(), ...(c.luData ? JSON.parse(c.luData) : {}) });
    } catch {
      setLuRows(emptyLuRows());
    }
    setNotesActive(!!(c.description || c.photoPath));
    setSwRunning(false);
    let savedLaps: (number | null)[] = [];
    let savedLapKwh: string[] = [];
    if (c.pumpLapData) {
      try {
        const arr = JSON.parse(c.pumpLapData);
        if (Array.isArray(arr)) {
          savedLaps = arr.map((r: any) => (typeof r.timeSec === "number" ? r.timeSec : null));
          savedLapKwh = arr.map((r: any) => r.kwh || "");
        }
      } catch {}
    }
    setLapTimes(savedLaps);
    setLapKwh(savedLapKwh);
    const lastLap = [...savedLaps].reverse().find((t) => t !== null);
    setSwElapsed(lastLap ?? 0);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="space-y-6">
      <Card className="bg-slate-950/40 border-white/10 backdrop-blur-md">
        <CardHeader className="pb-3">
          <CardTitle>{editingId ? "Edit Compressor Audit Setup" : "Add Compressor Audit Setup"}</CardTitle>
          <CardDescription className="text-xs text-slate-400">
            Enter the rated parameters, then scroll down and tick the FAD Test, Pump-Up Test or General &amp; Photo cards to feed their details.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6 pt-3">
          {/* Section 1: Rated Parameters */}
          <div className="space-y-6 animate-fade-in">
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <div>
                  <Label htmlFor="machineTag">Machine Tag / ID <span className="text-red-500">*</span></Label>
                  <Input id="machineTag" value={form.machineTag} onChange={(e) => setForm({ ...form, machineTag: e.target.value })} placeholder="e.g. Compressor-1" />
                </div>
                <div>
                  <Label htmlFor="makeModel">Make / Model</Label>
                  <Input id="makeModel" value={form.makeModel} onChange={(e) => setForm({ ...form, makeModel: e.target.value })} placeholder="e.g. Kaesar BSD-75" />
                </div>
                <div>
                  <Label htmlFor="serialNo">Serial No / Sr. No.</Label>
                  <Input id="serialNo" value={form.serialNo} onChange={(e) => setForm({ ...form, serialNo: e.target.value })} placeholder="e.g. 1075" />
                </div>
                <div>
                  <Label htmlFor="compressorType">Compressor Type</Label>
                  <select 
                    id="compressorType"
                    className="h-9 w-full rounded-md border border-white/10 bg-slate-950/50 px-2 text-sm text-slate-200"
                    value={form.compressorType}
                    onChange={(e) => setForm({ ...form, compressorType: e.target.value })}
                  >
                    <option value="Screw">Screw</option>
                    <option value="Reciprocating">Reciprocating</option>
                    <option value="Centrifugal">Centrifugal</option>
                  </select>
                </div>
                <div>
                  <Label htmlFor="yearOfManufacture">Year of Manufacture</Label>
                  <Input id="yearOfManufacture" type="number" value={form.yearOfManufacture} onChange={(e) => setForm({ ...form, yearOfManufacture: e.target.value })} placeholder="e.g. 2014" />
                </div>
                
                <div>
                  <Label htmlFor="ratedCapacity">Rated Flow Capacity</Label>
                  <div className="flex">
                    <Input id="ratedCapacity" type="number" step="0.01" className="rounded-r-none border-r-0" value={form.ratedCapacity} onChange={(e) => setForm({ ...form, ratedCapacity: e.target.value })} placeholder="e.g. 7.08" />
                    <select
                      className="h-9 rounded-md rounded-l-none border border-white/10 bg-slate-950/50 px-2 text-xs text-slate-200 select-none"
                      value={form.ratedCapacityUnit}
                      onChange={(e) => setForm({ ...form, ratedCapacityUnit: e.target.value })}
                    >
                      <option value="m3/min">m³/min</option>
                      <option value="CFM">CFM</option>
                      <option value="l/s">l/s</option>
                      <option value="CMH">CMH (m³/h)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <Label htmlFor="ratedPressure">Rated Pressure (bar)</Label>
                  <Input id="ratedPressure" type="number" step="0.1" value={form.ratedPressure} onChange={(e) => setForm({ ...form, ratedPressure: e.target.value })} placeholder="e.g. 8.5" />
                </div>

                <div>
                  <Label htmlFor="processPressure">Process Operating Pressure (bar)</Label>
                  <Input id="processPressure" type="number" step="0.1" value={form.processPressure} onChange={(e) => setForm({ ...form, processPressure: e.target.value })} placeholder="e.g. 6.1" />
                </div>

                <div>
                  <Label htmlFor="ratedKw">Rated Power (kW) <span className="text-red-500">*</span></Label>
                  <Input id="ratedKw" type="number" step="0.1" value={form.ratedKw} onChange={(e) => handleKwChange(e.target.value)} placeholder="37" />
                </div>

                <div>
                  <Label htmlFor="ratedHp">Rated Power (HP)</Label>
                  <Input id="ratedHp" type="number" step="0.1" value={form.ratedHp} onChange={(e) => handleHpChange(e.target.value)} placeholder="50" />
                </div>

                <div>
                  <Label htmlFor="ratedCurrent">Rated FLA Current (Amps)</Label>
                  <Input id="ratedCurrent" type="number" step="0.1" value={form.ratedCurrent} onChange={(e) => setForm({ ...form, ratedCurrent: e.target.value })} placeholder="e.g. 68" />
                </div>

                <div>
                  <Label htmlFor="ratedRpm">Rated RPM (Speed)</Label>
                  <Input id="ratedRpm" type="number" value={form.ratedRpm} onChange={(e) => setForm({ ...form, ratedRpm: e.target.value })} placeholder="e.g. 2960" />
                </div>

                <div>
                  <Label htmlFor="motorEfficiency">Rated Motor Efficiency (%)</Label>
                  <Input id="motorEfficiency" type="number" step="0.01" value={form.motorEfficiency} onChange={(e) => setForm({ ...form, motorEfficiency: e.target.value })} placeholder="e.g. 93.9" />
                </div>

                <div>
                  <Label htmlFor="annualOperatingDays">Annual Operating Days</Label>
                  <Input id="annualOperatingDays" type="number" value={form.annualOperatingDays} onChange={(e) => setForm({ ...form, annualOperatingDays: e.target.value })} placeholder="e.g. 350" />
                </div>

                <div>
                  <Label htmlFor="powerCost">Electricity Power Cost (Rs. / hour)</Label>
                  <Input id="powerCost" type="number" step="0.1" value={form.powerCost} onChange={(e) => setForm({ ...form, powerCost: e.target.value })} placeholder="e.g. 350" />
                </div>

                <div>
                  <Label htmlFor="starterType">Starter Type</Label>
                  <select 
                    id="starterType"
                    className="h-9 w-full rounded-md border border-white/10 bg-slate-950/50 px-2 text-sm text-slate-200"
                    value={form.starterType}
                    onChange={(e) => setForm({ ...form, starterType: e.target.value })}
                  >
                    <option value="DOL">DOL</option>
                    <option value="VFD">VFD</option>
                    <option value="SD">Star-Delta (SD)</option>
                  </select>
                </div>
              </div>

              {/* Dynamic equivalents panel */}
              {ratedCapVal > 0 && (
                <div className="rounded-xl border border-white/5 bg-slate-900/30 p-3 text-[11px] text-slate-400 space-y-1.5">
                  <div className="font-semibold text-slate-300 uppercase tracking-widest text-[9px] mb-1">Equivalent Flow Capacities</div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <div><span className="text-slate-500">Flow (m³/min):</span> <strong className="text-slate-300">{ratedM3Min.toFixed(2)}</strong></div>
                    <div><span className="text-slate-500">Flow (CFM):</span> <strong className="text-slate-300">{ratedCfmEquivalent.toFixed(2)}</strong></div>
                    <div><span className="text-slate-500">Flow (l/s):</span> <strong className="text-slate-300">{ratedLsEquivalent.toFixed(1)}</strong></div>
                    <div><span className="text-slate-500">Flow (CMH):</span> <strong className="text-slate-300">{ratedCmhEquivalent.toFixed(1)}</strong></div>
                  </div>
                </div>
              )}

              {/* Design benchmarks card */}
              <div className="rounded-xl border border-white/10 bg-slate-900/50 p-4 grid gap-4 grid-cols-2">
                <div>
                  <div className="text-[10px] text-slate-400 uppercase tracking-widest font-semibold mb-1">Designed SEC (kW/CFM)</div>
                  <div className="text-2xl text-sky-400 font-bold">
                    {designedSec > 0 ? designedSec.toFixed(3) : "0.000"}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400 uppercase tracking-widest font-semibold mb-1">Designed Air Generation (CFM/kW)</div>
                  <div className="text-2xl text-sky-400 font-bold">
                    {designedAirGen > 0 ? designedAirGen.toFixed(2) : "0.00"}
                  </div>
                </div>
              </div>

              {/* Electrical inputs */}
              <div className="space-y-3 pt-2 border-t border-white/5">
                <h3 className="text-xs uppercase tracking-wider text-sky-400 font-semibold">General Electrical Measurements</h3>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-3 rounded-lg border border-white/5 bg-slate-900/30 p-3">
                    <h4 className="text-xs text-slate-300 font-semibold mb-2">Load Parameters</h4>
                    <div className="grid gap-3 grid-cols-2">
                      <div>
                        <Label htmlFor="genLoadVoltage">Voltage (V)</Label>
                        <Input id="genLoadVoltage" type="number" value={form.genLoadVoltage} onChange={(e) => setForm({ ...form, genLoadVoltage: e.target.value })} placeholder="415" />
                      </div>
                      <div>
                        <Label htmlFor="genLoadAmp">Current (A)</Label>
                        <Input id="genLoadAmp" type="number" value={form.genLoadAmp} onChange={(e) => setForm({ ...form, genLoadAmp: e.target.value })} placeholder="60" />
                      </div>
                      <div>
                        <Label htmlFor="genLoadPf">Power Factor (PF)</Label>
                        <Input id="genLoadPf" type="number" step="0.01" value={form.genLoadPf} onChange={(e) => setForm({ ...form, genLoadPf: e.target.value })} placeholder="0.85" />
                      </div>
                      <div>
                        <Label htmlFor="genLoadKw">Load kW <span className="text-red-500">*</span></Label>
                        <Input id="genLoadKw" type="number" step="0.1" value={form.genLoadKw} onChange={(e) => setForm({ ...form, genLoadKw: e.target.value })} />
                      </div>
                    </div>
                  </div>
                  <div className="space-y-3 rounded-lg border border-white/5 bg-slate-900/30 p-3">
                    <h4 className="text-xs text-slate-300 font-semibold mb-2">Unload Parameters</h4>
                    <div className="grid gap-3 grid-cols-2">
                      <div>
                        <Label htmlFor="genUnloadVoltage">Voltage (V)</Label>
                        <Input id="genUnloadVoltage" type="number" value={form.genUnloadVoltage} onChange={(e) => setForm({ ...form, genUnloadVoltage: e.target.value })} placeholder="415" />
                      </div>
                      <div>
                        <Label htmlFor="genUnloadAmp">Current (A)</Label>
                        <Input id="genUnloadAmp" type="number" value={form.genUnloadAmp} onChange={(e) => setForm({ ...form, genUnloadAmp: e.target.value })} placeholder="20" />
                      </div>
                      <div>
                        <Label htmlFor="genUnloadPf">Power Factor (PF)</Label>
                        <Input id="genUnloadPf" type="number" step="0.01" value={form.genUnloadPf} onChange={(e) => setForm({ ...form, genUnloadPf: e.target.value })} placeholder="0.85" />
                      </div>
                      <div>
                        <Label htmlFor="genUnloadKw">Unload kW</Label>
                        <Input id="genUnloadKw" type="number" step="0.1" value={form.genUnloadKw} onChange={(e) => setForm({ ...form, genUnloadKw: e.target.value })} />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-white/5 bg-slate-900/30 p-3 grid grid-cols-2 gap-2 text-xs mt-2 text-slate-300">
                  <div>Load Factor (Calculated): <strong className={cn(calculatedLoadFactor > 120 ? "text-red-400" : "text-emerald-400")}>{calculatedLoadFactor.toFixed(2)}%</strong></div>
                  <div>Load kVA / kVAr: <strong className="text-sky-300">{calculatedKva.toFixed(1)} / {calculatedKvar.toFixed(1)}</strong></div>
                </div>
              </div>

              {/* Load / Unload measurements (Star Delta / VFD) */}
              <div className="space-y-3 pt-2 border-t border-white/5">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h3 className="text-xs uppercase tracking-wider text-sky-400 font-semibold">Load / Unload Measurements</h3>
                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-slate-400">Load / Unload:</Label>
                    <select
                      className="h-8 rounded-md border border-white/10 bg-slate-950/50 px-2 text-xs text-slate-200"
                      value={luType}
                      onChange={(e) => setLuType(e.target.value as "SD" | "VFD")}
                    >
                      <option value="SD">Star Delta</option>
                      <option value="VFD">VFD</option>
                    </select>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-xl border border-white/10">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-slate-500 border-b border-white/5 bg-slate-950/40 text-left">
                        <th className="px-3 py-2">Parameter</th>
                        <th className="px-3 py-2">Val 1</th>
                        <th className="px-3 py-2">Val 2</th>
                        <th className="px-3 py-2">Val 3</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(luType === "SD"
                        ? ([
                            { key: "date", label: "Date", type: "date" },
                            { key: "time", label: "Time", type: "time" },
                            { key: "loadHours", label: "Load Hours", type: "number" },
                            { key: "unloadHours", label: "Unload Hours", type: "number" },
                            { key: "totalRunHours", label: "Total Run Hours", type: "number" },
                          ] as { key: LuRowKey; label: string; type: string }[])
                        : ([
                            { key: "date", label: "Date", type: "date" },
                            { key: "time", label: "Time", type: "time" },
                            { key: "loadHours", label: "Load Hours", type: "number" },
                            { key: "band020", label: "0–20 %", type: "number" },
                            { key: "band2040", label: "20–40 %", type: "number" },
                            { key: "band4060", label: "40–60 %", type: "number" },
                            { key: "band6080", label: "60–80 %", type: "number" },
                            { key: "band80100", label: "80–100 %", type: "number" },
                          ] as { key: LuRowKey; label: string; type: string }[])
                      ).map((row) => (
                        <tr key={row.key} className="border-t border-white/5">
                          <td className="px-3 py-2 text-slate-400 whitespace-nowrap font-medium">{row.label}</td>
                          {[0, 1, 2].map((idx) => (
                            <td key={idx} className="px-2 py-1.5">
                              <Input
                                type={row.type}
                                step={row.type === "number" ? "0.01" : undefined}
                                className="h-8 text-xs"
                                value={luRows[row.key][idx]}
                                onChange={(e) => updateLuCell(row.key, idx, e.target.value)}
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Computed Load/Unload Summaries */}
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-3 mt-4">
                  <h4 className="text-[10px] text-amber-400 font-bold uppercase tracking-wider">Calculated Data (Val 2 & Val 3 over Val 1)</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2 text-xs">
                      <div className="font-semibold text-slate-300 border-b border-white/5 pb-1">Val 2 - Val 1</div>
                      <div className="flex justify-between"><span>Load Hours:</span> <strong className="text-emerald-400">{calcLoadHrs12.toFixed(1)}</strong></div>
                      <div className="flex justify-between"><span>Unload Hours:</span> <strong className="text-emerald-400">{calcUnloadHrs12.toFixed(1)}</strong></div>
                      <div className="flex justify-between"><span>Total Run Hours:</span> <strong className="text-sky-300">{calcTotalHrs12.toFixed(1)}</strong></div>
                      <div className="flex justify-between"><span>% of Load:</span> <strong className="text-white">{percLoad12.toFixed(1)}%</strong></div>
                      <div className="flex justify-between"><span>% of Unload:</span> <strong className="text-white">{percUnload12.toFixed(1)}%</strong></div>
                      <div className="flex justify-between text-amber-300 pt-1 border-t border-white/5"><span>Daily Load Unit:</span> <strong>{dailyLoadUnit12.toFixed(1)} kWh</strong></div>
                      <div className="flex justify-between text-amber-300"><span>Daily Unload Unit:</span> <strong>{dailyUnloadUnit12.toFixed(1)} kWh</strong></div>
                      <div className="flex justify-between text-amber-400 font-bold bg-amber-500/20 p-1 rounded mt-1"><span>Total Daily Consumption:</span> <span>{totalDailyConsumption12.toFixed(1)} kWh</span></div>
                    </div>
                    <div className="space-y-2 text-xs border-l border-white/10 pl-4">
                      <div className="font-semibold text-slate-300 border-b border-white/5 pb-1">Val 3 - Val 1</div>
                      <div className="flex justify-between"><span>Load Hours:</span> <strong className="text-emerald-400">{calcLoadHrs13.toFixed(1)}</strong></div>
                      <div className="flex justify-between"><span>Unload Hours:</span> <strong className="text-emerald-400">{calcUnloadHrs13.toFixed(1)}</strong></div>
                      <div className="flex justify-between"><span>Total Run Hours:</span> <strong className="text-sky-300">{calcTotalHrs13.toFixed(1)}</strong></div>
                      <div className="flex justify-between"><span>% of Load:</span> <strong className="text-white">{percLoad13.toFixed(1)}%</strong></div>
                      <div className="flex justify-between"><span>% of Unload:</span> <strong className="text-white">{percUnload13.toFixed(1)}%</strong></div>
                      <div className="flex justify-between text-amber-300 pt-1 border-t border-white/5"><span>Daily Load Unit:</span> <strong>{dailyLoadUnit13.toFixed(1)} kWh</strong></div>
                      <div className="flex justify-between text-amber-300"><span>Daily Unload Unit:</span> <strong>{dailyUnloadUnit13.toFixed(1)} kWh</strong></div>
                      <div className="flex justify-between text-amber-400 font-bold bg-amber-500/20 p-1 rounded mt-1"><span>Total Daily Consumption:</span> <span>{totalDailyConsumption13.toFixed(1)} kWh</span></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
        </CardContent>
      </Card>

      {/* Section 2: FAD Test (tick to feed details) */}
      <Card className="bg-slate-950/40 border-white/10 backdrop-blur-md">
        <CardContent className="space-y-6 pt-6">
            <div className="space-y-6 animate-fade-in">
              <div className="flex items-center justify-between border-b border-white/5 pb-3">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="fadActive"
                    className="w-4 h-4 text-sky-500 accent-sky-500 bg-slate-950 border-white/10 rounded"
                    checked={form.fadActive}
                    onChange={(e) => setForm({ ...form, fadActive: e.target.checked })}
                  />
                  <Label htmlFor="fadActive" className="text-sm font-semibold cursor-pointer">Perform Anemometer (FAD) Test</Label>
                </div>
              </div>

              {form.fadActive ? (
                <div className="space-y-6">
                  {/* Load / Unload pressures — required before save */}
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
                    <div className="text-[10px] text-amber-400 uppercase tracking-widest font-semibold mb-2">Load / Unload Pressures (required, one decimal only)</div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <Label htmlFor="fadLoadPressure">Load Pressure (bar) <span className="text-red-500">*</span></Label>
                        <Input id="fadLoadPressure" inputMode="decimal" value={form.loadPressure} onChange={(e) => setOneDecimal("loadPressure")(e.target.value)} placeholder="e.g. 6.5" />
                      </div>
                      <div>
                        <Label htmlFor="fadUnloadPressure">Unload Pressure (bar) <span className="text-red-500">*</span></Label>
                        <Input id="fadUnloadPressure" inputMode="decimal" value={form.unloadPressure} onChange={(e) => setOneDecimal("unloadPressure")(e.target.value)} placeholder="e.g. 7.5" />
                      </div>
                    </div>
                  </div>

                  {/* Step A: Suction Area settings */}
                  <div>
                    <h3 className="text-xs uppercase tracking-wider text-sky-400 font-semibold mb-3">A. Suction Duct Area Settings</h3>
                    <div className="grid gap-4 md:grid-cols-3">
                      <div>
                        <Label>Duct Shape</Label>
                        <select
                          className="h-9 w-full rounded-md border border-white/10 bg-slate-950/50 px-2 text-sm text-slate-200"
                          value={form.fadAreaType}
                          onChange={(e) => setForm({ ...form, fadAreaType: e.target.value })}
                        >
                          <option value="Rectangle">Square / Rectangle</option>
                          <option value="Circle">Circle</option>
                          <option value="Direct">Direct Face Area</option>
                        </select>
                      </div>

                      {form.fadAreaType === "Rectangle" && (
                        <>
                          <div>
                            <Label>Length, L (mm)</Label>
                            <Input type="number" step="0.001" value={form.fadAreaL} onChange={(e) => setForm({ ...form, fadAreaL: e.target.value })} placeholder="e.g. 300" />
                          </div>
                          <div>
                            <Label>Width, B (mm)</Label>
                            <Input type="number" step="0.001" value={form.fadAreaB} onChange={(e) => setForm({ ...form, fadAreaB: e.target.value })} placeholder="e.g. 200" />
                          </div>
                        </>
                      )}

                      {form.fadAreaType === "Circle" && (
                        <div>
                          <Label>Calculate Area from</Label>
                          <div className="grid grid-cols-3 gap-2 mt-1">
                            <Input type="number" step="0.001" value={form.fadAreaDia} onChange={(e) => setForm({ ...form, fadAreaDia: e.target.value, fadAreaRadius: "", fadAreaPeri: "" })} placeholder="Diameter (m)" />
                            <Input type="number" step="0.001" value={form.fadAreaRadius} onChange={(e) => setForm({ ...form, fadAreaRadius: e.target.value, fadAreaDia: "", fadAreaPeri: "" })} placeholder="Radius (m)" />
                            <Input type="number" step="0.001" value={form.fadAreaPeri} onChange={(e) => setForm({ ...form, fadAreaPeri: e.target.value, fadAreaDia: "", fadAreaRadius: "" })} placeholder="Perimeter (m)" />
                          </div>
                        </div>
                      )}

                      {form.fadAreaType === "Direct" && (
                        <div>
                          <Label>Total Area (Sqm)</Label>
                          <Input type="number" step="0.0001" value={form.fadAreaDirect} onChange={(e) => setForm({ ...form, fadAreaDirect: e.target.value })} placeholder="e.g. 0.05" />
                        </div>
                      )}
                    </div>

                    <div className="text-xs text-sky-400 mt-2 font-medium">
                      Calculated Suction Area: <strong className="text-white">{fadSuctionArea.toFixed(4)} Sqm</strong>
                    </div>
                  </div>

                  <hr className="border-white/5" />

                  {/* Step B: Velocity Measurement Grid */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-xs uppercase tracking-wider text-sky-400 font-semibold">B. Anemometer Velocity Points</h3>
                      <div className="flex items-center gap-2">
                        <Label htmlFor="fadNumPoints" className="text-xs text-slate-400">Number of Points (1-50):</Label>
                        <Input
                          id="fadNumPoints"
                          type="number"
                          min="1"
                          max="50"
                          className="h-8 w-16 text-center"
                          value={form.fadNumPoints}
                          onChange={(e) => setForm({ ...form, fadNumPoints: e.target.value })}
                        />
                      </div>
                    </div>

                    <div className="grid gap-2 grid-cols-4 sm:grid-cols-6 md:grid-cols-10 max-h-48 overflow-y-auto p-2 border border-white/5 rounded-lg bg-slate-950/40">
                      {velocities.map((val, idx) => (
                        <div key={idx} className="flex flex-col gap-1">
                          <span className="text-[8px] text-slate-500 text-center">Pt {idx + 1}</span>
                          <Input
                            type="number"
                            step="0.1"
                            className="h-8 text-center text-xs px-1"
                            value={val}
                            onChange={(e) => {
                              const next = [...velocities];
                              next[idx] = e.target.value;
                              setVelocities(next);
                            }}
                            placeholder="m/s"
                          />
                        </div>
                      ))}
                    </div>

                    <div className="text-xs text-sky-400 mt-2 font-medium">
                      Average Velocity: <strong className="text-white">{fadAvgVelocity.toFixed(2)} m/s</strong> (from {numericVelocities.length} values)
                    </div>
                  </div>

                  <hr className="border-white/5" />

                  {/* Step C: Measured Outputs */}
                  <div>
                    <h3 className="text-xs uppercase tracking-wider text-sky-400 font-semibold mb-3">C. Operational Audit Readings</h3>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <Label htmlFor="fadRunningPressure">Running Pressure shown on screen (Bar)</Label>
                        <Input id="fadRunningPressure" type="number" step="0.1" value={form.fadRunningPressure} onChange={(e) => setForm({ ...form, fadRunningPressure: e.target.value })} placeholder="e.g. 6.1" />
                      </div>
                      <div>
                        <Label htmlFor="fadMeasuredPower">Measured Power = data in Load/Unload Measurements load Kw</Label>
                        <Input id="fadMeasuredPower" type="number" step="0.1" value={form.genLoadKw || ""} readOnly className="bg-slate-900/50 text-slate-400 cursor-not-allowed" />
                      </div>
                    </div>
                  </div>

                  {/* FAD Results Output Card */}
                  {fadAirDeliveryM3Sec > 0 && (
                    <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4 space-y-3">
                      <div className="text-xs font-semibold text-slate-400 uppercase tracking-widest">FAD Test Results Summary</div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                        <div>
                          <span className="text-slate-500 block">Air Delivery (m³/Sec):</span>
                          <strong className="text-white text-sm">{fadAirDeliveryM3Sec.toFixed(3)}</strong>
                        </div>
                        <div>
                          <span className="text-slate-500 block">Air Delivery (m³/hr):</span>
                          <strong className="text-white text-sm">{fadAirDeliveryM3Hr.toFixed(1)}</strong>
                        </div>
                        <div>
                          <span className="text-slate-500 block">Air Delivery (CFM):</span>
                          <strong className="text-sky-300 text-sm">{fadAirDeliveryCfm.toFixed(1)}</strong>
                        </div>
                        <div>
                          <span className="text-slate-500 block">Actual SEC (kW/CFM):</span>
                          <strong className="text-white text-sm">{fadActualSec.toFixed(3)}</strong>
                        </div>
                        <div>
                          <span className="text-slate-500 block">Actual CFM/kW:</span>
                          <strong className="text-white text-sm">{fadActualAirGen.toFixed(2)}</strong>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* FAD Comparison Table */}
                  {ratedCapVal > 0 && fadAirDeliveryCfm > 0 && (
                    <div className="rounded-xl border border-white/10 overflow-hidden">
                      <div className="bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-300 border-b border-white/10 uppercase tracking-wider">
                        Design vs. Actual Comparison (Anemometer FAD)
                      </div>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-slate-500 border-b border-white/5 bg-slate-950/40 text-left">
                            <th className="px-3 py-2">Parameter</th>
                            <th className="px-3 py-2">Design (Rated)</th>
                            <th className="px-3 py-2">Actual (Measured)</th>
                            <th className="px-3 py-2">Deviation</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="border-b border-white/5">
                            <td className="px-3 py-2 text-slate-400">Capacity (CFM)</td>
                            <td className="px-3 py-2 text-slate-200">{ratedCfmEquivalent.toFixed(1)}</td>
                            <td className={cn("px-3 py-2 font-bold", fadAirDeliveryCfm < ratedCfmEquivalent ? "text-red-400" : "text-emerald-400")}>
                              {fadAirDeliveryCfm.toFixed(1)}
                            </td>
                            <td className="px-3 py-2 text-slate-400">
                              {(((fadAirDeliveryCfm - ratedCfmEquivalent) / ratedCfmEquivalent) * 100).toFixed(1)}%
                            </td>
                          </tr>
                          <tr className="border-b border-white/5">
                            <td className="px-3 py-2 text-slate-400">SEC (kW/CFM)</td>
                            <td className="px-3 py-2 text-slate-200">{designedSec.toFixed(3)}</td>
                            <td className={cn("px-3 py-2 font-bold", fadActualSec > designedSec ? "text-red-400" : "text-emerald-400")}>
                              {fadActualSec.toFixed(3)}
                            </td>
                            <td className="px-3 py-2 text-slate-400">
                              {(((fadActualSec - designedSec) / designedSec) * 100).toFixed(1)}%
                            </td>
                          </tr>
                          <tr className="border-b border-white/5">
                            <td className="px-3 py-2 text-slate-400">Air Generation (CFM/kW)</td>
                            <td className="px-3 py-2 text-slate-200">{designedAirGen.toFixed(2)}</td>
                            <td className={cn("px-3 py-2 font-bold", fadActualAirGen < designedAirGen ? "text-red-400" : "text-emerald-400")}>
                              {fadActualAirGen.toFixed(2)}
                            </td>
                            <td className="px-3 py-2 text-slate-400">
                              {(((fadActualAirGen - designedAirGen) / designedAirGen) * 100).toFixed(1)}%
                            </td>
                          </tr>
                          <tr className="border-b border-white/5">
                            <td className="px-3 py-2 text-slate-400">Power (kW)</td>
                            <td className="px-3 py-2 text-slate-200">{ratedKwVal.toFixed(1)}</td>
                            <td className={cn("px-3 py-2 font-bold", genLoadKw > ratedKwVal ? "text-red-400" : "text-emerald-400")}>
                              {genLoadKw.toFixed(1)}
                            </td>
                            <td className="px-3 py-2 text-slate-400">
                              {ratedKwVal > 0 ? (((genLoadKw - ratedKwVal) / ratedKwVal) * 100).toFixed(1) + "%" : "—"}
                            </td>
                          </tr>
                          <tr>
                            <td className="px-3 py-2 text-slate-400">Pressure (bar)</td>
                            <td className="px-3 py-2 text-slate-200">{parseFloat(form.ratedPressure) > 0 ? parseFloat(form.ratedPressure).toFixed(1) : "—"}</td>
                            <td className={cn("px-3 py-2 font-bold", parseFloat(form.fadRunningPressure) < parseFloat(form.ratedPressure) ? "text-red-400" : "text-emerald-400")}>
                              {parseFloat(form.fadRunningPressure) > 0 ? parseFloat(form.fadRunningPressure).toFixed(1) : "—"}
                            </td>
                            <td className="px-3 py-2 text-slate-400">
                              {parseFloat(form.ratedPressure) > 0 && parseFloat(form.fadRunningPressure) > 0 ? (((parseFloat(form.fadRunningPressure) - parseFloat(form.ratedPressure)) / parseFloat(form.ratedPressure)) * 100).toFixed(1) + "%" : "—"}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Observations */}
                  <div className="space-y-1">
                    <Label htmlFor="fadDescription">FAD Test Observations / Comments</Label>
                    <Textarea id="fadDescription" className="h-16 text-xs" placeholder="Add observations specific to the FAD test..." value={form.fadDescription} onChange={(e) => setForm({ ...form, fadDescription: e.target.value })} />
                  </div>
                </div>
              ) : (
                <div className="p-8 text-center text-xs text-slate-500 border border-dashed border-white/10 rounded-lg">
                  Tick the check box above to input Free Air Delivery (Anemometer) velocity measurements.
                </div>
              )}
            </div>
        </CardContent>
      </Card>

      {/* Section 3: Pump-Up Test (tick to feed details) */}
      <Card className="bg-slate-950/40 border-white/10 backdrop-blur-md">
        <CardContent className="space-y-6 pt-6">
            <div className="space-y-6 animate-fade-in">
              <div className="flex items-center justify-between border-b border-white/5 pb-3">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="pumpActive"
                    className="w-4 h-4 text-sky-500 accent-sky-500 bg-slate-950 border-white/10 rounded"
                    checked={form.pumpActive}
                    onChange={(e) => setForm({ ...form, pumpActive: e.target.checked })}
                  />
                  <Label htmlFor="pumpActive" className="text-sm font-semibold cursor-pointer">Perform Receiver Tank Pump-Up Test</Label>
                </div>
              </div>

              {form.pumpActive ? (
                <div className="space-y-6">
                  {/* Load / Unload pressures — required before save */}
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
                    <div className="text-[10px] text-amber-400 uppercase tracking-widest font-semibold mb-2">Load / Unload Pressures (required, one decimal only)</div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <Label htmlFor="pumpLoadPressure">Load Pressure (bar) <span className="text-red-500">*</span></Label>
                        <Input id="pumpLoadPressure" inputMode="decimal" value={form.loadPressure} onChange={(e) => setOneDecimal("loadPressure")(e.target.value)} placeholder="e.g. 6.5" />
                      </div>
                      <div>
                        <Label htmlFor="pumpUnloadPressure">Unload Pressure (bar) <span className="text-red-500">*</span></Label>
                        <Input id="pumpUnloadPressure" inputMode="decimal" value={form.unloadPressure} onChange={(e) => setOneDecimal("unloadPressure")(e.target.value)} placeholder="e.g. 7.5" />
                      </div>
                    </div>
                  </div>

                  {/* Step A: Tank Volume definition */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-xs uppercase tracking-wider text-sky-400 font-semibold">A. Receiver Tank Volume</h3>
                      <button
                        type="button"
                        onClick={() => setShowVolumeHelper(!showVolumeHelper)}
                        className="text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1"
                      >
                        <HelpCircle className="size-3.5" />
                        Calculate from Dimensions
                      </button>
                    </div>

                    {showVolumeHelper && (
                      <div className="p-4 rounded-xl border border-white/5 bg-slate-900/30 grid gap-3 md:grid-cols-3 mb-3 animate-fade-in text-xs">
                        <div>
                          <Label className="text-[10px] text-slate-400">Calculation Method</Label>
                          <select
                            className="h-8 w-full rounded border border-white/10 bg-slate-950 px-2 text-xs mt-1 text-slate-200"
                            value={form.pumpTankCalcMethod}
                            onChange={(e) => setForm({ ...form, pumpTankCalcMethod: e.target.value })}
                          >
                            <option value="Direct">Direct Volume Entry</option>
                            <option value="DiaLength">Diameter & Length</option>
                            <option value="PeriLength">Perimeter & Length</option>
                          </select>
                        </div>

                        {form.pumpTankCalcMethod === "DiaLength" && (
                          <>
                            <div>
                              <Label className="text-[10px] text-slate-400">Tank Diameter (mm)</Label>
                              <Input className="h-8 text-xs mt-1" type="number" step="1" value={form.pumpTankDia} onChange={(e) => setForm({ ...form, pumpTankDia: e.target.value })} placeholder="e.g. 1200" />
                            </div>
                            <div>
                              <Label className="text-[10px] text-slate-400">Tank Length (mm)</Label>
                              <Input className="h-8 text-xs mt-1" type="number" step="1" value={form.pumpTankLength} onChange={(e) => setForm({ ...form, pumpTankLength: e.target.value })} placeholder="e.g. 2500" />
                            </div>
                          </>
                        )}

                        {form.pumpTankCalcMethod === "PeriLength" && (
                          <>
                            <div>
                              <Label className="text-[10px] text-slate-400">Tank Perimeter (mm)</Label>
                              <Input className="h-8 text-xs mt-1" type="number" step="1" value={form.pumpTankPeri} onChange={(e) => setForm({ ...form, pumpTankPeri: e.target.value })} placeholder="e.g. 3770" />
                            </div>
                            <div>
                              <Label className="text-[10px] text-slate-400">Tank Length (mm)</Label>
                              <Input className="h-8 text-xs mt-1" type="number" step="1" value={form.pumpTankLength} onChange={(e) => setForm({ ...form, pumpTankLength: e.target.value })} placeholder="e.g. 2500" />
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <Label htmlFor="pumpTankVolume">Tank Volume</Label>
                        <div className="flex">
                          <Input
                            id="pumpTankVolume"
                            type="number"
                            step="0.1"
                            className="rounded-r-none border-r-0"
                            disabled={form.pumpTankCalcMethod !== "Direct"}
                            value={form.pumpTankVolume}
                            onChange={(e) => setForm({ ...form, pumpTankVolume: e.target.value })}
                            placeholder="e.g. 1000"
                          />
                          <select
                            className="h-9 rounded-md rounded-l-none border border-white/10 bg-slate-950/50 px-2 text-xs text-slate-200 select-none"
                            value={form.pumpTankVolumeUnit}
                            onChange={(e) => setForm({ ...form, pumpTankVolumeUnit: e.target.value })}
                          >
                            <option value="Liters">Liters</option>
                            <option value="m3">m³</option>
                          </select>
                        </div>
                      </div>
                      <div className="flex items-end text-xs text-slate-400 pb-2">
                        Equivalent Tank Volume in Cubic Meters: <strong className="text-white ml-1.5">{pumpTankVolumeM3.toFixed(3)} m³</strong>
                      </div>
                    </div>
                  </div>

                  <hr className="border-white/5" />

                  {/* Step B: Pressure & Time */}
                  <div>
                    <h3 className="text-xs uppercase tracking-wider text-sky-400 font-semibold mb-3">B. Audit Timelines & Pressures</h3>
                    <div className="grid gap-4 md:grid-cols-3">
                      <div>
                        <Label htmlFor="pumpP1">Starting Pressure, P1 (bar gauge)</Label>
                        <Input id="pumpP1" type="number" step="0.1" value={form.pumpP1} onChange={(e) => setForm({ ...form, pumpP1: e.target.value })} placeholder="e.g. 1.0" />
                      </div>
                      <div>
                        <Label htmlFor="pumpP2">Ending Pressure, P2 (bar gauge)</Label>
                        <Input id="pumpP2" type="number" step="0.1" value={form.pumpP2} onChange={(e) => setForm({ ...form, pumpP2: e.target.value })} placeholder="e.g. 7.0" />
                      </div>
                      <div>
                        <Label htmlFor="pumpTimeSec">Pump-Up Duration (seconds)</Label>
                        <Input id="pumpTimeSec" type="number" value={form.pumpTimeSec} onChange={(e) => setForm({ ...form, pumpTimeSec: e.target.value })} placeholder="e.g. 120" />
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2 mt-4">
                      <div>
                        <Label htmlFor="pumpRunningPressure">Running Pressure shown on screen (Bar)</Label>
                        <Input id="pumpRunningPressure" type="number" step="0.1" value={form.pumpRunningPressure} onChange={(e) => setForm({ ...form, pumpRunningPressure: e.target.value })} placeholder="e.g. 6.1" />
                      </div>
                      <div>
                        <Label htmlFor="pumpMeasuredPower">Actual Measured Power (kW)</Label>
                        <Input id="pumpMeasuredPower" type="number" step="0.1" value={form.pumpMeasuredPower} onChange={(e) => setForm({ ...form, pumpMeasuredPower: e.target.value })} placeholder="e.g. 45.2" />
                      </div>
                    </div>

                    {/* Compressed Air Temperature — highlighted, auto temp correction factor */}
                    <div className="mt-4 rounded-xl border-2 border-amber-500/40 bg-amber-500/10 p-4 grid gap-4 md:grid-cols-2 items-end shadow-[0_0_12px_rgba(245,158,11,0.15)]">
                      <div>
                        <Label htmlFor="pumpAirTempC" className="text-amber-300">Compressed Air Temperature, T (°C)</Label>
                        <Input
                          id="pumpAirTempC"
                          type="number"
                          step="0.1"
                          className="mt-1 border-amber-500/40 bg-amber-500/5 focus-visible:ring-amber-500/40"
                          value={form.pumpAirTempC}
                          onChange={(e) => setForm({ ...form, pumpAirTempC: e.target.value })}
                          placeholder="e.g. 40"
                        />
                      </div>
                      <div className="text-xs text-amber-200/80 pb-1">
                        Temperature Correction Factor <span className="text-slate-400">= 273 / (273 + T)</span>
                        <strong className="text-amber-300 text-lg block">{pumpTempFactor > 0 ? pumpTempFactor.toFixed(4) : "—"}</strong>
                      </div>
                    </div>
                  </div>

                  <hr className="border-white/5" />

                  {/* Step C: Stopwatch & Pressure-Time lap table */}
                  <div>
                    <h3 className="text-xs uppercase tracking-wider text-sky-400 font-semibold mb-3">C. Stopwatch — Pressure vs Time Laps</h3>
                    <div className="rounded-xl border border-white/10 bg-slate-900/50 p-4 flex flex-col items-center gap-3">
                      <div className="text-4xl font-mono font-bold text-white tabular-nums">{formatSw(swElapsed)}</div>
                      <div className="flex flex-wrap justify-center gap-2">
                        {!swRunning ? (
                          <Button type="button" onClick={() => setSwRunning(true)} className="gap-1.5" disabled={pumpPressureRows.length === 0 || nextLapIndex === -1}>
                            <Play className="size-4" /> {swElapsed > 0 ? "Resume" : "Start"}
                          </Button>
                        ) : (
                          <Button type="button" variant="secondary" onClick={() => setSwRunning(false)}>Stop</Button>
                        )}
                        <Button type="button" variant="secondary" onClick={handleLap} disabled={!swRunning || nextLapIndex === -1}>
                          Lap {nextLapIndex === -1 ? "(done)" : `(${nextLapIndex + 1}/${lapTimes.length})`}
                        </Button>
                        <Button type="button" variant="destructive" onClick={handleSwReset} disabled={swElapsed === 0 && (nextLapIndex === 0 || lapTimes.length === 0)}>
                          Reset
                        </Button>
                      </div>
                      <p className="text-[10px] text-slate-500 text-center max-w-md">
                        Press Start when the motor starts at 0 bar, then press Lap at every pressure step in the table — the time is fed automatically in serial order.
                        The watch stops itself when the last step is fed. Use Stop for any sudden accident and Resume to continue.
                      </p>
                    </div>

                    {pumpPressureRows.length > 0 ? (
                      <div className="overflow-x-auto rounded-xl border border-white/10 mt-3">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-slate-500 border-b border-white/5 bg-slate-950/40 text-left">
                              <th className="px-3 py-2">#</th>
                              <th className="px-3 py-2">Pressure (bar)</th>
                              <th className="px-3 py-2">Lap Time (s)</th>
                              <th className="px-3 py-2">FAD (m³/min)</th>
                              <th className="px-3 py-2">FAD × Temp Factor (m³/min)</th>
                              <th className="px-3 py-2 text-amber-400">kWh Input</th>
                            </tr>
                          </thead>
                          <tbody>
                            {pumpLapRows.map((row, idx) => {
                              const isEditable = row.pressure === parseFloat(form.pumpP2) || row.pressure === parseFloat(form.loadPressure);
                              return (
                                <tr key={idx} className={cn("border-t border-white/5", idx === nextLapIndex && swRunning && "bg-sky-500/10", isEditable && "bg-amber-500/5")}>
                                  <td className="px-3 py-2 text-slate-500">{idx + 1}</td>
                                  <td className="px-3 py-2 text-slate-200 font-mono">
                                    {row.pressure.toFixed(1)}
                                    {isEditable && <span className="ml-2 text-[10px] text-amber-500/70 uppercase tracking-widest">{row.pressure === parseFloat(form.pumpP2) ? "P2" : "Load"}</span>}
                                  </td>
                                  <td className="px-3 py-2 font-mono">
                                    {row.timeSec !== null && row.timeSec !== undefined
                                      ? <span className="text-emerald-400">{row.timeSec.toFixed(1)}</span>
                                      : <span className="text-slate-600">—</span>}
                                  </td>
                                  <td className="px-3 py-2 text-slate-200">{row.fadM3Min > 0 ? row.fadM3Min.toFixed(3) : "—"}</td>
                                  <td className="px-3 py-2 text-sky-300 font-semibold">{row.fadM3Min > 0 ? row.fadCorrM3Min.toFixed(3) : "—"}</td>
                                  <td className="px-3 py-2">
                                    {isEditable ? (
                                      <Input
                                        type="number"
                                        step="0.001"
                                        className="h-7 w-20 text-xs px-2 bg-slate-950 border-amber-500/30 text-amber-100 focus-visible:ring-amber-500"
                                        value={lapKwh[idx] || ""}
                                        onChange={(e) => {
                                          const next = [...lapKwh];
                                          next[idx] = e.target.value;
                                          setLapKwh(next);
                                        }}
                                        placeholder="kWh"
                                      />
                                    ) : (
                                      <span className="text-slate-600 ml-4">—</span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-[11px] text-slate-500 mt-3">
                        Enter the Ending Pressure P2 above to generate the pressure steps (0 → 5 bar in 1.0 steps, then 0.5 steps till P2).
                      </p>
                    )}

                    {(pumpPowerAtLoadUnload !== null || pumpFadAtLoadUnloadM3Min !== null) && (
                      <div className="mt-4 grid gap-4 md:grid-cols-2 animate-fade-in">
                        {pumpPowerAtLoadUnload !== null && (
                          <div className="p-4 rounded-xl border border-amber-500/50 bg-amber-500/10 shadow-[0_0_15px_rgba(245,158,11,0.2)] text-center flex flex-col justify-center">
                            <span className="text-xs uppercase tracking-widest text-amber-400/80 font-bold block mb-1">Calculated Power at Load/Unload</span>
                            <div className="text-3xl font-mono font-bold text-amber-400">
                              {pumpPowerAtLoadUnload.toFixed(2)} <span className="text-lg">kW</span>
                            </div>
                          </div>
                        )}
                        {pumpFadAtLoadUnloadM3Min !== null && (
                          <div className="p-4 rounded-xl border border-sky-500/50 bg-sky-500/10 shadow-[0_0_15px_rgba(14,165,233,0.2)] text-center flex flex-col justify-center">
                            <span className="text-xs uppercase tracking-widest text-sky-400/80 font-bold block mb-1">FAD at Load / Unload</span>
                            <div className="text-3xl font-mono font-bold text-sky-400">
                              {pumpFadAtLoadUnloadM3Min.toFixed(3)} <span className="text-lg">m³/min</span>
                            </div>
                            <div className="text-xs text-sky-300/70 mt-1">
                              {(pumpFadAtLoadUnloadM3Min * 35.3147).toFixed(1)} CFM
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Pump Up Results summary */}
                  {pumpActualFadM3Min > 0 && (
                    <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4 space-y-3">
                      <div className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Pump-Up Test Results Summary</div>
                      <div className="grid grid-cols-2 gap-4 text-xs">
                        <div>
                          <span className="text-slate-500 block">Actual FAD (m³/min):</span>
                          <strong className="text-sky-300 text-sm">{pumpActualFadM3Min.toFixed(3)} m³/min</strong>
                        </div>
                        <div>
                          <span className="text-slate-500 block">Actual FAD (CFM):</span>
                          <strong className="text-sky-300 text-sm">{pumpActualFadCfm.toFixed(1)} CFM</strong>
                        </div>
                        {pumpTempFactor > 0 && (
                          <>
                            <div>
                              <span className="text-slate-500 block">Temp Correction Factor:</span>
                              <strong className="text-amber-300 text-sm">{pumpTempFactor.toFixed(4)}</strong>
                            </div>
                            <div>
                              <span className="text-slate-500 block">Temp Corrected FAD (m³/min):</span>
                              <strong className="text-amber-300 text-sm">{(pumpActualFadM3Min * pumpTempFactor).toFixed(3)} m³/min</strong>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Pump-Up Comparison Table */}
                  {ratedCapVal > 0 && pumpActualFadM3Min > 0 && (
                    <div className="rounded-xl border border-white/10 overflow-hidden">
                      <div className="bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-300 border-b border-white/10 uppercase tracking-wider">
                        Design vs. Actual Comparison (Pump-Up FAD)
                      </div>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-slate-500 border-b border-white/5 bg-slate-950/40 text-left">
                            <th className="px-3 py-2">Parameter</th>
                            <th className="px-3 py-2">Design (Rated)</th>
                            <th className="px-3 py-2">Actual (Pump-Up)</th>
                            <th className="px-3 py-2">Deviation</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="border-b border-white/5">
                            <td className="px-3 py-2 text-slate-400">Flow Capacity (m³/min)</td>
                            <td className="px-3 py-2 text-slate-200">{ratedM3Min.toFixed(2)}</td>
                            <td className={cn("px-3 py-2 font-bold", pumpActualFadM3Min < ratedM3Min ? "text-red-400" : "text-emerald-400")}>
                              {pumpActualFadM3Min.toFixed(2)}
                            </td>
                            <td className="px-3 py-2 text-slate-400">
                              {(((pumpActualFadM3Min - ratedM3Min) / ratedM3Min) * 100).toFixed(1)}%
                            </td>
                          </tr>
                          <tr className="border-b border-white/5">
                            <td className="px-3 py-2 text-slate-400">Flow Capacity (CFM)</td>
                            <td className="px-3 py-2 text-slate-200">{ratedCfmEquivalent.toFixed(1)}</td>
                            <td className={cn("px-3 py-2 font-bold", pumpActualFadCfm < ratedCfmEquivalent ? "text-red-400" : "text-emerald-400")}>
                              {pumpActualFadCfm.toFixed(1)}
                            </td>
                            <td className="px-3 py-2 text-slate-400">
                              {(((pumpActualFadCfm - ratedCfmEquivalent) / ratedCfmEquivalent) * 100).toFixed(1)}%
                            </td>
                          </tr>
                          <tr className="border-b border-white/5">
                            <td className="px-3 py-2 text-slate-400">Power (kW)</td>
                            <td className="px-3 py-2 text-slate-200">{ratedKwVal.toFixed(1)}</td>
                            <td className={cn("px-3 py-2 font-bold", parseFloat(form.pumpMeasuredPower) > ratedKwVal ? "text-red-400" : "text-emerald-400")}>
                              {parseFloat(form.pumpMeasuredPower) > 0 ? parseFloat(form.pumpMeasuredPower).toFixed(1) : "—"}
                            </td>
                            <td className="px-3 py-2 text-slate-400">
                              {ratedKwVal > 0 && parseFloat(form.pumpMeasuredPower) > 0 ? (((parseFloat(form.pumpMeasuredPower) - ratedKwVal) / ratedKwVal) * 100).toFixed(1) + "%" : "—"}
                            </td>
                          </tr>
                          <tr>
                            <td className="px-3 py-2 text-slate-400">Pressure (bar)</td>
                            <td className="px-3 py-2 text-slate-200">{parseFloat(form.ratedPressure) > 0 ? parseFloat(form.ratedPressure).toFixed(1) : "—"}</td>
                            <td className={cn("px-3 py-2 font-bold", parseFloat(form.pumpRunningPressure) < parseFloat(form.ratedPressure) ? "text-red-400" : "text-emerald-400")}>
                              {parseFloat(form.pumpRunningPressure) > 0 ? parseFloat(form.pumpRunningPressure).toFixed(1) : "—"}
                            </td>
                            <td className="px-3 py-2 text-slate-400">
                              {parseFloat(form.ratedPressure) > 0 && parseFloat(form.pumpRunningPressure) > 0 ? (((parseFloat(form.pumpRunningPressure) - parseFloat(form.ratedPressure)) / parseFloat(form.ratedPressure)) * 100).toFixed(1) + "%" : "—"}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Observations */}
                  <div className="space-y-1">
                    <Label htmlFor="pumpDescription">Pump-Up Test Observations / Comments</Label>
                    <Textarea id="pumpDescription" className="h-16 text-xs" placeholder="Add observations specific to the pump-up test..." value={form.pumpDescription} onChange={(e) => setForm({ ...form, pumpDescription: e.target.value })} />
                  </div>
                </div>
              ) : (
                <div className="p-8 text-center text-xs text-slate-500 border border-dashed border-white/10 rounded-lg">
                  Tick the check box above to input Receiver Tank Pump-Up timelines and calculate actual FAD.
                </div>
              )}
            </div>
        </CardContent>
      </Card>

      {/* Section 4: General Observations & Photo (tick to feed details) */}
      <Card className="bg-slate-950/40 border-white/10 backdrop-blur-md">
        <CardContent className="space-y-6 pt-6">
            <div className="space-y-6 animate-fade-in">
              <div className="flex items-center justify-between border-b border-white/5 pb-3">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="notesActive"
                    className="w-4 h-4 text-sky-500 accent-sky-500 bg-slate-950 border-white/10 rounded"
                    checked={notesActive}
                    onChange={(e) => setNotesActive(e.target.checked)}
                  />
                  <Label htmlFor="notesActive" className="text-sm font-semibold cursor-pointer">Add General Observations &amp; Equipment Photo</Label>
                </div>
              </div>

              {notesActive ? (
              <div className="space-y-6">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="description">General Audit Observations & Comments</Label>
                    <Textarea id="description" className="h-32 text-sm" placeholder="Add general remarks about compressor health, maintenance cycle, environment, etc..." value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                  </div>
  
                  <div className="space-y-2">
                    <Label>Equipment Photo</Label>
                    <div className="flex flex-col gap-2">
                      <div className="flex gap-2">
                        <Button type="button" variant="secondary" onClick={handleCapturePhoto} className="flex-1 gap-2 h-9 text-xs">
                          <Camera className="size-4" />
                          Capture Nameplate Photo
                        </Button>
                        {(capturedPhoto || existingPhotoPath) && (
                          <Button type="button" variant="ghost" onClick={() => { setCapturedPhoto(null); setExistingPhotoPath(null); }} className="text-red-400 hover:text-red-300 hover:bg-red-500/10 px-3">
                            Clear
                          </Button>
                        )}
                      </div>
                      {capturedPhoto && (
                        <div className="relative border border-sky-500/30 rounded-lg p-2 bg-slate-900 flex items-center gap-3">
                          <img src={capturedPhoto} alt="Preview" className="h-12 w-16 object-cover rounded bg-black" />
                          <div className="flex-1 min-w-0">
                            <p className="text-[10px] text-emerald-400 font-medium">New photo captured</p>
                            <p className="text-[9px] text-slate-500 truncate font-mono">Will save on submit</p>
                          </div>
                        </div>
                      )}
                      {!capturedPhoto && existingPhotoPath && (
                        <div className="border border-white/10 rounded-lg p-2 bg-slate-900 flex items-center gap-3">
                          <div className="h-12 w-16 rounded bg-slate-950 flex items-center justify-center text-slate-500 border border-white/5">
                            <ImageIcon className="size-6" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[10px] text-sky-300 font-medium">Saved photo path:</p>
                            <p className="text-[9px] text-slate-400 truncate font-mono" title={existingPhotoPath}>{existingPhotoPath}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="border border-white/5 bg-slate-900/30 p-4 rounded-xl">
                  <h4 className="text-xs uppercase tracking-wider text-sky-400 font-semibold mb-4">Numerical Observations</h4>
                  <div className="grid gap-4 md:grid-cols-3">
                    <div>
                      <Label htmlFor="obsCompSituation">Comp Situation</Label>
                      <Input id="obsCompSituation" type="number" step="0.1" value={form.obsCompSituation} onChange={(e) => setForm({ ...form, obsCompSituation: e.target.value })} />
                    </div>
                    <div>
                      <Label htmlFor="obsCompDischarge">Comp Discharge</Label>
                      <Input id="obsCompDischarge" type="number" step="0.1" value={form.obsCompDischarge} onChange={(e) => setForm({ ...form, obsCompDischarge: e.target.value })} />
                    </div>
                    <div>
                      <Label htmlFor="obsOilSap">Oil Sap</Label>
                      <Input id="obsOilSap" type="number" step="0.1" value={form.obsOilSap} onChange={(e) => setForm({ ...form, obsOilSap: e.target.value })} />
                    </div>
                    <div>
                      <Label htmlFor="obsOilRadiatorIn">Oil Radiator In</Label>
                      <Input id="obsOilRadiatorIn" type="number" step="0.1" value={form.obsOilRadiatorIn} onChange={(e) => setForm({ ...form, obsOilRadiatorIn: e.target.value })} />
                    </div>
                    <div>
                      <Label htmlFor="obsOilRadiatorOut">Oil Radiator Out</Label>
                      <Input id="obsOilRadiatorOut" type="number" step="0.1" value={form.obsOilRadiatorOut} onChange={(e) => setForm({ ...form, obsOilRadiatorOut: e.target.value })} />
                    </div>
                    <div>
                      <Label htmlFor="obsAirRadiatorIn">Air Radiator In</Label>
                      <Input id="obsAirRadiatorIn" type="number" step="0.1" value={form.obsAirRadiatorIn} onChange={(e) => setForm({ ...form, obsAirRadiatorIn: e.target.value })} />
                    </div>
                    <div>
                      <Label htmlFor="obsAirRadiatorOut">Air Radiator Out</Label>
                      <Input id="obsAirRadiatorOut" type="number" step="0.1" value={form.obsAirRadiatorOut} onChange={(e) => setForm({ ...form, obsAirRadiatorOut: e.target.value })} />
                    </div>
                    <div>
                      <Label htmlFor="obsCompFinalDischarge">Comp Final Discharge</Label>
                      <Input id="obsCompFinalDischarge" type="number" step="0.1" value={form.obsCompFinalDischarge} onChange={(e) => setForm({ ...form, obsCompFinalDischarge: e.target.value })} />
                    </div>
                    <div>
                      <Label htmlFor="obsCompMotor">Comp Motor</Label>
                      <Input id="obsCompMotor" type="number" step="0.1" value={form.obsCompMotor} onChange={(e) => setForm({ ...form, obsCompMotor: e.target.value })} />
                    </div>
                  </div>
                  <div className="mt-4 border-t border-white/5 pt-4">
                    <Label htmlFor="obsThermalImageNo" className="text-amber-400">Add photo no. of captured thermal image</Label>
                    <Input id="obsThermalImageNo" className="max-w-xs mt-1" value={form.obsThermalImageNo} onChange={(e) => setForm({ ...form, obsThermalImageNo: e.target.value })} placeholder="e.g. IMG-2039" />
                  </div>
                </div>
              </div>
              ) : (
                <div className="p-8 text-center text-xs text-slate-500 border border-dashed border-white/10 rounded-lg">
                  Tick the check box above to add general observations and capture the equipment photo.
                </div>
              )}
            </div>

          {/* Core submission bar */}
          <div className="flex items-center gap-2 pt-4 border-t border-white/5">
            <Button onClick={handleSubmit}>{editingId ? "Update Entry" : "Save Compressor Audit"}</Button>
            <Button variant="secondary" onClick={resetForm}>Clear / Cancel</Button>
          </div>
        </CardContent>
      </Card>

      {/* Compressor Records List */}
      <Card className="bg-slate-950/40 border-white/10 backdrop-blur-md">
        <CardHeader>
          <CardTitle>Audited Compressor Entries</CardTitle>
          <CardDescription className="text-xs text-slate-400">Click on any entry to see full velocity matrices, timelines, and audit measurements.</CardDescription>
        </CardHeader>
        <CardContent>
          {compressors.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-400 border-b border-white/10 text-left">
                    <th className="px-3 py-2">Tag</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">Rated Power</th>
                    <th className="px-3 py-2">FAD Test</th>
                    <th className="px-3 py-2">Pump Test</th>
                    <th className="px-3 py-2">Load Factor</th>
                    <th className="px-3 py-2">Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {compressors.map((c) => (
                    <React.Fragment key={c.id}>
                      <tr 
                        className="border-t border-white/5 hover:bg-white/5 cursor-pointer font-medium" 
                        onClick={() => setExpanded(expanded === c.id ? null : c.id)}
                      >
                        <td className="px-3 py-3 font-mono font-bold text-sky-400">{c.machineTag}</td>
                        <td className="px-3 py-3 text-slate-300">{c.compressorType}</td>
                        <td className="px-3 py-3 text-slate-300">{c.ratedKw} kW</td>
                        <td className="px-3 py-3 text-slate-300">
                          {c.fadActive ? (
                            <span className="text-emerald-400 font-semibold">{c.fadAirDeliveryCfm?.toFixed(1)} CFM</span>
                          ) : (
                            <span className="text-slate-500">Not run</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-slate-300">
                          {c.pumpActive ? (
                            <span className="text-emerald-400 font-semibold">{c.pumpActualFadCfm?.toFixed(1)} CFM</span>
                          ) : (
                            <span className="text-slate-500">Not run</span>
                          )}
                        </td>
                        <td className={cn("px-3 py-3 font-bold", (c.loadFactor ?? 0) > 120 ? "text-red-400" : "text-emerald-400")}>
                          {Number(c.loadFactor ?? 0).toFixed(2)}%
                        </td>
                        <td className="px-3 py-3 text-[10px] text-slate-500">
                          {new Date(c.createdAt).toLocaleString("en-IN")}
                        </td>
                      </tr>
                      {expanded === c.id && (
                        <tr className="bg-slate-900/30">
                          <td colSpan={7} className="px-4 py-3">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-slate-300">
                              <div><span className="block text-[9px] uppercase text-slate-500">Make & Model</span>{c.makeModel || "N/A"}</div>
                              <div><span className="block text-[9px] uppercase text-slate-500">Sr. No. (Serial)</span>{c.serialNo || "N/A"}</div>
                              <div><span className="block text-[9px] uppercase text-slate-500">Year</span>{c.yearOfManufacture || "N/A"}</div>
                              <div><span className="block text-[9px] uppercase text-slate-500">Starter</span>{c.starterType}</div>
                              <div><span className="block text-[9px] uppercase text-slate-500">Rated RPM</span>{c.ratedRpm || "N/A"}</div>
                              <div><span className="block text-[9px] uppercase text-slate-500">Rated Current</span>{c.ratedCurrent ? `${c.ratedCurrent} A` : "N/A"}</div>
                              <div><span className="block text-[9px] uppercase text-slate-500">Motor Efficiency</span>{c.motorEfficiency ? `${c.motorEfficiency} %` : "N/A"}</div>
                              <div><span className="block text-[9px] uppercase text-slate-500">Process Pressure</span>{c.processPressure ? `${c.processPressure} bar` : "N/A"}</div>
                              <div><span className="block text-[9px] uppercase text-slate-500">Operating Days</span>{c.annualOperatingDays ? `${c.annualOperatingDays} days/year` : "N/A"}</div>
                              <div><span className="block text-[9px] uppercase text-slate-500">Power Cost</span>{c.powerCost ? `Rs. ${c.powerCost}/hour` : "N/A"}</div>
                              <div><span className="block text-[9px] uppercase text-slate-500">Design SEC</span>{c.designedSec ? `${Number(c.designedSec).toFixed(3)} kW/CFM` : "N/A"}</div>
                              <div><span className="block text-[9px] uppercase text-slate-500">Design Air Gen</span>{c.designedAirGen ? `${Number(c.designedAirGen).toFixed(2)} CFM/kW` : "N/A"}</div>
                              <div><span className="block text-[9px] uppercase text-slate-500">Load / Unload Mode</span>{c.luType === "VFD" ? "VFD" : "Star Delta"}</div>
                              {(c.loadPressure != null || c.unloadPressure != null) && (
                                <div><span className="block text-[9px] uppercase text-slate-500">Load / Unload Press</span>{c.loadPressure ?? "—"} / {c.unloadPressure ?? "—"} bar</div>
                              )}
                              
                              {c.fadActive && (
                                <div className="col-span-full border-t border-white/5 pt-3">
                                  <span className="block text-[10px] font-bold text-sky-400 uppercase tracking-widest mb-1.5">Anemometer FAD Audit Logs</span>
                                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                                    <div>Area Shape: <strong className="text-white">{c.fadAreaType}</strong></div>
                                    <div>Suction Area: <strong className="text-white">{c.fadSuctionArea?.toFixed(4)} Sqm</strong></div>
                                    <div>Avg Velocity: <strong className="text-white">{c.fadAvgVelocity?.toFixed(2)} m/s</strong></div>
                                    <div>Total Points: <strong className="text-white">{c.fadNumPoints}</strong></div>
                                    <div>Actual Capacity: <strong className="text-sky-300 font-semibold">{c.fadAirDeliveryCfm?.toFixed(1)} CFM</strong></div>
                                    <div>Actual SEC: <strong className="text-sky-300 font-semibold">{c.fadActualSec?.toFixed(3)} kW/CFM</strong></div>
                                    <div>FAD Comment: <span className="text-slate-400 block">{c.fadDescription || "None"}</span></div>
                                  </div>
                                </div>
                              )}

                              {c.pumpActive && (
                                <div className="col-span-full border-t border-white/5 pt-3">
                                  <span className="block text-[10px] font-bold text-sky-400 uppercase tracking-widest mb-1.5">Pump-Up Audit Logs</span>
                                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                                    <div>Tank Volume: <strong className="text-white">{c.pumpTankVolume} {c.pumpTankVolumeUnit}</strong></div>
                                    <div>P1 &rarr; P2 Pressures: <strong className="text-white">{c.pumpP1} &rarr; {c.pumpP2} bar</strong></div>
                                    <div>Pump Up Time: <strong className="text-white">{c.pumpTimeSec} seconds</strong></div>
                                    <div>Air Temp: <strong className="text-white">{c.pumpAirTempC != null ? `${c.pumpAirTempC} °C` : "N/A"}</strong></div>
                                    <div>Temp Correction Factor: <strong className="text-amber-300">{c.pumpTempFactor ? Number(c.pumpTempFactor).toFixed(4) : "N/A"}</strong></div>
                                    <div>Actual FAD: <strong className="text-sky-300 font-semibold">{c.pumpActualFadCfm?.toFixed(1)} CFM</strong></div>
                                    <div>Pump Comment: <span className="text-slate-400 block">{c.pumpDescription || "None"}</span></div>
                                  </div>
                                </div>
                              )}

                              <div className="col-span-full border-t border-white/5 pt-3">
                                <span className="block text-[9px] uppercase text-slate-500">General Notes & Observations</span>
                                <p className="text-xs text-slate-200 mt-1">{c.description || "N/A"}</p>
                              </div>

                              <div className="col-span-full flex justify-end gap-2 border-t border-white/5 pt-3">
                                <Button variant="secondary" size="sm" onClick={(ev) => { ev.stopPropagation(); handleEdit(c); }}>Edit</Button>
                                <Button variant="destructive" size="sm" onClick={(ev) => { ev.stopPropagation(); deleteCompressor(c.id); }}>Delete</Button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-slate-500 text-xs py-4 text-center">No compressor records audited yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
