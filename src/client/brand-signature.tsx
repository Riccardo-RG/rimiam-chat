import Image from "next/image";

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
