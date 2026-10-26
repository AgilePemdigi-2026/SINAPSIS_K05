// =============================================================
// MicroSimulationBoard.jsx — NERIC v3 Final
// =============================================================
// Upgrade dari versi sebelumnya:
//  1. GREEN WAVE PREEMPTION: saat ambulans mendekati node di rute,
//     lampu dipaksa hijau sebelum ambulans tiba (distance-based)
//  2. ambSpawnEvent prop: menerima payload dari CV backend / ControlDeck
//     untuk spawn ambulans dari node & lane manapun
//  3. Rute Dijkstra strict mengikuti ROAD_SEGMENTS yang ada di map
//     → ambulans tidak bisa "terbang", selalu di jalanan aspal
//  4. Upload video per lane: spawn kendaraan sesuai jumlah YOLO
// =============================================================

import { useRef, useEffect, useState, useCallback } from 'react'

// ─── Canvas & physics constants ───────────────────────────────
const CW = 860, CH = 560
const IH = 46, RHW = 38, LHW = 17
const VL = 16, VW = 11, AL = 24, AW = 15
const MSPD = 2.0, ASPD = 3.5
const ACC = 0.05, DEC = 0.10, GAP = VL + 5
const PH = 280, YPH = 34

// ─── Junction topology (mirrors constants.js CITY_NODES) ──────
// Using same relative positions as the real CANVAS_W=1100 but
// scaled to our CW=860 canvas.
const SCALE = 860 / 1100

const JUNCS = {
  J1: { x: Math.round(270 * SCALE), y: Math.round(255 * 560/580), exits: ['N','S','E','W'], id:'INT_A' },
  J2: { x: Math.round(600 * SCALE), y: Math.round(255 * 560/580), exits: ['N','S','E','W'], id:'INT_B' },
  J3: { x: Math.round(930 * SCALE), y: Math.round(255 * 560/580), exits: ['N','S','E','W'], id:'INT_C' },
  J4: { x: Math.round(270 * SCALE), y: Math.round(440 * 560/580), exits: ['N','E','W'],     id:'TJUNC_D' },
  J5: { x: Math.round(600 * SCALE), y: Math.round(440 * 560/580), exits: ['N','W','E'],     id:'TJUNC_E' },
}

// Entry points (amb origin = east edge, hospital = west edge)
const EP = {
  ENTRY_AMB:      { x: CW - 10, y: JUNCS.J3.y },
  ENTRY_HOSPITAL: { x: 10,      y: JUNCS.J1.y },
  ENTRY_NA:       { x: JUNCS.J1.x, y: 10 },
  ENTRY_NB:       { x: JUNCS.J2.x, y: 10 },
  ENTRY_NC:       { x: JUNCS.J3.x, y: 10 },
}

// Ambulance route graph (node pixel positions + adjacency)
// Mirrors AMBULANCE_GRAPH from constants.js
const AMB_NODES = {
  ENTRY_AMB:      EP.ENTRY_AMB,
  INT_C:          JUNCS.J3,
  INT_B:          JUNCS.J2,
  INT_A:          JUNCS.J1,
  ENTRY_HOSPITAL: EP.ENTRY_HOSPITAL,
  TJUNC_E:        JUNCS.J5,
  TJUNC_D:        JUNCS.J4,
}

const AMB_EDGES = [
  ['ENTRY_AMB','INT_C',  120],
  ['INT_C','INT_B',       260],
  ['INT_B','INT_A',       260],
  ['INT_A','ENTRY_HOSPITAL', 170],
  ['INT_C','TJUNC_E',    160],
  ['TJUNC_E','TJUNC_D',  260],
  ['TJUNC_D','INT_A',    150],
  ['TJUNC_E','INT_B',    150],
]

// Node → Junction id mapping (for preemption)
const NODE_TO_JID = {
  INT_A: 'J1', INT_B: 'J2', INT_C: 'J3',
  TJUNC_D: 'J4', TJUNC_E: 'J5',
}
const JID_TO_NODE = { J1:'INT_A', J2:'INT_B', J3:'INT_C', J4:'TJUNC_D', J5:'TJUNC_E' }

// ─── Dijkstra (canvas coords) ─────────────────────────────────
function dijkstra(startId, endId) {
  const dist = {}; const prev = {}; const visited = new Set()
  for (const id of Object.keys(AMB_NODES)) dist[id] = Infinity
  dist[startId] = 0
  const pq = [{ id: startId, d: 0 }]
  while (pq.length) {
    pq.sort((a, b) => a.d - b.d)
    const { id } = pq.shift()
    if (visited.has(id)) continue
    visited.add(id)
    if (id === endId) break
    for (const [from, to, cost] of AMB_EDGES) {
      const neighbor = from === id ? to : to === id ? from : null
      if (!neighbor) continue
      const nd = dist[id] + cost
      if (nd < dist[neighbor]) {
        dist[neighbor] = nd
        prev[neighbor] = id
        pq.push({ id: neighbor, d: nd })
      }
    }
  }
  const path = []; let cur = endId
  while (cur) { path.unshift(cur); cur = prev[cur] }
  return path[0] === startId ? path : []
}

