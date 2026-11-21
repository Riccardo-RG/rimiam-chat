import React from "react";
import { StudioIcon } from "./StudioIcon";
export function RoomIcon({
  direct,
  color,
}: {
  direct: boolean;
  color: string;
}) {
  return <StudioIcon name={direct ? "chat" : "space"} color={color} />;
}
