import Link from "next/link";

const REPO = "https://github.com/kirandevihosur74/mcp-sentinel";

export function SiteFooter() {
  return (
    <footer className="siteFooter">
      <div className="footerTop">
        <div className="footerBrand">
          <Link className="footerMark" href="/">Sentinel</Link>
          <p>Evidence-backed audits for third-party MCP servers, before your agents trust them.</p>
          <span className="footerStatus"><i /> All systems operational</span>
        </div>
        <nav className="footerCols" aria-label="Footer">
          <div>
            <h4>Product</h4>
            <Link href="/audit">Audit console</Link>
            <Link href="/#flow">Audit flow</Link>
            <Link href="/#faq">FAQ</Link>
          </div>
          <div>
            <h4>Learn</h4>
            <Link href="/#problem">The problem</Link>
            <Link href="/#architecture">Architecture</Link>
          </div>
          <div>
            <h4>Source</h4>
            <a href={REPO}>GitHub</a>
            <a href={`${REPO}#readme`}>Readme</a>
          </div>
        </nav>
      </div>
      <div className="footerBar">
        <span>© 2026 Sentinel</span>
        <span className="footerBuilt">Built with TrueForge, Bright Data, OpenAI, Daytona, GitHub, and Qodo.</span>
      </div>
    </footer>
  );
}
