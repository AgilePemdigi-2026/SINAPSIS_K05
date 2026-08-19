import { useEffect, useRef, useState, useCallback } from 'react'
import {
  LANES,
  LIF_CONFIG,
  MODE_PROFILES,
  FIXED_TIMER_BASELINE_WAIT,
  AMBULANCE_LANE,
} from '../lib/constants'

// =============================================================
// useNericSimulator — NERIC v3 Fixed
// =============================================================
// BUG FIX: history points sekarang menyimpan struktur
//   { t, N: { potential, spiked }, E: {...}, S: {...}, W: {...} }
// agar BrainActivity.jsx bisa mengakses p[ln].potential & p[ln].spiked
// dengan benar (sebelumnya hanya angka primitif).
// =============================================================

function initLanes() {
  return Object.fromEntries(
    LANES.map((l) => [
      l,
      {
        potential: 0.15 + Math.random() * 0.2,
        vehicles: Math.floor(2 + Math.random() * 6),
        light: 'red',
        refractory: 0,
        greenDuration: 0,
        spiked: false,
        servedTotal: 0,
      },
    ]),
  )
}

export function useNericSimulator({ running = true, mode = 'normal', tickMs = 280 } = {}) {
  const [lanes, setLanes]     = useState(initLanes)
  const [history, setHistory] = useState([])
  const [kpi, setKpi]         = useState({
    avgWait: FIXED_TIMER_BASELINE_WAIT * 0.55,
    processed: 0,
    confidence: 0.86,
    mode,
    emergencyActive: false,
    activeLane: null,
  })

  const tickRef = useRef(0)

  const reset = useCallback(() => {
    tickRef.current = 0
    setLanes(initLanes())
    setHistory([])
  }, [])

  useEffect(() => {
    if (!running) return undefined

    const profile    = MODE_PROFILES[mode] || MODE_PROFILES.normal
    const isEmergency = mode === 'emergency'

    const intervalId = setInterval(() => {
      tickRef.current += 1
      const t = tickRef.current

      setLanes((prev) => {
        const next = {}
        for (const l of LANES) next[l] = { ...prev[l] }

        // ── 1) Arrivals + LIF potential ──────────────────────────
        for (const lane of LANES) {
          const cur     = next[lane]
          const baseRate = profile[lane]
          const variance = profile.variance
          const arrival  = Math.max(0, baseRate + (Math.random() - 0.5) * variance * 2)

          if (Math.random() < arrival * 1.8) {
            cur.vehicles = Math.min(40, cur.vehicles + Math.floor(1 + Math.random() * 2))
          }

          // LIF update — potential naik dengan arrival, leak dengan decay
          cur.potential =
            cur.potential * LIF_CONFIG.decay +
            arrival * 0.18 +                          // scale agar range 0–1.2
            cur.vehicles * 0.005 +                    // vehicle pressure
            (Math.random() - 0.5) * LIF_CONFIG.baselineNoise

          cur.potential = Math.max(0, Math.min(1.4, cur.potential))
          cur.spiked    = false
        }

        // ── 2) Process active green lane ─────────────────────────
        let activeGreen = LANES.find((l) => next[l].refractory > 0) || null

        if (activeGreen) {
          const cur = next[activeGreen]
          cur.refractory -= 1
          cur.light = cur.refractory <= 1 ? 'yellow' : 'green'

          const flow = Math.min(cur.vehicles, 2 + Math.floor(Math.random() * 2))
          cur.vehicles    = Math.max(0, cur.vehicles - flow)
          cur.servedTotal += flow
          cur.potential   = Math.max(0, cur.potential * 0.82)

          if (cur.refractory <= 0) {
            cur.light       = 'red'
            cur.greenDuration = 0
            activeGreen     = null
          }
        }

        for (const l of LANES) {
          if (l !== activeGreen) next[l].light = 'red'
        }

        // ── 3) Elect next green ───────────────────────────────────
        if (!activeGreen) {
          let winner = null

          if (isEmergency) {
            winner = AMBULANCE_LANE
          } else {
            let maxScore = -1
            for (const lane of LANES) {
              const v     = next[lane].vehicles
              const p     = next[lane].potential
              const score = v * 1.0 + p * 8 + Math.random() * 0.5
              if (score > maxScore) { maxScore = score; winner = lane }
            }
          }

          if (winner !== null) {
            const v = next[winner].vehicles
            const baseDur = isEmergency ? 14 : 6 + Math.min(12, v * 0.5)
            next[winner].refractory   = Math.round(baseDur)
            next[winner].greenDuration = Math.round(baseDur)
            next[winner].light        = 'green'
            next[winner].spiked       = true   // spike event
            next[winner].potential    = 0.1    // reset after spike
            activeGreen               = winner
          }
        }

        // ── 4) History — FIXED STRUCTURE ─────────────────────────
        // Each point: { t, N:{potential,spiked}, E:{...}, S:{...}, W:{...} }
        // BrainActivity accesses p[ln].potential and p[ln].spiked
        setHistory((h) => {
          const point = { t }
          for (const ln of LANES) {
            point[ln] = {
              potential: Number(next[ln].potential.toFixed(4)),
              spiked:    next[ln].spiked,
            }
          }
          const updated = [...h, point]
          // Keep last windowSize points
          return updated.length > LIF_CONFIG.windowSize
            ? updated.slice(updated.length - LIF_CONFIG.windowSize)
            : updated
        })

        // ── 5) KPI ────────────────────────────────────────────────
        setKpi((prevKpi) => {
          const processedAdd = LANES.reduce(
            (sum, l) => sum + (next[l].light === 'green' ? Math.floor(Math.random() * 2 + 1) : 0),
            0,
          )
          const targetConf =
            mode === 'imbalanced' ? 0.81 :
            mode === 'rush'       ? 0.84 :
            isEmergency           ? 0.95 : 0.91
          const confidence =
            prevKpi.confidence * 0.94 + targetConf * 0.06 + (Math.random() - 0.5) * 0.008

          const aiFactor =
            mode === 'rush'       ? 0.62 :
            mode === 'imbalanced' ? 0.58 :
            isEmergency           ? 0.40 : 0.45
          const targetWait = FIXED_TIMER_BASELINE_WAIT * aiFactor
          const avgWait    =
            prevKpi.avgWait * 0.93 + targetWait * 0.07 + (Math.random() - 0.5) * 0.7

          return {
            avgWait,
            processed: prevKpi.processed + processedAdd,
            confidence,
            mode,
            emergencyActive: isEmergency,
            activeLane: activeGreen,
          }
        })

        return next
      })
    }, tickMs)

    return () => clearInterval(intervalId)
  }, [running, mode, tickMs])

  return { lanes, history, kpi, reset, tick: tickRef.current }
}
