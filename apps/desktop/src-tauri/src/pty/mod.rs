//! The terminal: sessions keyed by id, and the sink their output flows into.
//!
//! One [`PtyManager`] lives for the whole application, in Tauri's managed
//! state. It hands out session ids, keeps every live session, and removes a
//! session when the frontend closes its tab. Each session owns one shell in
//! one PTY; the output of that shell leaves through a [`PtySink`], which in the
//! application is the Tauri emitter and in a test is a recorder.
//!
//! The commands in `commands/terminal.rs` are the only way the webview reaches
//! this module. Nothing here holds a secret and nothing here touches the disk.

pub mod session;
pub mod stream;

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter};

use self::session::{PtyResult, PtySession};
use self::stream::{data_event, exit_event, DataPayload, ExitPayload, PtySink};

/// Every live terminal of the application, keyed by session id.
pub struct PtyManager {
    sessions: Mutex<HashMap<String, Arc<PtySession>>>,
    sink: Arc<dyn PtySink>,
    next: AtomicU64,
}

impl PtyManager {
    /// A manager whose sessions emit their frames through `sink`.
    pub fn new(sink: Arc<dyn PtySink>) -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            sink,
            next: AtomicU64::new(1),
        }
    }

    /// Spawn a shell and return the id of its session.
    pub fn create(&self, cols: u16, rows: u16) -> PtyResult<String> {
        let id = format!("pty-{}-{}", std::process::id(), self.next.fetch_add(1, Ordering::Relaxed));
        let session = PtySession::spawn(id.clone(), cols, rows, Arc::clone(&self.sink))?;

        self.sessions
            .lock()
            .map_err(|_| "the terminal sessions are poisoned".to_string())?
            .insert(id.clone(), Arc::new(session));

        Ok(id)
    }

    /// Write the bytes of `data` to one session.
    pub fn write(&self, id: &str, data: &str) -> PtyResult<()> {
        self.session(id)?.write(data)
    }

    /// Resize one session.
    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> PtyResult<()> {
        self.session(id)?.resize(cols, rows)
    }

    /// Kill one session and forget it.
    ///
    /// The session leaves the map before the kill, so a second kill of the
    /// same id answers that the session is unknown instead of killing a
    /// process twice. A kill of a shell that has already exited is not an
    /// error: the tab is gone either way, and the exit event has gone out.
    pub fn kill(&self, id: &str) -> PtyResult<()> {
        let session = self
            .sessions
            .lock()
            .map_err(|_| "the terminal sessions are poisoned".to_string())?
            .remove(id)
            .ok_or_else(|| unknown(id))?;

        let _ = session.kill();
        Ok(())
    }

    /// True when the session still exists.
    pub fn alive(&self, id: &str) -> bool {
        self.sessions
            .lock()
            .map(|sessions| sessions.contains_key(id))
            .unwrap_or(false)
    }

    /// The number of live sessions.
    pub fn len(&self) -> usize {
        self.sessions
            .lock()
            .map(|sessions| sessions.len())
            .unwrap_or(0)
    }

    /// True when no session exists.
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    fn session(&self, id: &str) -> PtyResult<Arc<PtySession>> {
        self.sessions
            .lock()
            .map_err(|_| "the terminal sessions are poisoned".to_string())?
            .get(id)
            .cloned()
            .ok_or_else(|| unknown(id))
    }
}

/// The message a call answers with when the id names no session.
fn unknown(id: &str) -> String {
    format!("there is no terminal session {id}")
}

/// The Tauri sink: one event per frame, one event per exit.
#[derive(Clone)]
pub struct TauriSink {
    app: AppHandle,
}

impl TauriSink {
    /// Emit the frames of every session to the main window.
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl PtySink for TauriSink {
    fn data(&self, id: &str, payload: &DataPayload) {
        let _ = self.app.emit_to("main", data_event(id).as_str(), payload);
    }

    fn exit(&self, id: &str, payload: &ExitPayload) {
        let _ = self.app.emit_to("main", exit_event(id).as_str(), payload);
    }
}

#[cfg(test)]
pub(crate) mod testing {
    use std::sync::Mutex;
    use std::time::{Duration, Instant};

