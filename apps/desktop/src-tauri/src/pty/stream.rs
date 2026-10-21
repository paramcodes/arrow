//! The batched output stream of one terminal.
//!
//! A PTY hands its bytes over in whatever sizes the kernel chooses: a program
//! that paints a screen can produce hundreds of tiny reads in one frame. The
//! webview does not want one event per read, so a session reads into a channel
//! and a flusher drains that channel on a sixteen millisecond tick.
//!
//! Bytes are base64 in the payload because a Tauri event carries text and PTY
//! output is bytes. `seq` counts the frames of one session from one, so the
//! frontend can tell a dropped frame from a slow one. A tick with no pending
//! bytes emits nothing, so an idle terminal costs no events.

use std::sync::Arc;

use base64::Engine as _;
use serde::Serialize;
use tokio::sync::{mpsc, oneshot};
use tokio::time::{interval, Duration, MissedTickBehavior};

/// The period between two frames. Roughly sixty frames a second.
pub const FLUSH_INTERVAL: Duration = Duration::from_millis(16);

/// The payload of `pty:data:{id}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DataPayload {
    /// The bytes of the frame, base64 encoded.
    pub data: String,
    /// The frame number of this session, counting from one.
    pub seq: u32,
}

/// The payload of `pty:exit:{id}`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct ExitPayload {
    /// The exit code of the shell.
    pub code: i32,
}

/// Where a session sends its frames.
///
/// The manager hands a session a sink when it spawns it. In the application
/// the sink is the Tauri emitter; in a test it is a recorder, so the streaming
/// path is the same code in both.
pub trait PtySink: Send + Sync + 'static {
    /// Emit one frame of output.
    fn data(&self, id: &str, payload: &DataPayload);
    /// Emit the exit of the shell.
    fn exit(&self, id: &str, payload: &ExitPayload);
}

/// The name of the output event of a session.
pub fn data_event(id: &str) -> String {
    format!("pty:data:{id}")
}

/// The name of the exit event of a session.
pub fn exit_event(id: &str) -> String {
    format!("pty:exit:{id}")
}

/// The bytes that have arrived since the last frame.
///
/// The batch owns the sequence counter of its session, so a frame can never
/// reuse a number and a frame can never skip one while the session lives.
#[derive(Debug, Default)]
pub struct Batch {
    pending: Vec<u8>,
    seq: u32,
}

impl Batch {
    /// An empty batch at the start of a session.
    pub fn new() -> Self {
        Self::default()
    }

    /// Keep bytes until the next frame.
    pub fn push(&mut self, bytes: &[u8]) {
        self.pending.extend_from_slice(bytes);
    }

    /// True when the next tick would emit nothing.
    pub fn is_empty(&self) -> bool {
        self.pending.is_empty()
    }

    /// The number of the frame that was emitted last.
    pub fn seq(&self) -> u32 {
        self.seq
    }

    /// Emit the pending bytes as one frame.
    ///
    /// Returns false and emits nothing when no byte is pending, so an idle
    /// terminal never wakes the frontend.
    pub fn flush(&mut self, sink: &dyn PtySink, id: &str) -> bool {
        if self.pending.is_empty() {
            return false;
        }

        self.seq += 1;
        let payload = DataPayload {
            data: base64::engine::general_purpose::STANDARD.encode(&self.pending),
            seq: self.seq,
        };
        self.pending.clear();
        sink.data(id, &payload);
        true
    }
}

