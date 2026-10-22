/**
 * The shared type contracts of Arrow.
 *
 * Every workspace imports these instead of repeating a shape, so the desktop
 * app and the packages cannot drift apart.
 */

/** The product name. The window title, the bundle name and the about box use it. */
export const APP_NAME = "Arrow";

/** The facts about the running application. */
export interface AppInfo {
  readonly name: string;
  readonly version: string;
  readonly tauri: boolean;
}

/** The theme tiers Arrow ships. Dark is the first tier, not an afterthought. */
export type ThemeTier = "dark" | "light";

import contract from "./ai-contract.json";

/**
 * The one contract of the AI boundary.
 *
 * The Rust shell and the frontend both read this file. The shell lifts its
 * event names and its payload fields out of it in
 * `apps/desktop/src-tauri/src/commands/ai.rs`, and the frontend takes its
 * types, its event names and its command names from it in
 * `apps/desktop/src/lib/ai.ts`. Neither side spells an event, a payload
 * field, a command or an argument anywhere else, so a name on one side of
 * the Tauri boundary cannot drift from the same name on the other side
 * without a test failing.
 */
export const AI_CONTRACT = contract;

/** The id of one event of the AI boundary. */
export type AiEventId = keyof typeof AI_CONTRACT.events;

/** The payload of one event of the AI boundary, its fields read from the contract. */
export type AiEventPayload<K extends AiEventId> = {
  readonly [F in keyof (typeof AI_CONTRACT.events)[K]["payload"]]: (typeof AI_CONTRACT.events)[K]["payload"][F];
};

/** The payload of `ai:token:<request_id>`. */
export type AiTokenPayload = AiEventPayload<"token">;

/** The payload of `ai:complete:<request_id>`. */
export type AiCompletePayload = AiEventPayload<"complete">;

/** The payload of `ai:error:<request_id>`. */
export type AiErrorPayload = AiEventPayload<"error">;

/** The name of one command of the AI boundary. */
export type AiCommandName = keyof typeof AI_CONTRACT.commands;

/**
 * The names of the commands, read from the contract as values.
 *
 * The spelling lives in the JSON alone. The keys carry the name and the
 * values hand the same name back as a string, so the frontend sends the
 * command the contract holds.
 */
export const AI_COMMANDS: { readonly [K in AiCommandName]: AiCommandName } = Object.fromEntries(
  Object.keys(contract.commands).map((name) => [name, name]),
) as { readonly [K in AiCommandName]: AiCommandName };

/** The fields of the arguments one command takes, read from the contract. */
export type AiCommandArgs<K extends AiCommandName> = {
  readonly [F in keyof (typeof AI_CONTRACT.commands)[K]["args"]]: unknown;
};

/** One entry of a directory, as the shell reads it from the disk. */
export interface FileEntry {
  /** The file name of the entry, without its directory. */
  readonly name: string;
  /** The path of the entry. */
  readonly path: string;
  /** True when the entry is a directory. */
  readonly isDirectory: boolean;
}
