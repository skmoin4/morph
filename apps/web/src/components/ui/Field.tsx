import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { AlertCircle } from 'lucide-react';
import { cn } from '../../lib/cn';

const CONTROL_BASE =
  'w-full rounded-control border bg-surface px-3 text-body text-ink placeholder:text-muted-2 transition-colors disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-muted';

const CONTROL_STATE = {
  normal: 'border-line hover:border-blue-2/50',
  error: 'border-red/60 bg-[#fffafa]',
} as const;

export interface FieldShellProps {
  label: string;
  /** Rendered under the control. Replaced by `error` when one is present. */
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  /** Hides the label visually but keeps it for screen readers. */
  srOnlyLabel?: boolean;
  className?: string;
  children: (ids: { controlId: string; describedBy: string | undefined }) => ReactNode;
}

/** Shared label / hint / error wrapper, so every control reports errors the same way. */
export function FieldShell({
  label,
  hint,
  error,
  required,
  srOnlyLabel,
  className,
  children,
}: FieldShellProps) {
  const controlId = useId();
  const messageId = `${controlId}-message`;
  const describedBy = error || hint ? messageId : undefined;

  return (
    <div className={cn('min-w-0', className)}>
      <label
        htmlFor={controlId}
        className={cn('mb-1.5 block text-sub font-heavy text-ink-2', srOnlyLabel && 'sr-only')}
      >
        {label}
        {required && (
          <span aria-hidden className="ml-0.5 text-red">
            *
          </span>
        )}
      </label>

      {children({ controlId, describedBy })}

      {error ? (
        <p
          id={messageId}
          role="alert"
          className="mt-1.5 flex items-center gap-1 text-micro tracking-normal text-red"
        >
          <AlertCircle aria-hidden className="size-3 shrink-0" />
          {error}
        </p>
      ) : (
        hint && (
          <p id={messageId} className="mt-1.5 text-micro tracking-normal text-muted">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  hint?: ReactNode;
  error?: string;
  srOnlyLabel?: boolean;
  leadingIcon?: ReactNode;
  containerClassName?: string;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  {
    label,
    hint,
    error,
    srOnlyLabel,
    leadingIcon,
    containerClassName,
    className,
    required,
    ...props
  },
  ref,
) {
  return (
    <FieldShell
      label={label}
      hint={hint}
      error={error}
      required={required}
      srOnlyLabel={srOnlyLabel}
      className={containerClassName}
    >
      {({ controlId, describedBy }) => (
        <div className="relative">
          {leadingIcon && (
            <span
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-2 [&>svg]:size-4"
            >
              {leadingIcon}
            </span>
          )}
          <input
            ref={ref}
            id={controlId}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            required={required}
            className={cn(
              CONTROL_BASE,
              'h-[38px]',
              error ? CONTROL_STATE.error : CONTROL_STATE.normal,
              leadingIcon && 'pl-9',
              className,
            )}
            {...props}
          />
        </div>
      )}
    </FieldShell>
  );
});

export interface TextAreaFieldProps extends Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  'id'
> {
  label: string;
  hint?: ReactNode;
  error?: string;
  srOnlyLabel?: boolean;
  containerClassName?: string;
}

export const TextAreaField = forwardRef<HTMLTextAreaElement, TextAreaFieldProps>(
  function TextAreaField(
    {
      label,
      hint,
      error,
      srOnlyLabel,
      containerClassName,
      className,
      required,
      rows = 4,
      ...props
    },
    ref,
  ) {
    return (
      <FieldShell
        label={label}
        hint={hint}
        error={error}
        required={required}
        srOnlyLabel={srOnlyLabel}
        className={containerClassName}
      >
        {({ controlId, describedBy }) => (
          <textarea
            ref={ref}
            id={controlId}
            rows={rows}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            required={required}
            className={cn(
              CONTROL_BASE,
              'resize-y py-2.5 leading-relaxed',
              error ? CONTROL_STATE.error : CONTROL_STATE.normal,
              className,
            )}
            {...props}
          />
        )}
      </FieldShell>
    );
  },
);

const SELECT_CHEVRON = {
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%236b7890' stroke-width='2' stroke-linecap='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 10px center',
  backgroundSize: '16px',
} as const;

export interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  label: string;
  hint?: ReactNode;
  error?: string;
  srOnlyLabel?: boolean;
  containerClassName?: string;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
}

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  {
    label,
    hint,
    error,
    srOnlyLabel,
    containerClassName,
    className,
    options,
    placeholder,
    required,
    ...props
  },
  ref,
) {
  return (
    <FieldShell
      label={label}
      hint={hint}
      error={error}
      required={required}
      srOnlyLabel={srOnlyLabel}
      className={containerClassName}
    >
      {({ controlId, describedBy }) => (
        <select
          ref={ref}
          id={controlId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          required={required}
          className={cn(
            CONTROL_BASE,
            'h-[38px] cursor-pointer appearance-none pr-9',
            error ? CONTROL_STATE.error : CONTROL_STATE.normal,
            className,
          )}
          // The chevron is an inline style, not utility classes: tailwind-merge
          // reads the arbitrary bg-[…] values as one group and drops the
          // surface colour and the position, leaving a grey select with no arrow.
          style={SELECT_CHEVRON}
          {...props}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </FieldShell>
  );
});
