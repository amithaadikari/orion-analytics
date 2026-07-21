# Orion Trading Reliability Center

This runbook defines how Orion operates, monitors, and safely rolls back the V5.2 live trading analytics service. The service is read-only: it receives telemetry from an already-authorized EA and must never control trade entry, trade management, or broker execution.

## Operating principles

- License validation remains the authority for whether the EA may open new trades.
- Telemetry failure must not disable position management or change trading permission.
- Never request or store a broker password, investor password, API trading token, or remote-execution credential.
- Treat EA telemetry as client-reported operational data. Use server receipt time for connection health and label stale values clearly.
- Derive client, license, plan, installation, and account ownership on the server. Never trust authority fields supplied by a browser or EA payload.
- Keep raw telemetry tables and maintenance functions inaccessible to browser roles.
- Prefer disabling new telemetry ingestion or withdrawing an EA release over destructive database rollback.

## Ownership and response roles

Assign named people before production rollout. One person may hold more than one role during a small pilot, but every incident must have one incident commander.

| Role | Responsibility |
| --- | --- |
| Incident commander | Owns severity, timeline, decisions, client impact, and closure. |
| Application responder | Checks Vercel deployment, route errors, authentication, and client/admin UI behavior. |
| Database responder | Checks Supabase health, RPC errors, locks, storage growth, retention, backup, and restore readiness. |
| EA release owner | Reproduces in MetaTrader, controls V5.2 release promotion or withdrawal, and maintains the V5.1 fallback artifact. |
| Client communications owner | Sends approved status updates without disclosing keys, account numbers, device identifiers, or internal errors. |

## Incident definitions

Connection state is based on the latest successful server receipt:

- **Online:** last successful telemetry receipt is no more than 3 minutes old.
- **Delayed:** last successful receipt is more than 3 minutes and no more than 10 minutes old.
- **Offline:** last successful receipt is more than 10 minutes old.
- **Never synced:** an eligible license/account/installation has no accepted telemetry batch.

Use these incident classes:

| Class | Trigger | Default severity |
| --- | --- | --- |
| Trading safety | Telemetry code changes trading permission, blocks risk management, or causes an EA freeze affecting position management. | SEV-1 |
| Cross-client exposure | A client or analyst can access another client's financial telemetry, raw key, raw account identifier, or installation identifier. | SEV-1 |
| Data corruption | Accepted batches are written under the wrong account scope, open-position reconciliation is incomplete, or acknowledged deals are lost. | SEV-1 |
| Ingestion outage | Accepted telemetry rate drops materially across otherwise-authorized installations for 10 minutes. | SEV-2 |
| Fleet degradation | More than 20% of previously online installations are delayed/offline for 15 minutes without a known market-wide or network event. | SEV-2 |
| Rejection spike | Rejections exceed the recent baseline by 3x for two evaluator windows, or a single rejection code affects 10 or more installations. | SEV-2 |
| Analytics defect | Metrics, pagination, plan gates, or equity/history rendering are wrong while ingestion remains intact. | SEV-2 or SEV-3 depending on scope |
| Scheduled-job failure | The evaluator or retention job misses two expected runs, returns an error, or cannot prove a successful audit result. | SEV-2 |
| Isolated client issue | One client is delayed/offline and license validation, database health, and other installations are normal. | SEV-3 |

SEV-1 requires immediate release freeze and rollback evaluation. SEV-2 requires an incident owner and active mitigation. SEV-3 may follow the normal support workflow but still needs an auditable resolution.

## First-response checklist

1. Record the start time in UTC, reporter, affected environment, suspected first bad version, and incident commander.
2. Confirm whether license validation and existing-position management still work. Escalate immediately to SEV-1 if either is affected by telemetry.
3. Check the Vercel deployment and function logs for `/api/trading/telemetry`, `/api/trading-analytics`, `/api/admin/trading-monitor`, and scheduled-job routes.
4. Check Supabase API/database health, RPC error codes, recent accepted batches, rejection counts by code, long-running queries, locks, and storage growth.
5. Compare affected installations by EA version, terminal build, plan, account type, broker server, and deployment version. Use masked identifiers in tickets and chat.
6. Reproduce with an approved test license on a test Demo account. Do not use a production client key in screenshots, logs, or issue text.
7. Decide whether to pause rollout, withdraw V5.2, disable telemetry ingestion, or continue observation under an incident owner.
8. Preserve evidence: deployment ID, commit, migration version, timestamps, sanitized request/response codes, evaluator result, and relevant MetaTrader log lines.

## V5.2 adoption plan

### Entry criteria

Do not begin a V5.2 pilot until all of the following are true:

