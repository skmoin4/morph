import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * The project's own font sizes (see tailwind.config.ts). Without this,
 * tailwind-merge cannot tell `text-metric` from a text colour, and drops it
 * whenever a colour such as `text-green` is merged after it.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        { text: ['micro', 'label', 'pill', 'sub', 'body', 'title', 'metric', 'display'] },
      ],
    },
  },
});

/** Merges class names, with later Tailwind utilities winning over earlier ones. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
