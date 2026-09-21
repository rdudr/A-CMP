"use client";

import React, { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useAppStore } from "@/lib/store";
import { useAuthStore } from "@/lib/auth-store";
import { cn } from "@/lib/utils";
import {
  Mail, AlertTriangle, Send, CloudLightning, RefreshCw, Download, Share2, FileText,
  FileSpreadsheet, Upload, Users, Loader2, Wind, Gauge,
} from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { generateCompressorPDF } from "@/lib/pdf-generator";
import {
  exportCompressorsExcel, shareCompressorsExcel, mergeCompressorsFromWorkbook, readWorkbookFile,
} from "@/lib/compressor-excel";

export default function ReportPage() {
  const profile = useAppStore((s) => s.profile);
  const compressors = useAppStore((s) => s.compressors);
  const displayName = useAuthStore((s) => s.displayName);

  const syncQueue = useAppStore((s) => s.syncQueue || []);
  const addJobToQueue = useAppStore((s) => s.addJobToQueue);
  const updateJobStatus = useAppStore((s) => s.updateJobStatus);

  const [reporterName, setReporterName] = useState(displayName || "");
  const [recipients, setRecipients] = useState("");
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [sharingPdf, setSharingPdf] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);
  const [sharingExcel, setSharingExcel] = useState(false);
  const [importing, setImporting] = useState(false);
  const [syncingQueue, setSyncingQueue] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [isNative, setIsNative] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setIsOnline(navigator.onLine);
    setIsNative(Capacitor.isNativePlatform());
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const address = profile
    ? [profile.area, profile.district, profile.state, profile.pincode].filter(Boolean).join(", ")
    : "";
  const pendingJobs = syncQueue.filter((j) => j.status === "pending");
  const tested = compressors.filter((c) => (c.pumpActive && c.pumpActualFadCfm) || (c.fadActive && c.fadAirDeliveryCfm)).length;
  const ready = !!profile?.companyName && compressors.length > 0;
  const engineer = reporterName || displayName || "Field Engineer";

  function arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = "";
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return window.btoa(binary);
  }

  function pdfFilename(): string {
    const today = new Date();
    const ddmm = `${String(today.getDate()).padStart(2, "0")}${String(today.getMonth() + 1).padStart(2, "0")}`;
    return `${(profile?.companyName || "compressor_report").replace(/[^\w]+/g, "_").replace(/^_|_$/g, "")}_${ddmm}.pdf`;
  }

  /** Builds the PDF and saves it (device Documents on Android, browser download on web). Returns the saved URI / name. */
  async function savePdfLocally(): Promise<string | null> {
    const arrayBuffer = generateCompressorPDF(profile, compressors, engineer);
    const filename = pdfFilename();

    if (Capacitor.isNativePlatform()) {
      const { Filesystem, Directory } = await import("@capacitor/filesystem");
      const base64Data = arrayBufferToBase64(arrayBuffer);
      for (const dir of [Directory.Documents, Directory.Cache]) {
        try {
          const result = await Filesystem.writeFile({ path: filename, data: base64Data, directory: dir, recursive: true });
          return result.uri;
        } catch (err) {
          console.warn(`Write to ${dir} failed:`, err);
        }
      }
      return null;
    }

    const blob = new Blob([arrayBuffer], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return filename;
  }

  async function handleDownloadPdf() {
    if (!ready) return;
    setDownloading(true);
    try {
      const saved = await savePdfLocally();
      if (saved) toast.success(isNative ? "PDF saved to device Documents ✓" : "PDF report downloaded ✓");
      else toast.error("Could not write the PDF to device storage.");
    } catch (err: any) {
      console.error(err);
      toast.error("Failed to build the PDF: " + (err?.message || "unknown error"));
    } finally {
      setDownloading(false);
    }
  }

  async function handleSharePdf() {
    if (!ready) return;
    setSharingPdf(true);
    try {
      const uri = await savePdfLocally();
      if (!uri) throw new Error("Could not write the PDF to device storage.");
      const { Share } = await import("@capacitor/share");
      await Share.share({
        title: `A-CMP report — ${profile?.companyName}`,
        text: `Compressor efficiency assessment report for ${profile?.companyName}.`,
        url: uri,
        dialogTitle: "Share PDF report",
      });
    } catch (err: any) {
      if (!/cancel/i.test(err?.message || "")) toast.error(err?.message || "Failed to share PDF");
    } finally {
      setSharingPdf(false);
    }
  }

  async function handleSendReport() {
    if (!profile?.companyName) return toast.error("Please fill in the Company page before sending the report.");
    if (compressors.length === 0) return toast.error("No compressor has been recorded yet.");

    const recipientList = recipients
      .split(",")
      .map((r) => r.trim())
      .filter((r) => r.length > 0 && r.includes("@"));

    // Always keep a local copy first
    try {
      await savePdfLocally();
    } catch (err) {
      console.warn("Local PDF save failed:", err);
    }

    if (!isOnline) {
      addJobToQueue({
        jobId: crypto.randomUUID(),
        status: "pending",
        createdAt: Date.now(),
        reporterName: engineer,
        payload: { profile, compressors },
      });
      toast.warning("You're offline — the report is saved in the sync queue and will go out when you're back online.");
      setRecipients("");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/send-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile, compressors, recipients: recipientList, reporterName: engineer }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success("Report emailed with the PDF and the PostMan workbook attached ✓");
        setRecipients("");
      } else {
        toast.error(data.error || "Failed to send email");
      }
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to submit report");
    } finally {
      setLoading(false);
    }
  }

  // ── Team data exchange (Excel) ────────────────────────────────────────────
  async function handleExportExcel() {
    setExportingExcel(true);
    try {
      const result = await exportCompressorsExcel(profile, compressors, engineer);
      if (result) toast.success(isNative ? "Excel saved to device Documents ✓ Share it with the team or drop it into PostMan." : "Excel data file downloaded ✓");
      else toast.error("Could not write the Excel file to device storage.");
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || "Failed to export Excel");
    } finally {
      setExportingExcel(false);
    }
  }

  async function handleShareExcel() {
    setSharingExcel(true);
    try {
      const ok = await shareCompressorsExcel(profile, compressors, engineer);
      if (!ok) toast.error("Sharing is only available in the Android app — use Export on the web.");
    } catch (err: any) {
      if (!/cancel/i.test(err?.message || "")) toast.error(err?.message || "Failed to share Excel");
    } finally {
      setSharingExcel(false);
    }
  }

  async function handleImportExcel(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;
    setImporting(true);
    try {
      let curProfile = profile;
      let curCompressors = compressors;
      const totals = { added: 0, updated: 0, skippedOlder: 0, profileFieldsFilled: 0 };
      for (const file of files) {
        const wb = await readWorkbookFile(file);
        const merged = mergeCompressorsFromWorkbook(wb, curProfile, curCompressors);
        curProfile = merged.profile;
        curCompressors = merged.compressors;
        totals.added += merged.summary.added;
        totals.updated += merged.summary.updated;
        totals.skippedOlder += merged.summary.skippedOlder;
        totals.profileFieldsFilled += merged.summary.profileFieldsFilled;
      }
      useAppStore.setState({ profile: curProfile, compressors: curCompressors });
      toast.success(
        `Merged ${files.length} file${files.length === 1 ? "" : "s"} ✓\n` +
        `• ${totals.added} compressor(s) added\n` +
        `• ${totals.updated} updated (their copy was newer)\n` +
        `• ${totals.skippedOlder} kept as is (yours was newer)`,
        { duration: 7000 }
      );
    } catch (err: any) {
      console.error("[IMPORT]", err);
      toast.error(err?.message || "Invalid Excel file");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  // ── Offline queue ─────────────────────────────────────────────────────────
  async function handleSyncQueue() {
    if (pendingJobs.length === 0) return;
    setSyncingQueue(true);
    let successCount = 0;
    try {
      for (const job of pendingJobs) {
        const res = await fetch("/api/sync/queue", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId: job.jobId, reporterName: job.reporterName, profile: job.payload.profile, compressors: job.payload.compressors }),
        });
        if (res.ok) {
          updateJobStatus(job.jobId, "synced");
          successCount++;
        }
      }
      if (successCount > 0) toast.success(`Synchronised ${successCount} queued report(s) ✓`);
      else toast.error("Failed to sync queued reports. Check the internet connection.");
    } catch (err: any) {
      toast.error("Sync error: " + err.message);
    } finally {
      setSyncingQueue(false);
    }
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* ── Audit summary ─────────────────────────────────────────────────── */}
      <Card className="bg-slate-950/40 border-white/10 backdrop-blur-md">
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <FileText className="size-5 text-sky-400" />
            <div>
              <CardTitle>Report &amp; Sharing</CardTitle>
              <CardDescription className="text-xs text-slate-400">The compressor efficiency assessment for this plant.</CardDescription>
            </div>
          </div>
          <span className={cn("px-2 py-0.5 rounded text-[10px] font-bold uppercase shrink-0", isOnline ? "bg-green-500/10 text-green-400" : "bg-amber-500/10 text-amber-400")}>
            {isOnline ? "Online" : "Offline"}
          </span>
        </CardHeader>
        <CardContent>
          <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
            <div className="text-base font-semibold text-white break-words">{profile?.companyName || "Plant not set — fill in the Company page"}</div>
            <div className="text-xs text-slate-400 mt-0.5 break-words">{address || "Location not set"}</div>
            <div className="grid grid-cols-3 gap-2 mt-4">
              <div className="rounded-lg bg-slate-950/60 border border-white/5 p-3 text-center">
                <Wind className="size-4 text-sky-400 mx-auto mb-1" />
                <div className="text-xl font-bold text-white tabular-nums">{compressors.length}</div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Compressors</div>
              </div>
              <div className="rounded-lg bg-slate-950/60 border border-white/5 p-3 text-center">
                <Gauge className="size-4 text-emerald-400 mx-auto mb-1" />
                <div className="text-xl font-bold text-white tabular-nums">{tested}</div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Tested</div>
              </div>
              <div className="rounded-lg bg-slate-950/60 border border-white/5 p-3 text-center">
                <Users className="size-4 text-amber-400 mx-auto mb-1" />
                <div className="text-xl font-bold text-white tabular-nums">{new Set(compressors.map((c) => c.recordedBy || "?")).size}</div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Recorders</div>
              </div>
            </div>
            {!ready && (
              <div className="mt-3 text-[11px] text-amber-400 flex items-center gap-1.5">
                <AlertTriangle className="size-3.5 shrink-0" />
                {!profile?.companyName ? "Fill in the Company page before generating a report." : "Add at least one compressor first."}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── PDF report ────────────────────────────────────────────────────── */}
      <Card className="bg-slate-950/40 border-white/10 backdrop-blur-md">
        <CardHeader className="flex flex-row items-center gap-2">
          <Mail className="size-5 text-sky-400" />
          <div>
            <CardTitle>PDF Report</CardTitle>
            <CardDescription className="text-xs text-slate-400">Name-plate, electrical readings, FAD / pump-up test and the design comparison for every compressor.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="reporterName">Auditing engineer</Label>
              <Input id="reporterName" placeholder="Your name" value={reporterName} onChange={(e) => setReporterName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="recipients">Extra recipient emails</Label>
              <Input id="recipients" placeholder="manager@plant.com, ... (comma separated)" value={recipients} onChange={(e) => setRecipients(e.target.value)} />
            </div>
          </div>
          <p className="text-[10px] text-slate-500 -mt-2">
            The KISEM admin team is always copied. The email carries the PDF and the Excel workbook PostMan reads.
          </p>

          <div className="grid gap-2 sm:grid-cols-3">
            <Button
              variant="secondary"
              onClick={handleDownloadPdf}
              disabled={!ready || downloading}
              className="gap-2 border-white/10 bg-slate-900/60 hover:bg-slate-800 text-white"
            >
              {downloading ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              {isNative ? "Save PDF" : "Download PDF"}
            </Button>
            {isNative && (
              <Button
                variant="secondary"
                onClick={handleSharePdf}
                disabled={!ready || sharingPdf}
                className="gap-2 border-sky-500/30 bg-sky-500/10 hover:bg-sky-500/20 text-sky-100"
              >
                {sharingPdf ? <Loader2 className="size-4 animate-spin" /> : <Share2 className="size-4" />}
                Share PDF
              </Button>
            )}
            <Button
              onClick={handleSendReport}
              disabled={loading || !ready}
              className={cn("gap-2", !isNative && "sm:col-span-2")}
            >
              {loading ? <Loader2 className="size-4 animate-spin" /> : isOnline ? <Send className="size-4" /> : <CloudLightning className="size-4" />}
              {isOnline ? "Email Report" : "Queue Offline Report"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Team data exchange (Excel) ─────────────────────────────────────── */}
      <Card className="bg-slate-950/40 border-white/10 backdrop-blur-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="size-5 text-cyan-400" />
            Team Data Exchange (Excel)
          </CardTitle>
          <CardDescription className="text-xs text-slate-400">
            Each engineer exports their compressors as Excel; one person imports every file to combine them.
            Compressors merge by machine tag — when both sides have the same tag, the copy saved most recently wins,
            so re-importing never creates duplicates. Each entry keeps the recorder&apos;s name. The same file drops
            straight into <span className="text-slate-200">PostMan</span> for the report chapter.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <Button
            onClick={handleExportExcel}
            disabled={exportingExcel || compressors.length === 0}
            variant="secondary"
            className="w-full border border-emerald-500/30 text-emerald-200 hover:bg-emerald-500/10 gap-2 font-semibold"
          >
            {exportingExcel ? <Loader2 className="size-4 animate-spin" /> : <FileSpreadsheet className="size-4" />}
            Export Data (Excel)
          </Button>
          {isNative && (
            <Button
              onClick={handleShareExcel}
              disabled={sharingExcel || compressors.length === 0}
              variant="secondary"
              className="w-full border border-sky-500/30 text-sky-200 hover:bg-sky-500/10 gap-2 font-semibold"
            >
              {sharingExcel ? <Loader2 className="size-4 animate-spin" /> : <Share2 className="size-4" />}
              Share with Team
            </Button>
          )}
          <input type="file" ref={fileInputRef} onChange={handleImportExcel} accept=".xlsx,.xls" multiple className="hidden" />
          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            variant="secondary"
            className={cn("w-full border border-cyan-500/30 text-cyan-200 hover:bg-cyan-500/10 gap-2 font-semibold", !isNative && "sm:col-span-2")}
          >
            {importing ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            Import Team Data (Excel)
          </Button>
          {compressors.length === 0 && (
            <p className="text-[10px] text-slate-500 sm:col-span-3">Export becomes available once at least one compressor is saved. Import works any time.</p>
          )}
        </CardContent>
      </Card>

      {/* ── Sync queue ────────────────────────────────────────────────────── */}
      {pendingJobs.length > 0 && (
        <Card className="bg-slate-950/40 border-amber-500/20 backdrop-blur-md">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm font-semibold flex items-center gap-1.5 text-amber-400">
                  <RefreshCw className="size-4 animate-spin-slow" />
                  Offline Sync Queue
                </CardTitle>
                <CardDescription className="text-xs text-slate-400">
                  {pendingJobs.length} report(s) waiting to be sent.
                </CardDescription>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleSyncQueue}
                disabled={syncingQueue || !isOnline}
                className="text-xs border-amber-500/20 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 hover:text-white"
              >
                {syncingQueue ? "Syncing…" : "Sync Now"}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {pendingJobs.map((job) => (
              <div key={job.jobId} className="p-3 rounded-lg border border-white/5 bg-slate-950/60 flex justify-between items-center text-xs gap-2">
                <div className="min-w-0">
                  <span className="font-semibold text-slate-200 block truncate">{job.payload.profile?.companyName}</span>
                  <span className="text-[10px] text-slate-500">
                    {job.payload.compressors.length} compressors • Queued {new Date(job.createdAt).toLocaleString("en-IN")}
                  </span>
                </div>
                <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-amber-500/10 text-amber-400 shrink-0">PENDING</span>
              </div>
            ))}
            {!isOnline && (
              <p className="text-[10px] text-amber-300/80 text-center pt-2">Connect to the internet to send the queued reports.</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
