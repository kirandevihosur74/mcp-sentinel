import type { AuditRecord, ApprovalRequest, AuditRun, Verdict } from "../../lib/audit-events";
import { demoSnapshot } from "../../lib/audit-events";
import { SiteHeader } from "../../components/site-header";
import { SiteFooter } from "../../components/site-footer";

const verdictLabels: Record<Verdict, string> = {
  clean: "Clean",
  changed_since_approval: "Changed",
  suspicious: "Suspicious",
  malicious: "Malicious",
  could_not_inspect: "Could not inspect",
};

function ActiveCard({ run }: { readonly run: AuditRun }) {
  return (
    <article className="activeCard">
      <div className="cardTopline">
        <span className="liveTag"><span /> LIVE</span>
        <span className="mono subdued">{run.startedAt}</span>
      </div>
      <h3>{run.server}</h3>
      <p className="packageLine"><span>{run.registry}</span> / {run.version}</p>
      <div className="stageRail" aria-label={`${run.progress}% complete`}>
        {(["discover", "inspect", "judge", "act"] as const).map((stage) => (
          <span key={stage} className={stage === run.stage ? "current" : ""}>{stage}</span>
        ))}
      </div>
      <div className="progress"><span style={{ width: `${run.progress}%` }} /></div>
      <p className="activity"><span className="spinner" />{run.activity}</p>
    </article>
  );
}

function ApprovalCard({ approval }: { readonly approval: ApprovalRequest }) {
  return (
    <article className="approvalCard">
      <div className="threatBand">
        <span className="threatIcon">!</span>
        <div><span>CONFIRMED THREAT</span><strong>Action requires your approval</strong></div>
      </div>
      <div className="approvalBody">
        <div className="serverHeading">
          <div><p className="eyebrow">VERDICT</p><h3>{approval.server}</h3><p className="mono subdued">v{approval.version}</p></div>
          <span className={`verdict ${approval.verdict}`}>{verdictLabels[approval.verdict]}</span>
        </div>
        <div className="evidenceList">
          {approval.evidence.map((item) => (
            <div className="evidence" key={item.label}>
              <span className={`evidenceIcon ${item.kind}`} />
              <div><strong>{item.label}</strong><p>{item.detail}</p></div>
            </div>
          ))}
        </div>
        <div className="impact"><span>Proposed action</span><p>{approval.action}</p></div>
        <a className="primaryAction" href={approval.trueForgeUrl}>Review in TrueForge <span>↗</span></a>
        <p className="approvalNote">Approval stays in TrueForge. This console never performs the write.</p>
      </div>
    </article>
  );
}

function HistoryCard({ record }: { readonly record: AuditRecord }) {
  return (
    <article className="historyCard">
      <div className="historyStatus">
        <span className={`statusDot ${record.verdict}`} />
        <span className={`verdict compact ${record.verdict}`}>{verdictLabels[record.verdict]}</span>
      </div>
      <h3>{record.server}</h3>
      <p className="mono subdued">v{record.version} · {record.completedAt}</p>
      <p className="historySummary">{record.summary}</p>
      <p className="historyEvidence"><span>Evidence</span>{record.evidence[0].detail}</p>
      {record.pullRequest ? <a className="textLink" href={record.pullRequest.url}>{record.pullRequest.label} <span>↗</span></a> : null}
    </article>
  );
}

export default function Home() {
  const snapshot = demoSnapshot;

  return (
    <main>
      <SiteHeader mode="audit" />

      <div className="consoleBar">
        <span><i /> AUDIT OPERATIONS / LIVE</span>
        <div><span>DEMO DATA</span><a href="http://localhost:8790">Start audit in TrueForge ↗</a></div>
      </div>

      <section className="mission" id="top">
        <div>
          <p className="eyebrow">MCP TRUST OPERATIONS</p>
          <h1>Watch every server.<br /><span>Trust the evidence.</span></h1>
        </div>
        <div className="metrics">
          <div><strong>{snapshot.active.length}</strong><span>Active audits</span></div>
          <div><strong className="dangerText">{snapshot.approvals.length}</strong><span>Needs decision</span></div>
          <div><strong>14</strong><span>Protected servers</span></div>
        </div>
      </section>

      <section className="workspace" aria-label="Audit workspace">
        <section className="pane doingPane">
          <div className="paneHeader"><div><p className="eyebrow">01 / LIVE</p><h2>Doing</h2></div><span className="count">{snapshot.active.length}</span></div>
          <p className="paneIntro">Inspections running inside isolated Daytona sandboxes.</p>
          <div className="stack">{snapshot.active.map((run) => <ActiveCard key={run.id} run={run} />)}</div>
        </section>

        <section className="pane waitingPane">
          <div className="paneHeader"><div><p className="eyebrow">02 / DECIDE</p><h2>Waiting on you</h2></div><span className="count dangerCount">{snapshot.approvals.length}</span></div>
          <p className="paneIntro">Review the evidence before trust changes.</p>
          <div className="stack">{snapshot.approvals.map((approval) => <ApprovalCard key={approval.id} approval={approval} />)}</div>
        </section>

        <section className="pane didPane">
          <div className="paneHeader"><div><p className="eyebrow">03 / HISTORY</p><h2>Did</h2></div><span className="mono subdued">{snapshot.updatedAt}</span></div>
          <p className="paneIntro">A durable record of evidence and trust decisions.</p>
          <div className="stack historyStack">{snapshot.history.map((record) => <HistoryCard key={record.id} record={record} />)}</div>
        </section>
      </section>

      <section className="accentBand" aria-hidden="true"><span>sentinel</span></section>

      <SiteFooter />
    </main>
  );
}
