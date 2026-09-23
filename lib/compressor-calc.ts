import type { CompressorEntry } from "@/lib/store";

// ─────────────────────────────────────────────────────────────────────────────
// The figures behind the pump-up test, in one place.
//
// The receiver is not the only volume the compressor fills: the pipe between
// the compressor and the receiver, and the pipe leaving it, hold air too, and
// leaving them out makes the measured FAD read low. So the pump-up arithmetic
// uses the MAIN VOLUME:
//
//     main volume = tank volume + inlet pipe volume + outlet pipe volume
//
// Both pipes are optional — a plant that only knows its receiver still works
// exactly as before, because an absent pipe contributes zero.
//
// A pipe is measured with a tape around it, so it is entered as PERIMETER and
// LENGTH (never diameter): for a circular pipe of perimeter P, r = P / 2π and
// the bore area is π r² = P² / 4π.
//
// The same module is used by the compressor form, the PDF and the Excel
// export, so the three can never disagree. PostMan mirrors it in
// `compressorCalc` — see docs/POSTMAN.md before changing a formula here.
// ─────────────────────────────────────────────────────────────────────────────

export const M3MIN_TO_CFM = 35.3147;
/** Atmospheric pressure the pump-up formula normalises to (bar). */
export const ATM_BAR = 1.013;

export const n = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

/** Bore area of a pipe from the tape measurement around it. mm → m². */
export function pipeAreaM2(perimeterMm: unknown): number | null {
  const p = n(perimeterMm);
  if (p === null || p <= 0) return null;
  const pm = p / 1000;
  return (pm * pm) / (4 * Math.PI);
}

/** Volume of one pipe run, from perimeter and length only. mm → m³. */
export function pipeVolumeM3(perimeterMm: unknown, lengthMm: unknown): number | null {
  const area = pipeAreaM2(perimeterMm);
  const l = n(lengthMm);
  if (area === null || l === null || l <= 0) return null;
  return area * (l / 1000);
}

/** The receiver on its own, in m³, whichever way it was entered. */
export function tankVolumeM3(c: Partial<CompressorEntry>): number | null {
  const v = n(c.pumpTankVolume);
  if (v === null || v <= 0) return null;
  return c.pumpTankVolumeUnit === "Liters" ? v / 1000 : v;
}

export type MainVolume = {
  tank: number | null;
  inlet: number | null;
  outlet: number | null;
  /** tank + whichever pipes were measured; null when even the tank is unknown */
  total: number | null;
  /** how the total was made up, for the report */
  basis: string;
};

export function mainVolume(c: Partial<CompressorEntry>): MainVolume {
  const tank = tankVolumeM3(c);
  const inlet = c.pumpInletPipeActive ? pipeVolumeM3(c.pumpInletPipePeri, c.pumpInletPipeLength) : null;
  const outlet = c.pumpOutletPipeActive ? pipeVolumeM3(c.pumpOutletPipePeri, c.pumpOutletPipeLength) : null;
  const parts = [tank, inlet, outlet].filter((v): v is number => v !== null && v > 0);
  const total = parts.length ? parts.reduce((s, v) => s + v, 0) : null;

  const bits: string[] = [];
  if (tank !== null) bits.push(`tank ${tank.toFixed(3)}`);
  if (inlet !== null) bits.push(`inlet pipe ${inlet.toFixed(3)}`);
  if (outlet !== null) bits.push(`outlet pipe ${outlet.toFixed(3)}`);
  return { tank, inlet, outlet, total, basis: bits.length ? `${bits.join(" + ")} m³` : "not measured" };
}

/**
 * Pump-up free air delivery, m³/min:
 *     V × (P2 − P1) / (t/60 × 1.013)
 * and the same corrected for the temperature of the compressed air,
 * × 273 / (273 + T), which is what the report quotes as the actual FAD.
 */
export function pumpUpFad(volumeM3: number | null, p1: unknown, p2: unknown, timeSec: unknown, tempC?: unknown) {
  const v = volumeM3;
  const a = n(p1) ?? 0;
  const b = n(p2);
  const t = n(timeSec);
  if (v === null || v <= 0 || b === null || t === null || t <= 0 || b - a <= 0) {
    return { m3min: null as number | null, cfm: null as number | null, corrM3Min: null as number | null, corrCfm: null as number | null, tempFactor: null as number | null };
  }
  const m3min = (v * (b - a)) / ((t / 60) * ATM_BAR);
  const temp = n(tempC);
  const tempFactor = temp !== null ? 273 / (273 + temp) : null;
  const corr = tempFactor !== null ? m3min * tempFactor : m3min;
  return { m3min, cfm: m3min * M3MIN_TO_CFM, corrM3Min: corr, corrCfm: corr * M3MIN_TO_CFM, tempFactor };
}

export type PumpLap = { pressure: number; timeSec: number | null; fadM3Min: number; fadCorrM3Min: number; kwh?: string };

export function parseLaps(raw: unknown): PumpLap[] {
  if (typeof raw !== "string" || !raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as PumpLap[]) : [];
  } catch {
    return [];
  }
}

/** Energy drawn over the pump-up, from the energy-meter column of the lap table. */
export function lapEnergy(laps: PumpLap[]) {
  const stamped = laps.filter((l) => n(l.timeSec) !== null);
  const kwhs = laps.map((l) => n(l.kwh)).filter((v): v is number => v !== null);
  const first = kwhs.length ? kwhs[0] : null;
  const last = kwhs.length ? kwhs[kwhs.length - 1] : null;
  const used = first !== null && last !== null && last >= first ? last - first : null;
  const seconds = stamped.length ? n(stamped[stamped.length - 1].timeSec) : null;
  const avgKw = used !== null && seconds !== null && seconds > 0 ? (used * 3600) / seconds : null;
  return { readings: kwhs.length, first, last, used, seconds, avgKw };
}