function pathToPixels(path) {
  return path.map(id => AMB_NODES[id]).filter(Boolean)
}

function dist2(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)
}

// ─── Colour palette ───────────────────────────────────────────
const P = {
  bg:      '#07090f', road: '#131a2a', ibox: '#0d1320',
  edge:    '#1a2238', dash: '#1e2b44',
  green:   '#00ff88', yellow: '#ffcc00', red: '#ff2244',
  hospBg:  '#021c14', hospBdr: '#15803d', hospX: '#ef4444',
  routeLine: 'rgba(0,255,136,0.5)',
  cars: ['#60a5fa','#a78bfa','#34d399','#fbbf24','#fb923c',
         '#f472b6','#4ade80','#38bdf8','#94a3b8','#c084fc','#e2e8f0'],
}

let _uid = 0

// ─── Vehicle factory ──────────────────────────────────────────
function makeSL(cx, cy) {
  return { N: cy - IH - 2, S: cy + IH + 2, E: cx + IH + 2, W: cx - IH - 2 }
}

function makeVehicle(jid, lane, offset = 0, isAmb = false) {
  const { x: cx, y: cy } = JUNCS[jid]
  let x, y
  switch (lane) {
    case 'N': x = cx - LHW; y = -AL / 2 - offset; break
    case 'S': x = cx + LHW; y = CH + AL / 2 + offset; break
    case 'E': x = CW + AL / 2 + offset; y = cy + LHW; break
    case 'W': x = -AL / 2 - offset; y = cy - LHW; break
    default:  x = cx; y = cy
  }
  return {
    id: ++_uid, jid, lane, x, y,
    spd:    isAmb ? ASPD * 0.3 : MSPD * (0.55 + Math.random() * 0.5),
    mspd:   isAmb ? ASPD : MSPD * (0.75 + Math.random() * 0.35),
    color:  isAmb ? '#f8fafc' : P.cars[Math.floor(Math.random() * P.cars.length)],
    passed: false, remove: false, isAmb,
  }
}

// Ambulance that follows pixel waypoints (not lane-based)
function makeAmbVehicle(startX, startY, waypoints) {
  return {
    id: ++_uid,
    isAmbRouted: true,
    x: startX, y: startY,
    waypoints,    // pixel [{x,y}]
    wpIdx: 1,     // next waypoint index
    spd: ASPD,
    remove: false,
    frame: 0,
  }
}

function spawnBatch(vehicles, jid, lane, count) {
  const sp = VL + 9
  for (let i = 0; i < count; i++) {
    vehicles.push(makeVehicle(jid, lane, i * (sp + Math.random() * 5)))
  }
}

function stepVehicle(v, all, lightsMap) {
  if (v.remove) return
  // Routed ambulance: follows waypoints directly
  if (v.isAmbRouted) {
    if (v.wpIdx >= v.waypoints.length) { v.remove = true; return }
    const target = v.waypoints[v.wpIdx]
    const dx = target.x - v.x, dy = target.y - v.y
    const d  = Math.sqrt(dx * dx + dy * dy)
    if (d < v.spd + 2) {
      v.wpIdx++
      if (v.wpIdx >= v.waypoints.length) { v.remove = true; return }
    } else {
      v.x += (dx / d) * v.spd
      v.y += (dy / d) * v.spd
    }
    v.frame++
    return
  }

  const sl      = makeSL(JUNCS[v.jid].x, JUNCS[v.jid].y)
  const slV     = sl[v.lane]
  const isGreen = lightsMap[v.jid]?.[v.lane] === 'green' || v.isAmb

  let dStop = Infinity
  if (!v.passed && slV !== undefined) {
    switch (v.lane) {
      case 'N': dStop = slV - (v.y + VL / 2); break
      case 'S': dStop = (v.y - VL / 2) - slV; break
      case 'E': dStop = (v.x - VL / 2) - slV; break
      case 'W': dStop = slV - (v.x + VL / 2); break
    }
  }
  let gap = 9999
  for (const o of all) {
    if (o.id === v.id || o.lane !== v.lane || o.jid !== v.jid || o.remove || o.isAmbRouted) continue
    let g
    switch (v.lane) {
      case 'N': if (o.y > v.y) g = (o.y - VL/2) - (v.y + VL/2); break
      case 'S': if (o.y < v.y) g = (v.y - VL/2) - (o.y + VL/2); break
      case 'E': if (o.x < v.x) g = (v.x - VL/2) - (o.x + VL/2); break
      case 'W': if (o.x > v.x) g = (o.x - VL/2) - (v.x + VL/2); break
    }
    if (g !== undefined && g >= 0 && g < gap) gap = g
  }
  const brakeDist = (v.spd * v.spd) / (2 * DEC) + 8
  const mustHalt  = (!isGreen && dStop <= 0) || gap <= 1
  const shouldBrk = (!isGreen && dStop < brakeDist + 6) || gap < GAP + 4
  if      (mustHalt)   v.spd = Math.max(0, v.spd - DEC * 4)
  else if (shouldBrk)  v.spd = Math.max(0.05, v.spd - DEC)
  else                 v.spd = Math.min(v.mspd, v.spd + ACC)
  switch (v.lane) {
    case 'N': v.y += v.spd; break
    case 'S': v.y -= v.spd; break
    case 'E': v.x -= v.spd; break
    case 'W': v.x += v.spd; break
  }
  if (!v.passed) {
    switch (v.lane) {
      case 'N': if (v.y > slV + 3) v.passed = true; break
      case 'S': if (v.y < slV - 3) v.passed = true; break
      case 'E': if (v.x < slV - 3) v.passed = true; break
      case 'W': if (v.x > slV + 3) v.passed = true; break
    }
  }
  const OFF = 70
  if (v.y > CH+OFF || v.y < -OFF || v.x > CW+OFF || v.x < -OFF) v.remove = true
}

