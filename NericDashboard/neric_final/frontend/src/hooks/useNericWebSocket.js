import { useEffect, useRef, useState, useCallback } from 'react'

// =============================================================
// useNericWebSocket
// =============================================================
// Connect ke WebSocket backend (test_ws.py / main.py).
// Format pesan yang diharapkan dari server (JSON):
//
//   {
//     "type": "tick",
//     "t": 12345,
//     "lanes": {
//       "N": { "potential": 0.72, "vehicles": 8, "light": "red", "spiked": false },
//       "E": { ... }, "S": { ... }, "W": { ... }
//     },
//     "kpi": { "avgWait": 22.1, "processed": 1024, "confidence": 0.91 }
//   }
//
// Jika koneksi gagal, hook mengembalikan `status: 'disconnected'`
// sehingga komponen Dashboard akan fallback ke simulator lokal.
// =============================================================

export function useNericWebSocket({ url, enabled = true } = {}) {
  const [status, setStatus] = useState('idle') // idle | connecting | connected | disconnected | error
  const [message, setMessage] = useState(null)
  const [attempts, setAttempts] = useState(0)
  const wsRef = useRef(null)
  const reconnectTimerRef = useRef(null)
  const enabledRef = useRef(enabled)

  useEffect(() => {
    enabledRef.current = enabled
  }, [enabled])

  const connect = useCallback(() => {
    if (!enabledRef.current || !url) {
      setStatus('idle')
      return
    }

    setStatus('connecting')

    let ws
    try {
      ws = new WebSocket(url)
    } catch (err) {
      console.warn('[NERIC WS] gagal membuat koneksi', err)
      setStatus('error')
      scheduleReconnect()
      return
    }

    wsRef.current = ws

    ws.onopen = () => {
      setStatus('connected')
      setAttempts(0)
    }

    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data)
        setMessage(data)
      } catch (err) {
        // Server mungkin mengirim plain text - abaikan
        console.debug('[NERIC WS] non-JSON message', ev.data)
      }
    }

    ws.onerror = () => {
      setStatus('error')
    }

    ws.onclose = () => {
      setStatus('disconnected')
      scheduleReconnect()
    }
  }, [url])

  const scheduleReconnect = useCallback(() => {
    if (!enabledRef.current) return
    clearTimeout(reconnectTimerRef.current)
    setAttempts((a) => {
      const next = a + 1
      // Exponential backoff: 1s, 2s, 4s, 8s ... max 10s
      const delay = Math.min(10000, 1000 * Math.pow(2, Math.min(a, 4)))
      reconnectTimerRef.current = setTimeout(() => connect(), delay)
      return next
    })
  }, [connect])

  useEffect(() => {
    if (enabled) {
      connect()
    } else {
      // Cleanup saat di-disable
      clearTimeout(reconnectTimerRef.current)
      if (wsRef.current && wsRef.current.readyState <= 1) {
        wsRef.current.close()
      }
      setStatus('idle')
    }

    return () => {
      clearTimeout(reconnectTimerRef.current)
      if (wsRef.current && wsRef.current.readyState <= 1) {
        wsRef.current.close()
      }
    }
  }, [enabled, connect])

  const send = useCallback((payload) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(typeof payload === 'string' ? payload : JSON.stringify(payload))
      return true
    }
    return false
  }, [])

  return { status, message, attempts, send }
}
