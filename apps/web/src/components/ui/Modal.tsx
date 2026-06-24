'use client';
import { ReactNode, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { modalVariants } from '../../lib/animations';

export function Modal({ open, onClose, children, className = '' }: { open: boolean; onClose?: () => void; children: ReactNode; className?: string }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[250] flex items-center justify-center p-4 bg-black/40"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div variants={modalVariants} initial="hidden" animate="show" exit="exit"
            className={`bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden ${className}`}
            onClick={(e) => e.stopPropagation()}>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
export default Modal;
