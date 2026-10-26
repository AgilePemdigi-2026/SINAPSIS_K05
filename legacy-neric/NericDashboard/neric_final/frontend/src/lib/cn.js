import clsx from 'clsx'

/**
 * `cn` - shorthand untuk menggabungkan class Tailwind secara
 * kondisional. Wrapper tipis di atas `clsx` agar kode komponen
 * lebih bersih.
 *
 * Contoh:
 *   cn('px-4 py-2', isActive && 'bg-accent text-white')
 */
export function cn(...inputs) {
  return clsx(inputs)
}

/**
 * `formatNumber` - format angka dengan separator ribuan Indonesia.
 */
export function formatNumber(n, opts = {}) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return new Intl.NumberFormat('id-ID', {
    maximumFractionDigits: 1,
    ...opts,
  }).format(n)
}

/**
 * `clamp` - batasi nilai antara min dan max.
 */
export function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v))
}
