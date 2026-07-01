"use client";

import { AuthGuard } from "@/components/auth-guard";
import { ConsoleShell } from "@/components/layout/console-shell";
import { useAuthStore } from "@/lib/auth-store";

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const displayName = useAuthStore((s) => s.displayName);
  const userId = useAuthStore((s) => s.userId);

  // Minimal user shape that ConsoleShell expects
  const user = userId ? { id: userId, displayName: displayName ?? userId, username: userId } : null;

  return (
    <AuthGuard>
      <ConsoleShell user={user}>
        {children}
      </ConsoleShell>
    </AuthGuard>
  );
}
