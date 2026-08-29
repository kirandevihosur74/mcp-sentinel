# Audit console

The P5 UI is a read-only view of mcp-sentinel audit activity. It presents three queues:

- Doing: active Discover, Inspect, Judge, and Act stages.
- Waiting on you: evidence-backed verdicts that require a decision.
- Did: completed audits and links to resulting pull requests.

Run it from the repository root:

```bash
npm run dev -w ui
```

The current page uses the typed demo snapshot in `src/lib/audit-events.ts`. That file defines the normalized boundary for a future TrueForge session adapter. The adapter should translate official TrueForge session events into `AuditSnapshot`; it must not recreate sessions, sandbox execution, or approvals in this app.

Approval links return the reviewer to TrueForge. GitHub writes remain protected by TrueForge's configured approval policy.
