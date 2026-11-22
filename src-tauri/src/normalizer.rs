use regex::Regex;
use std::sync::LazyLock;

pub struct NormalizedShip {
    pub name: String,
    pub manufacturer: String,
}

static TRAILING_UNDERSCORE_ID: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"_[0-9]{6,}$").unwrap());
static TRAILING_DASH_ID: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"-[0-9]{3,}$").unwrap());
static SHOP_PREFIX_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^SCShop_").unwrap());
static SHOP_REST_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)_RestStop_").unwrap());
static SHOP_BM_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)_BlackMarket_").unwrap());
static SHOP_FPS_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)_FPSItems").unwrap());
static SHOP_WEP_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)_ShipWeapons").unwrap());
static SHOP_COMP_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)_ShipComponents").unwrap());
static SHOP_CLOTH_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)_Clothing").unwrap());
static LOC_EXT_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^LOC_rs_ext_").unwrap());
static LOC_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^LOC_").unwrap());

fn manufacturer_lookup(prefix: &str) -> Option<(&'static str, &'static str)> {
    match prefix {
        "CRUS" => Some(("Crusader", "Crusader Industries")),
        "RSI" => Some(("RSI", "Roberts Space Industries")),
        "DRAK" => Some(("Drake", "Drake Interplanetary")),
        "ANVL" => Some(("Anvil", "Anvil Aerospace")),
        "AEGS" => Some(("Aegis", "Aegis Dynamics")),
        "MISC" => Some(("MISC", "Musashi Industrial & Starflight Concern")),
        "ORIG" => Some(("Origin", "Origin Jumpworks")),
        "ARGO" => Some(("ARGO", "ARGO Astronautics")),
        "ESPR" => Some(("Esperia", "Esperia")),
        "BANU" => Some(("Banu", "Banu Protectorate")),
        "XIAN" => Some(("Xi'an", "Gatac Railen / Aopoa")),
        "AOPO" => Some(("Aopoa", "Aopoa")),
        "CNOU" => Some(("CNOU", "Consolidated Outland")),
        "TMBL" => Some(("Tumbril", "Tumbril Land Systems")),
        "MIRAI" => Some(("Mirai", "Mirai")),
        "GLSN" => Some(("Glaser", "Glaser Navigation")),
        "GRIN" => Some(("Greycat", "Greycat Industrial")),
        "KRIG" => Some(("Kruger", "Kruger Intergalactic")),
        "VNCL" => Some(("Vanduul", "Vanduul")),
        _ => None,
    }
}

fn capitalize_word(word: &str) -> String {
    let mut chars = word.chars();
    match chars.next() {
        None => String::new(),
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
    }
}

pub fn normalize_ship_name(raw_name: &str) -> NormalizedShip {
    if raw_name.trim().is_empty() {
        return NormalizedShip {
            name: "Unknown Vessel".to_string(),
            manufacturer: "Unknown".to_string(),
        };
    }

    let step1 = TRAILING_UNDERSCORE_ID.replace(raw_name, "");
    let clean = TRAILING_DASH_ID.replace(&step1, "");

    let parts: Vec<&str> = clean.split('_').filter(|s| !s.is_empty()).collect();
    if parts.len() >= 2 {
        let prefix = parts[0].to_uppercase();
        if let Some((short_name, mfg)) = manufacturer_lookup(&prefix) {
            let model_parts: Vec<String> = parts[1..]
                .iter()
                .map(|p| {
                    let lower = p.to_lowercase();
                    if lower == "mk2" {
                        "Mk II".to_string()
                    } else if lower == "mk1" {
                        "Mk I".to_string()
                    } else {
                        capitalize_word(p)
                    }
                })
                .collect();
            return NormalizedShip {
                name: format!("{} {}", short_name, model_parts.join(" ")),
                manufacturer: mfg.to_string(),
            };
        }
    }

    NormalizedShip {
        name: clean.replace('_', " "),
        manufacturer: "Independent".to_string(),
    }
}

pub fn normalize_shop_name(raw_name: &str) -> String {
    if raw_name.trim().is_empty() {
        return "Local Terminal".to_string();
    }
    let s = SHOP_PREFIX_RE.replace(raw_name, "");
    let s = SHOP_REST_RE.replace_all(&s, " Rest Stop - ");
    let s = SHOP_BM_RE.replace_all(&s, " Black Market - ");
    let s = SHOP_FPS_RE.replace_all(&s, " FPS Gear");
    let s = SHOP_WEP_RE.replace_all(&s, " Ship Weapons");
    let s = SHOP_COMP_RE.replace_all(&s, " Components");
    let s = SHOP_CLOTH_RE.replace_all(&s, " Apparel");
    s.replace('_', " ").trim().to_string()
}

pub fn normalize_item_name(raw_item: &str) -> (String, String) {
    if raw_item.trim().is_empty() {
        return ("Standard Supply".to_string(), "other".to_string());
    }

    let lower = raw_item.to_lowercase();
    let category = if lower.contains("mag") || lower.contains("ammo") || lower.contains("battery") {
        "ammo"
    } else if lower.contains("rifle")
        || lower.contains("hmg")
        || lower.contains("smg")
        || lower.contains("pistol")
        || lower.contains("shotgun")
        || lower.contains("sniper")
    {
        "weapons"
    } else if lower.contains("helmet")
        || lower.contains("undersuit")
        || lower.contains("torso")
        || lower.contains("armor")
        || lower.contains("arms")
        || lower.contains("legs")
        || lower.contains("backpack")
    {
        "armor"
    } else if lower.contains("shield")
        || lower.contains("cooler")
        || lower.contains("quantum")
        || lower.contains("powerplant")
    {
        "components"
    } else if lower.contains("medpen")
        || lower.contains("oxypun")
        || lower.contains("drink")
        || lower.contains("food")
        || lower.contains("medical")
    {
        "consumable"
    } else {
        "other"
    };

    let clean = raw_item
        .replace('_', " ")
        .split_whitespace()
        .map(capitalize_word)
        .collect::<Vec<_>>()
        .join(" ");

    (clean, category.to_string())
}

pub fn normalize_destination(raw_dest: &str) -> String {
    if raw_dest.trim().is_empty() {
        return "Uncharted Space".to_string();
    }
    let lower = raw_dest.to_lowercase();
    if raw_dest.contains("stan-pyro_jp1") {
        return "Stanton-Pyro Jump Point Station".to_string();
    }
    if raw_dest.contains("pyro-stan_jp1") {
        return "Pyro-Stanton Jump Point Station".to_string();
    }
    if lower.contains("pyro4") {
        return "Pyro IV".to_string();
    }
    if lower.contains("pyro1") {
        return "Pyro I".to_string();
    }
    if lower.contains("pyro2") {
        return "Pyro II".to_string();
    }
    if lower.contains("pyro3") {
        return "Pyro III".to_string();
    }
    if lower.contains("pyro5") {
        return "Pyro V".to_string();
    }
    if lower.contains("pyro6") {
        return "Pyro VI".to_string();
    }
    if lower.contains("microtech") {
        return "microTech".to_string();
    }
    if lower.contains("hurston") {
        return "Hurston".to_string();
    }
    if lower.contains("crusader") {
        return "Crusader".to_string();
    }
    if lower.contains("arccorp") {
        return "ArcCorp".to_string();
    }

    let step1 = LOC_EXT_RE.replace(raw_dest, "");
    let clean = LOC_RE.replace(&step1, "");
    clean.replace('_', " ").to_uppercase()
}
