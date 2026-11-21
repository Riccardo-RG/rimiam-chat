export const acceptedFiles =
  ".txt,.md,.csv,.pdf,.docx,.png,.jpg,.jpeg,.webp,.mp3,.m4a,.wav,.webm,.ogg";

export function optionalMediaReading(filename: string) {
  return /\.(png|jpe?g|webp|mp3|m4a|wav|webm|ogg)$/i.test(filename);
}

export function validateAttachment(file: { name: string; size: number }) {
  const extension = file.name.toLowerCase().match(/\.[^.]+$/)?.[0];
  if (!extension || !acceptedFiles.split(",").includes(extension))
    throw new Error("DOCUMENT_FORMAT_UNSUPPORTED");
  if (!file.size) throw new Error("Il file è vuoto.");
  const isText = /\.(txt|md|csv)$/i.test(file.name);
  if (isText && file.size > 1048576)
    throw new Error("I file di testo possono pesare fino a 1 MiB.");
  if (file.size > 8388608) throw new Error("DOCUMENT_TOO_LARGE");
}
