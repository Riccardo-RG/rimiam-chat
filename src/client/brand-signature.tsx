"use client";
import Image from "next/image";
import { WorkspaceIcon } from "./workspace-icon";

/** Small monochrome cut of the brand mark for the assistant's message byline. */
export function EmmeMessageMark() {
  return <WorkspaceIcon name="mark" size={15} className="emme-message-mark" />;
}

/** Decorative mark; the containing link/button supplies its accessible name. */
export function BrandSignature() {
  return (
    <span className="brand-signature" aria-hidden="true">
      <Image
        className="brand-mark"
        src="/brand/rimiam-mark.svg"
        alt=""
        width={48}
        height={48}
        unoptimized
      />
      <span className="brand-name">rimiam</span>
    </span>
  );
}