- CI passes `npm ci`, typecheck, tests, lint, and production build on the exact release commit.
- The telemetry migration has been applied successfully in the target Supabase project and its function grants/RLS have been checked.
- V5.2 compiles without warnings that affect telemetry, licensing, or position management.
- The EA can validate and send accepted telemetry from one approved Demo and one approved Real test identity.
- The portal shows correct account masking, plan gates, connection state, open positions, closed history, and stale-data labels.
- The V5.1 compiled artifact, checksum, release notes, and client installation steps remain available for rollback.
- The evaluator, retention audit, and named on-call owners are ready.

### Rollout rings

1. **Internal test:** Orion-owned Demo and Real test accounts only. Observe at least 24 hours and include a trade open, partial close, full close, terminal restart, network interruption, and license revalidation.
2. **Pilot:** a small, explicitly informed client group across representative brokers and terminal builds. Observe at least 48 hours with daily acceptance/rejection review.
3. **Limited release:** no more than 25% of eligible installations. Hold for at least 48 hours without SEV-1/SEV-2 telemetry incidents.
4. **Broad release:** increase in controlled steps while monitoring evaluator results, storage growth, retention duration, route latency, and support volume.

Record for every ring: release ID, EA checksum, application commit, migration version, eligible installation count, accepted installations, rejection distribution, delayed/offline count, and the person approving expansion.

### Adoption success measures

- At least 95% of eligible pilot installations produce an accepted batch within 10 minutes of setup.
- No telemetry operation changes trading authorization or position-management behavior.
- No cross-client or raw-credential exposure.
- Accepted batch, open-position, and deal reconciliation checks pass for the approved test cases.
- Scheduled evaluator and retention audit complete on time.
- Database growth follows the modeled rate and stale records are actually removed at their policy boundary.

## Scheduled reliability evaluator

The evaluator is an operational requirement, not a substitute for route-level validation. Schedule its database function every 5 minutes after the migration is applied.

Apply `supabase/migrations/20260805_trading_reliability_center.sql`, enable the
Supabase Cron integration, then create the five-minute database job once:

```sql
select cron.schedule(
  'orion-trading-reliability-evaluator',
  '*/5 * * * *',
  'select public.evaluate_orion_trading_reliability();'
);
```

The migration deliberately does not enable `pg_cron` or mutate scheduler
configuration. The daily Vercel invocation at 03:40 UTC is only a
Hobby-compatible fallback and is not the production incident-detection cadence.
Re-running `cron.schedule` with the same job name replaces that job; verify the
schedule and one successful run in Supabase before calling activation complete.

Verify the job and its first durable run:

```sql
select jobid, jobname, schedule, active
from cron.job
where jobname = 'orion-trading-reliability-evaluator';

select id, status, started_at, completed_at, streams_evaluated,
       incidents_detected, incidents_opened, incidents_resolved, error_code
from public.trading_reliability_runs
where job_name = 'reliability-evaluator'
order by started_at desc
limit 5;
```

The job query must return one active `*/5 * * * *` row. The run query must show
a recent `Succeeded` row before production activation is complete.

The current Phase 6A evaluator persists one bounded audit result containing:

- evaluation start/end time and evaluator version;
- total eligible streams evaluated;
- offline connections with last-reported open positions;
- other offline connections;
- rejected telemetry count during the rolling 15-minute window;
- rejection-spike and incident open/refresh/resolve counts;
- sanitized success/failure evidence without raw key, IP, account, payload, or installation values.

Evaluator controls:

- Authenticate the scheduler with the server-side cron secret and reject missing or mismatched authorization.
- Keep execution idempotent for one time window and prevent overlapping evaluations.
- Bound every query by time and row count; aggregate in PostgreSQL when PostgREST row caps could make a count incomplete.
- Use server receipt timestamps, not EA clock values, for online/delayed/offline status.
- Send alerts only from sanitized aggregate results. Never include raw telemetry or identifiers.
- Alert if two evaluator runs are missing, two consecutive runs fail, or any critical rule fires once.
- Do not mark the evaluator operational until a production scheduler run and its resulting audit evidence have both been observed.

## Retention and scheduled-job auditing

The current schedule runs telemetry retention daily at 03:20 UTC. Audit it independently of the HTTP success status.

After each run, capture:

- scheduler invocation time, deployment ID, HTTP status, and duration;
- returned `ok` value and cumulative deleted counts for rejections, rate-limit buckets, batches, snapshots, deals, and stale open positions;
- database errors, statement timeout, or lock timeout;
- oldest remaining row timestamp for each retained table;
- row count and storage-size trend compared with the previous seven runs.

An HTTP 200 alone is not proof of retention. At least weekly, verify that rows older than each plan's policy boundary do not remain. Investigate immediately when:

- the job misses two scheduled runs;
- the job returns non-2xx, `ok` is not true, or deletion counters cannot be parsed;
- the oldest eligible stale row does not advance after a run;
- batch or snapshot growth exceeds expected accepted-ingestion volume;
- runtime increases materially, approaches the scheduler timeout, or causes lock pressure.

Keep at least 90 days of sanitized job-audit results. Do not copy raw table data into the audit record.

## Rollback criteria and actions

