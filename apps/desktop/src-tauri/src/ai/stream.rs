//! The reader of a stream of Server-Sent Events.
//!
//! A provider streams its answer as events that arrive in whatever sizes
//! the network chooses. A read can end in the middle of a token, in the
//! middle of a line, or between two events. The reader holds what arrived
//! and gives back an event only when the event is whole, so a token that a
//! read split in two becomes one token and never two halves.
//!
//! The reader is the one place that knows the shape of the stream. The
//! dialects of the providers live in `ai/providers/`, and they turn a
//! payload into events.

use crate::ai::models::AiEvent;
use crate::ai::providers;

/// The events of a stream of Server-Sent Events.
///
/// Every item is a piece of the stream. A piece may hold many lines, one
/// line, or half a line, and the reader holds the half that has no end yet
/// until the next piece arrives.
pub fn parse_sse(lines: impl Iterator<Item = String>) -> Vec<AiEvent> {
    let mut reader = SseReader::new();
    let mut events = Vec::new();
    for line in lines {
        events.extend(reader.push(&line));
    }
    events.extend(reader.finish());
    events
}

/// One field of an event of a stream.
enum Field<'a> {
    /// The data of the event.
    Data(&'a str),
    /// The name of the event.
    Name(&'a str),
    /// A comment, which a server sends to keep the connection open.
    Comment,
    /// A field the client does not read.
    Other,
}

/// The field a line of a stream carries.
fn read_field(line: &str) -> Field<'_> {
    if line.starts_with(':') {
        return Field::Comment;
    }
    match line.split_once(':') {
        Some((name, value)) => {
            let value = value.strip_prefix(' ').unwrap_or(value);
            match name {
                "data" => Field::Data(value),
                "event" => Field::Name(value),
                _ => Field::Other,
            }
        }
        None => Field::Other,
    }
}

/// True when the text starts a field of an event.
///
/// A piece of a stream that starts a field begins a new line, so the line
/// the reader holds was whole. A piece that continues a payload does not,
/// so the line the reader holds was half a line.
fn starts_a_field(text: &str) -> bool {
    text.starts_with("data:")
        || text.starts_with("event:")
        || text.starts_with("id:")
        || text.starts_with("retry:")
        || text.starts_with(':')
}

/// The data of one event, when the event carries any.
///
/// The block is the text of a whole event, with or without the fields that
/// frame it. A block that carries no data field and reads like a payload is
/// that payload.
pub fn data_payload(block: &str) -> Option<String> {
    let mut data = Vec::new();
    for line in block.split('\n') {
        if let Field::Data(value) = read_field(line.trim_end_matches('\r')) {
            data.push(value);
        }
    }
    if data.is_empty() {
        let trimmed = block.trim();
        if trimmed.starts_with('{') || trimmed.starts_with('[') {
            return Some(trimmed.to_string());
        }
        return None;
    }
    Some(data.join("\n"))
}

/// A reader of one stream of Server-Sent Events.
#[derive(Debug, Default)]
pub struct SseReader {
    /// The text of the line that has no end yet.
    line: String,
    /// The data of the event that has no end yet.
    data: Vec<String>,
    /// The name of the event that has no end yet.
    name: Option<String>,
}

impl SseReader {
    /// A reader that has read nothing yet.
    pub fn new() -> Self {
        Self::default()
    }

    /// Feed a piece of the stream and take the events it completed.
    pub fn push(&mut self, fragment: &str) -> Vec<AiEvent> {
        let mut events = Vec::new();
        let mut rest = fragment;

        if !self.line.is_empty() && starts_a_field(rest) {
            let line = std::mem::take(&mut self.line);
            events.extend(self.read_line(&line));
        }

        loop {
            match rest.find('\n') {
                Some(index) => {
                    let piece = &rest[..index];
                    rest = &rest[index + 1..];
                    let line = if self.line.is_empty() {
                        piece.to_string()
                    } else {
                        let mut line = std::mem::take(&mut self.line);
                        line.push_str(piece);
                        line
                    };
                    events.extend(self.read_line(&line));
                }
                None => {
                    self.line.push_str(rest);
                    break;
                }
            }
        }
        events
    }

    /// Take the events of the last event of the stream.
    pub fn finish(&mut self) -> Vec<AiEvent> {
        let mut events = Vec::new();
        if !self.line.is_empty() {
            let line = std::mem::take(&mut self.line);
            events.extend(self.read_line(&line));
        }
        events.extend(self.dispatch());
        events
    }

    /// Read one line of the stream.
    fn read_line(&mut self, line: &str) -> Vec<AiEvent> {
        let line = line.trim_end_matches('\r');
        if line.is_empty() {
            return self.dispatch();
        }
        match read_field(line) {
            Field::Data(value) => {
                self.data.push(value.to_string());
                Vec::new()
            }
            Field::Name(value) => {
                self.name = Some(value.to_string());
                Vec::new()
            }
            Field::Comment => Vec::new(),
            Field::Other => Vec::new(),
        }
    }

