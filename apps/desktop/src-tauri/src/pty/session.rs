//! One terminal session.
//!
//! A session owns four things: the master side of the PTY, which is how the
//! shell is resized; the writer, which is how the frontend types; the killer,
//! which is how the session dies; and the three threads that read, wait and
//! flush. The shell itself is the child of the PTY slave, and the slave is
//! dropped as soon as the shell is spawned, so the master sees end of file
//! when the shell exits.
//!
//! The three threads keep one invariant between them: the exit event leaves
//! only after every byte the shell wrote has left, and it leaves exactly once.

use std::io::{Read, Write};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use tokio::sync::{mpsc, oneshot};

use super::stream::{self, PtySink};

/// The result every terminal call answers with.
pub type PtyResult<T> = Result<T, String>;

/// How many read chunks may wait for the flusher before the reader blocks.
///
/// The flusher drains the channel every sixteen milliseconds, so this depth
/// only matters when a program writes faster than the webview can paint. A
/// full channel makes the reader wait, which pushes back on the shell instead
/// of growing a buffer without a limit.
const CHANNEL_DEPTH: usize = 256;

/// The shell a new session runs, from `SHELL`, or `/bin/sh` when it is unset.
pub fn default_shell() -> String {
    shell_from(std::env::var("SHELL").ok())
}

/// The shell a session runs, from the value of `SHELL`.
///
/// Split from the environment read so a test can name the value without
/// changing the environment of the whole test binary.
pub fn shell_from(shell: Option<String>) -> String {
    match shell {
        Some(shell) if !shell.trim().is_empty() => shell,
        _ => "/bin/sh".to_string(),
    }
}

/// A size the PTY accepts: a terminal with no column or no row cannot exist.
fn size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        rows: rows.max(1),
        cols: cols.max(1),
        pixel_width: 0,
        pixel_height: 0,
    }
}

fn poisoned(what: &str) -> String {
    format!("the terminal {what} is poisoned")
}

/// One terminal session.
pub struct PtySession {
    id: String,
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
}

impl PtySession {
    /// Spawn the default shell in a new PTY of the given size.
    ///
    /// Every byte the shell writes reaches `sink` as batched frames, and its
    /// exit reaches `sink` once, after the last frame.
    pub fn spawn(
        id: impl Into<String>,
        cols: u16,
        rows: u16,
        sink: Arc<dyn PtySink>,
    ) -> PtyResult<Self> {
        let id = id.into();
        let pair = native_pty_system()
            .openpty(size(cols, rows))
            .map_err(|error| format!("the terminal could not be opened: {error}"))?;

        let shell = default_shell();
        let mut command = CommandBuilder::new(&shell);
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");

        let mut child = pair
            .slave
            .spawn_command(command)
            .map_err(|error| format!("{shell} could not be started: {error}"))?;
        // The master sees end of file only when no slave is open, so the
        // parent must not keep one.
        drop(pair.slave);

        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|error| format!("the terminal output could not be read: {error}"))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|error| format!("the terminal input could not be written: {error}"))?;
        let killer = child.clone_killer();

        let (chunks, chunk_receiver) = mpsc::channel::<Vec<u8>>(CHANNEL_DEPTH);
        let (exit, exit_receiver) = oneshot::channel::<i32>();

        let reader_id = id.clone();
        thread::Builder::new()
            .name(format!("pty-read-{reader_id}"))
            .spawn(move || read_loop(reader, chunks))
            .map_err(|error| format!("the terminal reader could not start: {error}"))?;

        let waiter_id = id.clone();
        thread::Builder::new()
            .name(format!("pty-wait-{waiter_id}"))
            .spawn(move || {
                let code = child
                    .wait()
                    .map(|status| status.exit_code() as i32)
                    .unwrap_or(-1);
                // The flusher may already be gone when the session was
                // dropped, which is not an error.
                let _ = exit.send(code);
            })
            .map_err(|error| format!("the terminal waiter could not start: {error}"))?;

        let stream_id = id.clone();
        thread::Builder::new()
            .name(format!("pty-stream-{stream_id}"))
            .spawn(move || {
                let runtime = match tokio::runtime::Builder::new_current_thread()
                    .enable_time()
                    .build()
                {
                    Ok(runtime) => runtime,
                    Err(_) => return,
                };
                runtime.block_on(stream::flush_loop(
                    chunk_receiver,
                    exit_receiver,
                    sink,
                    stream_id,
                ));
            })
            .map_err(|error| format!("the terminal stream could not start: {error}"))?;

        Ok(Self {
            id,
            master: Mutex::new(pair.master),
            writer: Mutex::new(writer),
            killer: Mutex::new(killer),
        })
    }

    /// The id the session was created with.
    pub fn id(&self) -> &str {
        &self.id
    }

    /// Write the bytes of `data` to the shell.
    pub fn write(&self, data: &str) -> PtyResult<()> {
        let mut writer = lock(&self.writer, "writer")?;
        writer
            .write_all(data.as_bytes())
            .and_then(|()| writer.flush())
            .map_err(|error| format!("the terminal could not be written: {error}"))
    }

    /// Resize the PTY, so the shell sees the new size before its next paint.
    pub fn resize(&self, cols: u16, rows: u16) -> PtyResult<()> {
        let master = lock(&self.master, "master")?;
        master
            .resize(size(cols, rows))
            .map_err(|error| format!("the terminal could not be resized: {error}"))
    }

    /// Kill the shell. The reader then sees end of file and the stream ends.
    pub fn kill(&self) -> PtyResult<()> {
        let mut killer = lock(&self.killer, "killer")?;
        killer
            .kill()
            .map_err(|error| format!("the terminal could not be killed: {error}"))
    }
}

/// Move bytes from the PTY into the channel until the shell closes it.
fn read_loop(mut reader: Box<dyn Read + Send>, chunks: mpsc::Sender<Vec<u8>>) {
    let mut buffer = vec![0u8; 8192];
    loop {
        match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(read) => {
                if chunks.blocking_send(buffer[..read].to_vec()).is_err() {
                    break;
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => break,
        }
    }
    // Dropping the sender closes the channel, which is how the flusher learns
    // the shell has no more to say.
}

/// Take a lock, or answer with the reason the terminal cannot continue.
fn lock<'a, T>(mutex: &'a Mutex<T>, what: &str) -> PtyResult<MutexGuard<'a, T>> {
    mutex.lock().map_err(|_| poisoned(what))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_shell_comes_from_the_environment() {
        assert_eq!(shell_from(Some("/bin/bash".into())), "/bin/bash");
        assert_eq!(shell_from(Some("/usr/bin/fish".into())), "/usr/bin/fish");
    }

    #[test]
    fn an_unset_or_empty_shell_falls_back_to_sh() {
        assert_eq!(shell_from(None), "/bin/sh");
        assert_eq!(shell_from(Some(String::new())), "/bin/sh");
        assert_eq!(shell_from(Some("   ".into())), "/bin/sh");
    }

    #[test]
    fn a_terminal_never_has_a_zero_size() {
        let empty = size(0, 0);
        assert_eq!((empty.cols, empty.rows), (1, 1));
        let placed = size(120, 40);
        assert_eq!((placed.cols, placed.rows), (120, 40));
    }

    #[test]
    fn the_lock_helper_reports_a_poisoned_lock() {
        let mutex = Mutex::new(1u8);
        assert_eq!(*lock(&mutex, "writer").expect("the lock"), 1);
    }
}
