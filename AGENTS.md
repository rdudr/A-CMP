# A-CMP — Compressor Efficiency Field-Capture App

## What this is
Field-capture app used on KISEM energy-audit site visits (IIT Gandhinagar) to
measure and record **compressor efficiency** at MSME/industry plants.
Outputs are consumed downstream by **PostMan**, the report-generation tool that
produces Detailed Energy Assessment Reports.

Sibling apps on the same stack: **Jet EFF** (textile jet machines + plant
electrical hierarchy) and **fox-kisen**. Keep data models compatible with them —
PostMan must ingest all three.

## Stack
- Next.js App Router + TypeScript
- Prisma + SQLite (`prisma/dev.db`) in dev
- Capacitor 8 (Android APK — `npm run export:apk`)
- Tailwind + Radix UI
- react-hook-form + zod

## Layout
- `app/(console)` — authenticated console
- `app/api` — route handlers
- `app/login` — auth entry
- `prisma/schema.prisma` — data model; `prisma/seed.ts` — seed data

## Commands
- `npm run dev` — dev server
- `npm run db:push` / `npm run db:seed` / `npm run db:studio`
- `npm run build:mobile` then `npm run export:apk` — Android build

## Rules for agents
- **Do not change `prisma/schema.prisma` field names without saying so explicitly**
  in your summary — PostMan's ingest depends on them.
- Audit workflow context: a *walkthrough* visit defines plant structure and
  hierarchy first; the *main* audit measures against it. Structure links must
  stay editable on later audit days — never make hierarchy immutable after save.
- This app is used offline on plant floors. Do not introduce hard network
  dependencies in the capture path.
- Keep UI legible on a phone in bright light — this is used standing next to a
  compressor, not at a desk.

## PostMan (KISEM report generator)

This app's export feeds the KISEM **PostMan** report generator. Before
changing an export column, a sheet or a formula, read `docs/POSTMAN.md` — and push every
repository touched (this one and `rdudr/PostMAN`) before calling the work
done.
