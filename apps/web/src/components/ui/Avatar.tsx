import { cn } from '../../lib/cn';
import { initials } from '../../lib/format';

export interface AvatarProps {
  name: string;
  src?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZES = {
  sm: 'size-7 text-[10px]',
  md: 'size-[38px] text-micro',
  lg: 'size-12 text-body',
} as const;

export function Avatar({ name, src, size = 'md', className }: AvatarProps) {
  return src ? (
    <img
      src={src}
      alt={name}
      className={cn('rounded-full border-2 border-white object-cover', SIZES[size], className)}
    />
  ) : (
    <span
      // The name is announced by whatever labels this control, so the circle
      // itself is decorative.
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center rounded-full border-2 border-white bg-avatar-gradient font-black text-[#254da9]',
        'shadow-[0_0_0_1px_#e5eaf1]',
        SIZES[size],
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
