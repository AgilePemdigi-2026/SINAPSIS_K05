// =============================================================
// CityGrid.jsx — NERIC v3 FINAL
// =============================================================
// Menggabungkan:
//   • Engine fisika v2 (segment-based, physics proper, Dijkstra)
//   • UI tampilan neric-v3-upgraded (dark theme, chip, card)
//   • Overlay HTML buttons "Upload Video" + "Ambulance" di tiap entry
//   • CV backend real: upload video → YOLO → spawn kendaraan
//   • Green corridor preemption saat ambulans aktif
// =============================================================

import { useRef, useEffect, useCallback, useState } from 'react'
import {
  CANVAS_W, CANVAS_H, ROAD_WIDTH, LANE_W, NODE_SIZE,
  CITY_NODES, ENTRY_POINTS, ROAD_SEGMENTS, NODE_EXITS,
  AMBULANCE_GRAPH, REALISTIC_VEHICLE_COLORS,
} from '../lib/constants'
import { dijkstra } from '../lib/dijkstra'

// ─── Physics constants ────────────────────────────────────────
const VEHICLE_W            = 14
const VEHICLE_H            = 9
const VEHICLE_SPEED_NORMAL = 1.8
const VEHICLE_SPEED_MAX    = 2.8
const VEHICLE_SPEED_AMB    = 4.0
const DECEL_RATE           = 0.12
const ACCEL_RATE           = 0.06
const STOP_MARGIN          = 0.86
const LIGHT_PHASE_TICKS    = 240
const LIGHT_YELLOW_TICKS   = 30
const MAX_VEHICLES         = 120

// ─── Entry points config (for overlay buttons) ───────────────
// Each entry has: id, label, position on canvas (for CSS overlay),
// which node it feeds into, and which direction the upload feeds.
// canvasPct: [left%, top%] relative to canvas container
const ENTRY_CONFIG = [
  {
    id: 'ENTRY_NA',
    label: 'North-A',
    nodeId: 'INT_A',
    dir: 'N',
    feedSeg: 'NA_to_A',
    // Top of INT_A column
    canvasPct: [270 / CANVAS_W, 60 / CANVAS_H],
    alignX: 'center',
  },
  {
    id: 'ENTRY_NB',
    label: 'North-B',
    nodeId: 'INT_B',
    dir: 'N',
    feedSeg: 'NB_to_B',
    canvasPct: [600 / CANVAS_W, 60 / CANVAS_H],
    alignX: 'center',
  },
  {
    id: 'ENTRY_NC',
    label: 'North-C',
    nodeId: 'INT_C',
    dir: 'N',
    feedSeg: 'NC_to_C',
    canvasPct: [930 / CANVAS_W, 60 / CANVAS_H],
    alignX: 'center',
  },
  {
    id: 'ENTRY_HOSPITAL_BTN',
    label: 'West-A',
    nodeId: 'INT_A',
    dir: 'W',
    feedSeg: 'HOSP_to_A',
    canvasPct: [60 / CANVAS_W, 255 / CANVAS_H],
    alignX: 'left',
  },
  {
    id: 'EXIT_WD_BTN',
    label: 'West-D',
    nodeId: 'TJUNC_D',
    dir: 'W',
    feedSeg: 'WD_to_D',
    canvasPct: [60 / CANVAS_W, 440 / CANVAS_H],
    alignX: 'left',
  },
  {
    id: 'EXIT_SC_BTN',
    label: 'South-A',
    nodeId: 'INT_A',
    dir: 'S',
    feedSeg: 'SC_to_C',   // fallback — INT_A south exit
    canvasPct: [270 / CANVAS_W, 530 / CANVAS_H],
    alignX: 'center',
  },
  {
    id: 'EXIT_SB_BTN',
    label: 'South-B',
    nodeId: 'INT_B',
    dir: 'S',
    feedSeg: 'EE_to_E',
    canvasPct: [600 / CANVAS_W, 530 / CANVAS_H],
    alignX: 'center',
  },
  {
    id: 'EXIT_SC2_BTN',
    label: 'South-C',
    nodeId: 'INT_C',
    dir: 'S',
    feedSeg: 'SC_to_C',
    canvasPct: [930 / CANVAS_W, 530 / CANVAS_H],
    alignX: 'center',
  },
]

// ─── Helpers ──────────────────────────────────────────────────
function getPoint(id) {
  return CITY_NODES[id] || ENTRY_POINTS[id] || null
}

function segmentVector(seg) {
  const from = getPoint(seg.from)
  const to   = getPoint(seg.to)
  if (!from || !to) return null
  const dx = to.x - from.x, dy = to.y - from.y
  const len = Math.sqrt(dx * dx + dy * dy)
  return { dx, dy, len, nx: dx / len, ny: dy / len }
}

