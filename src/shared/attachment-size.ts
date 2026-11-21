const number = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 });
export function attachmentSize(bytes: number): string {
  if (bytes < 1024) return number.format(bytes) + " B";
  if (bytes < 1048576) return number.format(bytes / 1024) + " KiB";
  return number.format(bytes / 1048576) + " MiB";
}
