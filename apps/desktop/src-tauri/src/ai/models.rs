//! The request model of the AI client, the events it produces, and the
//! registry of the models it can address.
//!
//! The client talks to three providers and they do not speak the same
//! dialect. Everything that leaves this module has one shape: a request with
//! a provider, a model, a prompt and a context, and a stream of events that
//! carry a token, a completion or an error. The dialects live in
//! `ai/providers/`, and they turn into this shape there.
//!
//! The key never appears in this module. A request carries no key, so a
//! request that is logged, printed or put in an error cannot leak one.

use std::fmt;

/// The providers the client can talk to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Provider {
    /// The Anthropic messages API.
    Anthropic,
    /// The OpenAI chat completions API.
    OpenAi,
    /// The Google Gemini API.
    Google,
}

impl Provider {
    /// The name the settings and the logs use.
    pub fn as_str(self) -> &'static str {
        match self {
            Provider::Anthropic => "anthropic",
            Provider::OpenAi => "openai",
            Provider::Google => "google",
        }
    }
}

/// One model the client can address.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ModelInfo {
    /// The id the provider knows the model by.
    pub id: &'static str,
    /// The provider that serves the model.
    pub provider: Provider,
    /// The name the settings show.
    pub label: &'static str,
    /// The number of tokens the model reads in one request.
    pub context_window: u32,
    /// The largest number of tokens the model writes in one answer.
    pub max_output_tokens: u32,
}

/// The models Arrow offers out of the box.
///
/// The registry is the list the settings offer. A model that is not in it
/// can still be sent: the provider decides which ids it serves, and the
/// registry only knows the ones Arrow offers. The numbers are the limits the
/// providers publish, and they are the budget the context builder spends.
pub const MODELS: [ModelInfo; 8] = [
    ModelInfo {
        id: "claude-sonnet-4-5",
        provider: Provider::Anthropic,
        label: "Claude Sonnet 4.5",
        context_window: 200_000,
        max_output_tokens: 8_192,
    },
    ModelInfo {
        id: "claude-opus-4-1",
        provider: Provider::Anthropic,
        label: "Claude Opus 4.1",
        context_window: 200_000,
        max_output_tokens: 32_000,
    },
    ModelInfo {
        id: "claude-haiku-4-5",
        provider: Provider::Anthropic,
        label: "Claude Haiku 4.5",
        context_window: 200_000,
        max_output_tokens: 8_192,
    },
    ModelInfo {
        id: "gpt-4o",
        provider: Provider::OpenAi,
        label: "GPT-4o",
        context_window: 128_000,
        max_output_tokens: 16_384,
    },
    ModelInfo {
        id: "gpt-4o-mini",
        provider: Provider::OpenAi,
        label: "GPT-4o mini",
        context_window: 128_000,
        max_output_tokens: 16_384,
    },
    ModelInfo {
        id: "o3-mini",
        provider: Provider::OpenAi,
        label: "o3-mini",
        context_window: 200_000,
        max_output_tokens: 100_000,
    },
    ModelInfo {
        id: "gemini-2.0-flash",
        provider: Provider::Google,
        label: "Gemini 2.0 Flash",
        context_window: 1_048_576,
        max_output_tokens: 8_192,
    },
    ModelInfo {
        id: "gemini-2.5-pro",
        provider: Provider::Google,
        label: "Gemini 2.5 Pro",
        context_window: 1_048_576,
        max_output_tokens: 65_536,
    },
];

/// Every model the client knows.
pub fn registry() -> &'static [ModelInfo] {
    &MODELS
}

/// The models of one provider, in the order the settings show them.
pub fn models_for(provider: Provider) -> Vec<&'static ModelInfo> {
    MODELS
        .iter()
        .filter(|model| model.provider == provider)
        .collect()
}

/// The model with this id, whatever provider serves it.
pub fn find_model(id: &str) -> Option<&'static ModelInfo> {
    MODELS.iter().find(|model| model.id == id)
}

/// The model with this id, when the provider serves it.
pub fn find_model_for(provider: Provider, id: &str) -> Option<&'static ModelInfo> {
    MODELS
        .iter()
        .find(|model| model.provider == provider && model.id == id)
}

/// The model the settings offer first for a provider.
pub fn default_model(provider: Provider) -> Option<&'static ModelInfo> {
    models_for(provider).into_iter().next()
}

/// The number of tokens an answer may hold when the request names no budget.
pub const DEFAULT_OUTPUT_TOKENS: u32 = 4_096;

/// The role a turn of the conversation has.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ContextRole {
    /// The instruction that frames the whole conversation.
    System,
    /// A turn the user wrote.
    User,
    /// A turn the model wrote.
    Assistant,
}

impl ContextRole {
    /// The name the wire format of every provider uses for the role.
    pub fn as_str(self) -> &'static str {
        match self {
            ContextRole::System => "system",
            ContextRole::User => "user",
            ContextRole::Assistant => "assistant",
        }
    }
}

/// One turn of the conversation, or one piece of the context of the editor.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContextItem {
    /// The role the turn has.
    pub role: ContextRole,
    /// The text of the turn.
    pub text: String,
}

impl ContextItem {
    /// A turn of the given role.
    pub fn new(role: ContextRole, text: impl Into<String>) -> Self {
        Self {
            role,
            text: text.into(),
        }
    }
}

/// The request of one answer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AiRequest {
    /// The provider that answers the request.
    pub provider: Provider,
    /// The id of the model that answers it.
    pub model: String,
    /// The instruction of the user.
    pub prompt: String,
    /// The turns and the context that go with the instruction.
    pub context: Vec<ContextItem>,
    /// The largest number of tokens the answer may hold.
    pub max_output_tokens: u32,
}

