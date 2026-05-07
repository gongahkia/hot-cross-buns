//! Real HTTP transport for Drive and Docs requests.
//!
//! melon-pan-core builds urls/bodies and parses responses; this crate owns the
//! reqwest client and wires the two together for the macOS runtime.

pub mod docs;
pub mod drive;
pub mod drive_comments;
pub mod oauth;
pub mod transport;

pub use docs::{DocsClient, DocsTransportError};
pub use drive::{DriveClient, DriveTransportError};
pub use drive_comments::{DriveCommentsClient, DriveCommentsTransportError};
pub use oauth::{OAuthClient, OAuthHttpError};
pub use transport::{HttpClient, HttpError};
