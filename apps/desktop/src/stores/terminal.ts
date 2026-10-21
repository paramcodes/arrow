import { create } from "zustand";

/**
 * The terminal tabs of the shell.
 *
 * The set of open terminals and the one on screen are workspace facts: they
 * matter to the whole window and they change when a reader opens or closes a
 * tab, not on every keystroke. ADR-0004 puts them in Zustand.
 *
 * The PTY of a tab is not a workspace fact. Its lifecycle belongs to the
 * machine of the terminal component, and the session id never enters this
 * store.
 */

/** One terminal tab of the bottom panel. */
export interface TerminalTab {
  /** The stable id of the tab. */
  readonly id: string;
  /** The title the tab bar shows. */
  readonly title: string;
}

/** The facts of the terminal tabs. */
export interface TerminalFacts {
  /** The open tabs, in the order the bar shows them. */
  readonly tabs: readonly TerminalTab[];
  /** The tab on screen, or null when no terminal is open. */
  readonly activeId: string | null;
}

/** The terminal store of the shell. */
export interface TerminalState extends TerminalFacts {
  /** Opens a terminal tab and returns its id. */
  readonly openTab: () => string;
  /** Closes a terminal tab. The neighbour of a closed tab becomes active. */
  readonly closeTab: (id: string) => void;
  /** Shows a terminal tab. */
  readonly setActive: (id: string) => void;
}

/** The number of tabs the shell has opened, used for the title and the id. */
let opened = 0;

/** The facts the store holds before the first terminal opens. */
const INITIAL_FACTS: TerminalFacts = { tabs: [], activeId: null };

function nextTab(): TerminalTab {
  opened += 1;
  return { id: `term-${opened}`, title: `Terminal ${opened}` };
}

/**
 * The terminal store of the shell.
 *
 * The store does not persist. A PTY dies with the window, so a reloaded shell
 * that restored a tab would show a terminal that can never answer. The next
 * session opens a fresh tab instead.
 */
export const useTerminalStore = create<TerminalState>()((set, get) => ({
  ...INITIAL_FACTS,
  openTab: () => {
    const tab = nextTab();
    set((state) => ({ tabs: [...state.tabs, tab], activeId: tab.id }));
    return tab.id;
  },
  closeTab: (id) => {
    const { tabs, activeId } = get();
    const index = tabs.findIndex((tab) => tab.id === id);
    if (index < 0) return;

    const remaining = tabs.filter((tab) => tab.id !== id);
    if (activeId !== id) {
      set({ tabs: remaining });
      return;
    }

    const neighbour = remaining[index] ?? remaining[index - 1] ?? null;
    set({ tabs: remaining, activeId: neighbour?.id ?? null });
  },
  setActive: (id) => {
    if (!get().tabs.some((tab) => tab.id === id)) return;
    set({ activeId: id });
  },
}));

/**
 * Puts the terminal store back the way a new window opens it.
 *
 * The store is one mutable object, so a test that opens a tab changes the
 * store for every test that runs after it. Every test of the store resets it
 * first, and the reset clears the counter, so an id from one test cannot leak
 * into another.
 */
export function resetTerminalStore(): void {
  opened = 0;
  useTerminalStore.setState(INITIAL_FACTS);
}
