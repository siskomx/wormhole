import hashlib
import json

SAFE_MODELS = {"fast", "balanced", "deep", "ultra", "small-local", "deep-reviewer"}
SAFE_SPLIT_STRATEGIES = {"single", "parallel", "sequential"}
SAFE_CONTEXT_BUDGETS = {"small", "medium", "large"}
SAFE_EVIDENCE_MODES = {"minimal", "standard", "strict"}
SAFE_STOP_RULES = {"continue", "verify", "escalate"}


def _reward(outcome):
    test_score = 10 if outcome.get("testsPassed") else -8
    evidence_score = min(outcome.get("evidenceCount", 0), 6) * 0.5
    question_penalty = min(outcome.get("openQuestions", 0), 10) * 0.8
    correction_penalty = min(outcome.get("userCorrectionCount", 0), 10) * 1.2
    duration_penalty = min(outcome.get("durationMs", 0) / 60000, 4)
    token_penalty = min(outcome.get("tokenEstimate", 0) / 50000, 4)
    reasoning_score = max(0, min(outcome.get("reasoningScore", 0), 1)) * 2
    return round(
        test_score
        + evidence_score
        + reasoning_score
        - question_penalty
        - correction_penalty
        - duration_penalty
        - token_penalty,
        4,
    )


def _graph_bucket(value):
    if value < 50:
        return "small"
    if value < 500:
        return "medium"
    return "large"


def _evidence_bucket(value):
    if value < 2:
        return "low"
    if value < 8:
        return "medium"
    return "high"


def _state_key(trace):
    risk = "high" if trace.get("openQuestions", 0) > 0 or not trace.get("outcome", {}).get("testsPassed") else "low"
    return "|".join(
        [
            trace.get("taskKind", "unknown"),
            f"graph:{_graph_bucket(trace.get('graphNodeCount', 0))}",
            f"evidence:{_evidence_bucket(trace.get('evidenceCount', 0))}",
            f"risk:{risk}",
        ]
    )


def _action_key(action):
    clamped = _clamp_action(action)
    return "|".join(
        [
            f"workers={clamped['workerCount']}",
            f"verifiers={clamped['verifierCount']}",
            f"depth={clamped['maxDepth']}",
            f"model={clamped['modelProfile']}",
            f"split={clamped['splitStrategy']}",
            f"context={clamped['contextBudget']}",
            f"evidence={clamped['evidenceMode']}",
            f"stop={clamped['stopRule']}",
        ]
    )


def _clamp_int(value, minimum, maximum, fallback):
    try:
        number = int(value)
    except Exception:
        number = fallback
    return max(minimum, min(maximum, number))


def _clamp_action(action):
    model = action.get("modelProfile", "balanced")
    split = action.get("splitStrategy", "single")
    context = action.get("contextBudget", "medium")
    evidence = action.get("evidenceMode", "standard")
    stop = action.get("stopRule", "verify")
    return {
        "workerCount": _clamp_int(action.get("workerCount", 1), 1, 6, 1),
        "verifierCount": _clamp_int(action.get("verifierCount", 0), 0, 2, 0),
        "maxDepth": _clamp_int(action.get("maxDepth", 1), 1, 4, 1),
        "modelProfile": model if model in SAFE_MODELS else "balanced",
        "splitStrategy": split if split in SAFE_SPLIT_STRATEGIES else "single",
        "contextBudget": context if context in SAFE_CONTEXT_BUDGETS else "medium",
        "evidenceMode": evidence if evidence in SAFE_EVIDENCE_MODES else "standard",
        "stopRule": stop if stop in SAFE_STOP_RULES else "verify",
    }


def _parse_jsonl(text):
    rows = []
    for line in (text or "").splitlines():
        stripped = line.strip()
        if stripped:
            rows.append(json.loads(stripped))
    return rows


def _policy_id(q_table):
    encoded = json.dumps(q_table, sort_keys=True, separators=(",", ":")).encode("utf8")
    return "policy:" + hashlib.sha256(encoded).hexdigest()[:16]


def _safe_action(action):
    parsed = {}
    try:
        for part in action.split("|"):
            key, value = part.split("=", 1)
            parsed[key] = value
    except ValueError:
        return False
    try:
        workers = int(parsed.get("workers", 0))
        verifiers = int(parsed.get("verifiers", 0))
        depth = int(parsed.get("depth", 0))
    except ValueError:
        return False
    model = parsed.get("model", "")
    split = parsed.get("split", "single")
    context = parsed.get("context", "medium")
    evidence = parsed.get("evidence", "standard")
    stop = parsed.get("stop", "verify")
    return (
        1 <= workers <= 6
        and 0 <= verifiers <= 2
        and 1 <= depth <= 4
        and model in SAFE_MODELS
        and split in SAFE_SPLIT_STRATEGIES
        and context in SAFE_CONTEXT_BUDGETS
        and evidence in SAFE_EVIDENCE_MODES
        and stop in SAFE_STOP_RULES
    )


