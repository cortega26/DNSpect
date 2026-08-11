from __future__ import annotations

import csv
import io

EXPORT_CSV_COLUMNS: tuple[str, ...] = (
    "resolver",
    "provider_id",
    "provider_name",
    "engine",
    "protocol",
    "avg_ms",
    "median_ms",
    "p95_ms",
    "min_ms",
    "max_ms",
    "ok_count",
    "timeout_count",
    "success_rate",
    "timeout_rate",
    "success_count",
    "failure_count",
    "failure_rate",
    "consistency_ratio",
    "p95_minus_median_ms",
    "score_latency",
    "score_reliability",
    "score_stability",
    "score_total",
    "normalized_latency",
    "normalized_reliability",
    "normalized_stability",
    "reliability_penalty",
    "max_rel_penalty",
    "blocking_efficacy",
    "blocked_count",
    "blocking_test_count",
    "score_blocking",
    "normalized_blocking",
    "is_unreliable",
    "dnssec_validating",
    "nxdomain_hijack_detected",
)


def _cell_value(stats: dict, item: dict, column: str) -> object:
    if column == "protocol":
        return item.get("protocol", "udp")
    if column in ("resolver", "provider_id", "provider_name", "engine"):
        return item.get(column)
    return stats.get(column, item.get(column))


def build_csv(state: dict) -> str:
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(EXPORT_CSV_COLUMNS)
    for item in state.get("results", []):
        stats = item["stats"]
        writer.writerow([_cell_value(stats, item, column) for column in EXPORT_CSV_COLUMNS])
    output.seek(0)
    return output.getvalue()
