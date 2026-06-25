import hashlib
import json

SAFE_MODELS = {"fast", "balanced", "deep", "ultra", "small-local", "deep-reviewer"}


def _reward(outcome):
    test_score = 10 if outcome.get("testsPassed") else -8
    evidence_score = min(outcome.get("evidenceCount", 0), 6) * 0.5
    question_penalty = min(outcome.get("openQuestions", 0), 10) * 0.8
    correction_penalty = min(outcome.get("userCorrectionCount", 0), 10) * 1.2
    duration_penalty = min(outcome.get("durationMs", 0) / 60000, 4)
    token_penalty = min(outcome.get("tokenEstimate", 0) / 50000, 4)
    return round(test_score + evidence_score - question_penalty - correction_penalty - duration_penalty - token_penalty, 4)


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
    return "|".join(
        [
            f"workers={action.get('workerCount', 1)}",
            f"verifiers={action.get('verifierCount', 0)}",
            f"depth={action.get('maxDepth', 1)}",
            f"model={action.get('modelProfile', 'balanced')}",
        ]
    )


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
    for part in action.split("|"):
        key, value = part.split("=", 1)
        parsed[key] = value
    workers = int(parsed.get("workers", 0))
    verifiers = int(parsed.get("verifiers", 0))
    depth = int(parsed.get("depth", 0))
    model = parsed.get("model", "")
    return 1 <= workers <= 6 and 0 <= verifiers <= 2 and 1 <= depth <= 4 and model in SAFE_MODELS


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
            if selected == _action_key(trace.get("action", {})):
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
