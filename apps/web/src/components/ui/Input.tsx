'use client';
import { forwardRef, InputHTMLAttributes } from 'react';

/** Tiny classnames helper — joins truthy class fragments. */
function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Render in an error state (red border) without altering layout. */
  error?: boolean;
}

/**
 * Typed wrapper over the existing `.input` CSS primitive (see globals.css).
 * Renders byte-identical classes; `error` applies a danger border via inline
 * style so the base `.input` rules stay untouched.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { error = false, className = '', style, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cx('input', className)}
      aria-invalid={error || undefined}
      style={error ? { borderColor: 'var(--danger)', ...style } : style}
      {...rest}
    />
  );
});

export default Input;
