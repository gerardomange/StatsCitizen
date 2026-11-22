use crate::models::{BackupResult, CleanShadersResult};
use chrono::Utc;
use std::fs;
use std::path::Path;

fn folder_size(dir: &Path) -> (u64, usize) {
    let mut bytes = 0u64;
    let mut count = 0usize;
    let Ok(entries) = fs::read_dir(dir) else {
        return (0, 0);
    };
    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_dir() {
            let (b, c) = folder_size(&p);
            bytes += b;
            count += c;
        } else if p.is_file() {
            if let Ok(meta) = entry.metadata() {
                bytes += meta.len();
                count += 1;
            }
        }
    }
    (bytes, count)
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let dst_path = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_recursive(&entry.path(), &dst_path)?;
        } else {
            fs::copy(entry.path(), dst_path)?;
        }
    }
    Ok(())
}

pub fn clean_shader_cache() -> CleanShadersResult {
    let Some(local_data) = dirs::data_local_dir() else {
        return CleanShadersResult {
            success: false,
            freed_bytes: 0,
            freed_formatted: "0 MB".to_string(),
            cleared_files_count: 0,
            error: Some("Could not resolve LocalAppData directory.".to_string()),
        };
    };

    let sc_data_dir = local_data.join("Star Citizen");
    if !sc_data_dir.is_dir() {
        return CleanShadersResult {
            success: false,
            freed_bytes: 0,
            freed_formatted: "0 MB".to_string(),
            cleared_files_count: 0,
            error: Some("Star Citizen cache folder was not found.".to_string()),
        };
    }

    let mut cache_dirs = Vec::new();
    if let Ok(entries) = fs::read_dir(&sc_data_dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                if let Some(name) = p.file_name().and_then(|s| s.to_str()) {
                    if name.eq_ignore_ascii_case("shadercache")
                        || name.eq_ignore_ascii_case("shader-cache")
                    {
                        cache_dirs.push(p);
                    }
                }
            }
        }
    }

    if cache_dirs.is_empty() {
        return CleanShadersResult {
            success: false,
            freed_bytes: 0,
            freed_formatted: "0 MB".to_string(),
            cleared_files_count: 0,
            error: Some(
                "No clearly identified shader-cache folder was found; nothing was deleted."
                    .to_string(),
            ),
        };
    }

    let mut total_bytes = 0u64;
    let mut total_files = 0usize;
    for dir in cache_dirs {
        let (b, c) = folder_size(&dir);
        if let Err(err) = fs::remove_dir_all(&dir) {
            return CleanShadersResult {
                success: false,
                freed_bytes: total_bytes,
                freed_formatted: format!("{:.2} MB", total_bytes as f64 / (1024.0 * 1024.0)),
                cleared_files_count: total_files,
                error: Some(err.to_string()),
            };
        }
        total_bytes += b;
        total_files += c;
    }

    CleanShadersResult {
        success: true,
        freed_bytes: total_bytes,
        freed_formatted: format!("{:.2} MB", total_bytes as f64 / (1024.0 * 1024.0)),
        cleared_files_count: total_files,
        error: None,
    }
}

pub fn backup_user_settings(sc_path: &str) -> BackupResult {
    let docs = dirs::document_dir().unwrap_or_else(|| {
        dirs::home_dir()
            .unwrap_or_else(|| Path::new(".").to_path_buf())
            .join("Documents")
    });
    let timestamp = Utc::now().format("%Y-%m-%dT%H-%M-%SZ").to_string();
    let backup_folder = docs
        .join("StatsCitizen_Backups")
        .join(format!("SC_Backup_{}", timestamp));

    if let Err(e) = fs::create_dir_all(&backup_folder) {
        return BackupResult {
            success: false,
            backup_path: String::new(),
            files_backed_up: vec![],
            error: Some(e.to_string()),
        };
    }

    let root = Path::new(sc_path);
    let items: [(&str, &str, bool); 4] = [
        (r"user\client\0\Controls\Mappings\actionmaps.xml", "actionmaps.xml", false),
        (r"user\client\0\customcharacters", "customcharacters", true),
        (r"user\client\0\PowerPresets", "PowerPresets", true),
        ("user.cfg", "user.cfg", false),
    ];

    let mut backed_up = Vec::new();
    for (rel, dest_name, is_dir) in items {
        let src = root.join(rel);
        if !src.exists() {
            continue;
        }
        let dst = backup_folder.join(dest_name);
        let res = if is_dir {
            copy_dir_recursive(&src, &dst)
        } else {
            fs::copy(&src, &dst).map(|_| ())
        };
        if let Err(e) = res {
            return BackupResult {
                success: false,
                backup_path: backup_folder.to_string_lossy().to_string(),
                files_backed_up: backed_up,
                error: Some(e.to_string()),
            };
        }
        backed_up.push(dest_name.to_string());
    }

    BackupResult {
        success: true,
        backup_path: backup_folder.to_string_lossy().to_string(),
        files_backed_up: backed_up,
        error: None,
    }
}
