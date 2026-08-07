import type { SVGProps } from 'react'

type SoftmatrixMarkProps = Omit<SVGProps<SVGSVGElement>, 'width' | 'height'> & {
  size?: number
}

/** Decorative, theme-aware Softmatrix product mark used when a deployment has no custom logo. */
export default function SoftmatrixMark({
  size = 24,
  ...props
}: SoftmatrixMarkProps) {
  return (
    <svg
      {...props}
      data-softmatrix-mark=""
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="3" y="3" width="4" height="4" rx="1" />
      <rect x="10" y="3" width="4" height="4" rx="1" />
      <rect x="17" y="3" width="4" height="4" rx="1" />
      <rect x="3" y="10" width="4" height="4" rx="1" />
      <rect x="10" y="10" width="4" height="4" rx="1" />
      <rect x="10" y="17" width="4" height="4" rx="1" />
      <rect x="17" y="17" width="4" height="4" rx="1" />
    </svg>
  )
}
