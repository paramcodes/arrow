//! The HTTP client of the AI providers.
//!
//! The client builds the request of a provider, sends it, and turns the
//! stream that comes back into the events of `ai/models.rs`. The key goes
//! into the headers of the request and nowhere else: the client never logs
//! it, never puts it in an error, and never prints it.
//!
//! The client does not store the key and does not read it from the disk. The
//! other half of the session owns the keychain and hands the key over.

use std::time::Duration;

use crate::ai::models::{redact, AiError, AiEvent, AiRequest, Provider};
use crate::ai::providers;
use crate::ai::stream::SseReader;

/// The time the client waits for the connection of a request.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);

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
    /// The address of the provider of the request.
    pub fn base_for(&self, provider: Provider) -> &str {
        match provider {
            Provider::Anthropic => &self.anthropic,
            Provider::OpenAi => &self.openai,
            Provider::Google => &self.google,
        }
    }
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
    stream_to(req, key, sink, &Endpoints::default()).await
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

    let mut builder = client.post(&parts.url);
    for (name, value) in &parts.headers {
        builder = builder.header(name.as_str(), value.as_str());
    }

    let mut response = builder.send().await.map_err(|error| AiError::Transport {
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
}
