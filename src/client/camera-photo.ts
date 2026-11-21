// Browsers can return a native HEIC capture or a full-size image over the
// attachment budget. Convert those captures locally when the device can decode them.
export async function prepareCameraPhoto(file: File): Promise<File> {
  if (!file.size)
    throw new Error("Lo scatto è vuoto. Scatta di nuovo la foto.");
  if (file.size <= 8388608 && /\.(jpe?g|png|webp)$/i.test(file.name))
    return file;
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(
      1,
      2048 / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error();
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.9),
    );
    if (!blob || blob.type !== "image/jpeg" || blob.size > 8388608)
      throw new Error();
    return new File(
      [blob],
      (file.name.replace(/\.[^.]+$/, "") || "Foto") + ".jpg",
      { type: blob.type, lastModified: file.lastModified },
    );
  } catch {
    throw new Error(
      "Questo telefono non riesce a preparare la foto. Scegli un’immagine JPEG dalla galleria con la graffetta.",
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
