import type { CSSProperties } from "react";
import {
  studioGlyphs,
  type StudioShape,
  type StudioIconName,
} from "../shared/studio-glyphs";
export type WorkspaceIconName = StudioIconName;

export function WorkspaceIcon({
  name,
  className = "nav-icon",
  size = 20,
  style,
}: {
  name: WorkspaceIconName;
  className?: string;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      className={className}
      style={style}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
      aria-hidden="true"
      focusable="false"
    >
      {(studioGlyphs[name] as readonly StudioShape[]).map((shape, i) =>
        "d" in shape ? (
          <path key={i} {...shape} />
        ) : (
          <circle key={i} {...shape} />
        ),
      )}
    </svg>
  );
}
