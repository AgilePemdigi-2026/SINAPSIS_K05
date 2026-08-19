import { useMemo, useRef } from 'react'
import { Line } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js'
import { Brain, Zap } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardBody } from './ui/Card'
import { LANES, LANE_LABEL, LANE_COLORS, LIF_CONFIG } from '../lib/constants'

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler,
)

/* =============================================================
   BrainActivity
   -------------------------------------------------------------
   Chart Leaky Integrate-and-Fire (LIF) per lane:
     - 4 line (N, E, S, W) — membrane potential vs time
     - Threshold line (di v=1.0) — spike trigger
     - Point besar di moment spiked
   Visual: line tipis, color refined (bukan neon), grid subtle.
   ============================================================= */
export function BrainActivity({ history, isDark }) {
  const palette = isDark ? LANE_COLORS.dark : LANE_COLORS.light
  const gridColor = isDark ? 'rgba(148, 163, 184, 0.08)' : 'rgba(15, 23, 42, 0.06)'
  const tickColor = isDark ? 'rgba(148, 163, 184, 0.7)' : 'rgba(71, 85, 105, 0.85)'
  const thresholdColor = isDark ? 'rgba(239, 68, 68, 0.6)' : 'rgba(220, 38, 38, 0.6)'

  const chartRef = useRef(null)

  // Hitung jumlah spike total dalam history window
  const spikeStats = useMemo(() => {
    const counts = { N: 0, E: 0, S: 0, W: 0 }
    if (Array.isArray(history)) {
      for (const point of history) {
        for (const ln of LANES) {
          if (point?.[ln]?.spiked) counts[ln] += 1
        }
      }
    }
    const total = counts.N + counts.E + counts.S + counts.W
    return { counts, total }
  }, [history])

  const data = useMemo(() => {
    const labels = (history || []).map((_, i) => i)

    const datasets = LANES.map((ln) => {
      const color = palette[ln]
      const values = (history || []).map((p) => p?.[ln]?.potential ?? 0)

      // pointRadius: 0 normally, but bigger when that tick spiked
      const pointRadius = (history || []).map((p) =>
        p?.[ln]?.spiked ? 3.2 : 0,
      )
      const pointBackground = (history || []).map((p) =>
        p?.[ln]?.spiked ? color : 'transparent',
      )

      return {
        label: `${ln} · ${LANE_LABEL[ln]}`,
        data: values,
        borderColor: color,
        backgroundColor: hexToRgba(color, 0.06),
        borderWidth: 1.4,
        tension: 0.35,
        pointRadius,
        pointBackgroundColor: pointBackground,
        pointBorderColor: pointBackground,
        pointHoverRadius: 4.5,
        fill: false,
        spanGaps: true,
      }
    })

    // Threshold line (horizontal dashed di v=1.0)
    if ((history || []).length > 0) {
      datasets.push({
        label: 'Spike threshold',
        data: labels.map(() => LIF_CONFIG.threshold),
        borderColor: thresholdColor,
        borderWidth: 1,
        borderDash: [4, 4],
        pointRadius: 0,
        fill: false,
        tension: 0,
      })
    }

    return { labels, datasets }
  }, [history, palette, thresholdColor])

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      animation: { duration: 0 }, // realtime, no animation
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
          align: 'start',
          labels: {
            color: tickColor,
            font: {
              family: 'Plus Jakarta Sans',
              size: 10,
              weight: '500',
            },
            boxWidth: 8,
            boxHeight: 8,
            padding: 12,
            usePointStyle: true,
            pointStyle: 'circle',
            filter: (item) => item.text !== 'Spike threshold',
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
            label: (ctx) => {
              if (ctx.dataset.label === 'Spike threshold') return null
              return `${ctx.dataset.label}: ${Number(ctx.parsed.y).toFixed(3)}`
            },
          },
        },
      },
      scales: {
        x: {
          grid: { color: gridColor, drawTicks: false },
          ticks: { display: false },
          border: { color: gridColor },
        },
        y: {
          min: 0,
          max: 1.25,
          grid: { color: gridColor, drawTicks: false },
          border: { color: gridColor },
          ticks: {
            color: tickColor,
            font: { family: 'JetBrains Mono', size: 9 },
            stepSize: 0.25,
            padding: 6,
            callback: (v) => Number(v).toFixed(2),
          },
        },
      },
    }),
    [gridColor, tickColor, isDark],
  )

  const hasData = (history || []).length > 0

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex flex-col gap-0.5">
          <CardTitle className="flex items-center gap-1.5">
            <Brain size={13} className="text-ink-muted" />
            LIF Neural Activity
          </CardTitle>
          <p className="text-[11px] text-ink-muted">
            Leaky Integrate-and-Fire membrane potential per lane · realtime
          </p>
        </div>
        <span className="chip">
          <Zap size={10} className="text-warning" />
          <span className="num text-[11px] text-ink">{spikeStats.total}</span>
          <span className="text-[10px] uppercase tracking-wider text-ink-muted">
            spikes
          </span>
        </span>
      </CardHeader>

      <CardBody className="flex flex-1 flex-col">
        <div className="relative h-[240px] w-full">
          {hasData ? (
            <Line ref={chartRef} data={data} options={options} />
          ) : (
            <div className="grid h-full place-items-center text-[12px] text-ink-soft">
              Buffering signal…
            </div>
          )}
        </div>

        {/* Per-lane spike legend */}
        <div className="mt-3 grid grid-cols-4 gap-2 border-t border-border pt-3">
          {LANES.map((ln) => (
            <div key={ln} className="flex items-center justify-between rounded-md bg-surface-muted px-2 py-1.5">
              <div className="flex items-center gap-1.5">
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: palette[ln] }}
                />
                <span className="text-[10px] font-semibold text-ink">{ln}</span>
              </div>
              <span className="num text-[11px] font-semibold text-ink">
                {spikeStats.counts[ln]}
              </span>
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  )
}

/* ---------- hexToRgba ---------- */
function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '')
  const r = parseInt(h.substring(0, 2), 16)
  const g = parseInt(h.substring(2, 4), 16)
  const b = parseInt(h.substring(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
