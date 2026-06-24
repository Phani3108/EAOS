'use client';
import { ButtonHTMLAttributes, forwardRef } from 'react';

/** Tiny classnames helper — joins truthy class fragments. */
function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export interface TabProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
}

/**
 * Typed wrapper over the existing `.tab` CSS primitive (see globals.css).
 * Renders byte-identical classes; `active` toggles the `.active` modifier.
 */
export const Tab = forwardRef<HTMLButtonElement, TabProps>(function Tab(
  { active = false, className = '', type, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      role="tab"
      aria-selected={active}
      className={cx('tab', active && 'active', className)}
      {...rest}
    >
      {children}
    </button>
  );
});

export default Tab;
