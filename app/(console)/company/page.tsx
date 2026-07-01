"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useAppStore } from "@/lib/store";
import { Building2 } from "lucide-react";

export default function CompanyPage() {
  const [loading, setLoading] = useState(false);
  const profile = useAppStore((state) => state.profile);
  const setProfile = useAppStore((state) => state.setProfile);

  const [form, setForm] = useState({
    companyName: "",
    area: "",
    district: "",
    state: "",
    pincode: "",
    overallConsumption: "",
  });

  // Sync form with store
  useEffect(() => {
    if (profile) {
      setForm({
        companyName: profile.companyName || "",
        area: profile.area || "",
        district: profile.district || "",
        state: profile.state || "",
        pincode: profile.pincode || "",
        overallConsumption: profile.overallConsumption?.toString() || "",
      });
    }
  }, [profile]);

  async function save() {
    if (!form.companyName || !form.area) {
      return toast.error("Company name and Plant Area are mandatory details.");
    }
    setLoading(true);
    try {
      setProfile({
        id: profile?.id || crypto.randomUUID(),
        companyName: form.companyName,
        area: form.area,
        district: form.district,
        state: form.state,
        pincode: form.pincode,
        overallConsumption: parseFloat(form.overallConsumption) || 0,
        updatedAt: new Date().toISOString(),
      });
      toast.success("Plant profile saved locally");
    } catch (err: any) {
      toast.error(err.message || "Failed to save details");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card className="bg-slate-950/40 border-white/10 backdrop-blur-md">
        <CardHeader className="flex flex-row items-center gap-2">
          <Building2 className="size-5 text-sky-400" />
          <CardTitle>Plant Site Setup</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="companyName">Company Name <span className="text-red-500">*</span></Label>
            <Input 
              id="companyName"
              placeholder="e.g. Acme Corporation" 
              value={form.companyName} 
              onChange={(e) => setForm({ ...form, companyName: e.target.value })} 
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="area">Plant Area / Site Zone <span className="text-red-500">*</span></Label>
            <Input 
              id="area"
              placeholder="e.g. Unit-1 Assembly Line" 
              value={form.area} 
              onChange={(e) => setForm({ ...form, area: e.target.value })} 
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="district">District</Label>
            <Input 
              id="district"
              placeholder="e.g. Ahmedabad" 
              value={form.district} 
              onChange={(e) => setForm({ ...form, district: e.target.value })} 
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="state">State</Label>
            <Input 
              id="state"
              placeholder="e.g. Gujarat" 
              value={form.state} 
              onChange={(e) => setForm({ ...form, state: e.target.value })} 
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="pincode">Pincode</Label>
            <Input 
              id="pincode"
              placeholder="e.g. 382355" 
              value={form.pincode} 
              onChange={(e) => setForm({ ...form, pincode: e.target.value })} 
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="overallConsumption">Overall Consumption (kWh / Month)</Label>
            <Input 
              id="overallConsumption"
              type="number"
              placeholder="e.g. 24000" 
              value={form.overallConsumption} 
              onChange={(e) => setForm({ ...form, overallConsumption: e.target.value })} 
            />
          </div>

          <div className="md:col-span-2 pt-4 border-t border-white/5 flex justify-end">
            <Button onClick={save} disabled={loading} className="px-6">
              {loading ? "Saving..." : "Save Plant Details"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
