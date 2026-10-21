import { createActor } from "xstate";
import { beforeEach, describe, expect, it } from "vitest";

import { INITIAL_TERMINAL_CONTEXT, terminalMachine } from "./machine";

/**
 * The lifecycle of one terminal's PTY.
 *
 * The machine is the only owner of the sequence number and of the state of
 * the session, so the cases drive it without a browser and without xterm.
 */
describe("the terminal machine", () => {
  let actor = createActor(terminalMachine);

  beforeEach(() => {
    actor = createActor(terminalMachine);
    actor.start();
  });

  it("opens idle and starts on demand", () => {
    expect(actor.getSnapshot().value).toBe("idle");
    expect(actor.getSnapshot().context).toEqual(INITIAL_TERMINAL_CONTEXT);

    actor.send({ type: "start" });
    expect(actor.getSnapshot().value).toBe("starting");
  });

  it("runs once the backend names the session", () => {
    actor.send({ type: "start" });
    actor.send({ type: "started", sessionId: "pty-1" });

    const snapshot = actor.getSnapshot();
    expect(snapshot.value).toBe("running");
    expect(snapshot.context.sessionId).toBe("pty-1");
  });

  it("counts the chunks a gap lost", () => {
    actor.send({ type: "start" });
    actor.send({ type: "started", sessionId: "pty-1" });

    actor.send({ type: "data", seq: 1 });
    actor.send({ type: "data", seq: 4 });

    const snapshot = actor.getSnapshot();
    expect(snapshot.context.lastSeq).toBe(4);
    expect(snapshot.context.gaps).toBe(2);
  });

  it("does not count a replayed chunk as a gap", () => {
    actor.send({ type: "start" });
    actor.send({ type: "started", sessionId: "pty-1" });
    actor.send({ type: "data", seq: 5 });
    actor.send({ type: "data", seq: 2 });

    expect(actor.getSnapshot().context.lastSeq).toBe(5);
    expect(actor.getSnapshot().context.gaps).toBe(4);
  });

  it("records the exit of the shell", () => {
    actor.send({ type: "start" });
    actor.send({ type: "started", sessionId: "pty-1" });
    actor.send({ type: "exit", code: 0 });

    const snapshot = actor.getSnapshot();
    expect(snapshot.value).toBe("exited");
    expect(snapshot.context.exitCode).toBe(0);
  });

  it("records a failure that ended the session", () => {
    actor.send({ type: "start" });
    actor.send({ type: "fail", error: "no shell" });

    const snapshot = actor.getSnapshot();
    expect(snapshot.value).toBe("failed");
    expect(snapshot.context.error).toBe("no shell");
  });

  it("kills a session that is still starting", () => {
    actor.send({ type: "start" });
    actor.send({ type: "kill" });

    expect(actor.getSnapshot().value).toBe("killed");
  });

  it("stays killed once it is killed", () => {
    actor.send({ type: "start" });
    actor.send({ type: "started", sessionId: "pty-1" });
    actor.send({ type: "kill" });

    expect(actor.getSnapshot().value).toBe("killed");

    actor.send({ type: "start" });
    expect(actor.getSnapshot().value).toBe("killed");
  });
});
