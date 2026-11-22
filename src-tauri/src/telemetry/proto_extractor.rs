use memchr::memmem;
use prost::Message;
use prost_reflect::DescriptorPool;
use prost_types::{FileDescriptorProto, FileDescriptorSet};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

pub const SERVICE_FULL_NAME: &str = "sc.game.telemetry.v1.GameTelemetryService";
const NEEDLE: &[u8] = b"sc/game/telemetry";

#[derive(Debug, Clone, Default)]
pub struct ExeCapabilities {
    pub has_telemetry_proto: bool,
    pub supports_actions: bool,
    pub uses_port_cvar: bool,
}

fn cache_dir() -> PathBuf {
    let base = dirs::data_local_dir().unwrap_or_else(std::env::temp_dir);
    let dir = base.join("StatsCitizen").join("proto-cache");
    let _ = fs::create_dir_all(&dir);
    dir
}

fn read_varint(buf: &[u8], mut i: usize) -> Option<(u64, usize)> {
    let mut shift = 0u32;
    let mut result = 0u64;
    while i < buf.len() {
        let c = buf[i];
        i += 1;
        result |= ((c & 0x7f) as u64) << shift;
        if (c & 0x80) == 0 {
            return Some((result, i));
        }
        shift += 7;
        if shift > 63 {
            break;
        }
    }
    None
}

fn expected_wire_type(field_num: u64) -> Option<u64> {
    match field_num {
        1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 12 => Some(2),
        10 | 11 | 14 => Some(0),
        _ => None,
    }
}

fn walk_fdp(buf: &[u8], start: usize) -> &[u8] {
    let limit = (4usize << 20).min(buf.len().saturating_sub(start));
    let end = start + limit;
    let mut i = start;
    let mut seen_name = false;

    while i < end {
        let Some((tag, mut j)) = read_varint(buf, i) else {
            break;
        };
        let field = tag >> 3;
        let wt = tag & 7;
        if expected_wire_type(field) != Some(wt) || (field == 1 && seen_name) {
            break;
        }
        if wt == 0 {
            let Some((_, next_j)) = read_varint(buf, j) else {
                break;
            };
            j = next_j;
        } else {
            let Some((ln, next_j)) = read_varint(buf, j) else {
                break;
            };
            j = match next_j.checked_add(ln as usize) {
                Some(v) => v,
                None => break,
            };
        }
        if j > end {
            break;
        }
        if field == 1 {
            seen_name = true;
        }
        i = j;
    }

    &buf[start..i]
}

fn has_telemetry_service(fds: &FileDescriptorSet) -> bool {
    fds.file.iter().any(|f| {
        let pkg = f.package.as_deref().unwrap_or("");
        f.service.iter().any(|s| {
            let name = s.name.as_deref().unwrap_or("");
            format!("{}.{}", pkg, name) == SERVICE_FULL_NAME
        })
    })
}

pub fn fds_supports_actions(fds: &FileDescriptorSet) -> bool {
    fds.file.iter().any(|f| {
        f.service.iter().any(|s| {
            s.method
                .iter()
                .any(|m| m.name.as_deref() == Some("TriggerGameAction"))
        })
    })
}

pub fn extract_from_bytes(data: &[u8]) -> FileDescriptorSet {
    let mut found: HashMap<String, FileDescriptorProto> = HashMap::new();

    for name_start in memmem::find_iter(data, NEEDLE) {
        for back in [2usize, 3usize] {
            if name_start < back {
                continue;
            }
            let s = name_start - back;
            if data[s] != 0x0A {
                continue;
            }
            let Some((ln, j)) = read_varint(data, s + 1) else {
                continue;
            };
            if j != name_start {
                continue;
            }
            let Some(name_end) = name_start.checked_add(ln as usize) else {
                continue;
            };
            if name_end > data.len() || !data[name_start..name_end].ends_with(b".proto") {
                continue;
            }
            let slice = walk_fdp(data, s);
            if let Ok(fdp) = FileDescriptorProto::decode(slice) {
                let name = fdp.name.clone().unwrap_or_default();
                if name.is_empty() {
                    continue;
                }
                let replace = found
                    .get(&name)
                    .map(|prev| fdp.encoded_len() > prev.encoded_len())
                    .unwrap_or(true);
                if replace {
                    found.insert(name, fdp);
                }
            }
        }
    }

    // Topological sort so dependencies load first into DescriptorPool
    let mut ordered: Vec<FileDescriptorProto> = Vec::with_capacity(found.len());
    let mut pending = found;
    while !pending.is_empty() {
        let loaded_names: Vec<String> = ordered
            .iter()
            .filter_map(|f| f.name.clone())
            .collect();
        let ready: Vec<String> = pending
            .iter()
            .filter(|(_, fdp)| {
                fdp.dependency.iter().all(|dep| {
                    loaded_names.iter().any(|n| n == dep) || !pending.contains_key(dep)
                })
            })
            .map(|(k, _)| k.clone())
            .collect();
        if ready.is_empty() {
            ordered.extend(pending.into_values());
            break;
        }
        for k in ready {
            if let Some(fdp) = pending.remove(&k) {
                ordered.push(fdp);
            }
        }
    }

    FileDescriptorSet { file: ordered }
}

