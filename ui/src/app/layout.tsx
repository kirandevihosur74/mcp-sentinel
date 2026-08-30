import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono, Cormorant_Garamond, Archivo } from "next/font/google";
import "./globals.css";

// Hex type system: IBM Plex Sans (body + UI), Cormorant Garamond italic (the
// ultra-light editorial hero, standing in for PP Editorial New), Archivo (the
// condensed industrial display headings, standing in for PP Formula), IBM Plex
// Mono (code and data annotations).
const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-sans" });
const display = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  style: ["normal", "italic"],
  variable: "--font-display",
});
const heading = Archivo({ subsets: ["latin"], weight: ["600", "700", "800"], variable: "--font-heading" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "mcp-sentinel | Audit console",
  description: "Evidence-backed MCP server audit operations.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${sans.variable} ${display.variable} ${heading.variable} ${mono.variable}`}>{children}</body>
    </html>
  );
}
