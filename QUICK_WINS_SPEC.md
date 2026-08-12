# DNSpect Quick Wins — Completed Work Record

All items below shipped as of 1.3.0. This document is kept as a completed-work record: the specs describe what was implemented, and the acceptance criteria reflect the shipped state. It is no longer a list of implementable tasks.

---

## QW1: NXDOMAIN Hijacking Detection

**Status:** ✅ Done  
**Complexity:** Low  
**Impact:** High  
**Estimate:** 3-5 hours

### Description
Many ISP resolvers return ad-filled landing pages with fake A records instead of genuine NXDOMAIN responses for nonexistent domains. This violates RFC standards and indicates the resolver manipulates DNS responses. DNSpect should detect and flag this.

### Why it matters
Users running privacy/security benchmarks want to know if their ISP or current resolver is tampering with DNS. This is a trust signal. No other benchmark tool detects this in a GUI.

### Implementation

#### Backend (`runner.py`, `stats.py`)

**Approach:** After the normal latency queries and blocking efficacy test, run one additional query per resolver against a domain guaranteed to be nonexistent (a random UUID subdomain). Check the response:

- If drill: check if `rcode: NXDOMAIN` → resolver behaves correctly
- If dnspython: catch `NXDOMAIN` exception → correct
- If a valid A record is returned → hijacking detected
- If SERVFAIL/REFUSED/timeout → inconclusive (don't flag)

The check query should be unique per resolver to avoid any caching effects:
- `nxdomain-check-{short_random}.invalid.`

Add to `runner.py` — after the blocking efficacy test block (around line 606):

```python
# NXDOMAIN hijacking detection
import random
import string
hijack_test_domain = f"nxdomain-check-{''.join(random.choices(string.ascii_lowercase, k=8))}.invalid"
hijack_sample = measure_query(
    resolver=resolver,
    domain=hijack_test_domain,
    timeout_sec=config.timeout_sec,
    engine=engine,
)
hijack_detected = None  # None = inconclusive, True = hijacked, False = not hijacked
if hijack_sample["ok"] and hijack_sample.get("answer_ips"):
    # Got a valid A record for a guaranteed-nonexistent domain → hijacking
    hijack_detected = True
elif hijack_sample.get("failure_kind") == "nxdomain":
    hijack_detected = False

stats["nxdomain_hijack_detected"] = hijack_detected
```

**Changes to `stats.py`:** Add `nxdomain_hijack_detected` to the default stats dict (initialized as `None` in both the success and no-success branches of `compute_stats()`).

**Changes to `models.py`:** No change needed — this is a runtime field, not a request parameter.

#### Frontend

**Changes to `types.ts`:** Add `nxdomain_hijack_detected?: boolean | null` to `ResolverStats`.

**Changes to `ResolverRankingPanel.tsx`:** In the ranking row, add a visual indicator:
- Green shield icon → not hijacked
- Red warning icon → hijacked
- Grey dash → inconclusive

**Changes to `ResultsTable.tsx`:** Add a column for NXDOMAIN hijacking status.

**Changes to `i18n-translations.ts`:** Add translation keys:
- `nxdomain.status`: "NXDOMAIN"
- `nxdomain.hijacked`: "Hijacking detected"
- `nxdomain.clean`: "No hijacking"
- `nxdomain.inconclusive`: "Unable to verify"

**Changes to `ChartsPanel.tsx`:** Add a chart tab or include as metadata in tooltip.

### Testing

**Backend test:** `tests/test_nxdomain_hijack.py`
- Mock query returning A record for nonexistent domain → `hijack_detected = True`
- Mock query returning NXDOMAIN → `hijack_detected = False`
- Mock query returning SERVFAIL → `hijack_detected = None`

### Acceptance Criteria
- [x] Each resolver tested with a unique random nonexistent domain
- [x] Resolvers returning fake A records flagged as "hijacking detected"
- [x] Resolvers returning NXDOMAIN shown as clean
- [x] Timeouts/SERVFAIL shown as inconclusive
- [x] Hijack status visible in ranking table
- [x] CSV export includes the column

---

## QW2: DNSSEC Validation Check

**Status:** ✅ Done  
**Complexity:** Low-Medium  
**Impact:** Medium-High  
**Estimate:** 4-6 hours

### Description
Some resolvers don't perform DNSSEC validation or ignore invalid signatures, exposing users to spoofed DNS data. DNSpect should:
1. Query a domain with a known-bad DNSSEC signature → expect SERVFAIL from a validating resolver
2. Optionally query a DNSSEC-signed domain → check `ad` (authentic data) flag in response

### Implementation

#### Backend (`runner.py`)

Two test queries per resolver, appended after the NXDOMAIN check:

**DNSSEC-failed domain:** `dnssec-failed.org` (well-known domain deliberately broken). Or use a more reliable test domain like `badsig.go.dnscheck.tools`.

**Approach with drill:**
```python
dnssec_fail = measure_query(
    resolver=resolver,
    domain="badsig.go.dnscheck.tools",
    timeout_sec=config.timeout_sec,
    engine=engine,
)
dnssec_validating = None  # None = inconclusive
if dnssec_fail.get("failure_kind") == "servfail":
    dnssec_validating = True  # Properly validating
elif dnssec_fail["ok"]:
    dnssec_validating = False  # Not validating

stats["dnssec_validating"] = dnssec_validating
```

**Approach with dnspython:**
```python
try:
    dnsr = dns.resolver.Resolver(configure=False)
    dnsr.nameservers = [resolver]
    dnsr.lifetime = timeout_sec
    answers = dnsr.resolve("badsig.go.dnscheck.tools", "A")
    dnssec_validating = False  # Got answer when should have failed
except dns.resolver.NoNameservers:
    dnssec_validating = True  # SERVFAIL = validating
except dns.exception.Timeout:
    dnssec_validating = None  # Inconclusive
```

#### Frontend

**Changes to `types.ts`:** Add `dnssec_validating?: boolean | null` to `ResolverStats`.

**Changes to `ResolverRankingPanel.tsx`:** Show checkmark/cross icon alongside NXDOMAIN hijacking.

**Changes to `ResultsTable.tsx`:** Add DNSSEC column (can share a "Security" column group with NXDOMAIN).

**Changes to `ChartsPanel.tsx`:** Could show as a colored row header or include in reliability chart.

**Changes to `i18n-translations.ts`:**
- `dnssec.title`: "DNSSEC"
- `dnssec.validating`: "Validates DNSSEC"
- `dnssec.notValidating`: "Does not validate"
- `dnssec.inconclusive`: "Unable to verify"

### Testing

**Backend test:** `tests/test_dnssec_check.py`
- Mock query returning SERVFAIL → `dnssec_validating = True`
- Mock query returning A record → `dnssec_validating = False`
- Mock timeout → `dnssec_validating = None`
- Integration with drill output parsing

### Concerns
- `dnssec-failed.org` might resolve at some point if fixed. Use multiple domains from `dnscheck.tools` for redundancy.
- DNSSEC validation can be network-dependent. Document that this is a best-effort check.

### Acceptance Criteria
- [x] Each resolver tested for DNSSEC validation against known-bad domain
- [x] Validating resolvers shown with checkmark
- [x] Non-validating resolvers shown with warning
- [x] Inconclusive results handled gracefully
- [x] Visible in ranking table

---

## QW3: Expand Provider Catalog (25 → 50+)

**Status:** ✅ Done  
**Complexity:** Low  
**Impact:** Very High  
**Estimate:** 3-5 hours (mostly data entry + research)

### Description
Current catalog has ~25 provider entries with 41 IPs. Expanding to 50+ entries (100+ IPs) makes DNSpect more comprehensive and credible. More resolvers = better recommendations.

### Implementation

#### Data file (`data/dns_providers.es.json`)

Add these well-known providers (each with proper IPs, tags, region, goals, features):

**Already present:** Cloudflare, Google, Quad9 (x2: filtered + unfiltered), OpenDNS (x2: home + family), AdGuard, ControlD (x4: default + family + unfiltered + blocking), NextDNS, DNS.Watch, Lumen/Level3, dns0.eu, CZ.NIC, Digitalcourage, Mullvad, UncensoredDNS, AliDNS, DNSPod, KT DNS, Bharat DNS, LACNIC, NIC.br, Neustar/UltraDNS, Comodo.

**New providers to research and add (** **needs research):**
- **NordVPN DNS** — 103.86.96.100, 103.86.99.100 (privacy, no-log)
- **Surfshark DNS** — 162.252.172.57, 149.154.159.152 (privacy)
- **TentaDNS** — privacy-focused, anycast
- **Yandex DNS** — 77.88.8.8, 77.88.8.1 (basic/safe/family variants)
- **SafeDNS** — 195.46.39.39, 195.46.39.40 (filtering)
- **CleanBrowsing** — 185.228.168.9, 185.228.169.9 (family/adult/security variants)
- **Alternate DNS** — 76.76.19.19, 76.223.122.150
- **DNS for Family** — 94.130.180.225, 78.47.64.161
- **Freenom World** — 80.80.80.80, 80.80.81.81
- **Neustar (more variants)** — already partially present, add all 4 tiers
- **CenturyLink** — 205.171.3.65, 205.171.2.65
- **Verisign** — 64.6.64.6, 64.6.65.6
- **DNS.SB** — 185.222.222.222, 45.11.45.11
- **CZ.NIC (ODVR)** — already present, add all IPs
- **dns0.eu (more IPs)** — already present, add IPv6
- **Hurricane Electric** — 74.82.42.42
- **Oracle/Verizon DNS** — 4.2.2.1 through 4.2.2.6 (already present as legacy Level3)
- **Applied Privacy** — 146.255.56.98 (privacy, DoT/DoH)
- **LibreDNS** — 80.67.169.12 (privacy-focused)
- **RethinkDNS** — 146.148.42.155, 34.106.43.218 (privacy + blocking)

**Per-provider metadata to fill:**
- Proper goal assignments (filtering providers → ad-blocking/family/security)
- Proper region assignments (check anycast or single-location)
- Country assignments
- Feature flags: filtering, malware_protection, family, doh, dot
- Spanish notes (notes_es) briefly describing each provider
- tags: ['global', 'privacidad', 'seguridad', 'anycast', 'latam', etc.]

#### Frontend

**Changes to `DashboardControls.tsx`:** With more providers, consider:
- Grouping by tag/region in the resolver picker
- Search/filter box for providers
- Category pills (Privacy, Security, Speed, Filtering)

#### Backend

**Changes to `providers.py`:** No structural changes needed — the JSON loading is already generic. Just handle the larger data volume (validate no regressions).

### Data Integrity
- Deduplicate IPs across providers
- Validate all IPs are valid IPv4/IPv6
- Ensure no provider has >6 IPs (the schema limit per the provider_index logic)
- Test with the existing provider count tests

### Testing
- `tests/test_providers.py` already validates provider loading
- Add a test for minimum provider count (assert >= 50)
- Add a test for no duplicate IPs across providers
- Add a test verifying each provider has at least one valid goal

### Acceptance Criteria
- [x] 50+ provider entries in the catalog
- [x] All IPs validated and deduplicated
- [x] Region tags accurate for each provider
- [x] Goal assignments correct for each provider
- [x] Feature flags (DoH, DoT, filtering) accurately documented
- [x] No regression in provider loading tests

---

## QW4: Blocking Efficacy UI Integration

**Status:** ✅ Done  
**Complexity:** Low  
**Impact:** High  
**Estimate:** 2-4 hours

### Description
The blocking efficacy feature (9 test domains, sinkhole IP detection, 4-tuple scoring) is fully implemented in the backend but the frontend needs:
1. Proper labels and descriptions for blocking percentage
2. Blocking score displayed in ranking table
3. Tooltips explaining what the blocking percentage means
4. Integration with the "ad-blocking" and "family" goals

### Current State
- Backend: `runner.py` lines 584-605 run blocking test per resolver
- Backend: `stats.py` `compute_blocking_efficacy()` counts NXDOMAIN/REFUSED/sinkhole
- Backend: Scoring weights include blocking for each goal
- Frontend: `types.ts` has `blocking_efficacy`, `blocked_count`, `blocking_test_count` in stats
- Frontend: `ChartsPanel.tsx` has a "blocking" chart view tab
- Frontend: `utils.ts` has `resolverBlockingScore()` helper
- Frontend: `reporting.ts` includes `blocking_efficacy`, `blocked_count`, etc. in CSV export
- Frontend: `App.tsx` imports `resolverBlockingScore` (check if actually displayed)

### Missing UI Elements

**1. Ranking panel (`ResolverRankingPanel.tsx`)**
The ranking row currently shows "Score {scoreTotal} - {latency}ms - {reliability}%". Add blocking efficacy for ad-blocking/family goals:
- For ad-blocking/family goals: show blocking % instead of (or in addition to) reliability %
- Visual badge: shield icon showing blocking %.

**2. Recommended resolver panel (`RecommendedResolverPanel.tsx`)**
Show blocking efficacy in the recommendation summary when goal is ad-blocking or family.

**3. Resolver detail modal (`ResolverDetailModal.tsx`)**
Add a section showing which specific domains were blocked. This is the most informative view.

**4. Translations**
Add keys for blocking-specific labels.

### Changes needed

**`ResolverRankingPanel.tsx`:**
- Add `blocking_efficacy` display in the meta line: `"Bloqueo: {pct}%"` when blocking test ran
- Show different meta info based on selected goal

**`RecommendedResolverPanel.tsx`:**
- Add line with blocking efficacy when relevant

**`ResolverDetailModal.tsx`:**
- Add blocked domains list section — shows domains that returned blocked vs. not

**`i18n-translations.ts`:**
- `blocking.title`: "Bloqueo de contenido"
- `blocking.efficacy`: "Eficacia de bloqueo: {{pct}}%"
- `blocking.blockedCount": "{{count}} of {{total}} domains blocked"
- `blocking.testNote`: "Tested against {{count}} known ad/malware domains"
- `blocking.blockedListTitle`: "Blocked domains"
- `blocking.passedListTitle`: "Allowed domains"

### Testing
- Visual testing: run benchmark in ad-blocking mode, verify blocking scores display
- Verify chart renders correctly with blocking data

### Acceptance Criteria
- [x] Blocking efficacy % shown in ranking for each resolver
- [x] Blocked domains list visible in detail modal
- [x] Recommended resolver shows blocking score when relevant
- [x] Proper labels in all 3 languages
- [x] Chart view "blocking" works correctly

---

## QW5: Per-Protocol Provider Metadata

**Status:** ✅ Done  
**Complexity:** Low  
**Impact:** Medium  
**Estimate:** 2-3 hours

### Description
Provider entries currently have `features.doh` and `features.dot` fields. Add complete encrypted DNS endpoint data to each provider so DNSpect knows:
1. Which protocols each provider supports
2. The specific DoH URL and DoT hostname
3. Whether DoQ (DNS-over-QUIC) is available

### Implementation

#### Data file (`data/dns_providers.es.json`)

Extend the `features` object on each provider:

```json
{
  "features": {
    "filtering": "yes|no|family",
    "malware_protection": "yes|no",
    "family": "yes|no",
    "doh": "yes|no",
    "dot": "yes|no",
    "doq": "yes|no",
    "doh_url": "https://example.com/dns-query",
    "dot_hostname": "dns.example.com",
    "doq_hostname": "dns.example.com"
  }
}
```

**Sources for encrypted DNS endpoints:**
- https://dnsprivacy.org/public_resolvers/
- https://github.com/dnsdb/dnsdb (community-maintained DNS metadata)
- Provider documentation pages

#### Frontend

**Changes to `types.ts`:** Extend `ProviderFeatures`:

```typescript
export interface ProviderFeatures {
  filtering: string
  malware_protection: string
  family: string
  doh: string
  dot: string
  doq?: string
  doh_url?: string
  dot_hostname?: string
  doq_hostname?: string
}
```

**Changes to `DashboardControls.tsx`:** Add protocol filter chip:
- "UDP" | "DNS-over-TLS" | "DNS-over-HTTPS" | "DNS-over-QUIC"
- When a protocol is selected, only show providers that support it

**Changes to `RecommendedResolverPanel.tsx`:** Show which protocols the recommended resolver supports, with copy buttons for different protocol endpoints.

### Testing
- Validate metadata against known dnsprivacy.org data
- Test that protocol filter correctly filters providers in UI
- Test copy buttons produce correct endpoint strings

### Acceptance Criteria
- [x] All providers have accurate DoH/DoT/DoQ metadata
- [x] Protocol filter chips work in dashboard
- [x] Recommended resolver shows protocol support
- [x] Copy buttons produce correct protocol-specific endpoints

---

## QW6: Run History Sidebar

**Status:** ✅ Done  
**Complexity:** Medium  
**Impact:** Medium-High  
**Estimate:** 5-8 hours

### Description
Currently only the last run is saved in localStorage. Add a sidebar showing ALL past runs with date, mode, goal, and top-3 results. Clicking on a past run reloads its results.

### Implementation

#### Backend

**New endpoint:** `GET /api/benchmarks/history` — returns list of all persisted runs on disk:
```json
{
  "runs": [
    {
      "id": "...",
      "mode": "standard",
      "goal": "speed",
      "started_at": "2026-05-11T...",
      "top_results": ["Cloudflare 1.1.1.1", "Quad9 9.9.9.9", "Google 8.8.8.8"],
      "status": "done"
    }
  ]
}
```

**Implementation in `main.py`:**
```python
@router.get("/api/benchmarks/history")
def list_benchmark_history(manager: BenchmarkManager = Depends(get_manager)):
    return manager.list_history()
```

**Implementation in `runner.py`:**
```python
def list_history(self) -> dict:
    runs = []
    if not self._data_runs_dir.exists():
        return {"runs": runs}
    for path in sorted(self._data_runs_dir.glob("*.json"), reverse=True)[:50]:
        if path.name.endswith(".samples.json"):
            continue
        try:
            data = json.loads(path.read_text())
            # Extract summary info from persisted state
            runs.append({
                "id": path.stem,
                "mode": data.get("mode"),
                "goal": data.get("goal"),
                "started_at": data.get("started_at"),
                "status": data.get("status"),
                "progress": data.get("progress"),
                "results_summary": [
                    {"provider_name": r.get("provider_name"), "resolver": r.get("resolver")}
                    for r in (data.get("results") or [])[:3]
                ]
            })
        except (json.JSONDecodeError, OSError):
            continue
    return {"runs": runs}
```

#### Frontend

**New storage key:** Change from single `LAST_RUN_STORAGE_KEY` to:
- `dnspect:run_history:v1` — indexed list of `{benchmark_id, timestamp, mode, goal}` entries
- Individual runs stored as `dnspect:run:{benchmark_id}`

Or simpler: keep using server-side persistence (runs are already saved to disk at `~/.local/share/DNSpect/runs/`). The API endpoint lists them.

**New component:** `RunHistoryPanel.tsx`
- Collapsible sidebar or bottom panel
- Shows list of past runs with metadata
- Click to reload results for that run
- "Compare" checkbox mode to select 2 runs for comparison

**Changes to `App.tsx`:**
- Load history on mount (or first benchmark completion)
- Store selected run ID in state
- When a past run is selected, fetch full results (via new or existing endpoint)
- Display results in main panels (reusing existing components)

**Changes to `reporting.ts`:**
- Update `loadSavedLastRun()` to support loading specific runs by ID
- Add function to fetch run history from API

#### Backend: fetch specific past run

Reuse existing `GET /api/benchmarks/{id}` — but this only returns in-memory states. Need to add fallback to load from disk:

**Changes to `main.py`:**
```python
@router.get("/api/benchmarks/{benchmark_id}")
def get_benchmark(benchmark_id: str, include_samples: bool = Query(False), manager: BenchmarkManager = Depends(get_manager)):
    result = manager.get(benchmark_id, include_samples=include_samples)
    if result:
        return result
    # Try loading from disk
    ...
    if not result:
        raise HTTPException(404, "Benchmark not found")
    return result
```

### Testing
- Backend: test history listing returns correct structure
- Backend: test loading past run from disk
- Frontend: test history sidebar renders correctly with mock data

### Acceptance Criteria
- [x] History sidebar shows all past runs with date/mode/goal
- [x] Clicking a past run loads results into the UI
- [x] Minimum 50 runs preserved
- [x] Works with the existing disk persistence
- [x] New history API endpoint tested

---

## QW7: Dashboard View

**Status:** ✅ Done  
**Complexity:** Medium  
**Impact:** Medium  
**Estimate:** 4-6 hours

### Description
A post-benchmark dashboard at-a-glance view showing: recommended resolver, system DNS comparison, improvement estimate, top-5 ranking snippet, and key charts. This is the default view shown after a benchmark completes.

### Implementation

#### New component: `DashboardPanel.tsx`

Replaces the individual post-benchmark panels with a unified view:

```tsx
// Layout: hero card with recommendation + comparison
// Stats row: latency, reliability, blocking
// Mini ranking: top 5
// Action buttons: apply DNS, export, share, view details
```

**Sections:**
1. **Hero recommendation** (like current `RecommendedResolverPanel.tsx`)
2. **System DNS comparison** — your current vs. recommended
3. **Top-5 mini ranking** — compact list of best resolvers
4. **Comparison sparkline** — simple bar showing where you are
5. **Action bar** — Apply, Export, Share, View Details

**Changes to `App.tsx`:** After benchmark completes, show `DashboardPanel` as the primary view instead of individual panels. Keep existing panels accessible via tabs/buttons.

**Changes to `ChartsPanel.tsx`:**
- Integrate as a tab within the dashboard or keep separate
- Show one default chart (median latency) inline in the dashboard

### Acceptance Criteria
- [x] Dashboard shown after benchmark completes
- [x] Shows recommendation prominently
- [x] Shows system DNS comparison
- [x] Top-5 compact view
- [x] Action buttons (apply, export, share)

---

## QW8: Expand Query Domains

**Status:** ✅ Done  
**Complexity:** Very Low  
**Impact:** Medium  
**Estimate:** 1 hour

### Description
Current `data/queries.txt` has 21 domains, mostly global + Chilean. Add more realistic domains for different regions and use cases.

### New domains to add

**Global / CDN-backed:** `instagram.com`, `tiktok.com`, `whatsapp.net`, `microsoft.com`, `apple.com`, `amazon.com`, `x.com`, `reddit.com`, `linkedin.com`, `bing.com`, `duckduckgo.com`

**LATAM:** `globo.com` (Brazil), `infobae.com` (Argentina), `eluniversal.com.mx` (Mexico), `eltiempo.com` (Colombia)

**Europe:** `bbc.co.uk` (UK), `lemonde.fr` (France), `spiegel.de` (Germany), `repubblica.it` (Italy)

**Asia:** `baidu.com` (China), `naver.com` (Korea), `rakuten.co.jp` (Japan)

**Target:** 40-50 diverse domains.

### Why it matters
More query variety = more realistic benchmark. CDN-backed domains test resolver caching behavior and CDN affinity. Regional domains test resolver performance for region-specific content.

### Key files
- `data/queries.txt` — just add domains, one per line

### Acceptance Criteria
- [x] ~45 diverse query domains

---

## QW9: Expand Blocking Domains

**Status:** ✅ Done  
**Complexity:** Very Low  
**Impact:** Medium  
**Estimate:** 1 hour

### Description
Current `data/blocking_domains.txt` has 11 domains (6 ad/tracking + 5 malware/threat). Expand with more categories for richer blocking analysis.

### New categories

**Adult content (for family/parental filtering testing):**
- `pornhub.com`, `xvideos.com`, `xnxx.com` — common adult sites blocked by family filters

**Malware/Phishing (beyond current threat intel):**
- `malware-test-domain-1.example` — or use known test domains from malware filter testing
- Domains from uBOS domestic surveillance list: `ampostic.com`, `amyteg.com`

**Social media blocking (for workplace/family filters):**
- `facebook.com`, `twitter.com` — some family/mobile filters block these

### Implementation
- Add domains to `data/blocking_domains.txt` with comments showing the category
- Run existing `test_blocking_efficacy.py` to verify no regression
- Verify against known-filtering resolvers (AdGuard, ControlD, Quad9) and non-filtering (Cloudflare, Google)

### Key files
- `data/blocking_domains.txt` — just add domains, one per line

### Testing
- Verify with `test_blocking_efficacy.py` integration test

### Acceptance Criteria
- [x] Telemetry/analytics domains added
- [x] Social media blocking added
- [x] No regression in blocking efficacy tests

---

## Implementation Priority Matrix

| Quick Win | Complexity | Impact | Status | Priority |
|---|---|---|---|---|
| QW1 NXDOMAIN hijack | Low | High | ✅ Done | 1 |
| QW4 Blocking efficacy UI | Low | High | ✅ Done | 2 |
| QW3 Provider expansion | Medium | Very High | ✅ Done | 3 |
| QW2 DNSSEC check | Low-Med | Med-High | ✅ Done | 4 |
| QW5 Protocol metadata | Low | Medium | ✅ Done | 5 |
| QW8 Query domains | Very Low | Medium | ✅ Done | 6 |
| QW9 Blocking domains | Very Low | Medium | ✅ Done | 7 |
| QW6 Run history sidebar | Medium | Med-High | ✅ Done | 8 |
| QW7 Dashboard view | Medium | Medium | ✅ Done | 9 |
