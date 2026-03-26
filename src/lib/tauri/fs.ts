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

export async function importNotesFromFile(): Promise<{ content: string; ext: string } | null> {
  const path = await open({
    multiple: false,
    filters: [
      { name: "JSON", extensions: ["json"] },
      { name: "Markdown", extensions: ["md"] },
    ],
  });
  if (!path) return null;
  const content = await invoke<string>("read_file", { path });
  const ext = (path as string).split(".").pop()?.toLowerCase() ?? "json";
  return { content, ext };
}

export async function getAppDataDir(): Promise<string> {
  return await invoke<string>("get_app_data_dir");
}

// --- Image helpers ---

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