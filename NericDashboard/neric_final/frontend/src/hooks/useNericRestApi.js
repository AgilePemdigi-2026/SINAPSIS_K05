import { useEffect, useRef, useState } from 'react'
import { LANES } from '../lib/constants'

/* =============================================================
   useNericRestApi
   -------------------------------------------------------------
   Hook untuk koneksi ke NERIC Backend FastAPI via REST.
   Endpoint: POST <baseUrl>/api/decide

   CORS BYPASS — DUA MODE:
   ─────────────────────────────────────────────
   Mode 1: PROXY (DEFAULT, paling aman & gampang)
     baseUrl = ''  (kosong)  →  fetch('/api/decide')
     → Vite dev server forward ke ngrok (lihat vite.config.js)
     → BROWSER ANGGAP SAME-ORIGIN → no CORS error
     → URL ngrok diatur di vite.config.js, bukan di sini

   Mode 2: DIRECT (kalau backend sudah aktifkan CORS)
     baseUrl = 'https://....ngrok-free.dev'
     → fetch langsung dari browser ke ngrok
     → Butuh CORS middleware di FastAPI temanmu
   ─────────────────────────────────────────────

   Mapping lane (sesuai NERIC CV Guide hal. 3-4):
     0 = Utara  → N
     1 = Selatan → S
     2 = Timur  → E
     3 = Barat  → W
   ============================================================= */

const BACKEND_LANE_TO_DASHBOARD = ['N', 'S', 'E', 'W']

// DEBUG MODE — set ke true untuk lihat log fetch di console browser
const DEBUG = true

function log(...args) {
  if (DEBUG) console.log('%c[NERIC API]', 'color:#2563eb;font-weight:bold', ...args)
}
function logErr(...args) {
  if (DEBUG) console.error('%c[NERIC API]', 'color:#dc2626;font-weight:bold', ...args)
}

export function useNericRestApi({
  baseUrl,           // '' (proxy) atau full URL (direct)
  enabled = true,
  pollMs = 2000,
  mode = 'normal',
  fallbackLanes,
}) {
  const [status, setStatus] = useState('idle')
  const [message, setMessage] = useState(null)
  const [error, setError] = useState(null)
  const [lastCycle, setLastCycle] = useState(null)

  const baseUrlRef = useRef(baseUrl)
  const modeRef = useRef(mode)
  const fallbackLanesRef = useRef(fallbackLanes)
  const inflightRef = useRef(false)
  const consecutiveErrorsRef = useRef(0)

  useEffect(() => { baseUrlRef.current = baseUrl }, [baseUrl])
  useEffect(() => { modeRef.current = mode }, [mode])
  useEffect(() => { fallbackLanesRef.current = fallbackLanes }, [fallbackLanes])

  useEffect(() => {
    if (!enabled) {
      setStatus('idle')
      return undefined
    }

    let cancelled = false
    setStatus('connecting')
    log('Starting REST API polling, mode:', baseUrl ? 'DIRECT' : 'PROXY (via Vite)')

    const fetchOnce = async () => {
      if (inflightRef.current) return
      inflightRef.current = true

      try {
        // Build vehicle_counts dari simulator (4 lane: N, S, E, W)
        const lanes = fallbackLanesRef.current || {}
        const vehicle_counts = BACKEND_LANE_TO_DASHBOARD.map((k) => {
          const v = lanes[k]?.vehicles ?? 0
          return Math.min(20, Math.max(0, Math.round(v)))
        })

        const scenarioMap = {
          normal: 'NORMAL',
          rushhour: 'RUSH_HOUR',
          imbalanced: 'IMBALANCED',
          emergency: 'EMERGENCY',
        }
        const scenario = scenarioMap[modeRef.current] || 'CUSTOM'

        // === Build URL ===
        // Kalau baseUrl kosong → relative path → Vite proxy
        // Kalau baseUrl ada → langsung ke ngrok
        const base = baseUrlRef.current ? baseUrlRef.current.replace(/\/$/, '') : ''
        const url = `${base}/api/decide`

        log(`POST ${url}`, { vehicle_counts, scenario })

        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), 4500)

        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'ngrok-skip-browser-warning': 'true',
            'Accept': 'application/json',
          },
          body: JSON.stringify({
            vehicle_counts,
            scenario,
            simulated_hour: new Date().getHours(),
          }),
          signal: ctrl.signal,
          mode: 'cors',
        })
        clearTimeout(timer)

        if (cancelled) return

        if (!res.ok) {
          const text = await res.text().catch(() => '')
          throw new Error(`HTTP ${res.status} — ${text.slice(0, 100)}`)
        }

        // Cek content-type → kalau bukan JSON, kemungkinan ngrok interstitial
        const contentType = res.headers.get('content-type') || ''
        if (!contentType.includes('application/json')) {
          const text = await res.text()
          throw new Error(
            `Non-JSON response (got ${contentType}). Kemungkinan ngrok interstitial atau CORS block. First 200 chars: ${text.slice(0, 200)}`,
          )
        }

        const data = await res.json()
        if (cancelled) return

        log('Response cycle', data.cycle, '— emergency:', data.emergency)

        const mapped = transformResponse(data)
        setMessage(mapped)
        setLastCycle(data.cycle ?? null)
        setError(null)
        setStatus('connected')
        consecutiveErrorsRef.current = 0
      } catch (e) {
        if (cancelled) return
        consecutiveErrorsRef.current += 1
        const errMsg = e?.name === 'AbortError'
          ? 'Backend timeout (>4.5 detik)'
          : e?.message || 'Backend offline'
        logErr('Fetch failed:', errMsg)

        // Hint berdasarkan jenis error
        if (errMsg.includes('Failed to fetch') || errMsg.includes('NetworkError')) {
          logErr('Kemungkinan penyebab:')
          logErr('  1. Backend ngrok mati (cek ngrok di komputer temanmu)')
          logErr('  2. CORS blocked (suruh teman tambah CORS middleware ke FastAPI)')
          logErr('  3. URL salah (cek vite.config.js NERIC_BACKEND_URL)')
        }

        setStatus('error')
        setError(errMsg)
      } finally {
        inflightRef.current = false
      }
    }

    fetchOnce()
    const id = setInterval(fetchOnce, pollMs)

    return () => {
      cancelled = true
      clearInterval(id)
      log('Stopped polling')
    }
  }, [enabled, baseUrl, pollMs])

  return { status, message, error, lastCycle }
}

