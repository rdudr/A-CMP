# A-CMP → PostMan (KISEM report generator)

PostMan — the IIT Gandhinagar / KISEM energy-assessment report builder
(https://github.com/rdudr/PostMAN) — prints the report's *Air compressor*
chapter (name-plate table, design vs actual SEC and air generation from the
FAD or pump-up test, the gap that becomes the recommendation) from a
workbook exported by this app. Nothing is retyped.

## Where the workbook comes from

*Report → Team Data Exchange (Excel)*:

- **Export Data (Excel)** — saves the workbook (device *Documents* on Android,
  a download on the web).
- **Share with Team** (Android) — the same file through the native share
  sheet: WhatsApp, Drive, mail.
- **Import Team Data (Excel)** — merges one or more teammates' files into
  this device (see *Team merge* below).

The same workbook is also attached, next to the PDF, to every report the
app emails (`/api/send-report`, `/api/sync/queue`).

The writer is `lib/compressor-excel.ts` (`buildCompressorWorkbook`).

## The workbook PostMan reads

Two sheets.

**`Company Profile`** — Field / Value rows: `Company Name`, `Area / Zone`,
`District`, `State`, `Pincode`, `Overall Consumption (kWh/Month)`,
`Exported By`, `Export Date`, `Format` (= `A-CMP v1`). PostMan reads
`Company Name` to check the file belongs to the report's company and refuses
a mismatch.

**`Compressor Entries`** — one row per compressor. The columns are the
record's own field names (`CompressorEntry` in `lib/store.ts`, the full list
is `COMPRESSOR_FIELDS` in `lib/compressor-excel.ts`), so a file round-trips
losslessly between team members. The ones PostMan uses:

| Column | Meaning |
|---|---|
| `machineTag` | tag / ID — the merge key in PostMan |
| `makeModel`, `compressorType`, `yearOfManufacture` | name-plate |
| `ratedCapacity`, `ratedCapacityUnit` (CFM / m3/min / CMH / l/s), `ratedPressure`, `processPressure`, `ratedKw`, `motorEfficiency` | design figures |
| `fadSuctionArea`, `fadAvgVelocity`, `fadMeasuredPower`, `fadRunningPressure` | FAD anemometer test |
| `pumpP1`, `pumpP2`, `pumpTimeSec`, `pumpTankVolume` + `pumpTankVolumeUnit`, `pumpActualFadCfm`, `pumpRunningPressure`, `pumpMeasuredPower` | pump-up test (PostMan treats the entry as pump-up when `pumpActualFadCfm` is present) |
| `genLoadKw` (or `measuredKw`) | measured load kW |
| `description`, `fadDescription`, `pumpDescription` | observations printed under the compressor |

Four **derived columns** are written after the record fields for PostMan's
convenience and ignored when a file is imported back into the app:

| Column | Meaning |
|---|---|
| `pumpTankVolumeM3` | receiver volume in m³ whatever unit the engineer typed |
| `luLoadHours`, `luUnloadHours`, `luTotalHours` | last − first reading of the load / unload hour-meter table (`luData`); PostMan's *% loaded* |

Compressors **merge by `machineTag`** in PostMan: a compressor in the file
replaces its earlier copy, the rest stay — the same export twice, or two
engineers' partial files, never duplicate a machine.

## Team merge (inside the app)

`mergeCompressorsFromWorkbook` keys on `machineTag` too. When both sides
have the same tag the copy with the newer `updatedAt` (falling back to
`createdAt`) wins, so re-importing is always safe; company fields only fill
gaps on the importing device.

## Keeping the two in step

The full contract for all the field apps — what each feeds, the formulas
that must stay identical, the checklist for a change — is
[`docs/INTEGRATIONS.md` in PostMan](https://github.com/rdudr/PostMAN/blob/main/docs/INTEGRATIONS.md).
The two rules from it:

1. **A change here is a change there.** When a field is added, renamed or
   re-unitised, or the SEC / FAD / pump-up arithmetic changes
   (`app/(console)/compressors/page.tsx`, `lib/pdf-generator.ts`), PostMan's
   `importACmp` / `compressorCalc` and the tables above are changed in the
   same sitting. Likewise, a wording, unit or verdict PostMan improves in the
   report is carried back into this app's screens and PDF. The verdict shared
   today: actual SEC more than 10 % above design is flagged.
2. **Push every repository touched** (`rdudr/A-CMP` and `rdudr/PostMAN`)
   before the work is called done, each commit naming the other.
