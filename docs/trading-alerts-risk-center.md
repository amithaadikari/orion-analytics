# Orion Trading Alerts & Risk Center

This runbook covers the client-facing alert controls, durable alert evaluator,
portal notifications, and administrator delivery evidence introduced by
`supabase/migrations/20260807_trading_alerts_risk_center.sql`.

The feature is monitoring-only. It reads telemetry already accepted from an
authorized Orion EA installation. It never opens, closes, or modifies a trade,
and an alerting failure cannot reject telemetry or change EA license authority.

## Plan access

Access is derived from the active license attached to the exact selected
trading connection. Client membership tiers and browser-supplied plan values are
not trusted.

| Alert | Basic | Premium | Lifetime |
| --- | --- | --- | --- |
| Connection delayed/offline | Yes | Yes | Yes |
| Final position close | Yes | Yes | Yes |
| Trade opened | No | Yes | Yes |
| Partial close | No | Yes | Yes |
| Daily realized-loss threshold | No | Yes | Yes |
| Floating drawdown threshold | No | Yes | Yes |
| Equity-floor threshold | No | Yes | Yes |

Premium settings retained from an earlier entitlement remain inert after a
license downgrade. The evaluator rechecks the current license plan on every
run, so stored preferences cannot grant advanced access.

## Evaluation rules

- Connection state uses server receipt time: delayed after 3 minutes and
  offline after 10 minutes.
- Automatic connection monitoring follows only the newest eligible scope for a
  license. A client may explicitly choose a different Demo or Real scope.
- Trade events use an immutable deal cursor. Its first value is the newest
  retained deal, preventing a historical-notification flood at activation.
- Final-close P/L is the cumulative net result for the fully closed position.
- Daily loss uses fully closed Orion positions since 00:00 UTC.
- Financial thresholds run only when telemetry is no more than 3 minutes old.
- Daily-loss and equity-floor rules pause if the reported account currency no
  longer matches the currency in which the threshold was saved.
- Drawdown recovery and equity-floor recovery use hysteresis, reducing repeated
  notifications around a boundary.
- Every alert event has a durable deduplication key. Portal notifications are
  written once and appear under the **Trading** notification filter.

## Production activation

1. Deploy the application commit containing the API, portal, and admin changes.
2. Run `supabase/migrations/20260807_trading_alerts_risk_center.sql` once in the
   Supabase SQL Editor.
3. Enable Supabase Cron if it is not already enabled.
4. Create the one-minute evaluator job:

```sql
select cron.schedule(
  'orion-trading-alert-evaluator',
  '* * * * *',
  'select public.evaluate_orion_trading_alerts();'
);
```

The Vercel job at 03:50 UTC is only a daily fallback. It is not frequent enough
for production client alerts.

5. Run one evaluator manually:

```sql
select public.evaluate_orion_trading_alerts();
```

The result must contain `"ok": true` and non-negative counters.

6. Verify the scheduler and durable run evidence:

```sql
select jobid, jobname, schedule, command, active
from cron.job
where jobname = 'orion-trading-alert-evaluator';

select id, status, started_at, completed_at, scopes_evaluated,
       deals_evaluated, alerts_created, notifications_created,
       states_opened, states_resolved, events_deduplicated, error_code
from public.client_trading_alert_runs
order by started_at desc
limit 5;
```

Activation is complete only when the cron query returns one active `* * * * *`
job and the run query shows a recent `Succeeded` result.

## Acceptance test

Use an Orion-owned Demo license first.

1. Open the client Trading dashboard and confirm **Risk & Alerts** matches the
   selected masked account and license plan.
2. Save a base alert setting and reload the page to prove persistence.
3. For Premium or Lifetime, enable a safe test threshold and confirm Basic
   cannot submit the same advanced preference through the API.
4. Open a test trade, partially close it, and fully close it. Confirm each
   enabled event creates at most one Trading notification and that final-close
   P/L matches the complete position history.
5. Stop telemetry for more than 3 minutes, then more than 10 minutes. Confirm
   delayed and offline states appear without affecting the EA or dashboard
   history.
6. Confirm the administrator **Trading alert operations** panel shows the
   evaluator run and delivered events using masked identities.
7. Confirm telemetry ingestion still succeeds if the alert evaluator is
   temporarily unavailable.

## Operational checks

- Alert-event retention is plan-aware: 90 days for Basic, 365 days for Premium,
  and 5 years for Lifetime. Evaluator runs are retained for 90 days.
- The evaluator performs bounded cleanup and processes at most 500 new deals per
  connection per run; later runs continue from the durable cursor.
- Investigate two consecutive failed or missing evaluator runs.
- Treat an offline alert with last-reported open positions as urgent and verify
  the account directly in MetaTrader; portal values may be stale.
- Never include raw license keys, full account numbers, installation IDs, broker
  credentials, or telemetry payloads in support or incident records.

## Safe rollback

Disable or unschedule `orion-trading-alert-evaluator` first if alert delivery is
incorrect. The EA, license service, telemetry ingestion, trading dashboard, and
trade management continue independently. Do not drop the alert tables during
an incident; preserve their events and run records for diagnosis. Roll back the
web deployment separately only if its client or admin interface is implicated.
