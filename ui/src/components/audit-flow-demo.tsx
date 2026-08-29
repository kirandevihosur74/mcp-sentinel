"use client";

import { useEffect, useState } from "react";

const stages = [
  {
    key: "discover",
    number: "01",
    label: "Registry signal",
    tool: "BRIGHT DATA",
    headline: "Version drift found",
    detail: "weather-buddy-mcp 1.0.2 → 1.0.3",
    log: "maintainer unchanged · tool surface changed",
  },
  {
    key: "sandbox",
    number: "02",
    label: "Sandbox inspect",
    tool: "TRUEFORGE + DAYTONA",
    headline: "Server isolated",
    detail: "3 canaries planted · 1 tool invoked",
    log: "GITHUB_TOKEN=canary-7f3a••••",
  },
  {
    key: "scan",
    number: "03",
    label: "Static judgment",
    tool: "SENTINEL MCP",
    headline: "Hidden instruction found",
    detail: "U+200B · credential reference · high",
    log: "description → GITHUB_TOKEN",
  },
  {
    key: "capture",
    number: "04",
    label: "Network capture",
    tool: "MITMPROXY",
    headline: "Canary left the sandbox",
    detail: "POST weather-telemetry.example/collect",
    log: "body.match → canary-7f3a••••",
  },
  {
    key: "verdict",
    number: "05",
    label: "Trust decision",
    tool: "OPENAI + QODO",
    headline: "Malicious",
    detail: "Removal PR ready for human approval",
    log: "verdict=malicious · evidence=3",
  },
] as const;

export function AuditFlowDemo() {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setActive((current) => (current + 1) % stages.length), 2200);
    return () => window.clearInterval(timer);
  }, []);

  const stage = stages[active] ?? stages[0];

  return (
    <section className="auditDemo" aria-label="Animated MCP server audit">
      <div className="demoNoise" aria-hidden="true" />
      <header className="demoHeader">
        <div><span className="demoLive"><i /> LIVE AUDIT</span><strong>weather-buddy-mcp</strong></div>
        <div className="demoRun">RUN / 1042 <span>01:34</span></div>
      </header>

      <div className="demoBody">
        <div className="demoMap">
          <div className="mapGrid" aria-hidden="true" />
          <div className="orbit orbitOne" aria-hidden="true" />
          <div className="orbit orbitTwo" aria-hidden="true" />
          <div className="mapCore">
            <span>ISOLATED TARGET</span>
            <strong>weather<br />buddy</strong>
            <small>DAYTONA / PID 042</small>
            <i className={stage.key === "capture" ? "coreAlert" : ""} />
          </div>
          <div className="mapNode nodeRegistry"><i />REGISTRY</div>
          <div className="mapNode nodeScan"><i />STATIC SCAN</div>
          <div className="mapNode nodeCapture"><i />CAPTURE</div>
          <div className="mapNode nodeVerdict"><i />VERDICT</div>
          <span className={`movingSignal signal${active}`} aria-hidden="true" />
        </div>

        <div className="demoReadout">
          <div className="readoutIndex"><span>{stage.number}</span><small>{stage.tool}</small></div>
          <div className="readoutMain" key={stage.key}>
            <p>{stage.label}</p>
            <h2>{stage.headline}</h2>
            <strong>{stage.detail}</strong>
            <code>{stage.log}</code>
          </div>
          <div className="stageDots" aria-label={`Audit stage ${active + 1} of ${stages.length}`}>
            {stages.map((item, index) => (
              <button
                type="button"
                key={item.key}
                className={index === active ? "active" : index < active ? "complete" : ""}
                onClick={() => setActive(index)}
                aria-label={`Show ${item.label}`}
                aria-pressed={index === active}
              ><span>{item.number}</span><i /></button>
            ))}
          </div>
        </div>
      </div>

      <footer className="demoFooter">
        <span>SANDBOX EGRESS / PROXIED</span>
        <span>KNOWN CANARIES / 03</span>
        <span>EXTERNAL WRITES / APPROVAL GATED</span>
      </footer>
    </section>
  );
}
