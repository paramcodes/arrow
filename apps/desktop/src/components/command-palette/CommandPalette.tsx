import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Dialog,
  DialogContent,
  DialogTitle,
} from "@arrow/ui";
import { useEffect, useMemo, useState } from "react";

import { joinPath, workspaceRoot } from "../../hooks/fileSystem";
import { listProjectFiles } from "../../lib/search";
import { formatShortcut } from "../../lib/shortcuts";
import { useEditorStore } from "../../stores/editor";
import { useOverlayStore } from "../../stores/overlay";
import { CATEGORY_LABELS, rankCommands, rankFiles, type Command as ShellCommand } from "./commands";
import { useCommands } from "./useCommands";

/**
 * The command palette of the shell.
 *
 * One dialog carries both lists of the palette. `Cmd+Shift+P` opens the
 * commands of the registry, `Cmd+P` opens the files of the workspace, and the
 * fuzzy rank of `lib/fuzzy.ts` orders both. The palette is filtered by the
 * shell and not by the list, so the ranking is one rule that a unit test can
 * read.
 *
 * The palette needs no Tauri host: the file list and the search come through
 * the same boundary as the tree, which answers from a fixture in a browser.
 */
export function CommandPalette() {
  const mode = useOverlayStore((state) => state.palette);
  const closePalette = useOverlayStore((state) => state.closePalette);
  const commands = useCommands();

  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<readonly string[]>([]);
  const [readingFiles, setReadingFiles] = useState(false);

  useEffect(() => {
    if (mode) setQuery("");
  }, [mode]);

  useEffect(() => {
    if (mode !== "files") return;

    let cancelled = false;
    setReadingFiles(true);

    listProjectFiles()
      .then((list) => {
        if (!cancelled) setFiles(list);
      })
      .catch(() => {
        if (!cancelled) setFiles([]);
      })
      .finally(() => {
        if (!cancelled) setReadingFiles(false);
      });

    return () => {
      cancelled = true;
    };
  }, [mode]);

  const matchedCommands = useMemo(
    () => (mode === "commands" ? rankCommands(commands, query) : []),
    [commands, mode, query],
  );

  const matchedFiles = useMemo(
    () => (mode === "files" ? rankFiles(files, query).slice(0, 100) : []),
    [files, mode, query],
  );

  const title = mode === "files" ? "Go to file" : "Command palette";

  const run = (command: ShellCommand) => {
    closePalette();
    command.action();
  };

  const open = (path: string) => {
    closePalette();
    void useEditorStore.getState().openFile(joinPath(workspaceRoot(), path));
  };

  return (
    <Dialog
      open={mode !== null}
      onOpenChange={(next) => {
        if (!next) closePalette();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        className="max-w-xl gap-0 overflow-hidden p-0"
        data-testid="command-palette"
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>

        <Command shouldFilter={false}>
          <CommandInput
            autoFocus
            data-testid="command-input"
            onValueChange={setQuery}
            placeholder={
              mode === "files" ? "Search the files of the workspace" : "Search the commands"
            }
            value={query}
          />
          <CommandList data-testid="command-list">
            <CommandEmpty>
              {mode === "files"
                ? readingFiles
                  ? "Reading the files of the workspace…"
                  : "No file matches."
                : "No command matches."}
            </CommandEmpty>

            {mode === "commands" ? (
              <CommandGroups commands={matchedCommands} onRun={run} />
            ) : (
              <CommandGroup heading="Files">
                {matchedFiles.map((file) => (
                  <CommandItem
                    data-testid={`quick-open-item-${file}`}
                    key={file}
                    onSelect={() => open(file)}
                    value={file}
                  >
                    <span className="truncate text-ink-secondary">{file}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>

        <footer className="flex items-center justify-between border-t border-border px-3 py-1.5 text-[11px] text-ink-tertiary">
          <span>{mode === "files" ? "Go to file" : "Commands"}</span>
          <span>Enter to open · Esc to close</span>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

/** The commands of one palette list, grouped by their category. */
function CommandGroups({
  commands,
  onRun,
}: {
  readonly commands: readonly ShellCommand[];
  readonly onRun: (command: ShellCommand) => void;
}) {
  const groups = useMemo(() => {
    const byCategory = new Map<string, ShellCommand[]>();
    for (const command of commands) {
      const group = byCategory.get(command.category) ?? [];
      group.push(command);
      byCategory.set(command.category, group);
    }
    return [...byCategory.entries()];
  }, [commands]);

  return (
    <>
      {groups.map(([category, entries]) => (
        <CommandGroup
          heading={CATEGORY_LABELS[category as keyof typeof CATEGORY_LABELS]}
          key={category}
        >
          {entries.map((command) => {
            const Icon = command.icon;

            return (
              <CommandItem
                data-testid={`command-item-${command.id}`}
                key={command.id}
                onSelect={() => onRun(command)}
                value={command.id}
              >
                {Icon ? <Icon className="h-3.5 w-3.5 text-ink-tertiary" /> : null}
                <span className="truncate">{command.label}</span>
                {command.shortcut ? (
                  <span className="ml-auto shrink-0 text-[11px] text-ink-tertiary">
                    {formatShortcut(command.shortcut)}
                  </span>
                ) : null}
              </CommandItem>
            );
          })}
        </CommandGroup>
      ))}
    </>
  );
}
