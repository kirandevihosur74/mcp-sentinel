import type { Metadata } from "next";
import { Inter, IBM_Plex_Mono, Fraunces } from "next/font/google";
import "./globals.css";

// New Form editorial-broadsheet system: Fraunces is the heavy editorial serif
// that reads as a block of ink (standing in for PP Mondwest, and its light
// italic covers the Editorial New pull-quote role); Inter is the neutral
// grotesque for all UI and the oversized sub-display headlines (standing in for
// TWK Lausanne); IBM Plex Mono stays for code and captured evidence only.
const sans = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-sans" });
const display = Fraunces({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "900"],
  style: ["normal", "italic"],
  variable: "--font-display",
});
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Sentinel — MCP audit console",
  description: "Evidence-backed MCP server audit operations.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${sans.variable} ${display.variable} ${mono.variable}`}>{children}</body>
    </html>
  );
}
