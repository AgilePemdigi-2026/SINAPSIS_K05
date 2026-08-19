// =============================================================
// NERIC v3 — Constants & Configuration
// =============================================================

export const LANES = ['N', 'E', 'S', 'W']
export const LANE_LABEL = { N: 'North', E: 'East', S: 'South', W: 'West' }

export const LANE_COLORS = {
  dark: { N: '#60a5fa', E: '#a78bfa', S: '#34d399', W: '#f59e0b' },
  light: { N: '#2563eb', E: '#7c3aed', S: '#059669', W: '#d97706' },
}

export const REALISTIC_VEHICLE_COLORS = [
  '#e5e7eb','#94a3b8','#1e293b','#475569','#0f172a',
  '#7f1d1d','#1e40af','#365314','#78350f','#cbd5e1','#334155',
]

export const LIF_CONFIG = {
  threshold: 1.0,
  decay: 0.92,
  refractoryTicks: 8,
  baselineNoise: 0.015,
  windowSize: 120,
}

export const SIM_MODES = [
  { id: 'normal',     label: 'Normal',     description: 'Adaptive density-first routing' },
  { id: 'rush',       label: 'Rush Hour',  description: 'High demand on all approaches' },
  { id: 'imbalanced', label: 'Imbalanced', description: 'Asymmetric demand pattern' },
  { id: 'emergency',  label: 'Emergency',  description: 'Ambulance pre-emption active' },
]

export const MODE_PROFILES = {
  normal:     { N: 0.18, E: 0.16, S: 0.20, W: 0.17, variance: 0.06 },
  rush:       { N: 0.35, E: 0.38, S: 0.34, W: 0.36, variance: 0.10 },
  imbalanced: { N: 0.45, E: 0.10, S: 0.13, W: 0.12, variance: 0.08 },
  emergency:  { N: 0.22, E: 0.20, S: 0.24, W: 0.21, variance: 0.07 },
}

export const WS_DEFAULT_URL    = 'ws://localhost:8000/ws/brain'
export const API_DEFAULT_BASE  = '/api'
export const NERIC_API_BASE_URL = ''

// CV Backend
export const CV_BACKEND_WS_URL  = 'ws://localhost:8001/ws/cv'
export const CV_BACKEND_REST_URL = '/cv'   // via Vite proxy → localhost:8001/api/cv

export const AMBULANCE_LANE = 'W'

// =============================================================
// CITY GRID — 5-node topology
// Used by CityGrid.jsx canvas renderer
// =============================================================

// Canvas logical dimensions (CSS pixels, canvas will scale)
export const CANVAS_W = 1100
export const CANVAS_H = 580

// Road visual config
export const ROAD_WIDTH = 44         // total road width px
export const LANE_W     = 18         // one-way lane width
export const ROAD_COLOR_DARK  = '#1e293b'   // dark mode asphalt
export const ROAD_COLOR_LIGHT = '#94a3b8'   // light mode asphalt
export const MARKING_COLOR    = '#fbbf24'   // lane marking yellow

// Intersection/T-junction box size
export const NODE_SIZE = 50

// 5 Real Nodes
// type: 'intersection' (4-way) | 'tjunction' (3-way)
export const CITY_NODES = {
  INT_A: {
    id: 'INT_A', label: 'Perempatan A',
    x: 270, y: 255, type: 'intersection',
    exits: ['N','E','S','W'],           // all 4 directions
  },
  INT_B: {
    id: 'INT_B', label: 'Perempatan B',
    x: 600, y: 255, type: 'intersection',
    exits: ['N','E','S','W'],
  },
  INT_C: {
    id: 'INT_C', label: 'Perempatan C',
    x: 930, y: 255, type: 'intersection',
    exits: ['N','E','S','W'],
  },
  TJUNC_D: {
    id: 'TJUNC_D', label: 'Pertigaan D',
    x: 270, y: 440, type: 'tjunction',
    exits: ['N','E','W'],               // no South exit
  },
  TJUNC_E: {
    id: 'TJUNC_E', label: 'Pertigaan E',
    x: 600, y: 440, type: 'tjunction',
    exits: ['N','W','E'],               // no South exit
  },
}

