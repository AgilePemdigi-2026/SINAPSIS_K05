// =============================================================
// Dijkstra's Algorithm — Shortest Path
// =============================================================
// Implementasi klasik Dijkstra untuk graf weighted undirected.
// Graf direpresentasikan sebagai:
//   {
//     nodes: { id: { lat, lng, name, type? } },
//     edges: [ [fromId, toId, weight], ... ]
//   }
//
// Output:
//   { path: [id, id, ...], distance: number, steps: [...] }
//   `steps` berisi snapshot iterasi (untuk visualisasi algoritma)
// =============================================================

export function dijkstra(graph, startId, endId) {
  const { nodes, edges } = graph

  // 1) Build adjacency list (undirected)
  const adj = {}
  for (const id of Object.keys(nodes)) adj[id] = []
  for (const [a, b, w] of edges) {
    adj[a].push({ to: b, weight: w })
    adj[b].push({ to: a, weight: w })
  }

  // 2) Initialize distance & predecessor tables
  const distances = {}
  const previous = {}
  const visited = new Set()
  const unvisited = new Set()

  for (const id of Object.keys(nodes)) {
    distances[id] = id === startId ? 0 : Infinity
    previous[id] = null
    unvisited.add(id)
  }

  const steps = [] // for algorithm visualization

  // 3) Main loop — extract minimum unvisited, relax neighbors
  while (unvisited.size > 0) {
    // Linear extract-min (graph kecil, O(V²) cukup)
    let current = null
    let minDist = Infinity
    for (const id of unvisited) {
      if (distances[id] < minDist) {
        minDist = distances[id]
        current = id
      }
    }

    if (current === null || minDist === Infinity) break

    unvisited.delete(current)
    visited.add(current)

    steps.push({
      current,
      visited: [...visited],
      distances: { ...distances },
    })

    if (current === endId) break

    // Relax edges
    for (const { to, weight } of adj[current]) {
      if (visited.has(to)) continue
      const alt = distances[current] + weight
      if (alt < distances[to]) {
        distances[to] = alt
        previous[to] = current
      }
    }
  }

  // 4) Reconstruct path by walking predecessors
  const path = []
  let u = endId
  let safety = 0
  while (u !== null && safety < 100) {
    path.unshift(u)
    u = previous[u]
    safety += 1
  }

  if (path[0] !== startId) {
    return { path: [], distance: Infinity, steps }
  }

  return { path, distance: distances[endId], steps }
}

// =============================================================
// Helper: konversi path id → array koordinat [lat, lng]
// =============================================================
export function pathToCoords(graph, path) {
  return path.map((id) => {
    const node = graph.nodes[id]
    return [node.lat, node.lng]
  })
}

// =============================================================
// Helper: interpolasi posisi sepanjang multi-segment path
// progress: 0..1 (0 = start, 1 = end)
// returns { lat, lng, segmentIndex, segmentProgress, currentNodeId, nextNodeId }
// =============================================================
export function interpolateAlongPath(graph, path, progress) {
  if (path.length < 2) return null

  const p = Math.max(0, Math.min(1, progress))
  const totalSegments = path.length - 1
  const scaled = p * totalSegments

  let segIdx = Math.min(totalSegments - 1, Math.floor(scaled))
  let segProgress = scaled - segIdx

  // Snap to end
  if (p >= 1) {
    segIdx = totalSegments - 1
    segProgress = 1
  }

  const fromNode = graph.nodes[path[segIdx]]
  const toNode = graph.nodes[path[segIdx + 1]]

  return {
    lat: fromNode.lat + (toNode.lat - fromNode.lat) * segProgress,
    lng: fromNode.lng + (toNode.lng - fromNode.lng) * segProgress,
    segmentIndex: segIdx,
    segmentProgress: segProgress,
    currentNodeId: path[segIdx],
    nextNodeId: path[segIdx + 1],
    bearing: bearingBetween(fromNode, toNode),
  }
}

// Bearing in degrees (0 = north, 90 = east)
function bearingBetween(from, to) {
  const φ1 = (from.lat * Math.PI) / 180
  const φ2 = (to.lat * Math.PI) / 180
  const Δλ = ((to.lng - from.lng) * Math.PI) / 180
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}
