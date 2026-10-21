//! The OpenAI chat completions endpoint.
//!
//! OpenAI streams Server-Sent Events whose payload carries the pieces of
//! the answer in `choices`. A token arrives in the `content` of a `delta`,
//! the end of the answer arrives in the `finish_reason` of a choice, and the
//! stream ends with the sentinel `[DONE]`.

use serde_json::{json, Value};

use crate::ai::models::{AiEvent, AiRequest};
use crate::ai::providers::HttpRequestParts;
use crate::ai::stream::data_payload;

/// The address of the OpenAI API.
pub const BASE_URL: &str = "https://api.openai.com";

/// The sentinel that closes the stream of OpenAI.
pub const DONE: &str = "[DONE]";

/// The request for the OpenAI chat completions endpoint.
pub fn build_request(req: &AiRequest, key: &str) -> HttpRequestParts {
    build_request_at(req, key, BASE_URL)
}

/// The request for the OpenAI chat completions endpoint, against the given base url.
pub fn build_request_at(req: &AiRequest, key: &str, base_url: &str) -> HttpRequestParts {
    let mut messages: Vec<Value> = req
        .context
        .iter()
        .map(|item| json!({ "role": item.role.as_str(), "content": item.text }))
        .collect();
    messages.push(json!({ "role": "user", "content": req.prompt }));

    let body = json!({
        "model": req.model,
        "max_tokens": req.output_budget(),
        "messages": messages,
        "stream": true,
    });

    HttpRequestParts {
        method: "POST",
        url: format!("{}/v1/chat/completions", base_url.trim_end_matches('/')),
        headers: vec![
            ("authorization".to_string(), format!("Bearer {key}")),
            ("content-type".to_string(), "application/json".to_string()),
        ],
        body: serde_json::to_string(&body).expect("the body of a request is JSON"),
    }
}

/// The events of one raw chunk of the OpenAI stream.
pub fn normalize(chunk: &str) -> Vec<AiEvent> {
    match data_payload(chunk) {
        Some(payload) => normalize_payload(&payload),
        None => Vec::new(),
    }
}

/// The events of one payload of the OpenAI stream.
pub fn normalize_payload(payload: &str) -> Vec<AiEvent> {
    let trimmed = payload.trim();
    if trimmed == DONE {
        return vec![AiEvent::Complete];
    }

    let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
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

    let Some(choice) = value.pointer("/choices/0") else {
        return Vec::new();
    };

    let mut events = Vec::new();
    if let Some(text) = choice.pointer("/delta/content").and_then(Value::as_str) {
        if !text.is_empty() {
            events.push(AiEvent::Token {
                text: text.to_string(),
            });
        }
    }
    if choice
        .get("finish_reason")
        .and_then(Value::as_str)
        .is_some()
    {
        events.push(AiEvent::Complete);
    }
    events
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::models::{ContextItem, ContextRole, Provider};

    /// A request with one system turn and a prompt.
    fn request() -> AiRequest {
        AiRequest {
            provider: Provider::OpenAi,
            model: "gpt-4o".to_string(),
            prompt: "refactor this".to_string(),
            context: vec![ContextItem::new(ContextRole::System, "you are Arrow")],
            max_output_tokens: 256,
        }
    }

    #[test]
    fn the_request_goes_to_the_chat_completions_endpoint_with_the_key() {
        let parts = build_request(&request(), "sk-openai-the-key");

        assert_eq!(parts.method, "POST");
        assert_eq!(parts.url, "https://api.openai.com/v1/chat/completions");
        assert_eq!(
            parts.header("authorization"),
            Some("Bearer sk-openai-the-key")
        );
        assert_eq!(parts.header("content-type"), Some("application/json"));
    }

    #[test]
    fn the_body_carries_the_model_the_budget_and_the_turns() {
        let body: Value =
            serde_json::from_str(&build_request(&request(), "sk-openai-the-key").body)
                .expect("the body is JSON");

        assert_eq!(body["model"], "gpt-4o");
        assert_eq!(body["max_tokens"], 256);
        assert_eq!(body["stream"], true);

        let messages = body["messages"]
            .as_array()
            .expect("the body carries messages");
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0]["role"], "system");
        assert_eq!(messages[0]["content"], "you are Arrow");
        assert_eq!(messages[1]["role"], "user");
        assert_eq!(messages[1]["content"], "refactor this");
    }

    #[test]
    fn the_base_url_can_point_at_another_server() {
        let parts = build_request_at(&request(), "sk-openai-the-key", "http://127.0.0.1:8080/");
        assert_eq!(parts.url, "http://127.0.0.1:8080/v1/chat/completions");
    }

    #[test]
    fn a_delta_becomes_a_token() {
        let chunk = "data: {\"id\":\"chatcmpl-1\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"Hello\"}}]}\n\n";

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
            "data: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n";

        assert_eq!(normalize(chunk), vec![AiEvent::Complete]);
    }

    #[test]
    fn the_sentinel_becomes_a_completion() {
        assert_eq!(normalize("data: [DONE]\n\n"), vec![AiEvent::Complete]);
    }

    #[test]
    fn an_error_becomes_an_error() {
        let chunk = "data: {\"error\":{\"message\":\"the model is overloaded\",\"type\":\"server_error\"}}\n\n";

        assert_eq!(
            normalize(chunk),
            vec![AiEvent::Error {
                message: "the model is overloaded".to_string()
            }]
        );
    }

    #[test]
    fn a_chunk_that_carries_no_data_is_silence() {
        assert!(normalize(": keep alive\n\n").is_empty());
        assert!(normalize("").is_empty());
    }
}