/// Move the bytes the reader produced into frames.
///
/// The loop ends when the reader closed the channel and the shell reported its
/// exit code, whichever order those two arrive in. The last bytes are flushed
/// before the exit event, so the frontend never sees an exit before its own
/// output.
pub async fn flush_loop(
    mut chunks: mpsc::Receiver<Vec<u8>>,
    mut exit: oneshot::Receiver<i32>,
    sink: Arc<dyn PtySink>,
    id: String,
) {
    let mut batch = Batch::new();
    let mut ticker = interval(FLUSH_INTERVAL);
    ticker.set_missed_tick_behavior(MissedTickBehavior::Delay);

    let mut reader_done = false;
    let mut exit_code: Option<i32> = None;

    while !(reader_done && exit_code.is_some()) {
        tokio::select! {
            chunk = chunks.recv(), if !reader_done => {
                match chunk {
                    Some(bytes) => batch.push(&bytes),
                    None => reader_done = true,
                }
            }
            code = &mut exit, if exit_code.is_none() => {
                // A waiter that dies before it reports leaves the code
                // unknown, which a terminal shows as a failed exit.
                exit_code = Some(code.unwrap_or(-1));
            }
            _ = ticker.tick() => {
                batch.flush(sink.as_ref(), &id);
            }
        }
    }

    batch.flush(sink.as_ref(), &id);
    sink.exit(
        &id,
        &ExitPayload {
            code: exit_code.unwrap_or(-1),
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// A sink that keeps every frame it is handed.
    #[derive(Default)]
    struct Recorder {
        frames: Mutex<Vec<DataPayload>>,
        exit: Mutex<Option<ExitPayload>>,
        names: Mutex<Vec<String>>,
    }

    impl Recorder {
        fn frames(&self) -> Vec<DataPayload> {
            self.frames.lock().expect("the recorder").clone()
        }

        fn bytes(&self) -> Vec<u8> {
            let mut bytes = Vec::new();
            for frame in self.frames() {
                bytes.extend(
                    base64::engine::general_purpose::STANDARD
                        .decode(frame.data)
                        .expect("a frame holds base64"),
                );
            }
            bytes
        }
    }

    impl PtySink for Recorder {
        fn data(&self, id: &str, payload: &DataPayload) {
            self.names
                .lock()
                .expect("the recorder")
                .push(data_event(id));
            self.frames
                .lock()
                .expect("the recorder")
                .push(payload.clone());
        }

        fn exit(&self, id: &str, payload: &ExitPayload) {
            self.names
                .lock()
                .expect("the recorder")
                .push(exit_event(id));
            *self.exit.lock().expect("the recorder") = Some(*payload);
        }
    }

    #[test]
    fn an_empty_flush_emits_nothing() {
        let recorder = Arc::new(Recorder::default());
        let mut batch = Batch::new();

        assert!(!batch.flush(recorder.as_ref(), "pty-1"));
        assert!(recorder.frames().is_empty());
        assert_eq!(batch.seq(), 0);
    }

    #[test]
    fn a_flush_carries_the_bytes_and_counts_from_one() {
        let recorder = Arc::new(Recorder::default());
        let mut batch = Batch::new();

        batch.push(b"arrow");
        assert!(batch.flush(recorder.as_ref(), "pty-1"));
        batch.push(b"-ok\r\n");
        assert!(batch.flush(recorder.as_ref(), "pty-1"));

        let frames = recorder.frames();
        assert_eq!(frames.len(), 2, "one frame per flush");
        assert_eq!(frames[0].seq, 1);
        assert_eq!(frames[1].seq, 2);
        assert_eq!(frames[0].data, "YXJyb3c=", "arrow in base64");
        assert_eq!(recorder.bytes(), b"arrow-ok\r\n");
        assert_eq!(
            recorder.names.lock().expect("the recorder").as_slice(),
            ["pty:data:pty-1", "pty:data:pty-1"]
        );
    }

    #[test]
    fn the_event_names_carry_the_session() {
        assert_eq!(data_event("abc"), "pty:data:abc");
        assert_eq!(exit_event("abc"), "pty:exit:abc");
    }

    #[test]
    fn a_burst_of_bytes_comes_out_as_fewer_frames() {
        let recorder = Arc::new(Recorder::default());
        let mut batch = Batch::new();

        for _ in 0..64 {
            batch.push(b"one line of terminal output\r\n");
            batch.flush(recorder.as_ref(), "pty-1");
        }

        assert_eq!(recorder.frames().len(), 64);
        assert!(
            recorder.frames().len() < recorder.bytes().len(),
            "a frame holds more than one byte"
        );
    }

    #[tokio::test]
    async fn the_loop_batches_a_burst_and_ends_with_the_exit() {
        let recorder = Arc::new(Recorder::default());
        let (chunks, receiver) = mpsc::channel(16);
        let (exit, exit_receiver) = oneshot::channel();
        let sink: Arc<dyn PtySink> = recorder.clone();

        let streaming = tokio::spawn(flush_loop(
            receiver,
            exit_receiver,
            sink,
            "pty-1".to_string(),
        ));

        // A burst the reader would deliver as many small reads.
        let mut bytes = 0;
        for _ in 0..64 {
            let line = b"a line of terminal output\r\n";
            bytes += line.len();
            chunks.send(line.to_vec()).await.expect("the channel");
        }
        drop(chunks);
        exit.send(3).expect("the exit channel");

        streaming.await.expect("the flusher ends");

        let frames = recorder.frames();
        assert!(
            frames.len() < bytes,
            "{} frames for {bytes} bytes",
            frames.len()
        );
        assert_eq!(
            frames.iter().map(|frame| frame.seq).collect::<Vec<_>>(),
            (1..=frames.len() as u32).collect::<Vec<_>>(),
            "the sequence counts from one without a gap"
        );
        assert_eq!(recorder.bytes().len(), bytes, "no byte is dropped");
        assert_eq!(
            recorder.exit.lock().expect("the recorder").map(|e| e.code),
            Some(3)
        );
        assert_eq!(
            recorder.names.lock().expect("the recorder").last(),
            Some(&exit_event("pty-1"))
        );
    }

    #[tokio::test]
    async fn an_idle_session_emits_only_the_exit() {
        let recorder = Arc::new(Recorder::default());
        let (chunks, receiver) = mpsc::channel(4);
        let (exit, exit_receiver) = oneshot::channel();
        let sink: Arc<dyn PtySink> = recorder.clone();

        let streaming = tokio::spawn(flush_loop(
            receiver,
            exit_receiver,
            sink,
            "pty-2".to_string(),
        ));

        // Several ticks pass with nothing to say.
        tokio::time::sleep(FLUSH_INTERVAL * 4).await;
        drop(chunks);
        exit.send(0).expect("the exit channel");

        streaming.await.expect("the flusher ends");

        assert!(recorder.frames().is_empty(), "an idle tick emits nothing");
        assert_eq!(
            recorder.exit.lock().expect("the recorder").map(|e| e.code),
            Some(0)
        );
    }
}