fn cache_key_paths(exe_path: &Path) -> Option<(PathBuf, PathBuf)> {
    let meta = fs::metadata(exe_path).ok()?;
    let size = meta.len();
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let dir = cache_dir();
    Some((
        dir.join(format!("protoset-{}-{}.bin", size, mtime)),
        dir.join(format!("caps-{}-{}.txt", size, mtime)),
    ))
}

pub fn probe_exe_capabilities(exe_path: &Path) -> ExeCapabilities {
    if !exe_path.is_file() {
        return ExeCapabilities::default();
    }

    if let Some((proto_cache, caps_cache)) = cache_key_paths(exe_path) {
        if let Ok(txt) = fs::read_to_string(&caps_cache) {
            let parts: Vec<&str> = txt.trim().split(',').collect();
            if parts.len() == 3 {
                return ExeCapabilities {
                    has_telemetry_proto: parts[0] == "1",
                    supports_actions: parts[1] == "1",
                    uses_port_cvar: parts[2] == "1",
                };
            }
        }

        if let Ok(data) = fs::read(exe_path) {
            let fds = extract_from_bytes(&data);
            let has_proto = has_telemetry_service(&fds);
            let supports_actions = fds_supports_actions(&fds);
            let uses_port_cvar =
                memmem::find(&data, b"server.game.telemetry.enabled").is_some();

            if has_proto {
                let mut encoded = Vec::new();
                if fds.encode(&mut encoded).is_ok() {
                    let _ = fs::write(&proto_cache, encoded);
                }
            }
            let caps_str = format!(
                "{},{},{}",
                if has_proto { "1" } else { "0" },
                if supports_actions { "1" } else { "0" },
                if uses_port_cvar { "1" } else { "0" }
            );
            let _ = fs::write(&caps_cache, caps_str);

            return ExeCapabilities {
                has_telemetry_proto: has_proto,
                supports_actions,
                uses_port_cvar,
            };
        }
    }

    ExeCapabilities::default()
}

pub fn load_descriptor_pool(exe_path: &Path) -> Result<(DescriptorPool, bool), String> {
    let fds = if let Some((proto_cache, _)) = cache_key_paths(exe_path) {
        if let Ok(bytes) = fs::read(&proto_cache) {
            if let Ok(fds) = FileDescriptorSet::decode(bytes.as_slice()) {
                if has_telemetry_service(&fds) {
                    fds
                } else {
                    extract_and_cache(exe_path, &proto_cache)?
                }
            } else {
                extract_and_cache(exe_path, &proto_cache)?
            }
        } else {
            extract_and_cache(exe_path, &proto_cache)?
        }
    } else {
        let data = fs::read(exe_path).map_err(|e| format!("Could not read StarCitizen.exe: {e}"))?;
        let fds = extract_from_bytes(&data);
        if !has_telemetry_service(&fds) {
            return Err("This Star Citizen build does not contain the telemetry service.".to_string());
        }
        fds
    };

    let supports_actions = fds_supports_actions(&fds);
    let pool = DescriptorPool::from_file_descriptor_set(fds)
        .map_err(|e| format!("Failed to load protobuf descriptors: {e}"))?;
    Ok((pool, supports_actions))
}

fn extract_and_cache(exe_path: &Path, cache_path: &Path) -> Result<FileDescriptorSet, String> {
    let data = fs::read(exe_path).map_err(|e| format!("Could not read StarCitizen.exe: {e}"))?;
    let fds = extract_from_bytes(&data);
    if !has_telemetry_service(&fds) {
        return Err("This Star Citizen build does not contain the telemetry service.".to_string());
    }
    let mut buf = Vec::new();
    if fds.encode(&mut buf).is_ok() {
        let _ = fs::write(cache_path, buf);
    }
    Ok(fds)
}