    /// Close the event that has no end yet and turn it into events.
    fn dispatch(&mut self) -> Vec<AiEvent> {
        let data = std::mem::take(&mut self.data);
        let name = self.name.take();
        if data.is_empty() {
            return Vec::new();
        }
        let payload = data.join("\n");
        let events = providers::normalize_payload(&payload);
        if events.is_empty() {
            if name.as_deref() == Some("error") {
                return vec![AiEvent::Error { message: payload }];
            }
        }
        events
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The lines of a stream, one per item.
    fn lines(text: &str) -> Vec<String> {
        text.split_inclusive('\n').map(str::to_string).collect()
    }

    #[test]
    fn a_token_that_a_read_split_in_two_becomes_one_token() {
        let events = parse_sse(
            [
                "data: {\"choices\":[{\"delta\":{\"content\":\"Hel".to_string(),
                "lo\"}}]}\n\n".to_string(),
            ]
            .into_iter(),
        );

        assert_eq!(
            events,
            vec![AiEvent::Token {
                text: "Hello".to_string()
            }]
        );
    }

    #[test]
    fn a_token_split_in_the_middle_of_a_line_is_one_token() {
        let mut reader = SseReader::new();
        let mut events = reader.push("data: {\"choices\":[{\"delta\":{\"content\":\"Hel");
        assert!(events.is_empty(), "the token is not whole yet");

        events = reader.push("lo\"}}]}");
        assert!(events.is_empty(), "the event is not closed yet");

        events = reader.push("\n\n");
        assert_eq!(
            events,
            vec![AiEvent::Token {
                text: "Hello".to_string()
            }]
        );
    }

    #[test]
    fn an_event_that_carries_no_data_is_silence() {
        let events = parse_sse(
            lines("event: message_stop\n\ndata: {\"type\":\"message_stop\"}\n\n").into_iter(),
        );

        assert_eq!(events.len(), 1, "only the event with data counts");
        assert_eq!(events[0], AiEvent::Complete);
    }

    #[test]
    fn a_keep_alive_comment_is_silence() {
        let events = parse_sse(lines(": keep alive\n\n: keep alive\n\n").into_iter());

        assert!(events.is_empty());
    }

    #[test]
    fn a_stream_carries_every_event_it_holds() {
        let events = parse_sse(
            lines(
                "data: {\"choices\":[{\"delta\":{\"content\":\"Hel\"}}]}\n\n\
             data: {\"choices\":[{\"delta\":{\"content\":\"lo\"}}]}\n\n\
             data: [DONE]\n\n",
            )
            .into_iter(),
        );

        assert_eq!(
            events,
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
    }

    #[test]
    fn a_line_that_ends_without_a_newline_is_still_read() {
        let events = parse_sse(["data: [DONE]".to_string()].into_iter());

        assert_eq!(events, vec![AiEvent::Complete]);
    }

    #[test]
    fn two_lines_without_a_newline_between_them_are_two_lines() {
        // The first line is whole, and the reader only learns it when the
        // second line arrives and starts a field of its own. Without the
        // split, the reader would hold the first line and join it with the
        // second, and the name of the event would be lost.
        let events = parse_sse(
            [
                "event: message_stop".to_string(),
                "data: {\"type\":\"message_stop\"}\n\n".to_string(),
            ]
            .into_iter(),
        );

        assert_eq!(events, vec![AiEvent::Complete]);
    }

    #[test]
    fn a_comment_does_not_close_the_event_it_arrives_in() {
        let events = parse_sse(
            lines("event: message_delta\n: keep alive\ndata: {\"type\":\"message_delta\"}\n\n")
                .into_iter(),
        );

        assert!(
            events.is_empty(),
            "the delta of a message carries no token: {events:?}"
        );
    }

    #[test]
    fn the_data_of_an_event_is_the_data_of_its_field() {
        assert_eq!(
            data_payload("event: x\ndata: {\"a\":1}\n\n"),
            Some("{\"a\":1}".to_string())
        );
        assert_eq!(data_payload("event: x\n\n"), None);
        assert_eq!(data_payload(": keep alive"), None);
        assert_eq!(
            data_payload("{\"a\":1}"),
            Some("{\"a\":1}".to_string()),
            "a payload without framing is the payload itself"
        );
    }

    #[test]
    fn an_event_named_error_reports_an_error() {
        let events =
            parse_sse(lines("event: error\ndata: the provider is on fire\n\n").into_iter());

        assert_eq!(
            events,
            vec![AiEvent::Error {
                message: "the provider is on fire".to_string()
            }]
        );
    }
}
