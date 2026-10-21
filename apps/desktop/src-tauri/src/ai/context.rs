//! The context builder of the AI feature.
//!
//! The builder answers one question: what does the model see when the reader
//! asks for a completion? The answer has two tiers. Tier one is hot: the file
//! in front of the reader, the place of the caret and the selection. Tier two
//! is warm: the files the file imports and the signatures of the functions it
//! calls. The hot tier is always there, and the warm tier is added while it
//! fits in the budget.
//!
//! The builder is a pure function of its input. It reads no file, it writes
//! no file and it keeps no state, so the same input always builds the same
//! context and a test can assert the context without a disk.

use crate::ai::models::{ContextItem, ContextRole};

/// The number of tokens the context may hold.
pub const CONTEXT_TOKEN_BUDGET: u32 = 8_000;

/// The number of tokens the answer may hold.
pub const OUTPUT_TOKEN_BUDGET: u32 = 4_000;

/// The number of characters one token holds, on average.
///
/// The estimate is the usual one of the industry: four characters of text
/// are about one token. It is an estimate, not a count, and the budget the
/// builder holds to is an estimate too.
pub const CHARACTERS_PER_TOKEN: u32 = 4;

/// The place of the caret in the file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Cursor {
    /// The line of the caret, counting from one.
    pub line: u32,
    /// The column of the caret, counting from one.
    pub column: u32,
}

impl Cursor {
    /// A caret at the place the reader left it.
    pub fn new(line: u32, column: u32) -> Self {
        Self { line, column }
    }
}

/// Tier one of the context: the file in front of the reader.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct HotContext {
    /// The path of the file.
    pub path: String,
    /// The text of the file.
    pub content: String,
    /// The place of the caret.
    pub cursor: Cursor,
    /// The selected text, empty when nothing is selected.
    pub selection: String,
}

/// Tier two of the context: a file the file in front of the reader imports.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct WarmContext {
    /// The path of the imported file.
    pub path: String,
    /// The text of the imported file.
    pub content: String,
}

/// Tier two of the context: the signature of a function.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Signature {
    /// The name of the function.
    pub name: String,
    /// The signature of the function.
    pub signature: String,
}

/// Everything the builder reads.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ContextInput {
    /// The file in front of the reader.
    pub hot: HotContext,
    /// The files that file imports.
    pub warm: Vec<WarmContext>,
    /// The signatures of the functions around the caret.
    pub signatures: Vec<Signature>,
}

/// What the builder built.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct BuiltContext {
    /// The pieces of the context, in the order the model reads them.
    pub items: Vec<ContextItem>,
    /// The number of tokens the context holds, as it was estimated.
    pub tokens: u32,
    /// The names of the pieces the budget left out.
    pub dropped: Vec<String>,
}

impl BuiltContext {
    /// The text of the pieces, joined by a blank line.
    pub fn text(&self) -> String {
        self.items
            .iter()
            .map(|item| item.text.as_str())
            .collect::<Vec<&str>>()
            .join("\n\n")
    }
}

/// The number of tokens a text holds, as it is estimated.
pub fn estimate_tokens(text: &str) -> u32 {
    let characters = text.chars().count() as u32;
    characters.div_ceil(CHARACTERS_PER_TOKEN)
}

/// Build the context of a request.
///
/// The hot tier comes first, because it is hot: the file, the caret and the
/// selection are what the reader sees. The warm tier follows while it fits in
/// the budget, and every piece that does not fit is named in `dropped`, so the
/// caller can say what the model did not see.
///
/// The hot tier is never dropped. A file that is too long is cut around the
/// caret, so the reader and the model still look at the same place.
pub fn build(input: &ContextInput) -> BuiltContext {
    let mut items: Vec<ContextItem> = Vec::new();
    let mut dropped: Vec<String> = Vec::new();
    let mut tokens: u32 = 0;

    let instructions = instructions();
    tokens += estimate_tokens(&instructions);
    items.push(ContextItem {
        role: ContextRole::System,
        text: instructions,
    });

    let hot = hot_item(input, CONTEXT_TOKEN_BUDGET.saturating_sub(tokens));
    tokens += estimate_tokens(&hot.text);
    items.push(hot);

    for warm in &input.warm {
        let text = warm_text(warm);
        let cost = estimate_tokens(&text);
        if tokens + cost > CONTEXT_TOKEN_BUDGET {
            dropped.push(warm.path.clone());
            continue;
        }

        tokens += cost;
        items.push(ContextItem {
            role: ContextRole::User,
            text,
        });
    }

    for signature in &input.signatures {
        let text = signature_text(signature);
        let cost = estimate_tokens(&text);
        if tokens + cost > CONTEXT_TOKEN_BUDGET {
            dropped.push(signature.name.clone());
            continue;
        }

        tokens += cost;
        items.push(ContextItem {
            role: ContextRole::User,
            text,
        });
    }

    BuiltContext {
        items,
        tokens,
        dropped,
    }
}

