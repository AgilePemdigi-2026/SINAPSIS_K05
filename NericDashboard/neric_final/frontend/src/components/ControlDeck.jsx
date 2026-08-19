import { Power, Radio, Database, Settings2, AlertTriangle, ArrowRight, Cpu } from 'lucide-react'
import { Card } from './ui/Card'
import { SIM_MODES, LANE_LABEL } from '../lib/constants'
import { cn } from '../lib/cn'

export function ControlDeck({
  online, onToggleOnline,
  mode, onChangeMode,
  wsStatus, influxStatus,
  activeLane,
  cvStatus, cvActiveJob,
}) {
  const isEmergency = mode === 'emergency'

  return (
    <aside className="flex flex-col gap-4">

      {/* SYSTEM POWER */}
      <Card>
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className={cn(
              'grid h-7 w-7 place-items-center rounded-md border',
              online ? 'border-success/40 bg-success/10 text-success' : 'border-border bg-surface-muted text-ink-soft',
            )}>
              <Power size={13} strokeWidth={2.4} />
            </div>
            <div className="flex flex-col leading-tight">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">System</span>
              <span className="text-sm font-semibold text-ink">{online ? 'Online' : 'Standby'}</span>
            </div>
          </div>
          <button
            onClick={onToggleOnline}
            className={cn('relative h-5 w-9 rounded-full border transition-colors',
              online ? 'border-success/40 bg-success/80' : 'border-border bg-surface-muted',
            )}
          >
            <span className={cn('absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow-soft transition-all',
              online ? 'left-[18px]' : 'left-0.5',
            )} />
          </button>
        </div>
      </Card>

      {/* SIMULATION MODE */}
      <Card>
        <div className="border-b border-border px-4 py-2.5">
          <div className="flex items-center gap-1.5">
            <Settings2 size={11} className="text-ink-muted" />
            <span className="eyebrow">Operating Mode</span>
          </div>
        </div>
        <div className="flex flex-col p-1.5">
          {SIM_MODES.map((m) => {
            const isActive = mode === m.id
            const isEm = m.id === 'emergency'
            return (
              <button
                key={m.id}
                onClick={() => onChangeMode(m.id)}
                className={cn(
                  'group flex items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors',
                  isActive ? (isEm ? 'bg-danger/10 text-ink' : 'bg-surface-muted text-ink')
                           : 'text-ink-muted hover:bg-surface-muted hover:text-ink',
                )}
              >
                <span className={cn('mt-1 h-1.5 w-1.5 shrink-0 rounded-full',
                  isActive ? (isEm ? 'bg-danger' : 'bg-accent') : 'bg-ink-soft/40',
                )} />
                <span className="flex flex-1 flex-col leading-tight">
                  <span className={cn('text-[13px] font-semibold', isActive && isEm ? 'text-danger' : 'text-ink')}>
                    {m.label}
                  </span>
                  <span className="mt-0.5 text-[11px] text-ink-muted">{m.description}</span>
                </span>
              </button>
            )
          })}
        </div>
      </Card>

      {/* ACTIVE PHASE */}
      <Card>
        <div className="border-b border-border px-4 py-2.5">
          <div className="flex items-center justify-between">
            <span className="eyebrow">Active Phase</span>
            <span className="chip">
              <span className={cn('h-1.5 w-1.5 rounded-full', activeLane ? 'bg-success animate-pulse-dot' : 'bg-ink-soft')} />
              <span className="text-[10px] uppercase tracking-wider text-ink-muted">
                {activeLane ? 'Green' : 'Idle'}
              </span>
            </span>
          </div>
        </div>
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-[11px] text-ink-muted">Current direction</span>
          <div className="flex items-center gap-2">
            <span className="num text-base font-semibold text-ink">{activeLane ?? '—'}</span>
            {activeLane && (
              <>
                <ArrowRight size={11} className="text-ink-soft" />
                <span className="text-[12px] text-ink-muted">{LANE_LABEL[activeLane]}</span>
              </>
            )}
          </div>
        </div>
      </Card>

      {/* CV BACKEND STATUS */}
      <Card>
        <div className="border-b border-border px-4 py-2.5">
          <div className="flex items-center gap-1.5">
            <Cpu size={11} className="text-ink-muted" />
            <span className="eyebrow">Computer Vision</span>
          </div>
        </div>
        <div className="flex flex-col gap-2.5 px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-ink-muted">YOLOv8 Backend</span>
            <StatusDot status={cvStatus} />
          </div>
          <div className="rounded-md border border-border bg-surface-muted px-2.5 py-1.5">
            <p className="font-mono text-[10.5px] leading-tight text-ink">localhost:8001/ws/cv</p>
            <p className="mt-0.5 text-[10px] leading-tight text-ink-soft">model: best.pt</p>
          </div>
          {cvActiveJob && (
            <div className="rounded-md border border-accent/30 bg-accent/5 px-2.5 py-2">
              <p className="text-[10px] font-semibold text-accent">Memproses video…</p>
              <p className="text-[10px] text-ink-muted mt-0.5">
                Node: <strong>{cvActiveJob.node_id}</strong> | Lane: <strong>{cvActiveJob.lane}</strong>
              </p>
              <div className="mt-1.5 h-1 rounded-full bg-border overflow-hidden">
                <div
                  className="h-full rounded-full bg-accent transition-all duration-300"
                  style={{ width: `${Math.round((cvActiveJob.progress || 0) * 100)}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* DATA SOURCE */}
      <Card>
        <div className="border-b border-border px-4 py-2.5">
          <div className="flex items-center gap-1.5">
            <Database size={11} className="text-ink-muted" />
            <span className="eyebrow">Data Source</span>
          </div>
        </div>
        <div className="flex flex-col gap-3 px-4 py-3">
          <div className="flex flex-col gap-1.5">
            <label className="flex items-center justify-between text-[11px] text-ink-muted">
              <span className="flex items-center gap-1.5"><Radio size={10} />NERIC Backend</span>
              <StatusDot status={wsStatus} />
            </label>
            <div className="rounded-md border border-border bg-surface-muted px-2.5 py-1.5">
              <p className="font-mono text-[10.5px] leading-tight text-ink">/api/decide → ngrok</p>
              <p className="mt-0.5 text-[10px] text-ink-soft">Edit URL di <span className="font-mono">vite.config.js</span></p>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-md border border-border bg-surface-muted px-2.5 py-2">
            <div className="flex flex-col leading-tight">
              <span className="text-[10px] uppercase tracking-wider text-ink-muted">InfluxDB</span>
              <span className="text-[11px] font-medium text-ink">
                {influxStatus === 'connected' ? 'Time-series ready' : 'Local fallback'}
              </span>
            </div>
            <StatusDot status={influxStatus === 'connected' ? 'connected' : 'disconnected'} />
          </div>
        </div>
      </Card>

      {/* EMERGENCY BANNER */}
      {isEmergency && (
        <Card className="border-danger/40 bg-danger/5">
          <div className="flex items-start gap-2.5 px-4 py-3">
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-danger" />
            <div className="flex flex-col gap-0.5 leading-tight">
              <span className="text-[12px] font-semibold text-danger">Emergency Active</span>
              <span className="text-[11px] text-ink-muted">
                Green Corridor aktif di City Grid. Semua lampu di koridor ambulans otomatis HIJAU.
                Algoritma Dijkstra: East → INT_C → INT_B → INT_A → Hospital.
              </span>
            </div>
          </div>
        </Card>
      )}

      <div className="px-1 text-[10px] leading-relaxed text-ink-soft">
        <p>NERIC v3.0 · MSU iReX Malaysia 2026</p>
        <p>LIF Neuromorphic · Multi-Intersection</p>
      </div>
    </aside>
  )
}

function StatusDot({ status }) {
  const map = {
    connected:    { color: 'bg-success', text: 'text-success', label: 'Connected' },
    connecting:   { color: 'bg-warning animate-pulse-dot', text: 'text-warning', label: 'Connecting' },
    disconnected: { color: 'bg-ink-soft', text: 'text-ink-muted', label: 'Offline' },
    error:        { color: 'bg-danger', text: 'text-danger', label: 'Error' },
    idle:         { color: 'bg-ink-soft', text: 'text-ink-muted', label: 'Idle' },
  }
  const s = map[status] || map.idle
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('h-1.5 w-1.5 rounded-full', s.color)} />
      <span className={cn('text-[10px] font-medium uppercase tracking-wider', s.text)}>{s.label}</span>
    </span>
  )
}
