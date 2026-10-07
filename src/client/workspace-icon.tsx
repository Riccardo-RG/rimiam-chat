import type { CSSProperties } from "react";

const paths = {
  home: "m3 10 9-7 9 7M5 9v11h5v-6h4v6h5V9",
  chat: "M21 11a8 8 0 0 1-8 8H7l-4 3V11a9 9 0 0 1 18 0ZM8 10h8M8 14h5",
  context: "M5 3h14v18H5zM9 7h6M9 11h6M9 15h4",
  work: "M9 5V3h6v2M3 7h18v13H3zM3 12h18M10 11v3h4v-3",
  files: "M3 7V4h7l2 3h9v13H3z",
  people:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.9M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM16 3a4 4 0 0 1 0 8",
  goal: "M12 3v18M3 12h18M19 12a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z",
  plus: "M12 5v14M5 12h14",
  arrow: "M5 12h14m-6-6 6 6-6 6",
  send: "m4 4 17 8-17 8 3-8-3-8Zm3 8h14",
  menu: "M4 6h16M4 12h16M4 18h16",
  close: "m6 6 12 12M6 18 18 6",
  spark: "m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4L12 3Z",
  chevron: "m9 5 7 7-7 7",
  calendar: "M4 5h16v16H4zM8 3v4M16 3v4M4 10h16",
  mail: "M3 5h18v14H3zM3 5l9 7 9-7",
  settings: "M4 7h16M4 17h16M9 4v6M15 14v6",
  branch: "M6 3v12a3 3 0 0 0 3 3h9M6 8h9a3 3 0 0 0 3-3V3M15 15l3 3-3 3",
} as const;
export type WorkspaceIconName = keyof typeof paths;
export function WorkspaceIcon({
  name,
  className = "nav-icon",
  style,
}: {
  name: WorkspaceIconName;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      className={className}
      style={style}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={paths[name]} />
    </svg>
  );
}
