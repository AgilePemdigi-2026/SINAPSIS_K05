"""Rute darurat: Dijkstra di atas graf jalan, berbobot waktu tempuh x faktor kepadatan."""
from __future__ import annotations

import heapq
import json
from dataclasses import dataclass
from pathlib import Path

GRAPH_FILE = Path(__file__).resolve().parents[2] / "data" / "road_graph.json"


@dataclass
class RoutePlan:
    nodes: list[str]  # urutan simpul dari asal ke tujuan
    steps: list[dict]  # [{'node':..., 'arah_masuk':...}, ...] untuk simpul setelah asal
    total_time_s: float


def load_graph(path: Path = GRAPH_FILE) -> dict[str, list[dict]]:
    graph: dict[str, list[dict]] = {}
    for e in json.loads(path.read_text(encoding="utf-8"))["edges"]:
        graph.setdefault(e["from"], []).append(e)
        graph.setdefault(e["to"], [])
    return graph


def resolve_node(graph: dict, text: str) -> str | None:
    """Cocokkan input pengguna ke nama simpul (abaikan huruf besar/kecil, boleh sebagian)."""
    t = text.strip().lower()
    if not t:
        return None
    for n in graph:
        if n.lower() == t:
            return n
    hits = [n for n in graph if t in n.lower() or n.lower() in t]
    return hits[0] if len(hits) == 1 else None


def dijkstra(graph: dict, src: str, dst: str, congestion: dict[str, float] | None = None) -> RoutePlan | None:
    """`congestion[node]` bernilai 0..1; waktu tempuh ke node dikali (1 + congestion)."""
    congestion = congestion or {}
    dist = {src: 0.0}
    prev: dict[str, tuple[str, dict]] = {}
    heap = [(0.0, src)]
    while heap:
        d, u = heapq.heappop(heap)
        if u == dst:
            break
        if d > dist.get(u, float("inf")):
            continue
        for e in graph.get(u, []):
            v = e["to"]
            nd = d + e["time_s"] * (1 + congestion.get(v, 0.0))
            if nd < dist.get(v, float("inf")):
                dist[v] = nd
                prev[v] = (u, e)
                heapq.heappush(heap, (nd, v))
    if dst not in dist:
        return None
    nodes, steps, cur = [dst], [], dst
    while cur != src:
        u, e = prev[cur]
        steps.append({"node": cur, "arah_masuk": e["arah_masuk"]})
        nodes.append(u)
        cur = u
    return RoutePlan(nodes[::-1], steps[::-1], round(dist[dst], 1))
