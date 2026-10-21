//! The three providers, and the one shape their streams become.
//!
//! Every provider gets the same request and answers in its own dialect. The
//! module of a provider knows two things: how to build the request that
//! provider expects, and how to read the events that provider sends. Both
//! are pure functions, and both are covered by unit tests, so a change in a
//! wire format fails a test and not a user.

pub mod anthropic;
pub mod google;
pub mod openai;

use serde_json::Value;

use crate::ai::models::{AiEvent, AiRequest, Provider};

/// The parts of one HTTP request.
///
/// The client sends the parts as they are, so a provider cannot change the
/// request behind the back of the client.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HttpRequestParts {
    /// The method of the request.
    pub method: &'static str,
    /// The url the request goes to.
    pub url: String,
    /// The headers of the request, in the order they are sent.
    pub headers: Vec<(String, String)>,
    /// The body of the request.
    pub body: String,
}

impl HttpRequestParts {
    /// The value of the header with this name, when the request carries one.
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }
}

/// The request for the provider of the request.
pub fn build_request(req: &AiRequest, key: &str) -> HttpRequestParts {
    match req.provider {
        Provider::Anthropic => anthropic::build_request(req, key),
        Provider::OpenAi => openai::build_request(req, key),
        Provider::Google => google::build_request(req, key),
    }
}

/// The request for the provider of the request, against the given base url.
///
/// The base url is the address of the provider. A test points it at a mock
/// server, and the client uses it to reach a server that stands in for the
/// provider.
pub fn build_request_at(req: &AiRequest, key: &str, base_url: &str) -> HttpRequestParts {
    match req.provider {
        Provider::Anthropic => anthropic::build_request_at(req, key, base_url),
        Provider::OpenAi => openai::build_request_at(req, key, base_url),
        Provider::Google => google::build_request_at(req, key, base_url),
    }
}

/// The wire format a payload arrived in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WireFormat {
    /// The Anthropic messages stream.
    Anthropic,
    /// The OpenAI chat completions stream.
    OpenAi,
    /// The Google Gemini stream.
    Google,
}

/// The types the Anthropic stream uses.
const ANTHROPIC_TYPES: [&str; 8] = [
    "message_start",
    "message_delta",
    "message_stop",
    "content_block_start",
    "content_block_delta",
    "content_block_stop",
    "ping",
    "error",
];

/// The format of a payload, read from the fields it carries.
///
/// The three formats are told apart by the fields they hold, so the reader
/// of a stream does not have to be told which provider it is reading.
pub fn sniff(payload: &str) -> Option<WireFormat> {
    let value: Value = serde_json::from_str(payload.trim()).ok()?;
    let object = value.as_object()?;

    if object.contains_key("choices") {
        return Some(WireFormat::OpenAi);
    }
    if object.contains_key("candidates") {
        return Some(WireFormat::Google);
    }
    if let Some(kind) = object.get("type").and_then(Value::as_str) {
        if ANTHROPIC_TYPES.contains(&kind) {
            return Some(WireFormat::Anthropic);
        }
    }
    None
}

/// The events of one payload, whatever provider sent it.
///
/// A payload that no provider owns is still read for an error, because a
/// provider that fails in a way nobody expected must not look like silence.
pub fn normalize_payload(payload: &str) -> Vec<AiEvent> {
    let trimmed = payload.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }
    if trimmed == "[DONE]" {
        return vec![AiEvent::Complete];
    }

    match sniff(trimmed) {
        Some(WireFormat::Anthropic) => anthropic::normalize_payload(trimmed),
        Some(WireFormat::OpenAi) => openai::normalize_payload(trimmed),
        Some(WireFormat::Google) => google::normalize_payload(trimmed),
        None => match error_message(trimmed) {
            Some(message) => vec![AiEvent::Error { message }],
            None => Vec::new(),
        },
    }
}

/// The message of the error a payload carries, when it carries one.
pub fn error_message(payload: &str) -> Option<String> {
    let value: Value = serde_json::from_str(payload.trim()).ok()?;
    let error = value.get("error")?;
    let message = error
        .get("message")
        .and_then(Value::as_str)
        .or_else(|| error.as_str())?;
    Some(message.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_parts_of_a_request_carry_their_header_in_any_case() {
        let parts = HttpRequestParts {
            method: "POST",
            url: "https://example.test/v1/messages".to_string(),
            headers: vec![("X-Api-Key".to_string(), "the-key".to_string())],
            body: "{}".to_string(),
        };
        assert_eq!(parts.header("x-api-key"), Some("the-key"));
        assert_eq!(parts.header("X-API-KEY"), Some("the-key"));
        assert_eq!(parts.header("authorization"), None);
    }

    #[test]
    fn a_payload_is_told_apart_by_the_fields_it_carries() {
        assert_eq!(
            sniff(r#"{"type":"content_block_delta","delta":{"text":"hi"}}"#),
            Some(WireFormat::Anthropic)
        );
        assert_eq!(
            sniff(r#"{"choices":[{"delta":{"content":"hi"}}]}"#),
            Some(WireFormat::OpenAi)
        );
        assert_eq!(
            sniff(r#"{"candidates":[{"content":{"parts":[{"text":"hi"}]}}]}"#),
            Some(WireFormat::Google)
        );
        assert_eq!(sniff(r#"{"nothing":"known"}"#), None);
        assert_eq!(sniff("not json at all"), None);
    }

    #[test]
    fn the_sentinel_of_an_openai_stream_is_a_completion() {
        assert_eq!(normalize_payload("[DONE]"), vec![AiEvent::Complete]);
    }

    #[test]
    fn a_payload_that_no_provider_owns_still_reports_an_error() {
        let events = normalize_payload(r#"{"error":{"message":"the model is on fire"}}"#);
        assert_eq!(
            events,
            vec![AiEvent::Error {
                message: "the model is on fire".to_string()
            }]
        );
    }

    #[test]
    fn an_empty_payload_is_silence() {
        assert!(normalize_payload("").is_empty());
        assert!(normalize_payload("   ").is_empty());
    }
}
