import type { SVGProps } from 'react';

/** One consistent set of 1.5px-stroke line icons (24x24 grid). */
const PATHS = {
  mic: (<><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" /><path d="M19 11a7 7 0 0 1-14 0" /><path d="M12 18v3" /></>),
  sparkle: <path d="M12 3c.6 4.6 2.4 6.4 9 9-6.6 2.6-8.4 4.4-9 9-.6-4.6-2.4-6.4-9-9 6.6-2.6 8.4-4.4 9-9Z" />,
  'bar-chart': (<><path d="M5 20v-8" /><path d="M12 20V5" /><path d="M19 20v-9" /></>),
  users: (<><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" /><path d="M16 4.8a3.2 3.2 0 0 1 0 6.4" /><path d="M18 14.4c1.8.8 3 2.6 3 5.6" /></>),
  calendar: (<><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 10h17" /><path d="M8 3v4" /><path d="M16 3v4" /></>),
  trophy: (<><path d="M8 4h8v5a4 4 0 0 1-8 0V4Z" /><path d="M8 6H5v1.5A3.5 3.5 0 0 0 8.5 11" /><path d="M16 6h3v1.5a3.5 3.5 0 0 1-3.5 3.5" /><path d="M12 13v4" /><path d="M8.5 20h7" /><path d="M9.5 17h5" /></>),
  globe: (<><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3c2.6 2.8 3.9 5.8 3.9 9s-1.3 6.2-3.9 9c-2.6-2.8-3.9-5.8-3.9-9S9.4 5.8 12 3Z" /></>),
  send: (<><path d="M21 3 10.5 13.5" /><path d="M21 3l-6.5 18-4-7.5L3 9.5 21 3Z" /></>),
  flame: <path d="M12 3c.5 3-1 4.5-2.5 6.2C8 10.9 6.5 12.5 6.5 15a5.5 5.5 0 0 0 11 0c0-2-.9-3.4-2-4.6-.4 1.2-1.2 2-2 2.2C14 9.8 13.6 6 12 3Z" />,
  'trending-up': (<><path d="M3 17l6-6 4 4 8-8" /><path d="M15 7h6v6" /></>),
  'chevron-left': <path d="M15 6l-6 6 6 6" />,
  'chevron-right': <path d="M9 6l6 6-6 6" />,
  'chevron-up': <path d="M6 15l6-6 6 6" />,
  'chevron-down': <path d="M6 9l6 6 6-6" />,
  logout: (<><path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3" /><path d="M16 8l4 4-4 4" /><path d="M20 12H9" /></>),
  user: (<><circle cx="12" cy="8" r="3.5" /><path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7" /></>),
  menu: (<><path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h16" /></>),
  close: (<><path d="M6 6l12 12" /><path d="M18 6L6 18" /></>),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  clock: (<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>),
  target: (<><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></>),
  activity: (<><path d="M4 10v4" /><path d="M8 7v10" /><path d="M12 4v16" /><path d="M16 8v8" /><path d="M20 10v4" /></>),
  layers: (<><path d="M12 3 3 8l9 5 9-5-9-5Z" /><path d="M3 13l9 5 9-5" /></>),
  plane: <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2Z" />,
  'arrow-up': (<><path d="M12 19V5" /><path d="M6 11l6-6 6 6" /></>),
  message: <path d="M20 15a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9Z" />,
  briefcase: (<><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" /><path d="M3 13h18" /></>),
  bag: (<><path d="M5 8h14l-1 12H6L5 8Z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></>),
  scale: (<><path d="M12 4v16" /><path d="M7 20h10" /><path d="M5 7h14" /><path d="M5 7l-3 7a3 3 0 0 0 6 0L5 7Z" /><path d="M19 7l-3 7a3 3 0 0 0 6 0l-3-7Z" /></>),
  cross: (<><rect x="3.5" y="3.5" width="17" height="17" rx="4" /><path d="M12 8v8" /><path d="M8 12h8" /></>),
  refresh: (<><path d="M20 11a8 8 0 0 0-14.5-4.5L4 8" /><path d="M4 4v4h4" /><path d="M4 13a8 8 0 0 0 14.5 4.5L20 16" /><path d="M20 20v-4h-4" /></>),
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  // ── added for the AI Tutor redesign ──
  coffee: (<><path d="M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9Z" /><path d="M16 10.5h1.5a2.5 2.5 0 0 1 0 5H16" /><path d="M8 3.5V6" /><path d="M12 3.5V6" /></>),
  bubbles: (<><path d="M13 9V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h1v3l3-3" /><path d="M10 11.5A2.5 2.5 0 0 1 12.5 9H19a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-1v3l-3-3h-2.5a2.5 2.5 0 0 1-2.5-2.5v-4Z" /></>),
  stethoscope: (<><path d="M6 3v6a4 4 0 0 0 8 0V3" /><path d="M10 13v2a5 5 0 0 0 10 0v-2" /><circle cx="20" cy="11" r="2" /></>),
  bot: (<><rect x="4" y="8" width="16" height="11" rx="4" /><path d="M12 8V5.5" /><circle cx="12" cy="4" r="1" /><path d="M9 13v1.5" /><path d="M15 13v1.5" /></>),
  plus: (<><path d="M12 5v14" /><path d="M5 12h14" /></>),
  'arrow-right': (<><path d="M5 12h14" /><path d="M13 6l6 6-6 6" /></>),
  // ── added for Meet (video rooms) ──
  video: (<><rect x="3" y="6" width="13" height="12" rx="2.5" /><path d="M16 10.5l5-3v9l-5-3" /></>),
  'video-off': (<><path d="M10 6H5.5A2.5 2.5 0 0 0 3 8.5v7A2.5 2.5 0 0 0 5.5 18h8a2.5 2.5 0 0 0 2.5-2.5V14" /><path d="M16 10.5l5-3v9l-3.2-1.9" /><path d="M3 3l18 18" /></>),
  'mic-off': (<><path d="M15 9.3V6a3 3 0 0 0-5.9-.8" /><path d="M9 9v3a3 3 0 0 0 4.7 2.5" /><path d="M19 11a7 7 0 0 1-.9 3.4" /><path d="M5 11a7 7 0 0 0 10.4 6.1" /><path d="M12 18v3" /><path d="M3 3l18 18" /></>),
  monitor: (<><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8" /><path d="M12 16v4" /></>),
  hand: (<><path d="M8 12V5.5a1.5 1.5 0 0 1 3 0V11" /><path d="M11 10.5V4a1.5 1.5 0 0 1 3 0v6.5" /><path d="M14 10V5.5a1.5 1.5 0 0 1 3 0V13" /><path d="M17 9.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.5a5 5 0 0 1-4-2L4.6 13.4a1.5 1.5 0 0 1 2.3-1.9L8 12.7" /></>),
  captions: (<><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M10.5 10.3a2 2 0 1 0 0 3.4" /><path d="M17 10.3a2 2 0 1 0 0 3.4" /></>),
  'phone-off': <path d="M3.5 14.6c4.7-3.6 12.3-3.6 17 0 .6.5.7 1.4.1 2l-1.3 1.5a1.4 1.4 0 0 1-1.7.3l-2.3-1.2a1.4 1.4 0 0 1-.8-1.3V14.5c-1.7-.5-3.5-.5-5.2 0v1.4c0 .5-.3 1-.8 1.3l-2.3 1.2a1.4 1.4 0 0 1-1.7-.3l-1.3-1.5a1.4 1.4 0 0 1 .1-2Z" />,
  copy: (<><rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.5" /><path d="M15.5 8.5V6.5A2.5 2.5 0 0 0 13 4H6.5A2.5 2.5 0 0 0 4 6.5V13a2.5 2.5 0 0 0 2.5 2.5h2" /></>),
} as const;

export type IconName = keyof typeof PATHS;

type Props = { name: IconName; size?: number; strokeWidth?: number } & Omit<SVGProps<SVGSVGElement>, 'name'>;

export default function Icon({ name, size = 20, strokeWidth = 1.5, ...rest }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}
