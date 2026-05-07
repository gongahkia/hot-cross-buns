use chrono::{Local, TimeZone};
use melon_pan_runtime_shared::templates::{
    delete_template, expand, list_templates, load_template, save_template, ExpandContext,
    MarkdownTemplate,
};
use std::fs;
use std::path::PathBuf;

#[test]
fn save_list_mutate_delete_round_trips() {
    let root = temp_root("roundtrip");
    let first = MarkdownTemplate {
        id: "7E4D2A11-9B6C-4F88-9CB7-2A17F0A6B0E3".to_string(),
        name: "Weekly Review".to_string(),
        body: "# {{title}}\n\n{{date}}\n".to_string(),
        created_at: "2026-04-12T15:32:00Z".to_string(),
        updated_at: "2026-04-30T08:11:00Z".to_string(),
    };
    let second = MarkdownTemplate {
        id: "8E4D2A11-9B6C-4F88-9CB7-2A17F0A6B0E3".to_string(),
        name: "1:1 / Plan".to_string(),
        body: "Agenda".to_string(),
        created_at: "2026-04-12T15:32:00Z".to_string(),
        updated_at: "2026-04-30T08:12:00Z".to_string(),
    };
    let third = MarkdownTemplate {
        id: "9E4D2A11-9B6C-4F88-9CB7-2A17F0A6B0E3".to_string(),
        name: "Weekly Review".to_string(),
        body: "Duplicate".to_string(),
        created_at: "2026-04-12T15:32:00Z".to_string(),
        updated_at: "2026-04-30T08:13:00Z".to_string(),
    };

    save_template(&root, &first).unwrap();
    save_template(&root, &second).unwrap();
    save_template(&root, &third).unwrap();

    let listed = list_templates(&root).unwrap();
    assert_eq!(listed.len(), 3);
    assert!(listed.iter().any(|info| info.id == first.id));
    assert!(root.join("templates").join("Weekly Review.md").exists());
    assert!(root.join("templates").join("Weekly Review-2.md").exists());
    assert!(root.join("templates").join("1_1 _ Plan.md").exists());

    let mut updated = first.clone();
    updated.body = "Updated body".to_string();
    updated.updated_at = "2026-05-01T00:00:00Z".to_string();
    save_template(&root, &updated).unwrap();

    let listed = list_templates(&root).unwrap();
    assert_eq!(listed.len(), 3);
    assert_eq!(
        load_template(&root, &first.id).unwrap().body,
        "Updated body"
    );

    delete_template(&root, &second.id).unwrap();
    assert_eq!(list_templates(&root).unwrap().len(), 2);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn markdown_without_frontmatter_lists_and_becomes_editable() {
    let root = temp_root("plain-markdown");
    let dir = root.join("templates");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("Plain Template.md"), "# Plain\n\nBody").unwrap();

    let listed = list_templates(&root).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].name, "Plain Template");
    let loaded = load_template(&root, &listed[0].id).unwrap();
    assert_eq!(loaded.body, "# Plain\n\nBody");

    let mut edited = loaded;
    edited.body = "Edited".to_string();
    save_template(&root, &edited).unwrap();
    let raw = fs::read_to_string(dir.join("Plain Template.md")).unwrap();
    assert!(raw.starts_with("---\nid: "));
    assert!(raw.contains("\n---\nEdited"));
    let _ = fs::remove_dir_all(root);
}

#[test]
fn expansion_matches_template_rules() {
    let now = Local.with_ymd_and_hms(2026, 5, 3, 14, 5, 0).unwrap();
    let ctx = ExpandContext {
        now,
        title: "Plan",
        author: "user@example.com",
    };
    let expanded = expand(
        "{{date}} {{time}} {{datetime}} {{ title }} {{author}} {{cursor}} {{missing}}",
        &ctx,
    );
    assert_eq!(
        expanded,
        "2026-05-03 14:05 2026-05-03 14:05 Plan user@example.com \u{2045}cursor\u{2046} {{missing}}"
    );
}

fn temp_root(name: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "melon-pan-templates-{name}-{}-{}",
        std::process::id(),
        chrono::Utc::now().timestamp_nanos_opt().unwrap()
    ))
}
