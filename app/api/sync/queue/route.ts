import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateCompressorPDF } from "@/lib/pdf-generator";
import { buildExcelBase64 } from "@/lib/compressor-excel";
import { Resend } from "resend";

export const runtime = 'nodejs';

const resend = new Resend(process.env.RESEND_API_KEY);

const ADMIN_EMAILS = [
  "loriyasagar.b@iitgn.ac.in",
  "abhay.maurya@iitgn.ac.in",
  "md.faizan@iitgn.ac.in",
  "rishabh.dangi@iitgn.ac.in",
  "dhruvit.patel@iitgn.ac.in",
  "rahuljayantibhai.p@iitgn.ac.in",
  "iea@iitgn.ac.in"
];

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: Request) {
  try {
    const { jobId, reporterName, profile, compressors } = await req.json();

    console.log("[SYNC QUEUE] Received jobId:", jobId, "hasProfile:", !!profile, "compressors count:", compressors?.length);

    // ── 1. Save to DB (non-fatal — email still sends if DB fails) ──────────
    try {
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

      for (const c of (compressors ?? [])) {
        // Client-only fields (not columns in prisma/schema.prisma) are dropped so the upsert does not reject the row
        const { id, companyProfileId, createdAt, createdById, updatedAt, loadPressure, unloadPressure, pumpAirTempC, pumpTempFactor, pumpLapData, ...data } = c;
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

      console.log("[SYNC QUEUE] Database save successful");
    } catch (dbErr: any) {
      console.error("[SYNC QUEUE] Database error (non-fatal):", dbErr.message);
    }

    // ── 2. Send Email via Resend ─────────────────────────────────────────
    if (!profile) {
      return NextResponse.json({ ok: true, synced: { jobId }, note: "No profile — email skipped" }, { headers: CORS_HEADERS });
    }

    if (!process.env.RESEND_API_KEY) {
      console.error("[SYNC QUEUE] RESEND_API_KEY missing");
      return NextResponse.json({ error: "Email service not configured. Add RESEND_API_KEY." }, { status: 500, headers: CORS_HEADERS });
    }

    // Generate PDF buffer
    const pdfArrayBuffer = generateCompressorPDF(profile, compressors, reporterName || "Field Engineer");
    const pdfBuffer = Buffer.from(pdfArrayBuffer);
    // The PostMan workbook rides along, so the report chapter needs no retyping
    const excel = buildExcelBase64(profile, compressors, reporterName || "Field Engineer");
    const excelBuffer = Buffer.from(excel.base64, "base64");
    
    const today = new Date();
    const ddmm = `${String(today.getDate()).padStart(2, "0")}${String(today.getMonth() + 1).padStart(2, "0")}`;
    const filename = `${(profile.companyName || "compressor_report").replace(/\s+/g, "_")}_${ddmm}.pdf`;

    const addressParts = [profile.area, profile.district, profile.state, profile.pincode].filter(Boolean);
    const address = addressParts.join(", ") || "N/A";
    const finalTime = today.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
    const engineer = reporterName || "Field Engineer";
    const company = profile.companyName || "Company";

    const emailSubject = `Air Compressor Sync Report — ${company}`;
    const emailBody = `<div style="font-family: sans-serif; color: #333; line-height: 1.6;">
  <h2 style="color: #0369a1;">A-CMP - Offline Sync Completed</h2>
  <p>Dear Auditing Team,</p>
  <p><strong>${engineer}</strong> has synced offline data for <strong>${company}</strong>, located at:</p>
  <p style="padding-left: 20px; color: #666;"><em>${address}</em></p>
  <p>The sync operation and report compilation was completed on <strong>${finalTime}</strong>.</p>
  <p><strong>Report Summary:</strong></p>
  <ul style="color: #666;">
    <li>Compressors Synced: ${compressors?.length ?? 0}</li>
  </ul>
  <p>Attached: the PDF assessment report and the Excel workbook (<em>Compressor Entries</em>) that drops straight into PostMan's Air compressor chapter.</p>
  <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
  <p style="font-size: 12px; color: #999;">
    A-CMP — Air Compressor Auditing Platform<br>
    IITGN Kisem Laboratory
  </p>
</div>`;

    // ── Send email via SMTP (if configured) or Resend ────────────────────
    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      console.log("[SYNC QUEUE] Sending email via SMTP to:", ADMIN_EMAILS);
      const nodemailer = await import("nodemailer");
      const transporter = nodemailer.default.createTransport({
        host: process.env.SMTP_HOST || "smtp.gmail.com",
        port: Number(process.env.SMTP_PORT || 587),
        secure: false,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });

      await transporter.sendMail({
        from: `"A-CMP" <${process.env.SMTP_USER}>`,
        to: ADMIN_EMAILS.join(", "),
        subject: emailSubject,
        html: emailBody,
        attachments: [
          { filename, content: pdfBuffer },
          { filename: excel.filename, content: excelBuffer },
        ],
      });

      console.log("[SYNC QUEUE] Email sent successfully via SMTP to admins");
      return NextResponse.json({ ok: true, synced: { jobId } }, { headers: CORS_HEADERS });
    }

    console.log("[SYNC QUEUE] Sending email via Resend to ADMIN_EMAILS");

    const emailResponse = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || "A-CMP <noreply@resend.dev>",
      to: ADMIN_EMAILS,
      subject: emailSubject,
      html: emailBody,
      attachments: [
        { filename, content: pdfBuffer },
        { filename: excel.filename, content: excelBuffer },
      ],
    });

    if (emailResponse.error) {
      console.error("[SYNC QUEUE] Resend error:", emailResponse.error);
      return NextResponse.json({ error: emailResponse.error.message }, { status: 500, headers: CORS_HEADERS });
    }

    console.log("[SYNC QUEUE] Email sent successfully via Resend to admins");
    return NextResponse.json({ ok: true, synced: { jobId } }, { headers: CORS_HEADERS });

  } catch (err: any) {
    console.error("[SYNC QUEUE] General error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500, headers: CORS_HEADERS });
  }
}
