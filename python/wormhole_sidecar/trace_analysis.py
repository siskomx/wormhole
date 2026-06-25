from collections import defaultdict


def _profile_id(trace):
    profile = trace.get("profile") or {}
    return str(trace.get("profileId") or profile.get("profileId") or "unknown").strip() or "unknown"


def _float_value(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def summarize_traces(payload):
    traces = payload.get("traces") or []
    grouped = defaultdict(list)

    for trace in traces:
        grouped[_profile_id(trace)].append(trace)

    profiles = []
    for profile_id in sorted(grouped):
        rows = grouped[profile_id]
        runs = len(rows)
        successes = sum(1 for row in rows if row.get("status") == "succeeded")
        failures = sum(1 for row in rows if row.get("status") == "failed")
        latencies = [_float_value(row.get("latencyMs")) for row in rows]
        qualities = [_float_value(row.get("outputQuality")) for row in rows]

        profiles.append(
            {
                "profileId": profile_id,
                "runs": runs,
                "successes": successes,
                "failures": failures,
                "averageLatencyMs": round(sum(latencies) / runs, 4) if runs else 0.0,
                "averageQuality": round(sum(qualities) / runs, 4) if runs else 0.0,
                "successRate": round(successes / runs, 4) if runs else 0.0,
            }
        )

    return {
        "traceCount": len(traces),
        "profiles": profiles,
    }
