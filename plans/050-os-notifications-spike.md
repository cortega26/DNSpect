# Plan 050: OS notifications for watch alerts — design spike (decision-gated)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 57a8e34..HEAD -- docs/MONITORING_MODE.md backend/app/cli.py frontend/src/hooks/useWatch.ts frontend/src/components/WatchPanel.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2 (user-visible monitoring value; v1 explicitly deferred it here)
- **Effort**: S (spike: doc + probe, no production code merged)
- **Risk**: LOW (spike artifacts only)
- **Depends on**: none
- **Category**: direction (design spike → decision gate → future build plan)
- **Planned at**: commit `57a8e34`, 2026-09-15

## Why this matters

Plan 021 decided "in-app banner v1; OS notifications deferred (needs a
permission-UX product decision)". The feasibility question is already
answered — `docs/MONITORING_MODE.md` confirms WebKitGTK Notification
support — so what remains is purely the product decision plus a concrete
integration sketch: where the permission request is handled, what the
copy says in three locales, and what the build plan will cost. This spike
produces exactly that and stops at the maintainer's decision gate. No
production behavior changes either way.

## Current state (all verified 2026-09-15 or quoted from the decision record)

- `docs/MONITORING_MODE.md` constraints (the binding context — quote, don't paraphrase, in the spike doc):
  - "Web Notification API: supported in the native GUI — WebKit2.Notification
    and WebKitNotificationPermissionRequest since 2.8 (WebKit2 API 4.1 =
    2.42.x, the exact API version required at `cli.py:15-19`); the host must
    handle the permission request on the web context. Browser mode depends on
    the user's OS browser (Chromium/Firefox implement the API). Notifications
    are on-device UI — **no egress**."
  - "Anything sending data off-device (webhook/ntfy/email/push) is out of
    v1 … every other channel requires a new egress decision."
  - "Recorded decision: v1 alerts are in-app only … OS notifications are a
    maintainer decision (decision list)."
  - Open decision: "in-app banner only vs. OS notifications … Recommendation:
    in-app banner in v1, OS notifications in a follow-up — notification
    permission UX needs a product decision (auto-allow on first watch
    creation?)".
- `backend/app/cli.py:15-19` — pins the WebKit2 API version (the host-side
  permission handler must target this API).
- Watch alert flow today: backend event list + banner (in-app only); the
  spike must name the exact emission point where an OS notification would
  fan out (read the watch-alert code path and cite `file:line`).
- i18n contract: ES source of truth, EN+PT parity gated by
  `i18n.copy.test.ts` — any new copy needs all three locales from day one.
- Spike precedent: plan 039 (`docs/DESIGN_SYSTEM.md` + throwaway prototype,
  no production merge).

## Commands you will need

| Purpose | Command | Provenance | Expected on success |
|---|---|---|---|
| Drift check | `git diff --stat 57a8e34..HEAD -- <in-scope paths>` | declared | exit 0 (empty) |
| Spike sanity | `cd frontend && npx vitest run src/lib/utils.test.ts src/hooks/useBenchmarkSession.test.ts` | declared | all pass (production untouched) |
| Frontend gates | `cd frontend && npm run lint && npm run typecheck && npm run build && npm test` | declared | all exit 0 |

## Scope

**In scope** (spike artifacts only — no production code merged):
- `docs/OS_NOTIFICATIONS.md` (new) — permission-UX options, recommendation,
  copy drafts (ES+EN+PT), integration sketch with `file:line` cites,
  decision gate, build-plan cost estimate
- `spikes/notification-probe/` (branch-local, deleted before merge) — a
  Web Notification API probe page exercising
  requestPermission/show-notification flows in browser mode

**Out of scope** (deferred to the build plan after the gate):
- Production components, hooks, i18n keys, e2e, host-side (Python/WebKit)
  permission-handler code
- Any off-device channel (webhook/ntfy/email/push) — forbidden without a
  separate egress decision per MONITORING_MODE.md

## Git workflow

- Branch: `plan/050-os-notifications-spike`
- Commits: `docs(spike): OS notification options and permission-UX recommendation`, `spike(notifications): browser-mode API probe`. Merge commit: `merge: plan 050 — OS notifications spike`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Map the emission point and host surface

1. Trace the watch-alert path from alert evaluation to the in-app banner;
   record the exact function(s) where an OS-notification fan-out would
   attach (`file:line` for: threshold evaluation, alert-event creation,
   banner render).
2. Read `backend/app/cli.py:1-40` (WebKit context setup) and identify where
   a `WebKitNotificationPermissionRequest` handler would register; record
   the anchor lines. If the context setup doesn't expose the web context
   signals the handler needs, record that as a build-plan risk (don't fix).
3. Check the Flatpak manifest/finish-args for notification-portal
   implications (`--talk-name=org.freedesktop.Notifications` or portal
   use); record what exists today.

**Verify**: the three cites (emission point, cli anchor, manifest state) are recorded with `file:line`.

### Step 2: Permission-UX options and recommendation

Evaluate exactly three options (no more — the decision must stay small):
1. Auto-allow on first watch creation (host pre-approves; zero prompts).
2. Just-in-time prompt on first alert (standard web flow via the permission request handler).
3. Settings toggle, default off (notifications only after explicit opt-in).

For each: one paragraph (UX, Flatpak-portal behavior if known, failure
mode when denied) + a verdict. Recommend one with rationale. Draft the
user-facing copy for the chosen option in ES (source) + EN + PT
(4 strings max: prompt rationale, allowed-confirmation, denied-hint,
settings label) following the existing `t()` interpolation conventions.

**Verify**: doc contains the three options, one recommendation, ≤4 copy strings × 3 locales.

### Step 3: Browser-mode probe

`spikes/notification-probe/` (self-contained HTML+JS, no app deps):
request permission, show a sample alert-shaped notification, log the
permission lifecycle to the page. Screenshot the granted and denied
states into the spike dir. Delete the probe dir before merge EXCEPT the
screenshots (move one of each into `docs/screenshots/` if they render
readably, else record "no useful screenshot" and move none).

**Verify**: probe runs in Chromium via the Playwright-bundled browser or a static server; screenshots exist or the no-screenshot verdict is recorded.

### Step 4: Decision gate + build sketch + hygiene

Write into `docs/OS_NOTIFICATIONS.md`: the explicit maintainer decision
(required before any build plan: option 1/2/3 + copy sign-off), the
build-plan sketch (files the build will touch, estimated S/M effort,
test plan: permission-grant/deny e2e with mocked Notification API), and
the egress re-affirmation (on-device only; any off-device follow-up needs
its own decision). Run the frontend gates (production untouched) and
confirm `git status` shows only in-scope files.

**Verify**: gates exit 0; `grep -c "^## " docs/OS_NOTIFICATIONS.md` ≥ 4; scope clean.

## Test plan

- No new production tests (spike).
- Existing suites stay green.
- The build plan carries the test obligations (mocked-Notification e2e for
  grant/deny paths, three-locale copy gating via `i18n.copy.test.ts`).

## Done criteria

ALL must hold:

- [ ] `docs/OS_NOTIFICATIONS.md` exists with ≥4 sections: context+quotes, emission/host map, three options + recommendation + trilingual copy, decision gate + build sketch
- [ ] Probe screenshots exist in `docs/screenshots/` or the no-screenshot verdict is recorded
- [ ] `cd frontend && npm run lint && npm run typecheck && npm run build && npm test` — all exit 0
- [ ] No production files modified (`git status` — spike dir deleted)
- [ ] `plans/README.md` status row for 050 updated (SKIPPED if a reviewer dispatched you)

## STOP conditions

Stop and report back (do not improvise) if:

- Any "Current state" excerpt is wrong against the live files.
- The MONITORING_MODE.md notification quotes have been superseded (a newer decision exists — report it; the spike's premise failed).
- The host context in `cli.py` cannot accept a permission handler without restructuring (report as build-plan risk escalation, don't restructure).
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- The maintainer decision in this doc is the build plan's gate; a build
  plan may only revisit it with new evidence (same rule as the 021/022 gates).
- If the decision is "never" (in-app forever), mark this spike's outcome
  in `plans/README.md` rejected-notes so it isn't re-spiked.
- **Deferred:** the build plan itself — blocked on the maintainer decision recorded here.