### Roll back or withdraw V5.2 immediately when

- telemetry affects license authorization, new-entry gating, or existing-position management;
- any cross-client access, raw credential exposure, or incorrect account binding is confirmed;
- accepted telemetry is attributed to the wrong client/account scope;
- the EA becomes unstable, blocks the terminal event loop beyond the approved bounded request behavior, or repeatedly exceeds the telemetry timeout;
- acknowledged deal progression causes confirmed, unrecoverable history loss;
- a SEV-1 remains uncontained.

### Pause rollout and evaluate rollback when

- a SEV-2 ingestion outage lasts 15 minutes;
- rejection or delayed/offline rates cross the rollout threshold for two evaluator windows;
- database load, storage growth, retention runtime, or route latency approaches an agreed safety limit;
- metrics or plan gates are materially wrong for more than one client;
- V5.2 support volume makes safe adoption uncertain.

### Safe rollback sequence

1. Freeze promotion and preserve the affected V5.2 artifact, checksum, application commit, deployment ID, and logs.
2. Stop assigning V5.2 to additional clients. Withdraw or archive its release channel if the EA is implicated.
3. Restore the last verified V5.1 release for affected clients with clear reinstallation guidance.
4. If the web deployment is implicated, roll Vercel back to the last verified deployment while preserving database evidence.
5. If ingestion is implicated, disable new telemetry acceptance at the application edge or remove V5.2 distribution. Do not revoke unrelated licenses or interrupt existing-position management.
6. Do not drop telemetry tables or reverse an applied migration during incident response. Treat database rollback as a separately reviewed restore/migration operation.
7. Verify license validation, V5.1 position management, portal authentication, and client isolation after containment.
8. Reconcile missing/duplicate telemetry in an isolated script or reviewed migration. Never hand-edit production telemetry rows during the incident.
9. Publish a sanitized incident summary, impact window, mitigation, and re-release criteria.

## Backup and restore drill checklist

Run the drill at least quarterly and before a high-risk telemetry schema change. Use an isolated Supabase project or isolated restore target; never overwrite production during a drill.

### Before the drill

- [ ] Name the drill owner, database responder, observer, and approval window.
- [ ] Record the expected recovery point objective (RPO) and recovery time objective (RTO).
- [ ] Confirm the configured backup/PITR capability and the timestamp of the latest restorable point.
- [ ] Record the production migration version, application commit, active EA release/checksum, row counts, and storage sizes.
- [ ] Prepare sanitized verification identities and expected counts; do not export production keys or raw client identifiers.
- [ ] Confirm the restore target is isolated from production webhooks, schedulers, email, and client traffic.

### Restore execution

- [ ] Restore the selected backup or point-in-time snapshot to the isolated target.
- [ ] Record start/end times, restore point, provider job/reference ID, and any warnings.
- [ ] Apply only migrations newer than the restore point, in order, using the normal reviewed process.
- [ ] Configure non-production secrets and ensure no production scheduler can call the restored project.

### Verification

- [ ] Verify critical table row counts and foreign-key integrity for clients, licenses, trading identities, installations, telemetry scopes, streams, batches, snapshots, open positions, and closed deals.
- [ ] Verify RLS is enabled and browser roles have no direct telemetry-table access.
- [ ] Verify only the service role can execute ingestion, shaped analytics reads, and cleanup functions.
- [ ] Verify a known client can read only its own shaped analytics and another client's connection ID returns no data.
- [ ] Verify plan gates for Basic, Premium, and Lifetime on the restored data.
- [ ] Verify open-position reconciliation and deterministic closed-history pagination with sanitized test telemetry.
- [ ] Run the retention function, capture its result, and verify stale-row boundaries.
- [ ] Run the evaluator against the isolated target and verify expected warnings for intentionally disconnected test installations.
- [ ] Confirm no email, notification, release, or client-facing side effect left the isolated environment.

### Closeout

- [ ] Compare actual RPO/RTO with the targets and record every gap.
- [ ] Store sanitized evidence: timestamps, counts, screenshots, commands, migration versions, and approver sign-off.
- [ ] Create owners and due dates for failed checks.
- [ ] Destroy or restrict the temporary restore after evidence is approved, following the provider's safe deletion process.
- [ ] Update this runbook when the drill reveals a missing step or inaccurate assumption.

## Incident record minimum

Every SEV-1/SEV-2 record must include:

- incident ID, severity, UTC start/detect/contain/resolve times;
- incident commander and responders;
- affected clients/installations using masked identifiers only;
- application commit/deployment, migration version, and EA version/checksum;
- triggering evaluator/job rules and sanitized evidence;
- client impact and whether trading authorization or position management was affected;
- containment, rollback, reconciliation, and verification steps;
- root cause, contributing controls, corrective actions, owners, and due dates.

Close an incident only after containment is verified, scheduled jobs are healthy, affected data is reconciled or explicitly documented, and re-release criteria are approved.
