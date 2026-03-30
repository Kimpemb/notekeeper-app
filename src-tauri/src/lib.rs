use tauri::Manager;
use tauri_plugin_updater::UpdaterExt;

#[tauri::command]
fn write_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_app_data_dir(app: tauri::AppHandle) -> Result<String, String> {
    app.path()
        .app_data_dir()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn file_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

#[tauri::command]
async fn save_image(
    app: tauri::AppHandle,
    file_name: String,
    data: Vec<u8>,
) -> Result<String, String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let images_dir = app_data.join("images");
    std::fs::create_dir_all(&images_dir).map_err(|e| e.to_string())?;
    let dest = images_dir.join(&file_name);
    std::fs::write(&dest, data).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
async fn save_attachment(
    app: tauri::AppHandle,
    file_name: String,
    data: Vec<u8>,
) -> Result<String, String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let attachments_dir = app_data.join("attachments");
    std::fs::create_dir_all(&attachments_dir).map_err(|e| e.to_string())?;
    let dest = attachments_dir.join(&file_name);
    std::fs::write(&dest, data).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
fn delete_image(path: String) -> Result<(), String> {
    std::fs::remove_file(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_in_browser(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    std::process::Command::new("cmd")
        .args(["/c", "start", "", &path])
        .spawn()
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(&path)
        .spawn()
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open")
        .arg(&path)
        .spawn()
        .map_err(|e| e.to_string())?;

    Ok(())
}

// ✅ CHANGED: returns version string instead of bool
#[tauri::command]
async fn check_for_updates(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let updater = app.updater().map_err(|e| format!("updater init error: {}", e))?;
    let response = updater.check().await.map_err(|e| format!("check error: {}", e))?;
    Ok(response.map(|u| u.version.to_string()))
}

// ✅ downloads and installs the update
#[tauri::command]
async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(|e| format!("updater init error: {}", e))?;
    if let Some(update) = updater.check().await.map_err(|e| format!("check error: {}", e))? {
        update
            .download_and_install(|_, _| {}, || {})
            .await
            .map_err(|e| format!("install error: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
async fn send_telegram_backup(
    bot_token: String,
    chat_id: String,
    file_name: String,
    file_bytes: Vec<u8>,
) -> Result<(), String> {
    let url = format!("https://api.telegram.org/bot{}/sendDocument", bot_token);

    let file_part = reqwest::multipart::Part::bytes(file_bytes)
        .file_name(file_name.clone())
        .mime_str("application/octet-stream")
        .map_err(|e| e.to_string())?;

    let form = reqwest::multipart::Form::new()
        .text("chat_id", chat_id)
        .text("caption", format!("Idemora backup — {}", file_name))
        .part("document", file_part);

    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .multipart(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Telegram API error: {}", body));
    }

    Ok(())
}

#[tauri::command]
async fn get_telegram_chat_id(bot_token: String) -> Result<String, String> {
    let url = format!("https://api.telegram.org/bot{}/getUpdates", bot_token);

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| e.to_string())?;

    let chat_id = json["result"]
        .as_array()
        .and_then(|arr| arr.last())
        .and_then(|update| update["message"]["chat"]["id"].as_i64())
        .map(|id| id.to_string())
        .ok_or_else(|| "No messages found. Send any message to your bot first, then try again.".to_string())?;

    Ok(chat_id)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            write_file,
            read_file,
            read_file_bytes,
            get_app_data_dir,
            file_exists,
            save_image,
            save_attachment,
            delete_image,
            open_in_browser,
            check_for_updates,
            install_update,
            send_telegram_backup,
            get_telegram_chat_id,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}