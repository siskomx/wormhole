from collections import defaultdict, deque


def _node_id(node):
    return str(node.get("id", "")).strip()


def _edge_end(edge, key):
    return str(edge.get(key, "")).strip()


def detect_communities(payload):
    nodes = payload.get("nodes") or []
    edges = payload.get("edges") or []

    node_ids = {_node_id(node) for node in nodes if _node_id(node)}
    adjacency = defaultdict(set)

    for node_id in node_ids:
        adjacency[node_id]

    for edge in edges:
        source = _edge_end(edge, "from")
        target = _edge_end(edge, "to")
        if not source or not target:
            continue
        node_ids.add(source)
        node_ids.add(target)
        adjacency[source].add(target)
        adjacency[target].add(source)

    for node_id in node_ids:
        adjacency[node_id]

    visited = set()
    components = []

    for node_id in sorted(node_ids):
        if node_id in visited:
            continue
        queue = deque([node_id])
        visited.add(node_id)
        members = []

        while queue:
            current = queue.popleft()
            members.append(current)
            for neighbor in sorted(adjacency[current]):
                if neighbor not in visited:
                    visited.add(neighbor)
                    queue.append(neighbor)

        components.append(sorted(members))

    components.sort(key=lambda members: (members[0], len(members)))
    return {
        "communityCount": len(components),
        "communities": [
            {"id": f"community-{index + 1}", "members": members}
            for index, members in enumerate(components)
        ],
    }