impl AiRequest {
    /// The budget of the answer.
    ///
    /// A request that names no budget gets the budget of the model, and a
    /// model the registry does not know gets the default. A request that
    /// names a budget of zero would ask the provider for nothing, so zero
    /// means "the budget of the model".
    pub fn output_budget(&self) -> u32 {
        if self.max_output_tokens > 0 {
            return self.max_output_tokens;
        }
        find_model_for(self.provider, &self.model)
            .map(|model| model.max_output_tokens)
            .unwrap_or(DEFAULT_OUTPUT_TOKENS)
    }
}

/// One event of a stream of an answer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AiEvent {
    /// A piece of the answer.
    Token { text: String },
    /// The answer is complete.
    Complete,
    /// The provider reported a failure.
    Error { message: String },
}

impl AiEvent {
    /// The text of the event, when it carries one.
    pub fn text(&self) -> &str {
        match self {
            AiEvent::Token { text } => text,
            _ => "",
        }
    }

    /// The message of the event, when it is an error.
    pub fn error_message(&self) -> Option<&str> {
        match self {
            AiEvent::Error { message } => Some(message),
            _ => None,
        }
    }

    /// True when the answer is complete.
    pub fn is_complete(&self) -> bool {
        matches!(self, AiEvent::Complete)
    }
}

/// The failure of one request.
///
/// The error never carries the key. The provider is named, the status is
/// named, and the message is the one the provider sent with every part of
/// the key taken out of it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AiError {
    /// The request never reached the provider.
    Transport {
        /// The provider the request was for.
        provider: &'static str,
        /// What the transport said.
        message: String,
    },
    /// The provider answered with a status that is not a success.
    Status {
        /// The provider the request was for.
        provider: &'static str,
        /// The status the provider answered with.
        status: u16,
        /// The body the provider answered with.
        message: String,
    },
    /// The provider answered with a body the client cannot read.
    Protocol {
        /// The provider the request was for.
        provider: &'static str,
        /// What the client could not read.
        message: String,
    },
}

impl AiError {
    /// The provider the request was for.
    pub fn provider(&self) -> &'static str {
        match self {
            AiError::Transport { provider, .. }
            | AiError::Status { provider, .. }
            | AiError::Protocol { provider, .. } => provider,
        }
    }
}

impl fmt::Display for AiError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AiError::Transport { provider, message } => {
                write!(formatter, "the {provider} request never arrived: {message}")
            }
            AiError::Status {
                provider,
                status,
                message,
            } => write!(
                formatter,
                "the {provider} request failed with the status {status}: {message}"
            ),
            AiError::Protocol { provider, message } => write!(
                formatter,
                "the {provider} answer could not be read: {message}"
            ),
        }
    }
}

impl std::error::Error for AiError {}

/// The message with every part of the key taken out of it.
///
/// A provider that answers with an error may repeat the key it was given in
/// the body of the answer, and the body of the answer becomes the message of
/// the error. This function takes the key out of a message, so the key
/// cannot reach a log, a window or a report.
pub fn redact(message: &str, key: &str) -> String {
    if key.is_empty() {
        return message.to_string();
    }
    message.replace(key, "[redacted]")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_registry_holds_a_model_of_every_provider() {
        for provider in [Provider::Anthropic, Provider::OpenAi, Provider::Google] {
            let models = models_for(provider);
            assert!(!models.is_empty(), "{provider:?} has no model");
            assert!(
                models.iter().all(|model| model.provider == provider),
                "the models of {provider:?} belong to it"
            );
        }
    }

    #[test]
    fn a_model_is_found_by_its_id_and_by_its_provider() {
        let model = find_model("gpt-4o").expect("the registry knows gpt-4o");
        assert_eq!(model.provider, Provider::OpenAi);
        assert_eq!(find_model_for(Provider::OpenAi, "gpt-4o"), Some(model));
        assert_eq!(find_model_for(Provider::Anthropic, "gpt-4o"), None);
        assert!(find_model("no-such-model").is_none());
    }

    #[test]
    fn every_model_of_the_registry_names_a_budget_and_a_window() {
        for model in registry() {
            assert!(model.max_output_tokens > 0, "{} has no budget", model.id);
            assert!(model.context_window > 0, "{} has no window", model.id);
        }
    }

    #[test]
    fn a_request_that_names_no_budget_gets_the_budget_of_the_model() {
        let request = AiRequest {
            provider: Provider::OpenAi,
            model: "gpt-4o".to_string(),
            prompt: "hello".to_string(),
            context: Vec::new(),
            max_output_tokens: 0,
        };
        assert_eq!(request.output_budget(), 16_384);
    }

    #[test]
    fn a_request_that_names_a_budget_keeps_it() {
        let request = AiRequest {
            provider: Provider::OpenAi,
            model: "gpt-4o".to_string(),
            prompt: "hello".to_string(),
            context: Vec::new(),
            max_output_tokens: 512,
        };
        assert_eq!(request.output_budget(), 512);
    }

    #[test]
    fn the_key_is_taken_out_of_a_message() {
        let message = "the key sk-ant-secret was refused";
        let redacted = redact(message, "sk-ant-secret");
        assert!(!redacted.contains("sk-ant-secret"));
        assert!(redacted.contains("[redacted]"));
    }

    #[test]
    fn an_empty_key_leaves_the_message_alone() {
        assert_eq!(redact("nothing to hide", ""), "nothing to hide");
    }
}