/// Build the context of a request that arrives as one text.
///
/// The webview sends the context of a request as one text. The builder holds
/// that text to the same budget as the tiered context, so a request that
/// carries a whole repository does not fill the window of the model.
pub fn wrap(text: &str) -> BuiltContext {
    build(&ContextInput {
        hot: HotContext {
            path: String::new(),
            content: text.to_string(),
            cursor: Cursor::default(),
            selection: String::new(),
        },
        warm: Vec::new(),
        signatures: Vec::new(),
    })
}

/// The instructions the model reads first.
fn instructions() -> String {
    "You are the assistant of Arrow, a code editor. Answer with code and with \
     nothing else. Use the context of the file the reader is in."
        .to_string()
}

/// The hot tier: the file, the caret and the selection.
///
/// The tier is cut in characters, and the characters are turned into tokens
/// at the end, so the estimate of the built context never runs over the
/// budget by the rounding of one line.
fn hot_item(input: &ContextInput, budget: u32) -> ContextItem {
    let hot = &input.hot;
    let header = hot_header(hot);
    let room = (budget as usize)
        .saturating_mul(CHARACTERS_PER_TOKEN as usize)
        .saturating_sub(header.chars().count());

    let content = if hot.content.chars().count() <= room {
        hot.content.clone()
    } else {
        let window = window_around(&hot.content, hot.cursor.line, room);
        truncate(&window, room)
    };

    ContextItem {
        role: ContextRole::User,
        text: format!("{header}{content}"),
    }
}

/// The head of the hot tier: the path, the caret and the selection.
///
/// A part that is empty is left out, so a context that arrives as one text
/// does not carry a file name and a caret that it does not have.
fn hot_header(hot: &HotContext) -> String {
    let mut header = String::new();

    if !hot.path.is_empty() {
        header.push_str(&format!("File: {}\n", hot.path));
    }

    if hot.cursor.line > 0 {
        header.push_str(&format!(
            "Caret: line {}, column {}\n",
            hot.cursor.line, hot.cursor.column
        ));
    }

    if !hot.selection.is_empty() {
        header.push_str(&format!("Selection:\n{}\n", hot.selection));
    }

    header.push_str("Content:\n");
    header
}

/// The warm tier: an imported file.
fn warm_text(warm: &WarmContext) -> String {
    format!("Imported file: {}\n{}", warm.path, warm.content)
}

/// The warm tier: the signature of a function.
fn signature_text(signature: &Signature) -> String {
    format!("Signature of {}: {}", signature.name, signature.signature)
}

/// The lines of a file around the caret, as many characters as the budget
/// holds.
///
/// The caret line comes first, and the lines around it follow, so the reader
/// and the model look at the same place even when the file does not fit.
fn window_around(content: &str, cursor_line: u32, room: usize) -> String {
    let lines: Vec<&str> = content.lines().collect();
    if lines.is_empty() {
        return String::new();
    }

    let centre = cursor_line.saturating_sub(1) as usize;
    let centre = centre.min(lines.len().saturating_sub(1));

    let mut chosen: Vec<usize> = vec![centre];
    let mut characters = lines[centre].chars().count();
    let mut above = centre;
    let mut below = centre;

    loop {
        let mut grew = false;

        if above > 0 {
            above -= 1;
            let cost = lines[above].chars().count();
            if characters + cost > room {
                break;
            }
            characters += cost;
            chosen.push(above);
            grew = true;
        }

        if below + 1 < lines.len() {
            below += 1;
            let cost = lines[below].chars().count();
            if characters + cost > room {
                break;
            }
            characters += cost;
            chosen.push(below);
            grew = true;
        }

        if !grew {
            break;
        }
    }

    chosen.sort_unstable();
    chosen
        .into_iter()
        .map(|index| lines[index])
        .collect::<Vec<&str>>()
        .join("\n")
}

