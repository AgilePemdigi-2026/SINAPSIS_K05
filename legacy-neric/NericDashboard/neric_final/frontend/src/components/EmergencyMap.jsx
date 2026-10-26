// =============================================================
// EmergencyMap.jsx — NERIC v3 Fixed
// =============================================================
// Sebelumnya: Leaflet real-world map (tidak selaras dengan City Grid)
// Sekarang:   Canvas SVG overlay PERSIS di atas grid City Grid
//             - Koordinat node sama dengan CITY_NODES di constants.js
//             - Rute ambulans ditarik di atas jalur aspal yang sama
//             - Dijkstra menggunakan AMBULANCE_GRAPH (sama dengan CityGrid)
//             - Green Wave: nodes di rute berubah hijau sebelum ambulans tiba
// =============================================================

import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { Siren, Play, Pause, RotateCcw, Hospital, Navigation2, Zap } from 'lucide-react'
import { Card } from './ui/Card'
import { cn } from '../lib/cn'
import {
  CANVAS_W, CANVAS_H, ROAD_WIDTH, LANE_W,
  CITY_NODES, ENTRY_POINTS, ROAD_SEGMENTS,
  AMBULANCE_GRAPH,
} from '../lib/constants'
import { dijkstra } from '../lib/dijkstra'

// ─── Ambulance routing constants ─────────────────────────────
// Hospital: ujung barat (ENTRY_HOSPITAL)
// Origin  : ujung timur (ENTRY_AMB)
const ORIGIN_ID  = 'ENTRY_AMB'
const DEST_ID    = 'ENTRY_HOSPITAL'

// Green Wave preemption distance (px) — berapa jauh sebelum ambulans
// tiba di sebuah node, lampu dipaksa hijau
const PREEMPT_DIST = 90  // px

// Speed ambulans di canvas (px per frame @ 60fps)
const AMB_SPEED = 2.6

// ─── Colour palette ───────────────────────────────────────────
const P = {
  bg       : '#07090f',
  road     : '#131a2a',
  ibox     : '#0d1320',
  edge     : '#1a2238',
  dash     : '#1e2b44',
  green    : '#00ff88',
  yellow   : '#ffcc00',
  red      : '#ff2244',
  ambColor : '#ffffff',
  routeLine: 'rgba(0,255,136,0.55)',
  preempt  : 'rgba(0,255,136,0.18)',
  hospBg   : '#021c14',
  hospBdr  : '#15803d',
  hospCross: '#ef4444',
}

// ─── Build full graph for routing ────────────────────────────
// Uses AMBULANCE_GRAPH from constants (same nodes as CityGrid)
function buildRoutingGraph() {
  const nodes = {}
  // Merge CITY_NODES + ENTRY_POINTS into flat lookup
  const allPoints = { ...CITY_NODES, ...ENTRY_POINTS }
  for (const [id, n] of Object.entries(allPoints)) {
    nodes[id] = { x: n.x, y: n.y, label: n.label || id }
  }

  // Build weighted edges from AMBULANCE_GRAPH
  const edges = {}
  for (const [id] of Object.entries(nodes)) edges[id] = []
  for (const [from, to, cost] of (AMBULANCE_GRAPH.edges || [])) {
    if (nodes[from] && nodes[to]) {
      edges[from] = edges[from] || []
      edges[to]   = edges[to]   || []
      edges[from].push({ to, cost })
      edges[to].push({ to: from, cost })   // bidirectional
    }
  }
  return { nodes, edges }
}

// ─── Simple Dijkstra (self-contained, canvas coord based) ────
function runDijkstra(graph, startId, endId) {
  const dist  = {}
  const prev  = {}
  const visited = new Set()
  for (const id of Object.keys(graph.nodes)) dist[id] = Infinity
  dist[startId] = 0

  const pq = [{ id: startId, d: 0 }]

  while (pq.length) {
    pq.sort((a, b) => a.d - b.d)
    const { id } = pq.shift()
    if (visited.has(id)) continue
    visited.add(id)
    if (id === endId) break
    for (const { to, cost } of (graph.edges[id] || [])) {
      const nd = dist[id] + cost
      if (nd < dist[to]) {
        dist[to] = nd
        prev[to] = id
        pq.push({ id: to, d: nd })
      }
    }
  }

  const path = []
  let cur = endId
  while (cur) { path.unshift(cur); cur = prev[cur] }
  return path[0] === startId ? path : []
}

