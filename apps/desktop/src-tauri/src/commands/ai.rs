//! The AI commands of the Rust shell.
//!
//! The webview asks for a completion or for an inline edit, and the shell
//! answers with events instead of a return value: `ai:token:{request_id}` for
//! every token, `ai:complete:{request_id}` when the stream ends and
//! `ai:error:{request_id}` when it fails.
//!
//! Escape cancels an in-flight request through one command path, and that
//! path serves the ghost text and the inline edit alike: `cancel_request` ends
//! the request whatever it was for. A cancelled request drops the stream that
//! was in flight, so the request stops instead of running on in the dark.
//!
//! The names below are the contract the frontend is written against. A second
//! spelling of any of them would break the other half of this session.

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::ipc::{CommandArg, CommandItem, InvokeBody, InvokeError};
use tauri::{AppHandle, Emitter, Runtime, State};
use tokio::sync::oneshot;

use crate::ai::client;
use crate::ai::models::{AiEvent, AiRequest, Provider};
use crate::ai_context::{self, ContextInput, Cursor, HotContext};
use crate::ai_keys::KeyStore;

/// The three commands the frontend invokes.
pub const COMMANDS: [&str; 3] = ["complete", "inline_edit", "cancel_request"];

/// The name of the event that carries one token.
pub fn token_event(request_id: &str) -> String {
    format!("ai:token:{request_id}")
}

/// The name of the event that carries the end of a stream.
pub fn complete_event(request_id: &str) -> String {
    format!("ai:complete:{request_id}")
}

/// The name of the event that carries a failure.
pub fn error_event(request_id: &str) -> String {
    format!("ai:error:{request_id}")
}

/// The payload of `ai:token:{request_id}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TokenPayload {
    /// The text of the token.
    pub token: String,
    /// False while the stream is running.
    pub done: bool,
}

/// The payload of `ai:complete:{request_id}`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct CompletePayload {
    /// True when the stream ended.
    pub done: bool,
}

/// The payload of `ai:error:{request_id}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ErrorPayload {
    /// The message of the failure. It never carries key material.
    pub error: String,
}

/// Where the events of a request go.
///
/// The window sink sends them to the main window, and a test keeps them, so
/// the streaming path is the same code in both.
pub trait AiEventSink: Send + Sync + 'static {
    /// Send one event of the request.
    fn emit(&self, event: AiEvent);
}

/// The future of one stream of tokens.
pub type StreamFuture = Pin<Box<dyn Future<Output = Result<(), String>> + Send>>;

/// The source of the tokens of a request.
///
/// The client of the AI feature is the source in the application, and a test
/// drives the pipeline with a source of its own, so the cancellation path can
/// be proved without a network.
pub trait AiStreamer: Send + Sync + 'static {
    /// Stream the events of one request into the sink.
    fn stream(&self, request: AiRequest, key: String, sink: Arc<dyn AiEventSink>) -> StreamFuture;
}

/// The streamer that talks to the client of the AI feature.
pub struct ClientStreamer;

impl AiStreamer for ClientStreamer {
    fn stream(&self, request: AiRequest, key: String, sink: Arc<dyn AiEventSink>) -> StreamFuture {
        Box::pin(async move {
            client::stream(&request, &key, move |event| sink.emit(event))
                .await
                .map_err(|error| crate::ai_keys::redact(&format!("{error:?}")))
        })
    }
}

/// The sink that sends the events of a request to the main window.
struct WindowSink {
    app: AppHandle,
    request_id: String,
}

impl AiEventSink for WindowSink {
    fn emit(&self, event: AiEvent) {
        match event {
            AiEvent::Token { text } => {
                let _ = self.app.emit_to(
                    "main",
                    token_event(&self.request_id).as_str(),
                    TokenPayload {
                        token: text,
                        done: false,
                    },
                );
            }
            AiEvent::Complete => {
                let _ = self.app.emit_to(
                    "main",
                    complete_event(&self.request_id).as_str(),
                    CompletePayload { done: true },
                );
            }
            AiEvent::Error { message } => {
                let _ = self.app.emit_to(
                    "main",
                    error_event(&self.request_id).as_str(),
                    ErrorPayload {
                        error: crate::ai_keys::redact(&message),
                    },
                );
            }
        }
    }
}

