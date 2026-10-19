/* eslint-disable @next/next/no-img-element -- tiny static logo, no optimisation needed */

/** The DETECTMiND app icon (same artwork as the Android launcher icon). */
export function Logo({ size = 32, className = '' }: { size?: number; className?: string }) {
  return <img src="/logo.png" alt="" width={size} height={size} className={`shrink-0 rounded-[22%] ${className}`} />
}
