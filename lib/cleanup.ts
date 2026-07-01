import { prisma } from "@/lib/prisma";

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

export async function checkAndWipeStaleData() {
  try {
    const profile = await prisma.companyProfile.findFirst();
    if (!profile) return; // No active data session

    // Find the absolute latest timestamp of ANY activity in the system
    const latestCompressor = await prisma.compressorEntry.findFirst({ orderBy: { createdAt: 'desc' } });

    const times = [profile.updatedAt.getTime()];
    if (latestCompressor) times.push(latestCompressor.createdAt.getTime());

    const lastActivityTime = Math.max(...times);
    const now = Date.now();

    if (now - lastActivityTime > TWO_HOURS_MS) {
      console.log("[Cleanup] 2 hours passed since last activity. Wiping all data.");
      await prisma.compressorEntry.deleteMany();
      await prisma.companyProfile.deleteMany();
    }
  } catch (error) {
    console.error("[Cleanup Error] Failed to wipe stale data:", error);
  }
}
