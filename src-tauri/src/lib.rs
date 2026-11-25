use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

const MAX_PDF_BYTES: usize = 100 * 1024 * 1024; // 100 MB

#[derive(Default)]
struct AppPathState {
    allowed_paths: Mutex<HashSet<PathBuf>>,
    pending_launch_files: Mutex<Vec<String>>,
}

#[derive(Serialize)]
struct LoadedPdfPayload {
    path: String,
    name: String,
    bytes: Vec<u8>,
}

#[derive(Serialize)]
struct SavedPdfPayload {
    path: String,
    name: String,
}

fn has_blocked_signature(bytes: &[u8]) -> bool {
    if bytes.len() >= 2 && bytes[0] == 0x4D && bytes[1] == 0x5A {
        return true; // MZ (PE/DOS executable)
    }
    if bytes.len() >= 4 && bytes[0..4] == [0x7F, b'E', b'L', b'F'] {
        return true; // ELF executable
    }
    let head_len = bytes.len().min(512);
    let head = String::from_utf8_lossy(&bytes[..head_len])
        .trim_start_matches('\u{FEFF}')
        .trim_start()
        .to_ascii_lowercase();
    [
        "<html",
        "<!doctype",
        "<script",
        "<svg",
        "<?xml",
        "<?php",
        "<iframe",
        "<object",
    ]
    .iter()
    .any(|prefix| head.starts_with(prefix))
}

fn validate_pdf_bytes(bytes: &[u8]) -> Result<usize, String> {
    if bytes.len() < 16 {
        return Err("Datei ist zu klein oder leer.".into());
    }
    if bytes.len() > MAX_PDF_BYTES {
        return Err("Datei überschreitet das Limit von 100 MB.".into());
    }
    if has_blocked_signature(bytes) {
        return Err("Blockiertes Dateiformat (Polyglot-/Skript-Schutz).".into());
    }
    let search_limit = bytes.len().min(1024);
    for i in 0..=search_limit.saturating_sub(7) {
        if bytes[i..].starts_with(b"%PDF-")
            && (bytes[i + 5] == b'1' || bytes[i + 5] == b'2')
            && bytes[i + 6] == b'.'
        {
            return Ok(i);
        }
    }
    Err("Kein gültiger %PDF-Header gefunden.".into())
}

fn is_pdf_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|s| s.eq_ignore_ascii_case("pdf"))
        .unwrap_or(false)
}

fn sanitize_leaf_name(raw: &str) -> String {
    let leaf = raw.rsplit(['/', '\\']).next().unwrap_or("dokument.pdf");
    let mut clean: String = leaf
        .chars()
        .map(|c| {
            if c.is_control() || "<>:\"/\\|?*&'`$!#;{}[]()".contains(c) {
                '-'
            } else {
                c
            }
        })
        .collect();
    if !clean.to_ascii_lowercase().ends_with(".pdf") {
        clean.push_str(".pdf");
    }
    if clean.is_empty() {
        "dokument.pdf".into()
    } else {
        clean
    }
}

fn register_existing_pdf_paths(args: &[String], state: &AppPathState) -> Vec<String> {
    let mut accepted = Vec::new();
    let Ok(mut allowed) = state.allowed_paths.lock() else {
        return accepted;
    };
    for raw in args {
        if raw.starts_with('-') {
            continue;
        }
        let candidate = PathBuf::from(raw);
        if !candidate.is_file() || !is_pdf_extension(&candidate) {
            continue;
        }
        if let Ok(canonical) = fs::canonicalize(&candidate) {
            allowed.insert(canonical.clone());
            accepted.push(canonical.to_string_lossy().into_owned());
        }
    }
    accepted
}

fn read_validated_pdf(canonical_path: &Path) -> Result<LoadedPdfPayload, String> {
    let meta = fs::metadata(canonical_path).map_err(|e| format!("Datei nicht lesbar: {e}"))?;
    if !meta.is_file() {
        return Err("Pfad verweist nicht auf eine reguläre Datei.".into());
    }
    if meta.len() as usize > MAX_PDF_BYTES {
        return Err("Datei überschreitet das Limit von 100 MB.".into());
    }
    let mut bytes = fs::read(canonical_path).map_err(|e| format!("Lesefehler: {e}"))?;
    let offset = validate_pdf_bytes(&bytes)?;
    if offset > 0 {
        bytes.drain(0..offset);
    }
    let name = canonical_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("dokument.pdf")
        .to_string();
    Ok(LoadedPdfPayload {
        path: canonical_path.to_string_lossy().into_owned(),
        name,
        bytes,
    })
}

