import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/auth/password";
import { signSessionToken, setSessionCookie } from "@/lib/auth/session";
import type { SessionRole } from "@/lib/auth/jwt";
import { checkAndWipeStaleData } from "@/lib/cleanup";

const bodySchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
  }
  const users = await prisma.user.findMany();
  const user = users.find(u => u.username.toLowerCase() === parsed.data.username.toLowerCase());
  
  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  try {
    const token = await signSessionToken({
      sub: user.id,
      email: user.username,
      role: "ADMIN" as SessionRole,
    });
    await setSessionCookie(token);

    await checkAndWipeStaleData();

    // Check if company profile exists to determine redirect
    const profile = await prisma.companyProfile.findFirst();
    const redirectUrl = profile ? "/dashboard" : "/company";

    return NextResponse.json({
      user: { id: user.id, email: user.username, role: "ADMIN", name: user.displayName },
      redirect: redirectUrl,
    });
  } catch (err: any) {
    return NextResponse.json({ error: "Server config error: " + err.message }, { status: 500 });
  }
}
