//! CLI-owned interactive progress rendering.
//!
//! Core operations remain terminal-independent. This module is deliberately a
//! presentation layer: it renders only on an interactive stderr and never
//! writes to stdout, which preserves the JSON Lines protocol.

use crossterm::{
    QueueableCommand,
    cursor::MoveToColumn,
    style::Print,
    terminal::{Clear, ClearType},
};
use rattles::{
    Rattle,
    presets::{arrows, ascii, braille, emoji},
};
use std::{
    cell::RefCell,
    io::{IsTerminal, Write},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

/// Default portable Rattles preset.
pub const DEFAULT_SPINNER: &str = "simple-dots";
/// Default Wukong-owned determinate-bar theme.
pub const DEFAULT_BAR_THEME: &str = "classic";
const RENDER_DELAY: Duration = Duration::from_millis(120);
const REFRESH_INTERVAL: Duration = Duration::from_millis(80);
const FINISH_WAIT: Duration = Duration::from_millis(250);
const BAR_WIDTH: usize = 24;

thread_local! {
    static ACTIVE_PROGRESS: RefCell<Option<Arc<Shared>>> = const { RefCell::new(None) };
}

/// User-selected terminal presentation configuration.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Presentation {
    spinner: String,
    bar: String,
    disabled: bool,
}

impl Presentation {
    /// Creates a validated presentation configuration.
    pub fn new(spinner: impl Into<String>, bar: impl Into<String>, disabled: bool) -> Self {
        Self {
            spinner: spinner.into(),
            bar: bar.into(),
            disabled,
        }
    }
}

/// Lists every selectable Rattles preset in deterministic order.
#[must_use]
pub fn spinner_names() -> Vec<&'static str> {
    let mut names = SPINNER_PRESETS
        .iter()
        .map(|preset| preset.name)
        .collect::<Vec<_>>();
    names.sort_unstable();
    names
}

/// Lists every Wukong-owned bar theme in deterministic order.
#[must_use]
pub fn bar_theme_names() -> Vec<&'static str> {
    let mut names = BAR_THEMES
        .iter()
        .map(|theme| theme.name)
        .collect::<Vec<_>>();
    names.sort_unstable();
    names
}

/// Returns whether a Rattles preset name is supported.
#[must_use]
pub fn is_supported_spinner(name: &str) -> bool {
    SPINNER_PRESETS.iter().any(|preset| preset.name == name)
}

/// Returns whether a Wukong-owned bar theme is supported.
#[must_use]
pub fn is_supported_bar_theme(name: &str) -> bool {
    BAR_THEMES.iter().any(|theme| theme.name == name)
}

/// Starts one command-scoped progress session. It is a no-op outside an interactive terminal.
pub struct ProgressSession {
    shared: Option<Arc<Shared>>,
    worker: Option<JoinHandle<()>>,
}

impl ProgressSession {
    /// Starts rendering the supplied command after a short anti-flicker delay.
    #[must_use]
    pub fn start(command: &str, presentation: &Presentation) -> Self {
        if presentation.disabled
            || progress_disabled_by_environment()
            || !std::io::stderr().is_terminal()
            || std::env::var_os("TERM").is_some_and(|term| term == "dumb")
        {
            return Self {
                shared: None,
                worker: None,
            };
        }
        let Some(spinner) = spinner(presentation.spinner.as_str()) else {
            return Self {
                shared: None,
                worker: None,
            };
        };
        let Some(bar) = bar_theme(presentation.bar.as_str()) else {
            return Self {
                shared: None,
                worker: None,
            };
        };
        let shared = Arc::new(Shared {
            finished: AtomicBool::new(false),
            cleared: AtomicBool::new(false),
            state: Mutex::new(State {
                command: command.to_owned(),
                phase: "starting".to_owned(),
                completed: None,
                total: None,
                started: Instant::now(),
            }),
        });
        ACTIVE_PROGRESS.with(|active| *active.borrow_mut() = Some(Arc::clone(&shared)));
        let worker_shared = Arc::clone(&shared);
        let worker = thread::spawn(move || render_loop(&worker_shared, spinner, bar));
        Self {
            shared: Some(shared),
            worker: Some(worker),
        }
    }