// Virtual entry/exit points (edges of the canvas)
// These are NOT real nodes — just spawners/sinks for vehicles
export const ENTRY_POINTS = {
  ENTRY_HOSPITAL: { x: 60,   y: 255, label: 'Hospital (West)' },   // West of INT_A
  ENTRY_NA:       { x: 270,  y: 60,  label: 'North A' },
  ENTRY_NB:       { x: 600,  y: 60,  label: 'North B' },
  ENTRY_NC:       { x: 930,  y: 60,  label: 'North C' },
  ENTRY_AMB:      { x: 1080, y: 255, label: 'East (Amb Origin)' }, // East of INT_C
  EXIT_SC:        { x: 930,  y: 530, label: 'South C' },
  EXIT_WD:        { x: 60,   y: 440, label: 'West D' },
  EXIT_EE:        { x: 810,  y: 440, label: 'East E' },
}

// Road segments — each defines a one-directional lane path
// from / to: node id (CITY_NODES key or ENTRY_POINTS key)
// laneOffsetX, laneOffsetY: perpendicular offset for this lane (keeps lanes separated)
// approachDir: from which direction does this lane approach the 'to' node?
// (used for traffic light lookup at 'to' node)
export const ROAD_SEGMENTS = [
  // === MAIN E-W HIGHWAY ===
  // Westbound (right side of road = bottom lane)
  { id:'HOSP_to_A', from:'ENTRY_HOSPITAL', to:'INT_A', laneOY:+10, approachDir:'W' },
  { id:'A_to_HOSP', from:'INT_A', to:'ENTRY_HOSPITAL', laneOY:-10, approachDir:null },
  { id:'A_to_B',    from:'INT_A', to:'INT_B',          laneOY:+10, approachDir:'W' },
  { id:'B_to_A',    from:'INT_B', to:'INT_A',          laneOY:-10, approachDir:'E' },
  { id:'B_to_C',    from:'INT_B', to:'INT_C',          laneOY:+10, approachDir:'W' },
  { id:'C_to_B',    from:'INT_C', to:'INT_B',          laneOY:-10, approachDir:'E' },
  { id:'C_to_AMB',  from:'INT_C', to:'ENTRY_AMB',      laneOY:+10, approachDir:null },
  { id:'AMB_to_C',  from:'ENTRY_AMB', to:'INT_C',      laneOY:-10, approachDir:'E' },

  // === NORTH VERTICALS ===
  { id:'NA_to_A',   from:'ENTRY_NA', to:'INT_A',  laneOX:+10, approachDir:'N' },
  { id:'A_to_NA',   from:'INT_A', to:'ENTRY_NA',  laneOX:-10, approachDir:null },
  { id:'NB_to_B',   from:'ENTRY_NB', to:'INT_B',  laneOX:+10, approachDir:'N' },
  { id:'B_to_NB',   from:'INT_B', to:'ENTRY_NB',  laneOX:-10, approachDir:null },
  { id:'NC_to_C',   from:'ENTRY_NC', to:'INT_C',  laneOX:+10, approachDir:'N' },
  { id:'C_to_NC',   from:'INT_C', to:'ENTRY_NC',  laneOX:-10, approachDir:null },

  // === SOUTH VERTICALS: intersections → T-junctions ===
  { id:'A_to_D',    from:'INT_A',   to:'TJUNC_D', laneOX:+10, approachDir:'N' },
  { id:'D_to_A',    from:'TJUNC_D', to:'INT_A',   laneOX:-10, approachDir:'S' },
  { id:'B_to_E',    from:'INT_B',   to:'TJUNC_E', laneOX:+10, approachDir:'N' },
  { id:'E_to_B',    from:'TJUNC_E', to:'INT_B',   laneOX:-10, approachDir:'S' },

  // === SOUTH EXITS from INT_C ===
  { id:'C_to_SC',   from:'INT_C',   to:'EXIT_SC', laneOX:+10, approachDir:null },
  { id:'SC_to_C',   from:'EXIT_SC', to:'INT_C',   laneOX:-10, approachDir:'S' },

  // === E-W LOWER: TJUNC_D ↔ TJUNC_E ===
  { id:'D_to_E',    from:'TJUNC_D', to:'TJUNC_E', laneOY:+10, approachDir:'W' },
  { id:'E_to_D',    from:'TJUNC_E', to:'TJUNC_D', laneOY:-10, approachDir:'E' },

  // === WEST EXIT of TJUNC_D ===
  { id:'D_to_WD',   from:'TJUNC_D', to:'EXIT_WD', laneOY:-10, approachDir:null },
  { id:'WD_to_D',   from:'EXIT_WD', to:'TJUNC_D', laneOY:+10, approachDir:'W' },

  // === EAST EXIT of TJUNC_E ===
  { id:'E_to_EE',   from:'TJUNC_E', to:'EXIT_EE', laneOY:+10, approachDir:null },
  { id:'EE_to_E',   from:'EXIT_EE', to:'TJUNC_E', laneOY:-10, approachDir:'E' },
]

