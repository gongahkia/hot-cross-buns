//! Three-way conflict classification for rich documents.
//!
//! The classifier compares:
//! - base: the last revision we edited against
//! - local: base plus queued local operations
//! - remote: the latest pulled Google Docs revision
//!
//! It intentionally classifies first and resolves later. Resolution is
//! handled by the runtime by canceling selected queued operations or by
//! replaying the remaining operation log.

use crate::encoding::json_escape;
use crate::rich_model::{
    RichBlock, RichDocument, RichInline, RichNodeId, RichParagraph, RichTab, RichTable,
    RichTableCell,
};
use crate::rich_ops::{RichOperation, RichOperationEnvelope};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConflictReport {
    pub document_id: String,
    pub base_revision_id: String,
    pub remote_revision_id: String,
    pub auto_merge: Vec<ResolvedRegion>,
    pub local_wins: Vec<ResolvedRegion>,
    pub remote_wins: Vec<ResolvedRegion>,
    pub user_decision: Vec<UnresolvedConflict>,
    pub destructive: Vec<DestructiveConflict>,
}

impl ConflictReport {
    pub fn has_user_work(&self) -> bool {
        !self.user_decision.is_empty() || !self.destructive.is_empty()
    }

    pub fn to_json(&self) -> String {
        format!(
            "{{\"documentId\":\"{}\",\"baseRevisionId\":\"{}\",\"remoteRevisionId\":\"{}\",\
             \"autoMerge\":{},\"localWins\":{},\"remoteWins\":{},\"userDecision\":{},\"destructive\":{},\
             \"hasUserWork\":{}}}",
            json_escape(&self.document_id),
            json_escape(&self.base_revision_id),
            json_escape(&self.remote_revision_id),
            resolved_regions_json(&self.auto_merge),
            resolved_regions_json(&self.local_wins),
            resolved_regions_json(&self.remote_wins),
            unresolved_conflicts_json(&self.user_decision),
            destructive_conflicts_json(&self.destructive),
            self.has_user_work()
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedRegion {
    pub id: String,
    pub kind: String,
    pub node_id: String,
    pub title: String,
    pub base_text: String,
    pub local_text: String,
    pub remote_text: String,
    pub local_operation_ids: Vec<String>,
    pub table_id: Option<String>,
    pub row_index: Option<u32>,
    pub column_index: Option<u32>,
    pub row_span: Option<u32>,
    pub column_span: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnresolvedConflict {
    pub id: String,
    pub kind: String,
    pub node_id: String,
    pub title: String,
    pub base_text: String,
    pub local_text: String,
    pub remote_text: String,
    pub local_operation_ids: Vec<String>,
    pub table_id: Option<String>,
    pub row_index: Option<u32>,
    pub column_index: Option<u32>,
    pub row_span: Option<u32>,
    pub column_span: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DestructiveConflict {
    pub id: String,
    pub kind: String,
    pub node_id: String,
    pub title: String,
    pub reason: String,
    pub local_operation_ids: Vec<String>,
    pub table_id: Option<String>,
    pub row_index: Option<u32>,
    pub column_index: Option<u32>,
    pub row_span: Option<u32>,
    pub column_span: Option<u32>,
}

#[derive(Debug, Clone)]
struct RegionSnapshot {
    kind: &'static str,
    node_id: String,
    title: String,
    text: String,
    target_node_ids: Vec<String>,
    table_id: Option<String>,
    row_index: Option<u32>,
    column_index: Option<u32>,
    row_span: Option<u32>,
    column_span: Option<u32>,
}

pub fn classify_conflict(
    base: &RichDocument,
    local: &RichDocument,
    remote: &RichDocument,
    local_envelopes: &[RichOperationEnvelope],
) -> ConflictReport {
    let base_map = region_map(base);
    let local_map = region_map(local);
    let remote_map = region_map(remote);
    let op_ids_by_node = operation_ids_by_target(local_envelopes);

    let mut keys = BTreeSet::new();
    keys.extend(base_map.keys().cloned());
    keys.extend(local_map.keys().cloned());
    keys.extend(remote_map.keys().cloned());

    let mut report = ConflictReport {
        document_id: base.document_id.clone(),
        base_revision_id: base.revision.revision_id.clone(),
        remote_revision_id: remote.revision.revision_id.clone(),
        auto_merge: Vec::new(),
        local_wins: Vec::new(),
        remote_wins: Vec::new(),
        user_decision: Vec::new(),
        destructive: Vec::new(),
    };

    for key in keys {
        let base_para = base_map.get(&key);
        let local_para = local_map.get(&key);
        let remote_para = remote_map.get(&key);

        let base_text = base_para.map(|p| p.text.as_str()).unwrap_or("");
        let local_text = local_para.map(|p| p.text.as_str()).unwrap_or("");
        let remote_text = remote_para.map(|p| p.text.as_str()).unwrap_or("");

        if local_text == remote_text {
            if base_text != local_text {
                report.auto_merge.push(resolved_region(
                    &key,
                    base_para,
                    local_para,
                    remote_para,
                    base_text,
                    local_text,
                    remote_text,
                    &op_ids_by_node,
                ));
            }
            continue;
        }

        match (base_para, local_para, remote_para) {
            (Some(_), Some(_), Some(_)) => {
                let local_changed = local_text != base_text;
                let remote_changed = remote_text != base_text;
                if local_changed && remote_changed {
                    report.user_decision.push(unresolved_conflict(
                        &key,
                        base_para,
                        local_para,
                        remote_para,
                        base_text,
                        local_text,
                        remote_text,
                        &op_ids_by_node,
                    ));
                } else if local_changed {
                    report.local_wins.push(resolved_region(
                        &key,
                        base_para,
                        local_para,
                        remote_para,
                        base_text,
                        local_text,
                        remote_text,
                        &op_ids_by_node,
                    ));
                } else if remote_changed {
                    report.remote_wins.push(resolved_region(
                        &key,
                        base_para,
                        local_para,
                        remote_para,
                        base_text,
                        local_text,
                        remote_text,
                        &op_ids_by_node,
                    ));
                }
            }
            (Some(_), Some(_), None) => {
                report.destructive.push(destructive_conflict(
                    &key,
                    base_para,
                    local_para,
                    remote_para,
                    "Remote revision deleted this paragraph while local edits are queued.",
                    &op_ids_by_node,
                ));
            }
            (Some(_), None, Some(_)) => {
                if remote_text != base_text {
                    report.destructive.push(destructive_conflict(
                        &key,
                        base_para,
                        local_para,
                        remote_para,
                        "Local revision deleted this paragraph while remote changed it.",
                        &op_ids_by_node,
                    ));
                } else {
                    report.local_wins.push(resolved_region(
                        &key,
                        base_para,
                        local_para,
                        remote_para,
                        base_text,
                        local_text,
                        remote_text,
                        &op_ids_by_node,
                    ));
                }
            }
            (None, Some(_), Some(_)) => {
                report.user_decision.push(unresolved_conflict(
                    &key,
                    base_para,
                    local_para,
                    remote_para,
                    base_text,
                    local_text,
                    remote_text,
                    &op_ids_by_node,
                ));
            }
            (None, Some(_), None) => {
                report.auto_merge.push(resolved_region(
                    &key,
                    base_para,
                    local_para,
                    remote_para,
                    base_text,
                    local_text,
                    remote_text,
                    &op_ids_by_node,
                ));
            }
            (None, None, Some(_)) => {
                report.remote_wins.push(resolved_region(
                    &key,
                    base_para,
                    local_para,
                    remote_para,
                    base_text,
                    local_text,
                    remote_text,
                    &op_ids_by_node,
                ));
            }
            _ => {}
        }
    }

    report
}

fn region_map(document: &RichDocument) -> BTreeMap<String, RegionSnapshot> {
    let mut map = BTreeMap::new();
    for tab in &document.tabs {
        collect_tab_regions(tab, &mut map);
    }
    map
}

fn collect_tab_regions(tab: &RichTab, out: &mut BTreeMap<String, RegionSnapshot>) {
    for block in &tab.body.blocks {
        collect_block_regions(block, out);
    }
    for child in &tab.child_tabs {
        collect_tab_regions(child, out);
    }
}

fn collect_block_regions(block: &RichBlock, out: &mut BTreeMap<String, RegionSnapshot>) {
    match block {
        RichBlock::Paragraph(paragraph) => {
            let key = paragraph_key(paragraph);
            out.insert(
                key.clone(),
                RegionSnapshot {
                    kind: "paragraph",
                    node_id: paragraph.identity.local_id.as_str().to_string(),
                    title: paragraph_title(paragraph),
                    text: paragraph_text(paragraph),
                    target_node_ids: vec![paragraph.identity.local_id.as_str().to_string()],
                    table_id: None,
                    row_index: None,
                    column_index: None,
                    row_span: None,
                    column_span: None,
                },
            );
        }
        RichBlock::Table(table) => {
            collect_table_regions(table, out);
        }
        RichBlock::SectionBreak(_) => {}
        RichBlock::Unsupported(unsupported) => {
            let key = format!("unsupported:{}", unsupported.identity.local_id.as_str());
            out.insert(
                key,
                RegionSnapshot {
                    kind: "unsupportedObject",
                    node_id: unsupported.identity.local_id.as_str().to_string(),
                    title: unsupported.description.clone(),
                    text: unsupported.description.clone(),
                    target_node_ids: vec![unsupported.identity.local_id.as_str().to_string()],
                    table_id: None,
                    row_index: None,
                    column_index: None,
                    row_span: None,
                    column_span: None,
                },
            );
        }
    }
}

fn collect_table_regions(table: &RichTable, out: &mut BTreeMap<String, RegionSnapshot>) {
    let table_key = table_key(table);
    out.insert(
        table_key,
        RegionSnapshot {
            kind: "table",
            node_id: table.identity.local_id.as_str().to_string(),
            title: format!("Table {} x {}", table.rows.len(), table.columns),
            text: table_shape_signature(table),
            target_node_ids: vec![table.identity.local_id.as_str().to_string()],
            table_id: Some(table.identity.local_id.as_str().to_string()),
            row_index: None,
            column_index: None,
            row_span: None,
            column_span: None,
        },
    );

    for (row_index, row) in table.rows.iter().enumerate() {
        for (column_index, cell) in row.cells.iter().enumerate() {
            let cell_key = table_cell_key(table, cell, row_index as u32, column_index as u32);
            let mut targets = vec![
                cell.identity.local_id.as_str().to_string(),
                table_cell_target(table, row_index as u32, column_index as u32),
            ];
            collect_cell_paragraph_ids(cell, &mut targets);
            targets.sort();
            targets.dedup();
            out.insert(
                cell_key,
                RegionSnapshot {
                    kind: "tableCell",
                    node_id: first_cell_paragraph_id(cell)
                        .unwrap_or_else(|| cell.identity.local_id.as_str().to_string()),
                    title: format!("Table cell {}, {}", row_index + 1, column_index + 1),
                    text: table_cell_text(cell),
                    target_node_ids: targets,
                    table_id: Some(table.identity.local_id.as_str().to_string()),
                    row_index: Some(row_index as u32),
                    column_index: Some(column_index as u32),
                    row_span: Some(cell.row_span),
                    column_span: Some(cell.column_span),
                },
            );
        }
    }
}

fn table_key(table: &RichTable) -> String {
    if let Some(start) = table.identity.source_start_index {
        return format!(
            "tableidx:{}:{}:{}",
            table.identity.source_tab_id, table.identity.source_segment_id, start
        );
    }
    format!("table:{}", table.identity.local_id.as_str())
}

fn table_cell_key(
    table: &RichTable,
    cell: &RichTableCell,
    row_index: u32,
    column_index: u32,
) -> String {
    if let Some(start) = cell.identity.source_start_index {
        return format!(
            "cellidx:{}:{}:{}",
            cell.identity.source_tab_id, cell.identity.source_segment_id, start
        );
    }
    format!(
        "cell:{}:{}:{}",
        table.identity.local_id.as_str(),
        row_index,
        column_index
    )
}

fn table_cell_target(table: &RichTable, row_index: u32, column_index: u32) -> String {
    format!(
        "{}@{}:{}",
        table.identity.local_id.as_str(),
        row_index,
        column_index
    )
}

fn table_shape_signature(table: &RichTable) -> String {
    let mut parts = vec![format!(
        "rows:{} columns:{}",
        table.rows.len(),
        table.columns
    )];
    for (row_index, row) in table.rows.iter().enumerate() {
        parts.push(format!("row:{} cells:{}", row_index, row.cells.len()));
        for (column_index, cell) in row.cells.iter().enumerate() {
            parts.push(format!(
                "cell:{}:{} span:{}x{}",
                row_index, column_index, cell.row_span, cell.column_span
            ));
        }
    }
    parts.join("|")
}

fn table_cell_text(cell: &RichTableCell) -> String {
    let mut parts = Vec::new();
    for block in &cell.content {
        match block {
            RichBlock::Paragraph(paragraph) => parts.push(paragraph_text(paragraph)),
            RichBlock::Table(table) => parts.push(format!(
                "[nested table {} x {}]",
                table.rows.len(),
                table.columns
            )),
            RichBlock::SectionBreak(_) => {}
            RichBlock::Unsupported(unsupported) => parts.push(unsupported.description.clone()),
        }
    }
    parts.join("\n").trim_end_matches('\n').to_string()
}

fn collect_cell_paragraph_ids(cell: &RichTableCell, out: &mut Vec<String>) {
    for block in &cell.content {
        match block {
            RichBlock::Paragraph(paragraph) => {
                out.push(paragraph.identity.local_id.as_str().to_string());
            }
            RichBlock::Table(table) => {
                out.push(table.identity.local_id.as_str().to_string());
                for row in &table.rows {
                    for nested_cell in &row.cells {
                        collect_cell_paragraph_ids(nested_cell, out);
                    }
                }
            }
            RichBlock::SectionBreak(_) | RichBlock::Unsupported(_) => {}
        }
    }
}

fn first_cell_paragraph_id(cell: &RichTableCell) -> Option<String> {
    for block in &cell.content {
        match block {
            RichBlock::Paragraph(paragraph) => {
                return Some(paragraph.identity.local_id.as_str().to_string());
            }
            RichBlock::Table(table) => {
                for row in &table.rows {
                    for nested_cell in &row.cells {
                        if let Some(id) = first_cell_paragraph_id(nested_cell) {
                            return Some(id);
                        }
                    }
                }
            }
            RichBlock::SectionBreak(_) | RichBlock::Unsupported(_) => {}
        }
    }
    None
}

fn paragraph_key(paragraph: &RichParagraph) -> String {
    if let Some(start) = paragraph.identity.source_start_index {
        return format!(
            "idx:{}:{}:{}",
            paragraph.identity.source_tab_id, paragraph.identity.source_segment_id, start
        );
    }
    format!("id:{}", paragraph.identity.local_id.as_str())
}

fn paragraph_title(paragraph: &RichParagraph) -> String {
    let text = paragraph_text(paragraph);
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return "Untitled paragraph".to_string();
    }
    let mut title: String = trimmed.chars().take(80).collect();
    if trimmed.chars().count() > 80 {
        title.push_str("...");
    }
    title
}

fn paragraph_text(paragraph: &RichParagraph) -> String {
    let mut out = String::new();
    for inline in &paragraph.inlines {
        match inline {
            RichInline::TextRun(run) => out.push_str(&run.text),
            RichInline::InlineObjectRef(reference) => {
                out.push_str("[image:");
                out.push_str(&reference.object_id);
                out.push(']');
            }
            RichInline::FootnoteRef(reference) => {
                out.push_str("[footnote:");
                out.push_str(&reference.footnote_id);
                out.push(']');
            }
            RichInline::Equation(_) => out.push_str("[equation]"),
            RichInline::PersonChip(chip) => out.push_str(&chip.display_text),
            RichInline::RichLinkChip(chip) => out.push_str(&chip.title),
            RichInline::PageBreak(_) => out.push_str("\n\n"),
            RichInline::ColumnBreak(_) => out.push('\n'),
            RichInline::HorizontalRule(_) => out.push_str("\n---\n"),
            RichInline::AutoText(_) => out.push_str("[auto-text]"),
            RichInline::Unsupported(unsupported) => out.push_str(&unsupported.description),
        }
    }
    out.trim_end_matches('\n').to_string()
}

fn operation_ids_by_target(envelopes: &[RichOperationEnvelope]) -> BTreeMap<String, Vec<String>> {
    let mut map: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for env in envelopes {
        for target in operation_targets(&env.op) {
            map.entry(target)
                .or_default()
                .push(env.operation_id.clone());
        }
    }
    map
}

fn operation_targets(op: &RichOperation) -> Vec<String> {
    match op {
        RichOperation::InsertText { paragraph_id, .. }
        | RichOperation::DeleteRange { paragraph_id, .. }
        | RichOperation::ReplaceRange { paragraph_id, .. }
        | RichOperation::SetTextStyle { paragraph_id, .. }
        | RichOperation::ClearTextStyle { paragraph_id, .. }
        | RichOperation::SetParagraphNamedStyle { paragraph_id, .. }
        | RichOperation::SetParagraphStyle { paragraph_id, .. }
        | RichOperation::CreateLink { paragraph_id, .. }
        | RichOperation::DeleteLink { paragraph_id, .. }
        | RichOperation::InsertTable { paragraph_id, .. }
        | RichOperation::CreateList { paragraph_id, .. }
        | RichOperation::UpdateListNesting { paragraph_id, .. }
        | RichOperation::DeleteList { paragraph_id, .. }
        | RichOperation::InsertInlineImage { paragraph_id, .. }
        | RichOperation::CreateFootnote { paragraph_id, .. } => {
            vec![paragraph_id.as_str().to_string()]
        }
        RichOperation::DeleteTable { table_id }
        | RichOperation::InsertTableRow { table_id, .. }
        | RichOperation::DeleteTableRow { table_id, .. }
        | RichOperation::InsertTableColumn { table_id, .. }
        | RichOperation::DeleteTableColumn { table_id, .. }
        | RichOperation::SetTableColumnWidth { table_id, .. }
        | RichOperation::SetTableRowMinHeight { table_id, .. }
        | RichOperation::MergeTableCells { table_id, .. }
        | RichOperation::UnmergeTableCells { table_id, .. } => {
            vec![table_id.as_str().to_string()]
        }
        RichOperation::SetTableCellStyle {
            table_id,
            row_index,
            column_index,
            ..
        } => vec![
            table_id.as_str().to_string(),
            format!("{}@{}:{}", table_id.as_str(), row_index, column_index),
        ],
        RichOperation::DeleteInlineObject { object_id } => vec![object_id.clone()],
        RichOperation::DeleteHeader { header_id } => vec![header_id.clone()],
        RichOperation::DeleteFooter { footer_id } => vec![footer_id.clone()],
        RichOperation::DeleteFootnote { footnote_id } => vec![footnote_id.clone()],
        RichOperation::CancelOperation { operation_id } => vec![operation_id.clone()],
        RichOperation::SetNamedStyle { .. }
        | RichOperation::CreateHeader
        | RichOperation::CreateFooter
        | RichOperation::NoOpUnsupportedProtection { .. } => Vec::new(),
    }
}

fn region_op_ids(
    base: Option<&RegionSnapshot>,
    local: Option<&RegionSnapshot>,
    remote: Option<&RegionSnapshot>,
    op_ids_by_node: &BTreeMap<String, Vec<String>>,
) -> Vec<String> {
    let mut ids = BTreeSet::new();
    for region in [base, local, remote].into_iter().flatten() {
        for target in &region.target_node_ids {
            if let Some(op_ids) = op_ids_by_node.get(target) {
                ids.extend(op_ids.iter().cloned());
            }
        }
    }
    ids.into_iter().collect()
}

fn resolved_region(
    key: &str,
    base: Option<&RegionSnapshot>,
    local: Option<&RegionSnapshot>,
    remote: Option<&RegionSnapshot>,
    base_text: &str,
    local_text: &str,
    remote_text: &str,
    op_ids_by_node: &BTreeMap<String, Vec<String>>,
) -> ResolvedRegion {
    ResolvedRegion {
        id: key.to_string(),
        kind: preferred_kind(base, local, remote),
        node_id: preferred_node_id(base, local, remote),
        title: preferred_title(base, local, remote),
        base_text: base_text.to_string(),
        local_text: local_text.to_string(),
        remote_text: remote_text.to_string(),
        local_operation_ids: region_op_ids(base, local, remote, op_ids_by_node),
        table_id: preferred_table_id(base, local, remote),
        row_index: preferred_u32(base, local, remote, |r| r.row_index),
        column_index: preferred_u32(base, local, remote, |r| r.column_index),
        row_span: preferred_u32(base, local, remote, |r| r.row_span),
        column_span: preferred_u32(base, local, remote, |r| r.column_span),
    }
}

fn unresolved_conflict(
    key: &str,
    base: Option<&RegionSnapshot>,
    local: Option<&RegionSnapshot>,
    remote: Option<&RegionSnapshot>,
    base_text: &str,
    local_text: &str,
    remote_text: &str,
    op_ids_by_node: &BTreeMap<String, Vec<String>>,
) -> UnresolvedConflict {
    UnresolvedConflict {
        id: key.to_string(),
        kind: preferred_kind(base, local, remote),
        node_id: preferred_node_id(base, local, remote),
        title: preferred_title(base, local, remote),
        base_text: base_text.to_string(),
        local_text: local_text.to_string(),
        remote_text: remote_text.to_string(),
        local_operation_ids: region_op_ids(base, local, remote, op_ids_by_node),
        table_id: preferred_table_id(base, local, remote),
        row_index: preferred_u32(base, local, remote, |r| r.row_index),
        column_index: preferred_u32(base, local, remote, |r| r.column_index),
        row_span: preferred_u32(base, local, remote, |r| r.row_span),
        column_span: preferred_u32(base, local, remote, |r| r.column_span),
    }
}

fn destructive_conflict(
    key: &str,
    base: Option<&RegionSnapshot>,
    local: Option<&RegionSnapshot>,
    remote: Option<&RegionSnapshot>,
    reason: &str,
    op_ids_by_node: &BTreeMap<String, Vec<String>>,
) -> DestructiveConflict {
    DestructiveConflict {
        id: key.to_string(),
        kind: preferred_kind(base, local, remote),
        node_id: preferred_node_id(base, local, remote),
        title: preferred_title(base, local, remote),
        reason: reason.to_string(),
        local_operation_ids: region_op_ids(base, local, remote, op_ids_by_node),
        table_id: preferred_table_id(base, local, remote),
        row_index: preferred_u32(base, local, remote, |r| r.row_index),
        column_index: preferred_u32(base, local, remote, |r| r.column_index),
        row_span: preferred_u32(base, local, remote, |r| r.row_span),
        column_span: preferred_u32(base, local, remote, |r| r.column_span),
    }
}

fn preferred_node_id(
    base: Option<&RegionSnapshot>,
    local: Option<&RegionSnapshot>,
    remote: Option<&RegionSnapshot>,
) -> String {
    remote
        .or(local)
        .or(base)
        .map(|p| p.node_id.clone())
        .unwrap_or_default()
}

fn preferred_title(
    base: Option<&RegionSnapshot>,
    local: Option<&RegionSnapshot>,
    remote: Option<&RegionSnapshot>,
) -> String {
    local
        .or(remote)
        .or(base)
        .map(|p| p.title.clone())
        .unwrap_or_else(|| "Untitled region".to_string())
}

fn preferred_kind(
    base: Option<&RegionSnapshot>,
    local: Option<&RegionSnapshot>,
    remote: Option<&RegionSnapshot>,
) -> String {
    local
        .or(remote)
        .or(base)
        .map(|r| r.kind.to_string())
        .unwrap_or_else(|| "paragraph".to_string())
}

fn preferred_table_id(
    base: Option<&RegionSnapshot>,
    local: Option<&RegionSnapshot>,
    remote: Option<&RegionSnapshot>,
) -> Option<String> {
    local.or(remote).or(base).and_then(|r| r.table_id.clone())
}

fn preferred_u32(
    base: Option<&RegionSnapshot>,
    local: Option<&RegionSnapshot>,
    remote: Option<&RegionSnapshot>,
    f: impl Fn(&RegionSnapshot) -> Option<u32>,
) -> Option<u32> {
    for region in [local, remote, base].into_iter().flatten() {
        if let Some(value) = f(region) {
            return Some(value);
        }
    }
    None
}

fn resolved_regions_json(regions: &[ResolvedRegion]) -> String {
    format!(
        "[{}]",
        regions
            .iter()
            .map(resolved_region_json)
            .collect::<Vec<_>>()
            .join(",")
    )
}

fn resolved_region_json(region: &ResolvedRegion) -> String {
    format!(
        "{{\"id\":\"{}\",\"kind\":\"{}\",\"nodeId\":\"{}\",\"title\":\"{}\",\"baseText\":\"{}\",\
         \"localText\":\"{}\",\"remoteText\":\"{}\",\"localOperationIds\":{},\"tableId\":{},\
         \"rowIndex\":{},\"columnIndex\":{},\"rowSpan\":{},\"columnSpan\":{}}}",
        json_escape(&region.id),
        json_escape(&region.kind),
        json_escape(&region.node_id),
        json_escape(&region.title),
        json_escape(&region.base_text),
        json_escape(&region.local_text),
        json_escape(&region.remote_text),
        string_array_json(&region.local_operation_ids),
        option_string_json(region.table_id.as_deref()),
        option_u32_json(region.row_index),
        option_u32_json(region.column_index),
        option_u32_json(region.row_span),
        option_u32_json(region.column_span)
    )
}

fn unresolved_conflicts_json(conflicts: &[UnresolvedConflict]) -> String {
    format!(
        "[{}]",
        conflicts
            .iter()
            .map(unresolved_conflict_json)
            .collect::<Vec<_>>()
            .join(",")
    )
}

fn unresolved_conflict_json(conflict: &UnresolvedConflict) -> String {
    format!(
        "{{\"id\":\"{}\",\"kind\":\"{}\",\"nodeId\":\"{}\",\"title\":\"{}\",\"baseText\":\"{}\",\
         \"localText\":\"{}\",\"remoteText\":\"{}\",\"localOperationIds\":{},\"tableId\":{},\
         \"rowIndex\":{},\"columnIndex\":{},\"rowSpan\":{},\"columnSpan\":{}}}",
        json_escape(&conflict.id),
        json_escape(&conflict.kind),
        json_escape(&conflict.node_id),
        json_escape(&conflict.title),
        json_escape(&conflict.base_text),
        json_escape(&conflict.local_text),
        json_escape(&conflict.remote_text),
        string_array_json(&conflict.local_operation_ids),
        option_string_json(conflict.table_id.as_deref()),
        option_u32_json(conflict.row_index),
        option_u32_json(conflict.column_index),
        option_u32_json(conflict.row_span),
        option_u32_json(conflict.column_span)
    )
}

fn destructive_conflicts_json(conflicts: &[DestructiveConflict]) -> String {
    format!(
        "[{}]",
        conflicts
            .iter()
            .map(destructive_conflict_json)
            .collect::<Vec<_>>()
            .join(",")
    )
}

fn destructive_conflict_json(conflict: &DestructiveConflict) -> String {
    format!(
        "{{\"id\":\"{}\",\"kind\":\"{}\",\"nodeId\":\"{}\",\"title\":\"{}\",\"reason\":\"{}\",\
         \"localOperationIds\":{},\"tableId\":{},\"rowIndex\":{},\"columnIndex\":{},\
         \"rowSpan\":{},\"columnSpan\":{}}}",
        json_escape(&conflict.id),
        json_escape(&conflict.kind),
        json_escape(&conflict.node_id),
        json_escape(&conflict.title),
        json_escape(&conflict.reason),
        string_array_json(&conflict.local_operation_ids),
        option_string_json(conflict.table_id.as_deref()),
        option_u32_json(conflict.row_index),
        option_u32_json(conflict.column_index),
        option_u32_json(conflict.row_span),
        option_u32_json(conflict.column_span)
    )
}

fn option_string_json(value: Option<&str>) -> String {
    value
        .map(|value| format!("\"{}\"", json_escape(value)))
        .unwrap_or_else(|| "null".to_string())
}

fn option_u32_json(value: Option<u32>) -> String {
    value
        .map(|value| value.to_string())
        .unwrap_or_else(|| "null".to_string())
}

fn string_array_json(values: &[String]) -> String {
    format!(
        "[{}]",
        values
            .iter()
            .map(|value| format!("\"{}\"", json_escape(value)))
            .collect::<Vec<_>>()
            .join(",")
    )
}

#[allow(dead_code)]
fn _node_id_key(id: &RichNodeId) -> String {
    id.as_str().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rich_index::Utf16Offset;
    use crate::rich_model::{
        RichNodeIdentity, RichParagraphStyle, RichRawJson, RichSegment, RichSourceKind, RichStyle,
        RichTable, RichTableCell, RichTableRow, RichTextRun,
    };

    fn ident(seed: &str, start: u32) -> RichNodeIdentity {
        let mut identity =
            RichNodeIdentity::local_only(RichNodeId::synthetic(seed), RichSourceKind::Body);
        identity.source_start_index = Some(start);
        identity
    }

    fn doc(revision: &str, text: &str) -> RichDocument {
        let paragraph = RichParagraph {
            identity: ident("p1", 1),
            style: RichParagraphStyle::default(),
            list: None,
            inlines: vec![RichInline::TextRun(RichTextRun {
                identity: ident("r1", 1),
                text: text.to_string(),
                style: RichStyle::default(),
            })],
            raw_extras: RichRawJson::empty(),
        };
        let mut document = RichDocument::skeleton("doc", "Doc");
        document.revision.revision_id = revision.to_string();
        document.tabs.push(RichTab {
            identity: ident("tab", 0),
            tab_id: String::new(),
            title: String::new(),
            index: 0,
            parent_tab_id: None,
            body: RichSegment {
                identity: ident("body", 0),
                segment_id: String::new(),
                kind: RichSourceKind::Body,
                blocks: vec![RichBlock::Paragraph(paragraph)],
                style: RichRawJson::empty(),
            },
            headers: BTreeMap::new(),
            footers: BTreeMap::new(),
            footnotes: BTreeMap::new(),
            child_tabs: Vec::new(),
        });
        document
    }

    fn paragraph(seed: &str, start: u32, text: &str) -> RichParagraph {
        RichParagraph {
            identity: ident(seed, start),
            style: RichParagraphStyle::default(),
            list: None,
            inlines: vec![RichInline::TextRun(RichTextRun {
                identity: ident(&format!("{seed}-run"), start),
                text: text.to_string(),
                style: RichStyle::default(),
            })],
            raw_extras: RichRawJson::empty(),
        }
    }

    fn doc_with_table(revision: &str, first: &str, second: &str) -> RichDocument {
        let mut document = RichDocument::skeleton("doc", "Doc");
        document.revision.revision_id = revision.to_string();
        let table = RichTable {
            identity: ident("table", 10),
            start_index: 10,
            rows: vec![RichTableRow {
                identity: ident("row", 11),
                cells: vec![
                    RichTableCell {
                        identity: ident("cell-1", 12),
                        content: vec![RichBlock::Paragraph(paragraph("cell-p-1", 13, first))],
                        row_span: 1,
                        column_span: 1,
                        raw_style: RichRawJson::empty(),
                    },
                    RichTableCell {
                        identity: ident("cell-2", 22),
                        content: vec![RichBlock::Paragraph(paragraph("cell-p-2", 23, second))],
                        row_span: 1,
                        column_span: 1,
                        raw_style: RichRawJson::empty(),
                    },
                ],
                raw_style: RichRawJson::empty(),
            }],
            columns: 2,
            raw_style: RichRawJson::empty(),
        };
        document.tabs.push(RichTab {
            identity: ident("tab", 0),
            tab_id: String::new(),
            title: String::new(),
            index: 0,
            parent_tab_id: None,
            body: RichSegment {
                identity: ident("body", 0),
                segment_id: String::new(),
                kind: RichSourceKind::Body,
                blocks: vec![RichBlock::Table(table)],
                style: RichRawJson::empty(),
            },
            headers: BTreeMap::new(),
            footers: BTreeMap::new(),
            footnotes: BTreeMap::new(),
            child_tabs: Vec::new(),
        });
        document
    }

    #[test]
    fn local_only_change_is_local_win() {
        let base = doc("base", "hello");
        let local = doc("base", "hello local");
        let remote = doc("remote", "hello");
        let env = RichOperationEnvelope::new(
            "op-1",
            "doc",
            "",
            "base",
            "ts",
            "u",
            RichOperation::InsertText {
                paragraph_id: RichNodeId::synthetic("p1"),
                utf16_offset: Utf16Offset(5),
                text: " local".to_string(),
            },
        );
        let report = classify_conflict(&base, &local, &remote, &[env]);
        assert_eq!(report.local_wins.len(), 1);
        assert!(report.user_decision.is_empty());
        assert_eq!(report.local_wins[0].local_operation_ids, vec!["op-1"]);
    }

    #[test]
    fn both_changed_same_region_needs_user_decision() {
        let base = doc("base", "hello");
        let local = doc("base", "hello local");
        let remote = doc("remote", "hello remote");
        let report = classify_conflict(&base, &local, &remote, &[]);
        assert_eq!(report.user_decision.len(), 1);
        assert_eq!(report.user_decision[0].base_text, "hello");
        assert_eq!(report.user_decision[0].local_text, "hello local");
        assert_eq!(report.user_decision[0].remote_text, "hello remote");
    }

    #[test]
    fn remote_only_change_is_remote_win() {
        let base = doc("base", "hello");
        let local = doc("base", "hello");
        let remote = doc("remote", "hello remote");
        let report = classify_conflict(&base, &local, &remote, &[]);
        assert_eq!(report.remote_wins.len(), 1);
        assert!(report.user_decision.is_empty());
    }

    #[test]
    fn same_table_different_cell_edits_do_not_conflict() {
        let base = doc_with_table("base", "one", "two");
        let local = doc_with_table("base", "one local", "two");
        let remote = doc_with_table("remote", "one", "two remote");
        let report = classify_conflict(&base, &local, &remote, &[]);
        assert!(report.user_decision.is_empty());
        assert_eq!(report.local_wins.len(), 1);
        assert_eq!(report.remote_wins.len(), 1);
        assert_eq!(report.local_wins[0].kind, "tableCell");
        assert_eq!(report.local_wins[0].row_index, Some(0));
        assert_eq!(report.local_wins[0].column_index, Some(0));
    }

    #[test]
    fn same_table_same_cell_edits_require_user_decision() {
        let base = doc_with_table("base", "one", "two");
        let local = doc_with_table("base", "one local", "two");
        let remote = doc_with_table("remote", "one remote", "two");
        let report = classify_conflict(&base, &local, &remote, &[]);
        assert_eq!(report.user_decision.len(), 1);
        assert_eq!(report.user_decision[0].kind, "tableCell");
        assert_eq!(report.user_decision[0].base_text, "one");
        assert_eq!(report.user_decision[0].local_text, "one local");
        assert_eq!(report.user_decision[0].remote_text, "one remote");
    }
}
