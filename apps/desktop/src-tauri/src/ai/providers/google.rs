//! The Google Gemini endpoint.
//!
//! Gemini streams Server-Sent Events whose payload carries the pieces of
//! the answer in `candidates`. A token arrives in the `text` of a `part`,
//! the end of the answer arrives in the `finishReason` of a candidate, and
//! a failure arrives in an `error`.
//!
//! Gemini names the two roles of a conversation `user` and `model`, so the
//! role of the assistant becomes `model` here.

use serde_json::{json, Value};

use crate::ai::models::{AiEvent, AiRequest, ContextRole};
use crate::ai::providers::HttpRequestParts;
use crate::ai::stream::data_payload;

/// The address of the Gemini API.
pub const BASE_URL: &str = "https://generativelanguage.googleapis.com";

/// The request for the Gemini endpoint.
pub fn build_request(req: &AiRequest, key: &str) -> HttpRequestParts {
    build_request_at(req, key, BASE_URL)
}

/// The request for the Gemini endpoint, against the given base url.
pub fn build_request_at(req: &AiRequest, key: &str, base_url: &str) -> HttpRequestParts {
    let system = req
        .context
        .iter()
        .filter(|item| item.role == ContextRole::System)
        .map(|item| item.text.as_str())
        .collect::<Vec<_>>()
        .join("\n\n");

    let mut contents: Vec<Value> = req
        .context
        .iter()
        .filter(|item| item.role != ContextRole::System)
        .map(|item| {
            json!({
                "role": role_of(item.role),
                "parts": [{ "text": item.text }],
            })
        })
        .collect();
    contents.push(json!({
        "role": "user",
        "parts": [{ "text": req.prompt }],
    }));

    let mut body = json!({
        "contents": contents,
        "generationConfig": {
            "maxOutputTokens": req.output_budget(),
        },
    });
    if !system.is_empty() {
        body["systemInstruction"] = json!({ "parts": [{ "text": system }] });
    }

    HttpRequestParts {
        method: "POST",
        url: format!(
            "{}/v1beta/models/{}:streamGenerateContent?alt=sse",
            base_url.trim_end_matches('/'),
            req.model
        ),
        headers: vec![
            ("x-goog-api-key".to_string(), key.to_string()),
            ("content-type".to_string(), "application/json".to_string()),
        ],
        body: serde_json::to_string(&body).expect("the body of a request is JSON"),
    }
}

/// The role Gemini uses for the given role.
fn role_of(role: ContextRole) -> &'static str {
    match role {
        ContextRole::Assistant => "model",
        _ => "user",
    }
}

/// The events of one raw chunk of the Gemini stream.
pub fn normalize(chunk: &str) -> Vec<AiEvent> {
    match data_payload(chunk) {
        Some(payload) => normalize_payload(&payload),
        None => Vec::new(),
    }
}

/// The events of one payload of the Gemini stream.
pub fn normalize_payload(payload: &str) -> Vec<AiEvent> {
    let Ok(value) = serde_json::from_str::<Value>(payload.trim()) else {
        return Vec::new();
    };

    if let Some(error) = value.get("error") {
        let message = error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("the provider reported an error");
        return vec![AiEvent::Error {
            message: message.to_string(),
        }];
    }

    let Some(candidates) = value.get("candidates").and_then(Value::as_array) else {
        return Vec::new();
    };

    let mut events = Vec::new();
    for candidate in candidates {
        if let Some(parts) = candidate
            .pointer("/content/parts")
            .and_then(Value::as_array)
        {
            for part in parts {
                if let Some(text) = part.get("text").and_then(Value::as_str) {
                    if !text.is_empty() {
                        events.push(AiEvent::Token {
                            text: text.to_string(),
                        });
                    }
                }
            }
        }
        if candidate
            .get("finishReason")
            .and_then(Value::as_str)
            .is_some()
        {
            events.push(AiEvent::Complete);
        }
    }
    events
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::models::{ContextItem, Provider};

    /// A request with one system turn, one assistant turn and a prompt.
    fn request() -> AiRequest {
        AiRequest {
            provider: Provider::Google,
            model: "gemini-2.0-flash".to_string(),
            prompt: "refactor this".to_string(),
            context: vec![
                ContextItem::new(ContextRole::System, "you are Arrow"),
                ContextItem::new(ContextRole::Assistant, "what should I change?"),
            ],
            max_output_tokens: 128,
        }
    }

    #[test]
    fn the_request_goes_to_the_model_endpoint_with_the_key() {
        let parts = build_request(&request(), "gemini-the-key");

        assert_eq!(parts.method, "POST");
        assert_eq!(
            parts.url,
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse"
        );
        assert_eq!(parts.header("x-goog-api-key"), Some("gemini-the-key"));
        assert_eq!(parts.header("content-type"), Some("application/json"));
    }

    #[test]
    fn the_body_carries_the_system_the_turns_and_the_budget() {
        let body: Value = serde_json::from_str(&build_request(&request(), "gemini-the-key").body)
            .expect("the body is JSON");

        assert_eq!(
            body["systemInstruction"]["parts"][0]["text"],
            "you are Arrow"
        );
        assert_eq!(body["generationConfig"]["maxOutputTokens"], 128);

        let contents = body["contents"]
            .as_array()
            .expect("the body carries contents");
        assert_eq!(contents.len(), 2);
        assert_eq!(contents[0]["role"], "model");
        assert_eq!(contents[0]["parts"][0]["text"], "what should I change?");
        assert_eq!(contents[1]["role"], "user");
        assert_eq!(contents[1]["parts"][0]["text"], "refactor this");
    }

    #[test]
    fn the_base_url_can_point_at_another_server() {
        let parts = build_request_at(&request(), "gemini-the-key", "http://127.0.0.1:8080");
        assert_eq!(
            parts.url,
            "http://127.0.0.1:8080/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse"
        );
    }

    #[test]
    fn a_part_becomes_a_token() {
        let chunk = "data: {\"candidates\":[{\"content\":{\"role\":\"model\",\"parts\":[{\"text\":\"Hello\"}]}}]}\n\n";

        assert_eq!(
            normalize(chunk),
            vec![AiEvent::Token {
                text: "Hello".to_string()
            }]
        );
    }

    #[test]
    fn the_end_of_the_stream_becomes_a_completion() {
        let chunk =
            "data: {\"candidates\":[{\"finishReason\":\"STOP\",\"content\":{\"parts\":[]}}]}\n\n";

        assert_eq!(normalize(chunk), vec![AiEvent::Complete]);
    }

    #[test]
    fn an_error_becomes_an_error() {
        let chunk = "data: {\"error\":{\"code\":400,\"message\":\"the prompt was refused\",\"status\":\"INVALID_ARGUMENT\"}}\n\n";

        assert_eq!(
            normalize(chunk),
            vec![AiEvent::Error {
                message: "the prompt was refused".to_string()
            }]
        );
    }

    #[test]
    fn a_chunk_that_carries_no_data_is_silence() {
        assert!(normalize(": keep alive\n\n").is_empty());
        assert!(normalize("").is_empty());
    }
}
