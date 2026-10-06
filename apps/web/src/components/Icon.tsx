const PATHS = {
  upload: "M12 16V4m0 0-4.5 4.5M12 4l4.5 4.5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3",
  file: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Zm0 0v5h5M9 13h6M9 17h4",
  check: "m5 12.5 4.5 4.5L19 7.5",
  alert: "M12 9v4m0 3.5v.01M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0Z",
  info: "M12 11v5m0-8.5v.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  download: "M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M4 19h16",
  copy: "M9 9V5.5A1.5 1.5 0 0 1 10.5 4h8A1.5 1.5 0 0 1 20 5.5v8a1.5 1.5 0 0 1-1.5 1.5H15M5.5 9h8A1.5 1.5 0 0 1 15 10.5v8a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 4 18.5v-8A1.5 1.5 0 0 1 5.5 9Z",
  trash: "M4 7h16M10 11v6m4-6v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3",
  clock: "M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  refresh: "M20 11a8 8 0 0 0-14.9-3.5M4 4v4h4m-4 5a8 8 0 0 0 14.9 3.5M20 20v-4h-4",
  close: "M6 6l12 12M18 6 6 18",
  shield: "M12 3 5 6v5c0 4.4 3 8.4 7 10 4-1.6 7-5.6 7-10V6l-7-3Zm-3 9 2 2 4-4",
  plus: "M12 5v14M5 12h14",
  spark: "M12 3v4m0 10v4M3 12h4m10 0h4M6.3 6.3l2.8 2.8m5.8 5.8 2.8 2.8m0-11.4-2.8 2.8m-5.8 5.8-2.8 2.8",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20 }: { readonly name: IconName; readonly size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
