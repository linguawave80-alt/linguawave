import Link from 'next/link';

export function WaveIcon({ size = 28 }: { size?: number | string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M2 13c3-6 6-6 9 0s6 6 9 0 6-6 10 0" />
      <path d="M2 21c3-6 6-6 9 0s6 6 9 0 6-6 10 0" opacity=".55" />
    </svg>
  );
}

/** Neon LinguaWave logo. `variant` is kept for backwards compatibility; both render the same mark. */
export default function Logo({ href = '/' }: { href?: string; variant?: 'default' | 'neon' }) {
  return (
    <Link href={href} className="lp-logo">
      <WaveIcon />
      <span>
        Lingua<b>Wave</b>
      </span>
    </Link>
  );
}