/* -------------------------------------------------------------
   transformResponse
   ------------------------------------------------------------- */
function transformResponse(data) {
  if (!data || !data.decisions) return { lanes: null, kpi: null }

  const lanes = {}
  let totalVehicles = 0
  let activeLane = null
  let highestRank = Infinity
  let sumPotential = 0
  let countLanes = 0

  for (const laneIdStr of Object.keys(data.decisions)) {
    const laneId = parseInt(laneIdStr, 10)
    const dashKey = BACKEND_LANE_TO_DASHBOARD[laneId]
    if (!dashKey) continue

    const d = data.decisions[laneIdStr]
    const signal = (d.signal || 'RED').toUpperCase()
    const light = signal === 'GREEN' ? 'green' : signal === 'YELLOW' ? 'yellow' : 'red'
    const vehicles = Number(d.vehicle_count ?? 0)
    const potential = Number(d.membrane_potential ?? 0)

    lanes[dashKey] = {
      vehicles,
      potential,
      light,
      spiked: !!d.spike,
      greenDuration: Number(d.green_duration ?? 0),
      priorityRank: Number(d.priority_rank ?? 0),
      trend: d.trend || 'STABIL',
      laneName: d.lane_name || '',
    }

    totalVehicles += vehicles
    sumPotential += potential
    countLanes += 1

    if (light === 'green' && d.priority_rank && d.priority_rank < highestRank) {
      highestRank = d.priority_rank
      activeLane = dashKey
    }
  }

  for (const k of LANES) {
    if (!lanes[k]) {
      lanes[k] = {
        vehicles: 0, potential: 0, light: 'red', spiked: false,
        greenDuration: 0, priorityRank: 0, trend: 'STABIL', laneName: k,
      }
    }
  }

  const avgPotential = countLanes > 0 ? sumPotential / countLanes : 0
  const confidence = Math.min(0.99, 0.55 + avgPotential * 0.4)

  const kpi = {
    avgWait: data.avg_wait_time ?? estimateWaitFromVehicles(totalVehicles),
    processed: data.total_processed ?? totalVehicles,
    confidence,
    emergencyActive: !!data.emergency,
    activeLane,
    cycle: data.cycle ?? null,
    period: data.period || '',
    threshold: data.threshold ?? null,
  }

  return { lanes, kpi }
}

function estimateWaitFromVehicles(total) {
  return Math.max(8, Math.min(60, 12 + total * 0.6))
}
