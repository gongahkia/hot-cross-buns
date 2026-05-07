//! Token-store interface used by OAuth and Drive operations.
//!
//! The macOS app stores OAuth refresh tokens in Keychain via the Security
//! framework. Tests use an in-memory implementation. Both need the same
//! shape: a key-value boundary keyed by account name, with the value being
//! the JSON serialization of a `StoredTokenSet`.
//!
//! `TokenStore` is the boundary. The shared `oauth_flow` and `drive_ops`
//! modules take a `&dyn TokenStore` so tests and the macOS runtime can
//! share the same operation code.
//!
//! Errors are typed as `String` rather than a custom enum because the
//! underlying OS surfaces have wildly different error shapes
//! (OSStatus, test failures, future storage backends) that do not compose
//! into a clean enum. The string is surfaced to the user; that is enough
//! for v1.

/// OAuth token-store boundary.
///
/// Implementors must be `Send + Sync` so background workers can hold a
/// reference across thread boundaries. Each method takes `&self` (not
/// `&mut self`) so a store can be cheaply cloned and shared.
pub trait TokenStore: Send + Sync {
    /// Returns the persisted JSON for `account`, or an `Err(String)`
    /// when the store is unavailable. A "no entry" result is signalled
    /// by an `Err` with a recognisable message — implementations
    /// should not panic on a missing entry.
    fn lookup(&self, account: &str) -> Result<String, String>;

    /// Persists `token_json` against `account`, overwriting any prior
    /// entry. The shape of `token_json` is `StoredTokenSet::to_json()`.
    fn store(&self, account: &str, token_json: &str) -> Result<(), String>;

    /// Removes the entry for `account`. A no-op when no entry exists is
    /// permitted but not required.
    fn clear(&self, account: &str) -> Result<(), String>;

    /// Lists every account known to the store. Order is implementation-
    /// defined; callers that care about ordering should sort the result.
    fn list_accounts(&self) -> Vec<String>;
}

/// In-memory token store. Used by the corpus / cache contract tests
/// and any future integration test that wants to exercise the OAuth
/// flow without touching the host's Keychain.
///
/// Wrapped in `Mutex` so the trait's `&self` methods can mutate the
/// backing map.
#[derive(Default)]
pub struct InMemoryTokenStore {
    inner: std::sync::Mutex<std::collections::HashMap<String, String>>,
}

impl InMemoryTokenStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_entry(account: impl Into<String>, token_json: impl Into<String>) -> Self {
        let store = Self::new();
        let _ = store.store(&account.into(), &token_json.into());
        store
    }
}

impl TokenStore for InMemoryTokenStore {
    fn lookup(&self, account: &str) -> Result<String, String> {
        let map = self.inner.lock().map_err(|e| e.to_string())?;
        map.get(account)
            .cloned()
            .ok_or_else(|| format!("no token for account '{account}'"))
    }

    fn store(&self, account: &str, token_json: &str) -> Result<(), String> {
        let mut map = self.inner.lock().map_err(|e| e.to_string())?;
        map.insert(account.to_string(), token_json.to_string());
        Ok(())
    }

    fn clear(&self, account: &str) -> Result<(), String> {
        let mut map = self.inner.lock().map_err(|e| e.to_string())?;
        map.remove(account);
        Ok(())
    }

    fn list_accounts(&self) -> Vec<String> {
        self.inner
            .lock()
            .map(|map| map.keys().cloned().collect())
            .unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn in_memory_store_round_trips_through_lookup() {
        let store = InMemoryTokenStore::new();
        store.store("alice@example.com", "{\"x\":1}").unwrap();
        store.store("bob@example.com", "{\"y\":2}").unwrap();
        assert_eq!(store.lookup("alice@example.com").unwrap(), "{\"x\":1}");
        let mut accounts = store.list_accounts();
        accounts.sort();
        assert_eq!(accounts, vec!["alice@example.com", "bob@example.com"]);
        store.clear("alice@example.com").unwrap();
        assert!(store.lookup("alice@example.com").is_err());
    }

    #[test]
    fn missing_lookup_carries_account_name_in_error() {
        let store = InMemoryTokenStore::new();
        let err = store.lookup("ghost@example.com").unwrap_err();
        assert!(err.contains("ghost@example.com"));
    }
}