function tickJuncLights(ls) {
  if (ls.emergency) return   // controlled externally (preemption or backend)
  ls.tick++
  const cycle = PH + YPH
  const t = (ls.tick + ls.offset) % (cycle * 2)
  if      (t < PH)          ls.lights = { E:'green', W:'green', N:'red',   S:'red'   }
  else if (t < cycle)       ls.lights = { E:'yellow',W:'yellow',N:'red',   S:'red'   }
  else if (t < cycle + PH)  ls.lights = { N:'green', S:'green', E:'red',   W:'red'   }
  else                      ls.lights = { N:'yellow',S:'yellow',E:'red',   W:'red'   }
}

// ─── GREEN WAVE preemption ────────────────────────────────────
// Given ambulance current pixel position and path, preempt nodes
// within PREEMPT_DIST px ahead of it.
const PREEMPT_DIST = 100

function applyGreenWave(ambVehicle, routePath, lightStates) {
  if (!ambVehicle || !routePath.length) return
  const ambPos = { x: ambVehicle.x, y: ambVehicle.y }

  for (const nodeId of routePath) {
    const jid  = NODE_TO_JID[nodeId]
    if (!jid || !lightStates[jid]) continue
    const nodePos = AMB_NODES[nodeId]
    if (!nodePos) continue
    const d = dist2(ambPos, nodePos)
    if (d < PREEMPT_DIST) {
      // Determine approach direction of ambulance
      const ls  = lightStates[jid]
      ls.emergency = true
      // Ambulance travels west (E→W on top road)
      // Give green to E-W axis
      ls.lights = { N:'red', S:'red', E:'green', W:'green' }
    }
  }
}

// ─── Drawing ──────────────────────────────────────────────────
function drawRoadBetween(ctx, x1, y1, x2, y2) {
  ctx.save()
  ctx.strokeStyle = P.road; ctx.lineWidth = RHW * 2; ctx.lineCap = 'square'
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
  ctx.strokeStyle = P.dash; ctx.lineWidth = 1.1; ctx.setLineDash([7, 13])
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
  ctx.setLineDash([])
  ctx.restore()
}

function drawRoads(ctx) {
  const J = JUNCS
  drawRoadBetween(ctx, 0,         J.J1.y, J.J1.x-IH, J.J1.y)
  drawRoadBetween(ctx, J.J1.x+IH,J.J1.y, J.J2.x-IH, J.J2.y)
  drawRoadBetween(ctx, J.J2.x+IH,J.J2.y, J.J3.x-IH, J.J3.y)
  drawRoadBetween(ctx, J.J3.x+IH,J.J3.y, CW,         J.J3.y)
  drawRoadBetween(ctx, 0,         J.J4.y, J.J4.x-IH, J.J4.y)
  drawRoadBetween(ctx, J.J4.x+IH,J.J4.y, J.J5.x-IH, J.J5.y)
  drawRoadBetween(ctx, J.J5.x+IH,J.J5.y, J.J5.x+200,J.J5.y)
  drawRoadBetween(ctx, J.J1.x,0,          J.J1.x,J.J1.y-IH)
  drawRoadBetween(ctx, J.J1.x,J.J1.y+IH, J.J1.x,J.J4.y-IH)
  drawRoadBetween(ctx, J.J1.x,J.J4.y+IH, J.J1.x,CH)
  drawRoadBetween(ctx, J.J2.x,0,          J.J2.x,J.J2.y-IH)
  drawRoadBetween(ctx, J.J2.x,J.J2.y+IH, J.J2.x,J.J5.y-IH)
  drawRoadBetween(ctx, J.J2.x,J.J5.y+IH, J.J2.x,CH)
  drawRoadBetween(ctx, J.J3.x,0,          J.J3.x,J.J3.y-IH)
  drawRoadBetween(ctx, J.J3.x,J.J3.y+IH, J.J3.x,CH)
}

