"use client";

import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      {children}
      <Toaster richColors position="top-right" />
    </ThemeProvider>
  );
}
