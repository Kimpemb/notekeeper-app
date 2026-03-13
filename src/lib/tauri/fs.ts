// src/lib/tauri/fs.ts
import { invoke } from "@tauri-apps/api/core";
import { save, open } from "@tauri-apps/plugin-dialog";

export async function exportNotesToFile(contents: string, defaultName = "notekeeper-export.json"): Promise<boolean> {
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