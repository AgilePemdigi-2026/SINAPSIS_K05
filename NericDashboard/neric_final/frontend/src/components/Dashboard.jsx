// =============================================================
// Dashboard.jsx — NERIC v3 Final (All Bugs Fixed)
// =============================================================
// Changes from previous version:
//  1. merged.history now merges cvLif from backend into history points
//     → BrainActivity chart receives real fluctuating LIF data
//  2. onAmbulanceSpawn forwarded from useCVStream → CityGrid / MSB
//  3. cv.spawnAmbulance exposed to ControlDeck
// =============================================================

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Map as MapIcon, BarChart3, Grid3x3, Activity, Video } from 'lucide-react'

import { Header }              from './Header'
import { ControlDeck }         from './ControlDeck'
import { KPICards }            from './KPICards'
import { CityGrid }            from './CityGrid'
import { BrainActivity }       from './BrainActivity'
import { EmergencyMap }        from './EmergencyMap'
import { HistoricalAnalytics } from './HistoricalAnalytics'
import { VideoUpload }         from './VideoUpload'
import { MicroSimulationBoard } from './MicroSimulationBoard'

import { useTheme }          from '../hooks/useTheme'
import { useNericSimulator } from '../hooks/useNericSimulator'
import { useNericWebSocket } from '../hooks/useNericWebSocket'
import { useNericRestApi }   from '../hooks/useNericRestApi'
import { useCVStream }       from '../hooks/useCVStream'

import { WS_DEFAULT_URL, NERIC_API_BASE_URL, LANES, LIF_CONFIG } from '../lib/constants'
import { cn } from '../lib/cn'