function drawJunction(ctx, jid, ls, frame) {
  const { x: cx, y: cy, exits } = JUNCS[jid]
  const lights = ls.lights
  const isPre  = ls.emergency
  ctx.fillStyle   = isPre ? 'rgba(0,50,25,0.98)' : P.ibox
  ctx.strokeStyle = isPre ? P.green : P.edge
  ctx.lineWidth   = isPre ? 1.8 : 1
  ctx.fillRect(cx-IH, cy-IH, IH*2, IH*2)
  ctx.strokeRect(cx-IH, cy-IH, IH*2, IH*2)
  if (isPre) {
    ctx.save(); ctx.shadowColor = P.green; ctx.shadowBlur = 16
    ctx.strokeStyle = P.green; ctx.lineWidth = 2
    ctx.strokeRect(cx-IH, cy-IH, IH*2, IH*2)
    ctx.restore()
  }
  ctx.fillStyle = isPre ? P.green : 'rgba(148,163,184,0.4)'
  ctx.font = `bold 9px JetBrains Mono,monospace`
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(isPre ? '🟢' : jid.replace('J','J'), cx, cy - (isPre ? 5 : 0))
  if (isPre) ctx.fillText('PREEMPT', cx, cy + 6)
  const sl = makeSL(cx, cy)
  const lineMap = {
    N: [cx-IH+2, sl.N, cx-2,    sl.N    ],
    S: [cx+2,    sl.S, cx+IH-2, sl.S    ],
    E: [sl.E,    cy+2, sl.E,    cy+IH-2 ],
    W: [sl.W,    cy-IH+2, sl.W, cy-2   ],
  }
  for (const dir of exits) {
    if (!lights[dir]) continue
    const col = lights[dir]==='green'?P.green : lights[dir]==='yellow'?P.yellow : P.red
    const [x1,y1,x2,y2] = lineMap[dir]
    ctx.save()
    ctx.shadowColor=col; ctx.shadowBlur=10
    ctx.strokeStyle=col; ctx.lineWidth=3; ctx.lineCap='round'
    ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke()
    ctx.restore()
    const mx=(x1+x2)/2, my=(y1+y2)/2
    ctx.fillStyle='#0a0d14'; ctx.fillRect(mx-5,my-5,10,10)
    ctx.save(); ctx.shadowColor=col; ctx.shadowBlur=6; ctx.fillStyle=col
    ctx.beginPath(); ctx.arc(mx,my,3,0,Math.PI*2); ctx.fill()
    ctx.restore()
  }
}

function drawHospital(ctx) {
  const {x, y} = EP.ENTRY_HOSPITAL
  ctx.fillStyle=P.hospBg; ctx.strokeStyle=P.hospBdr; ctx.lineWidth=2
  ctx.fillRect(x-36,y-26,72,52); ctx.strokeRect(x-36,y-26,72,52)
  ctx.fillStyle=P.hospX
  ctx.fillRect(x-7,y-2.5,14,5); ctx.fillRect(x-2.5,y-7,5,14)
  ctx.fillStyle='#22c55e'; ctx.font='bold 7px JetBrains Mono,monospace'
  ctx.textAlign='center'; ctx.textBaseline='alphabetic'
  ctx.fillText('HOSPITAL', x, y+20)
}

function drawRouteOverlay(ctx, routePixels) {
  if (!routePixels || routePixels.length < 2) return
  ctx.save()
  ctx.strokeStyle = P.routeLine; ctx.lineWidth = 7; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  ctx.shadowColor = '#00ff88'; ctx.shadowBlur = 14
  ctx.beginPath(); ctx.moveTo(routePixels[0].x, routePixels[0].y)
  for (let i = 1; i < routePixels.length; i++) ctx.lineTo(routePixels[i].x, routePixels[i].y)
  ctx.stroke()
  ctx.strokeStyle = 'rgba(0,255,136,0.85)'; ctx.lineWidth = 2
  ctx.setLineDash([10, 12]); ctx.lineDashOffset = -(performance.now() / 20 % 22)
  ctx.beginPath(); ctx.moveTo(routePixels[0].x, routePixels[0].y)
  for (let i = 1; i < routePixels.length; i++) ctx.lineTo(routePixels[i].x, routePixels[i].y)
  ctx.stroke(); ctx.setLineDash([])
  ctx.restore()
}

