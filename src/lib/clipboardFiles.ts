type ClipboardFileData = Pick<DataTransfer, "files" | "items">;

export function extractClipboardFiles(clipboardData: ClipboardFileData | null): File[] {
  if (!clipboardData) return [];

  const itemFiles = Array.from(clipboardData.items)
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));

  if (itemFiles.length) return itemFiles;
  return Array.from(clipboardData.files);
}
