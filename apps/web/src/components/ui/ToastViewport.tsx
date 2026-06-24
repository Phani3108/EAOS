'use client';
/** Global toast overlay — shows NEW store notifications transiently; the bell keeps history. */
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useEAOSStore } from '../../store/eaos-store';
import { toastVariants } from '../../lib/animations';

const ICONS: Record<string, string> = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
const STYLES: Record<string, string> = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  error: 'border-red-200 bg-red-50 text-red-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  info: 'border-blue-200 bg-blue-50 text-blue-800',
};

export function ToastViewport() {
  const notifications = useEAOSStore((s) => s.notifications);
  const [visible, setVisible] = useState<string[]>([]);
  const seen = useRef<Set<string> | null>(null);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    // First render: treat existing notifications as already-seen (don't toast seed data).
    if (seen.current === null) { seen.current = new Set(notifications.map((n) => n.id)); return; }
    for (const n of notifications) {
      if (seen.current.has(n.id)) continue;
      seen.current.add(n.id);
      setVisible((v) => [n.id, ...v].slice(0, 4));
      const ms = n.type === 'error' ? 8000 : 4500;
      timers.current[n.id] = setTimeout(() => setVisible((v) => v.filter((id) => id !== n.id)), ms);
    }
  }, [notifications]);

  useEffect(() => () => { Object.values(timers.current).forEach(clearTimeout); }, []);

  const dismiss = (id: string) => { setVisible((v) => v.filter((x) => x !== id)); clearTimeout(timers.current[id]); };

  return (
    <div className="fixed bottom-4 right-4 z-[300] flex flex-col gap-2 w-[360px] max-w-[calc(100vw-2rem)] pointer-events-none">
      <AnimatePresence initial={false}>
        {visible.map((id) => {
          const n = notifications.find((x) => x.id === id);
          if (!n) return null;
          return (
            <motion.div key={id} variants={toastVariants} initial="hidden" animate="show" exit="exit" layout
              className={`pointer-events-auto rounded-xl border shadow-lg px-4 py-3 flex items-start gap-3 ${STYLES[n.type] ?? STYLES.info}`}>
              <span className="text-sm mt-0.5">{ICONS[n.type] ?? ICONS.info}</span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold truncate">{n.title}</p>
                {n.message && <p className="text-[12px] opacity-80 mt-0.5 line-clamp-2">{n.message}</p>}
              </div>
              <button onClick={() => dismiss(id)} className="opacity-50 hover:opacity-100 text-sm flex-shrink-0" aria-label="Dismiss">×</button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
export default ToastViewport;