// ─── Convert path to pixel waypoints ─────────────────────────
function pathToPixels(path, nodes) {
  return path.map(id => {
    const n = nodes[id]
    return n ? { x: n.x, y: n.y, id } : null
  }).filter(Boolean)
}

// ─── Distance between two points ─────────────────────────────
function dist2(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y
  return Math.sqrt(dx * dx + dy * dy)
}

// ─── Draw road grid (same as CityGrid) ───────────────────────
function drawGrid(ctx, dark) {
  ctx.fillStyle = P.bg
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)

  for (const seg of ROAD_SEGMENTS) {
    const from = CITY_NODES[seg.from] || ENTRY_POINTS[seg.from]
    const to   = CITY_NODES[seg.to]   || ENTRY_POINTS[seg.to]
    if (!from || !to) continue
    ctx.strokeStyle = P.road
    ctx.lineWidth   = ROAD_WIDTH
    ctx.lineCap     = 'square'
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(to.x, to.y)
    ctx.stroke()
  }

  // Lane dashes
  ctx.strokeStyle = P.dash
  ctx.lineWidth   = 1.1
  ctx.setLineDash([7, 14])
  for (const seg of ROAD_SEGMENTS) {
    const from = CITY_NODES[seg.from] || ENTRY_POINTS[seg.from]
    const to   = CITY_NODES[seg.to]   || ENTRY_POINTS[seg.to]
    if (!from || !to) continue
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(to.x, to.y)
    ctx.stroke()
  }
  ctx.setLineDash([])
}

// ─── Draw intersections ───────────────────────────────────────
function drawNodes(ctx, preemptedNodes, ambProgress) {
  const IH = 44
  for (const [id, node] of Object.entries(CITY_NODES)) {
    const isPreempted = preemptedNodes.has(id)
    const cx = node.x, cy = node.y

    // Box
    ctx.fillStyle   = isPreempted ? 'rgba(0,60,30,0.95)' : P.ibox
    ctx.strokeStyle = isPreempted ? P.green : P.edge
    ctx.lineWidth   = isPreempted ? 1.5 : 1
    ctx.fillRect(cx - IH, cy - IH, IH * 2, IH * 2)
    ctx.strokeRect(cx - IH, cy - IH, IH * 2, IH * 2)

    // Green glow when preempted
    if (isPreempted) {
      ctx.save()
      ctx.shadowColor = P.green
      ctx.shadowBlur  = 18
      ctx.strokeStyle = P.green
      ctx.lineWidth   = 2
      ctx.strokeRect(cx - IH, cy - IH, IH * 2, IH * 2)
      ctx.restore()

      // "GREEN WAVE" label
      ctx.fillStyle    = P.green
      ctx.font         = 'bold 8px JetBrains Mono,monospace'
      ctx.textAlign    = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('🟢', cx, cy - 4)
      ctx.fillText('PREEMPTED', cx, cy + 6)
    } else {
      ctx.fillStyle    = 'rgba(148,163,184,0.4)'
      ctx.font         = 'bold 9px JetBrains Mono,monospace'
      ctx.textAlign    = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(id.replace('INT_', '').replace('TJUNC_', 'T'), cx, cy)
    }
  }
}

// ─── Draw hospital box ────────────────────────────────────────
function drawHospital(ctx) {
  const { x, y } = ENTRY_POINTS.ENTRY_HOSPITAL
  ctx.fillStyle   = P.hospBg
  ctx.strokeStyle = P.hospBdr
  ctx.lineWidth   = 2
  ctx.fillRect(x - 38, y - 28, 76, 56)
  ctx.strokeRect(x - 38, y - 28, 76, 56)
  // Red cross
  ctx.fillStyle = P.hospCross
  ctx.fillRect(x - 8, y - 3, 16, 6)
  ctx.fillRect(x - 3, y - 8, 6, 16)
  ctx.fillStyle    = '#22c55e'
  ctx.font         = 'bold 8px JetBrains Mono,monospace'
  ctx.textAlign    = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText('HOSPITAL', x, y + 22)
  ctx.fillText('RSUD Dr. Soetomo', x, y + 32)
}

