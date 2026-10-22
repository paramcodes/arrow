# Point the AI client at a local stand-in with a loopback-only override

Status: Accepted, 2026-10-22.

## Context and Problem Statement

The AI client talks to three providers, and the address of each one is a compile-time constant in `apps/desktop/src-tauri/src/ai/providers/{anthropic,openai,google}.rs`. `Endpoints::default` copies the three constants, `stream` sends every request against the default, and `stream_to` takes the addresses as an argument so a test can point the client at a mock server. There is no way to point the running application at a local server without editing the source and rebuilding.

The product needs that path. A demonstration of the AI feature can run against a local stand-in for the provider instead of a real key and a real network round trip, and the operator chose the stand-in over a key in the keychain. The client also carries the key of the provider in the headers of every request, so any redirection of the address is a way to move the key to another host, and ADR-0005 fixes the key to the Rust side of the boundary. The two needs pull against each other: an address the developer can change at run time is also an address an environment variable can change.

## Decision Drivers

- The feature can be demonstrated with no real key, no provider account and no network round trip.
- The key never goes to a host that is not the provider or a server the developer runs on the same machine.
- The change stays inside the AI boundary. `Endpoints` keeps its shape, no event name and no field of `packages/types/src/ai-contract.json` moves, and the keychain code does not change.
- One knob, not three. The stand-in serves all three dialects on one origin, and three variables would mean three places to enforce the same rule.
- A test proves both halves of the rule: the override moves the address, and an address that is not loopback leaves it alone.

## Considered Options

- Edit the provider constants and rebuild for the demonstration
- One variable per provider
- A field in the settings dialog
- One variable, honored only when its host is loopback

### Edit the provider constants and rebuild for the demonstration

- Good, because there is no new code, no new variable and no new rule to hold.
- Bad, because it rebuilds the Rust shell for every demonstration, and the tree carries a local address while the demonstration happens.
- Bad, because a committed local address is a change to the product made for a recording, and the next reader cannot tell which address is real.

### One variable per provider

- Good, because a developer can point one provider at a stand-in and leave the others at their real addresses.
- Bad, because the same loopback rule has to be enforced three times, in three places, and one of the three can drift.
- Bad, because the demonstration needs all three providers at the same stand-in, so the extra precision buys nothing today.

### A field in the settings dialog

- Good, because the address becomes a visible setting with the same persistence as the provider and the model.
- Bad, because it puts a redirect in reach of the product surface and the stored state of the application, which is a wider change than this need asks for.
- Bad, because it changes the bridge contract, and with it ADR-0005 and the Rust and TypeScript tests that read the contract.

### One variable, honored only when its host is loopback

- Good, because a developer starts the shell with one variable and the client talks to the server on that machine, with no rebuild.
- Good, because the value is parsed as a url and its host is compared against the three loopback hosts, so a name that merely contains `127.0.0.1` or `localhost`, and a host that is not this machine, cannot take effect.
- Good, because the fallback is the address of the provider, which is the address the client used before the change.
- Bad, because the set of hosts is exact and short: `127.0.0.2` is a loopback address and it is still ignored.
- Bad, because a stand-in on the same origin has to answer the three paths and the three dialects, which a single-provider mock does not.

## Decision Outcome

Chosen option: "One variable, honored only when its host is loopback". `Endpoints::from_env` reads `ARROW_AI_BASE_URL`, and `stream` sends every request against it. When the parsed host of the value is exactly `127.0.0.1`, `::1` or `localhost`, the three addresses of `Endpoints` become that value and the provider module of the request appends its own path, so the same base serves the Anthropic, the OpenAI and the Google provider. When the value is missing, names any other host, or does not parse as a url, every address stays the compile-time address of its provider.

The rule holds in one function, `loopback_base`, and it reads the host from the parsed url rather than from the text of the value, so the user info of a url and the suffix of a longer name are never mistaken for a host: `http://127.0.0.1@evil.example` and `http://localhost.evil.example` are both ignored. `reqwest::Url` is the parser, re-exported by the `reqwest` dependency the client already carries, so the change adds no dependency.

### Consequences

- Good, because the AI feature can be demonstrated against a local server, with no key in the keychain and no request to a provider.
- Good, because the key can leave the machine only for the address of the provider, or for a server the developer runs on this machine. There is no value of the variable that sends it to another host.
- Bad, because the set of honored hosts is exact. A developer who writes `127.0.0.2` or `localhost.` gets the real provider and a request that fails without a key, not the local server.
- Bad, because the same path is read by the shipped application. A user who runs a server on a loopback address can point Arrow at it, and that server receives the key. The rule bounds the destination to this machine; it does not bound the process on it.
- Neutral, because the variable is read per request, so it takes effect without a restart and without a rebuild, which is what the demonstration needs.

## Confirmation

The five tests in `apps/desktop/src-tauri/src/ai/client.rs` are the proof, and `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` runs them:

- `the_override_points_every_provider_at_the_local_server` asserts the url of a request of each provider carries the loopback base, and that the key header of the request is the key.
- `an_override_sends_the_request_to_a_server_on_this_machine` streams a request through the override into a server on `127.0.0.1`, and asserts the request line names the path of the provider and the authorization header carries the key.
- `an_override_that_is_not_a_loopback_host_is_ignored` feeds ten values, among them a public host, a private address, a name that ends in `127.0.0.1`, a name that ends in `localhost`, a url whose user info holds `127.0.0.1`, an empty value and a `file:` url, and asserts the literal provider url of a request of each provider.
- `the_environment_variable_is_the_override` sets `ARROW_AI_BASE_URL`, reads `Endpoints::from_env`, and asserts a loopback value takes effect while a public value does not.
- `only_the_three_named_loopback_hosts_are_honored` asserts the accepted forms, among them `[::1]` and uppercase `LOCALHOST`, and the rejected near misses `127.0.0.2`, `[::2]`, `localhost.` and `0.0.0.0`.

## More Information

The boundary this record extends is ADR-0005. The README's AI section names the variable for a developer who wants to use it, and the addresses it overrides are the constants in `apps/desktop/src-tauri/src/ai/providers/`.
