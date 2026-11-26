const base = { width: 21, height: 21, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };

export const StarIcon = (p) => (
  <svg {...base} fill="currentColor" strokeWidth={1.4} {...p}><path d="m12 3 2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.5 6.6 19.5l1.2-6L3.3 9.3l6.1-.7L12 3Z" /></svg>
);
export const HomeIcon = (p) => (
  <svg {...base} {...p}><path d="M3 11.5 12 4l9 7.5" /><path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9" /></svg>
);
export const SearchIcon = (p) => (
  <svg {...base} {...p}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
);
export const LibraryIcon = (p) => (
  <svg {...base} {...p}>
    <rect x="3" y="5" width="4.5" height="15" rx="1" />
    <rect x="9.5" y="3" width="4.5" height="17" rx="1" />
    <rect x="16" y="5" width="4.5" height="15" rx="1" transform="rotate(-12 18.25 12.5)" />
    <path d="M3 9h4.5M9.5 8h4.5" />
  </svg>
);
export const BarChartIcon = (p) => (
  <svg {...base} {...p}><path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-7" /><path d="M22 20H2" /></svg>
);
export const AlertIcon = (p) => (
  <svg {...base} {...p}><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>
);
export const SettingsIcon = (p) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
);
export const ChevronLeft = (p) => (
  <svg {...base} {...p}><path d="m15 18-6-6 6-6" /></svg>
);
export const ChevronRight = (p) => (
  <svg {...base} {...p}><path d="m9 18 6-6-6-6" /></svg>
);
export const DownloadIcon = (p) => (
  <svg {...base} {...p}><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></svg>
);
export const HeartIcon = (p) => (
  <svg {...base} {...p}><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z" /></svg>
);
export const CalendarIcon = (p) => (
  <svg {...base} {...p}><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
);
export const PlayIcon = (p) => (
  <svg {...base} {...p} fill="currentColor" stroke="none"><path d="M8 5v14l11-7z" /></svg>
);
export const PauseIcon = (p) => (
  <svg {...base} {...p}><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
);
export const StopIcon = (p) => (
  <svg {...base} {...p} fill="currentColor" stroke="none"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
);
export const FolderIcon = (p) => (
  <svg {...base} {...p}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /></svg>
);
export const FolderPlusIcon = (p) => (
  <svg {...base} {...p}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    <path d="M12 11v6M9 14h6" />
  </svg>
);
export const FolderMinusIcon = (p) => (
  <svg {...base} {...p}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    <path d="M9 14h6" />
  </svg>
);
export const TrashIcon = (p) => (
  <svg {...base} {...p}><path d="M3 6h18" /><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" /><path d="M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6" /></svg>
);
export const LogOutIcon = (p) => (
  <svg {...base} {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></svg>
);
export const UserIcon = (p) => (
  <svg {...base} {...p}><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></svg>
);
export const PlusIcon = (p) => (
  <svg {...base} {...p}><path d="M12 5v14M5 12h14" /></svg>
);
export const LifeBuoyIcon = (p) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="4" /><path d="m4.9 4.9 4.2 4.2M19.1 4.9l-4.2 4.2M4.9 19.1l4.2-4.2M19.1 19.1l-4.2-4.2" /></svg>
);
export const MinimizeIcon = (p) => (
  <svg width="14" height="14" viewBox="0 0 12 12" {...p}><rect x="1" y="5.5" width="10" height="1.2" fill="currentColor" /></svg>
);
export const MaximizeIcon = (p) => (
  <svg width="14" height="14" viewBox="0 0 12 12" {...p}><rect x="1.5" y="1.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>
);
export const CloseIcon = (p) => (
  <svg width="14" height="14" viewBox="0 0 12 12" {...p}><path d="M1 1l10 10M11 1 1 11" stroke="currentColor" strokeWidth="1.3" /></svg>
);
export const BoxIcon = (p) => (
  <svg {...base} {...p}><path d="M21 8 12 3 3 8l9 5 9-5Z" /><path d="M3 8v8l9 5 9-5V8" /><path d="M12 13v8" /></svg>
);
export const RefreshIcon = (p) => (
  <svg {...base} {...p}><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 4v5h-5" /></svg>
);
export const MoreVerticalIcon = (p) => (
  <svg {...base} {...p} fill="currentColor" stroke="none"><circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" /></svg>
);
export const GearIcon = SettingsIcon;
export const UploadIcon = (p) => (
  <svg {...base} {...p}><path d="M12 21V9" /><path d="m7 14 5-5 5 5" /><path d="M5 3h14" /></svg>
);
export const FileTextIcon = (p) => (
  <svg {...base} {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6" /><path d="M9 13h6M9 17h6" /></svg>
);
export const GlobeIcon = (p) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20Z" /></svg>
);
export const MapIcon = (p) => (
  <svg {...base} {...p}><path d="M9 4 3 6.5v13L9 17l6 3 6-2.5v-13L15 7Z" /><path d="M9 4v13M15 7v13" /></svg>
);
export const KeyIcon = (p) => (
  <svg {...base} {...p}><circle cx="8" cy="15" r="4" /><path d="m10.5 12.5 8-8M16.5 6.5 19 9M13.5 9.5 16 12" /></svg>
);
export const EditIcon = (p) => (
  <svg {...base} {...p}><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
);
export const CopyIcon = (p) => (
  <svg {...base} {...p}><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
);
export const WrenchIcon = (p) => (
  <svg {...base} {...p}><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L2 19l3 3 7.3-7.3a4 4 0 0 0 5.4-5.4l-2.8 2.8-2-2Z" /></svg>
);
export const InfoIcon = (p) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>
);
export const CheckIcon = (p) => (
  <svg {...base} {...p}><path d="M20 6 9 17l-5-5" /></svg>
);
export const LockIcon = (p) => (
  <svg {...base} {...p}><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M7 10V7a5 5 0 0 1 10 0v3" /></svg>
);
export const ExternalLinkIcon = (p) => (
  <svg {...base} {...p}><path d="M14 4h6v6" /><path d="M20 4 10 14" /><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6" /></svg>
);
export const ChevronDownIcon = (p) => (
  <svg {...base} {...p}><path d="m6 9 6 6 6-6" /></svg>
);
export const LayersIcon = (p) => (
  <svg {...base} {...p}><path d="m12 2 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5" /><path d="m3 17 9 5 9-5" /></svg>
);
export const DatabaseIcon = (p) => (
  <svg {...base} {...p}><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5" /><path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3" /></svg>
);
export const ShirtIcon = (p) => (
  <svg {...base} {...p}><path d="M8 3 4 6l2 3 2-1v11a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V8l2 1 2-3-4-3-1.5 1.5a3 3 0 0 1-3 0L8 3Z" /></svg>
);
export const CameraIcon = (p) => (
  <svg {...base} {...p}><path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" /><circle cx="12" cy="13.5" r="3.5" /></svg>
);
export const DownloadCloudIcon = (p) => (
  <svg {...base} {...p}><path d="M12 12v7m0 0-3-3m3 3 3-3" /><path d="M17.5 17A4.5 4.5 0 0 0 16 8.25 6 6 0 0 0 4.5 10 4 4 0 0 0 5 18" /></svg>
);
export const PinIcon = (p) => (
  <svg {...base} {...p} fill="currentColor" stroke="none"><path d="M14.5 2.5a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4l-1.3 1.3a1 1 0 0 1-1.4 0l-.3-.3-3 3 .6 3.9a1 1 0 0 1-.28.9l-1 1a1 1 0 0 1-1.42 0L9.5 15l-4.8 4.8a1 1 0 0 1-1.4-1.4L8.1 13.6l-4.3-4.3a1 1 0 0 1 0-1.42l1-1a1 1 0 0 1 .9-.28l3.9.6 3-3-.3-.3a1 1 0 0 1 0-1.4Z" /></svg>
);
export const ServerIcon = (p) => (
  <svg {...base} {...p}><rect x="3" y="4" width="18" height="6" rx="1.5" /><rect x="3" y="14" width="18" height="6" rx="1.5" /><circle cx="7" cy="7" r="1" fill="currentColor" stroke="none" /><circle cx="7" cy="17" r="1" fill="currentColor" stroke="none" /></svg>
);
export const TerminalIcon = (p) => (
  <svg {...base} {...p}><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></svg>
);
