/** Inline so the app ships no icon font and no third-party request. */

import type { SVGProps } from 'react'

type Props = SVGProps<SVGSVGElement>

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

export const DumbbellIcon = (p: Props) => (
  <svg {...base} {...p}>
    <path d="M6.5 6.5v11M3.5 9v6M17.5 6.5v11M20.5 9v6M6.5 12h11" />
  </svg>
)

export const HistoryIcon = (p: Props) => (
  <svg {...base} {...p}>
    <path d="M3 12a9 9 0 1 0 3-6.7M3 4v4h4M12 7v5l3.5 2" />
  </svg>
)

export const ChartIcon = (p: Props) => (
  <svg {...base} {...p}>
    <path d="M3 21h18M7 21V11M12 21V4M17 21v-6" />
  </svg>
)

export const SettingsIcon = (p: Props) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.2a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H1a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 2.6 7a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 7 2.6h.1A1.6 1.6 0 0 0 8.7 1V1a2 2 0 1 1 4 0v.1A1.6 1.6 0 0 0 15.3 2.6a1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.2a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1.2Z" />
  </svg>
)

export const PlusIcon = (p: Props) => (
  <svg {...base} {...p}>
    <path d="M12 5v14M5 12h14" />
  </svg>
)

export const CheckIcon = (p: Props) => (
  <svg {...base} {...p} strokeWidth={2.6}>
    <path d="m4 12.5 5.2 5.2L20 7" />
  </svg>
)

export const TrashIcon = (p: Props) => (
  <svg {...base} {...p}>
    <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
  </svg>
)

export const ChevronIcon = (p: Props) => (
  <svg {...base} {...p}>
    <path d="m9 5 7 7-7 7" />
  </svg>
)

export const BackIcon = (p: Props) => (
  <svg {...base} {...p}>
    <path d="M19 12H5M11 18l-6-6 6-6" />
  </svg>
)

export const TrophyIcon = (p: Props) => (
  <svg {...base} {...p}>
    <path d="M7 4h10v5a5 5 0 0 1-10 0V4ZM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3M9 20h6M12 14v6" />
  </svg>
)

export const FlameIcon = (p: Props) => (
  <svg {...base} {...p}>
    <path d="M12 3c3 4 5 6 5 9a5 5 0 0 1-10 0c0-1.4.6-2.6 1.5-3.7.4 1 1 1.7 1.8 2 .3-3 1-5.4 1.7-7.3Z" />
  </svg>
)

export const TimerIcon = (p: Props) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="13" r="8" />
    <path d="M12 9v4l2.5 2M9 2h6" />
  </svg>
)

export const SearchIcon = (p: Props) => (
  <svg {...base} {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
)

export const AlertIcon = (p: Props) => (
  <svg {...base} {...p}>
    <path d="M12 8v5M12 16.5v.5" />
    <circle cx="12" cy="12" r="9" />
  </svg>
)
