export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`bg-shimmer rounded-md ${className}`} aria-hidden="true" />;
}
export default Skeleton;
