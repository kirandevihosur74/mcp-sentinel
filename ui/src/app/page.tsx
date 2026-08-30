import Link from "next/link";
import { AuditFlowDemo } from "../components/audit-flow-demo";
import { SiteHeader } from "../components/site-header";

const architecture = [
  {
    index: "01",
    name: "TrueForge",
    role: "The runtime",
    copy: "Runs the agent loop, fans out inspectors, provides Daytona sandboxes, keeps sessions alive, and pauses every external action for human approval.",
  },
  {
    index: "02",
    name: "Bright Data",
    role: "The registry signal",
    copy: "Scrapes registry pages for allowlisted servers and candidates. It detects version and maintainer changes, but never replaces sandbox evidence.",
  },
  {
    index: "03",
    name: "OpenAI",
    role: "The reasoning layer",
    copy: "Reads normalized findings and evidence, applies the audit rubric, and proposes one of five constrained verdicts.",
  },
  {
    index: "04",
    name: "Qodo",
    role: "The reviewer",
    copy: "Reviews development PRs and the allowlist changes created by the agent. Trust decisions get the same review trail as code.",
  },
];

export default function LandingPage() {
  return (
    <main className="landing">
      <SiteHeader />

      <section className="landingHero">
        <div className="heroCopy">
          <p className="monoLabel"><span className="labelRule" /> MCP SERVER TRUST, VERIFIED AT RUNTIME</p>
          <h1>Know what your<br />agent is <em>loading.</em></h1>
          <p className="heroLead">mcp-sentinel runs third-party MCP servers inside an isolated sandbox, plants fake credentials, and records what happens. Your team receives evidence, not another risk score.</p>
          <div className="heroActions">
            <Link className="orangeButton largeButton" href="/audit">Open audit console <span>→</span></Link>
            <a className="ghostButton largeButton" href="https://github.com/kirandevihosur74/mcp-sentinel">View source</a>
          </div>
        </div>
        <div className="heroAside">
          <p>THE SHORT VERSION</p>
          <strong>A security review that observes behavior, not promises.</strong>
          <span>Static scan + sandbox detonation + capability drift</span>
        </div>
      </section>

      <div className="demoWrap"><AuditFlowDemo /></div>

      <section className="contentSection problemSection" id="problem">
        <div className="sectionHeading">
          <h2>MCP servers receive credentials and speak directly to your model.</h2>
          <p>Most teams still approve them from a registry description. That misses what changes after approval and what the code does when it runs.</p>
        </div>
        <div className="featureGrid">
          <article><span>01</span><h3>Tool poisoning</h3><p>A harmless description can hide instructions that ask the model to read files or credentials.</p></article>
          <article><span>02</span><h3>Rug pulls</h3><p>A server approved at one version can quietly gain new tools, schemas, or data access later.</p></article>
          <article><span>03</span><h3>Secret exfiltration</h3><p>Runtime code can read environment variables and send them away while static metadata looks clean.</p></article>
          <article><span>04</span><h3>Weak governance</h3><p>Security reports are easy to ignore. A reviewed allowlist PR creates an accountable trust decision.</p></article>
        </div>
      </section>

      <section className="contentSection architectureSection" id="architecture">
        <div className="sectionHeading splitHeading">
          <h2>One audit. Four systems with clear jobs.</h2>
          <p>TrueForge orchestrates. Bright Data supplies change signals. OpenAI reasons over evidence. Qodo reviews the resulting code and trust changes.</p>
        </div>
        <div className="architectureGrid">
          {architecture.map((item) => (
            <article key={item.name}>
              <div className="architectureTop"><span>{item.index}</span><i /></div>
              <p className="monoLabel">{item.role}</p>
              <h3>{item.name}</h3>
              <p>{item.copy}</p>
            </article>
          ))}
        </div>
        <p className="groundTruth">Registry data decides what deserves attention. <em>The sandbox decides what is true.</em></p>
      </section>

      <section className="flowSection" id="flow">
        <div className="flowIntro">
          <p className="monoLabel">THE AUDIT PIPELINE</p>
          <h2>From known server to reviewed trust decision.</h2>
        </div>
        <div className="flowTrack">
          <div className="flowLine"><i /></div>
          <article><span>01</span><h3>Discover</h3><p>Scrape registry changes for servers in <code>allowlist.json</code> and new candidates.</p><small>BRIGHT DATA</small></article>
          <article><span>02</span><h3>Inspect</h3><p>Launch one isolated sandbox, plant canaries, list tools, and invoke safe calls.</p><small>TRUEFORGE + DAYTONA</small></article>
          <article><span>03</span><h3>Judge</h3><p>Combine static findings, live behavior, and capability drift into a verdict.</p><small>OPENAI + SENTINEL</small></article>
          <article><span>04</span><h3>Act</h3><p>Propose an allowlist pull request. Nothing changes until a person approves.</p><small>GITHUB + QODO</small></article>
        </div>
      </section>

      <section className="verdictSection">
        <p className="monoLabel">FIVE POSSIBLE VERDICTS</p>
        <div className="verdictWords"><span>clean</span><span>changed</span><span>suspicious</span><span className="orangeText">malicious</span><span>could not inspect</span></div>
        <p>Every verdict carries the exact description, captured request, capability diff, or failure reason that supports it.</p>
      </section>

      <section className="closingCta">
        <div><p className="monoLabel">THE AUDITOR IS READY</p><h2>See the evidence before you extend trust.</h2></div>
        <Link className="orangeButton largeButton" href="/audit">Open audit console <span>→</span></Link>
      </section>

      <section className="accentBand" aria-hidden="true"><span>sentinel</span></section>

      <footer className="siteFooter">
        <div className="footerTexture" aria-hidden="true" />
        <div className="footerContent"><span className="systemStatus lightStatus"><i /> All systems operational</span><p>Built with TrueForge, Bright Data, OpenAI, Daytona, GitHub, and Qodo.</p></div>
      </footer>
    </main>
  );
}