// ─── Draw route line ──────────────────────────────────────────
function drawRoute(ctx, waypoints, ambPos) {
  if (waypoints.length < 2) return
  ctx.save()
  ctx.strokeStyle = P.routeLine
  ctx.lineWidth   = 6
  ctx.lineCap     = 'round'
  ctx.lineJoin    = 'round'
  ctx.shadowColor = '#00ff88'
  ctx.shadowBlur  = 12
  ctx.beginPath()
  ctx.moveTo(waypoints[0].x, waypoints[0].y)
  for (let i = 1; i < waypoints.length; i++) {
    ctx.lineTo(waypoints[i].x, waypoints[i].y)
  }
  ctx.stroke()

  // Animated dashes over route
  ctx.strokeStyle = 'rgba(0,255,136,0.9)'
  ctx.lineWidth   = 2
  ctx.setLineDash([10, 12])
  ctx.lineDashOffset = -(performance.now() / 20 % 22)
  ctx.beginPath()
  ctx.moveTo(waypoints[0].x, waypoints[0].y)
  for (let i = 1; i < waypoints.length; i++) {
    ctx.lineTo(waypoints[i].x, waypoints[i].y)
  }
  ctx.stroke()
  ctx.setLineDash([])
  ctx.restore()

  // Waypoint circles
  for (let i = 0; i < waypoints.length; i++) {
    const wp = waypoints[i]
    const isFirst = i === 0
    const isLast  = i === waypoints.length - 1
    ctx.save()
    ctx.shadowColor = P.green
    ctx.shadowBlur  = 8
    ctx.fillStyle   = isFirst ? '#ef4444' : isLast ? '#22c55e' : P.green
    ctx.beginPath()
    ctx.arc(wp.x, wp.y, isFirst || isLast ? 7 : 5, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }
}

// ─── Draw ambulance ───────────────────────────────────────────
function drawAmbulance(ctx, x, y, frame) {
  ctx.save()
  ctx.translate(x, y)

  // Body
  ctx.shadowColor = 'rgba(255,255,255,0.5)'
  ctx.shadowBlur  = 14
  ctx.fillStyle   = '#f8fafc'
  ctx.fillRect(-13, -8, 26, 16)

  // Red cross
  ctx.shadowBlur = 0
  ctx.fillStyle  = '#ef4444'
  ctx.fillRect(-5, -3, 10, 6)
  ctx.fillRect(-3, -5, 6, 10)

  // Flashing lights
  const blink = Math.floor(frame / 5) % 2 === 0
  ctx.fillStyle = blink ? '#ef4444' : '#3b82f6'
  ctx.shadowColor = blink ? '#ef4444' : '#3b82f6'
  ctx.shadowBlur  = 10
  ctx.fillRect(-12, -12, 10, 4)
  ctx.fillStyle   = blink ? '#3b82f6' : '#ef4444'
  ctx.shadowColor = blink ? '#3b82f6' : '#ef4444'
  ctx.fillRect(2, -12, 10, 4)

  ctx.restore()
}

// =============================================================
// REACT COMPONENT
// =============================================================

export function EmergencyMap({ isDark, emergencyActive }) {
  const canvasRef  = useRef(null)
  const stateRef   = useRef({
    playing: false,
    progress: 0,        // 0..1 of total path distance
    frame: 0,
    preempted: new Set(),
    ambPos: null,
  })
  const rafRef     = useRef(null)
  const graphRef   = useRef(null)
  const pathRef    = useRef([])
  const waypointsRef = useRef([])   // pixel waypoints
  const totalDistRef = useRef(0)

  const [playing, setPlaying]   = useState(false)
  const [progress, setProgress] = useState(0)
  const [preemptedIds, setPreemptedIds] = useState(new Set())
  const [ambPos, setAmbPos]     = useState(null)
  const [routeInfo, setRouteInfo] = useState({ hops: 0, dist: 0 })

  // ── Build graph + route once ──────────────────────────────
  useEffect(() => {
    const graph = buildRoutingGraph()
    graphRef.current = graph
    const path = runDijkstra(graph, ORIGIN_ID, DEST_ID)
    pathRef.current  = path
    const wps = pathToPixels(path, graph.nodes)
    waypointsRef.current = wps

    // Total path distance in pixels
    let total = 0
    for (let i = 1; i < wps.length; i++) total += dist2(wps[i - 1], wps[i])
    totalDistRef.current = total
    setRouteInfo({ hops: path.length - 1, dist: Math.round(total) })
  }, [])

  // ── Auto-play when emergency activates ───────────────────
  useEffect(() => {
    if (emergencyActive) {
      stateRef.current.progress = 0
      stateRef.current.playing  = true
      setPlaying(true)
      setProgress(0)
    } else {
      stateRef.current.playing = false
      setPlaying(false)
    }
  }, [emergencyActive])

  // ── Controls ──────────────────────────────────────────────
  const handlePlay = useCallback(() => {
    stateRef.current.playing = true
    setPlaying(true)
  }, [])
  const handlePause = useCallback(() => {
    stateRef.current.playing = false
    setPlaying(false)
  }, [])
  const handleReset = useCallback(() => {
    stateRef.current.progress = 0
    stateRef.current.playing  = false
    stateRef.current.preempted = new Set()
    stateRef.current.ambPos    = null
    setPlaying(false)
    setProgress(0)
    setPreemptedIds(new Set())
    setAmbPos(null)
  }, [])

  // ── Get ambulance position along path at dist `d` ────────
  function getAmbPos(d) {
    const wps = waypointsRef.current
    if (!wps.length) return null
    let remaining = d
    for (let i = 1; i < wps.length; i++) {
      const segLen = dist2(wps[i - 1], wps[i])
      if (remaining <= segLen) {
        const t  = remaining / segLen
        return {
          x: wps[i - 1].x + (wps[i].x - wps[i - 1].x) * t,
          y: wps[i - 1].y + (wps[i].y - wps[i - 1].y) * t,
        }
      }
      remaining -= segLen
    }
    return { x: wps[wps.length - 1].x, y: wps[wps.length - 1].y }
  }

  // ── Compute which nodes get preempted ─────────────────────
  function computePreempted(ambD, wps) {
    const preempted = new Set()
    const path = pathRef.current
    let cumDist = 0
    for (let i = 1; i < wps.length; i++) {
      cumDist += dist2(wps[i - 1], wps[i])
      // If ambulance is within PREEMPT_DIST before this node
      if (cumDist > ambD && (cumDist - ambD) < PREEMPT_DIST) {
        const nodeId = path[i]
        if (CITY_NODES[nodeId]) preempted.add(nodeId)
      }
    }
    return preempted
  }

  // ── Animation loop ────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    let raf

    function loop() {
      const st  = stateRef.current
      const wps = waypointsRef.current
      const total = totalDistRef.current

      st.frame++

      if (st.playing && total > 0) {
        st.progress = Math.min(1, st.progress + AMB_SPEED / total)
        if (st.progress >= 1) {
          st.playing = false
          setPlaying(false)
        }
      }

      const ambD  = st.progress * total
      const pos   = getAmbPos(ambD)
      const pre   = computePreempted(ambD, wps)
      st.preempted = pre
      st.ambPos    = pos

      // Draw
      drawGrid(ctx, true)
      if (wps.length >= 2) drawRoute(ctx, wps, pos)
      drawHospital(ctx)
      drawNodes(ctx, pre, st.progress)
      if (pos) drawAmbulance(ctx, pos.x, pos.y, st.frame)

      // Labels
      ctx.fillStyle = '#ef4444'
      ctx.font      = 'bold 9px JetBrains Mono,monospace'
      ctx.textAlign = 'center'
      const orig = ENTRY_POINTS[ORIGIN_ID]
      if (orig) ctx.fillText('🚑 ORIGIN', orig.x, orig.y - 16)

      // Sync React state every 6 frames
      if (st.frame % 6 === 0) {
        setProgress(st.progress)
        setPreemptedIds(new Set(pre))
        setAmbPos(pos ? { ...pos } : null)
      }

      raf = requestAnimationFrame(loop)
    }

    raf = requestAnimationFrame(loop)
    rafRef.current = raf
    return () => cancelAnimationFrame(raf)
  }, [])

  const pct = Math.round(progress * 100)

  return (
    <div className="flex flex-col gap-4">
      {/* ── Control bar ── */}
      <div className="card flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2">
          <Siren size={14} className="text-danger" />
          <span className="text-[12px] font-semibold text-ink">Emergency Pre-Route</span>
          <span className="chip text-[10px]">
            <Navigation2 size={9} />
            {routeInfo.hops} node · {routeInfo.dist}px
          </span>
          {preemptedIds.size > 0 && (
            <span className="chip bg-accent/10 text-accent border-accent/30 text-[10px]">
              <Zap size={9} />
              {preemptedIds.size} preempted
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleReset}
            className="chip cursor-pointer hover:bg-surface-muted text-[11px]"
          >
            <RotateCcw size={10} /> Reset
          </button>
          <button
            onClick={playing ? handlePause : handlePlay}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-semibold transition-colors',
              playing
                ? 'bg-warning/10 text-warning border border-warning/30'
                : 'bg-accent/10 text-accent border border-accent/30 hover:bg-accent/15',
            )}
          >
            {playing ? <Pause size={10} /> : <Play size={10} />}
            {playing ? 'Pause' : 'Play'}
          </button>
        </div>
      </div>

      {/* ── Progress bar ── */}
      <div className="flex items-center gap-3 px-1">
        <Hospital size={12} className="text-accent flex-shrink-0" />
        <div className="relative flex-1 h-1.5 rounded-full bg-surface-muted overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-accent transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
          {progress > 0 && progress < 1 && (
            <div
              className="absolute -top-0.5 h-2.5 w-2.5 rounded-full bg-white border-2 border-accent shadow-md -translate-x-1/2"
              style={{ left: `${pct}%` }}
            />
          )}
        </div>
        <span className="num text-[11px] text-ink-muted w-8 text-right">{pct}%</span>
      </div>

      {/* ── Canvas — SAME dimensions as CityGrid ── */}
      <div className="card overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-2">
          <p className="eyebrow">Ambulance Route Overlay — Same Grid as City Grid</p>
          <div className="flex gap-2 text-[10px] text-ink-muted">
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-0.5 bg-green-400 rounded" /> Route
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-green-400" /> Preempted
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-red-500" /> Origin
            </span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <canvas
            ref={canvasRef}
            width={CANVAS_W}
            height={CANVAS_H}
            style={{ display: 'block', maxWidth: '100%', imageRendering: 'crisp-edges' }}
          />
        </div>
      </div>

      {/* ── Node status legend ── */}
      <div className="grid grid-cols-5 gap-2">
        {Object.entries(CITY_NODES).map(([id, node]) => {
          const isPre = preemptedIds.has(id)
          return (
            <div
              key={id}
              className={cn(
                'rounded-lg border px-3 py-2 text-center transition-all duration-300',
                isPre
                  ? 'border-accent/40 bg-accent/5 shadow-[0_0_12px_rgba(0,255,136,0.12)]'
                  : 'border-border bg-surface-muted',
              )}
            >
              <p className={cn('text-[10px] font-bold', isPre ? 'text-accent' : 'text-ink-muted')}>
                {id}
              </p>
              <p className={cn('text-[9px] mt-0.5', isPre ? 'text-accent' : 'text-ink-soft')}>
                {isPre ? '🟢 GREEN WAVE' : '🔴 Normal'}
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
