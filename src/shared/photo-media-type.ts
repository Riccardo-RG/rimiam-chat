/** Raster formats whose signatures are validated on upload. */
export function isSharedPhoto(media: string | null | undefined) {
  return (
    media === "image/jpeg" || media === "image/png" || media === "image/webp"
  );
}
