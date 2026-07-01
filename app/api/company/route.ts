import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiSession } from "@/lib/api/guard";

const schema = z.object({
  companyName: z.string().min(1),
  area: z.string().min(1),
  district: z.string().min(1),
  state: z.string().min(1),
  pincode: z.string().min(1),
  overallConsumption: z.union([z.string(), z.number()]).transform((v) => parseFloat(String(v)) || 0),
});

export async function GET() {
  const gate = await requireApiSession();
  if (gate instanceof NextResponse) return gate;
  const profile = await prisma.companyProfile.findFirst();
  return NextResponse.json({ profile });
}

export async function POST(req: Request) {
  const gate = await requireApiSession();
  if (gate instanceof NextResponse) return gate;
  const body = schema.parse(await req.json());
  const existing = await prisma.companyProfile.findFirst();
  const profile = existing
    ? await prisma.companyProfile.update({ where: { id: existing.id }, data: body })
    : await prisma.companyProfile.create({ data: body });
  return NextResponse.json({ profile });
}
