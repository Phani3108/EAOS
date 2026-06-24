/**
 * Shared framer-motion presets for the EAOS UI rehaul.
 *
 * Use these `Variants`/transitions so motion stays consistent and declarative.
 * Mount <MotionConfig reducedMotion="user"> near the app root so framer-motion
 * automatically honors prefers-reduced-motion (CSS keyframes are guarded in globals.css).
 */
import type { Variants, Transition } from 'framer-motion';

export const springSoft: Transition = { type: 'spring', stiffness: 260, damping: 30 };
export const springSnappy: Transition = { type: 'spring', stiffness: 420, damping: 32 };

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.3 } },
};

export const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] } },
};

export const slideInLeft: Variants = {
  hidden: { opacity: 0, x: -24 },
  show: { opacity: 1, x: 0, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] } },
};

export const slideInRight: Variants = {
  hidden: { opacity: 0, x: 24 },
  show: { opacity: 1, x: 0, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] } },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  show: { opacity: 1, scale: 1, transition: springSoft },
  exit: { opacity: 0, scale: 0.97, transition: { duration: 0.15 } },
};

/** Parent that staggers its children's `show` transition. Pair with `staggerItem`. */
export function staggerContainer(stagger = 0.06, delayChildren = 0): Variants {
  return {
    hidden: {},
    show: { transition: { staggerChildren: stagger, delayChildren } },
  };
}
export const staggerItem: Variants = fadeInUp;

/** Section/page swap inside <AnimatePresence>. */
export const pageTransition: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.25 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

/** Toast enter/exit. */
export const toastVariants: Variants = {
  hidden: { opacity: 0, y: 12, scale: 0.98 },
  show: { opacity: 1, y: 0, scale: 1, transition: springSnappy },
  exit: { opacity: 0, x: 24, transition: { duration: 0.18 } },
};

/** Modal/dialog enter/exit (use with a fade backdrop). */
export const modalVariants: Variants = {
  hidden: { opacity: 0, scale: 0.97, y: 8 },
  show: { opacity: 1, scale: 1, y: 0, transition: springSoft },
  exit: { opacity: 0, scale: 0.98, y: 6, transition: { duration: 0.15 } },
};
