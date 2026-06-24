'use client';
import { forwardRef, HTMLAttributes } from 'react';

/** Tiny classnames helper — joins truthy class fragments. */
function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

const TONE_CLASS: Record<BadgeTone, string> = {
  success: 'badge-success',
  warning: 'badge-warning',
  danger: 'badge-danger',
  info: 'badge-info',
  neutral: 'badge-neutral',
};

/**
 * Typed wrapper over the existing `.badge` CSS primitives (see globals.css).
 * Renders byte-identical classes for each tone.
 */
export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { tone = 'neutral', className = '', children, ...rest },
  ref,
) {
  return (
    <span ref={ref} className={cx('badge', TONE_CLASS[tone], className)} {...rest}>
      {children}
    </span>
  );
});

export default Badge;