/// The requests that are in flight, keyed by the id the webview gave them.
#[derive(Default)]
pub struct AiRequests {
    inner: Mutex<HashMap<String, oneshot::Sender<()>>>,
}

impl AiRequests {
    /// An empty registry.
    pub fn new() -> Self {
        Self::default()
    }

    /// Remember a request that is in flight.
    ///
    /// The id of a request is the id the webview chose, so a webview that
    /// sends the same id twice would leave the first request unkillable. The
    /// second request is refused instead.
    fn register(&self, request_id: &str, cancel: oneshot::Sender<()>) -> Result<(), String> {
        let mut requests = self
            .inner
            .lock()
            .map_err(|_| "the requests of the shell are poisoned".to_string())?;

        if requests.contains_key(request_id) {
            return Err(format!("the request {request_id} is already in flight"));
        }

        requests.insert(request_id.to_string(), cancel);
        Ok(())
    }

    /// End the request of an id.
    ///
    /// Answers true when a request was in flight. The request itself stops
    /// when its stream is dropped, which happens in the task that runs it.
    pub fn cancel(&self, request_id: &str) -> bool {
        let cancel = {
            let mut requests = match self.inner.lock() {
                Ok(requests) => requests,
                Err(_) => return false,
            };

            requests.remove(request_id)
        };

        match cancel {
            Some(cancel) => {
                let _ = cancel.send(());
                true
            }
            None => false,
        }
    }

    /// Forget a request that ended.
    fn finish(&self, request_id: &str) {
        if let Ok(mut requests) = self.inner.lock() {
            requests.remove(request_id);
        }
    }

    /// True while the request of an id is in flight.
    pub fn is_active(&self, request_id: &str) -> bool {
        self.inner
            .lock()
            .map(|requests| requests.contains_key(request_id))
            .unwrap_or(false)
    }

    /// The number of requests that are in flight.
    pub fn len(&self) -> usize {
        self.inner
            .lock()
            .map(|requests| requests.len())
            .unwrap_or(0)
    }

    /// True when no request is in flight.
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

/// The sink that remembers whether the stream said it was done.
struct TrackingSink {
    inner: Arc<dyn AiEventSink>,
    completed: AtomicBool,
}

impl AiEventSink for TrackingSink {
    fn emit(&self, event: AiEvent) {
        if matches!(event, AiEvent::Complete) {
            self.completed.store(true, Ordering::SeqCst);
        }

        self.inner.emit(event);
    }
}

/// Start a request and answer as soon as it is under way.
///
/// The request runs in a task of its own, so the command answers at once and
/// the tokens arrive as events. The task holds the stream, and a cancel drops
/// that stream, which ends the request that was in flight.
pub fn start_request(
    requests: &Arc<AiRequests>,
    streamer: Arc<dyn AiStreamer>,
    sink: Arc<dyn AiEventSink>,
    request_id: String,
    request: AiRequest,
    key: String,
) -> Result<(), String> {
    let (cancel, mut cancelled) = oneshot::channel::<()>();
    requests.register(&request_id, cancel)?;

    let tracking = Arc::new(TrackingSink {
        inner: sink,
        completed: AtomicBool::new(false),
    });

    let requests = Arc::clone(requests);
    let task_id = request_id.clone();
    let task_sink = Arc::clone(&tracking) as Arc<dyn AiEventSink>;

    tauri::async_runtime::spawn(async move {
        let outcome = {
            let stream = streamer.stream(request, key, Arc::clone(&task_sink));
            tokio::pin!(stream);

            tokio::select! {
                result = &mut stream => Some(result),
                _ = &mut cancelled => None,
            }
        };

        requests.finish(&task_id);

        match outcome {
            Some(Ok(())) => {
                // The client ends most streams with a complete event. A stream
                // that ended without one still ends here.
                if !tracking.completed.load(Ordering::SeqCst) {
                    task_sink.emit(AiEvent::Complete);
                }
            }
            Some(Err(message)) => {
                task_sink.emit(AiEvent::Error { message });
            }
            None => {
                // The request was cancelled. The stream was dropped, so the
                // request that was in flight has stopped.
                task_sink.emit(AiEvent::Complete);
            }
        }
    });

    Ok(())
}

/// The arguments of a completion.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompletionArgs {
    /// The id the webview gave the request.
    pub request_id: String,
    /// The provider the request goes to.
    pub provider: String,
    /// The model the request goes to.
    pub model: String,
    /// The prompt of the request.
    pub prompt: String,
    /// The context of the request.
    pub context: String,
}