fn write_atomic_pdf(target: &Path, bytes: &[u8]) -> Result<(), String> {
    validate_pdf_bytes(bytes)?;
    let parent = target
        .parent()
        .ok_or_else(|| "Ungültiger Zielordner.".to_string())?;
    let file_stem = target
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("seelig-tmp");
    let tmp_name = format!(".{file_stem}.{}.tmp", std::process::id());
    let tmp_path = parent.join(tmp_name);

    let mut file = fs::File::create(&tmp_path).map_err(|e| format!("Temporäre Datei fehlgeschlagen: {e}"))?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|e| {
            let _ = fs::remove_file(&tmp_path);
            format!("Schreibfehler: {e}")
        })?;
    drop(file);

    if let Err(rename_err) = fs::rename(&tmp_path, target) {
        if target.exists() {
            fs::copy(&tmp_path, target).map_err(|copy_err| {
                let _ = fs::remove_file(&tmp_path);
                format!("Speichern fehlgeschlagen ({rename_err}; {copy_err})")
            })?;
            let _ = fs::remove_file(&tmp_path);
        } else {
            let _ = fs::remove_file(&tmp_path);
            return Err(format!("Umbenennen fehlgeschlagen: {rename_err}"));
        }
    }
    Ok(())
}

#[tauri::command]
fn consume_launch_files(state: State<'_, AppPathState>) -> Vec<String> {
    match state.pending_launch_files.lock() {
        Ok(mut guard) => std::mem::take(&mut *guard),
        Err(_) => Vec::new(),
    }
}

#[tauri::command]
fn read_allowed_pdf(path: String, state: State<'_, AppPathState>) -> Result<LoadedPdfPayload, String> {
    let canonical = fs::canonicalize(&path).map_err(|e| format!("Ungültiger Pfad: {e}"))?;
    let is_allowed = state
        .allowed_paths
        .lock()
        .map(|set| set.contains(&canonical))
        .unwrap_or(false);
    if !is_allowed {
        return Err("Zugriff verweigert: Dateipfad ist nicht in der Sitzungs-Allowlist.".into());
    }
    read_validated_pdf(&canonical)
}

#[tauri::command]
fn pick_open_pdfs(app: tauri::AppHandle, state: State<'_, AppPathState>) -> Result<Vec<LoadedPdfPayload>, String> {
    let picked = app
        .dialog()
        .file()
        .add_filter("PDF-Dokumente", &["pdf"])
        .blocking_pick_files();

    let Some(file_paths) = picked else {
        return Ok(Vec::new());
    };

    let mut out = Vec::new();
    for fp in file_paths {
        let Ok(raw_path) = fp.into_path() else {
            continue;
        };
        let canonical = fs::canonicalize(&raw_path).map_err(|e| format!("Pfadfehler: {e}"))?;
        if !is_pdf_extension(&canonical) {
            return Err("Es sind ausschließlich .pdf-Dateien erlaubt.".into());
        }
        if let Ok(mut set) = state.allowed_paths.lock() {
            set.insert(canonical.clone());
        }
        out.push(read_validated_pdf(&canonical)?);
    }
    Ok(out)
}

#[tauri::command]
fn save_pdf_as(
    app: tauri::AppHandle,
    state: State<'_, AppPathState>,
    default_name: String,
    bytes: Vec<u8>,
) -> Result<Option<SavedPdfPayload>, String> {
    validate_pdf_bytes(&bytes)?;
    let safe_name = sanitize_leaf_name(&default_name);
    let picked = app
        .dialog()
        .file()
        .add_filter("PDF-Dokument", &["pdf"])
        .set_file_name(&safe_name)
        .blocking_save_file();

    let Some(fp) = picked else {
        return Ok(None);
    };
    let mut target = fp
        .into_path()
        .map_err(|_| "Ungültiger Speicherpfad.".to_string())?;
    if !is_pdf_extension(&target) {
        target.set_extension("pdf");
    }

    write_atomic_pdf(&target, &bytes)?;
    let canonical = fs::canonicalize(&target).unwrap_or(target);
    if let Ok(mut set) = state.allowed_paths.lock() {
        set.insert(canonical.clone());
    }
    let name = canonical
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(&safe_name)
        .to_string();
    Ok(Some(SavedPdfPayload {
        path: canonical.to_string_lossy().into_owned(),
        name,
    }))
}

