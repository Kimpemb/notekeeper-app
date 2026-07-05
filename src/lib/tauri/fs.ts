  // src/lib/tauri/fs.ts
  import { invoke } from "@tauri-apps/api/core";
  import { save, open } from "@tauri-apps/plugin-dialog";

  export async function exportNotesToFile(contents: string, defaultName = "idemora-export.json"): Promise<boolean> {
    const isJson = defaultName.endsWith(".json");
    const path = await save({
      defaultPath: defaultName,
      filters: isJson
        ? [{ name: "JSON", extensions: ["json"] }]
        : [{ name: "Markdown", extensions: ["md"] }],
    });
    if (!path) return false;
    await invoke("write_file", { path, contents });
    return true;
  }

  export async function exportDocxToFile(data: Uint8Array, defaultName = "idemora-export.docx"): Promise<boolean> {
    const path = await save({
      defaultPath: defaultName,
      filters: [{ name: "Word Document", extensions: ["docx"] }],
    });
    if (!path) return false;
    await invoke("write_file_bytes", { path, data: Array.from(data) });
    return true;
  }
  
  export async function importNotesFromFile(): Promise<{ content: string; ext: string; fileName: string }[] | null> {
  const paths = await open({
    multiple: true,
    filters: [
      { name: "Notes (JSON, Markdown)", extensions: ["json", "md"] },
    ],
  });
  if (!paths) return null;
  const pathList = Array.isArray(paths) ? paths : [paths];
  if (pathList.length === 0) return null;

  const results: { content: string; ext: string; fileName: string }[] = [];
  for (const path of pathList) {
    const content = await invoke<string>("read_file", { path });
    const ext = path.split(".").pop()?.toLowerCase() ?? "json";
    const fileName = path.replace(/\\/g, "/").split("/").pop() ?? "file";
    results.push({ content, ext, fileName });
  }
  return results;
}

  export async function getAppDataDir(): Promise<string> {
    return await invoke<string>("get_app_data_dir");
  }

  // ─── Image helpers ────────────────────────────────────────────────────────────

  export async function pickImageFile(): Promise<string | null> {
    const path = await open({
      multiple: false,
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }],
    });
    return (path as string) ?? null;
  }

  export async function readImageFile(path: string): Promise<Uint8Array> {
    const data = await invoke<number[]>("read_file_bytes", { path });
    return new Uint8Array(data);
  }

  export async function saveImage(fileName: string, data: Uint8Array): Promise<string> {
    return await invoke<string>("save_image", { fileName, data: Array.from(data) });
  }

  export async function deleteImage(path: string): Promise<void> {
    await invoke("delete_image", { path });
  }

  export async function saveAttachment(fileName: string, data: Uint8Array): Promise<string> {
    return await invoke<string>("save_attachment", { fileName, data: Array.from(data) });
  }

  export async function pickAttachmentFile(): Promise<string | null> {
    const path = await open({
      multiple: false,
      filters: [{ name: "Attachments", extensions: ["pdf", "mp3", "wav", "ogg", "m4a", "aac"] }],
    });
    return (path as string) ?? null;
  }

export async function pickDocxFile(): Promise<string[] | null> {
  const paths = await open({
    multiple: true,
    filters: [{ name: "Word Document", extensions: ["docx"] }],
  });
  if (!paths) return null;
  return Array.isArray(paths) ? paths : [paths];
}

export async function pickPdfFile(): Promise<string[] | null> {
  const paths = await open({
    multiple: true,
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (!paths) return null;
  return Array.isArray(paths) ? paths : [paths];
}

export async function copyPdfToAttachments(srcPath: string, destFileName: string): Promise<void> {
  const data = await invoke<number[]>("read_file_bytes", { path: srcPath });
  await invoke("save_attachment", { fileName: destFileName, data });
}

  // ─── Backup helpers ───────────────────────────────────────────────────────────

  /**
   * Opens a save dialog and writes the encrypted backup string to a .nkbackup file.
   * Returns true on success, false if the user cancels.
   */
  export async function saveBackupFile(contents: string, defaultName: string): Promise<boolean> {
    const path = await save({
      defaultPath: defaultName,
      filters: [{ name: "Idemora Backup", extensions: ["nkbackup"] }],
    });
    if (!path) return false;
    await invoke("write_file", { path, contents });
    return true;
  }

  /**
   * Opens a file picker filtered to .nkbackup files.
   * Returns the file contents as a string, or null if cancelled.
   */
  export async function openBackupFile(): Promise<string | null> {
    const path = await open({
      multiple: false,
      filters: [{ name: "Idemora Backup", extensions: ["nkbackup"] }],
    });
    if (!path) return null;
    return await invoke<string>("read_file", { path });
  }

  /**
   * Opens a folder picker dialog.
   * Returns the selected folder path, or null if cancelled.
   */
  export async function pickBackupFolder(): Promise<string | null> {
    const path = await open({
      directory: true,
      multiple:  false,
    });
    return (path as string) ?? null;
  }

  /**
   * Writes an encrypted backup string directly to a folder path (no dialog).
   * Used by the scheduler for silent auto-backups.
   */
  export async function saveBackupToFolder(
    contents:   string,
    folderPath: string,
    fileName:   string
  ): Promise<string> {
    const sep      = folderPath.includes("\\") ? "\\" : "/";
    const fullPath = `${folderPath}${sep}${fileName}`;
    await invoke("write_file", { path: fullPath, contents });
    return fullPath;
  }
export async function pickPptxFile(): Promise<string[] | null> {
  const paths = await open({
    multiple: true,
    filters: [{ name: "PowerPoint", extensions: ["pptx"] }],
  });
  if (!paths) return null;
  return Array.isArray(paths) ? paths : [paths];
}
