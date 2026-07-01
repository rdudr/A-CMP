"use client";

import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useAuthStore } from "@/lib/auth-store";
import { useAppStore } from "@/lib/store";
import { FileText } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const login = useAuthStore((s) => s.login);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const profile = useAppStore((s) => s.profile);
  const compressors = useAppStore((s) => s.compressors);
  const wipeData = useAppStore((s) => s.wipeData);

  const hasSavedProgress = !!profile?.companyName || compressors.length > 0;
  const lastUpdated = profile?.updatedAt
    ? new Date(profile.updatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
    : null;

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [isOnline, setIsOnline] = useState(true);

  // Detect online status
  useEffect(() => {
    setIsOnline(navigator.onLine);
    
    const handleOnline = () => {
      setIsOnline(true);
      toast.success("Connected to internet");
    };
    const handleOffline = () => {
      setIsOnline(false);
      toast.info("Device is offline - Using offline mode");
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // If already authenticated, redirect immediately
  useEffect(() => {
    if (isAuthenticated()) {
      router.replace("/company");
    }
  }, [isAuthenticated, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    
    try {
      // If online, try server login FIRST (for real authentication)
      if (isOnline) {
        try {
          const res = await fetch("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password }),
          });
          const data = await res.json().catch(() => ({}));
          if (res.ok) {
            // Server login successful - also update offline store for offline fallback
            login(username, password);
            toast.success("Signed in");
            router.push(data.redirect || "/company");
            return;
          } else if (res.status === 401) {
            // Server specifically rejected credentials (wrong password) - abort login
            toast.error(data.error || "Invalid credentials");
            setLoading(false);
            return;
          } else {
            // DB Down or server error - fall through to offline fallback
            console.warn("Server DB error, falling back to local store credentials");
          }
        } catch (err) {
          // Network error while online - fall through to offline mode
          toast.warning("Network error - trying offline mode");
        }
      }

      // Offline mode: try offline credentials
      const offlineOk = login(username, password);
      if (offlineOk) {
        toast.success(`Signed in (offline mode)${!isOnline ? " - No internet connection" : ""}`);
        router.push("/company");
        return;
      }

      toast.error("Invalid credentials - username or password incorrect");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(ellipse_at_top,_rgba(56,189,248,0.15),_transparent_55%),#020617] px-4 py-10">
      <Card className="w-full max-w-md border-white/10 bg-slate-950/60 shadow-2xl shadow-black/40 backdrop-blur-xl">
        <CardHeader className="flex flex-col items-center text-center">
          <img src="/logo.png" alt="A-CMP Logo" className="h-20 mb-4" />
          <CardTitle className="text-2xl">A-CMP</CardTitle>
          <CardDescription>IITGN Kisem Laboratory — Air Compressor Auditing Login.</CardDescription>
          {!isOnline && (
            <div className="mt-3 px-3 py-2 bg-amber-500/20 border border-amber-500/30 rounded text-xs text-amber-200">
              ⚠️ Offline Mode - Limited to pre-defined credentials
            </div>
          )}
        </CardHeader>

        {hasSavedProgress && (
          <div className="px-6 pb-4">
            <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/5 p-4">
              <div className="flex items-start gap-3">
                <FileText className="size-5 text-cyan-300 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-cyan-100">Continue previous report?</div>
                  {profile?.companyName && (
                    <div className="text-xs text-slate-300 mt-1">
                      Company: <span className="text-cyan-300">{profile.companyName}</span>
                    </div>
                  )}
                  {lastUpdated && (
                    <div className="text-[10px] text-slate-400 mt-1">Last updated: {lastUpdated}</div>
                  )}
                  <div className="text-[10px] text-slate-500 mt-1">
                    {compressors.length} compressor entries recorded
                  </div>
                  <div className="flex gap-2 mt-3">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (confirm("Delete all saved progress and start fresh?")) wipeData();
                      }}
                      className="text-xs text-red-300 hover:bg-red-500/10 px-3"
                    >
                      Start New
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        <CardContent>
          <form className="space-y-4" onSubmit={onSubmit}>
            <div className="space-y-2">
              <Label htmlFor="username">Username / ID</Label>
              <Input
                id="username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={isOnline ? "Enter your server credentials" : "ABHAY, RAHULPATEL, etc."}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Signing in…" : "Sign in"}
            </Button>
            <p className="text-[10px] leading-relaxed text-slate-400">
              {isOnline 
                ? "✓ Online - Using server authentication" 
                : "⚠ Offline - Using local credentials"}
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