def _parse_action_key(action):
    if not _safe_action(action):
        return None
    parsed = {}
    for part in action.split("|"):
        key, value = part.split("=", 1)
        parsed[key] = value
    return _clamp_action(
        {
            "workerCount": parsed.get("workers", 1),
            "verifierCount": parsed.get("verifiers", 0),
            "maxDepth": parsed.get("depth", 1),
            "modelProfile": parsed.get("model", "balanced"),
            "splitStrategy": parsed.get("split", "single"),
            "contextBudget": parsed.get("context", "medium"),
            "evidenceMode": parsed.get("evidence", "standard"),
            "stopRule": parsed.get("stop", "verify"),
        }
    )


def _normalize_action_key(action):
    parsed = _parse_action_key(action)
    if parsed is None:
        return None
    return _action_key(parsed)


def _evaluate_policy_payload(traces, policy):
    q_table = policy.get("qTable", {})
    safety_violations = []
    matches = 0
    rewards = []
    for trace in traces:
        state = _state_key(trace)
        actions = q_table.get(state, {})
        if actions:
            selected = max(actions.items(), key=lambda item: (item[1], item[0]))[0]
            if not _safe_action(selected) and selected not in safety_violations:
                safety_violations.append(selected)
            if _normalize_action_key(selected) == _action_key(trace.get("action", {})):
                matches += 1
        rewards.append(_reward(trace.get("outcome", {})))
    replay_pass_rate = matches / len(traces) if traces else 0
    if safety_violations:
        replay_pass_rate = 0
    return {
        "policyId": policy.get("policyId", _policy_id(q_table)),
        "replayPassRate": replay_pass_rate,
        "averageReward": round(sum(rewards) / len(rewards), 6) if rewards else 0,
        "trainingSamples": len(traces),
        "safetyViolations": safety_violations,
    }


def _fixed_policy_for_traces(policy_id, traces, action):
    q_table = {}
    key = _action_key(action)
    for trace in traces:
        q_table[_state_key(trace)] = {key: 1}
    return {"policyId": policy_id, "qTable": q_table}


def train_policy(payload):
    traces = _parse_jsonl(payload.get("traceJsonl", ""))
    learning_rate = float(payload.get("learningRate", 0.3))
    epochs = int(payload.get("epochs", 4))
    q_table = {}
    rewards = []
    for _ in range(max(1, epochs)):
        for trace in traces:
            state = _state_key(trace)
            action = _action_key(trace.get("action", {}))
            reward = _reward(trace.get("outcome", {}))
            rewards.append(reward)
            q_table.setdefault(state, {})
            previous = q_table[state].get(action, 0)
            q_table[state][action] = round(previous + learning_rate * (reward - previous), 6)
    return {
        "policyId": _policy_id(q_table),
        "qTable": q_table,
        "trainingSamples": len(traces),
        "averageReward": round(sum(rewards) / len(rewards), 6) if rewards else 0,
        "warnings": [],
    }


def evaluate_policy(payload):
    traces = _parse_jsonl(payload.get("traceJsonl", ""))
    policy = payload.get("policy", {})
    return _evaluate_policy_payload(traces, policy)


def compare_policy_baselines(payload):
    traces = _parse_jsonl(payload.get("traceJsonl", ""))
    candidate = _evaluate_policy_payload(traces, payload.get("policy", {}))
    baselines = [
        _evaluate_policy_payload(
            traces,
            _fixed_policy_for_traces(
                "baseline:single-balanced",
                traces,
                {
                    "workerCount": 1,
                    "verifierCount": 0,
                    "maxDepth": 1,
                    "modelProfile": "balanced",
                    "splitStrategy": "single",
                    "contextBudget": "medium",
                    "evidenceMode": "standard",
                    "stopRule": "verify",
                },
            ),
        ),
        _evaluate_policy_payload(
            traces,
            _fixed_policy_for_traces(
                "baseline:parallel-verify",
                traces,
                {
                    "workerCount": 3,
                    "verifierCount": 1,
                    "maxDepth": 3,
                    "modelProfile": "balanced",
                    "splitStrategy": "parallel",
                    "contextBudget": "large",
                    "evidenceMode": "standard",
                    "stopRule": "verify",
                },
            ),
        ),
        _evaluate_policy_payload(
            traces,
            _fixed_policy_for_traces(
                "baseline:strict-deep",
                traces,
                {
                    "workerCount": 2,
                    "verifierCount": 2,
                    "maxDepth": 4,
                    "modelProfile": "deep",
                    "splitStrategy": "sequential",
                    "contextBudget": "large",
                    "evidenceMode": "strict",
                    "stopRule": "escalate",
                },
            ),
        ),
    ]
    best = sorted(
        [candidate] + baselines,
        key=lambda item: (-item["replayPassRate"], -item["averageReward"], item["policyId"]),
    )[0]
    return {"candidate": candidate, "baselines": baselines, "best": best}
