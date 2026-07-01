"use client";

import React, { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useAppStore } from "@/lib/store";
import { useAuthStore } from "@/lib/auth-store";
import { cn } from "@/lib/utils";
import { Mail, CheckCircle2, AlertTriangle, Send, CloudLightning, RefreshCw, Download } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { generateCompressorPDF } from "@/lib/pdf-generator";

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
  const [syncingQueue, setSyncingQueue] = useState(false);
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    setIsOnline(navigator.onLine);
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

  // Helper to convert ArrayBuffer to Base64 (needed for Capacitor filesystem write)
  function arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = "";
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }

  // Generates and saves/downloads the PDF locally on the device (Web or Capacitor Mobile)
  async function downloadLocalPDF(profile: any, compressors: any[], engineerName: string) {
    try {
      const arrayBuffer = generateCompressorPDF(profile, compressors, engineerName);
      const today = new Date();
      const ddmm = `${String(today.getDate()).padStart(2, "0")}${String(today.getMonth() + 1).padStart(2, "0")}`;
      const filename = `${(profile.companyName || "compressor_report").replace(/\s+/g, "_")}_${ddmm}.pdf`;

      if (Capacitor.isNativePlatform()) {
        const base64Data = arrayBufferToBase64(arrayBuffer);
        const targets = [Directory.Documents, Directory.Cache];
        let savedUri = "";
        for (const dir of targets) {
          try {
            const result = await Filesystem.writeFile({
              path: filename,
              data: base64Data,
              directory: dir,
              recursive: true
            });
            savedUri = result.uri;
            break;
          } catch (err) {
            console.warn(`Write to ${dir} failed:`, err);
          }
        }
        if (savedUri) {
          toast.success(`PDF saved to device: ${filename}`);
        } else {
          toast.error("Could not write PDF to device storage.");
        }
      } else {
        // Web browser download
        const blob = new Blob([arrayBuffer], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast.success(`PDF report downloaded: ${filename}`);
      }
    } catch (err: any) {
      console.error("Local download error:", err);
      toast.error("Failed to save report locally: " + err.message);
    }
  }

  async function handleSendReport() {
    if (!profile?.companyName) {
      return toast.error("Please configure the Plant profile before sending the report.");
    }
    if (compressors.length === 0) {
      return toast.error("No compressor data has been recorded. Add some compressor audits first.");
    }

    const recipientList = recipients
      .split(",")
      .map((r) => r.trim())
      .filter((r) => r.length > 0 && r.includes("@"));

    // Always generate and download the PDF locally first
    await downloadLocalPDF(profile, compressors, reporterName || "Field Engineer");

    // If offline, queue the job automatically
    if (!isOnline) {
      addJobToQueue({
        jobId: crypto.randomUUID(),
        status: "pending",
        createdAt: Date.now(),
        reporterName: reporterName || "Field Engineer",
        payload: {
          profile,
          compressors
        }
      });
      toast.warning("Device is offline. Report has been saved to the Offline Sync Queue.");
      setRecipients("");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/send-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile,
          compressors,
          recipients: recipientList,
          reporterName,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        toast.success("Report successfully generated and emailed!");
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

  // Trigger manual syncing of pending offline sync queue entries
  async function handleSyncQueue() {
    if (pendingJobs.length === 0) return;
    setSyncingQueue(true);
    let successCount = 0;

    try {
      for (const job of pendingJobs) {
        const res = await fetch("/api/sync/queue", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobId: job.jobId,
            reporterName: job.reporterName,
            profile: job.payload.profile,
            compressors: job.payload.compressors
          })
        });

        if (res.ok) {
          updateJobStatus(job.jobId, "synced");
          successCount++;
        }
      }

      if (successCount > 0) {
        toast.success(`Successfully synchronized ${successCount} queued report(s) with the server database.`);
      } else {
        toast.error("Failed to sync queued jobs. Check internet connection.");
      }
    } catch (err: any) {
      toast.error("Sync error: " + err.message);
    } finally {
      setSyncingQueue(false);
    }
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <Card className="bg-slate-950/40 border-white/10 backdrop-blur-md">
        <CardHeader className="flex flex-row items-center gap-2">
          <Mail className="size-5 text-sky-400" />
          <div>
            <CardTitle>Send Compressor Audit PDF Report</CardTitle>
            <CardDescription className="text-xs text-slate-400">Generate a PDF document containing audited values and email it.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          
          {/* Quick Summary Card */}
          <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Active Audit Summary</h3>
              <span className={cn(
                "px-2 py-0.5 rounded text-[10px] font-bold uppercase",
                isOnline ? "bg-green-500/10 text-green-400" : "bg-amber-500/10 text-amber-400"
              )}>
                {isOnline ? "Online" : "Offline"}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <span className="text-slate-500">Plant / Company:</span>
              <span className="text-slate-200 font-medium">{profile?.companyName || "Not set (Go to Company page)"}</span>
              
              <span className="text-slate-500">Location:</span>
              <span className="text-slate-200 font-medium truncate" title={address}>{address || "N/A"}</span>
              
              <span className="text-slate-500">Compressors Recorded:</span>
              <span className="text-sky-400 font-bold">{compressors.length} items</span>
            </div>
            {!profile?.companyName && (
              <div className="mt-2 text-[10px] text-amber-400 flex items-center gap-1">
                <AlertTriangle className="size-3" />
                Please fill in Plant Profile before sending.
              </div>
            )}
          </div>

          {/* Form details */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="reporterName">Auditing Engineer Name</Label>
              <Input
                id="reporterName"
                placeholder="Your Name"
                value={reporterName}
                onChange={(e) => setReporterName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="recipients">Additional Recipient Emails</Label>
              <Input
                id="recipients"
                placeholder="e.g. manager@plant.com, support@domain.com (comma separated)"
                value={recipients}
                onChange={(e) => setRecipients(e.target.value)}
              />
              <p className="text-[10px] text-slate-500">
                Note: Standard lab admin emails (Sagar, Abhay, Rishabh, Dhruvit, etc.) are included automatically.
              </p>
            </div>
          </div>

          <div className="pt-4 border-t border-white/5 flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => downloadLocalPDF(profile, compressors, reporterName || "Field Engineer")}
              disabled={!profile?.companyName || compressors.length === 0}
              className="gap-2 border-white/10 bg-slate-900/60 hover:bg-slate-800 text-white"
            >
              Download PDF Only
              <Download className="size-4" />
            </Button>
            <Button
              onClick={handleSendReport}
              disabled={loading || !profile?.companyName || compressors.length === 0}
              className="gap-2 px-6"
            >
              {isOnline ? (
                <>
                  Generate & Send PDF
                  <Send className="size-4" />
                </>
              ) : (
                <>
                  Queue Offline Report
                  <CloudLightning className="size-4" />
                </>
              )}
            </Button>
          </div>

        </CardContent>
      </Card>

      {/* Sync Queue Card */}
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
                  You have {pendingJobs.length} report(s) waiting to sync.
                </CardDescription>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleSyncQueue}
                disabled={syncingQueue || !isOnline}
                className="text-xs border-amber-500/20 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 hover:text-white"
              >
                {syncingQueue ? "Syncing..." : "Sync Now"}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {pendingJobs.map((job) => (
              <div key={job.jobId} className="p-3 rounded-lg border border-white/5 bg-slate-950/60 flex justify-between items-center text-xs">
                <div>
                  <span className="font-semibold text-slate-200 block">{job.payload.profile?.companyName}</span>
                  <span className="text-[10px] text-slate-500">
                    {job.payload.compressors.length} compressors • Queued {new Date(job.createdAt).toLocaleString("en-IN")}
                  </span>
                </div>
                <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-amber-500/10 text-amber-400">
                  PENDING
                </span>
              </div>
            ))}
            {!isOnline && (
              <p className="text-[10px] text-amber-300/80 text-center pt-2">
                ⚠️ Connect to the internet to sync pending reports.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
