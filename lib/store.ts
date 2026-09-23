import { create } from 'zustand';
import { persist, StateStorage, createJSONStorage } from 'zustand/middleware';
import { get, set, del } from 'idb-keyval';

// IndexedDB storage adapter for Zustand
const idbStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    return (await get(name)) || null;
  },
  setItem: async (name: string, value: string): Promise<void> => {
    await set(name, value);
  },
  removeItem: async (name: string): Promise<void> => {
    await del(name);
  },
};

export type CompanyProfile = {
  id: string;
  companyName: string;
  area: string;
  district: string;
  state: string;
  pincode: string;
  overallConsumption: string | number; // accepts text input, stored as float
  updatedAt: string;
};

export type CompressorEntry = {
  id: string;
  companyProfileId?: string | null;
  machineTag: string;
  makeModel?: string | null;
  serialNo?: string | null;
  compressorType?: 'Reciprocating' | 'Screw' | 'Centrifugal' | 'Scroll' | null;
  yearOfManufacture?: string | null;
  ratedCapacity?: number | null;
  ratedCapacityUnit?: string | null; // "m3/min", "l/s", "CFM", "CMH"
  ratedPressure?: number | null; // bar or psi
  processPressure?: number | null;
  ratedKw: number;
  ratedHp?: number | null;
  ratedRpm?: number | null;
  ratedCurrent?: number | null;
  motorEfficiency?: number | null;
  annualOperatingDays?: number | null;
  powerCost?: number | null;
  starterType: 'DOL' | 'VFD' | 'SD';
  designedSec?: number | null;
  designedAirGen?: number | null;
  // Legacy Electrical inputs
  v1?: number | null;
  v2?: number | null;
  v3?: number | null;
  i1?: number | null;
  i2?: number | null;
  i3?: number | null;
  pf?: number | null;
  measuredKw?: number | null;
  kva?: number | null;
  kvar?: number | null;
  loadFactor?: number | null;
  
  // New Electrical inputs
  genLoadVoltage?: number | null;
  genLoadAmp?: number | null;
  genLoadPf?: number | null;
  genLoadKw?: number | null;
  genUnloadVoltage?: number | null;
  genUnloadAmp?: number | null;
  genUnloadPf?: number | null;
  genUnloadKw?: number | null;

  // Free Air Delivery (FAD) test parameters
  fadActive?: boolean;
  fadAreaType?: string | null; // "Rectangle", "Circle", "Direct"
  fadAreaL?: number | null;
  fadAreaB?: number | null;
  fadAreaDia?: number | null;
  fadAreaPeri?: number | null;
  fadAreaRadius?: number | null;
  fadAreaDirect?: number | null;
  fadNumPoints?: number | null;
  fadVelocities?: string | null; // serialized JSON array of velocities
  fadRunningPressure?: number | null;
  fadMeasuredPower?: number | null;
  fadSuctionArea?: number | null;
  fadAvgVelocity?: number | null;
  fadAirDeliveryM3Sec?: number | null;
  fadAirDeliveryM3Hr?: number | null;
  fadAirDeliveryCfm?: number | null;
  fadActualSec?: number | null;
  fadActualAirGen?: number | null;
  fadDescription?: string | null;
  
  // Load / Unload measurement table (rated parameters)
  luType?: 'SD' | 'VFD' | null;
  luData?: string | null; // serialized JSON of Val1/Val2/Val3 rows

  // Load / Unload pressures (required when FAD or Pump-Up test is ticked)
  loadPressure?: number | null;
  unloadPressure?: number | null;

  // Pump Up test parameters
  pumpActive?: boolean;
  pumpP1?: number | null;
  pumpP2?: number | null;
  pumpTimeSec?: number | null;
  pumpAirTempC?: number | null; // compressed air temperature (°C)
  pumpTempFactor?: number | null; // 273 / (273 + T)
  pumpLapData?: string | null; // serialized JSON [{pressure, timeSec, fadM3Min, fadCorrM3Min}]
  pumpTankVolume?: number | null;
  pumpTankVolumeUnit?: string | null; // "Liters", "m3"
  pumpTankCalcMethod?: string | null; // "Direct", "DiaLength", "PeriLength"
  pumpTankDia?: number | null;
  pumpTankLength?: number | null;
  pumpTankPeri?: number | null;
  // Main volume = tank + inlet pipe + outlet pipe. Both pipes are optional and
  // are measured with a tape, so perimeter and length only (see lib/compressor-calc.ts).
  pumpInletPipeActive?: boolean;
  pumpInletPipePeri?: number | null; // mm
  pumpInletPipeLength?: number | null; // mm
  pumpOutletPipeActive?: boolean;
  pumpOutletPipePeri?: number | null; // mm
  pumpOutletPipeLength?: number | null; // mm
  pumpMainVolumeM3?: number | null; // tank + pipes, the volume the FAD uses
  pumpActualFadM3Min?: number | null;
  pumpActualFadCfm?: number | null;
  pumpRunningPressure?: number | null;
  pumpMeasuredPower?: number | null;
  pumpDescription?: string | null;

  // Legacy fields (support fallback)
  fad?: number | null;
  operatingPressure?: number | null;
  inletTemp?: number | null;
  outletTemp?: number | null;
  specificPower?: number | null;
  operatingHours?: number | null;
  receiverTankPressure?: number | null;
  noLoadCurrent?: number | null;
  
  photoPath?: string | null;
  description?: string | null;
  recordedBy?: string | null;
  
  obsCompSituation?: number | null;
  obsCompDischarge?: number | null;
  obsOilSap?: number | null;
  obsOilRadiatorIn?: number | null;
  obsOilRadiatorOut?: number | null;
  obsAirRadiatorIn?: number | null;
  obsAirRadiatorOut?: number | null;
  obsCompFinalDischarge?: number | null;
  obsCompMotor?: number | null;
  obsThermalImageNo?: string | null;

  createdAt: string;
  updatedAt?: string | null; // last local save — the team-merge tie-breaker (newest wins)
  createdById: string;
};

