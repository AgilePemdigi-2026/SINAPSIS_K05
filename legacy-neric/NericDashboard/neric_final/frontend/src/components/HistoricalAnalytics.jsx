import { useEffect, useMemo, useState } from 'react'
import { Bar } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
} from 'chart.js'
import { BarChart3, RefreshCw, Database } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardBody } from './ui/Card'
import { LANES, LANE_LABEL, LANE_COLORS, API_DEFAULT_BASE } from '../lib/constants'
import { cn, formatNumber } from '../lib/cn'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

/* =============================================================
   HistoricalAnalytics
   -------------------------------------------------------------
   Bar chart 24-hour breakdown:
     - X-axis: hour-of-day (0..23)
     - Y-axis: vehicles processed per hour
     - 4 series (N, E, S, W) stacked
   Data source:
     1. Coba fetch /api/history (FastAPI + InfluxDB)
     2. Fallback: simulator synthetic 24-h
   ============================================================= */
export function HistoricalAnalytics({ isDark }) {
  const palette = isDark ? LANE_COLORS.dark : LANE_COLORS.light
  const gridColor = isDark ? 'rgba(148, 163, 184, 0.08)' : 'rgba(15, 23, 42, 0.06)'
  const tickColor = isDark ? 'rgba(148, 163, 184, 0.7)' : 'rgba(71, 85, 105, 0.85)'

  const [rows, setRows] = useState(() => synthesize24h())
  const [source, setSource] = useState('local')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 3500)
      const res = await fetch(`${API_DEFAULT_BASE}/history?hours=24`, {
        signal: ctrl.signal,
      })
      clearTimeout(timer)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      if (Array.isArray(json?.rows) && json.rows.length > 0) {
        setRows(json.rows)
        setSource(json.source || 'api')
      } else {
        setRows(synthesize24h())
        setSource('local')
      }
    } catch (e) {
      // Diam-diam fallback ke simulator
      setRows(synthesize24h())
      setSource('local')
      setError(e?.name === 'AbortError' ? 'Backend timeout' : 'Backend offline')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const data = useMemo(() => {
    const labels = rows.map((r) =>
      String(r.hour).padStart(2, '0') + ':00',
    )
    const datasets = LANES.map((ln) => ({
      label: `${ln} · ${LANE_LABEL[ln]}`,
      data: rows.map((r) => r?.[ln] ?? 0),
      backgroundColor: hexToRgba(palette[ln], 0.85),
      borderColor: palette[ln],
      borderWidth: 0,
      borderRadius: 2,
      borderSkipped: false,
      barPercentage: 0.85,
      categoryPercentage: 0.85,
      stack: 'traffic',
    }))
    return { labels, datasets }
  }, [rows, palette])

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      animation: { duration: 250 },
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
          align: 'start',
          labels: {
            color: tickColor,
            font: { family: 'Plus Jakarta Sans', size: 10, weight: '500' },
            boxWidth: 8,
            boxHeight: 8,
            padding: 12,
            usePointStyle: true,
            pointStyle: 'rectRounded',
          },
        },
        tooltip: {
          backgroundColor: isDark ? 'rgba(17, 20, 26, 0.95)' : 'rgba(255, 255, 255, 0.97)',
          titleColor: isDark ? '#e2e8f0' : '#0f172a',
          bodyColor: isDark ? '#cbd5e1' : '#334155',
          borderColor: isDark ? 'rgba(51, 58, 71, 1)' : 'rgba(226, 232, 240, 1)',
          borderWidth: 1,
          padding: 10,
          titleFont: { family: 'Plus Jakarta Sans', size: 11, weight: '600' },
          bodyFont: { family: 'JetBrains Mono', size: 10 },
          callbacks: {
            footer: (items) => {
              const sum = items.reduce((acc, i) => acc + (i.parsed.y || 0), 0)
              return `Total: ${formatNumber(sum, { maximumFractionDigits: 0 })} veh`
            },
          },
        },
      },
      scales: {
        x: {
          stacked: true,
          grid: { color: gridColor, drawTicks: false },
          border: { color: gridColor },
          ticks: {
            color: tickColor,
            font: { family: 'JetBrains Mono', size: 9 },
            maxRotation: 0,
            autoSkipPadding: 14,
          },
        },
        y: {
          stacked: true,
          beginAtZero: true,
          grid: { color: gridColor, drawTicks: false },
          border: { color: gridColor },
          ticks: {
            color: tickColor,
            font: { family: 'JetBrains Mono', size: 9 },
            padding: 6,
            callback: (v) => formatNumber(v, { maximumFractionDigits: 0 }),
          },
        },
      },
    }),
    [gridColor, tickColor, isDark],
  )

  // Totals
  const totals = useMemo(() => {
    const acc = { N: 0, E: 0, S: 0, W: 0, all: 0 }
    for (const r of rows) {
      for (const ln of LANES) {
        const v = r?.[ln] ?? 0
        acc[ln] += v
        acc.all += v
      }
    }
    return acc
  }, [rows])

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-0.5">
          <CardTitle className="flex items-center gap-1.5">
            <BarChart3 size={13} className="text-ink-muted" />
            Historical Analytics · 24 Hours
          </CardTitle>
          <p className="text-[11px] text-ink-muted">
            Vehicles processed per lane (hour-of-day breakdown)
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="chip">
            <Database size={10} className="text-ink-muted" />
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                source === 'api' || source === 'influxdb'
                  ? 'bg-success'
                  : 'bg-ink-soft',
              )}
            />
            <span className="text-[10px] uppercase tracking-wider text-ink-muted">
              {source === 'api' || source === 'influxdb' ? 'InfluxDB' : 'Synthetic'}
            </span>
          </span>
          <button
            onClick={load}
            disabled={loading}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-elevated px-2.5 py-1 text-[11px] font-medium text-ink',
              'hover:bg-surface-muted transition-colors',
              loading && 'opacity-60',
            )}
          >
            <RefreshCw size={11} className={cn(loading && 'animate-spin')} />
            <span>Refresh</span>
          </button>
        </div>
      </CardHeader>

      <CardBody>
        {error && (
          <div className="mb-3 rounded-md border border-warning/30 bg-warning/5 px-3 py-1.5 text-[11px] text-warning">
            {error} — menampilkan data simulator lokal.
          </div>
        )}

        <div className="relative h-[280px] w-full">
          <Bar data={data} options={options} />
        </div>

        {/* Lane totals */}
        <div className="mt-4 grid grid-cols-2 gap-2 border-t border-border pt-3 sm:grid-cols-5">
          <div className="rounded-md bg-surface-muted px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-ink-muted">
              Total
            </div>
            <div className="num text-base font-semibold text-ink">
              {formatNumber(totals.all, { maximumFractionDigits: 0 })}
            </div>
          </div>
          {LANES.map((ln) => (
            <div key={ln} className="rounded-md bg-surface-muted px-3 py-2">
              <div className="flex items-center gap-1.5">
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: palette[ln] }}
                />
                <span className="text-[10px] uppercase tracking-wider text-ink-muted">
                  {LANE_LABEL[ln]}
                </span>
              </div>
              <div className="num text-base font-semibold text-ink">
                {formatNumber(totals[ln], { maximumFractionDigits: 0 })}
              </div>
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  )
}

/* ---------- helpers ---------- */
function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '')
  const r = parseInt(h.substring(0, 2), 16)
  const g = parseInt(h.substring(2, 4), 16)
  const b = parseInt(h.substring(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/**
 * Synthesize realistic 24-hour traffic curve.
 * Pola: morning rush (07-09), midday plateau, evening rush (17-19), night dip.
 */
function synthesize24h() {
  // Profile multiplier 0..1 per hour (heuristik kota Surabaya)
  const profile = [
    0.18, 0.12, 0.08, 0.06, 0.08, 0.18, 0.42, 0.78, 0.92, 0.74,
    0.58, 0.60, 0.66, 0.62, 0.60, 0.66, 0.76, 0.95, 0.88, 0.62,
    0.48, 0.36, 0.28, 0.22,
  ]
  // Bias per lane (jalan utama lebih ramai)
  const laneBias = { N: 1.0, E: 0.85, S: 1.05, W: 0.78 }

  return profile.map((p, hour) => {
    const base = p * 110
    const row = { hour }
    for (const ln of LANES) {
      const noise = (Math.random() - 0.5) * 12
      const v = Math.max(0, Math.round(base * laneBias[ln] + noise))
      row[ln] = v
    }
    return row
  })
}