    use super::stream::{DataPayload, ExitPayload, PtySink};

    /// A sink that keeps every frame, so a test can read what the frontend
    /// would have received.
    #[derive(Default)]
    pub struct Recorder {
        frames: Mutex<Vec<(String, DataPayload)>>,
        exits: Mutex<Vec<(String, ExitPayload)>>,
    }

    impl Recorder {
        /// The frames of one session.
        pub fn frames(&self, id: &str) -> Vec<DataPayload> {
            self.frames
                .lock()
                .expect("the recorder")
                .iter()
                .filter(|(session, _)| session == id)
                .map(|(_, frame)| frame.clone())
                .collect()
        }

        /// Every byte one session sent, decoded.
        pub fn bytes(&self, id: &str) -> Vec<u8> {
            use base64::Engine as _;

            let mut bytes = Vec::new();
            for frame in self.frames(id) {
                bytes.extend(
                    base64::engine::general_purpose::STANDARD
                        .decode(frame.data)
                        .expect("a frame holds base64"),
                );
            }
            bytes
        }

        /// Every byte one session sent, as text.
        pub fn text(&self, id: &str) -> String {
            String::from_utf8_lossy(&self.bytes(id)).into_owned()
        }

        /// The exit payloads of one session.
        pub fn exits(&self, id: &str) -> Vec<ExitPayload> {
            self.exits
                .lock()
                .expect("the recorder")
                .iter()
                .filter(|(session, _)| session == id)
                .map(|(_, exit)| *exit)
                .collect()
        }

        /// Wait until the output of a session holds `needle`.
        pub fn wait_for_text(&self, id: &str, needle: &str) -> bool {
            wait_until(Duration::from_secs(15), || self.text(id).contains(needle))
        }

        /// Wait until a session reported its exit.
        pub fn wait_for_exit(&self, id: &str) -> Option<ExitPayload> {
            wait_until(Duration::from_secs(15), || !self.exits(id).is_empty());
            self.exits(id).first().copied()
        }
    }

    impl PtySink for Recorder {
        fn data(&self, id: &str, payload: &DataPayload) {
            self.frames
                .lock()
                .expect("the recorder")
                .push((id.to_string(), payload.clone()));
        }

        fn exit(&self, id: &str, payload: &ExitPayload) {
            self.exits
                .lock()
                .expect("the recorder")
                .push((id.to_string(), *payload));
        }
    }

