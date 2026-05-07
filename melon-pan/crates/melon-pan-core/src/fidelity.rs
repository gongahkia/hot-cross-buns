//! Structured warnings surfaced by parsers and sync layers.
//!
//! Originally introduced for Markdown round-trip lossiness reporting; kept
//! as a general "this operation has concerns the user should see" surface
//! for the rich-doc pipeline (unsupported elements, deferred features,
//! conflict heuristics). The markdown subsystem itself has been removed —
//! these types remain as the metadata-record schema's warning shape.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FidelityReport {
    pub score: u8,
    pub warnings: Vec<FidelityWarning>,
}

impl FidelityReport {
    pub fn perfect() -> Self {
        Self {
            score: 100,
            warnings: Vec::new(),
        }
    }

    pub fn with_warning(mut self, warning: FidelityWarning) -> Self {
        self.score = self.score.saturating_sub(warning.severity_penalty());
        self.warnings.push(warning);
        self
    }
}

impl Default for FidelityReport {
    fn default() -> Self {
        Self::perfect()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FidelityWarning {
    pub kind: WarningKind,
    pub message: String,
}

impl FidelityWarning {
    pub fn new(kind: WarningKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    fn severity_penalty(&self) -> u8 {
        match self.kind {
            WarningKind::LosslessApproximation => 5,
            WarningKind::LossyApproximation => 20,
            WarningKind::UnsupportedConstruct => 40,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WarningKind {
    LosslessApproximation,
    LossyApproximation,
    UnsupportedConstruct,
}
