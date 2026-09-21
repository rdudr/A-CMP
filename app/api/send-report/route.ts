import { NextResponse } from "next/server";
import { Resend } from "resend";
import { generateCompressorPDF } from "@/lib/pdf-generator";
import { buildExcelBase64 } from "@/lib/compressor-excel";

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

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { profile, compressors, recipients, reporterName } = body;

    if (!profile) {
      return NextResponse.json({ error: "No company profile provided" }, { status: 400 });
    }

    if (!compressors || !Array.isArray(compressors) || compressors.length === 0) {
      return NextResponse.json({ error: "No compressors recorded" }, { status: 400 });
    }

    // ── Build the PDF Report Buffer ───────────────────────────────────────
    const pdfArrayBuffer = generateCompressorPDF(profile, compressors, reporterName || "Field Engineer");
    const pdfBuffer = Buffer.from(pdfArrayBuffer);
    // The PostMan workbook rides along, so the report chapter needs no retyping
    const excel = buildExcelBase64(profile, compressors, reporterName || "Field Engineer");
    const excelBuffer = Buffer.from(excel.base64, "base64");
    
    const today = new Date();
    const ddmm = `${String(today.getDate()).padStart(2, "0")}${String(today.getMonth() + 1).padStart(2, "0")}`;
    const filename = `${(profile.companyName || "compressor_report").replace(/\s+/g, "_")}_${ddmm}.pdf`;

    // ── Compose message ──────────────────────────────────────────────────
    const addressParts = [profile.area, profile.district, profile.state, profile.pincode].filter(Boolean);
    const address = addressParts.join(", ") || "N/A";
    const finalTime = today.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
    const engineer = reporterName || "Field Engineer";
    const company = profile.companyName || "Company";

    const emailSubject = `Air Compressor Auditing Report — ${company}`;
    const emailBody = `<div style="font-family: sans-serif; color: #333; line-height: 1.6;">
  <h2 style="color: #0369a1;">A-CMP - Air Compressor Data Acquisition Report</h2>
  <p>Dear Auditing Team,</p>
  <p><strong>${engineer}</strong> has successfully collected and compiled the detailed air compressor data for <strong>${company}</strong>, located at:</p>
  <p style="padding-left: 20px; color: #666;"><em>${address}</em></p>
  <p>The comprehensive air compressor audits and data collection was completed on <strong>${finalTime}</strong>.</p>
  <p><strong>Report Summary:</strong></p>
  <ul style="color: #666;">
    <li>Compressors Recorded: ${compressors.length}</li>
  </ul>
  <p>Attached: the PDF assessment report and the Excel workbook (<em>Compressor Entries</em>) that drops straight into PostMan's Air compressor chapter.</p>
  <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
  <p style="font-size: 12px; color: #999;">
    A-CMP — Air Compressor Auditing Platform<br>
    IITGN Kisem Laboratory
  </p>
</div>`;

    // ── Merge recipient list with predefined admin emails ─────────────────
    const inputRecipients = Array.isArray(recipients) ? recipients : (recipients ? [recipients] : []);
    const recipientList = [...new Set([...inputRecipients, ...ADMIN_EMAILS])];

    // ── Send email via SMTP (if configured) or Resend ────────────────────
    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      console.log("[SEND REPORT] Sending via SMTP to:", recipientList);
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
        to: recipientList.join(", "),
        subject: emailSubject,
        html: emailBody,
        attachments: [
          { filename, content: pdfBuffer },
          { filename: excel.filename, content: excelBuffer },
        ],
      });

      return NextResponse.json({
        ok: true,
        message: `Report sent successfully via SMTP`,
        recipients: recipientList,
      });
    }

    console.log("[SEND REPORT] Sending via Resend to:", recipientList);
    const response = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || "A-CMP <noreply@resend.dev>",
      to: recipientList,
      subject: emailSubject,
      html: emailBody,
      attachments: [
        { filename, content: pdfBuffer },
        { filename: excel.filename, content: excelBuffer },
      ],
    });

    if (response.error) {
      console.error("Resend API error:", response.error);
      return NextResponse.json({ error: response.error.message || "Failed to send email" }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      message: `Report sent successfully via Resend`,
      recipients: recipientList,
      id: response.data?.id
    });
  } catch (err: any) {
    console.error("Report generation/sending error:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
