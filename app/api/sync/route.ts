import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  try {
    const { profile, compressors } = await req.json();

    // Sync Company Profile
    if (profile) {
      await prisma.companyProfile.upsert({
        where: { id: profile.id },
        create: {
          id: profile.id,
          companyName: profile.companyName,
          area: profile.area,
          district: profile.district ?? "",
          state: profile.state ?? "",
          pincode: profile.pincode ?? "",
          overallConsumption: parseFloat(String(profile.overallConsumption)) || 0,
        },
        update: {
          companyName: profile.companyName,
          area: profile.area,
          district: profile.district ?? "",
          state: profile.state ?? "",
          pincode: profile.pincode ?? "",
          overallConsumption: parseFloat(String(profile.overallConsumption)) || 0,
        },
      });
    }

    // Sync Entries — find or create a user for "local-user"
    let systemUser = await prisma.user.findFirst({ where: { username: "local-offline" } });
    if (!systemUser) {
      const bcrypt = await import("bcryptjs");
      systemUser = await prisma.user.create({
        data: {
          username: "local-offline",
          displayName: "Offline Device",
          passwordHash: await bcrypt.hash("offline-sync-user", 10),
        },
      });
    }

    // Sync Compressors
    for (const c of (compressors ?? [])) {
      const { id, companyProfileId, createdAt, createdById, ...data } = c;
      await prisma.compressorEntry.upsert({
        where: { id: c.id },
        create: {
          ...(data as any),
          id: c.id,
          companyProfileId: profile ? profile.id : null,
          createdAt: c.createdAt ? new Date(c.createdAt) : undefined,
          createdById: systemUser.id,
        },
        update: {
          ...(data as any),
          createdAt: c.createdAt ? new Date(c.createdAt) : undefined,
        },
      });
    }

    return NextResponse.json({ ok: true, synced: { compressors: compressors?.length ?? 0 } });
  } catch (err) {
    console.error("[SYNC ERROR]", err);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