export function Dashboard() {
  const { theme, toggle, isDark } = useTheme()

  const [online,    setOnline]    = useState(true)
  const [mode,      setMode]      = useState('normal')
  const [wsUrl]                   = useState(WS_DEFAULT_URL)
  const [apiUrl]                  = useState(NERIC_API_BASE_URL)
  const [activeTab, setActiveTab] = useState('sim')

  // CV-detected vehicle counts per node (for CityGrid spawn)
  const [cvCounts, setCvCounts] = useState(null)

  // Ambulance spawn event from CV backend broadcast
  const [ambSpawnEvent, setAmbSpawnEvent] = useState(null)

  // ── Local simulator (always running as fallback) ───────────
  const sim = useNericSimulator({ running: online, mode, tickMs: 280 })

  // ── REST API → NERIC Brain ────────────────────────────────
  const api = useNericRestApi({
    baseUrl: apiUrl,
    enabled: online && !!apiUrl,
    pollMs: 2000,
    mode,
    fallbackLanes: sim.lanes,
  })

  // ── WebSocket fallback ─────────────────────────────────────
  const ws = useNericWebSocket({ url: wsUrl, enabled: online })

  // ── CV Backend WebSocket ───────────────────────────────────
  const handleCVDetection = useCallback((payload) => {
    if (payload.node_id && payload.lane_counts) {
      setCvCounts({
        nodeId:   payload.node_id,
        counts:   payload.lane_counts,
        eventKey: `${payload.node_id}_${payload.frame}_${Date.now()}`,
      })
    }
  }, [])

  const handleAmbSpawn = useCallback((payload) => {
    setAmbSpawnEvent({ ...payload, key: Date.now() })
  }, [])

  const cv = useCVStream({
    enabled: true,
    onDetection:     handleCVDetection,
    onAmbulanceSpawn: handleAmbSpawn,
  })

  // ── Merged state — 3-tier priority ────────────────────────
  const merged = useMemo(() => {
    // Base lanes & history from simulator or API
    let baseLanes, baseHistory

    if (api.status === 'connected' && api.message?.lanes) {
      baseLanes   = api.message.lanes
      baseHistory = sim.history
    } else if (ws.status === 'connected' && ws.message?.lanes) {
      const wsLanes = {}
      for (const k of Object.keys(ws.message.lanes)) {
        wsLanes[k] = { potential:0, vehicles:0, light:'red', spiked:false, ...ws.message.lanes[k] }
      }
      baseLanes   = wsLanes
      baseHistory = sim.history
    } else {
      baseLanes   = sim.lanes
      baseHistory = sim.history
    }

    // ── Merge cvLif into history if CV backend is sending real data ──
    // When CV backend has a live job, the last history point's potentials
    // are overridden with the real YOLO-driven LIF values so BrainActivity
    // renders real fluctuation instead of pure simulation.
    let finalHistory = baseHistory
    if (cv.cvLif && baseHistory.length > 0) {
      finalHistory = baseHistory.map((point, idx) => {
        // Only override the most recent point
        if (idx < baseHistory.length - 1) return point
        const overridden = { ...point }
        for (const ln of LANES) {
          if (cv.cvLif[ln]) {
            overridden[ln] = {
              potential: cv.cvLif[ln].potential ?? point[ln]?.potential ?? 0,
              spiked:    cv.cvLif[ln].spiked    ?? point[ln]?.spiked    ?? false,
            }
          }
        }
        return overridden
      })
    }

    // KPI
    let kpi
    if (api.status === 'connected' && api.message?.kpi) {
      kpi = {
        ...sim.kpi,
        ...api.message.kpi,
        emergencyActive: api.message.kpi?.emergencyActive || mode === 'emergency',
      }
    } else if (ws.status === 'connected' && ws.message?.kpi) {
      kpi = { ...sim.kpi, ...ws.message.kpi, emergencyActive: mode === 'emergency' }
    } else {
      kpi = sim.kpi
    }

    return {
      lanes:   baseLanes,
      history: finalHistory,
      kpi,
      source: api.status === 'connected' ? 'rest-api'
            : ws.status  === 'connected' ? 'websocket'
            : 'simulator',
    }
  }, [api.status, api.message, ws.status, ws.message, sim, mode, cv.cvLif])

  const liveStatus     = api.status === 'connected' ? 'connected'
    : api.status === 'connecting' ? 'connecting'
    : api.status === 'error'      ? 'error'
    : ws.status
  const influxStatus   = api.status === 'connected' ? 'connected' : 'disconnected'
  const emergencyActive = merged.kpi?.emergencyActive || mode === 'emergency'

  const TABS = [
    { id: 'sim',       label: 'Live Simulation',       icon: <Grid3x3  size={13} /> },
    { id: 'city',      label: 'City Grid',              icon: <Grid3x3  size={13} /> },
    { id: 'brain',     label: 'Brain Activity',         icon: <Activity size={13} /> },
    { id: 'map',       label: 'Emergency Pre-Route',    icon: <MapIcon  size={13} /> },
    { id: 'analytics', label: 'Analytics',              icon: <BarChart3 size={13} /> },
    { id: 'cv',        label: 'CV Input',               icon: <Video    size={13} /> },
  ]

  return (
    <div className="min-h-screen">
      <Header
        theme={theme}
        onToggleTheme={toggle}
        wsStatus={liveStatus}
        dataSource={merged.source}
        cvStatus={cv.status}
      />

      <div className="grid gap-5 px-5 pb-10 lg:grid-cols-[280px_1fr] lg:px-8 pt-5">
        {/* SIDEBAR */}
        <ControlDeck
          online={online}
          onToggleOnline={() => setOnline(v => !v)}
          mode={mode}
          onChangeMode={setMode}
          wsStatus={liveStatus}
          influxStatus={influxStatus}
          activeLane={merged.kpi?.activeLane}
          cvStatus={cv.status}
          cvActiveJob={cv.activeJob}
          onSpawnAmbulance={cv.spawnAmbulance}
        />

        {/* MAIN */}
        <main className="flex flex-col gap-5">
          <section className="animate-fadeUp">
            <KPICards kpi={merged.kpi} />
          </section>

          <section className="animate-fadeUp" style={{ animationDelay: '60ms' }}>
            {/* Tab bar */}
            <div className="mb-4 inline-flex items-center gap-0.5 rounded-md border border-border bg-surface-elevated p-0.5">
              {TABS.map((t) => {
                const isActive   = activeTab === t.id
                const isCVActive = t.id === 'cv' && cv.activeJob
                return (
                  <button
                    key={t.id}
                    onClick={() => setActiveTab(t.id)}
                    className={cn(
                      'relative inline-flex items-center gap-1.5 rounded-[5px] px-3 py-1.5 text-xs font-medium transition-colors',
                      isActive ? 'bg-surface-muted text-ink shadow-soft' : 'text-ink-muted hover:text-ink',
                    )}
                  >
                    {t.icon}
                    <span>{t.label}</span>
                    {isCVActive && (
                      <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-accent animate-pulse-dot" />
                    )}
                  </button>
                )
              })}
            </div>

            {/* Tab content */}
            <div className="animate-fadeIn">
              {activeTab === 'sim' && (
                <MicroSimulationBoard
                  lanes={merged.lanes}
                  emergencyActive={emergencyActive}
                  mode={mode}
                  ambSpawnEvent={ambSpawnEvent}
                />
              )}

              {activeTab === 'city' && (
                <div className="card overflow-hidden p-0">
                  <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                    <div>
                      <p className="eyebrow">City Grid Micro-Simulation</p>
                      <p className="mt-0.5 text-[11px] text-ink-muted">
                        3 Perempatan + 2 Pertigaan · Kendaraan real-time
                        {emergencyActive && (
                          <span className="ml-2 font-semibold text-danger animate-pulse-dot">
                            🚑 Green Corridor Aktif
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <ModeTag mode={mode} />
                      {cv.activeJob && (
                        <span className="chip">
                          <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse-dot" />
                          <span className="text-[10px] text-accent">CV Live</span>
                        </span>
                      )}
                    </div>
                  </div>
                  <CityGrid
                    mode={mode}
                    isDark={isDark}
                    emergencyActive={emergencyActive}
                    cvCounts={cvCounts}
                    ambSpawnEvent={ambSpawnEvent}
                    uploadVideo={cv.uploadVideo}
                    cvStatus={cv.status}
                  />
                </div>
              )}

              {activeTab === 'brain' && (
                <BrainActivity history={merged.history} isDark={isDark} />
              )}

              {activeTab === 'map' && (
                <EmergencyMap isDark={isDark} emergencyActive={emergencyActive} />
              )}

              {activeTab === 'analytics' && (
                <HistoricalAnalytics isDark={isDark} />
              )}

              {activeTab === 'cv' && (
                <VideoUpload
                  cvStatus={cv.status}
                  activeJob={cv.activeJob}
                  onUpload={cv.uploadVideo}
                  onStop={cv.stopJob}
                  onSpawnAmbulance={cv.spawnAmbulance}
                  isDark={isDark}
                />
              )}
            </div>
          </section>
        </main>
      </div>
    </div>
  )
}

function ModeTag({ mode }) {
  const map = {
    normal:     { label: 'Normal',     color: 'text-accent border-accent/30 bg-accent/5' },
    rush:       { label: 'Rush Hour',  color: 'text-warning border-warning/30 bg-warning/5' },
    imbalanced: { label: 'Imbalanced', color: 'text-ink-muted border-border' },
    emergency:  { label: 'EMERGENCY',  color: 'text-danger border-danger/30 bg-danger/5' },
  }
  const s = map[mode] || map.normal
  return (
    <span className={cn('chip text-[10px] font-semibold', s.color)}>{s.label}</span>
  )
}