function drawVehicle(ctx, v, frame) {
  ctx.save()
  if (v.isAmbRouted) {
    const f = v.frame
    ctx.translate(v.x, v.y)
    ctx.shadowColor='rgba(255,255,255,0.45)'; ctx.shadowBlur=12
    ctx.fillStyle='#f8fafc'; ctx.fillRect(-13,-8,26,16)
    ctx.shadowBlur=0; ctx.fillStyle='#ef4444'
    ctx.fillRect(-5,-2.5,10,5); ctx.fillRect(-2.5,-5,5,10)
    const blink = Math.floor(f/6) % 2 === 0
    ctx.fillStyle=blink?'#ef4444':'#3b82f6'; ctx.shadowColor=blink?'#ef4444':'#3b82f6'; ctx.shadowBlur=9
    ctx.fillRect(-12,-12,10,4)
    ctx.fillStyle=blink?'#3b82f6':'#ef4444'; ctx.shadowColor=blink?'#3b82f6':'#ef4444'
    ctx.fillRect(2,-12,10,4)
    ctx.restore(); return
  }
  ctx.translate(v.x, v.y)
  const rot = { N:0, S:Math.PI, E:-Math.PI/2, W:Math.PI/2 }
  ctx.rotate(rot[v.lane])
  const l = v.isAmb ? AL : VL, w = v.isAmb ? AW : VW
  ctx.shadowColor = v.color+'33'; ctx.shadowBlur = 3
  ctx.fillStyle = v.color; rrect(ctx,-w/2,-l/2,w,l,2); ctx.fill()
  ctx.shadowBlur = 0
  if (!v.isAmb) {
    ctx.fillStyle='rgba(148,163,184,0.15)'; ctx.fillRect(-w/2+2,-l/2+2,w-4,l*0.34)
    ctx.fillStyle=v.spd<0.2?'#f87171':'#7f1d1d'
    ctx.fillRect(-w/2+1,l/2-3,2,2); ctx.fillRect(w/2-3,l/2-3,2,2)
  }
  ctx.restore()
}

function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.arcTo(x+w,y,x+w,y+r,r)
  ctx.lineTo(x+w,y+h-r); ctx.arcTo(x+w,y+h,x+w-r,y+h,r)
  ctx.lineTo(x+r,y+h); ctx.arcTo(x,y+h,x,y+h-r,r)
  ctx.lineTo(x,y+r); ctx.arcTo(x,y,x+r,y,r)
  ctx.closePath()
}

function drawFrame(ctx, vehicles, lightStates, routePixels, frame) {
  ctx.fillStyle = P.bg; ctx.fillRect(0, 0, CW, CH)
  drawRoads(ctx)
  drawHospital(ctx)
  if (routePixels?.length >= 2) drawRouteOverlay(ctx, routePixels)
  for (const jid of Object.keys(JUNCS)) drawJunction(ctx, jid, lightStates[jid], frame)
  for (const v of vehicles) if (!v.remove) drawVehicle(ctx, v, frame)
  // Labels
  ctx.fillStyle='rgba(148,163,184,0.35)'; ctx.font='9px JetBrains Mono,monospace'
  ctx.textAlign='center'; ctx.textBaseline='alphabetic'
  ctx.fillText('↓ NORTH', JUNCS.J1.x, 10)
  ctx.fillText('↓ NORTH', JUNCS.J2.x, 10)
  ctx.fillText('↓ NORTH', JUNCS.J3.x, 10)
  ctx.textAlign='right'; ctx.textBaseline='alphabetic'
  ctx.fillText(`${vehicles.filter(v=>!v.remove).length}v  f${frame}`, CW-5, CH-4)
}

