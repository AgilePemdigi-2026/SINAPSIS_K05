import { cn } from '../../lib/cn'

/**
 * Card primitive — bg-surface-elevated + border. Tanpa glow effect.
 */
export function Card({ className, children, ...rest }) {
  return (
    <div className={cn('card', className)} {...rest}>
      {children}
    </div>
  )
}

export function CardHeader({ className, children }) {
  return (
    <div className={cn('flex items-start justify-between gap-3 border-b border-border px-5 py-3', className)}>
      {children}
    </div>
  )
}

export function CardTitle({ className, children }) {
  return (
    <h3 className={cn('text-sm font-semibold tracking-tight text-ink', className)}>
      {children}
    </h3>
  )
}

export function CardBody({ className, children }) {
  return <div className={cn('px-5 py-4', className)}>{children}</div>
}
