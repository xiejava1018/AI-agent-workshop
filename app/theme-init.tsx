"use client";

import { useEffect } from "react";

// Reads /en/dashboard etc. theme from localStorage and applies the
// 'dark' class to <html>. Runs once on client mount; M2.2 fork's
// original inline <script dangerouslySetInnerHTML> in RootLayout
// triggered a React 19 / Next.js 16 hydration warning. Moving the
// theme bootstrap to a useEffect sidesteps the SSR-time script-in-
// component issue entirely.
export function ThemeInit() {
  useEffect(() => {
    try {
      const t = localStorage.getItem("pi-theme");
      if (t === "dark") {
        document.documentElement.classList.add("dark");
      }
    } catch {
      // localStorage may be blocked; theme init is best-effort.
    }
  }, []);
  return null;
}
