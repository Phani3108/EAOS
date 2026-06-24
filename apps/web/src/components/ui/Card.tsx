'use client';
import { ElementType, forwardRef, HTMLAttributes } from 'react';

/** Tiny classnames helper — joins truthy class fragments. */
function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export interface CardProps extends HTMLAttributes<HTMLElement> {
  /** Apply the `.card` hover lift (border + shadow). Defaults to true. */
  hoverable?: boolean;
  /** Add the standard `.card-body` inner padding. */
  padded?: boolean;
  /** Render as a different element (e.g. 'section', 'article', 'a'). */
  as?: ElementType;
}

/**
 * Typed wrapper over the existing `.card` CSS primitive (see globals.css).
 * Renders byte-identical classes; `hoverable={false}` opts out of the
 * hover lift by neutralizing the hover transition via an inline style.
 */
export const Card = forwardRef<HTMLElement, CardProps>(function Card(
  { hoverable = true, padded = false, as, className = '', children, style, ...rest },
  ref,
) {
  const Comp = (as ?? 'div') as ElementType;
  return (
    <Comp
      ref={ref}
      className={cx('card', padded && 'card-body', !hoverable && 'pointer-events-auto', className)}
      style={!hoverable ? { transition: 'none', ...style } : style}
      data-hoverable={hoverable ? undefined : 'false'}
      {...rest}
    >
      {children}
    </Comp>
  );
});

export default Card;