    /// Stops refreshes while a child process owns terminal output.
    pub fn suspend(&mut self) {
        if let Some(shared) = &self.shared {
            shared.finished.store(true, Ordering::Release);
        }
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

impl Drop for ProgressSession {
    fn drop(&mut self) {
        self.suspend();
        ACTIVE_PROGRESS.with(|active| *active.borrow_mut() = None);
    }
}

/// Updates the active command phase without affecting machine-readable output.
pub fn set_phase(phase: &str) {
    ACTIVE_PROGRESS.with(|active| {
        let shared = active.borrow().clone();
        if let Some(shared) = shared {
            if let Ok(mut state) = shared.state.lock() {
                phase.clone_into(&mut state.phase);
            }
        }
    });
}

/// Updates the active determinate package/task progress bar.
pub fn set_progress(completed: usize, total: usize, phase: &str) {
    ACTIVE_PROGRESS.with(|active| {
        let shared = active.borrow().clone();
        if let Some(shared) = shared {
            if let Ok(mut state) = shared.state.lock() {
                phase.clone_into(&mut state.phase);
                state.completed = Some(completed);
                state.total = Some(total);
            }
        }
    });
}

/// Clears active terminal progress before a command writes a durable line.
///
/// stdout and stderr can target the same terminal. Waiting for the renderer to
/// clear its line prevents a stable result or diagnostic from being appended to
/// a spinner frame.
pub fn finish_for_output() {
    ACTIVE_PROGRESS.with(|active| {
        let shared = active.borrow().clone();
        if let Some(shared) = shared {
            shared.finished.store(true, Ordering::Release);
            let deadline = Instant::now() + FINISH_WAIT;
            while !shared.cleared.load(Ordering::Acquire) && Instant::now() < deadline {
                thread::sleep(Duration::from_millis(5));
            }
        }
    });
}

fn progress_disabled_by_environment() -> bool {
    std::env::var_os("WUKONG_NO_PROGRESS").is_some_and(|value| value != "0")
}

struct Shared {
    finished: AtomicBool,
    cleared: AtomicBool,
    state: Mutex<State>,
}

struct State {
    command: String,
    phase: String,
    completed: Option<usize>,
    total: Option<usize>,
    started: Instant,
}

#[derive(Clone, Copy)]
struct SpinnerPreset {
    name: &'static str,
    frame: fn(Duration) -> &'static str,
}

#[derive(Clone, Copy)]
struct BarTheme {
    name: &'static str,
    complete: char,
    incomplete: char,
}

macro_rules! preset {
    ($name:literal, $type:path) => {
        SpinnerPreset {
            name: $name,
            frame: frame_for::<$type>,
        }
    };
}

const SPINNER_PRESETS: &[SpinnerPreset] = &[
    preset!("arc", ascii::Arc),
    preset!("arrow", arrows::Arrow),
    preset!("balloon", ascii::Balloon),
    preset!("bounce", braille::Bounce),
    preset!("breathe", braille::Breathe),
    preset!("cascade", braille::Cascade),
    preset!("checkerboard", braille::Checkerboard),
    preset!("circle-halves", ascii::CircleHalves),
    preset!("circle-quarters", ascii::CircleQuarters),
    preset!("clock", emoji::Clock),
    preset!("columns", braille::Columns),
    preset!("diagswipe", braille::DiagSwipe),
    preset!("dots", braille::Dots),
    preset!("dots-circle", braille::DotsCircle),
    preset!("dots2", braille::Dots2),
    preset!("dots3", braille::Dots3),
    preset!("dots4", braille::Dots4),
    preset!("dots5", braille::Dots5),
    preset!("dots6", braille::Dots6),
    preset!("dots7", braille::Dots7),
    preset!("dots8", braille::Dots8),
    preset!("dots9", braille::Dots9),
    preset!("dots10", braille::Dots10),
    preset!("dots11", braille::Dots11),
    preset!("dots12", braille::Dots12),
    preset!("dots13", braille::Dots13),
    preset!("dots14", braille::Dots14),
    preset!("dqpb", ascii::Dqpb),
    preset!("earth", emoji::Earth),
    preset!("fillsweep", braille::FillSweep),
    preset!("grow-horizontal", ascii::GrowHorizontal),
    preset!("grow-vertical", ascii::GrowVertical),
    preset!("hearts", emoji::Hearts),
    preset!("helix", braille::Helix),
    preset!("moon", emoji::Moon),
    preset!("noise", ascii::Noise),
    preset!("orbit", braille::Orbit),
    preset!("point", ascii::Point),
    preset!("pulse", braille::Pulse),
    preset!("rain", braille::Rain),
    preset!("rolling-line", ascii::RollingLine),
    preset!("sand", braille::Sand),
    preset!("scan", braille::Scan),
    preset!("simple-dots", ascii::SimpleDots),
    preset!("simple-dots-scrolling", ascii::SimpleDotsScrolling),
    preset!("snake", braille::Snake),
    preset!("sparkle", braille::Sparkle),
    preset!("speaker", emoji::Speaker),
    preset!("square-corners", ascii::SquareCorners),
    preset!("toggle", ascii::Toggle),
    preset!("triangle", ascii::Triangle),
    preset!("wave", braille::Wave),
    preset!("waverows", braille::WaveRows),
    preset!("weather", emoji::Weather),
];

const BAR_THEMES: &[BarTheme] = &[
    BarTheme {
        name: "classic",
        complete: '=',
        incomplete: '-',
    },
    BarTheme {
        name: "legacy",
        complete: '#',
        incomplete: '-',
    },
    BarTheme {
        name: "rect",
        complete: '■',
        incomplete: '□',
    },
    BarTheme {
        name: "shades-classic",
        complete: '█',
        incomplete: '░',
    },
    BarTheme {
        name: "shades-grey",
        complete: '▓',
        incomplete: '░',
    },
];

fn spinner(name: &str) -> Option<SpinnerPreset> {
    SPINNER_PRESETS
        .iter()
        .copied()
        .find(|preset| preset.name == name)
}

fn bar_theme(name: &str) -> Option<BarTheme> {
    BAR_THEMES.iter().copied().find(|theme| theme.name == name)
}

fn frame_for<T: Rattle>(elapsed: Duration) -> &'static str {
    let frames = T::FRAMES;
    if frames.is_empty() {
        return "";
    }
    let interval = T::INTERVAL.as_millis().max(1) as usize;
    let index = (elapsed.as_millis() as usize / interval) % frames.len();
    frames[index][0]
}

fn render_loop(shared: &Shared, spinner: SpinnerPreset, bar: BarTheme) {
    thread::sleep(RENDER_DELAY);
    let mut rendered = false;
    while !shared.finished.load(Ordering::Acquire) {
        let Ok(state) = shared.state.lock() else {
            break;
        };
        let elapsed = state.started.elapsed();
        let line = render_line(&state, spinner, bar, elapsed);
        drop(state);
        if draw_line(&line).is_err() {
            break;
        }
        rendered = true;
        thread::sleep(REFRESH_INTERVAL);
    }
    if rendered {
        let _ = clear_line();
    }
    shared.cleared.store(true, Ordering::Release);
}

fn render_line(state: &State, spinner: SpinnerPreset, bar: BarTheme, elapsed: Duration) -> String {
    let frame = (spinner.frame)(elapsed);
    match (state.completed, state.total) {
        (Some(completed), Some(total)) if total > 0 => {
            let completed = completed.min(total);
            let filled = completed.saturating_mul(BAR_WIDTH) / total;
            let progress = format!(
                "{}{}",
                bar.complete.to_string().repeat(filled),
                bar.incomplete.to_string().repeat(BAR_WIDTH - filled)
            );
            let percent = completed.saturating_mul(100) / total;
            let eta = if completed == 0 {
                "eta --".to_owned()
            } else {
                let remaining = total - completed;
                estimated_remaining_duration(elapsed, completed, remaining)
                    .and_then(format_duration)
                    .map_or_else(|| "eta --".to_owned(), |value| format!("eta {value}"))
            };
            format!(
                "{frame} {}: {} [{progress}] {percent:>3}% {completed}/{total} {eta}",
                state.command, state.phase
            )
        }
        _ => format!(
            "{frame} {}: {} ({})",
            state.command,
            state.phase,
            format_duration(elapsed).unwrap_or_else(|| "0s".to_owned())
        ),
    }
}

fn estimated_remaining_duration(
    elapsed: Duration,
    completed: usize,
    remaining: usize,
) -> Option<Duration> {
    let elapsed_nanos = elapsed.as_nanos();
    let estimated_nanos = elapsed_nanos
        .checked_mul(u128::try_from(remaining).ok()?)?
        .checked_div(u128::try_from(completed).ok()?)?;
    let seconds = u64::try_from(estimated_nanos / 1_000_000_000).ok()?;
    let nanoseconds = u32::try_from(estimated_nanos % 1_000_000_000).ok()?;
    Some(Duration::new(seconds, nanoseconds))
}

fn format_duration(duration: Duration) -> Option<String> {
    if duration.as_secs() > 99 * 60 * 60 {
        return None;
    }
    let seconds = duration.as_secs();
    Some(if seconds >= 60 {
        format!("{}m {:02}s", seconds / 60, seconds % 60)
    } else {
        format!("{seconds}s")
    })
}

fn draw_line(line: &str) -> std::io::Result<()> {
    let mut stderr = std::io::stderr().lock();
    stderr
        .queue(MoveToColumn(0))?
        .queue(Clear(ClearType::CurrentLine))?
        .queue(Print(line))?
        .flush()
}

fn clear_line() -> std::io::Result<()> {
    let mut stderr = std::io::stderr().lock();
    stderr
        .queue(MoveToColumn(0))?
        .queue(Clear(ClearType::CurrentLine))?
        .flush()
}

#[cfg(test)]
mod tests {
    use super::{
        BAR_THEMES, DEFAULT_SPINNER, State, bar_theme, format_duration, is_supported_spinner,
        render_line, spinner, spinner_names,
    };
    use std::time::{Duration, Instant};

    #[test]
    fn invariant_every_rattles_preset_is_selectable_and_default_is_portable() {
        assert_eq!(DEFAULT_SPINNER, "simple-dots");
        assert_eq!(spinner_names().len(), 54);
        for name in spinner_names() {
            assert!(is_supported_spinner(name));
            assert!(spinner(name).is_some());
        }
    }

    #[test]
    fn invariant_bar_themes_render_completion_without_exceeding_total() {
        let state = State {
            command: "sync".to_owned(),
            phase: "preparing addon".to_owned(),
            completed: Some(9),
            total: Some(3),
            started: Instant::now()
                .checked_sub(Duration::from_secs(3))
                .expect("three seconds should be representable"),
        };
        for theme in BAR_THEMES {
            let output = render_line(
                &state,
                spinner(DEFAULT_SPINNER).expect("default spinner"),
                *theme,
                Duration::from_secs(3),
            );
            assert!(output.contains("100% 3/3"));
        }
        assert_eq!(
            format_duration(Duration::from_secs(61)).as_deref(),
            Some("1m 01s")
        );
        assert!(format_duration(Duration::from_secs(100 * 60 * 60)).is_none());
        assert!(bar_theme("classic").is_some());
    }
}
