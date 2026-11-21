import React from "react";
import Svg, { Circle, Path } from "react-native-svg";
import {
  studioGlyphs,
  type StudioShape,
  type StudioIconName,
} from "../../src/shared/studio-glyphs";

export type { StudioIconName };
export function StudioIcon({
  name,
  color,
  size = 21,
}: {
  name: StudioIconName;
  color: string;
  size?: number;
}) {
  const shapes: readonly StudioShape[] = studioGlyphs[name];
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={color}
      color={color}
      accessible={false}
    >
      {shapes.map((shape, i) =>
        "d" in shape ? (
          <Path key={i} {...shape} />
        ) : (
          <Circle key={i} {...shape} />
        ),
      )}
    </Svg>
  );
}
