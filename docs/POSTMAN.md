# A-CMP → PostMan (KISEM report generator)

PostMan — the IIT Gandhinagar / KISEM energy-assessment report builder
(https://github.com/rdudr/PostMAN) — prints the report's *Air compressor*
chapter (name-plate table, design vs actual SEC and air generation from the
FAD or pump-up test, the gap that becomes the recommendation) from a
workbook exported by this app. Nothing is retyped.

## The workbook PostMan reads

> **Status (Sept 2026):** this app produces a PDF and the emailed report;
> the Excel export below is **not written by the app yet** (`xlsx` is in
> `package.json` but unused). PostMan's importer (`importACmp` in
> `src/p8_sld.js`) is ready for it. Adding an *Export Excel* button on the
> Report page that writes this sheet is the missing piece.

One sheet named `Compressors` (or `Compressor Entries`), one row per
compressor, columns named exactly as the app's record fields:

| Column | Meaning |
|---|---|
| `machineTag` | tag / ID — the merge key in PostMan |
| `makeModel`, `compressorType`, `yearOfManufacture` | name-plate |
| `ratedCapacity`, `ratedCapacityUnit` (CFM / m³/min / m³/hr / l/s), `ratedPressure`, `processPressure`, `ratedKw`, `motorEfficiency` | design figures |
| `fadSuctionArea`, `fadAvgVelocity`, `fadMeasuredPower`, `fadRunningPressure` | FAD test |
| `pumpP1`, `pumpP2`, `pumpTimeSec`, `pumpTankVolume`, `pumpActualFadCfm`, `pumpRunningPressure` | pump-up test (PostMan treats the entry as pump-up when `pumpActualFadCfm` is present) |
| `genLoadKw` (or `measuredKw`) | measured load kW |
| `description` / `fadDescription` | observation printed under the compressor |

A `Company Profile` sheet with `Company Name` lets PostMan check the file
belongs to the report's company.

Compressors **merge by `machineTag`**: a compressor in the file replaces its
earlier copy, the rest stay — the same export twice, or two engineers'
partial files, never duplicate a machine.

## Keeping the two in step

The full contract for all the field apps — what each feeds, the formulas
that must stay identical, the checklist for a change — is
[`docs/INTEGRATIONS.md` in PostMan](https://github.com/rdudr/PostMAN/blob/main/docs/INTEGRATIONS.md).
The two rules from it:

1. **A change here is a change there.** When the export is added, or a
   field is added, renamed or re-unitised, or the SEC / FAD / pump-up
   arithmetic changes, PostMan's `importACmp` / `compressorCalc` and the
   table above are changed in the same sitting. Likewise, a wording, unit
   or verdict PostMan improves in the report is carried back into this
   app's screens and PDF.
2. **Push every repository touched** (`rdudr/A-CMP` and `rdudr/PostMAN`)
   before the work is called done, each commit naming the other.
