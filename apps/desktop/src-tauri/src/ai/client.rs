//! The HTTP client of the AI providers.
//!
//! The client builds the request of a provider, sends it, and turns the
//! stream that comes back into the events of `ai/models.rs`. The key goes
//! into the headers of the request and nowhere else: the client never logs
//! it, never puts it in an error, and never prints it.
//!
//! The client does not store the key and does not read it from the disk. The
//! other half of the session owns the keychain and hands the key over.
//!
//! A developer can point the client at a local stand-in for a provider with
//! `ARROW_AI_BASE_URL`. The override is honored only when the host of the
//! value is a loopback host, so a stray variable cannot send the key to
//! another machine.

use std::time::Duration;

use reqwest::Url;

use crate::ai::models::{redact, AiError, AiEvent, AiRequest, Provider};
use crate::ai::providers;
use crate::ai::stream::SseReader;

/// The time the client waits for the connection of a request.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);

/// The environment variable that points the client at a local stand-in for a
/// provider.
pub const BASE_URL_VAR: &str = "ARROW_AI_BASE_URL";

/// The hosts the override is honored for.
///
/// The list is exact on purpose. A host outside it is a machine that is not
/// this one, and the key never leaves the machine for the sake of a variable.
const LOOPBACK_HOSTS: [&str; 3] = ["127.0.0.1", "::1", "localhost"];

/// The addresses the client talks to.
///
/// The defaults are the addresses of the providers. A test points them at a
/// mock server, and the client then talks to a server that stands in for the
/// provider.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Endpoints {
    /// The address of the Anthropic API.
    pub anthropic: String,
    /// The address of the OpenAI API.
    pub openai: String,
    /// The address of the Gemini API.
    pub google: String,
}

impl Default for Endpoints {
    fn default() -> Self {
        Self {
            anthropic: providers::anthropic::BASE_URL.to_string(),
            openai: providers::openai::BASE_URL.to_string(),
            google: providers::google::BASE_URL.to_string(),
        }
    }
}

impl Endpoints {
    /// The addresses of the providers, with the local stand-in in place of
    /// every one of them when `ARROW_AI_BASE_URL` names a loopback host.
    pub fn from_env() -> Self {
        Self::from_override(std::env::var(BASE_URL_VAR).ok().as_deref())
    }

    /// The addresses of the providers, with the given override in place of
    /// every one of them when it names a loopback host.
    ///
    /// An override that names any other host is ignored, and the addresses
    /// stay the addresses of the providers.
    fn from_override(value: Option<&str>) -> Self {
        match value.and_then(loopback_base) {
            Some(base) => Self {
                anthropic: base.clone(),
                openai: base.clone(),
                google: base,
            },
            None => Self::default(),
        }
    }

    /// The address of the provider of the request.
    pub fn base_for(&self, provider: Provider) -> &str {
        match provider {
            Provider::Anthropic => &self.anthropic,
            Provider::OpenAi => &self.openai,
            Provider::Google => &self.google,
        }
    }
}

/// The address an override names, when its host is a loopback host.
///
/// The host is read from the parsed url, so the parts of the value that a
/// reader could mistake for a host, such as the user info or a label of a
/// longer name, never count as one.
fn loopback_base(value: &str) -> Option<String> {
    let url = Url::parse(value).ok()?;
    let host = url.host_str()?;
    let host = host
        .strip_prefix('[')
        .and_then(|host| host.strip_suffix(']'))
        .unwrap_or(host);
    let loopback = LOOPBACK_HOSTS
        .iter()
        .any(|allowed| host.eq_ignore_ascii_case(allowed));
    loopback.then(|| value.to_string())
}

/// Stream the answer of one request into the sink.
///
/// The sink is called once for every event of the stream: a token, the end
/// of the answer, or an error the provider reported. The call fails only
/// when the request itself failed, so a caller that watches the sink sees
/// the whole answer.
pub async fn stream(
    req: &AiRequest,
    key: &str,
    sink: impl Fn(AiEvent) + Send,
) -> Result<(), AiError> {
    stream_to(req, key, sink, &Endpoints::from_env()).await
}

