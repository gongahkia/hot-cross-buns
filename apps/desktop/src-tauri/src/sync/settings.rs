use rusqlite::OptionalExtension;
use uuid::Uuid;

use crate::models::SyncSettings;

fn row_to_sync_settings(row: &rusqlite::Row) -> rusqlite::Result<SyncSettings> {
    let auto_sync_enabled: i32 = row.get(3)?;

    Ok(SyncSettings {
        server_url: row.get(0)?,
        auth_token: row.get(1)?,
        device_id: row.get(2)?,
        auto_sync_enabled: auto_sync_enabled != 0,
        last_synced_at: row.get(4)?,
    })
}

pub fn default_sync_settings() -> SyncSettings {
    SyncSettings {
        server_url: String::new(),
        auth_token: String::new(),
        device_id: Uuid::now_v7().to_string(),
        auto_sync_enabled: false,
        last_synced_at: None,
    }
}

pub fn save_sync_settings_record(
    conn: &rusqlite::Connection,
    settings: &SyncSettings,
) -> Result<SyncSettings, String> {
    conn.execute(
        "INSERT INTO sync_settings (id, server_url, auth_token, device_id, auto_sync_enabled, last_synced_at)
         VALUES (1, ?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(id) DO UPDATE SET
           server_url = excluded.server_url,
           auth_token = excluded.auth_token,
           device_id = excluded.device_id,
           auto_sync_enabled = excluded.auto_sync_enabled,
           last_synced_at = excluded.last_synced_at",
        rusqlite::params![
            &settings.server_url,
            &settings.auth_token,
            &settings.device_id,
            if settings.auto_sync_enabled { 1 } else { 0 },
            &settings.last_synced_at,
        ],
    )
    .map_err(|e| format!("Failed to save sync settings: {}", e))?;

    Ok(settings.clone())
}

pub fn get_or_create_sync_settings(conn: &rusqlite::Connection) -> Result<SyncSettings, String> {
    let existing = conn
        .query_row(
            "SELECT server_url, auth_token, device_id, auto_sync_enabled, last_synced_at
             FROM sync_settings WHERE id = 1",
            [],
            row_to_sync_settings,
        )
        .optional()
        .map_err(|e| format!("Failed to load sync settings: {}", e))?;

    if let Some(settings) = existing {
        return Ok(settings);
    }

    let settings = default_sync_settings();
    save_sync_settings_record(conn, &settings)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use std::path::PathBuf;
    use tempfile::TempDir;

    fn setup_test_db() -> (TempDir, PathBuf) {
        let tmp = TempDir::new().expect("failed to create temp dir");
        let db_path = tmp.path().to_path_buf();
        db::init_db(&db_path).expect("failed to init test db");
        (tmp, db_path)
    }

    #[test]
    fn test_get_or_create_sync_settings_creates_default_record() {
        let (_tmp, db_path) = setup_test_db();
        let conn = db::get_connection(&db_path).expect("failed to open connection");

        let settings = get_or_create_sync_settings(&conn).expect("failed to get sync settings");

        assert_eq!(settings.server_url, "");
        assert_eq!(settings.auth_token, "");
        assert!(!settings.device_id.is_empty());
        assert!(!settings.auto_sync_enabled);
        assert!(settings.last_synced_at.is_none());
    }

    #[test]
    fn test_save_sync_settings_persists_values() {
        let (_tmp, db_path) = setup_test_db();
        let conn = db::get_connection(&db_path).expect("failed to open connection");

        let settings = SyncSettings {
            server_url: "https://sync.example.com".to_string(),
            auth_token: "secret-token".to_string(),
            device_id: "desktop-123".to_string(),
            auto_sync_enabled: true,
            last_synced_at: Some("2026-03-22T00:00:00Z".to_string()),
        };

        save_sync_settings_record(&conn, &settings).expect("failed to save sync settings");
        let loaded = get_or_create_sync_settings(&conn).expect("failed to reload sync settings");

        assert_eq!(loaded.server_url, settings.server_url);
        assert_eq!(loaded.auth_token, settings.auth_token);
        assert_eq!(loaded.device_id, settings.device_id);
        assert!(loaded.auto_sync_enabled);
        assert_eq!(loaded.last_synced_at, settings.last_synced_at);
    }
}
