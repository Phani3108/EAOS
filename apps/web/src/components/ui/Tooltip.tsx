'use client';
import { ReactNode, useState } from 'react';

export function Tooltip({ label, children, side = 'top' }: { label: string; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  const [show, setShow] = useState(false);
  const pos: Record<string, string> = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
    left: 'right-full top-1/2 -translate-y-1/2 mr-1.5',
    right: 'left-full top-1/2 -translate-y-1/2 ml-1.5',
  };
  return (
    <span className="relative inline-flex" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      {children}
      {show && <span className={`absolute z-50 whitespace-nowrap rounded-md bg-slate-900 text-white text-[11px] px-2 py-1 shadow-lg ${pos[side]}`}>{label}</span>}
    </span>
  );
}
export default Tooltip;