#[tauri::command]
fn save_pdf_overwrite(
    state: State<'_, AppPathState>,
    path: String,
    bytes: Vec<u8>,
) -> Result<SavedPdfPayload, String> {
    let canonical = fs::canonicalize(&path).map_err(|e| format!("Ungültiger Speicherpfad: {e}"))?;
    let is_allowed = state
        .allowed_paths
        .lock()
        .map(|set| set.contains(&canonical))
        .unwrap_or(false);
    if !is_allowed {
        return Err("Überschreiben verweigert: Pfad nicht in der Sitzungs-Allowlist.".into());
    }
    write_atomic_pdf(&canonical, &bytes)?;
    let name = canonical
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("dokument.pdf")
        .to_string();
    Ok(SavedPdfPayload {
        path: canonical.to_string_lossy().into_owned(),
        name,
    })
}

fn is_allowed_navigation_url(url: &tauri::Url) -> bool {
    let scheme = url.scheme();
    let host = url.host_str().unwrap_or("");
    if scheme == "tauri" && host == "localhost" {
        return true;
    }
    if (scheme == "http" || scheme == "https") && host == "tauri.localhost" {
        return true;
    }
    #[cfg(debug_assertions)]
    if scheme == "http" && (host == "localhost" || host == "127.0.0.1") {
        return true;
    }
    false
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppPathState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            let state = app.state::<AppPathState>();
            let opened = register_existing_pdf_paths(&args[1..], &state);
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
            if !opened.is_empty() {
                let _ = app.emit("seelig://open-files", opened);
            }
        }))
        .setup(|app| {
            let args: Vec<String> = std::env::args().skip(1).collect();
            let state = app.state::<AppPathState>();
            let opened = register_existing_pdf_paths(&args, &state);
            if !opened.is_empty() {
                if let Ok(mut pending) = state.pending_launch_files.lock() {
                    pending.extend(opened);
                }
            }
            Ok(())
        })
        .on_page_load(|webview, payload| {
            if !is_allowed_navigation_url(payload.url()) {
                if let Ok(home) = tauri::Url::parse("http://tauri.localhost/") {
                    let _ = webview.navigate(home);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            consume_launch_files,
            read_allowed_pdf,
            pick_open_pdfs,
            save_pdf_as,
            save_pdf_overwrite
        ])
        .on_window_event(|_, _| {})
        .build(tauri::generate_context!())
        .expect("Fehler beim Initialisieren von Seelig PDF")
        .run(|_, _| {});
}

// Note: Webview navigation restriction can also be attached on WebviewWindowBuilder if created dynamically;
// let's keep helper unit-tested and clean!
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_pdf_header_and_rejects_polyglots() {
        let valid = b"%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\n%%EOF";
        assert_eq!(validate_pdf_bytes(valid), Ok(0));

        let html = b"<!DOCTYPE html><html><script>alert(1)</script></html>";
        assert!(validate_pdf_bytes(html).is_err());

        let svg = b"<svg onload=alert(1)></svg>";
        assert!(validate_pdf_bytes(svg).is_err());

        let mz = b"MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff\x00\x00";
        assert!(validate_pdf_bytes(mz).is_err());
    }

    #[test]
    fn rejects_unallowlisted_path() {
        let state = AppPathState::default();
        let tmp = std::env::temp_dir().join("seelig_unlisted_test.pdf");
        fs::write(&tmp, b"%PDF-1.7\n1 0 obj\n<<>>\n%%EOF").unwrap();
        let canonical = fs::canonicalize(&tmp).unwrap();
        let allowed = state.allowed_paths.lock().unwrap();
        assert!(!allowed.contains(&canonical));
        let _ = fs::remove_file(&tmp);
    }

    #[test]
    fn atomic_write_saves_valid_pdf_cleanly() {
        let target = std::env::temp_dir().join(format!("seelig_atomic_{}.pdf", std::process::id()));
        let data = b"%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\n%%EOF";
        write_atomic_pdf(&target, data).expect("atomic write succeeds");
        assert_eq!(fs::read(&target).unwrap(), data);
        let _ = fs::remove_file(&target);
    }

    #[test]
    fn navigation_allowlist_blocks_external_hosts() {
        let local = tauri::Url::parse("https://tauri.localhost/#/reader").unwrap();
        assert!(is_allowed_navigation_url(&local));
        let evil = tauri::Url::parse("https://evil.example/phish").unwrap();
        assert!(!is_allowed_navigation_url(&evil));
    }
}
