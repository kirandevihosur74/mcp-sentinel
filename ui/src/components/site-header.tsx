import Link from "next/link";

export function SiteHeader({ mode = "site" }: { readonly mode?: "site" | "audit" }) {
  return (
    <header className="siteHeader">
      <Link className="wordmark" href="/">Sentinel</Link>
      <nav aria-label="Primary navigation">
        <Link href="/#problem">Problem</Link>
        <Link href="/#architecture">Architecture</Link>
        <Link href="/#flow">Audit flow</Link>
        <Link href="/#faq">FAQ</Link>
      </nav>
      <div className="navActions">
        {mode === "audit" ? <span className="systemStatus"><i /> System ready</span> : <a className="darkButton" href="https://github.com/kirandevihosur74/mcp-sentinel">GitHub</a>}
        {mode === "audit" ? <a className="orangeButton" href="http://localhost:8790">TrueForge ↗</a> : <Link className="orangeButton" href="/audit">Audit MCPs</Link>}
      </div>
    </header>
  );
}
