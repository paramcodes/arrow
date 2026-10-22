#!/usr/bin/env node
/**
 * A local stand-in for the Anthropic messages API, for the demo recordings.
 *
 * Arrow points every provider at this server with `ARROW_AI_BASE_URL`, which
 * the Rust client honors only for a loopback host. The server answers the
 * shape of `POST /v1/messages` as a stream of Server-Sent Events:
 *
 *   event: message_start
 *   data: {"type":"message_start", ...}
 *
 *   event: content_block_delta
 *   data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"..."}}
 *
 *   event: message_stop
 *   data: {"type":"message_stop"}
 *
 * The answer is canned. It is picked from the request body, so the completion
 * clip and the inline edit clip each get the text the demo asked for, and the
 * server never calls a provider. It reads no key: the request carries one,
 * because the shell always sends the key it found in the keychain, and this
 * server ignores it and never logs it.
 *
 * Usage:
 *   node scripts/mock-ai-server.mjs --port 41017 [--host 127.0.0.1]
 *
 * The process prints one line per request and one line when it listens, so the
 * recorder can wait for it before it launches the application. SIGTERM or
 * SIGINT ends it.
 */

import { createServer } from "node:http";

/** The default port. The recorder passes one derived from its worktree. */
const DEFAULT_PORT = 41017;

/** The default host. Only a loopback address is meaningful here. */
const DEFAULT_HOST = "127.0.0.1";

/** The canned completion, for a request whose prompt asks for a completion. */
const COMPLETION = "value * 2;";

/**
 * The canned inline edit, keyed by a phrase of the text it replaces.
 *
 * The request carries the selection as the content of the last user turn
 * before the instruction, so the phrase is enough to pick the answer that
 * belongs to the demo workspace.
 */
const INLINE_EDITS = [
  {
    find: "return a + b;",
    answer: "  return (a + b) * 2;",
  },
];

/** The answer no other request matches. */
const FALLBACK = "// the local stand-in has no answer for this request";

/**
 * The answer to one request body.
 *
 * The body is the JSON of the Anthropic messages API. The last message is the
 * prompt of the reader, and the messages before it carry the context.
 *
 * A body that arrives empty cannot be told apart, and the client of the
 * version this recorder was written against sends no body at all. The recorder
 * therefore starts the server with `--answer`, which picks the canned answer
 * for the clip, and the reading of the body stays as the path of a client that
 * carries one.
 */
function answerFor(body, forced) {
  if (forced === "completion") return COMPLETION;
  if (forced === "inline") return INLINE_EDITS[0].answer;
  if (forced === "fallback") return FALLBACK;

  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const prompt = textOf(messages.at(-1));
  const context = messages.slice(0, -1).map(textOf).join("\n");

  if (prompt.includes("Complete the code")) {
    return COMPLETION;
  }

  for (const edit of INLINE_EDITS) {
    if (context.includes(edit.find)) return edit.answer;
  }

  return FALLBACK;
}

/** The text of one message, whether its content is a string or blocks. */
function textOf(message) {
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .map((block) => (typeof block?.text === "string" ? block.text : ""))
      .join("");
  }
  return "";
}

/** Split the answer into the tokens of the stream. */
function tokensOf(answer) {
  const words = answer.match(/\S+\s*/g) ?? [answer];
  return words;
}

/**
 * Write one event of the stream.
 *
 * The delay between two tokens is what makes the application paint the answer
 * as it arrives instead of in one frame, so the clip shows a stream.
 */
function sendEvent(response, name, payload) {
  response.write(`event: ${name}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

/** Stream one canned answer into a response. */
async function streamAnswer(response, answer, delayMs) {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });

  sendEvent(response, "message_start", {
    type: "message_start",
    message: { id: "msg_local_stand_in", type: "message", role: "assistant" },
  });
  sendEvent(response, "content_block_start", {
    type: "content_block_start",
    index: 0,
    content_block: { type: "text", text: "" },
  });

  for (const token of tokensOf(answer)) {
    if (response.destroyed) return;
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    sendEvent(response, "content_block_delta", {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: token },
    });
  }

  sendEvent(response, "content_block_stop", { type: "content_block_stop", index: 0 });
  sendEvent(response, "message_stop", { type: "message_stop" });
  response.end();
}

/** Read the body of a request. */
async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.length > 2_000_000) throw new Error("the request body is too large");
  return JSON.parse(text || "{}");
}

/** The message a server prints for one request. */
function describe(request, body, answer) {
  const model = typeof body?.model === "string" ? body.model : "?";
  return `mock-ai: ${request.method} ${request.url} model=${model} answer=${JSON.stringify(answer)}`;
}

const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] !== undefined ? argv[index + 1] : fallback;
};

const port = Number(option("--port", String(DEFAULT_PORT)));
const host = option("--host", DEFAULT_HOST);
const delay = Number(option("--delay", "90"));
const forced = option("--answer", "");

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`mock-ai: ${port} is not a port`);
  process.exit(64);
}

const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/v1/messages") {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ type: "error", error: { message: "not found" } }));
    return;
  }

  let body;
  try {
    body = await readBody(request);
  } catch (failure) {
    response.writeHead(400, { "content-type": "application/json" });
    response.end(
      JSON.stringify({ type: "error", error: { message: `the body is not JSON: ${failure}` } }),
    );
    return;
  }

  const answer = answerFor(body, forced);
  console.log(describe(request, body, answer));
  console.log(
    `mock-ai: keys=${Object.keys(body).join(",")} messages=${body?.messages?.length ?? 0}`,
  );
  await streamAnswer(response, answer, delay);
});

server.listen(port, host, () => {
  console.log(`mock-ai: listening on http://${host}:${port}`);
});

/** End the server on the signals the recorder uses to stop it. */
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    console.log(`mock-ai: ${signal}`);
    server.close(() => process.exit(0));
  });
}
