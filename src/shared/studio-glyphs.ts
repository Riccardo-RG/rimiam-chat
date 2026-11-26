import {
  spacePaths,
  chatPaths,
  attachPath,
  sendPaths,
} from "./conversation-glyphs";
import { emmeMarkPaths } from "./emme-mark";

type Paint = {
  fill?: "none";
  fillRule?: "evenodd";
  stroke?: "currentColor";
  strokeWidth?: number;
  strokeLinecap?: "round" | "butt";
  strokeLinejoin?: "round";
  opacity?: number;
  transform?: string;
};

export type StudioShape = Paint &
  ({ d: string } | { cx: number; cy: number; r: number });
const mark = emmeMarkPaths.map((d) => ({ d, fillRule: "evenodd" as const }));
const starPath =
  "m12 3 2.75 5.75 6.25.9-4.5 4.45 1.05 6.3L12 17.45l-5.55 2.95 1.05-6.3L3 9.65l6.25-.9Z";
export const studioGlyphs = {
  favorite: [
    {
      d: starPath,
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.5,
      strokeLinejoin: "round",
    },
  ],
  favoriteSelected: [
    {
      d: starPath,
      stroke: "currentColor",
      strokeWidth: 1.5,
      strokeLinejoin: "round",
    },
  ],
  mark: mark,
  spark: mark,
  home: [
    { d: "m2 7 11.8-5.2 8.1 3.5-11.8 5.2Z" },
    { d: "M2 8.8l7.2 3.1v9.5L2 18.3Z", opacity: 0.64 },
    { d: "m11 11.9 11-4.8v9.8l-3.3 1.5v-6.3L14.4 14v6.2L11 21.7Z" },
  ],
  menu: [
    {
      d: "M5.2 3.5h13.6a3.1 3.1 0 0 1 3.1 3.1v10.8a3.1 3.1 0 0 1-3.1 3.1H5.2a3.1 3.1 0 0 1-3.1-3.1V6.6a3.1 3.1 0 0 1 3.1-3.1Zm3.9.5v16",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.65,
    },
    {
      d: "M4.7 8h1.9m-1.9 3h1.9",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.65,
      strokeLinecap: "round",
      opacity: 0.75,
    },
  ],
  today: [
    {
      d: "M3 8V5.9c0-1 .8-1.8 1.8-1.8h1.5V2h2.2v2.1h7V2h2.2v2.1h1.5c1 0 1.8.8 1.8 1.8V8Z",
    },
    {
      fillRule: "evenodd",
      d: "M3 9.5h18v4.7l-6.4 6.9H5a2 2 0 0 1-2-2Zm3.4 7.1h9.2a4.6 4.6 0 0 0-9.2 0Z",
    },
    { d: "M16.7 21.1 21 16.5v3a1.6 1.6 0 0 1-1.6 1.6Z", opacity: 0.62 },
  ],
  space: spacePaths.map((d) => ({
    d,
    fill: "none" as const,
    stroke: "currentColor" as const,
    strokeWidth: 2.15,
    strokeLinecap: "round" as const,
  })),
  chat: [
    { d: chatPaths[0], opacity: 0.63 },
    { d: chatPaths[1], fillRule: "evenodd" },
  ],
  settings: [
    {
      fillRule: "evenodd",
      d: "M12 1.7c2.5 0 4.1 1.7 4.1 4.1 0 1.4-.6 2.6-1.7 3.4L8.6 19.6l-4.7 2.7 6.3-12.9A4.2 4.2 0 0 1 7.9 5.8c0-2.4 1.7-4.1 4.1-4.1Zm0 2.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z",
    },
    { d: "m15.4 9.7 5 12.7-4-3.2-3-6Z", opacity: 0.75 },
    { d: "M8.9 13.8c2 1.3 4.2 1.6 6.6.9l.7 1.6c-3 .9-5.9.5-8.2-1Z" },
  ],
  invite: [
    {
      d: "M12.5 7.2a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM1.6 19.9c0-4.7 3.1-7.5 7.1-7.5a7.25 7.25 0 0 1 6.5 3.7l-4.5 4.4H1.6Z",
    },
    { d: "m13 20.5 3-3c.3.9.5 1.9.5 3Z", opacity: 0.7 },
    { d: "M17.2 3h2.4v3h3v2.4h-3v3h-2.4v-3h-3V6h3Z" },
  ],
  link: [
    {
      d: "m9 15 6-6M8.4 10.1l-2.2 2.2a4 4 0 0 0 5.6 5.7l2.2-2.2M15.6 13.9l2.2-2.2A4 4 0 1 0 12.2 6l-2.2 2.2",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 2,
      strokeLinecap: "round",
    },
  ],
  files: [
    {
      d: "M2.2 6c0-1 .8-1.8 1.8-1.8h5.5l2.4 2.5h6.4c.9 0 1.7.8 1.7 1.7v.8H7.1c-1.7 0-2.4.8-3 2.3l-1.9 4.9Z",
      opacity: 0.61,
    },
    {
      d: "M7.2 10.9h13.6c.9 0 1.4.6 1.1 1.5l-2.6 6.7c-.2.7-.9 1.2-1.7 1.2H2.8l3.1-8.1c.3-.8.7-1.3 1.3-1.3Z",
    },
  ],
  goal: [
    { d: "M4 21.6V2.9h2.1v18.7Z" },
    { d: "M7.7 4h14l-3.5 3.5 2.3 3.4H12l-4.3 3Z" },
    { d: "m12.7 12.4 4.2 0-4.2 3.1Z", opacity: 0.66 },
  ],
  camera: [
    {
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.9,
      strokeLinejoin: "round",
      d: "M2.5 8.2h4.8l1.9-3.1h5.6l2 3.1h4.7v11.3h-19z",
    },
    {
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.9,
      strokeLinejoin: "round",
      cx: 12,
      cy: 13.3,
      r: 3.4,
    },
  ],
  microphone: [
    { d: "M8 6a4 4 0 0 1 8 0v5a4 4 0 0 1-8 0z" },
    {
      d: "M5 10.3v.9a7 7 0 0 0 14 0v-.9M12 18.2v3.4M8.6 21.6h6.8",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.8,
      strokeLinecap: "round",
    },
  ],
  phone: [
    {
      d: "m4.7 2.7 2.2-.5a1.5 1.5 0 0 1 1.7.8l2 3.9c.3.6.2 1.3-.3 1.8l-1.7 1.6a13.3 13.3 0 0 0 5.1 5.1l1.6-1.7c.5-.5 1.2-.6 1.8-.3l3.9 2c.6.3 1 1 .8 1.7l-.5 2.2c-.4 1.5-1.7 2.6-3.3 2.4C9.8 20.9 3.1 14.2 2.3 6c-.2-1.6.9-2.9 2.4-3.3Z",
    },
  ],
  attach: [
    {
      d: attachPath,
      transform: "rotate(38 12 12)",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.9,
      strokeLinecap: "butt",
    },
  ],
  send: sendPaths.map((d, i) => ({ d, opacity: i === 2 ? 0.65 : 1 })),
  check: [{ d: "M2.4 12.3 5.1 10l4.3 4L19 4.9h3.3l-12.8 15Z" }],
  key: [
    {
      fillRule: "evenodd",
      d: "M8.3 3.6a6.7 6.7 0 0 1 6.4 8.7l6.6 6.6v2.5h-3.9v-2.7h-2.6v-2.5l-2.4-2.4A6.7 6.7 0 1 1 8.3 3.6Zm0 2.3a4.4 4.4 0 1 0 0 8.8 4.4 4.4 0 0 0 0-8.8Zm0 1.6a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6Z",
    },
  ],
  signout: [
    {
      d: "M3 3h10v2.2H5.2v13.6H13V21H3zM15.8 6.5l5.8 5.5-5.8 5.5-1.6-1.6 3.1-2.8H9.2v-2.2h8.1l-3.1-2.8z",
    },
  ],
  theme: [
    {
      fillRule: "evenodd",
      d: "M12 2.4a9.6 9.6 0 1 1 0 19.2 9.6 9.6 0 0 1 0-19.2Zm5.2 3.8A7.9 7.9 0 0 0 6.2 17.3c1.8-.3 4.4-1.8 6.9-4.2 2.4-2.5 3.9-5.1 4.1-6.9Z",
    },
  ],
  chevron: [{ d: "M7 4.7 16.8 12 7 19.3v-3.1l5.5-4.2L7 7.8Z" }],
  close: [
    {
      d: "M4 5.7 5.7 4l6.3 6.3 6.3-6.3L20 5.7 13.7 12l6.3 6.3-1.7 1.7-6.3-6.3L5.7 20 4 18.3l6.3-6.3Z",
    },
  ],
  image: [
    {
      fillRule: "evenodd",
      d: "M2 4h17.6L22 6.4v13.5H2Zm2.2 2.2v10.9l4.5-4.7 3.8 3.4 2.6-2.7 4.7 4.2V7.4l-1.2-1.2Z",
    },
    { cx: 14.5, cy: 9.6, r: 1.7, opacity: 0.68 },
  ],
  guide: [
    {
      d: "M2 3.7h4.2c1.8 0 3.5.6 5 1.7v15.1a8.7 8.7 0 0 0-5-1.5H2Z",
      opacity: 0.68,
    },
    {
      fillRule: "evenodd",
      d: "M12.8 5.4a8 8 0 0 1 5-1.7h4.1V19h-4.1c-2.1 0-3.6.5-5 1.5Zm2.1 2.3v1.7h3.6l1.6-1.7Z",
    },
  ],
  context: [
    { d: "m1.8 7.7 10.3-5.9 10.1 5.9-10.1 5.8Z" },
    { d: "m2 11.4 10.1 5.7 10-5.7v2.7l-10 5.6L2 14.1Z", opacity: 0.66 },
    { d: "m2 16.1 10.1 5.6 10-5.6v2.1l-10 5.7L2 18.2Z" },
  ],
  work: [
    {
      fillRule: "evenodd",
      d: "M8 5.9V4.4L9.8 2.5h4.6l1.7 1.8v1.6h3.6l2.1 2.2v3.5H2.2V7.8l1.9-1.9Zm2.2 0h3.7V4.6h-3.7Z",
    },
    { d: "M2.2 13.3H9v2.1h6v-2.1h6.8v5.2l-2.2 2.3H2.2Z", opacity: 0.75 },
  ],
  people: [
    {
      d: "M12.5 7.2a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM1.6 20.5v-.6c0-4.6 3-7.5 7.1-7.5s7.1 2.9 7.1 7.5v.6Z",
    },
    {
      d: "M14.4 4.1a3.6 3.6 0 1 1 0 6.3 5.3 5.3 0 0 0 0-6.3Zm.1 8.7c3.5-.9 7.9 1.7 7.9 6v1.7h-4.8v-.6c0-3-1.1-5.4-3.1-7.1Z",
      opacity: 0.67,
    },
  ],
  history: [
    {
      d: "M2.4 3.5 5.1 6a9.2 9.2 0 1 1-1.3 10.9l2.1-1a6.9 6.9 0 1 0 1-8.2l2.9 2.6H2.4Z",
    },
    { d: "M11 7h2.1v4.2l3.4 2.4-1.2 1.7-4.3-3Z", opacity: 0.76 },
  ],
  bell: [
    {
      d: "M10.7 3.1V1.9h2.6v1.2a6.2 6.2 0 0 1 4.9 6.1v4.5l2.6 3.5v1.2H3.2v-1.2l2.6-3.5V9.2a6.2 6.2 0 0 1 4.9-6.1Z",
    },
    { d: "M9.1 20h5.8a3 3 0 0 1-5.8 0Z", opacity: 0.67 },
  ],
  plus: [{ d: "M10.7 3.4h2.6v7.3h7.3v2.6h-7.3v7.3h-2.6v-7.3H3.4v-2.6h7.3Z" }],
  arrow: [{ d: "M12.2 4.4h3.3l7 7.6-7 7.6h-3.3l5.8-6.3H2.1v-2.6H18Z" }],
  back: [
    { d: "M10.8 4.8 3.6 12l7.2 7.2 1.6-1.6-4.5-4.5h12.5v-2.2H7.9l4.5-4.5Z" },
  ],
  more: [
    {
      d: "M2.6 10.4h2.9l.8.8v2.4H2.6Zm7.5 0H13l.8.8v2.4h-3.7Zm7.5 0h2.9l.8.8v2.4h-3.7Z",
    },
  ],
  calendar: [
    {
      d: "M3 8V5.9c0-1 .8-1.8 1.8-1.8h1.5V2h2.2v2.1h7V2h2.2v2.1h1.5c1 0 1.8.8 1.8 1.8V8Z",
    },
    {
      fillRule: "evenodd",
      d: "M3 9.5h18v9.7l-2 2H3Zm3 2.7V15h3.4v-2.8Zm5.4 0V15h3.4v-2.8ZM6 16.7v2h3.4v-2Z",
      opacity: 0.8,
    },
  ],
  mail: [
    { d: "M2 4.6h18.1L22 6.4l-9.9 7.1L2 6.4Z", opacity: 0.68 },
    { d: "m2 8.9 10.1 7.2L22 9v8.7l-2 1.9H2Z" },
  ],
  branch: [
    { d: "M5 5h2.2v5.8h3.7l4.9-4.9 1.6 1.6-5.7 5.6H7.2v4.5h10.5v2.2H5Z" },
    {
      d: "M3.7 2.8h4.8v3.1L7.2 7.2H3.7Zm12.4 1.3H21v3.1l-1.4 1.3h-3.5Zm.3 12.4h4.9v3.1l-1.4 1.3h-3.5Z",
    },
  ],
} as const satisfies Record<string, readonly StudioShape[]>;
export type StudioIconName = keyof typeof studioGlyphs;
