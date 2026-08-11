# Plan 014: Degrade optional GeoIP safely and confine persisted-run lookup to generated IDs

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. If a STOP condition occurs, stop and report it; do not improvise. A coordinating reviewer maintains `plans/README.md` for this planning batch, so do **not** edit that file.
>
> **Drift check (run first)**: `git diff --stat e09fd2d..HEAD -- backend/app/geoip.py backend/app/main.py backend/app/runner.py backend/tests/test_geoip.py backend/tests/test_run_lookup_boundary.py`
> If any in-scope file changed since this plan was written, compare the Current state excerpts with live code. A material mismatch is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/005-run-history-integrity.md`
- **Category**: security
- **Planned at**: commit `e09fd2d`, 2026-08-10

## Why this matters

GeoIP is an optional enhancement, but if a GeoIP database exists while the optional `maxminddb` dependency is absent, its import occurs outside the recovery block and `/api/geoip` can return a server error. Separately, a user-controlled benchmark ID is appended directly to the persisted-run directory on a disk fallback, allowing path-like values to influence file lookup after an in-memory miss. The application is local-first and normal jobs already use `uuid.uuid4().hex`; this plan retains that behavior while making optional GeoIP failures return a stable empty result and allowing disk lookup only for canonical generated UUIDv4 IDs whose resolved path remains contained in the runs directory.

## Current state

- `backend/app/geoip.py` — validates an IP, locates an optional GeoLite database, imports/opens `maxminddb`, and returns geographical fields.
- `backend/app/main.py` — exposes the GeoIP and benchmark status/export endpoints.
- `backend/app/runner.py` — generates benchmark IDs and falls back from in-memory state to `data/runs/<id>.json`.
- `backend/pyproject.toml` — declares `maxminddb` only in the optional `geoip` dependency group.
- `backend/tests/test_geoip.py` — current direct helper tests cover private/invalid IP and missing database, but not an existing database with absent optional dependency or API shape.
- `backend/tests/test_storage_warning_api.py` — isolated-manager + `TestClient` monkeypatch convention for route boundary tests.
- `backend/tests/test_run_lookup_boundary.py` — create this focused temporary-directory lookup-boundary test module.

The optional import is outside its error boundary (`backend/app/geoip.py:10-51`):

```python
db_path = _resolve_db_path()
if db_path is None:
    return {}

import maxminddb  # type: ignore[import-untyped]

try:
    reader = maxminddb.open_database(str(db_path), maxminddb.MODE_AUTO)
except FileNotFoundError:
    return {}
except ImportError:
    return {}
```

`maxminddb` is deliberately optional (`backend/pyproject.toml:22-37`):

```toml
[project.optional-dependencies]
geoip = ["maxminddb==2.7.0"]
```

The endpoint mutates whatever result it receives and only supplies a full empty shape on a missing client address (`backend/app/main.py:73-84`):

```python
@app.get("/api/geoip")
def geoip(request: Request, ip: str = Query(default="")) -> dict:
    client_ip = ip.strip() or request.client.host if request.client else ""
    if not client_ip:
        return {"country_code": None, "country_name": None, "region": None, "city": None}
    result = geoip_lookup(client_ip)
    result["source"] = "GeoIP database" if result.get("country_code") else None
    return result
