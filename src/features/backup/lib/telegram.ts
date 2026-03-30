// src/features/backup/lib/telegram.ts
//
// Tauri invoke wrappers for Telegram backup delivery.
// All API calls happen on the Rust side — token never touches the webview network layer.

import { invoke } from "@tauri-apps/api/core";

/**
 * Sends a .nkbackup file to the user's Telegram chat.
 */
export async function sendTelegramBackup(
  botToken:  string,
  chatId:    string,
  fileName:  string,
  fileBytes: Uint8Array,
): Promise<void> {
  await invoke("send_telegram_backup", {
    botToken,
    chatId,
    fileName,
    fileBytes: Array.from(fileBytes),
  });
}

/**
 * Fetches the chat ID from the bot's latest message.
 * User must have sent any message to the bot first.
 */
export async function getTelegramChatId(botToken: string): Promise<string> {
  return await invoke<string>("get_telegram_chat_id", { botToken });
}