// Adjacency: for each node, which segments leave from it and what exit direction?
// Used by vehicle routing to pick next segment at intersections
export const NODE_EXITS = {
  INT_A:   ['A_to_HOSP','A_to_B','A_to_NA','A_to_D'],
  INT_B:   ['B_to_A','B_to_C','B_to_NB','B_to_E'],
  INT_C:   ['C_to_B','C_to_AMB','C_to_NC','C_to_SC'],
  TJUNC_D: ['D_to_A','D_to_E','D_to_WD'],
  TJUNC_E: ['E_to_B','E_to_D','E_to_EE'],
}

// Ambulance Dijkstra graph (simplified — node distances in canvas px)
// Path: ENTRY_AMB → INT_C → INT_B → INT_A → ENTRY_HOSPITAL
export const AMBULANCE_GRAPH = {
  nodes: {
    ENTRY_AMB:      { x: 1080, y: 255, label: 'Asal Ambulans (Timur)' },
    INT_C:          { x: 930,  y: 255, label: 'Perempatan C' },
    INT_B:          { x: 600,  y: 255, label: 'Perempatan B' },
    INT_A:          { x: 270,  y: 255, label: 'Perempatan A' },
    ENTRY_HOSPITAL: { x: 60,   y: 255, label: 'Rumah Sakit (Barat)' },
    TJUNC_E:        { x: 600,  y: 440, label: 'Pertigaan E' },
    TJUNC_D:        { x: 270,  y: 440, label: 'Pertigaan D' },
  },
  edges: [
    ['ENTRY_AMB','INT_C', 150],
    ['INT_C','INT_B', 330],
    ['INT_B','INT_A', 330],
    ['INT_A','ENTRY_HOSPITAL', 210],
    // Alternate (lower road)
    ['INT_C','TJUNC_E', 200],
    ['TJUNC_E','TJUNC_D', 330],
    ['TJUNC_D','INT_A', 185],
    ['TJUNC_E','INT_B', 185],
    ['TJUNC_D','INT_A', 185],
  ],
}

export const FIXED_TIMER_BASELINE_WAIT = 48

// Road network for Leaflet emergency map (kept from v2)
export const ROAD_NETWORK = {
  nodes: {
    A: { name: 'Incident Origin · Jl. Tunjungan',    lat: -7.2566, lng: 112.7377, type: 'origin' },
    B: { name: 'Tunjungan × Embong Malang',          lat: -7.2598, lng: 112.7402 },
    C: { name: 'Pemuda × Tunjungan',                 lat: -7.2622, lng: 112.7425 },
    D: { name: 'Yos Sudarso × Pemuda',               lat: -7.2640, lng: 112.7456 },
    E: { name: 'Gubeng Pojok',                       lat: -7.2660, lng: 112.7495 },
    F: { name: 'Raya Gubeng × Sumatra',              lat: -7.2675, lng: 112.7533 },
    G: { name: 'RSUD Dr. Soetomo',                   lat: -7.2680, lng: 112.7575, type: 'destination' },
    H: { name: 'Tegalsari Hub',                      lat: -7.2620, lng: 112.7350 },
    I: { name: 'Embong Sawo Junction',               lat: -7.2592, lng: 112.7448 },
    J: { name: 'Gentengkali × Praban',               lat: -7.2540, lng: 112.7406 },
    K: { name: 'Gemblongan Crossing',                lat: -7.2540, lng: 112.7470 },
    L: { name: 'Walikota × Sedap Malam',             lat: -7.2710, lng: 112.7500 },
    M: { name: 'Diponegoro × Pandegiling',           lat: -7.2730, lng: 112.7440 },
  },
  edges: [
    ['A','B',0.35],['B','C',0.30],['C','D',0.38],['D','E',0.45],['E','F',0.42],['F','G',0.45],
    ['A','J',0.55],['J','K',0.65],['K','B',0.80],['K','I',0.50],['I','C',0.30],['I','D',0.55],
    ['A','H',0.45],['H','J',0.55],['H','M',0.95],['L','E',0.55],['L','F',0.40],['L','G',0.65],
    ['L','M',0.60],['M','F',0.85],
  ],
}
