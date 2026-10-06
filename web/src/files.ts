/** Reads a file as UTF-8, or as Windows-1252 when it isn't valid UTF-8 (older Excel and bank exports). */
export async function readText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("windows-1252").decode(buf);
  }
}
