import { Moon, Sun } from 'lucide-react'
import { cn } from '../../lib/cn'

/**
 * ThemeToggle — minimal switch between dark/light.
 */
export function ThemeToggle({ isDark, onToggle }) {
  return (
    <button
      onClick={onToggle}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className={cn(
        'inline-flex h-8 items-center gap-1 rounded-md border border-border bg-surface-elevated p-0.5',
        'transition-colors hover:border-border-strong',
      )}
    >
      <span
        className={cn(
          'inline-flex h-6 w-6 items-center justify-center rounded-[5px] transition-colors',
          !isDark ? 'bg-surface-muted text-ink' : 'text-ink-soft',
        )}
      >
        <Sun size={13} />
      </span>
      <span
        className={cn(
          'inline-flex h-6 w-6 items-center justify-center rounded-[5px] transition-colors',
          isDark ? 'bg-surface-muted text-ink' : 'text-ink-soft',
        )}
      >
        <Moon size={13} />
      </span>
    </button>
  )
}