    /// Poll `check` until it holds or the deadline passes.
    pub fn wait_until(deadline: Duration, check: impl Fn() -> bool) -> bool {
        let started = Instant::now();
        while started.elapsed() < deadline {
            if check() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        check()
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::time::Duration;

    use super::testing::{wait_until, Recorder};
    use super::*;

    fn manager() -> (Arc<PtyManager>, Arc<Recorder>) {
        let recorder = Arc::new(Recorder::default());
        let sink: Arc<dyn PtySink> = recorder.clone();
        (Arc::new(PtyManager::new(sink)), recorder)
    }

    #[test]
    fn a_new_session_runs_the_shell_and_answers_echo() {
        let (manager, recorder) = manager();

        let id = manager.create(80, 24).expect("the session starts");
        assert!(manager.alive(&id), "the session is in the manager");
        assert!(manager.write(&id, "echo arrow-ok\n").is_ok());

        assert!(
            recorder.wait_for_text(&id, "arrow-ok"),
            "the shell answered: {:?}",
            recorder.text(&id)
        );

        manager.kill(&id).expect("the session is killed");
    }

    #[test]
    fn a_burst_of_output_arrives_in_fewer_frames_than_bytes() {
        let (manager, recorder) = manager();
        let id = manager.create(80, 24).expect("the session starts");

        manager
            .write(
                &id,
                "yes arrow-line | head -n 400\n",
            )
            .expect("the burst is written");

        // Four hundred lines, and the echo of the command itself, arrive as
        // one burst of tiny writes.
        assert!(
            wait_until(Duration::from_secs(15), || {
                recorder.text(&id).matches("arrow-line").count() > 400
            }),
            "the burst arrived"
        );

        let frames = recorder.frames(&id);
        let bytes = recorder.bytes(&id);
        assert!(
            frames.len() < bytes.len(),
            "{} frames for {} bytes",
            frames.len(),
            bytes.len()
        );
        assert_eq!(
            frames.iter().map(|frame| frame.seq).collect::<Vec<_>>(),
            (1..=frames.len() as u32).collect::<Vec<_>>(),
            "the sequence counts from one without a gap"
        );

        manager.kill(&id).expect("the session is killed");
    }

    #[test]
    fn resize_reaches_the_shell() {
        let (manager, recorder) = manager();
        let id = manager.create(80, 24).expect("the session starts");

        manager.resize(&id, 100, 30).expect("the session resizes");
        manager
            .write(&id, "stty size\n")
            .expect("the size is asked for");

        assert!(
            recorder.wait_for_text(&id, "30 100"),
            "the shell reports the new size: {:?}",
            recorder.text(&id)
        );

        manager.kill(&id).expect("the session is killed");
    }

    #[test]
    fn an_unknown_id_is_refused_by_every_call() {
        let (manager, _recorder) = manager();
        let id = "pty-0-0";

        assert!(!manager.alive(id));
        assert!(manager.write(id, "x").is_err());
        assert!(manager.resize(id, 80, 24).is_err());
        assert!(manager.kill(id).is_err());
        assert!(manager.write(id, "x").expect_err("no such session").contains(id));
    }

    #[test]
    fn killing_a_session_removes_it_from_the_manager() {
        let (manager, _recorder) = manager();
        let id = manager.create(80, 24).expect("the session starts");
        assert_eq!(manager.len(), 1);

        manager.kill(&id).expect("the session is killed");

        assert!(!manager.alive(&id), "the session is gone");
        assert_eq!(manager.len(), 0);
        assert!(manager.is_empty());
        assert!(
            manager.kill(&id).is_err(),
            "a second kill of the same id is refused"
        );
    }

    #[test]
    fn a_shell_that_exits_reports_its_code_and_the_tab_stays_until_killed() {
        let (manager, recorder) = manager();
        let id = manager.create(80, 24).expect("the session starts");

        manager.write(&id, "exit 3\n").expect("the shell is told to exit");

        let exit = recorder.wait_for_exit(&id).expect("the exit arrived");
        assert_eq!(exit.code, 3);
        assert_eq!(recorder.exits(&id).len(), 1, "the exit arrives once");
        assert!(
            manager.alive(&id),
            "the session exists until the frontend closes the tab"
        );

        manager.kill(&id).expect("the session is killed");
        assert!(!manager.alive(&id));
    }

    #[test]
    fn two_sessions_have_two_ids_and_die_independently() {
        let (manager, _recorder) = manager();
        let first = manager.create(80, 24).expect("the first session starts");
        let second = manager.create(80, 24).expect("the second session starts");

        assert_ne!(first, second);
        assert_eq!(manager.len(), 2);

        manager.kill(&first).expect("the first session is killed");

        assert!(!manager.alive(&first));
        assert!(manager.alive(&second));

        manager.kill(&second).expect("the second session is killed");
        assert!(manager.is_empty());
    }

    #[test]
    fn the_recorder_waits_for_a_needle_then_gives_up() {
        let recorder = Arc::new(Recorder::default());
        assert!(!wait_until(Duration::from_millis(30), || false));
        assert!(wait_until(Duration::from_millis(30), || true));
        assert!(!recorder.wait_for_text("pty-0-0", "never"));
    }
}
