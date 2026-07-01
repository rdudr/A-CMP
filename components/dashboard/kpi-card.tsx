import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function KpiCard({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: string;
  hint?: string;
  className?: string;
}) {
  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader className="pb-2">
        <CardTitle>{label}</CardTitle>
        {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-semibold tracking-tight text-slate-50 tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}
