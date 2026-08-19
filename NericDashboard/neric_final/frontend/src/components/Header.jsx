import { Activity, Shield, Cpu } from 'lucide-react'
import { ThemeToggle } from './ui/Toggle'
import { cn } from '../lib/cn'

export function Header({ theme, onToggleTheme, wsStatus, dataSource, cvStatus }) {
  const isDark = theme === 'dark'

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface/85 backdrop-blur-md">
      <div className="flex items-center justify-between gap-6 px-5 py-3 lg:px-8">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-md border border-border bg-surface-elevated">
            <svg viewBox="0 0 24 24" className="h-5 w-5">
              <defs>
                <linearGradient id="logoG" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor={isDark ? '#3b82f6' : '#2563eb'} />
                  <stop offset="100%" stopColor={isDark ? '#60a5fa' : '#1d4ed8'} />
                </linearGradient>
              </defs>
              <circle cx="12" cy="12" r="2.5" fill="url(#logoG)" />
              <g stroke="url(#logoG)" strokeWidth="1.6" strokeLinecap="round" fill="none">
                <line x1="12" y1="9.5" x2="12" y2="4" />
                <line x1="12" y1="14.5" x2="12" y2="20" />
                <line x1="9.5" y1="12" x2="4" y2="12" />
                <line x1="14.5" y1="12" x2="20" y2="12" />
              </g>
              <g fill="url(#logoG)">
                <rect x="11" y="3" width="2" height="2" rx="0.5" />
                <rect x="11" y="19" width="2" height="2" rx="0.5" />
                <rect x="3" y="11" width="2" height="2" rx="0.5" />
                <rect x="19" y="11" width="2" height="2" rx="0.5" />
              </g>
            </svg>
          </div>
          <div className="flex flex-col leading-tight">
            <div className="flex items-baseline gap-2">
              <span className="font-display text-lg font-bold tracking-tight text-ink">NERIC</span>
              <span className="hidden font-mono text-[10px] uppercase tracking-wider text-ink-soft sm:inline">
                City Grid · v3.0
              </span>
            </div>
            <span className="hidden text-[11px] text-ink-muted md:block">
              Multi-Intersection Micro-Simulation Dashboard
            </span>
          </div>
        </div>

        {/* Right */}
        <div className="flex items-center gap-3">
          <DataSourceChip source={dataSource} wsStatus={wsStatus} />
          <CVChip status={cvStatus} />
          <div className="hidden h-6 w-px bg-border md:block" />
          <div className="hidden items-center gap-1.5 text-[11px] text-ink-muted md:flex">
            <Shield size={12} className="text-success" />
            <span>Encrypted</span>
          </div>
          <ThemeToggle isDark={isDark} onToggle={onToggleTheme} />
        </div>
      </div>
    </header>
  )
}

function DataSourceChip({ source, wsStatus }) {
  let label, dot
  if (source === 'rest-api')      { label = 'Live · NERIC API'; dot = 'bg-success' }
  else if (source === 'websocket') { label = 'Live · WebSocket'; dot = 'bg-success' }
  else if (wsStatus === 'connecting') { label = 'Connecting'; dot = 'bg-warning animate-pulse-dot' }
  else if (wsStatus === 'error')  { label = 'Simulated · offline'; dot = 'bg-danger' }
  else                            { label = 'Simulated'; dot = 'bg-ink-soft' }

  return (
    <div className="chip">
      <Activity size={11} className="text-ink-muted" />
      <span className={cn('h-1.5 w-1.5 rounded-full', dot)} />
      <span className="text-[11px] text-ink-muted">{label}</span>
    </div>
  )
}

function CVChip({ status }) {
  const map = {
    connected:    { dot: 'bg-success', label: 'CV Online' },
    connecting:   { dot: 'bg-warning animate-pulse-dot', label: 'CV Connecting' },
    error:        { dot: 'bg-danger',  label: 'CV Error' },
    disconnected: { dot: 'bg-ink-soft', label: 'CV Offline' },
  }
  const s = map[status] || map.disconnected
  return (
    <div className="chip">
      <Cpu size={11} className="text-ink-muted" />
      <span className={cn('h-1.5 w-1.5 rounded-full', s.dot)} />
      <span className="text-[11px] text-ink-muted">{s.label}</span>
    </div>
  )
}
