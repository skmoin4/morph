import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-blue text-white border-blue shadow-btn-primary hover:bg-blue-2 hover:border-blue-2',
  secondary: 'bg-surface text-ink-2 border-line hover:bg-surface-2',
  ghost: 'bg-surface-2 text-ink-2 border-line hover:bg-line-soft',
  subtle: 'bg-transparent text-muted border-transparent hover:bg-surface-2 hover:text-ink-2',
  danger: 'bg-[#fff4f4] text-pill-red-fg border-[#ffd7d8] hover:bg-pill-red-bg',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-2.5 text-micro tracking-normal gap-1.5',
  md: 'h-[38px] px-3 text-sub gap-2',
  lg: 'h-11 px-4 text-title gap-2',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and blocks further clicks. */
  loading?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    loading = false,
    leadingIcon,
    trailingIcon,
    fullWidth,
    className,
    children,
    disabled,
    type = 'button',
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      // A loading button stays focusable but is not actionable, so a screen
      // reader keeps its place instead of losing focus to the document.
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap rounded-control border font-heavy',
        'transition-[transform,box-shadow,background-color] duration-150',
        'hover:-translate-y-px hover:shadow-[0_5px_12px_rgba(15,23,42,.08)]',
        'disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none',
        VARIANTS[variant],
        SIZES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...props}
    >
      {loading ? (
        <Loader2 aria-hidden className="size-4 animate-spin" />
      ) : (
        leadingIcon && (
          <span aria-hidden className="shrink-0 [&>svg]:size-4">
            {leadingIcon}
          </span>
        )
      )}
      {children}
      {trailingIcon && !loading && (
        <span aria-hidden className="shrink-0 [&>svg]:size-4">
          {trailingIcon}
        </span>
      )}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: an icon-only control needs an accessible name. */
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, variant = 'subtle', size = 'md', className, children, type = 'button', ...props },
  ref,
) {
  const dimension = size === 'sm' ? 'size-8' : size === 'lg' ? 'size-11' : 'size-[38px]';

  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'inline-grid place-items-center rounded-control border transition-colors duration-150',
        'disabled:pointer-events-none disabled:opacity-50',
        '[&>svg]:size-[18px]',
        VARIANTS[variant],
        dimension,
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
});
