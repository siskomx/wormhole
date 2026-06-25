from collections import defaultdict, deque


def _node_id(node):
    return str(node.get("id", "")).strip()


def _edge_end(edge, key):
    return str(edge.get(key, "")).strip()


def compute_graph_metrics(payload):
    nodes = payload.get("nodes") or []
    edges = payload.get("edges") or []

    node_ids = {_node_id(node) for node in nodes if _node_id(node)}
    adjacency = defaultdict(set)
    degree = defaultdict(int)

    for node_id in node_ids:
        adjacency[node_id]
        degree[node_id]

    valid_edge_count = 0
    for edge in edges:
        source = _edge_end(edge, "from")
        target = _edge_end(edge, "to")
        if not source or not target:
            continue
        valid_edge_count += 1
        node_ids.add(source)
        node_ids.add(target)
        adjacency[source].add(target)
        adjacency[target].add(source)
        degree[source] += 1
        degree[target] += 1

    for node_id in node_ids:
        adjacency[node_id]
        degree[node_id]

    visited = set()
    component_count = 0
    for node_id in sorted(node_ids):
        if node_id in visited:
            continue
        component_count += 1
        queue = deque([node_id])
        visited.add(node_id)
        while queue:
            current = queue.popleft()
            for neighbor in sorted(adjacency[current]):
                if neighbor not in visited:
                    visited.add(neighbor)
                    queue.append(neighbor)

    top_degree = [
        {"id": node_id, "degree": degree_value}
        for node_id, degree_value in sorted(
            degree.items(), key=lambda item: (-item[1], item[0])
        )[:10]
    ]

    return {
        "nodeCount": len(node_ids),
        "edgeCount": valid_edge_count,
        "componentCount": component_count,
        "topDegree": top_degree,
    }
