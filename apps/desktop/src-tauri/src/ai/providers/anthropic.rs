//! The Anthropic messages endpoint.
//!
//! Anthropic streams Server-Sent Events whose payload names the kind of the
//! event in a `type` field. A token arrives as a `content_block_delta`, the
//! end of the answer arrives as a `message_stop`, and a failure arrives as an
//! `error`.

use serde_json::{json, Value};

use crate::ai::models::{AiEvent, AiRequest, ContextRole};
use crate::ai::providers::HttpRequestParts;
use crate::ai::stream::data_payload;

/// The address of the Anthropic API.
pub const BASE_URL: &str = "https://api.anthropic.com";

/// The version of the API the request speaks.
pub const API_VERSION: &str = "2023-06-01";

/// The request for the Anthropic messages endpoint.
pub fn build_request(req: &AiRequest, key: &str) -> HttpRequestParts {
    build_request_at(req, key, BASE_URL)
}

/// The request for the Anthropic messages endpoint, against the given base url.
pub fn build_request_at(req: &AiRequest, key: &str, base_url: &str) -> HttpRequestParts {
    let system = req
        .context
        .iter()
        .filter(|item| item.role == ContextRole::System)
        .map(|item| item.text.as_str())
        .collect::<Vec<_>>()
        .join("\n\n");

    let mut messages: Vec<Value> = req
        .context
        .iter()
        .filter(|item| item.role != ContextRole::System)
        .map(|item| json!({ "role": item.role.as_str(), "content": item.text }))
        .collect();
    messages.push(json!({ "role": "user", "content": req.prompt }));

    let mut body = json!({
        "model": req.model,
        "max_tokens": req.output_budget(),
        "messages": messages,
        "stream": true,
    });
    if !system.is_empty() {
        body["system"] = json!(system);
    }

    HttpRequestParts {
        method: "POST",
        url: format!("{}/v1/messages", base_url.trim_end_matches('/')),
        headers: vec![
            ("x-api-key".to_string(), key.to_string()),
            ("anthropic-version".to_string(), API_VERSION.to_string()),
            ("content-type".to_string(), "application/json".to_string()),
        ],
        body: serde_json::to_string(&body).expect("the body of a request is JSON"),
    }
}

/// The events of one raw chunk of the Anthropic stream.
pub fn normalize(chunk: &str) -> Vec<AiEvent> {
    match data_payload(chunk) {
        Some(payload) => normalize_payload(&payload),
        None => Vec::new(),
    }
}

/// The events of one payload of the Anthropic stream.
pub fn normalize_payload(payload: &str) -> Vec<AiEvent> {
    let Ok(value) = serde_json::from_str::<Value>(payload.trim()) else {
        return Vec::new();
    };

    match value.get("type").and_then(Value::as_str) {
        Some("content_block_delta") => match value.pointer("/delta/text").and_then(Value::as_str) {
            Some(text) if !text.is_empty() => vec![AiEvent::Token {
                text: text.to_string(),
            }],
            _ => Vec::new(),
        },
        Some("message_stop") => vec![AiEvent::Complete],
        Some("error") => {
            let message = value
                .pointer("/error/message")
                .and_then(Value::as_str)
                .unwrap_or("the provider reported an error");
            vec![AiEvent::Error {
                message: message.to_string(),
            }]
        }
        _ => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::models::ContextItem;

    /// A request with one system turn, one user turn and a prompt.
    fn request() -> AiRequest {
        AiRequest {
            provider: crate::ai::models::Provider::Anthropic,
            model: "claude-sonnet-4-5".to_string(),
            prompt: "refactor this".to_string(),
            context: vec![
                ContextItem::new(ContextRole::System, "you are Arrow"),
                ContextItem::new(ContextRole::Assistant, "what should I change?"),
            ],
            max_output_tokens: 512,
        }
    }

    #[test]
    fn the_request_goes_to_the_messages_endpoint_with_the_key() {
        let parts = build_request(&request(), "sk-ant-the-key");

        assert_eq!(parts.method, "POST");
        assert_eq!(parts.url, "https://api.anthropic.com/v1/messages");
        assert_eq!(parts.header("x-api-key"), Some("sk-ant-the-key"));
        assert_eq!(parts.header("anthropic-version"), Some("2023-06-01"));
        assert_eq!(parts.header("content-type"), Some("application/json"));
    }

    #[test]
    fn the_body_carries_the_model_the_budget_the_system_and_the_turns() {
        let body: Value = serde_json::from_str(&build_request(&request(), "sk-ant-the-key").body)
            .expect("the body is JSON");

        assert_eq!(body["model"], "claude-sonnet-4-5");
        assert_eq!(body["max_tokens"], 512);
        assert_eq!(body["stream"], true);
        assert_eq!(body["system"], "you are Arrow");

        let messages = body["messages"]
            .as_array()
            .expect("the body carries messages");
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0]["role"], "assistant");
        assert_eq!(messages[0]["content"], "what should I change?");
        assert_eq!(messages[1]["role"], "user");
        assert_eq!(messages[1]["content"], "refactor this");
    }

    #[test]
    fn a_request_without_a_system_turn_carries_no_system_field() {
        let mut without_system = request();
        without_system.context.clear();
        let body: Value =
            serde_json::from_str(&build_request(&without_system, "sk-ant-the-key").body)
                .expect("the body is JSON");

        assert!(body.get("system").is_none(), "the body has no system field");
    }

    #[test]
    fn the_base_url_can_point_at_another_server() {
        let parts = build_request_at(&request(), "sk-ant-the-key", "http://127.0.0.1:8080/");
        assert_eq!(parts.url, "http://127.0.0.1:8080/v1/messages");
    }

    #[test]
    fn a_delta_becomes_a_token() {
        let chunk = "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"Hello\"}}\n\n";

        assert_eq!(
            normalize(chunk),
            vec![AiEvent::Token {
                text: "Hello".to_string()
            }]
        );
    }

    #[test]
    fn the_end_of_the_stream_becomes_a_completion() {
        let chunk = "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n";

        assert_eq!(normalize(chunk), vec![AiEvent::Complete]);
    }

    #[test]
    fn an_error_becomes_an_error() {
        let chunk = "event: error\ndata: {\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\",\"message\":\"Overloaded\"}}\n\n";

        assert_eq!(
            normalize(chunk),
            vec![AiEvent::Error {
                message: "Overloaded".to_string()
            }]
        );
    }

    #[test]
    fn a_chunk_that_carries_no_data_is_silence() {
        assert!(normalize("event: ping\n\n").is_empty());
        assert!(normalize("").is_empty());
    }

    #[test]
    fn a_message_start_carries_no_token() {
        let chunk = "data: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_1\"}}\n\n";
        assert!(normalize(chunk).is_empty());
    }
}
