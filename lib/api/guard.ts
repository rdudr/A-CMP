import { NextResponse } from "next/server";
import { getSessionFromCookies } from "@/lib/auth/session";
import type { SessionPayload } from "@/lib/auth/jwt";
import { checkAndWipeStaleData } from "@/lib/cleanup";

export async function requireApiSession(): Promise<SessionPayload | NextResponse> {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  
  // Wipe out data if inactive for > 2 hours
  await checkAndWipeStaleData();
  
  return session;
}

export function requireRoles() {
  return null;
}
