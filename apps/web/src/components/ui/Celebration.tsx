'use client';
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const EMOJIS = ['⚡', '✨', '🎉', '🚀', '💫', '🟦', '🟩', '🔵'];

export function Celebration({ show, onDone }: { show: boolean; onDone?: () => void }) {
  const [particles] = useState(() =>
    Array.from({ length: 30 }, (_, i) => ({
      id: i,
      x: (Math.random() * 2 - 1) * 340,
      y: -(Math.random() * 280 + 120),
      r: Math.random() * 420,
      e: EMOJIS[i % EMOJIS.length],
      d: Math.random() * 0.3,
    })),
  );
  useEffect(() => {
    if (show && onDone) { const t = setTimeout(onDone, 2600); return () => clearTimeout(t); }
  }, [show, onDone]);

  return (
    <AnimatePresence>
      {show && (
        <div className="fixed inset-0 z-[400] pointer-events-none flex items-center justify-center">
          {particles.map((p) => (
            <motion.span key={p.id}
              initial={{ opacity: 1, x: 0, y: 0, scale: 0.6, rotate: 0 }}
              animate={{ opacity: 0, x: p.x, y: p.y, scale: 1.15, rotate: p.r }}
              transition={{ duration: 1.9, delay: p.d, ease: 'easeOut' }}
              className="absolute text-2xl">{p.e}</motion.span>
          ))}
        </div>
      )}
    </AnimatePresence>
  );
}
export default Celebration;
