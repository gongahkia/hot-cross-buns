/// Undo / redo stack for task mutations.
///
/// Keeps a bounded history (max 50 entries) of actions that can be reversed.

use serde::{Deserialize, Serialize};

/// The maximum number of undo entries retained.
const MAX_UNDO: usize = 50;

/// Describes a reversible action.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum UndoAction {
    /// A task was created – undo deletes it.
    CreateTask {
        task_id: String,
    },
    /// A task was deleted – undo recreates it (snapshot stored as JSON).
    DeleteTask {
        snapshot_json: String,
    },
    /// One or more task fields were changed – undo restores old values.
    UpdateTask {
        task_id: String,
        /// JSON representation of the field values before the change.
        old_snapshot_json: String,
        /// JSON representation of the field values after the change.
        new_snapshot_json: String,
    },
    /// A task was moved to a different list.
    MoveTask {
        task_id: String,
        old_list_id: String,
        new_list_id: String,
    },
    /// A task was completed.
    CompleteTask {
        task_id: String,
    },
}

/// A bounded undo/redo stack.
#[derive(Debug, Default)]
pub struct UndoStack {
    /// Past actions (most recent at the back).
    undo_buf: Vec<UndoAction>,
    /// Actions that have been undone (most recent undo at the back).
    redo_buf: Vec<UndoAction>,
}

impl UndoStack {
    pub fn new() -> Self {
        Self {
            undo_buf: Vec::new(),
            redo_buf: Vec::new(),
        }
    }

    /// Push a new action onto the undo stack.
    ///
    /// Clears the redo stack (a new action invalidates the redo history) and
    /// trims the undo stack to [`MAX_UNDO`].
    pub fn push(&mut self, action: UndoAction) {
        self.redo_buf.clear();
        self.undo_buf.push(action);
        if self.undo_buf.len() > MAX_UNDO {
            self.undo_buf.remove(0);
        }
    }

    /// Pop the most recent action from the undo stack and move it to redo.
    ///
    /// Returns `None` when there is nothing to undo.
    pub fn undo(&mut self) -> Option<UndoAction> {
        let action = self.undo_buf.pop()?;
        self.redo_buf.push(action.clone());
        Some(action)
    }

    /// Pop the most recent action from the redo stack and move it back to undo.
    ///
    /// Returns `None` when there is nothing to redo.
    pub fn redo(&mut self) -> Option<UndoAction> {
        let action = self.redo_buf.pop()?;
        self.undo_buf.push(action.clone());
        Some(action)
    }

    /// Whether the undo stack is non-empty.
    pub fn can_undo(&self) -> bool {
        !self.undo_buf.is_empty()
    }

    /// Whether the redo stack is non-empty.
    pub fn can_redo(&self) -> bool {
        !self.redo_buf.is_empty()
    }

    /// Number of actions on the undo stack.
    pub fn undo_len(&self) -> usize {
        self.undo_buf.len()
    }

    /// Number of actions on the redo stack.
    pub fn redo_len(&self) -> usize {
        self.redo_buf.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn push_and_undo() {
        let mut stack = UndoStack::new();
        stack.push(UndoAction::CreateTask {
            task_id: "t1".into(),
        });
        assert!(stack.can_undo());
        assert!(!stack.can_redo());

        let action = stack.undo().unwrap();
        assert!(matches!(action, UndoAction::CreateTask { .. }));
        assert!(!stack.can_undo());
        assert!(stack.can_redo());
    }

    #[test]
    fn redo_after_undo() {
        let mut stack = UndoStack::new();
        stack.push(UndoAction::CreateTask {
            task_id: "t1".into(),
        });
        stack.undo();
        let action = stack.redo().unwrap();
        assert!(matches!(action, UndoAction::CreateTask { .. }));
        assert!(stack.can_undo());
        assert!(!stack.can_redo());
    }

    #[test]
    fn new_push_clears_redo() {
        let mut stack = UndoStack::new();
        stack.push(UndoAction::CreateTask {
            task_id: "t1".into(),
        });
        stack.undo();
        assert!(stack.can_redo());
        stack.push(UndoAction::DeleteTask {
            snapshot_json: "{}".into(),
        });
        assert!(!stack.can_redo());
    }

    #[test]
    fn bounded_at_max() {
        let mut stack = UndoStack::new();
        for i in 0..60 {
            stack.push(UndoAction::CreateTask {
                task_id: format!("t{}", i),
            });
        }
        assert_eq!(stack.undo_len(), MAX_UNDO);
    }
}
