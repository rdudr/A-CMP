"use client";

import { useAppStore } from "@/lib/store";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import React from "react";
import { 
  ResponsiveContainer, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  Cell,
  Legend 
} from "recharts";
import { Activity, ShieldAlert, Wind, TrendingUp, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

const COLORS = ["#0284c7", "#0ea5e9", "#38bdf8", "#7dd3fc", "#bae6fd"];

export default function DashboardPage() {
  const profile = useAppStore((s) => s.profile);
  const compressors = useAppStore((s) => s.compressors);

  const totalCompressors = compressors.length;
  
  // Calculations
  const totalMeasuredPower = compressors.reduce((acc, c) => acc + (c.measuredKw || 0), 0);
  const totalRatedPower = compressors.reduce((acc, c) => acc + (c.ratedKw || 0), 0);
  
  const avgLoadFactor = totalCompressors > 0 
    ? compressors.reduce((acc, c) => acc + (c.loadFactor || 0), 0) / totalCompressors
    : 0;

  const avgSpecificPower = totalCompressors > 0
    ? compressors.reduce((acc, c) => acc + (c.specificPower || 0), 0) / totalCompressors
    : 0;

  // Chart data: Compressor specific power
  const specificPowerChartData = compressors.map((c) => ({
    name: c.machineTag,
    value: c.specificPower || 0,
    type: c.compressorType || "Screw"
  })).filter(d => d.value > 0);

  // Group by compressor type
  const typeCounts = compressors.reduce((acc, c) => {
    const type = c.compressorType || "Unknown";
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const typeChartData = Object.entries(typeCounts).map(([name, value]) => ({
    name,
    value
  }));

  // Critical status: Load Factor > 1.2
  const criticalCompressors = compressors.filter(c => (c.loadFactor || 0) > 1.2);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between pb-4 border-b border-white/5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-50">Operational Overview</h1>
          <p className="text-sm text-slate-400 mt-1">Industrial Air Compressor Auditing Platform</p>
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <KpiCard label="Plant Site" value={profile?.companyName ?? "Not set"} />
        <KpiCard label="Audited Compressors" value={String(totalCompressors)} />
        <KpiCard label="Total Meas. Power" value={`${totalMeasuredPower.toFixed(2)} kW`} />
        <KpiCard label="Avg Load Factor" value={avgLoadFactor.toFixed(3)} />
        <KpiCard label="Avg Specific Power" value={`${avgSpecificPower.toFixed(2)} kW/(m³/m)`} />
      </section>

      {/* Main visual panel */}
      <section className="grid gap-6 md:grid-cols-2">
        {/* Specific Power Chart */}
        <Card className="bg-slate-950/40 border-white/10">
          <CardHeader className="flex flex-row items-center gap-2">
            <TrendingUp className="size-4 text-sky-400" />
            <CardTitle className="text-sm uppercase tracking-wider text-slate-400 font-semibold">Specific Power comparison (kW / m³·min⁻¹)</CardTitle>
          </CardHeader>
          <CardContent className="h-64 flex items-center justify-center">
            {specificPowerChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={specificPowerChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <XAxis dataKey="name" stroke="#94a3b8" fontSize={10} tickLine={false} />
                  <YAxis stroke="#94a3b8" fontSize={10} tickLine={false} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: "#0f172a", borderColor: "rgba(255,255,255,0.1)", borderRadius: "8px" }} 
                    itemStyle={{ color: "#fff" }}
                    formatter={(value: any) => [`${Number(value).toFixed(2)} kW/(m³/min)`]}
                  />
                  <Bar dataKey="value" fill="#0284c7" radius={[4, 4, 0, 0]}>
                    {specificPowerChartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-xs text-slate-500">No compressor specific power records present.</p>
            )}
          </CardContent>
        </Card>

        {/* Load Factor Chart */}
        <Card className="bg-slate-950/40 border-white/10">
          <CardHeader className="flex flex-row items-center gap-2">
            <Activity className="size-4 text-sky-400" />
            <CardTitle className="text-sm uppercase tracking-wider text-slate-400 font-semibold">Compressor Load Factor Comparison</CardTitle>
          </CardHeader>
          <CardContent className="h-64 flex items-center justify-center">
            {compressors.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={compressors.map(c => ({ name: c.machineTag, value: c.loadFactor }))} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <XAxis dataKey="name" stroke="#94a3b8" fontSize={10} tickLine={false} />
                  <YAxis stroke="#94a3b8" fontSize={10} tickLine={false} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: "#0f172a", borderColor: "rgba(255,255,255,0.1)", borderRadius: "8px" }} 
                    itemStyle={{ color: "#fff" }}
                    formatter={(value: any) => [`${Number(value).toFixed(3)}`]}
                  />
                  <Bar dataKey="value" fill="#38bdf8" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-xs text-slate-500">No compressor electrical load data present.</p>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Secondary panel */}
      <section className="grid gap-6 md:grid-cols-3">
        {/* Critical Alerts */}
        <Card className="bg-slate-950/40 border-white/10 md:col-span-2">
          <CardHeader className="flex flex-row items-center gap-2">
            <ShieldAlert className="size-4 text-red-400" />
            <CardTitle className="text-sm uppercase tracking-wider text-slate-400 font-semibold">Overloaded Compressor Warnings</CardTitle>
          </CardHeader>
          <CardContent>
            {criticalCompressors.length > 0 ? (
              <div className="space-y-3">
                {criticalCompressors.map((c) => (
                  <div key={c.id} className="flex items-center justify-between p-3 rounded-lg border border-red-500/30 bg-red-500/5 text-xs">
                    <div>
                      <span className="font-bold text-red-200 block">{c.machineTag}</span>
                      <span className="text-slate-400">Rated: {c.ratedKw} kW | Measured: {c.measuredKw} kW</span>
                    </div>
                    <div className="text-right">
                      <span className="font-bold text-red-400 text-sm block">LF: {Number(c.loadFactor).toFixed(3)}</span>
                      <span className="text-[10px] text-slate-500">Critical load (&gt;1.2)</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-slate-400 text-xs">All compressors operating within safe electrical load factors.</p>
            )}
          </CardContent>
        </Card>

        {/* Equipment breakdown */}
        <Card className="bg-slate-950/40 border-white/10">
          <CardHeader className="flex flex-row items-center gap-2">
            <Wind className="size-4 text-sky-400" />
            <CardTitle className="text-sm uppercase tracking-wider text-slate-400 font-semibold">Technology Mix</CardTitle>
          </CardHeader>
          <CardContent>
            {typeChartData.length > 0 ? (
              <div className="space-y-4">
                {typeChartData.map((type) => (
                  <div key={type.name} className="flex items-center justify-between text-xs border-b border-white/5 pb-2">
                    <span className="text-slate-300 font-medium">{type.name} Compressors</span>
                    <span className="px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-400 font-bold">{type.value}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-slate-400 text-xs">No equipment records present.</p>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