export type SyncJob = {
  jobId: string;
  status: 'pending' | 'synced';
  createdAt: number;
  reporterName: string;
  payload: {
    profile: CompanyProfile | null;
    compressors: CompressorEntry[];
  };
};

type AppState = {
  profile: CompanyProfile | null;
  compressors: CompressorEntry[];
  syncQueue: SyncJob[];
  
  setProfile: (profile: CompanyProfile) => void;
  addCompressor: (compressor: CompressorEntry) => void;
  updateCompressor: (id: string, compressor: Partial<CompressorEntry>) => void;
  deleteCompressor: (id: string) => void;
  wipeData: () => void;

  addJobToQueue: (job: SyncJob) => void;
  updateJobStatus: (jobId: string, status: 'pending' | 'synced') => void;
  pruneQueue: () => void;
};

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      profile: null,
      compressors: [],
      syncQueue: [],

      setProfile: (profile) => set({ profile }),

      addCompressor: (compressor) => set((state) => ({
        compressors: [...state.compressors, { updatedAt: new Date().toISOString(), ...compressor }]
      })),
      updateCompressor: (id, updatedCompressor) => set((state) => ({
        compressors: state.compressors.map(c => c.id === id ? { ...c, ...updatedCompressor, updatedAt: new Date().toISOString() } : c)
      })),
      deleteCompressor: (id) => set((state) => ({
        compressors: state.compressors.filter(c => c.id !== id)
      })),

      wipeData: () => set({ profile: null, compressors: [], syncQueue: [] }),

      addJobToQueue: (job) => set((state) => {
        // Hard cap at 50 to prevent IndexedDB bloat
        const newQueue = [job, ...state.syncQueue];
        if (newQueue.length > 50) newQueue.length = 50;
        return { syncQueue: newQueue };
      }),
      
      updateJobStatus: (jobId, status) => set((state) => ({
        syncQueue: state.syncQueue.map(job => job.jobId === jobId ? { ...job, status } : job)
      })),
      
      pruneQueue: () => set((state) => {
        const now = Date.now();
        const FORTY_EIGHT_HOURS = 48 * 60 * 60 * 1000;
        return {
          syncQueue: state.syncQueue.filter(job => 
            // Keep pending jobs OR synced jobs younger than 48 hours
            job.status === 'pending' || (now - job.createdAt < FORTY_EIGHT_HOURS)
          )
        };
      })
    }),
    {
      name: 'a-cmp-offline-storage',
      storage: createJSONStorage(() => idbStorage),
    }
  )
);
