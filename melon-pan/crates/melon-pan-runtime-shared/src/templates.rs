use chrono::{DateTime, Local, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownTemplate {
    pub id: String,
    pub name: String,
    pub body: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TemplateInfo {
    pub id: String,
    pub name: String,
    pub path: String,
    pub updated_at: String,
}

pub struct ExpandContext<'a> {
    pub now: DateTime<Local>,
    pub title: &'a str,
    pub author: &'a str,
}

pub fn templates_dir(cache_root: &Path) -> PathBuf {
    cache_root.join("templates")
}

pub fn list_templates(cache_root: &Path) -> io::Result<Vec<TemplateInfo>> {
    let dir = templates_dir(cache_root);
    fs::create_dir_all(&dir)?;
    let mut templates = Vec::new();
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("md") {
            continue;
        }
        let loaded = load_template_from_path(&path)?;
        let display_path = fs::canonicalize(&path).unwrap_or_else(|_| path.clone());
        templates.push(TemplateInfo {
            id: loaded.id,
            name: loaded.name,
            path: display_path.to_string_lossy().into_owned(),
            updated_at: loaded.updated_at,
        });
    }
    templates.sort_by(|left, right| {
        left.name
            .to_lowercase()
            .cmp(&right.name.to_lowercase())
            .then_with(|| left.path.cmp(&right.path))
    });
    Ok(templates)
}

pub fn list_templates_json(cache_root: &Path) -> io::Result<String> {
    serde_json::to_string(&list_templates(cache_root)?).map_err(json_error)
}

pub fn load_template(cache_root: &Path, id: &str) -> io::Result<MarkdownTemplate> {
    let path = find_template_path(cache_root, id)?
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "template not found"))?;
    load_template_from_path(&path)
}

pub fn load_template_json(cache_root: &Path, id: &str) -> io::Result<String> {
    serde_json::to_string(&load_template(cache_root, id)?).map_err(json_error)
}

pub fn save_template_json(cache_root: &Path, json: &str) -> io::Result<()> {
    let template: MarkdownTemplate = serde_json::from_str(json).map_err(json_error)?;
    save_template(cache_root, &template).map(|_| ())
}

pub fn save_template(cache_root: &Path, template: &MarkdownTemplate) -> io::Result<PathBuf> {
    let dir = templates_dir(cache_root);
    fs::create_dir_all(&dir)?;
    let old_path = find_template_path(cache_root, &template.id)?;
    let base_name = if template.name.trim().is_empty() {
        "untitled"
    } else {
        template.name.trim()
    };
    let base_stem = sanitize_file_stem(base_name);
    let target = unique_template_path(&dir, &base_stem, old_path.as_deref());
    let tmp = target.with_extension("md.tmp");
    fs::write(&tmp, template_to_markdown(template))?;
    fs::rename(&tmp, &target)?;
    if let Some(old_path) = old_path {
        if old_path != target {
            fs::remove_file(old_path)?;
        }
    }
    Ok(target)
}

pub fn delete_template(cache_root: &Path, id: &str) -> io::Result<()> {
    let path = find_template_path(cache_root, id)?
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "template not found"))?;
    fs::remove_file(path)
}

pub fn expand(body: &str, ctx: &ExpandContext<'_>) -> String {
    if !body.contains("{{") {
        return body.to_string();
    }
    let mut out = String::new();
    let mut rest = body;
    while let Some(open) = rest.find("{{") {
        out.push_str(&rest[..open]);
        let after_open = &rest[open + 2..];
        let Some(close) = after_open.find("}}") else {
            out.push_str(&rest[open..]);
            return out;
        };
        let key = &after_open[..close];
        if let Some(value) = resolve(key, ctx) {
            out.push_str(&value);
        } else {
            out.push_str("{{");
            out.push_str(key);
            out.push_str("}}");
        }
        rest = &after_open[close + 2..];
    }
    out.push_str(rest);
    out
}

pub fn expand_with_local_now(body: &str, title: &str, author: &str) -> String {
    expand(
        body,
        &ExpandContext {
            now: Local::now(),
            title,
            author,
        },
    )
}

fn resolve(key: &str, ctx: &ExpandContext<'_>) -> Option<String> {
    match key.trim() {
        "date" => Some(ctx.now.format("%Y-%m-%d").to_string()),
        "time" => Some(ctx.now.format("%H:%M").to_string()),
        "datetime" => Some(ctx.now.format("%Y-%m-%d %H:%M").to_string()),
        "title" => Some(ctx.title.to_owned()),
        "author" => Some(ctx.author.to_owned()),
        "cursor" => Some("\u{2045}cursor\u{2046}".to_owned()),
        _ => None,
    }
}