/// The arguments of an inline edit.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InlineEditArgs {
    /// The id the webview gave the request.
    pub request_id: String,
    /// The provider the request goes to.
    pub provider: String,
    /// The model the request goes to.
    pub model: String,
    /// The instruction of the edit.
    pub instruction: String,
    /// The text the edit applies to.
    pub selection: String,
}

/// The id of a request, as the webview sends it.
///
/// The two halves of this session were written in parallel against one
/// contract, and the contract names this argument `request_id` while the
/// boundary of the webview speaks camel case. The command reads the id under
/// either name, so the call works whichever spelling the frontend sends.
pub struct RequestId(pub String);

impl RequestId {
    /// The id inside the payload of the webview.
    pub fn of(payload: &serde_json::Value) -> Option<String> {
        payload
            .get("requestId")
            .or_else(|| payload.get("request_id"))
            .or_else(|| payload.get("id"))
            .and_then(|id| id.as_str())
            .map(|id| id.to_string())
    }
}

impl<'de, R: Runtime> CommandArg<'de, R> for RequestId {
    fn from_command(command: CommandItem<'de, R>) -> Result<Self, InvokeError> {
        let InvokeBody::Json(payload) = command.message.payload() else {
            return Err(InvokeError::from(
                "cancel_request needs the id of a request",
            ));
        };

        RequestId::of(payload)
            .map(RequestId)
            .ok_or_else(|| InvokeError::from("cancel_request needs the id of a request"))
    }
}

/// The arguments of a completion, as the webview sends them.
///
/// The payload is read by hand, so the command answers to either spelling of
/// every name in it.
pub struct CompletionPayload(pub CompletionArgs);

impl<'de, R: Runtime> CommandArg<'de, R> for CompletionPayload {
    fn from_command(command: CommandItem<'de, R>) -> Result<Self, InvokeError> {
        let InvokeBody::Json(payload) = command.message.payload() else {
            return Err(InvokeError::from(
                "complete needs the arguments of the request",
            ));
        };

        let request_id = read(&payload, &["requestId", "request_id"])
            .ok_or_else(|| InvokeError::from("complete needs the id of the request"))?;
        let provider = read(&payload, &["provider"])
            .ok_or_else(|| InvokeError::from("complete needs the provider of the request"))?;
        let model = read(&payload, &["model"])
            .ok_or_else(|| InvokeError::from("complete needs the model of the request"))?;
        let prompt = read(&payload, &["prompt"])
            .ok_or_else(|| InvokeError::from("complete needs the prompt of the request"))?;
        let context = read(&payload, &["context"]).unwrap_or_default();

        Ok(CompletionPayload(CompletionArgs {
            request_id,
            provider,
            model,
            prompt,
            context,
        }))
    }
}

/// The arguments of an inline edit, as the webview sends them.
pub struct InlineEditPayload(pub InlineEditArgs);

impl<'de, R: Runtime> CommandArg<'de, R> for InlineEditPayload {
    fn from_command(command: CommandItem<'de, R>) -> Result<Self, InvokeError> {
        let InvokeBody::Json(payload) = command.message.payload() else {
            return Err(InvokeError::from(
                "inline_edit needs the arguments of the request",
            ));
        };

        let request_id = read(&payload, &["requestId", "request_id"])
            .ok_or_else(|| InvokeError::from("inline_edit needs the id of the request"))?;
        let provider = read(&payload, &["provider"])
            .ok_or_else(|| InvokeError::from("inline_edit needs the provider of the request"))?;
        let model = read(&payload, &["model"])
            .ok_or_else(|| InvokeError::from("inline_edit needs the model of the request"))?;
        let instruction = read(&payload, &["instruction"])
            .ok_or_else(|| InvokeError::from("inline_edit needs the instruction of the edit"))?;
        let selection = read(&payload, &["selection"]).unwrap_or_default();

        Ok(InlineEditPayload(InlineEditArgs {
            request_id,
            provider,
            model,
            instruction,
            selection,
        }))
    }
}

