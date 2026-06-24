import { ReactNode } from 'react';

export function EmptyState({ icon = '✨', title, description, action }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-6">
      <div className="w-12 h-12 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-center text-2xl mb-3">{icon}</div>
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      {description && <p className="text-[13px] text-slate-500 mt-1 max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
export default EmptyState;
