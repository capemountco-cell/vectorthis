export function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="24" height="24" rx="7" fill="currentColor" />
      <path d="M7 18 C 9 9, 17 9, 19 18" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="7" cy="18" r="2" fill="white" />
      <circle cx="19" cy="18" r="2" fill="white" />
    </svg>
  );
}