/// The first of the names that holds a text in the payload.
fn read(payload: &serde_json::Value, names: &[&str]) -> Option<String> {
    names
        .iter()
        .find_map(|name| payload.get(*name))
        .and_then(|value| value.as_str())
        .map(|value| value.to_string())
}

/// The provider a request goes to.
fn parse_provider(name: &str) -> Result<Provider, String> {
    match name.trim().to_ascii_lowercase().as_str() {
        "anthropic" => Ok(Provider::Anthropic),
        "openai" => Ok(Provider::OpenAi),
        "google" => Ok(Provider::Google),
        other => Err(format!("{other} is not a provider Arrow knows")),
    }
}

/// Start a completion.
///
/// The key of the provider is read from the keychain and never leaves Rust.
/// The request answers at once and the tokens arrive as events.
pub fn start_completion(
    requests: &Arc<AiRequests>,
    keys: &KeyStore,
    streamer: Arc<dyn AiStreamer>,
    sink: Arc<dyn AiEventSink>,
    args: &CompletionArgs,
) -> Result<(), String> {
    let provider = parse_provider(&args.provider)?;
    let key = keys
        .secret(&args.provider)
        .map_err(|error| error.message().to_string())?
        .ok_or_else(|| format!("there is no key for {}", args.provider.trim()))?;

    let context = ai_context::wrap(&args.context);
    let request = AiRequest {
        provider,
        model: args.model.clone(),
        prompt: args.prompt.clone(),
        context: context.items,
        max_output_tokens: ai_context::OUTPUT_TOKEN_BUDGET,
    };

    start_request(
        requests,
        streamer,
        sink,
        args.request_id.clone(),
        request,
        key,
    )
}

/// Start an inline edit.
///
/// The edit produces the same events as a completion: the tokens of the
/// proposed edit arrive one by one, and the same cancel path ends the request.
pub fn start_inline_edit(
    requests: &Arc<AiRequests>,
    keys: &KeyStore,
    streamer: Arc<dyn AiStreamer>,
    sink: Arc<dyn AiEventSink>,
    args: &InlineEditArgs,
) -> Result<(), String> {
    let provider = parse_provider(&args.provider)?;
    let key = keys
        .secret(&args.provider)
        .map_err(|error| error.message().to_string())?
        .ok_or_else(|| format!("there is no key for {}", args.provider.trim()))?;

    let context = ai_context::wrap(&args.selection);
    let request = AiRequest {
        provider,
        model: args.model.clone(),
        prompt: args.instruction.clone(),
        context: context.items,
        max_output_tokens: ai_context::OUTPUT_TOKEN_BUDGET,
    };

    start_request(
        requests,
        streamer,
        sink,
        args.request_id.clone(),
        request,
        key,
    )
}

/// `complete(request_id, provider, model, prompt, context)` starts a request
/// and answers at once.
#[tauri::command]
pub async fn complete(
    app: AppHandle,
    requests: State<'_, Arc<AiRequests>>,
    keys: State<'_, KeyStore>,
    payload: CompletionPayload,
) -> Result<(), String> {
    let args = payload.0;
    let request_id = args.request_id.clone();
    let sink: Arc<dyn AiEventSink> = Arc::new(WindowSink {
        app,
        request_id: request_id.clone(),
    });

    match start_completion(
        &requests,
        &keys,
        Arc::new(ClientStreamer),
        sink.clone(),
        &args,
    ) {
        Ok(()) => Ok(()),
        Err(message) => {
            // The request never started, so the webview is told why here
            // instead of through an event of a request that does not exist.
            sink.emit(AiEvent::Error {
                message: crate::ai_keys::redact(&message),
            });
            Err(message)
        }
    }
}