```

Benchmark IDs are generated in canonical lowercase UUIDv4 hex form, but disk fallback accepts any string (`backend/app/runner.py:279-310,378-393`):

```python
benchmark_id = uuid.uuid4().hex
...
def get(self, benchmark_id: str, include_samples: bool = False) -> dict[str, Any] | None:
    with self._lock:
        self._cleanup_terminal_states_locked()
        state = self._states.get(benchmark_id)
        if state:
            return state.as_response(include_samples=include_samples)

    result_path = self._data_runs_dir / f"{benchmark_id}.json"
    if not result_path.exists():
        return None
    try:
        return json.loads(result_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
```

All three public lookup routes call `manager.get()` before returning a response or building an export filename (`backend/app/main.py:107-145`). Thus one manager-level fallback guard protects status, JSON export, and CSV export. Existing tests intentionally inject a non-UUID in-memory state (`backend/tests/test_include_samples.py:10-95`), so validation must apply **only after** the in-memory lookup misses; do not break this test convention or unrelated internal callers.

Current GeoIP tests establish graceful empty results for invalid/private/no-DB cases (`backend/tests/test_geoip.py:1-42`). `backend/tests/test_storage_warning_api.py:1-56` demonstrates the correct API-isolation pattern: construct `BenchmarkManager(..., data_runs_dir=tmp_path / "runs")`, monkeypatch `app.main.manager`, and use `TestClient(app)` without a live server.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install backend tooling (only if `.venv` is absent) | `make backend-install` | exit 0 and `backend/.venv` exists |
| Focused GeoIP and lookup tests | `cd backend && . .venv/bin/activate && pytest -q tests/test_geoip.py tests/test_run_lookup_boundary.py` | exit 0; all selected tests pass without a network request |
| Route regression tests | `cd backend && . .venv/bin/activate && pytest -q tests/test_storage_warning_api.py tests/test_include_samples.py` | exit 0; existing API isolation/legacy in-memory-ID behavior passes |
| Full backend quality gate | `make backend-check` | exit 0; Ruff, format check, mypy, Bandit, and pytest all pass |
| Scope review | `git diff --check && git status --short` | no whitespace errors; implementation/test changes only in the in-scope paths, plus coordinator-owned plan files already present |

## Scope

**In scope** (the only files to modify):

- `backend/app/geoip.py`
- `backend/app/main.py`
- `backend/app/runner.py`
- `backend/tests/test_geoip.py`
- `backend/tests/test_run_lookup_boundary.py` (create)

**Out of scope**:

- GeoIP database acquisition, licensing, automatic updates, remote IP services, or external calls. GeoIP remains local and optional.
- Region targeting, provider-country claims, browser-locale fallback, frontend display behavior, and privacy-claim validation.
- Benchmark response semantics, persistence ordering/history sorting, profile fields, queue limits, and sample retention; they are owned by earlier plans.
- User-supplied resolver IP validation, private/internal-resolver diagnostics, subprocess behavior, CORS/host binding, or authentication. Do not treat the local-first design as an Internet-exposed service redesign.
- General filesystem sandboxing or a new storage abstraction; apply containment only to the persisted-run read fallback.

## Git workflow

- Branch: `advisor/014-backend-boundary-hardening`.
- Commit graceful-degradation, lookup-boundary, and regression tests together using the repository's Conventional Commit style, for example: `fix: harden optional GeoIP and run lookup`.
- Do not push, open a PR, or edit `plans/README.md` unless the operator explicitly asks.

## Steps

### Step 1: Make optional GeoIP dependency/database failures non-fatal

In `backend/app/geoip.py`, place the optional `maxminddb` import and reader-open operation behind a single small private helper (for example `_open_geoip_reader(db_path)`) that returns no reader for expected optional-component failures. Handle only expected conditions:

- missing `maxminddb` (`ImportError`/`ModuleNotFoundError`);
- an unavailable/unreadable database path (`OSError`, including `FileNotFoundError`);
- the documented `maxminddb` invalid-database/open exception, imported only after the package import succeeds.

`geoip_lookup()` must turn a no-reader or expected lookup/read error into `{}` and must always close a successfully opened reader in `finally`. Do not catch broad `Exception`, hide programming errors, query a remote service, or change the existing early return for invalid/private/loopback IPs. Keep result keys/normalization exactly as today on a successful lookup.

In `backend/app/main.py`, construct a fixed empty GeoIP response shape containing `country_code`, `country_name`, `region`, `city`, and `source`, all `None`. Merge a successful lookup's known fields into that shape and set `source` only when a country is available. `/api/geoip` must therefore return HTTP 200 with the same five keys whether GeoIP is absent, unusable, private, invalid, or successfully resolved.

**Verify**: `cd backend && . .venv/bin/activate && pytest -q tests/test_geoip.py` → exit 0 after Step 3 adds absent-dependency/corrupt-reader/API-shape cases.

### Step 2: Validate canonical generated IDs and contain the disk fallback path

In `backend/app/runner.py`, add a private helper used solely by `BenchmarkManager.get()`'s disk fallback, for example `_persisted_run_path(benchmark_id) -> Path | None`. It must:

1. Parse `benchmark_id` as a UUID and accept it only if its lowercase 32-character `.hex` representation equals the original string **and** it is UUID version 4, matching `uuid.uuid4().hex` created in `start()`.
2. Build the metadata filename only after successful validation.
3. Resolve both the candidate and `self._data_runs_dir`, then verify the candidate is relative to the resolved directory (use `Path.is_relative_to` or an equivalent `relative_to` try/except). Return `None` rather than accessing disk if the containment check fails.

In `get()`, retain the current lock-protected in-memory lookup first. Only when it misses should it call `_persisted_run_path`; an invalid/noncanonical ID returns `None` without `exists()`, `read_text()`, or any path construction based on the raw value. Preserve successful disk restoration of a valid persisted UUIDv4 record and the existing JSON/OSError recovery. Do not apply the new restriction to `get_state()` or force arbitrary in-memory test IDs to become UUIDs.

**Verify**: `cd backend && . .venv/bin/activate && pytest -q tests/test_run_lookup_boundary.py` → exit 0 after Step 3 adds accepted/rejected lookup cases.

### Step 3: Add deterministic regression tests at both boundaries

Extend `backend/tests/test_geoip.py` without requiring the optional package or a real MaxMind database:

- create an existing placeholder `.mmdb` under `tmp_path`, set `DNS_SPEED_LAB_GEOIP_DB` to it, and simulate a missing package through the new reader helper or module-import seam; assert `geoip_lookup("8.8.8.8") == {}` rather than an exception;
- simulate the documented corrupt/open/read failure through the helper and assert `{}` with the reader closed if it was created;
- monkeypatch `app.main.geoip_lookup` to return `{}`, call `/api/geoip?ip=8.8.8.8` through `TestClient`, and assert HTTP 200 plus exactly the five stable keys with `None` values. Also retain success-shape coverage with a small fake lookup dictionary, not a real database.

Create `backend/tests/test_run_lookup_boundary.py` using `BenchmarkManager(..., data_runs_dir=tmp_path / "runs")`:

- write a minimal JSON metadata file named by `uuid.uuid4().hex`, remove/no-op its in-memory state, and assert `manager.get(valid_id)` restores it;
- create a sentinel JSON outside `data_runs_dir` and assert every invalid input (`"not-a-uuid"`, an uppercase/hyphenated UUID form, a non-v4 UUID, `"../outside"`, and a backslash traversal-looking string) returns `None` while the sentinel is unchanged;
- inject a legacy non-UUID `BenchmarkState` into `_states` under the manager lock and assert `manager.get(legacy_id)` still returns its live response, proving validation is restricted to disk fallback;
- monkeypatch `app.main.manager` to an isolated manager and assert `/api/benchmarks/not-a-uuid`, `/api/benchmarks/not-a-uuid/export.json`, and `/api/benchmarks/not-a-uuid/export.csv` all return 404. Do not rely on encoded slash behavior at the router; direct manager tests cover raw traversal values.

Use no live DNS, no MaxMind download, no external IP service, and no fixed sleeps. Use `tmp_path`, `monkeypatch`, and `TestClient` as in the existing tests.

**Verify**: `cd backend && . .venv/bin/activate && pytest -q tests/test_geoip.py tests/test_run_lookup_boundary.py tests/test_storage_warning_api.py tests/test_include_samples.py` → all existing and new tests pass.

### Step 4: Run the full backend gate and inspect failure boundaries

Run the normal backend quality gate. Review exception scopes: only optional GeoIP component/database failures must degrade to empty results; neither unexpected Python errors nor a successful lookup's output should be suppressed. Review ID logic: UUID parsing happens before raw identifier joins the disk filename, and a valid path is containment-checked after resolution.

**Verify**: `make backend-check` → exit 0.

## Test plan

- GeoIP: invalid/private IP stays empty; an existing database with unavailable dependency, corrupt/open failure, and lookup failure all stay empty; a successful fake lookup retains normalized data; the endpoint always returns the stable five-field 200 shape.
- Disk restoration: current `uuid.uuid4().hex` metadata still loads from a temporary runs directory.
- Boundary rejection: malformed, uppercase/hyphenated, non-v4, and traversal-looking identifiers cannot cause a disk lookup or read an outside sentinel.
- Compatibility: arbitrary legacy **in-memory** state IDs still work; all public status/export routes turn an invalid fallback ID into 404.
- Final verification: `make backend-check` → all backend checks pass.

## Done criteria

- [ ] An installed/located GeoIP database with no optional `maxminddb` package cannot make `geoip_lookup` or `/api/geoip` raise a server error.
- [ ] Expected unavailable/corrupt GeoIP reader errors produce an empty lookup; reader resources close on every successful open path.
- [ ] `/api/geoip` returns HTTP 200 with exactly `country_code`, `country_name`, `region`, `city`, and `source` on empty and successful paths.
- [ ] Disk fallback accepts only lowercase 32-character UUIDv4 hex IDs generated by `start()` and verifies resolved-path containment before file access.
- [ ] Invalid/path-like IDs return `None`/404 and cannot reach an outside sentinel; valid persisted UUIDv4 runs still restore.
- [ ] Existing non-UUID in-memory state lookups remain compatible.
- [ ] `make backend-check` exits 0.
- [ ] `git diff --check` exits 0 and implementation/test changes are confined to the in-scope paths.
- [ ] `plans/README.md` is unchanged.

## STOP conditions

Stop and report back if:

- The installed `maxminddb` version exposes a different documented exception type, and catching it would require a broad `Exception` handler or an unpinned dependency change.
- The project deliberately supports persisted benchmark IDs that are not lowercase UUIDv4 hex, or a published API/client contract requires accepting hyphenated/legacy disk IDs; choose and document a migration instead of silently breaking restoration.
- The runs directory is intentionally allowed to contain symlinked metadata outside its root, or containment changes conflict with a supported packaging/storage layout.
- Stable GeoIP response fields are versioned elsewhere and adding `source`/null fields would violate that explicit contract.
- The change requires a database download, a remote lookup, frontend work, general filesystem sandboxing, or modification of private-resolver diagnostics.
- `make backend-check` fails twice after a reasonable in-scope correction.

## Maintenance notes

- Keep GeoIP optional: any future provider must be local, bounded, and return the same empty response contract when unavailable.
- If run-ID generation ever changes, update `_persisted_run_path` validation and the UUID restoration regression in the same change; do not weaken containment to retain arbitrary filenames.
- Reviewers should focus on exception granularity, reader close behavior, and the invariant that raw IDs never influence a disk path before validation.
- Atomic writes, retention policy, and broader data-directory hardening remain deliberately deferred.