fn load_template_from_path(path: &Path) -> io::Result<MarkdownTemplate> {
    let raw = fs::read_to_string(path)?;
    let fallback_name = path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("Untitled Template")
        .to_string();
    let fallback_stamp = file_mtime_iso(path);
    let fallback_id = deterministic_id(path);
    if let Some((frontmatter, body)) = split_frontmatter(&raw) {
        let meta = parse_frontmatter(frontmatter);
        return Ok(MarkdownTemplate {
            id: meta.id.unwrap_or(fallback_id),
            name: meta.name.unwrap_or(fallback_name),
            body: body.to_string(),
            created_at: meta.created_at.unwrap_or_else(|| fallback_stamp.clone()),
            updated_at: meta.updated_at.unwrap_or(fallback_stamp),
        });
    }
    Ok(MarkdownTemplate {
        id: fallback_id,
        name: fallback_name,
        body: raw,
        created_at: fallback_stamp.clone(),
        updated_at: fallback_stamp,
    })
}

fn find_template_path(cache_root: &Path, id: &str) -> io::Result<Option<PathBuf>> {
    let dir = templates_dir(cache_root);
    let Ok(entries) = fs::read_dir(dir) else {
        return Ok(None);
    };
    for entry in entries {
        let path = entry?.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("md") {
            continue;
        }
        let template = load_template_from_path(&path)?;
        if template.id == id {
            return Ok(Some(path));
        }
    }
    Ok(None)
}

fn unique_template_path(dir: &Path, base_stem: &str, old_path: Option<&Path>) -> PathBuf {
    let mut candidate = dir.join(format!("{base_stem}.md"));
    if path_available(&candidate, old_path) {
        return candidate;
    }
    for index in 2.. {
        candidate = dir.join(format!("{base_stem}-{index}.md"));
        if path_available(&candidate, old_path) {
            return candidate;
        }
    }
    unreachable!("unbounded suffix search should find a template path")
}

fn path_available(candidate: &Path, old_path: Option<&Path>) -> bool {
    old_path == Some(candidate) || !candidate.exists()
}

pub fn sanitize_file_stem(value: &str) -> String {
    let sanitized = value
        .chars()
        .map(|ch| match ch {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            ch if ch.is_control() => '_',
            _ => ch,
        })
        .collect::<String>();
    if sanitized.trim().is_empty() {
        "untitled".to_string()
    } else {
        sanitized
    }
}

fn template_to_markdown(template: &MarkdownTemplate) -> String {
    format!(
        "---\nid: {}\nname: {}\ncreatedAt: {}\nupdatedAt: {}\n---\n{}",
        template.id, template.name, template.created_at, template.updated_at, template.body
    )
}

fn split_frontmatter(raw: &str) -> Option<(&str, &str)> {
    let rest = raw.strip_prefix("---\n")?;
    let close = rest.find("\n---\n")?;
    Some((&rest[..close], &rest[close + 5..]))
}

#[derive(Default)]
struct ParsedFrontmatter {
    id: Option<String>,
    name: Option<String>,
    created_at: Option<String>,
    updated_at: Option<String>,
}

fn parse_frontmatter(raw: &str) -> ParsedFrontmatter {
    let mut parsed = ParsedFrontmatter::default();
    for line in raw.lines() {
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let value = value.trim().to_string();
        match key.trim() {
            "id" if !value.is_empty() => parsed.id = Some(value),
            "name" if !value.is_empty() => parsed.name = Some(value),
            "createdAt" if !value.is_empty() => parsed.created_at = Some(value),
            "updatedAt" if !value.is_empty() => parsed.updated_at = Some(value),
            _ => {}
        }
    }
    parsed
}

fn file_mtime_iso(path: &Path) -> String {
    fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .map(system_time_iso)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

fn system_time_iso(time: SystemTime) -> String {
    let utc: DateTime<Utc> = time.into();
    utc.to_rfc3339_opts(SecondsFormat::Secs, true)
}

fn deterministic_id(path: &Path) -> String {
    let text = path.to_string_lossy();
    let hi = stable_hash_with_seed(&text, 0xcbf29ce484222325);
    let lo = stable_hash_with_seed(&text, 0x100000001b3);
    let value = ((hi as u128) << 64) | (lo as u128);
    format!(
        "{:08x}-{:04x}-{:04x}-{:04x}-{:012x}",
        (value >> 96) as u32,
        (value >> 80) as u16,
        (value >> 64) as u16,
        (value >> 48) as u16,
        value & 0x0000_ffff_ffff_ffff_ffff
    )
}

fn stable_hash_with_seed(value: &str, seed: u64) -> u64 {
    let mut hash = seed;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn json_error(error: serde_json::Error) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, error)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn expand_preserves_unknown_and_trims_known_keys() {
        let now = Local.with_ymd_and_hms(2026, 5, 3, 9, 7, 0).unwrap();
        let ctx = ExpandContext {
            now,
            title: "Daily Note",
            author: "writer@example.com",
        };
        let out = expand(
            "{{ date }} {{time}} {{datetime}} {{title}} {{author}} {{cursor}} {{foo}}",
            &ctx,
        );
        assert_eq!(
            out,
            "2026-05-03 09:07 2026-05-03 09:07 Daily Note writer@example.com \u{2045}cursor\u{2046} {{foo}}"
        );
    }

    #[test]
    fn sanitize_uses_filesystem_safe_rules() {
        assert_eq!(sanitize_file_stem(r#"a/\:*?"<>|"#), "a_________");
        assert_eq!(sanitize_file_stem("\n"), "_");
        assert_eq!(sanitize_file_stem("   "), "untitled");
    }
}