/// The first characters of a text.
fn truncate(text: &str, room: usize) -> String {
    text.chars().take(room).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input() -> ContextInput {
        ContextInput {
            hot: HotContext {
                path: "src/main.ts".to_string(),
                content: "const arrow = 1;\nconst bow = 2;\n".to_string(),
                cursor: Cursor::new(2, 5),
                selection: "const bow = 2;".to_string(),
            },
            warm: vec![WarmContext {
                path: "src/util.ts".to_string(),
                content: "export const helper = () => 0;\n".to_string(),
            }],
            signatures: vec![Signature {
                name: "helper".to_string(),
                signature: "helper(value: string): number".to_string(),
            }],
        }
    }

    #[test]
    fn the_hot_tier_carries_the_file_the_caret_and_the_selection() {
        let built = build(&input());

        let hot = &built.items[1];
        assert!(hot.text.contains("src/main.ts"), "the path is there");
        assert!(hot.text.contains("line 2"), "the caret is there");
        assert!(hot.text.contains("column 5"), "the column is there");
        assert!(
            hot.text.contains("const bow = 2;"),
            "the selection is there: {}",
            hot.text
        );
        assert!(
            hot.text.contains("const arrow = 1;"),
            "the content is there: {}",
            hot.text
        );
    }

    #[test]
    fn the_warm_tier_carries_the_imported_files_and_the_signatures() {
        let built = build(&input());

        let text = built.text();
        assert!(text.contains("src/util.ts"), "the import is there");
        assert!(text.contains("export const helper"), "the import is there");
        assert!(
            text.contains("helper(value: string): number"),
            "the signature is there: {text}"
        );
    }

    #[test]
    fn the_instructions_come_first() {
        let built = build(&input());

        assert_eq!(built.items[0].role, ContextRole::System);
        assert!(built.items[0].text.contains("Arrow"));
    }

    #[test]
    fn the_builder_is_a_pure_function() {
        let first = build(&input());
        let second = build(&input());

        assert_eq!(first, second);
    }

    #[test]
    fn the_builder_does_not_change_its_input() {
        let source = input();
        let before = source.clone();

        build(&source);

        assert_eq!(source, before);
    }

    #[test]
    fn the_context_holds_to_the_token_budget() {
        let mut source = input();
        source.hot.content = (0..4_000)
            .map(|line| format!("line {line} of a very long file"))
            .collect::<Vec<String>>()
            .join("\n");
        source.warm = (0..40)
            .map(|index| WarmContext {
                path: format!("src/import-{index}.ts"),
                content: (0..200)
                    .map(|line| format!("import {index} line {line}"))
                    .collect::<Vec<String>>()
                    .join("\n"),
            })
            .collect();

        let built = build(&source);

        assert!(
            built.tokens <= CONTEXT_TOKEN_BUDGET,
            "the context holds {} tokens",
            built.tokens
        );
        assert!(!built.dropped.is_empty(), "the budget left something out");
    }

    #[test]
    fn a_file_too_long_is_cut_around_the_caret() {
        let mut source = input();
        source.hot.content = (0..4_000)
            .map(|line| format!("line {line} of a very long file"))
            .collect::<Vec<String>>()
            .join("\n");
        source.hot.cursor = Cursor::new(2_000, 1);
        source.warm.clear();

        let built = build(&source);

        assert!(
            built.tokens <= CONTEXT_TOKEN_BUDGET,
            "the context holds {} tokens",
            built.tokens
        );
        assert!(
            built.items[1]
                .text
                .contains("line 1999 of a very long file"),
            "the caret is still in view: {}",
            built.items[1].text
        );
    }

    #[test]
    fn the_output_budget_is_four_thousand_tokens() {
        assert_eq!(OUTPUT_TOKEN_BUDGET, 4_000);
    }

    #[test]
    fn the_tokens_of_a_text_are_estimated() {
        assert_eq!(estimate_tokens(""), 0);
        assert_eq!(estimate_tokens("abcd"), 1);
        assert_eq!(estimate_tokens("abcde"), 2);
    }
}
