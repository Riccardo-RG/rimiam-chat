import Image from "next/image";
import styles from "./loading-status.module.css";

export function LoadingStatus({
  label,
  fullPage = false,
}: {
  label: string;
  fullPage?: boolean;
}) {
  return (
    <div className={fullPage ? styles.page : styles.status} role="status">
      <Image
        src="/brand/rimiam-mark.svg"
        width={32}
        height={32}
        alt=""
        unoptimized
      />
      <span>{label}</span>
    </div>
  );
}
