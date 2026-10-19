'use client'

import Link from 'next/link'
import { forwardRef } from 'react'
import { Loader2 } from 'lucide-react'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost'
export type ButtonSize = 'sm' | 'md'

const BASE = 'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50'

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-fg hover:bg-accent-hover',
  secondary: 'border border-line-strong bg-surface text-fg hover:bg-sunken',
  ghost: 'text-muted hover:bg-sunken hover:text-fg',
  danger: 'bg-danger text-white hover:bg-danger-hover',
  'danger-ghost': 'text-danger hover:bg-danger-soft',
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-9 px-4 text-sm',
}

const ICON_SIZES: Record<ButtonSize, string> = { sm: 'h-8 w-8', md: 'h-9 w-9' }

export function buttonClass({ variant = 'primary', size = 'md', iconOnly = false, className = '' }: {
  variant?: ButtonVariant; size?: ButtonSize; iconOnly?: boolean; className?: string
} = {}) {
  return `${BASE} ${VARIANTS[variant]} ${iconOnly ? `${ICON_SIZES[size]} px-0` : SIZES[size]} ${className}`
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  /** Square icon button; pass an aria-label. */
  iconOnly?: boolean
}

/** The one button style for the dashboard. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, iconOnly = false, className = '', disabled, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} disabled={disabled || loading} className={buttonClass({ variant, size, iconOnly, className })} {...rest}>
      {loading && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
      {children}
    </button>
  )
})

/** A link styled as a button. */
export function ButtonLink({ href, variant = 'primary', size = 'md', className = '', children, ...rest }: {
  href: string; variant?: ButtonVariant; size?: ButtonSize; className?: string; children: React.ReactNode
} & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  return <Link href={href} className={buttonClass({ variant, size, className })} {...rest}>{children}</Link>
}
