/** WorldGraph mark: a globe whose meridian is a graph edge between two nodes. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden fill="none">
      <circle cx="16" cy="16" r="12.5" stroke="currentColor" strokeOpacity="0.55" strokeWidth="1.6" />
      <ellipse
        cx="16"
        cy="16"
        rx="5.5"
        ry="12.5"
        stroke="currentColor"
        strokeOpacity="0.35"
        strokeWidth="1.4"
      />
      <path d="M3.8 12.5h24.4M3.8 19.5h24.4" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.2" />
      <path d="M9 22.5 22.5 9.5" stroke="var(--forecast)" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="9" cy="22.5" r="2.6" fill="var(--risk)" />
      <circle cx="22.5" cy="9.5" r="2.6" fill="var(--opportunity)" />
    </svg>
  );
}
