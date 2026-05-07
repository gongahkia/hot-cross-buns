//! Auto-refresh-aware Drive operations.
//!
//! Each op resolves a fresh access token via the supplied
//! [`TokenStore`], runs the operation, and retries once after refresh
//! on HTTP 401. Lives in `runtime-shared` so the macOS runtime can call
//! the same functions with its Keychain-backed token store.

use crate::oauth_flow::{ensure_fresh_access_token, refresh_stored_token};
use crate::token_store::TokenStore;
use melon_pan_net::{DriveClient, DriveTransportError, HttpClient, HttpError};
use std::path::Path;

#[derive(Debug)]
pub enum DriveOpError {
    TokenResolution(String),
    Http(String),
    Unauthorized,
}

impl std::fmt::Display for DriveOpError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DriveOpError::TokenResolution(message) => write!(f, "token resolution: {message}"),
            DriveOpError::Http(message) => write!(f, "{message}"),
            DriveOpError::Unauthorized => f.write_str("HTTP 401 even after refresh"),
        }
    }
}

impl std::error::Error for DriveOpError {}

pub fn rename(
    store: &dyn TokenStore,
    credentials_path: &Path,
    account: &str,
    file_id: &str,
    new_name: &str,
) -> Result<(), DriveOpError> {
    run_with_refresh(store, credentials_path, account, |access_token| {
        client(access_token)?.rename(file_id, new_name).map(|_| ())
    })
}

pub fn move_to(
    store: &dyn TokenStore,
    credentials_path: &Path,
    account: &str,
    file_id: &str,
    new_parent: &str,
    old_parent: &str,
) -> Result<(), DriveOpError> {
    run_with_refresh(store, credentials_path, account, |access_token| {
        client(access_token)?
            .move_to(file_id, new_parent, old_parent)
            .map(|_| ())
    })
}

pub fn trash(
    store: &dyn TokenStore,
    credentials_path: &Path,
    account: &str,
    file_id: &str,
) -> Result<(), DriveOpError> {
    run_with_refresh(store, credentials_path, account, |access_token| {
        client(access_token)?.trash(file_id).map(|_| ())
    })
}

pub fn untrash(
    store: &dyn TokenStore,
    credentials_path: &Path,
    account: &str,
    file_id: &str,
) -> Result<(), DriveOpError> {
    run_with_refresh(store, credentials_path, account, |access_token| {
        client(access_token)?.untrash(file_id).map(|_| ())
    })
}

/// Permanently deletes a file. Bypasses the trash safety net — caller
/// must have collected an explicit confirmation.
pub fn delete_permanent(
    store: &dyn TokenStore,
    credentials_path: &Path,
    account: &str,
    file_id: &str,
) -> Result<(), DriveOpError> {
    run_with_refresh(store, credentials_path, account, |access_token| {
        client(access_token)?.delete(file_id)
    })
}

fn client(access_token: &str) -> Result<DriveClient, DriveTransportError> {
    let http = HttpClient::new(access_token.to_string()).map_err(DriveTransportError::Http)?;
    Ok(DriveClient::new(http))
}

fn run_with_refresh<F>(
    store: &dyn TokenStore,
    credentials_path: &Path,
    account: &str,
    mut operation: F,
) -> Result<(), DriveOpError>
where
    F: FnMut(&str) -> Result<(), DriveTransportError>,
{
    let stored = ensure_fresh_access_token(store, credentials_path, account, 30)
        .map_err(|error| DriveOpError::TokenResolution(error.to_string()))?;
    match operation(&stored.access_token) {
        Ok(()) => Ok(()),
        Err(DriveTransportError::Http(HttpError::Status { status: 401, .. })) => {
            refresh_stored_token(store, credentials_path, account)
                .map_err(|error| DriveOpError::TokenResolution(error.to_string()))?;
            let stored = ensure_fresh_access_token(store, credentials_path, account, 30)
                .map_err(|error| DriveOpError::TokenResolution(error.to_string()))?;
            match operation(&stored.access_token) {
                Ok(()) => Ok(()),
                Err(DriveTransportError::Http(HttpError::Status { status: 401, .. })) => {
                    Err(DriveOpError::Unauthorized)
                }
                Err(error) => Err(DriveOpError::Http(error.to_string())),
            }
        }
        Err(error) => Err(DriveOpError::Http(error.to_string())),
    }
}
