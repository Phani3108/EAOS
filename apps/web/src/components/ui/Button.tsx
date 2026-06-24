'use client';
import { ButtonHTMLAttributes, forwardRef, ReactNode } from 'react';
import { motion } from 'framer-motion';

/** Tiny classnames helper — joins truthy class fragments. */
function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/**
 * Native button props minus the drag/animation handlers whose signatures
 * collide with framer-motion's motion props — dropping them keeps the spread
 * onto `motion.button` type-safe under strict mode without losing ergonomics.
 */
type NativeButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart' | 'onAnimationEnd'
>;

export interface ButtonProps extends NativeButtonProps {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md';
  loading?: boolean;
  leftIcon?: ReactNode;
}

/**
 * Typed wrapper over the existing `.btn` CSS primitives (see globals.css).
 * Renders byte-identical classes; framer-motion `whileTap` is SSR-safe because
 * motion.button degrades to a plain button on the server.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, leftIcon, className = '', disabled, children, ...rest },
  ref,
) {
  const variantClass =
    variant === 'secondary' ? 'btn-secondary' : variant === 'ghost' ? 'btn-ghost' : 'btn-primary';
  return (
    <motion.button
      ref={ref}
      whileTap={{ scale: 0.97 }}
      className={cx('btn', variantClass, size === 'sm' && 'btn-sm', className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <span
          className="inline-block h-3.5 w-3.5 rounded-full border-2 border-current border-r-transparent animate-spin"
          aria-hidden="true"
        />
      ) : (
        leftIcon
      )}
      {children}
    </motion.button>
  );
});

export default Button;