/// Stream the answer of one request into the sink, against the given addresses.
pub async fn stream_to(
    req: &AiRequest,
    key: &str,
    sink: impl Fn(AiEvent) + Send,
    endpoints: &Endpoints,
) -> Result<(), AiError> {
    let provider = req.provider.as_str();
    let parts = providers::build_request_at(req, key, endpoints.base_for(req.provider));

    let client = reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .build()
        .map_err(|error| AiError::Transport {
            provider,
            message: redact(&error.to_string(), key),
        })?;

    // The parts hand over the whole request, body included. The sender never
    // holds the url, the headers or the body on their own, so it cannot build
    // a request that leaves the payload behind.
    let request = parts
        .into_request(&client)
        .map_err(|error| AiError::Transport {
            provider,
            message: redact(&error.to_string(), key),
        })?;

    let mut response = client
        .execute(request)
        .await
        .map_err(|error| AiError::Transport {
            provider,
            message: redact(&error.to_string(), key),
        })?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(AiError::Status {
            provider,
            status: status.as_u16(),
            message: redact(&body, key),
        });
    }

    let mut reader = SseReader::new();
    while let Some(chunk) = response.chunk().await.map_err(|error| AiError::Transport {
        provider,
        message: redact(&error.to_string(), key),
    })? {
        let text = String::from_utf8_lossy(&chunk);
        for event in reader.push(&text) {
            sink(event);
        }
    }
    for event in reader.finish() {
        sink(event);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::models::{ContextItem, ContextRole};
    use std::sync::{Arc, Mutex};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    /// The key of the tests. It is a key-shaped string and it never leaves
    /// the Rust side.
    const KEY: &str = "sk-ant-the-key-that-must-never-appear";

    /// A request with one system turn and a prompt.
    fn request() -> AiRequest {
        AiRequest {
            provider: Provider::OpenAi,
            model: "gpt-4o".to_string(),
            prompt: "refactor this".to_string(),
            context: vec![ContextItem::new(ContextRole::System, "you are Arrow")],
            max_output_tokens: 128,
        }
    }

    /// The request of a provider, with the model that provider serves.
    fn request_for(provider: Provider) -> AiRequest {
        let model = match provider {
            Provider::Anthropic => "claude-sonnet-4-5",
            Provider::OpenAi => "gpt-4o",
            Provider::Google => "gemini-2.0-flash",
        };
        AiRequest {
            provider,
            model: model.to_string(),
            ..request()
        }
    }

    /// A server that answers every request with the given body.
    ///
    /// The body is written in the given pieces, and the server waits between
    /// them, so a piece of a token can arrive on its own.
    async fn mock_server(
        status: &str,
        content_type: &str,
        body_parts: &[&str],
    ) -> (String, tokio::task::JoinHandle<()>) {
        let body: String = body_parts.concat();
        let head = format!(
            "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\n\r\n",
            body.len()
        );
        let mut parts: Vec<String> = vec![head];
        for part in body_parts {
            parts.push((*part).to_string());
        }

        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("the mock server binds a port");
        let address = listener
            .local_addr()
            .expect("the mock server has an address");
        let handle = tokio::spawn(async move {
            let (mut socket, _) = listener
                .accept()
                .await
                .expect("the mock server accepts a connection");
            let mut buffer = [0_u8; 4096];
            let _ = socket.read(&mut buffer).await;
            for part in parts {
                socket
                    .write_all(part.as_bytes())
                    .await
                    .expect("the mock server answers");
                socket.flush().await.ok();
                tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            }
        });
        (format!("http://{address}"), handle)
    }

    /// The index just past the blank line that ends the head of a request.
    fn head_end(bytes: &[u8]) -> Option<usize> {
        bytes
            .windows(4)
            .position(|window| window == b"\r\n\r\n")
            .map(|index| index + 4)
    }

    /// The length the `content-length` header of a received request names.
    fn content_length(bytes: &[u8]) -> usize {
        String::from_utf8_lossy(bytes)
            .lines()
            .find_map(|line| {
                let (name, value) = line.split_once(':')?;
                if !name.trim().eq_ignore_ascii_case("content-length") {
                    return None;
                }
                value.trim().parse().ok()
            })
            .unwrap_or(0)
    }

    /// Whether the bytes carry the text, byte for byte.
    fn carries(bytes: &[u8], text: &str) -> bool {
        bytes
            .windows(text.len())
            .any(|window| window == text.as_bytes())
    }

    /// A server that reads the whole request, body included, and answers with
    /// a stream of one token.
    ///
    /// It hands back the bytes it received, so a test reads what reached the
    /// wire instead of what the client meant to send. Every read is capped in
    /// time, so a client that never sends the body fails the test instead of
    /// hanging the suite.
    async fn recording_server() -> (String, tokio::task::JoinHandle<Vec<u8>>) {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("the recording server binds a port");
        let address = listener
            .local_addr()
            .expect("the recording server has an address");
        let handle = tokio::spawn(async move {
            let (mut socket, _) = listener
                .accept()
                .await
                .expect("the recording server accepts a connection");
            let mut received: Vec<u8> = Vec::new();
            let mut buffer = [0_u8; 1024];

            while head_end(&received).is_none() {
                let read = tokio::time::timeout(Duration::from_secs(2), socket.read(&mut buffer))
                    .await
                    .expect("the head of the request arrives in time")
                    .expect("the recording server reads the head");
                if read == 0 {
                    break;
                }
                received.extend_from_slice(&buffer[..read]);
            }

            let end = head_end(&received).unwrap_or(received.len());
            let length = content_length(&received);
            while received.len() < end + length {
                let read = tokio::time::timeout(Duration::from_secs(2), socket.read(&mut buffer))
                    .await
                    .expect("the body of the request arrives in time")
                    .expect("the recording server reads the body");
                if read == 0 {
                    break;
                }
                received.extend_from_slice(&buffer[..read]);
            }

            let body = "data: {\"choices\":[{\"delta\":{\"content\":\"Hi\"}}]}\n\ndata: [DONE]\n\n";
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\n\r\n{body}",
                body.len()
            );
            socket
                .write_all(response.as_bytes())
                .await
                .expect("the recording server answers");
            socket.flush().await.ok();
            received
        });
        (format!("http://{address}"), handle)
    }

    #[tokio::test]
    async fn the_bytes_that_reach_the_server_carry_the_prompt_and_the_messages() {
        let prompt = "refactor the parser of the tree";
        let message = "you are Arrow, the editor";

        for provider in PROVIDERS {
            let (address, server) = recording_server().await;
            let request = AiRequest {
                prompt: prompt.to_string(),
                context: vec![ContextItem::new(ContextRole::System, message)],
                ..request_for(provider)
            };

            stream_to(&request, KEY, |_event| {}, &endpoints_at(&address))
                .await
                .expect("the request succeeds");

            let received = server.await.expect("the recording server task ends");
            let end = head_end(&received).expect("the server received a head");
            let head = String::from_utf8_lossy(&received[..end]).to_ascii_lowercase();
            let body = &received[end..];

            assert!(
                !body.is_empty(),
                "the request of {provider:?} carries a body: {:?}",
                String::from_utf8_lossy(body)
            );
            assert!(
                carries(body, prompt),
                "the body of {provider:?} carries the prompt: {:?}",
                String::from_utf8_lossy(body)
            );
            assert!(
                carries(body, message),
                "the body of {provider:?} carries the message: {:?}",
                String::from_utf8_lossy(body)
            );
            assert!(
                head.contains("content-type: application/json"),
                "the request of {provider:?} is JSON: {head}"
            );
            assert!(
                !carries(body, KEY),
                "the body of {provider:?} carries no key: {:?}",
                String::from_utf8_lossy(body)
            );
        }
    }

    /// The endpoints that point every provider at the given address.
    fn endpoints_at(address: &str) -> Endpoints {
        Endpoints {
            anthropic: address.to_string(),
            openai: address.to_string(),
            google: address.to_string(),
        }
    }

    /// The events a stream carried.
    fn events_of(events: &Arc<Mutex<Vec<AiEvent>>>) -> Vec<AiEvent> {
        events.lock().expect("the lock is free").clone()
    }

    #[tokio::test]
    async fn a_stream_of_tokens_reaches_the_sink() {
        let (address, server) = mock_server(
            "200 OK",
            "text/event-stream",
            &[
                "data: {\"choices\":[{\"delta\":{\"content\":\"Hel\"}}]}\n\n\
                 data: {\"choices\":[{\"delta\":{\"content\":\"lo\"}}]}\n\n\
                 data: [DONE]\n\n",
            ],
        )
        .await;

        let events = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&events);
        let result = stream_to(
            &request(),
            KEY,
            move |event| {
                sink.lock().expect("the lock is free").push(event);
            },
            &endpoints_at(&address),
        )
        .await;

        result.expect("the request succeeds");
        assert_eq!(
            events_of(&events),
            vec![
                AiEvent::Token {
                    text: "Hel".to_string()
                },
                AiEvent::Token {
                    text: "lo".to_string()
                },
                AiEvent::Complete,
            ]
        );
        server.await.ok();
    }

    #[tokio::test]
    async fn a_token_that_the_server_split_in_two_reaches_the_sink_as_one_token() {
        let (address, server) = mock_server(
            "200 OK",
            "text/event-stream",
            &[
                "data: {\"choices\":[{\"delta\":{\"content\":\"Hel",
                "lo\"}}]}\n\ndata: [DONE]\n\n",
            ],
        )
        .await;

        let events = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&events);
        stream_to(
            &request(),
            KEY,
            move |event| {
                sink.lock().expect("the lock is free").push(event);
            },
            &endpoints_at(&address),
        )
        .await
        .expect("the request succeeds");

        assert_eq!(
            events_of(&events),
            vec![
                AiEvent::Token {
                    text: "Hello".to_string()
                },
                AiEvent::Complete,
            ]
        );
        server.await.ok();
    }

    #[tokio::test]
    async fn a_failed_request_never_shows_the_key() {
        let body = format!("{{\"error\":{{\"message\":\"the key {KEY} was refused\"}}}}");
        let (address, server) = mock_server("401 Unauthorized", "application/json", &[&body]).await;

        let error = stream_to(&request(), KEY, |_event| {}, &endpoints_at(&address))
            .await
            .expect_err("the request fails");

        let formatted = format!("{error} {error:?}");
        assert!(
            !formatted.contains(KEY),
            "the key is not in the error: {formatted}"
        );
        assert!(
            formatted.contains("[redacted]"),
            "the message of the provider is kept: {formatted}"
        );
        assert_eq!(error.provider(), "openai");
        server.await.ok();
    }

    #[tokio::test]
    async fn a_request_that_never_reaches_the_server_fails_without_the_key() {
        // The port is closed, so the request never leaves the machine.
        let endpoints = endpoints_at("http://127.0.0.1:1");

        let error = stream_to(&request(), KEY, |_event| {}, &endpoints)
            .await
            .expect_err("the request fails");

        let formatted = format!("{error} {error:?}");
        assert!(
            !formatted.contains(KEY),
            "the key is not in the error: {formatted}"
        );
    }

    #[tokio::test]
    async fn an_override_sends_the_request_to_a_server_on_this_machine() {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("the server binds a port");
        let address = listener.local_addr().expect("the server has an address");
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.expect("the server accepts");
            let mut head = String::new();
            let mut buffer = [0_u8; 4096];
            while !head.contains("\r\n\r\n") {
                let read = socket.read(&mut buffer).await.expect("the server reads");
                if read == 0 {
                    break;
                }
                head.push_str(&String::from_utf8_lossy(&buffer[..read]));
            }

            let body = "data: {\"choices\":[{\"delta\":{\"content\":\"Hi\"}}]}\n\ndata: [DONE]\n\n";
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\n\r\n{body}",
                body.len()
            );
            socket
                .write_all(response.as_bytes())
                .await
                .expect("the server answers");
            socket.flush().await.ok();
            head
        });

        let base = format!("http://{address}");
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&events);
        stream_to(
            &request(),
            KEY,
            move |event| {
                sink.lock().expect("the lock is free").push(event);
            },
            &Endpoints::from_override(Some(&base)),
        )
        .await
        .expect("the request reaches the server on this machine");

        let head = server.await.expect("the server task ends");
        assert!(
            head.starts_with("POST /v1/chat/completions HTTP/1.1\r\n"),
            "the request goes to the path of the provider: {head}"
        );
        assert!(
            head.to_ascii_lowercase()
                .contains(&format!("authorization: bearer {KEY}")),
            "the key goes to the server on this machine: {head}"
        );
        assert_eq!(
            events_of(&events),
            vec![
                AiEvent::Token {
                    text: "Hi".to_string()
                },
                AiEvent::Complete,
            ]
        );
    }

    /// The three providers, in the order the tests check them.
    const PROVIDERS: [Provider; 3] = [Provider::Anthropic, Provider::OpenAi, Provider::Google];

    /// The url a request of the provider carries when no override is in force.
    fn provider_request_url(provider: Provider) -> &'static str {
        match provider {
            Provider::Anthropic => "https://api.anthropic.com/v1/messages",
            Provider::OpenAi => "https://api.openai.com/v1/chat/completions",
            Provider::Google => {
                "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse"
            }
        }
    }

    #[test]
    fn the_override_points_every_provider_at_the_local_server() {
        let base = "http://127.0.0.1:8787";
        let endpoints = Endpoints::from_override(Some(base));

        for provider in PROVIDERS {
            assert_eq!(endpoints.base_for(provider), base);
        }

        let anthropic = providers::build_request_at(
            &request_for(Provider::Anthropic),
            KEY,
            endpoints.base_for(Provider::Anthropic),
        );
        assert_eq!(anthropic.url(), "http://127.0.0.1:8787/v1/messages");
        assert_eq!(anthropic.header("x-api-key"), Some(KEY));

        let openai = providers::build_request_at(
            &request_for(Provider::OpenAi),
            KEY,
            endpoints.base_for(Provider::OpenAi),
        );
        assert_eq!(openai.url(), "http://127.0.0.1:8787/v1/chat/completions");
        assert_eq!(
            openai.header("authorization").map(str::to_string),
            Some(format!("Bearer {KEY}"))
        );

        let google = providers::build_request_at(
            &request_for(Provider::Google),
            KEY,
            endpoints.base_for(Provider::Google),
        );
        assert_eq!(
            google.url(),
            "http://127.0.0.1:8787/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse"
        );
        assert_eq!(google.header("x-goog-api-key"), Some(KEY));
    }

    #[test]
    fn an_override_that_is_not_a_loopback_host_is_ignored() {
        let elsewhere = [
            "https://api.anthropic.com",
            "https://evil.example",
            "http://10.0.0.5:8080",
            "http://169.254.169.254",
            "http://127.0.0.1.evil.example",
            "http://localhost.evil.example",
            "http://127.0.0.1@evil.example",
            "",
            "not a url",
            "file:///etc/passwd",
        ];

        for value in elsewhere {
            let endpoints = Endpoints::from_override(Some(value));
            assert_eq!(
                endpoints,
                Endpoints::default(),
                "the override {value:?} is ignored"
            );

            for provider in PROVIDERS {
                let parts = providers::build_request_at(
                    &request_for(provider),
                    KEY,
                    endpoints.base_for(provider),
                );
                assert_eq!(
                    parts.url(),
                    provider_request_url(provider),
                    "the request of {provider:?} stays at the provider after {value:?}"
                );
            }
        }
    }

    #[test]
    fn the_environment_variable_is_the_override() {
        // This is the only test that touches the variable, and it holds it for
        // as short a time as it can.
        std::env::set_var(BASE_URL_VAR, "http://127.0.0.1:8787");
        let loopback = Endpoints::from_env();
        std::env::set_var(BASE_URL_VAR, "https://evil.example");
        let elsewhere = Endpoints::from_env();
        std::env::remove_var(BASE_URL_VAR);

        assert_eq!(loopback.base_for(Provider::OpenAi), "http://127.0.0.1:8787");
        assert_eq!(elsewhere, Endpoints::default());
        assert_eq!(BASE_URL_VAR, "ARROW_AI_BASE_URL");
    }

    #[test]
    fn only_the_three_named_loopback_hosts_are_honored() {
        let honored = [
            "http://127.0.0.1:8787",
            "http://[::1]:8787",
            "http://localhost:8787",
            "http://LOCALHOST:8787",
            "http://[0:0:0:0:0:0:0:1]:8787",
        ];
        for value in honored {
            assert_eq!(
                Endpoints::from_override(Some(value)).base_for(Provider::OpenAi),
                value,
                "the override {value:?} is honored"
            );
        }

        let not_honored = [
            "http://127.0.0.2:8787",
            "http://[::2]:8787",
            "http://localhost.:8787",
            "http://0.0.0.0:8787",
        ];
        for value in not_honored {
            assert_eq!(
                Endpoints::from_override(Some(value)),
                Endpoints::default(),
                "the override {value:?} is not one of the three hosts"
            );
        }
    }
}