/// `inline_edit(request_id, provider, model, instruction, selection)` starts a
/// request that produces a proposed edit.
#[tauri::command]
pub async fn inline_edit(
    app: AppHandle,
    requests: State<'_, Arc<AiRequests>>,
    keys: State<'_, KeyStore>,
    payload: InlineEditPayload,
) -> Result<(), String> {
    let args = payload.0;
    let request_id = args.request_id.clone();
    let sink: Arc<dyn AiEventSink> = Arc::new(WindowSink {
        app,
        request_id: request_id.clone(),
    });

    match start_inline_edit(
        &requests,
        &keys,
        Arc::new(ClientStreamer),
        sink.clone(),
        &args,
    ) {
        Ok(()) => Ok(()),
        Err(message) => {
            sink.emit(AiEvent::Error {
                message: crate::ai_keys::redact(&message),
            });
            Err(message)
        }
    }
}

/// `cancel_request(request_id)` ends the request that is in flight.
///
/// One path serves the ghost text and the inline edit. The request stops: the
/// stream that was in flight is dropped.
#[tauri::command]
pub fn cancel_request(requests: State<'_, Arc<AiRequests>>, request_id: RequestId) -> bool {
    requests.cancel(&request_id.0)
}

/// The context of a request that arrives as one text.
///
/// The webview sends the context of a request as one text. The builder holds
/// that text to the budget of the context, so a request that carries a whole
/// repository does not fill the window of the model.
pub fn context_of(text: &str) -> ContextInput {
    ContextInput {
        hot: HotContext {
            path: String::new(),
            content: text.to_string(),
            cursor: Cursor::default(),
            selection: String::new(),
        },
        warm: Vec::new(),
        signatures: Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicUsize;
    use std::time::Duration;

    use super::*;
    use crate::ai::models::{ContextRole, Provider};
    use crate::ai_keys::testing::MemoryKeychain;
    use crate::pty::testing::wait_until;

    /// A sink that keeps every event, so a test can read what the frontend
    /// would have received.
    #[derive(Default)]
    struct Recorder {
        events: Mutex<Vec<AiEvent>>,
    }

    impl Recorder {
        /// The events the recorder holds.
        fn events(&self) -> Vec<AiEvent> {
            self.events.lock().expect("the recorder").clone()
        }

        /// The tokens the recorder holds.
        fn tokens(&self) -> Vec<String> {
            self.events()
                .into_iter()
                .filter_map(|event| match event {
                    AiEvent::Token { text } => Some(text),
                    _ => None,
                })
                .collect()
        }

        /// Wait until the recorder holds `count` tokens.
        fn wait_for_tokens(&self, count: usize) -> bool {
            wait_until(Duration::from_secs(10), || self.tokens().len() >= count)
        }
    }

    impl AiEventSink for Recorder {
        fn emit(&self, event: AiEvent) {
            self.events.lock().expect("the recorder").push(event);
        }
    }

    /// A guard that remembers that the stream was dropped.
    struct Dropped(Arc<AtomicBool>);

    impl Drop for Dropped {
        fn drop(&mut self) {
            self.0.store(true, Ordering::SeqCst);
        }
    }

    /// A source that streams tokens and never ends on its own.
    struct FakeStreamer {
        dropped: Arc<AtomicBool>,
        tokens: Vec<String>,
        started: Arc<AtomicUsize>,
    }

    impl AiStreamer for FakeStreamer {
        fn stream(
            &self,
            _request: AiRequest,
            _key: String,
            sink: Arc<dyn AiEventSink>,
        ) -> StreamFuture {
            let dropped = Arc::clone(&self.dropped);
            let tokens = self.tokens.clone();
            let started = Arc::clone(&self.started);

            Box::pin(async move {
                let _guard = Dropped(dropped);
                started.fetch_add(1, Ordering::SeqCst);

                for token in tokens {
                    sink.emit(AiEvent::Token { text: token });
                }

                loop {
                    tokio::time::sleep(Duration::from_millis(5)).await;
                }
            })
        }
    }

    /// A source that streams tokens and ends.
    struct FiniteStreamer {
        tokens: Vec<String>,
    }

    impl AiStreamer for FiniteStreamer {
        fn stream(
            &self,
            _request: AiRequest,
            _key: String,
            sink: Arc<dyn AiEventSink>,
        ) -> StreamFuture {
            let tokens = self.tokens.clone();

            Box::pin(async move {
                for token in tokens {
                    sink.emit(AiEvent::Token { text: token });
                }

                sink.emit(AiEvent::Complete);
                Ok(())
            })
        }
    }

    fn keys() -> KeyStore {
        KeyStore::new(Arc::new(MemoryKeychain::new()))
    }

    fn completion() -> CompletionArgs {
        CompletionArgs {
            request_id: "req-1".to_string(),
            provider: "anthropic".to_string(),
            model: "claude-sonnet-4-5".to_string(),
            prompt: "finish the line".to_string(),
            context: "const arrow = 1;".to_string(),
        }
    }

    #[test]
    fn the_three_commands_are_the_contract() {
        assert_eq!(COMMANDS, ["complete", "inline_edit", "cancel_request"]);
    }

    #[test]
    fn the_event_names_carry_the_request() {
        assert_eq!(token_event("abc"), "ai:token:abc");
        assert_eq!(complete_event("abc"), "ai:complete:abc");
        assert_eq!(error_event("abc"), "ai:error:abc");
    }

    #[test]
    fn the_id_of_a_request_is_read_under_either_spelling() {
        let camel = serde_json::json!({ "requestId": "req-1" });
        let snake = serde_json::json!({ "request_id": "req-1" });

        assert_eq!(RequestId::of(&camel), Some("req-1".to_string()));
        assert_eq!(RequestId::of(&snake), Some("req-1".to_string()));
        assert_eq!(RequestId::of(&serde_json::json!({ "other": "x" })), None);
    }

    #[test]
    fn a_provider_arrow_does_not_know_is_refused() {
        assert!(parse_provider("anthropic").is_ok());
        assert!(parse_provider("OpenAI").is_ok());
        assert!(parse_provider("google").is_ok());
        assert!(parse_provider("skynet").is_err());
    }

    #[test]
    fn a_request_without_a_key_is_refused() {
        let requests = Arc::new(AiRequests::new());
        let recorder = Arc::new(Recorder::default());
        let streamer = Arc::new(FiniteStreamer { tokens: vec![] });

        let error = start_completion(
            &requests,
            &keys(),
            streamer,
            recorder.clone(),
            &completion(),
        )
        .expect_err("there is no key");

        assert!(error.contains("no key"));
        assert!(requests.is_empty());
    }

    #[test]
    fn a_stream_ends_with_a_complete_event() {
        let requests = Arc::new(AiRequests::new());
        let recorder = Arc::new(Recorder::default());
        let keys = keys();
        keys.set("anthropic", "sk-test-value").expect("the key");
        let streamer = Arc::new(FiniteStreamer {
            tokens: vec!["one".to_string(), "two".to_string()],
        });

        start_completion(&requests, &keys, streamer, recorder.clone(), &completion())
            .expect("the request starts");

        assert!(recorder.wait_for_tokens(2));
        assert!(wait_until(Duration::from_secs(10), || {
            recorder
                .events()
                .iter()
                .any(|event| matches!(event, AiEvent::Complete))
        }));
        assert_eq!(recorder.tokens(), ["one", "two"]);
    }

    #[test]
    fn a_cancelled_request_stops() {
        let requests = Arc::new(AiRequests::new());
        let recorder = Arc::new(Recorder::default());
        let keys = keys();
        keys.set("anthropic", "sk-test-value").expect("the key");

        let dropped = Arc::new(AtomicBool::new(false));
        let started = Arc::new(AtomicUsize::new(0));
        let streamer = Arc::new(FakeStreamer {
            dropped: Arc::clone(&dropped),
            tokens: vec!["one".to_string()],
            started,
        });

        start_completion(&requests, &keys, streamer, recorder.clone(), &completion())
            .expect("the request starts");

        assert!(recorder.wait_for_tokens(1));
        assert!(requests.is_active("req-1"));

        assert!(requests.cancel("req-1"), "the request was in flight");

        assert!(
            wait_until(Duration::from_secs(10), || dropped.load(Ordering::SeqCst)),
            "the stream of the request was dropped"
        );

        let tokens = recorder.tokens().len();
        std::thread::sleep(Duration::from_millis(100));
        assert_eq!(
            recorder.tokens().len(),
            tokens,
            "no token arrives after the cancel"
        );
        assert!(!requests.is_active("req-1"), "the request is gone");
    }

    #[test]
    fn a_cancelled_request_that_is_not_in_flight_answers_false() {
        let requests = AiRequests::new();

        assert!(!requests.cancel("req-0"));
        assert!(requests.is_empty());
    }

    #[test]
    fn two_requests_with_one_id_are_refused() {
        let requests = Arc::new(AiRequests::new());
        let recorder = Arc::new(Recorder::default());
        let keys = keys();
        keys.set("anthropic", "sk-test-value").expect("the key");
        let dropped = Arc::new(AtomicBool::new(false));
        let streamer = Arc::new(FakeStreamer {
            dropped: Arc::clone(&dropped),
            tokens: vec!["one".to_string()],
            started: Arc::new(AtomicUsize::new(0)),
        });

        start_completion(
            &requests,
            &keys,
            streamer.clone(),
            recorder.clone(),
            &completion(),
        )
        .expect("the request starts");
        assert!(recorder.wait_for_tokens(1));

        let error = start_completion(&requests, &keys, streamer, recorder, &completion())
            .expect_err("the id is taken");

        assert!(error.contains("already in flight"));
        assert!(requests.cancel("req-1"), "the request is ended");
    }

    #[test]
    fn the_context_of_a_request_is_held_to_the_budget() {
        let requests = Arc::new(AiRequests::new());
        let recorder = Arc::new(Recorder::default());
        let keys = keys();
        keys.set("anthropic", "sk-test-value").expect("the key");
        let streamer = Arc::new(FiniteStreamer { tokens: vec![] });
        let mut args = completion();
        args.context = "x".repeat(200_000);

        start_completion(&requests, &keys, streamer, recorder.clone(), &args)
            .expect("the request starts");

        assert!(wait_until(Duration::from_secs(10), || {
            recorder
                .events()
                .iter()
                .any(|event| matches!(event, AiEvent::Complete))
        }));
    }

    #[test]
    fn an_inline_edit_is_a_request_too() {
        let requests = Arc::new(AiRequests::new());
        let recorder = Arc::new(Recorder::default());
        let keys = keys();
        keys.set("openai", "sk-test-value").expect("the key");
        let streamer = Arc::new(FiniteStreamer {
            tokens: vec!["edited".to_string()],
        });

        let args = InlineEditArgs {
            request_id: "req-2".to_string(),
            provider: "openai".to_string(),
            model: "gpt-4o".to_string(),
            instruction: "make it shorter".to_string(),
            selection: "a very long line".to_string(),
        };

        start_inline_edit(&requests, &keys, streamer, recorder.clone(), &args)
            .expect("the request starts");

        assert!(recorder.wait_for_tokens(1));
        assert_eq!(recorder.tokens(), ["edited"]);
    }

    #[test]
    fn the_context_of_a_request_is_one_item_per_tier() {
        let context = ai_context::wrap("const arrow = 1;");

        assert_eq!(context.items[0].role, ContextRole::System);
        assert!(context.items[1].text.contains("const arrow = 1;"));
        assert!(context.tokens <= ai_context::CONTEXT_TOKEN_BUDGET);
    }

    #[test]
    fn the_provider_of_a_request_is_one_arrow_knows() {
        assert!(matches!(
            parse_provider("anthropic"),
            Ok(Provider::Anthropic)
        ));
        assert!(matches!(parse_provider("openai"), Ok(Provider::OpenAi)));
        assert!(matches!(parse_provider("google"), Ok(Provider::Google)));
    }
}
