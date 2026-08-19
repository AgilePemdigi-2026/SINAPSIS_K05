import { Clock, Car, Brain, Siren } from 'lucide-react'
import { Card } from './ui/Card'
import { FIXED_TIMER_BASELINE_WAIT } from '../lib/constants'
import { cn, formatNumber } from '../lib/cn'

/* =============================================================
   KPICards
   -------------------------------------------------------------
   4 metric tiles utama untuk header dashboard:
     1. Average Wait (vs baseline fixed-timer)
     2. Vehicles Processed (running total)
     3. NERIC Confidence (LIF agreement %)
     4. Emergency Status (active / standby)
   Aesthetic: tile flat, ada delta indicator, no glow.
   ============================================================= */
export function KPICards({ kpi }) {
  const wait = kpi?.avgWait ?? 0
  const processed = kpi?.processed ?? 0
  const confidence = kpi?.confidence ?? 0
  const emergency = !!kpi?.emergencyActive

  // Hitung improvement vs baseline fixed-timer
  const baseline = FIXED_TIMER_BASELINE_WAIT
  const delta = baseline - wait
  const improvementPct = baseline > 0 ? (delta / baseline) * 100 : 0
  const improvementSign = improvementPct >= 0 ? '-' : '+'
  const improvementText = `${improvementSign}${Math.abs(improvementPct).toFixed(1)}% vs fixed-timer`

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {/* === Avg Wait === */}
      <KpiTile
        icon={<Clock size={13} />}
        eyebrow="Avg Wait Time"
        value={formatNumber(wait)}
        unit="sec"
        sublabel={improvementText}
        sublabelTone={improvementPct >= 0 ? 'success' : 'danger'}
      />

      {/* === Vehicles Processed === */}
      <KpiTile
        icon={<Car size={13} />}
        eyebrow="Vehicles Processed"
        value={formatNumber(processed, { maximumFractionDigits: 0 })}
        unit="veh"
        sublabel="Since session start"
        sublabelTone="muted"
      />

      {/* === NERIC Confidence === */}
      <KpiTile
        icon={<Brain size={13} />}
        eyebrow="NERIC Confidence"
        value={formatNumber(confidence * 100)}
        unit="%"
        sublabel="LIF inter-rater agreement"
        sublabelTone="muted"
        progress={confidence}
      />

      {/* === Emergency === */}
      <KpiTile
        icon={<Siren size={13} />}
        eyebrow="Emergency"
        value={emergency ? 'ACTIVE' : 'Standby'}
        valueClass={emergency ? 'text-danger' : 'text-ink'}
        unit=""
        sublabel={emergency ? 'Ambulance pre-emption' : 'No active call'}
        sublabelTone={emergency ? 'danger' : 'muted'}
        accentBorder={emergency}
      />
    </div>
  )
}

/* ---------- KpiTile ---------- */
function KpiTile({
  icon,
  eyebrow,
  value,
  unit,
  sublabel,
  sublabelTone = 'muted',
  valueClass,
  progress,
  accentBorder,
}) {
  const toneMap = {
    success: 'text-success',
    danger: 'text-danger',
    muted: 'text-ink-muted',
    warning: 'text-warning',
  }

  return (
    <Card
      className={cn(
        'flex flex-col gap-2 px-4 py-3',
        accentBorder && 'border-danger/40',
      )}
    >
      {/* Header row */}
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-ink-muted">
          {icon}
          <span className="text-[10px] font-semibold uppercase tracking-wider">
            {eyebrow}
          </span>
        </span>
      </div>

      {/* Value row */}
      <div className="flex items-baseline gap-1.5">
        <span
          className={cn(
            'num text-2xl font-bold leading-none tracking-tight',
            valueClass ?? 'text-ink',
          )}
        >
          {value}
        </span>
        {unit && (
          <span className="text-[11px] font-medium text-ink-soft">{unit}</span>
        )}
      </div>

      {/* Progress bar (optional) */}
      {typeof progress === 'number' && (
        <div className="h-1 w-full overflow-hidden rounded-full bg-surface-muted">
          <div
            className="h-full rounded-full bg-accent transition-all duration-500"
            style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }}
          />
        </div>
      )}

      {/* Sublabel */}
      <span className={cn('text-[10.5px] leading-tight', toneMap[sublabelTone])}>
        {sublabel}
      </span>
    </Card>
  )
}