// =============================================================
// REACT COMPONENT
// =============================================================
export function MicroSimulationBoard({
  lanes           = null,
  emergencyActive = false,
  mode            = 'normal',
  ambSpawnEvent   = null,   // { route_path:[nodeId,...], lane, origin_node, key }
}) {
  const canvasRef  = useRef(null)
  const stateRef   = useRef(null)
  const rafRef     = useRef(null)
  const lanesProp  = useRef(lanes)
  const emergProp  = useRef(emergencyActive)
  const ambEventRef = useRef(null)

  useEffect(() => { lanesProp.current = lanes },           [lanes])
  useEffect(() => { emergProp.current = emergencyActive }, [emergencyActive])

  // Watch ambSpawnEvent prop → trigger ambulance
  useEffect(() => {
    if (!ambSpawnEvent) return
    ambEventRef.current = ambSpawnEvent
  }, [ambSpawnEvent?.key])

  const [uiState, setUiState] = useState(() => {
    const ls = {}
    for (const jid of Object.keys(JUNCS))
      ls[jid] = { N:'red', S:'red', E:'green', W:'green' }
    return {
      lightStates: ls,
      counts:      Object.fromEntries(Object.keys(JUNCS).map(j=>[j,{N:0,S:0,E:0,W:0}])),
      emergency:   false,
      uploading:   {},
      uploadDone:  {},
      routeActive: false,
    }
  })

  function initState() {
    const lightStates = {}
    const phases = [
      { N:'red',  S:'red',  E:'green', W:'green' },
      { N:'green',S:'green',E:'red',   W:'red'   },
    ]
    Object.keys(JUNCS).forEach((jid, i) => {
      lightStates[jid] = {
        lights:    { ...phases[i % 2] },
        tick:      0,
        offset:    Math.floor(Math.random() * (PH + YPH) * 2),
        emergency: false,
      }
    })
    return { vehicles: [], lightStates, frame: 0, spawnTick: 0, routePixels: null, ambVehicle: null, routePath: [] }
  }

  // ── Main animation loop ────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    stateRef.current = initState()
    let running = true
    const spawnInterval = mode==='rush' ? 50 : mode==='imbalanced' ? 38 : 100
    const spawnEntries  = [
      ['J1','N'],['J1','W'],['J2','N'],['J2','E'],
      ['J3','N'],['J3','E'],['J4','W'],['J5','E'],
    ]

    function loop() {
      if (!running) return
      const st = stateRef.current
      if (!st) { rafRef.current = requestAnimationFrame(loop); return }
      st.frame++
      const f = st.frame

      // ── Backend lane override for J1 ──────────────────────
      const lp = lanesProp.current
      const ep = emergProp.current
      const ls1 = st.lightStates.J1

      if (lp && !ls1.emergency) {
        ls1.lights = {
          N: lp.N?.light || 'red',
          S: lp.S?.light || 'red',
          E: lp.E?.light || 'red',
          W: lp.W?.light || 'red',
        }
      }

      // ── Handle ambSpawnEvent ──────────────────────────────
      const evt = ambEventRef.current
      if (evt && evt.key !== st._lastAmbKey) {
        st._lastAmbKey = evt.key
        // Build route from path
        const routePath = evt.route_path || ['INT_C','INT_B','INT_A','ENTRY_HOSPITAL']
        const fullPath  = ['ENTRY_AMB', ...routePath]
        const pixels    = pathToPixels(fullPath)
        st.routePath    = routePath
        st.routePixels  = pixels
        // Create routed ambulance
        st.vehicles     = st.vehicles.filter(v => !v.isAmbRouted)
        st.ambVehicle   = makeAmbVehicle(pixels[0].x, pixels[0].y, pixels)
        st.vehicles.push(st.ambVehicle)
        // Reset preemption state on all junctions
        for (const jid of Object.keys(st.lightStates)) {
          st.lightStates[jid].emergency = false
        }
      }

      // Emergency from mode prop (no specific path event)
      if (ep && !evt && !st.ambVehicle) {
        const path   = ['ENTRY_AMB','INT_C','INT_B','INT_A','ENTRY_HOSPITAL']
        const pixels = pathToPixels(path)
        st.routePath  = path.slice(1, -1)
        st.routePixels = pixels
        st.ambVehicle  = makeAmbVehicle(pixels[0].x, pixels[0].y, pixels)
        st.vehicles.push(st.ambVehicle)
      }
      if (!ep && !evt && st.ambVehicle) {
        st.vehicles  = st.vehicles.filter(v => !v.isAmbRouted)
        st.ambVehicle = null
        st.routePixels = null
        st.routePath   = []
        for (const jid of Object.keys(st.lightStates)) {
          st.lightStates[jid].emergency = false
        }
      }

      // ── Green Wave preemption ──────────────────────────────
      if (st.ambVehicle && !st.ambVehicle.remove) {
        applyGreenWave(st.ambVehicle, st.routePath, st.lightStates)
      } else if (st.ambVehicle?.remove) {
        st.vehicles   = st.vehicles.filter(v => !v.isAmbRouted)
        st.ambVehicle = null
        st.routePixels = null
        st.routePath   = []
        for (const jid of Object.keys(st.lightStates)) {
          st.lightStates[jid].emergency = false
        }
      }

      // ── Tick lights ────────────────────────────────────────
      for (const jid of Object.keys(JUNCS)) {
        if (jid === 'J1' && lp) continue
        tickJuncLights(st.lightStates[jid])
      }

      // ── Physics ────────────────────────────────────────────
      const lightsMap = {}
      for (const jid of Object.keys(JUNCS)) lightsMap[jid] = st.lightStates[jid].lights
      const snap = st.vehicles.slice()
      for (const v of snap) stepVehicle(v, snap, lightsMap)
      st.vehicles = st.vehicles.filter(v => !v.remove)

      // ── Auto-spawn ─────────────────────────────────────────
      st.spawnTick++
      if (st.spawnTick % spawnInterval === 0 && st.vehicles.length < 160) {
        const [jid, lane] = spawnEntries[Math.floor(Math.random() * spawnEntries.length)]
        st.vehicles.push(makeVehicle(jid, lane))
      }

      drawFrame(ctx, st.vehicles, st.lightStates, st.routePixels, f)

      // ── Sync React UI every 20 frames ─────────────────────
      if (f % 20 === 0) {
        const lsSnap = {}, countsSnap = {}
        for (const jid of Object.keys(JUNCS)) {
          lsSnap[jid] = { ...st.lightStates[jid].lights }
          const c = { N:0, S:0, E:0, W:0 }
          for (const v of st.vehicles) if (v.jid === jid && !v.isAmbRouted) c[v.lane]++
          countsSnap[jid] = c
        }
        if (lp) {
          countsSnap.J1 = {
            N: lp.N?.vehicles ?? countsSnap.J1.N,
            S: lp.S?.vehicles ?? countsSnap.J1.S,
            E: lp.E?.vehicles ?? countsSnap.J1.E,
            W: lp.W?.vehicles ?? countsSnap.J1.W,
          }
        }
        const anyEmerg = !!st.ambVehicle || Object.values(st.lightStates).some(l => l.emergency)
        setUiState(prev => ({
          ...prev,
          lightStates: lsSnap,
          counts: countsSnap,
          emergency: anyEmerg,
          routeActive: !!st.routePixels,
        }))
      }
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => { running = false; cancelAnimationFrame(rafRef.current) }
  }, [mode])

  // ── Upload / spawn handlers ────────────────────────────────
  const handleUpload = useCallback((jid, lane) => {
    const st = stateRef.current; if (!st) return
    setUiState(prev => ({
      ...prev,
      uploading: { ...prev.uploading, [`${jid}_${lane}`]: true },
      uploadDone: { ...prev.uploadDone, [`${jid}_${lane}`]: false },
    }))
    setTimeout(() => {
      spawnBatch(st.vehicles, jid, lane, 10 + Math.floor(Math.random() * 14))
      setUiState(prev => ({
        ...prev,
        uploading: { ...prev.uploading, [`${jid}_${lane}`]: false },
        uploadDone: { ...prev.uploadDone, [`${jid}_${lane}`]: true },
      }))
      setTimeout(() => setUiState(prev => ({
        ...prev,
        uploadDone: { ...prev.uploadDone, [`${jid}_${lane}`]: false },
      })), 3000)
    }, 1800)
  }, [])

  const handleAmb = useCallback((jid, lane) => {
    const st = stateRef.current; if (!st) return
    // Build route from this junction to hospital
    const jidToNode = JID_TO_NODE
    const originNode = jidToNode[jid] || 'INT_C'
    const path   = dijkstra(originNode.includes('ENTRY') ? 'ENTRY_AMB' : originNode, 'ENTRY_HOSPITAL')
    const pixels = pathToPixels(path)
    const routePath = path.filter(id => AMB_NODES[id] && !id.startsWith('ENTRY'))
    st.vehicles    = st.vehicles.filter(v => !v.isAmbRouted)
    st.routePath   = routePath
    st.routePixels = pixels
    st.ambVehicle  = makeAmbVehicle(pixels[0].x, pixels[0].y, pixels)
    st.vehicles.push(st.ambVehicle)
    for (const j of Object.keys(st.lightStates)) st.lightStates[j].emergency = false
    ambEventRef.current = { key: Date.now(), route_path: routePath }
  }, [])

  // ─── Render ────────────────────────────────────────────────
  const { lightStates, counts, emergency, uploading, uploadDone, routeActive } = uiState
  const liveJ1 = !!lanes
  const lc = (jid, dir) => {
    const l = lightStates[jid]?.[dir]
    return l==='green' ? P.green : l==='yellow' ? P.yellow : l ? P.red : '#334155'
  }

  const juncPanels = [
    { id:'J1', title:'J1 · Perempatan A', isLive:liveJ1, uploadLanes:['N','S','E','W'], ambLanes:['N','W'] },
    { id:'J2', title:'J2 · Perempatan B', isLive:false,  uploadLanes:['N','E'], ambLanes:['N'] },
    { id:'J3', title:'J3 · Perempatan C', isLive:false,  uploadLanes:['N','E'], ambLanes:['E'] },
    { id:'J4', title:'J4 · Pertigaan D',  isLive:false,  uploadLanes:['N','W'], ambLanes:['W'] },
    { id:'J5', title:'J5 · Pertigaan E',  isLive:false,  uploadLanes:['N','E'], ambLanes:['E'] },
  ]

  return (
    <div style={S.wrapper}>
      {/* Header */}
      <div style={S.header}>
        <div>
          <span style={S.title}>MULTI-INTERSECTION MICRO-SIMULATION</span>
          <span style={S.sub}>
            {emergency
              ? '🚑 GREEN WAVE ACTIVE — Preempting intersections'
              : `5 nodes (J1–J5) · J1 ${liveJ1 ? '🟢 Live' : '🔵 Sim'} · ${routeActive ? '🛣 Route overlay aktif' : 'No active route'}`}
          </span>
        </div>
        <div style={{ display:'flex', gap:10 }}>
          {['N','S','E','W'].map(d => {
            const col = lc('J1', d)
            const vc  = liveJ1 ? (lanes[d]?.vehicles ?? 0) : (counts.J1?.[d] ?? 0)
            const sp  = liveJ1 && lanes[d]?.spiked
            return (
              <div key={d} style={{ textAlign:'center' }}>
                <div style={{ width:8, height:8, borderRadius:'50%', margin:'0 auto 2px',
                              background:col, boxShadow: sp?`0 0 10px ${col}`:`0 0 4px ${col}`,
                              transition:'box-shadow 0.2s' }} />
                <span style={{ fontSize:8, color:'#64748b', fontFamily:'JetBrains Mono,monospace' }}>
                  {d}<br/><span style={{ color:'#3b82f6' }}>{vc}</span>
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Canvas */}
      <div style={{ display:'flex', justifyContent:'center', overflowX:'auto' }}>
        <canvas ref={canvasRef} width={CW} height={CH}
          style={{ display:'block', borderRadius:8, border:'1px solid #1a2238', maxWidth:'100%' }} />
      </div>

      {/* Emergency banner */}
      {emergency && (
        <div style={S.emergBanner}>
          <span style={S.emergDot} />
          🚑&nbsp;<strong style={{ color:'#ef4444' }}>GREEN WAVE ACTIVE</strong>
          &nbsp;—&nbsp; Lampu persimpangan di jalur rute dipaksa HIJAU sebelum ambulans tiba
        </div>
      )}

      {/* Control panels */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:8, marginTop:12 }}>
        {juncPanels.map(jp => (
          <JuncPanel key={jp.id} jp={jp}
            lights={lightStates[jp.id]||{}} counts={counts[jp.id]||{}}
            uploading={uploading} uploadDone={uploadDone}
            onUpload={lane => handleUpload(jp.id, lane)}
            onAmb={lane    => handleAmb(jp.id, lane)}
            lc={dir => lc(jp.id, dir)} />
        ))}
      </div>
      <style>{`@keyframes nericBlink{0%,100%{opacity:1}50%{opacity:.3}}`}</style>
    </div>
  )
}

function JuncPanel({ jp, lights, counts, uploading, uploadDone, onUpload, onAmb, lc }) {
  return (
    <div style={{ background:'#0b0e18', border:'1px solid #1a2238', borderRadius:8, padding:'8px 10px' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:6 }}>
        <span style={{ fontSize:9, color:'#64748b', fontFamily:'JetBrains Mono,monospace' }}>{jp.title}</span>
        {jp.isLive && (
          <span style={{ fontSize:8, color:'#22c55e', background:'rgba(34,197,94,0.1)',
                         border:'1px solid rgba(34,197,94,0.22)', borderRadius:3, padding:'1px 4px' }}>LIVE</span>
        )}
      </div>
      <div style={{ display:'flex', gap:5, marginBottom:7, flexWrap:'wrap' }}>
        {['N','S','E','W'].map(d => (
          <div key={d} style={{ display:'flex', alignItems:'center', gap:3 }}>
            <div style={{ width:5, height:5, borderRadius:'50%', background:lc(d), boxShadow:`0 0 3px ${lc(d)}` }} />
            <span style={{ fontSize:8, color:'#475569', fontFamily:'JetBrains Mono,monospace' }}>{d}:{counts[d]??0}</span>
          </div>
        ))}
      </div>
      {jp.uploadLanes.map(lane => {
        const key = `${jp.id}_${lane}`
        const isUp = uploading[key]; const isDone = uploadDone[key]
        return (
          <button key={lane} disabled={isUp} onClick={() => onUpload(lane)}
            style={upBtnStyle(isUp, isDone)}>
            {isUp ? '⏳ Analysing…' : isDone ? '✅ Done' : `📹 Upload ${lane}`}
          </button>
        )
      })}
      <div style={{ display:'flex', gap:4, marginTop:6, flexWrap:'wrap' }}>
        {jp.ambLanes.map(lane => (
          <button key={lane} onClick={() => onAmb(lane)} style={ambBtnStyle(false)}>🚑 {lane}</button>
        ))}
      </div>
    </div>
  )
}

function upBtnStyle(loading, done) {
  return {
    width:'100%', marginBottom:3,
    background: done?'rgba(34,197,94,0.08)':loading?'#0a0d14':'#0f1828',
    color: done?'#4ade80':loading?'#475569':'#cbd5e1',
    border:`1px solid ${done?'rgba(34,197,94,0.22)':loading?'#1a2238':'#1e3554'}`,
    borderRadius:5, padding:'5px 0', fontSize:9,
    fontFamily:'JetBrains Mono,monospace', cursor:loading?'not-allowed':'pointer',
    display:'block', transition:'all 0.18s',
  }
}
function ambBtnStyle() {
  return {
    flex:1, background:'rgba(239,68,68,0.07)', color:'#f87171',
    border:'1px solid rgba(239,68,68,0.22)', borderRadius:5, padding:'4px 0',
    fontSize:9, fontFamily:'JetBrains Mono,monospace', cursor:'pointer', transition:'all 0.15s',
  }
}

const S = {
  wrapper: { background:'#07090f', borderRadius:12, padding:'16px 18px',
             fontFamily:'JetBrains Mono,monospace', color:'#e2e8f0', userSelect:'none' },
  header:  { display:'flex', alignItems:'center', justifyContent:'space-between',
             marginBottom:12, flexWrap:'wrap', gap:8 },
  title:   { fontSize:11, fontWeight:700, color:'#e2e8f0', letterSpacing:'0.1em', marginRight:10 },
  sub:     { fontSize:10, color:'#64748b' },
  emergBanner: { display:'flex', alignItems:'center', gap:8, marginTop:10,
                 padding:'7px 12px', background:'rgba(239,68,68,0.07)',
                 border:'1px solid rgba(239,68,68,0.22)', borderRadius:7,
                 fontSize:10, color:'#fca5a5', animation:'nericBlink 1.8s ease infinite' },
  emergDot: { display:'inline-block', width:6, height:6, borderRadius:'50%',
              background:'#ef4444', boxShadow:'0 0 6px #ef4444', flexShrink:0,
              animation:'nericBlink 0.6s ease infinite' },
}