function vehiclePosition(seg, progress) {
  const from = getPoint(seg.from)
  if (!from) return { x: 0, y: 0, angle: 0 }
  const v = segmentVector(seg)
  if (!v) return { x: 0, y: 0, angle: 0 }
  const ox = seg.laneOX || 0, oy = seg.laneOY || 0
  return {
    x: from.x + v.nx * v.len * progress + oy * (-v.ny) + ox * v.nx,
    y: from.y + v.ny * v.len * progress + oy *  v.nx   + ox * v.ny,
    angle: Math.atan2(v.dy, v.dx),
  }
}

// ─── Traffic lights ───────────────────────────────────────────
function createLightState(node) {
  const exits  = node.exits
  const phases = []
  if (node.type === 'intersection') {
    phases.push({ green: ['N','S'], red: ['E','W'] })
    phases.push({ green: ['E','W'], red: ['N','S'] })
  } else {
    const [a, b, c] = exits
    phases.push({ green: [a, b], red: [c] })
    phases.push({ green: [b, c], red: [a] })
  }
  return { phases, currentPhase: 0, tick: 0, state: 'green', override: null }
}

function lightIsGreen(ls, approachDir) {
  if (!approachDir) return true
  if (ls.override !== null) return ls.phases[ls.override]?.green.includes(approachDir) ?? false
  return ls.phases[ls.currentPhase]?.green.includes(approachDir) ?? false
}

function tickLights(lights, offset = 0) {
  const updated = { ...lights }
  for (const nodeId of Object.keys(updated)) {
    const ls = { ...updated[nodeId] }
    if (ls.override !== null) { updated[nodeId] = ls; continue }
    ls.tick++
    const period = LIGHT_PHASE_TICKS + offset
    if (ls.tick >= period + LIGHT_YELLOW_TICKS) {
      ls.tick = 0
      ls.currentPhase = (ls.currentPhase + 1) % ls.phases.length
    }
    updated[nodeId] = ls
  }
  return updated
}

// ─── Dijkstra ambulance path ──────────────────────────────────
function computeAmbPath() {
  const { path } = dijkstra(
    { nodes: AMBULANCE_GRAPH.nodes, edges: AMBULANCE_GRAPH.edges },
    'ENTRY_AMB',
    'ENTRY_HOSPITAL',
  )
  return path
}

