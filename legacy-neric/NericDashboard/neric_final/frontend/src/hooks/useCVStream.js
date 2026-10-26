// =============================================================
// useCVStream — NERIC v3 Upgraded
// =============================================================
// Upgrade:
//   • Handles 'ambulance_spawn' event → trigger ambulance di CityGrid
//   • Exposes cvLif state: { N:{potential,spiked}, E, S, W }
//     → dikirim ke Dashboard → di-merge ke history → BrainActivity chart hidup
//   • Reconnect backoff tetap sama
// =============================================================
import { useEffect, useRef, useState, useCallback } from 'react'
import { CV_BACKEND_WS_URL, LANES } from '../lib/constants'

export function useCVStream({ enabled = true, url = CV_BACKEND_WS_URL, onDetection, onAmbulanceSpawn } = {}) {
  const [status,      setStatus]      = useState('disconnected')
  const [lastEvent,   setLastEvent]   = useState(null)
  const [activeJob,   setActiveJob]   = useState(null)
  const [modelLoaded, setModelLoaded] = useState(false)
  // LIF state dari backend YOLO — bentuk: { N:{potential,spiked}, E, S, W }
  const [cvLif,       setCvLif]       = useState(null)

  const wsRef      = useRef(null)
  const retryRef   = useRef(null)
  const retryCount = useRef(0)
  const mountedRef = useRef(true)

  const connect = useCallback(() => {
    if (!enabled || !mountedRef.current) return
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    setStatus('connecting')
    try {
      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.onopen = () => {
        if (!mountedRef.current) return
        setStatus('connected')
        retryCount.current = 0
        console.log('[CV Stream] Connected →', url)
      }

      ws.onmessage = (evt) => {
        if (!mountedRef.current) return
        try {
          const payload = JSON.parse(evt.data)
          setLastEvent(payload)

          switch (payload.type) {
            case 'connected':
              setModelLoaded(payload.model_loaded ?? false)
              break

            case 'job_start':
              setActiveJob({
                job_id:  payload.job_id,
                node_id: payload.node_id,
                lane:    payload.lane,
                progress: 0,
              })
              break

            case 'detection':
              setActiveJob(prev => prev ? { ...prev, progress: payload.progress ?? 0 } : null)
              // ── Sync LIF from backend YOLO ──────────────────────
              if (payload.lif) {
                setCvLif(payload.lif)
              }
              if (typeof onDetection === 'function') onDetection(payload)
              break

            case 'ambulance_spawn':
              // Forward ambulance spawn event to CityGrid / MicroSimulationBoard
              if (typeof onAmbulanceSpawn === 'function') onAmbulanceSpawn(payload)
              break

            case 'job_complete':
            case 'job_stopped':
              setActiveJob(null)
              break

            case 'heartbeat':
              break

            default:
              break
          }
        } catch {
          // ignore malformed
        }
      }

      ws.onerror = () => { if (mountedRef.current) setStatus('error') }

      ws.onclose = () => {
        if (!mountedRef.current) return
        setStatus('disconnected')
        wsRef.current = null
        if (enabled) {
          const delay = Math.min(1500 * Math.pow(1.6, retryCount.current), 30000)
          retryCount.current++
          retryRef.current = setTimeout(connect, delay)
        }
      }
    } catch (err) {
      setStatus('error')
      console.error('[CV Stream] Error:', err)
    }
  }, [enabled, url, onDetection, onAmbulanceSpawn])

  useEffect(() => {
    mountedRef.current = true
    if (enabled) connect()
    return () => {
      mountedRef.current = false
      clearTimeout(retryRef.current)
      wsRef.current?.close()
    }
  }, [connect, enabled])

  const uploadVideo = useCallback(async (file, lane, nodeId) => {
    const form = new FormData()
    form.append('file',    file)
    form.append('lane',    lane)
    form.append('node_id', nodeId)
    try {
      const resp = await fetch('/cv/upload', { method: 'POST', body: form })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      return await resp.json()
    } catch (err) {
      console.error('[CV Stream] Upload error:', err)
      return null
    }
  }, [])

  const stopJob = useCallback(async () => {
    try { await fetch('/cv/stop', { method: 'POST' }) } catch { /* ignore */ }
  }, [])

  // Spawn ambulance via backend REST (triggers broadcast to all WS clients)
  const spawnAmbulance = useCallback(async (originNode = 'INT_C', lane = 'W') => {
    try {
      const form = new FormData()
      form.append('origin_node', originNode)
      form.append('dest_node',   'ENTRY_HOSPITAL')
      form.append('lane',        lane)
      await fetch('/cv/spawn_ambulance', { method: 'POST', body: form })
    } catch (err) {
      console.error('[CV Stream] Spawn ambulance error:', err)
    }
  }, [])

  return {
    status,
    modelLoaded,
    lastEvent,
    activeJob,
    cvLif,          // { N:{potential,spiked}, E, S, W } — from real YOLO counts
    uploadVideo,
    stopJob,
    spawnAmbulance,
  }
}
