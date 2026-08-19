// =============================================================
// VideoUpload.jsx — Per-node video input UI
// =============================================================
// Menampilkan panel upload video untuk setiap node kota.
// File dikirim ke CV Backend → YOLOv8 hitung kendaraan → WebSocket
// =============================================================

import { useState, useRef } from 'react'
import { Upload, Video, Square, Loader, CheckCircle2, AlertCircle, Camera } from 'lucide-react'
import { CITY_NODES, LANES, LANE_LABEL } from '../lib/constants'
import { cn } from '../lib/cn'

const NODES_LIST = Object.values(CITY_NODES)

export function VideoUpload({ cvStatus, activeJob, onUpload, onStop, isDark }) {
  const [selectedNode, setSelectedNode] = useState('INT_A')
  const [selectedLane, setSelectedLane] = useState('S')
  const [dragOver, setDragOver]         = useState(false)
  const [fileName, setFileName]         = useState(null)
  const [pending, setPending]           = useState(false)
  const fileRef = useRef(null)

  const isConnected = cvStatus === 'connected'
  const isProcessing = !!activeJob
  const progressPct = activeJob ? Math.round((activeJob.progress || 0) * 100) : 0

  async function handleFile(file) {
    if (!file) return
    if (!file.type.startsWith('video/')) {
      alert('Pilih file video (mp4, avi, mov, dll)')
      return
    }
    setFileName(file.name)
    setPending(true)
    await onUpload(file, selectedLane, selectedNode)
    setPending(false)
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  return (
    <div className="card p-5 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="eyebrow">Computer Vision Input</p>
          <h3 className="text-sm font-semibold text-ink mt-0.5">Upload Video per Node</h3>
        </div>
        <CVStatusChip status={cvStatus} />
      </div>

      {/* Node + Lane selector */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="eyebrow mb-1.5 block">Target Node</label>
          <select
            value={selectedNode}
            onChange={(e) => setSelectedNode(e.target.value)}
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-accent"
            disabled={isProcessing}
          >
            {NODES_LIST.map((n) => (
              <option key={n.id} value={n.id}>
                {n.id} — {n.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="eyebrow mb-1.5 block">Kamera dari Lane</label>
          <div className="flex gap-1.5">
            {LANES.map((l) => (
              <button
                key={l}
                onClick={() => setSelectedLane(l)}
                disabled={isProcessing}
                className={cn(
                  'flex-1 rounded-md border py-2 text-xs font-semibold transition-colors',
                  selectedLane === l
                    ? 'border-accent bg-accent text-white'
                    : 'border-border bg-surface text-ink-muted hover:text-ink hover:border-border-strong'
                )}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Drop zone */}
      {!isProcessing ? (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileRef.current?.click()}
          className={cn(
            'relative flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-4 py-8 cursor-pointer transition-colors',
            dragOver
              ? 'border-accent bg-accent/5'
              : 'border-border hover:border-border-strong hover:bg-surface-muted'
          )}
        >
          <input
            ref={fileRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => handleFile(e.target.files[0])}
          />
          <div className={cn('rounded-full p-3', isDark ? 'bg-surface-muted' : 'bg-surface-hover')}>
            {pending ? (
              <Loader size={22} className="text-accent animate-spin" />
            ) : (
              <Upload size={22} className="text-ink-muted" />
            )}
          </div>
          <div className="text-center">
            {fileName ? (
              <>
                <p className="text-xs font-medium text-ink">{fileName}</p>
                <p className="text-[10px] text-ink-muted mt-0.5">Klik untuk ganti file</p>
              </>
            ) : (
              <>
                <p className="text-xs font-medium text-ink">Drag & drop video, atau klik</p>
                <p className="text-[10px] text-ink-muted mt-0.5">MP4, AVI, MOV — maks 500 MB</p>
              </>
            )}
          </div>
          {!isConnected && (
            <p className="text-[10px] text-warning">
              ⚠ CV Backend offline — tidak dapat upload
            </p>
          )}
        </div>
      ) : (
        /* Processing progress */
        <div className="rounded-lg border border-border bg-surface-muted p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Video size={14} className="text-accent" />
              <span className="text-xs font-medium text-ink">Memproses dengan YOLOv8</span>
            </div>
            <button
              onClick={onStop}
              className="flex items-center gap-1 rounded-md border border-danger/40 px-2 py-1 text-[10px] text-danger hover:bg-danger/10 transition-colors"
            >
              <Square size={10} />
              Stop
            </button>
          </div>

          {/* Progress bar */}
          <div className="space-y-1">
            <div className="flex justify-between text-[10px] text-ink-muted">
              <span>Node: <strong className="text-ink">{activeJob?.node_id}</strong></span>
              <span>Lane: <strong className="text-ink">{activeJob?.lane}</strong></span>
              <span className="num">{progressPct}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-border overflow-hidden">
              <div
                className="h-full rounded-full bg-accent transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>

          <p className="text-[10px] text-ink-soft">
            Deteksi kendaraan dikirim real-time ke City Grid via WebSocket...
          </p>
        </div>
      )}

      {/* Node grid — quick status per node */}
      <div>
        <p className="eyebrow mb-2">Status Node</p>
        <div className="grid grid-cols-5 gap-1.5">
          {NODES_LIST.map((n) => {
            const isActive = activeJob?.node_id === n.id
            return (
              <button
                key={n.id}
                onClick={() => { setSelectedNode(n.id); fileRef.current?.click() }}
                disabled={isProcessing}
                className={cn(
                  'rounded-md border py-2 text-center transition-colors',
                  isActive
                    ? 'border-accent bg-accent/10'
                    : 'border-border bg-surface hover:border-border-strong'
                )}
              >
                <Camera size={12} className={cn('mx-auto mb-0.5', isActive ? 'text-accent' : 'text-ink-soft')} />
                <p className="text-[9px] font-semibold text-ink">{n.id}</p>
                <p className="text-[8px] text-ink-muted">{n.type === 'intersection' ? '4-way' : '3-way'}</p>
                {isActive && (
                  <span className="text-[8px] text-accent animate-pulse-dot">LIVE</span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* How it works */}
      <details className="group">
        <summary className="cursor-pointer text-[10px] text-ink-muted hover:text-ink select-none">
          ▶ Cara kerja CV integration
        </summary>
        <div className="mt-2 rounded-md bg-surface-muted p-3 space-y-1 text-[10px] text-ink-muted leading-relaxed">
          <p>1. Pilih node kota & lane arah kamera</p>
          <p>2. Upload video (misal rekaman CCTV persimpangan)</p>
          <p>3. CV Backend (YOLOv8 + <code className="text-accent">best.pt</code>) mendeteksi & menghitung kendaraan per frame</p>
          <p>4. Hasil dikirim via WebSocket → Dashboard spawn kendaraan di City Grid</p>
          <p>5. Kendaraan bergerak, berhenti di lampu merah, pilih jalur acak</p>
        </div>
      </details>
    </div>
  )
}

function CVStatusChip({ status }) {
  const map = {
    connected:    { dot: 'bg-success',    label: 'CV Backend Online',   text: 'text-success' },
    connecting:   { dot: 'bg-warning animate-pulse-dot', label: 'Menghubungkan...', text: 'text-warning' },
    error:        { dot: 'bg-danger',     label: 'CV Backend Error',    text: 'text-danger' },
    disconnected: { dot: 'bg-ink-soft',   label: 'CV Backend Offline',  text: 'text-ink-muted' },
  }
  const s = map[status] || map.disconnected
  return (
    <div className="chip">
      <div className={cn('h-1.5 w-1.5 rounded-full', s.dot)} />
      <span className={s.text}>{s.label}</span>
    </div>
  )
}