// =============================================================
// COMPONENT
// =============================================================
export function CityGrid({
  mode           = 'normal',
  isDark         = true,
  emergencyActive = false,
  cvCounts       = null,
  ambSpawnEvent  = null,
  onLightChange,
  // CV upload integration
  uploadVideo,     // async (file, lane, nodeId) => result
  cvStatus,        // 'connected'|'disconnected'|etc
}) {
  const canvasRef = useRef(null)
  const stateRef  = useRef(null)
  const rafRef    = useRef(null)

  // Per-entry upload state
  const [uploadState, setUploadState] = useState({})
  // Event log entries
  const [eventLog, setEventLog] = useState(['Klik "Upload Video" di tepi peta untuk upload video CCTV dan spawn kendaraan.'])
  // Live vehicle counts per node (for display)
  const [nodeCounts, setNodeCounts] = useState({})

  const addLog = useCallback((msg) => {
    setEventLog(prev => [msg, ...prev].slice(0, 8))
  }, [])

  // ─── Init state ────────────────────────────────────────────
  const initState = useCallback(() => {
    const lights = {}
    for (const [id, node] of Object.entries(CITY_NODES)) lights[id] = createLightState(node)
    const segMap = {}, segLengths = {}
    for (const seg of ROAD_SEGMENTS) {
      segMap[seg.id] = seg
      const v = segmentVector(seg)
      segLengths[seg.id] = v ? v.len : 0
    }
    const ambPath   = computeAmbPath()
    const ambPixels = ambPath.map(id => ({ ...AMBULANCE_GRAPH.nodes[id], nodeId: id }))
    stateRef.current = {
      vehicles: [], lights, segMap, segLengths, frame: 0,
      spawnCounters: {}, ambulance: null, ambPath, ambPixels,
      cvSpawnQueue: {}, framesSinceUIUpdate: 0,
    }
  }, [])

  useEffect(() => { initState() }, [initState])

  // ─── Spawn vehicle ──────────────────────────────────────────
  const spawnVehicle = useCallback((segId, opts = {}) => {
    const st = stateRef.current
    if (!st || st.vehicles.length >= MAX_VEHICLES) return
    const seg = st.segMap[segId]
    if (!seg) return
    const startProgress = opts.progressOffset || 0
    const tooClose = st.vehicles.some(v => v.segId === segId && Math.abs(v.progress - startProgress) < 0.05)
    if (tooClose) return
    const color = opts.color || REALISTIC_VEHICLE_COLORS[Math.floor(Math.random() * REALISTIC_VEHICLE_COLORS.length)]
    st.vehicles.push({
      id: `v_${st.frame}_${Math.random().toString(36).slice(2,6)}`,
      segId, progress: startProgress, color,
      speed: VEHICLE_SPEED_NORMAL * (0.7 + Math.random() * 0.5),
      maxSpeed: VEHICLE_SPEED_NORMAL * (0.9 + Math.random() * 0.4),
      width: VEHICLE_W, height: VEHICLE_H,
      waiting: false, isAmbulance: opts.isAmbulance || false,
    })
  }, [])

  // ─── Ambulance spawn ────────────────────────────────────────
  const spawnAmbulance = useCallback(() => {
    const st = stateRef.current
    if (!st) return
    st.vehicles = st.vehicles.filter(v => !v.isAmbulance)
    st.ambulance = null
    // Pre-empt: force E-W green on all intersection nodes in path
    const ambNodes = st.ambPath.filter(id => CITY_NODES[id])
    for (const nodeId of ambNodes) {
      const ls = st.lights[nodeId]
      if (!ls) continue
      const ewIdx = ls.phases.findIndex(p => p.green.includes('E') || p.green.includes('W'))
      ls.override = ewIdx >= 0 ? ewIdx : 0
    }
    st.ambulance = { pixelIdx: 0, progress: 0, speed: VEHICLE_SPEED_AMB, beaconTick: 0 }
    st.vehicles.push({
      id: 'AMBULANCE', segId: 'AMB_to_C', progress: 0,
      speed: VEHICLE_SPEED_AMB, maxSpeed: VEHICLE_SPEED_AMB,
      color: '#ffffff', width: 18, height: 11,
      waiting: false, isAmbulance: true,
    })
    addLog('🚑 Ambulans dispawn! Green corridor aktif.')
  }, [addLog])

  const clearAmbulance = useCallback(() => {
    const st = stateRef.current
    if (!st) return
    st.vehicles   = st.vehicles.filter(v => !v.isAmbulance)
    st.ambulance  = null
    for (const nodeId of Object.keys(st.lights)) st.lights[nodeId].override = null
    addLog('✅ Ambulans selesai. Lampu kembali normal.')
  }, [addLog])

  // ─── Emergency effect ───────────────────────────────────────
  useEffect(() => {
    const st = stateRef.current
    if (!st) return
    if (emergencyActive) { if (!st.ambulance) spawnAmbulance() }
    else                 { if (st.ambulance)  clearAmbulance() }
  }, [emergencyActive, spawnAmbulance, clearAmbulance])

  // ─── Handle ambSpawnEvent from backend ─────────────────────
  useEffect(() => {
    if (!ambSpawnEvent) return
    spawnAmbulance()
  }, [ambSpawnEvent?.key, spawnAmbulance])

  // ─── CV counts → spawn queue ────────────────────────────────
  useEffect(() => {
    const st = stateRef.current
    if (!st || !cvCounts?.nodeId) return
    const { nodeId, counts } = cvCounts
    if (!st.cvSpawnQueue[nodeId]) st.cvSpawnQueue[nodeId] = { N:0, E:0, S:0, W:0 }
    for (const dir of ['N','E','S','W']) {
      st.cvSpawnQueue[nodeId][dir] = (st.cvSpawnQueue[nodeId][dir] || 0) + (counts[dir] || 0)
    }
    addLog(`📹 CV: Node ${nodeId} → ${counts.N || 0}N ${counts.E || 0}E ${counts.S || 0}S ${counts.W || 0}W kendaraan di-queue`)
  }, [cvCounts, addLog])

  // ─── Upload handler (per entry point) ──────────────────────
  const handleUpload = useCallback(async (entry, file) => {
    const key = entry.id
    setUploadState(prev => ({ ...prev, [key]: 'uploading' }))
    addLog(`📤 Upload video ke ${entry.label} (${entry.nodeId})…`)

    // Real CV backend upload
    let result = null
    if (typeof uploadVideo === 'function') {
      result = await uploadVideo(file, entry.dir, entry.nodeId)
    } else {
      // Fallback: simulate detection after 2s
      await new Promise(r => setTimeout(r, 2000))
      const count = 8 + Math.floor(Math.random() * 16)
      const st = stateRef.current
      if (st) {
        if (!st.cvSpawnQueue[entry.nodeId]) st.cvSpawnQueue[entry.nodeId] = { N:0, E:0, S:0, W:0 }
        // Feed into the primary direction
        const split = { N:0, E:0, S:0, W:0 }
        split[entry.dir] = Math.floor(count * 0.7)
        const others = ['N','E','S','W'].filter(d => d !== entry.dir)
        const rem = count - split[entry.dir]
        others.forEach((d, i) => { split[d] = i < others.length - 1 ? Math.floor(rem / others.length) : rem - others.slice(0,i).reduce((s,dd) => s + split[dd] - split[entry.dir], 0) })
        for (const d of ['N','E','S','W']) st.cvSpawnQueue[entry.nodeId][d] += split[d]
        addLog(`🔍 [Sim] Terdeteksi ${count} kendaraan di ${entry.label}`)
      }
    }

    setUploadState(prev => ({ ...prev, [key]: 'done' }))
    addLog(`✅ Upload selesai — ${entry.label}`)
    setTimeout(() => setUploadState(prev => ({ ...prev, [key]: null })), 3500)
  }, [uploadVideo, addLog])

  // File input trigger per entry
  const fileInputRefs = useRef({})
  const triggerUpload = useCallback((entry) => {
    if (!fileInputRefs.current[entry.id]) return
    fileInputRefs.current[entry.id].click()
  }, [])

  // ─── Main animation loop ────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (!stateRef.current) initState()
    const ctx = canvas.getContext('2d')
    let running = true

    // Polyfill roundRect
    if (!ctx.roundRect) {
      ctx.roundRect = function(x, y, w, h, r) {
        const rad = Math.min(r, w/2, h/2)
        this.beginPath()
        this.moveTo(x+rad,y); this.lineTo(x+w-rad,y); this.quadraticCurveTo(x+w,y,x+w,y+rad)
        this.lineTo(x+w,y+h-rad); this.quadraticCurveTo(x+w,y+h,x+w-rad,y+h)
        this.lineTo(x+rad,y+h); this.quadraticCurveTo(x,y+h,x,y+h-rad)
        this.lineTo(x,y+rad); this.quadraticCurveTo(x,y,x+rad,y)
        this.closePath()
      }
    }

    // Approach segment lookup
    const approachSegMap = {}
    for (const seg of ROAD_SEGMENTS) {
      if (seg.approachDir && seg.to && CITY_NODES[seg.to]) {
        if (!approachSegMap[seg.to]) approachSegMap[seg.to] = {}
        approachSegMap[seg.to][seg.approachDir] = seg.id
      }
    }

    function processCVQueue(st) {
      for (const [nodeId, laneQ] of Object.entries(st.cvSpawnQueue)) {
        if (!CITY_NODES[nodeId]) continue
        const nodeApproaches = approachSegMap[nodeId] || {}
        let anyLeft = false
        for (const dir of ['N','E','S','W']) {
          let remaining = laneQ[dir] || 0
          if (remaining <= 0) continue
          anyLeft = true
          const segId = nodeApproaches[dir]
          if (!segId) { laneQ[dir] = remaining - 1; continue }
          const toSpawn = Math.min(2, remaining)
          for (let i = 0; i < toSpawn; i++) spawnVehicle(segId, { progressOffset: i * 0.04 })
          laneQ[dir] = remaining - toSpawn
        }
        if (!anyLeft) delete st.cvSpawnQueue[nodeId]
      }
    }

    function autoSpawn(st) {
      const entrySegs = ['HOSP_to_A','NA_to_A','NB_to_B','NC_to_C','WD_to_D','EE_to_E','SC_to_C']
      const interval  = mode === 'rush' ? 55 : mode === 'imbalanced' ? 35 : 120
      for (const segId of entrySegs) {
        st.spawnCounters[segId] = (st.spawnCounters[segId] || 0) + 1
        const jitter = Math.floor(interval * (0.7 + Math.random() * 0.6))
        if (st.spawnCounters[segId] >= jitter) {
          st.spawnCounters[segId] = 0
          if (st.vehicles.length < MAX_VEHICLES) spawnVehicle(segId)
        }
      }
    }

    function chooseNextSegment(st, vehicle, currentSeg) {
      const toId = currentSeg.to
      if (!CITY_NODES[toId]) return null
      const exits = NODE_EXITS[toId] || []
      const candidates = exits.filter(sid => {
        const s = st.segMap[sid]
        return s && s.to !== currentSeg.from
      })
      if (!candidates.length) return null
      if (vehicle.isAmbulance) {
        const ambPath  = st.ambPath
        const curToNode = currentSeg.to
        const curIdx = ambPath.indexOf(curToNode)
        if (curIdx >= 0 && curIdx + 1 < ambPath.length) {
          const nextNodeId = ambPath[curIdx + 1]
          const nextSeg = candidates.find(sid => st.segMap[sid]?.to === nextNodeId)
          if (nextSeg) return nextSeg
        }
        return candidates[0]
      }
      return candidates[Math.floor(Math.random() * candidates.length)]
    }

    function updateVehicles(st) {
      const toRemove = []
      for (const v of st.vehicles) {
        const seg = st.segMap[v.segId]
        if (!seg) { toRemove.push(v.id); continue }
        const segLen = st.segLengths[v.segId] || 1
        const toNode = CITY_NODES[seg.to]
        const light  = toNode ? st.lights[seg.to] : null
        const isGreen = !light || lightIsGreen(light, seg.approachDir)
        const ignoresLights = v.isAmbulance
        const vAhead = st.vehicles.find(o =>
          o !== v && o.segId === v.segId && o.progress > v.progress && (o.progress - v.progress) < 0.12
        )
        const mustStop = !ignoresLights && !isGreen && v.progress >= STOP_MARGIN
        const softStop = !ignoresLights && !isGreen && v.progress > STOP_MARGIN - 0.15

        if (mustStop) {
          v.progress = STOP_MARGIN; v.speed = 0; v.waiting = true
        } else if (softStop) {
          v.speed = Math.max(0.1, v.speed - DECEL_RATE); v.waiting = false
        } else if (vAhead && (vAhead.progress - v.progress) < 0.10) {
          v.speed = Math.max(0.15, v.speed - DECEL_RATE * 1.5); v.waiting = false
        } else {
          v.speed = Math.min(v.maxSpeed, v.speed + ACCEL_RATE); v.waiting = false
        }
        v.progress += v.speed / segLen
        if (v.progress >= 1.0) {
          v.progress = 1.0
          const next = chooseNextSegment(st, v, seg)
          if (next) { v.segId = next; v.progress = 0; v.waiting = false; v.speed = Math.min(v.maxSpeed, v.speed + ACCEL_RATE * 3) }
          else toRemove.push(v.id)
        }
      }
      if (toRemove.length) st.vehicles = st.vehicles.filter(v => !toRemove.includes(v.id))
    }

    // ── Draw functions ────────────────────────────────────────
    function drawRoads(ctx) {
      const roadC  = '#1a2240', sideC = '#0e1422', dashC = '#2a3655'
      // Sidewalk
      ctx.fillStyle = sideC
      for (const seg of ROAD_SEGMENTS) {
        const from = getPoint(seg.from), to = getPoint(seg.to)
        if (!from || !to) continue
        const v = segmentVector(seg); if (!v) continue
        const hw = ROAD_WIDTH / 2 + 5
        ctx.save(); ctx.translate(from.x, from.y); ctx.rotate(Math.atan2(v.dy, v.dx))
        ctx.fillRect(0, -hw, v.len, hw * 2); ctx.restore()
      }
      // Road surface (deduplicated)
      const drawn = new Set()
      for (const seg of ROAD_SEGMENTS) {
        const from = getPoint(seg.from), to = getPoint(seg.to)
        if (!from || !to) continue
        const key = [seg.from, seg.to].sort().join('|')
        if (drawn.has(key)) continue; drawn.add(key)
        const v = segmentVector(seg); if (!v) continue
        const hw = ROAD_WIDTH / 2
        ctx.fillStyle = roadC
        ctx.save(); ctx.translate(from.x, from.y); ctx.rotate(Math.atan2(v.dy, v.dx))
        ctx.fillRect(0, -hw, v.len, hw * 2); ctx.restore()
        // Center dashes
        ctx.strokeStyle = dashC; ctx.lineWidth = 1.2; ctx.setLineDash([10, 13])
        ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke()
        ctx.setLineDash([])
      }
    }

    function drawNodes(ctx, st) {
      for (const [nodeId, node] of Object.entries(CITY_NODES)) {
        const ls   = st.lights[nodeId]
        const half = NODE_SIZE / 2
        ctx.fillStyle   = '#0d1526'
        ctx.strokeStyle = '#2a3655'
        ctx.lineWidth   = 1.5
        ctx.fillRect(node.x - half, node.y - half, NODE_SIZE, NODE_SIZE)
        ctx.strokeRect(node.x - half, node.y - half, NODE_SIZE, NODE_SIZE)
        // Label
        ctx.fillStyle = '#4a5e82'; ctx.font = '9px JetBrains Mono,monospace'
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        const short = node.label.split(' ')[0]
        ctx.fillText(short, node.x, node.y - 2)
        ctx.fillText(nodeId, node.x, node.y + 8)
        // Traffic lights
        const dirs2 = { N:[0,-1], S:[0,1], E:[1,0], W:[-1,0] }
        const tlOff = NODE_SIZE / 2 + 12
        for (const dir of node.exits) {
          const [dx, dy] = dirs2[dir]
          const tx = node.x + dx * tlOff, ty = node.y + dy * tlOff
          const green = lightIsGreen(ls, dir)
          const phase = ls.phases[ls.currentPhase]
          const isYellow = !green && ls.tick > LIGHT_PHASE_TICKS - LIGHT_YELLOW_TICKS && phase?.green.includes(dir)
          const col = green ? '#22c55e' : isYellow ? '#eab308' : '#ef4444'
          ctx.fillStyle = '#1e293b'
          ctx.fillRect(tx - 5, ty - 5, 10, 10)
          ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = green ? 7 : 2
          ctx.beginPath(); ctx.arc(tx, ty, 3.5, 0, Math.PI * 2); ctx.fill()
          ctx.shadowBlur = 0
        }
      }
    }

    function drawVehicles(ctx, st) {
      for (const v of st.vehicles) {
        const seg = st.segMap[v.segId]; if (!seg) continue
        const { x, y, angle } = vehiclePosition(seg, v.progress)
        ctx.save(); ctx.translate(x, y); ctx.rotate(angle)
        if (v.isAmbulance) {
          const f = st.frame
          ctx.fillStyle = '#f8fafc'
          ctx.beginPath(); ctx.roundRect(-9, -5.5, 18, 11, 2); ctx.fill()
          ctx.fillStyle = '#ef4444'; ctx.fillRect(-3,-5+2,6,2); ctx.fillRect(-1,-5+1,2,4)
          const bc = f % 20 < 10 ? '#ef4444' : '#3b82f6'
          ctx.fillStyle = bc; ctx.shadowColor = bc; ctx.shadowBlur = 10
          ctx.fillRect(-4,-5-3,4,3)
          const bc2 = f % 20 < 10 ? '#3b82f6' : '#ef4444'
          ctx.fillStyle = bc2; ctx.shadowColor = bc2; ctx.fillRect(0,-5-3,4,3)
          ctx.shadowBlur = 0
        } else {
          ctx.fillStyle = v.color
          ctx.beginPath(); ctx.roundRect(-VEHICLE_W/2, -VEHICLE_H/2, VEHICLE_W, VEHICLE_H, 2); ctx.fill()
          ctx.fillStyle = 'rgba(148,163,184,0.25)'; ctx.fillRect(-VEHICLE_W/2+3, -VEHICLE_H/2+1, VEHICLE_W*0.35, VEHICLE_H-2)
          ctx.fillStyle = v.waiting ? '#fbbf24' : '#fef3c7'
          ctx.fillRect(VEHICLE_W/2-2, -VEHICLE_H/2+1, 1.5, 2.5)
          ctx.fillRect(VEHICLE_W/2-2,  VEHICLE_H/2-3.5, 1.5, 2.5)
          ctx.fillStyle = v.waiting ? '#ef4444' : '#7f1d1d'
          ctx.fillRect(-VEHICLE_W/2, -VEHICLE_H/2+1, 1.5, 2.5)
          ctx.fillRect(-VEHICLE_W/2,  VEHICLE_H/2-3.5, 1.5, 2.5)
        }
        ctx.restore()
      }
    }

    function drawGreenCorridor(ctx, st) {
      if (!st.ambulance) return
      ctx.strokeStyle = 'rgba(34,197,94,0.32)'; ctx.lineWidth = ROAD_WIDTH - 6
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.setLineDash([18,12])
      ctx.beginPath()
      const first = AMBULANCE_GRAPH.nodes[st.ambPath[0]]
      ctx.moveTo(first.x, first.y)
      for (let i = 1; i < st.ambPath.length; i++) {
        const n = AMBULANCE_GRAPH.nodes[st.ambPath[i]]
        if (n) ctx.lineTo(n.x, n.y)
      }
      ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1
    }

    function drawHospital(ctx) {
      const hp = ENTRY_POINTS.ENTRY_HOSPITAL
      ctx.fillStyle = '#022016'; ctx.strokeStyle = '#15803d'; ctx.lineWidth = 2
      ctx.fillRect(hp.x - 36, hp.y - 26, 72, 52)
      ctx.strokeRect(hp.x - 36, hp.y - 26, 72, 52)
      ctx.fillStyle = '#ef4444'
      ctx.fillRect(hp.x - 8, hp.y - 3, 16, 6)
      ctx.fillRect(hp.x - 3, hp.y - 8, 6, 16)
      ctx.fillStyle = '#22c55e'; ctx.font = 'bold 9px JetBrains Mono,monospace'
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'
      ctx.fillText('HOSPITAL', hp.x, hp.y + 22)
    }

    function drawDensity(ctx, st) {
      for (const [nodeId, node] of Object.entries(CITY_NODES)) {
        const count = st.vehicles.filter(v => { const seg = st.segMap[v.segId]; return seg && seg.to === nodeId }).length
        const bx = node.x - 18, by = node.y + NODE_SIZE/2 + 5
        ctx.fillStyle = 'rgba(42,54,85,0.6)'; ctx.fillRect(bx, by, 36, 4)
        const fill = Math.min(1, count / 8)
        ctx.fillStyle = fill > 0.8 ? '#ef4444' : fill > 0.5 ? '#eab308' : '#3b82f6'
        ctx.fillRect(bx, by, 36 * fill, 4)
        ctx.fillStyle = 'rgba(148,163,184,0.7)'; ctx.font = '8px JetBrains Mono,monospace'
        ctx.textAlign = 'center'; ctx.fillText(`${count}v`, node.x, by + 14)
      }
    }

    function drawAll(st) {
      ctx.fillStyle = '#07090f'; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)
      drawRoads(ctx)
      if (st.ambulance) drawGreenCorridor(ctx, st)
      drawHospital(ctx)
      drawNodes(ctx, st)
      drawVehicles(ctx, st)
      drawDensity(ctx, st)
      // Top labels
      ctx.fillStyle = 'rgba(148,163,184,0.45)'; ctx.font = '10px Plus Jakarta Sans,sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('North-A', 270, 18); ctx.fillText('North-B', 600, 18)
      ctx.fillStyle = 'rgba(34,197,94,0.7)'; ctx.font = 'bold 10px Plus Jakarta Sans,sans-serif'
      ctx.fillText('North-C', 930, 18)
      ctx.fillStyle = 'rgba(148,163,184,0.45)'
      ctx.textAlign = 'center'
      ctx.fillText('South-A', 270, CANVAS_H - 6)
      ctx.fillText('South-B', 600, CANVAS_H - 6)
      ctx.fillText('South-C', 930, CANVAS_H - 6)
      // Frame/vehicle counter
      ctx.fillStyle = 'rgba(100,116,139,0.3)'; ctx.font = '8px JetBrains Mono,monospace'
      ctx.textAlign = 'right'
      ctx.fillText(`${st.vehicles.length}v  f${st.frame}`, CANVAS_W - 8, CANVAS_H - 6)
      // Mode tag
      const modeMap = { rush:'Rush Hour', imbalanced:'Imbalanced', emergency:'EMERGENCY', normal:'Normal' }
      ctx.fillStyle = 'rgba(148,163,184,0.35)'; ctx.textAlign = 'right'
      ctx.fillText(modeMap[mode] || 'Normal', CANVAS_W - 8, 16)
    }

    function tick() {
      if (!running) return
      const st = stateRef.current
      if (st) {
        st.frame++
        const offset = mode === 'rush' ? -40 : mode === 'imbalanced' ? 60 : 0
        st.lights = tickLights(st.lights, offset)
        autoSpawn(st)
        processCVQueue(st)
        updateVehicles(st)
        drawAll(st)
        st.framesSinceUIUpdate++
        if (st.framesSinceUIUpdate >= 30) {
          st.framesSinceUIUpdate = 0
          // Sync vehicle counts per node for overlay badges
          const counts = {}
          for (const nodeId of Object.keys(CITY_NODES)) {
            counts[nodeId] = st.vehicles.filter(v => { const seg = st.segMap[v.segId]; return seg && seg.to === nodeId }).length
          }
          setNodeCounts(counts)
          if (typeof onLightChange === 'function') {
            const snap = {}
            for (const [id, ls] of Object.entries(st.lights)) snap[id] = { currentPhase: ls.currentPhase, phases: ls.phases, override: ls.override }
            onLightChange(snap)
          }
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => { running = false; cancelAnimationFrame(rafRef.current) }
  }, [mode, isDark, emergencyActive, spawnVehicle, onLightChange, initState])

  // ─── Render ────────────────────────────────────────────────
  // Canvas scale factor (CSS width vs canvas pixels)
  const containerRef = useRef(null)

  return (
    <div className="flex flex-col gap-0">
      {/* ── Header bar ── */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-surface-elevated">
        <div>
          <span className="text-[11px] font-bold text-ink tracking-wide uppercase">CITY GRID MICRO-SIMULATION</span>
          <span className="text-[10px] text-ink-muted ml-3">3 Perempatan + 2 Pertigaan — Kendaraan bergerak real-time</span>
        </div>
        <div className="flex items-center gap-2">
          {emergencyActive && (
            <span className="chip bg-danger/10 text-danger border-danger/30 text-[10px] font-semibold animate-pulse-dot">
              🚑 GREEN CORRIDOR AKTIF
            </span>
          )}
          {cvStatus === 'connected' && (
            <span className="chip bg-accent/10 text-accent border-accent/30 text-[10px]">
              <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse-dot" />
              CV Online
            </span>
          )}
        </div>
      </div>

      {/* ── Canvas + HTML overlay ── */}
      <div ref={containerRef} className="relative w-full overflow-hidden bg-[#07090f]" style={{ aspectRatio: `${CANVAS_W}/${CANVAS_H}` }}>
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          className="w-full h-full block"
          style={{ imageRendering: 'crisp-edges' }}
        />

        {/* Hospital badge (top-right of canvas at NC position) */}
        <div className="absolute pointer-events-none"
          style={{ left: `${(930 / CANVAS_W) * 100}%`, top: `${(15 / CANVAS_H) * 100}%`, transform: 'translateX(-50%)' }}>
          <div className="flex flex-col items-center gap-0.5">
            <div className="bg-green-900/90 border-2 border-green-500 rounded-lg px-2 py-1 flex flex-col items-center">
              <span className="text-green-400 font-bold text-xl leading-none">+</span>
              <span className="text-green-400 font-bold text-[9px] tracking-wider">HOSPITAL</span>
            </div>
          </div>
        </div>

        {/* Upload Video + Ambulance buttons per entry */}
        {ENTRY_CONFIG.map(entry => {
          const [lp, tp] = entry.canvasPct
          const uState   = uploadState[entry.id]
          const isUploading = uState === 'uploading'
          const isDone      = uState === 'done'

          // Align: center = offset -50%, left = offset to right of point
          const transform = entry.alignX === 'center' ? 'translateX(-50%)'
            : entry.alignX === 'left' ? 'translateX(4px)'
            : 'translateX(-100%)'

          return (
            <div
              key={entry.id}
              className="absolute flex flex-col items-start gap-1"
              style={{
                left:      `${lp * 100}%`,
                top:       `${tp * 100}%`,
                transform: `${transform} translateY(-50%)`,
                zIndex: 10,
              }}
            >
              {/* Hidden file input */}
              <input
                ref={el => { fileInputRefs.current[entry.id] = el }}
                type="file"
                accept="video/*"
                className="hidden"
                onChange={e => {
                  const file = e.target.files?.[0]
                  if (file) handleUpload(entry, file)
                  e.target.value = ''
                }}
              />

              {/* Upload Video button */}
              <button
                onClick={() => triggerUpload(entry)}
                disabled={isUploading}
                className={[
                  'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10px] font-semibold',
                  'border transition-all duration-200 whitespace-nowrap',
                  'shadow-[0_2px_12px_rgba(0,0,0,0.5)]',
                  isUploading
                    ? 'bg-surface-muted border-border text-ink-muted cursor-not-allowed'
                    : isDone
                    ? 'bg-accent/10 border-accent/40 text-accent'
                    : 'bg-[#1a2e4a] border-[#2a4a6e] text-[#60a5fa] hover:bg-[#1e3a5f] hover:border-[#3a6a9e]',
                ].join(' ')}
              >
                {isUploading ? (
                  <><span className="animate-spin">⏳</span> Uploading…</>
                ) : isDone ? (
                  <><span>✅</span> Done</>
                ) : (
                  <><span>📹</span> Upload Video</>
                )}
              </button>

              {/* Ambulance button */}
              <button
                onClick={() => spawnAmbulance()}
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10px] font-semibold
                           border border-[#4a1a1a] bg-[#2a0d0d] text-[#f87171]
                           hover:bg-[#3a1010] hover:border-[#6a2020]
                           shadow-[0_2px_12px_rgba(0,0,0,0.5)] transition-all duration-200 whitespace-nowrap"
              >
                <span>🚑</span> Ambulance
              </button>
            </div>
          )
        })}

        {/* Legend bottom-left */}
        <div className="absolute bottom-3 left-3 flex items-center gap-3 pointer-events-none">
          <LegItem color="#22c55e" label="Green light / Hijau" />
          <LegItem color="#ef4444" label="Red light / Merah" />
          <LegItem color="#eab308" label="Yellow / Kuning" />
          <LegItem color="#3b82f6" label="Adaptive / Density" />
        </div>
      </div>

      {/* ── Event Log ── */}
      <div className="border-t border-border bg-surface-muted px-4 py-2.5" style={{ minHeight: 64 }}>
        <p className="text-[10px] font-bold text-accent mb-1.5 flex items-center gap-1.5">
          <span>📋</span> Event Log
        </p>
        <div className="space-y-0.5">
          {eventLog.slice(0, 3).map((msg, i) => (
            <p key={i} className={`text-[10px] font-mono ${i === 0 ? 'text-ink' : 'text-ink-muted'}`}>
              {msg}
            </p>
          ))}
        </div>
      </div>
    </div>
  )
}

function LegItem({ color, label }) {
  return (
    <div className="flex items-center gap-1">
      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
      <span className="text-[9px] text-ink-soft">{label}</span>
    </div>
  )
}
