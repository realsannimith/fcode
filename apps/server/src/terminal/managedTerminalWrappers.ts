// FILE: managedTerminalWrappers.ts
// Purpose: Create Superset-style managed command wrappers so terminal agent identity is canonical
// and survives zsh startup that rewrites PATH.

import fs from "node:fs";
import path from "node:path";

import {
  defaultTerminalTitleForCliKind,
  managedTerminalCommandNameForCliKind,
  T3CODE_TERMINAL_HOOK_OSC_PREFIX,
  T3CODE_TERMINAL_SESSION_OSC_PREFIX,
  T3CODE_TERMINAL_CLI_KIND_ENV_KEY,
  type TerminalAgentHookEventType,
  type TerminalCliKind,
} from "@t3tools/shared/terminalThreads";

import { envPathKeyFor, resolveExecutableOnPath } from "../executableLookup.ts";

export interface ManagedTerminalWrapperState {
  binDir: string | null;
  codexHomeDir: string | null;
  hookScriptPath: string | null;
  claudeSettingsPath: string | null;
  zshDir: string | null;
  targetPathByCliKind: Partial<Record<TerminalCliKind, string>>;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}

function buildHookOscSequence(eventType: TerminalAgentHookEventType): string {
  return `\\033]${T3CODE_TERMINAL_HOOK_OSC_PREFIX}${eventType}\\007`;
}

function buildNotifyHookScript(): string {
  return `#!/bin/sh
set -eu
if [ "$#" -gt 0 ]; then
  _t3code_hook_input="$1"
else
  _t3code_hook_input="$(cat)"
fi

_t3code_extract_event() {
  printf '%s' "$_t3code_hook_input" | sed -n "s/.*\\\"$1\\\"[[:space:]]*:[[:space:]]*\\\"\\([^\\\"]*\\)\\\".*/\\1/p" | head -n 1
}

_t3code_event="$(_t3code_extract_event hook_event_name)"
if [ -z "$_t3code_event" ]; then
  _t3code_type="$(_t3code_extract_event type)"
  case "$_t3code_type" in
    task_started|userPromptSubmitted|user_prompt_submit)
      _t3code_event="Start"
      ;;
    task_complete|agent-turn-complete|stop|session_end|sessionEnd)
      _t3code_event="Stop"
      ;;
    exec_approval_request|apply_patch_approval_request|request_user_input)
      _t3code_event="PermissionRequest"
      ;;
  esac
fi

_t3code_emit_osc() {
  _t3code_sequence="$1"
  # Agent CLIs (claude/codex) detach hook processes from the controlling terminal, so
  # \`[ -w /dev/tty ]\` passes while opening /dev/tty fails with ENXIO. Attempt the real
  # write, then fall back to the parent process's tty device, then to stdout.
  if printf '%b' "$_t3code_sequence" > /dev/tty 2>/dev/null; then
    return
  fi
  _t3code_parent_tty="$(ps -o tty= -p "\${PPID:-0}" 2>/dev/null | tr -d '[:space:]')"
  if [ -n "$_t3code_parent_tty" ] && [ "$_t3code_parent_tty" != "??" ] && [ "$_t3code_parent_tty" != "-" ]; then
    if printf '%b' "$_t3code_sequence" > "/dev/$_t3code_parent_tty" 2>/dev/null; then
      return
    fi
  fi
  printf '%b' "$_t3code_sequence"
}

case "$_t3code_event" in
  UserPromptSubmit|Start)
    _t3code_emit_osc '${buildHookOscSequence("Start")}'
    ;;
  Stop)
    _t3code_emit_osc '${buildHookOscSequence("Stop")}'
    ;;
  PermissionRequest|PreToolUse|Notification)
    _t3code_emit_osc '${buildHookOscSequence("PermissionRequest")}'
    ;;
  SessionStart|session_configured|sessionStart)
    _t3code_emit_osc '${buildHookOscSequence("Idle")}'
    ;;
esac

# Surface the CLI session id so the server can resume this exact conversation after a restart.
# Claude hook payloads carry "session_id"; codex session ids are captured in the codex wrapper.
_t3code_session_id="$(_t3code_extract_event session_id)"
if [ -n "$_t3code_session_id" ] && [ -n "\${T3CODE_TERMINAL_CLI_KIND:-}" ]; then
  _t3code_emit_osc "\\033]${T3CODE_TERMINAL_SESSION_OSC_PREFIX}\${T3CODE_TERMINAL_CLI_KIND}:\${_t3code_session_id}\\007"
fi
`;
}

function buildClaudeSettingsJson(notifyHookPath: string): string {
  const command = notifyHookPath;
  return JSON.stringify(
    {
      hooks: {
        SessionStart: [{ hooks: [{ type: "command", command }] }],
        UserPromptSubmit: [{ hooks: [{ type: "command", command }] }],
        Stop: [{ hooks: [{ type: "command", command }] }],
        PermissionRequest: [{ matcher: "*", hooks: [{ type: "command", command }] }],
        Notification: [{ matcher: "*", hooks: [{ type: "command", command }] }],
      },
    },
    null,
    2,
  );
}

function buildCodexHooksJson(notifyHookPath: string): string {
  const command = notifyHookPath;
  return JSON.stringify(
    {
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: "command", command }] }],
        Stop: [{ hooks: [{ type: "command", command }] }],
      },
    },
    null,
    2,
  );
}

function buildCodexWrapperScript(input: {
  codexHomeDir: string;
  notifyHookPath: string;
  targetPath: string;
}): string {
  const { codexHomeDir, notifyHookPath, targetPath } = input;
  return [
    `export CODEX_HOME=${shellQuote(codexHomeDir)}`,
    `if [ -f ${shellQuote(notifyHookPath)} ]; then`,
    "  export CODEX_TUI_RECORD_SESSION=1",
    '  if [ -z "${CODEX_TUI_SESSION_LOG_PATH:-}" ]; then',
    '    _t3code_codex_ts="$(date +%s 2>/dev/null || echo "$$")"',
    '    export CODEX_TUI_SESSION_LOG_PATH="${TMPDIR:-/tmp}/t3code-codex-session-$$_${_t3code_codex_ts}.jsonl"',
    "  fi",
    "  (",
    '    _t3code_log="$CODEX_TUI_SESSION_LOG_PATH"',
    `    _t3code_notify=${shellQuote(notifyHookPath)}`,
    '    _t3code_last_turn_id=""',
    '    _t3code_last_approval_id=""',
    '    _t3code_last_exec_call_id=""',
    "    _t3code_approval_fallback_seq=0",
    '    _t3code_session_emitted=""',
    "",
    "    _t3code_emit_session() {",
    `      _t3code_seq="\\033]${T3CODE_TERMINAL_SESSION_OSC_PREFIX}codex:$1\\007"`,
    "      if [ -w /dev/tty ]; then",
    `        printf '%b' "$_t3code_seq" > /dev/tty 2>/dev/null || printf '%b' "$_t3code_seq"`,
    "      else",
    `        printf '%b' "$_t3code_seq"`,
    "      fi",
    "    }",
    "",
    "    _t3code_emit_event() {",
    '      _t3code_event="$1"',
    `      _t3code_payload=$(printf '{"hook_event_name":"%s"}' "$_t3code_event")`,
    '      "$_t3code_notify" "$_t3code_payload" >/dev/null 2>&1 || true',
    "    }",
    "",
    "    _t3code_i=0",
    '    while [ ! -f "$_t3code_log" ] && [ "$_t3code_i" -lt 200 ]; do',
    "      _t3code_i=$((_t3code_i + 1))",
    "      sleep 0.05",
    "    done",
    '    if [ ! -f "$_t3code_log" ]; then',
    "      exit 0",
    "    fi",
    "",
    '    tail -n 0 -F "$_t3code_log" 2>/dev/null | while IFS= read -r _t3code_line; do',
    '      if [ -z "$_t3code_session_emitted" ]; then',
    '        case "$_t3code_line" in',
    `          *'"session_id":"'*)`,
    `            _t3code_session_id=$(printf '%s\n' "$_t3code_line" | awk -F'"session_id":"' 'NF > 1 { sub(/".*/, "", $2); print $2; exit }')`,
    '            if [ -n "$_t3code_session_id" ]; then',
    "              _t3code_session_emitted=1",
    '              _t3code_emit_session "$_t3code_session_id"',
    "            fi",
    "            ;;",
    "        esac",
    "      fi",
    '      case "$_t3code_line" in',
    `        *'"dir":"to_tui"'*'"kind":"codex_event"'*'"msg":{"type":"task_started"'*)`,
    `          _t3code_turn_id=$(printf '%s\n' "$_t3code_line" | awk -F'"turn_id":"' 'NF > 1 { sub(/".*/, "", $2); print $2; exit }')`,
    '          [ -n "$_t3code_turn_id" ] || _t3code_turn_id="task_started"',
    '          if [ "$_t3code_turn_id" != "$_t3code_last_turn_id" ]; then',
    '            _t3code_last_turn_id="$_t3code_turn_id"',
    '            _t3code_emit_event "Start"',
    "          fi",
    "          ;;",
    `        *'"dir":"to_tui"'*'"kind":"codex_event"'*'"msg":{"type":"'*'_approval_request"'*)`,
    `          _t3code_approval_id=$(printf '%s\n' "$_t3code_line" | awk -F'"id":"' 'NF > 1 { sub(/".*/, "", $2); print $2; exit }')`,
    `          [ -n "$_t3code_approval_id" ] || _t3code_approval_id=$(printf '%s\n' "$_t3code_line" | awk -F'"approval_id":"' 'NF > 1 { sub(/".*/, "", $2); print $2; exit }')`,
    `          [ -n "$_t3code_approval_id" ] || _t3code_approval_id=$(printf '%s\n' "$_t3code_line" | awk -F'"call_id":"' 'NF > 1 { sub(/".*/, "", $2); print $2; exit }')`,
    '          if [ -z "$_t3code_approval_id" ]; then',
    "            _t3code_approval_fallback_seq=$((_t3code_approval_fallback_seq + 1))",
    '            _t3code_approval_id="approval_request_${_t3code_approval_fallback_seq}"',
    "          fi",
    '          if [ "$_t3code_approval_id" != "$_t3code_last_approval_id" ]; then',
    '            _t3code_last_approval_id="$_t3code_approval_id"',
    '            _t3code_emit_event "PermissionRequest"',
    "          fi",
    "          ;;",
    `        *'"dir":"to_tui"'*'"kind":"codex_event"'*'"msg":{"type":"exec_command_begin"'*)`,
    `          _t3code_exec_call_id=$(printf '%s\n' "$_t3code_line" | awk -F'"call_id":"' 'NF > 1 { sub(/".*/, "", $2); print $2; exit }')`,
    '          if [ -n "$_t3code_exec_call_id" ]; then',
    '            if [ "$_t3code_exec_call_id" != "$_t3code_last_exec_call_id" ]; then',
    '              _t3code_last_exec_call_id="$_t3code_exec_call_id"',
    '              _t3code_emit_event "Start"',
    "            fi",
    "          else",
    '            _t3code_emit_event "Start"',
    "          fi",
    "          ;;",
    "      esac",
    "    done",
    "  ) &",
    "  T3CODE_CODEX_START_WATCHER_PID=$!",
    "fi",
    `${shellQuote(targetPath)} --enable codex_hooks -c ${shellQuote(`notify=["bash",${JSON.stringify(notifyHookPath)}]`)} "$@"`,
    "_t3code_status=$?",
    'if [ -n "${T3CODE_CODEX_START_WATCHER_PID:-}" ]; then',
    '  kill "$T3CODE_CODEX_START_WATCHER_PID" >/dev/null 2>&1 || true',
    '  wait "$T3CODE_CODEX_START_WATCHER_PID" 2>/dev/null || true',
    "fi",
    'exit "$_t3code_status"',
  ].join("\n");
}

function buildWrapperScript(input: {
  claudeSettingsPath: string;
  cliKind: TerminalCliKind;
  codexHomeDir: string;
  notifyHookPath: string;
  targetPath: string;
}): string {
  const { claudeSettingsPath, cliKind, codexHomeDir, notifyHookPath, targetPath } = input;
  const commandName = managedTerminalCommandNameForCliKind(cliKind);
  const title = defaultTerminalTitleForCliKind(cliKind);
  const commandBody =
    cliKind === "claude"
      ? `exec ${shellQuote(targetPath)} --settings ${shellQuote(claudeSettingsPath)} "$@"`
      : buildCodexWrapperScript({ codexHomeDir, notifyHookPath, targetPath });
  return [
    "#!/bin/sh",
    `# Managed ${commandName} wrapper injected by t3code terminal sessions.`,
    `printf '\\033]0;%s\\007' ${shellQuote(title)}`,
    `export ${T3CODE_TERMINAL_CLI_KIND_ENV_KEY}=${shellQuote(cliKind)}`,
    commandBody,
    "",
  ].join("\n");
}

function writeFileIfChanged(filePath: string, content: string, mode: number): void {
  const currentContent = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null;
  if (currentContent !== content) {
    fs.writeFileSync(filePath, content, { mode });
  }
  try {
    fs.chmodSync(filePath, mode);
  } catch {
    // Best effort.
  }
}

function buildManagedZshRc(quotedZshDir: string): string {
  return `# FCode zsh rc wrapper
_t3code_home="\${T3CODE_ORIGINAL_ZDOTDIR:-$HOME}"
export ZDOTDIR="$_t3code_home"
[[ -f "$_t3code_home/.zshrc" ]] && source "$_t3code_home/.zshrc"
export ZDOTDIR=${quotedZshDir}
if [ -n "\${T3CODE_MANAGED_BIN_DIR:-}" ] && [ -d "\${T3CODE_MANAGED_BIN_DIR}" ]; then
  case ":$PATH:" in
    *:\${T3CODE_MANAGED_BIN_DIR}:*) ;;
    *) export PATH="\${T3CODE_MANAGED_BIN_DIR}:$PATH" ;;
  esac
  unalias claude 2>/dev/null || true
  claude() {
    if [ -x "\${T3CODE_MANAGED_BIN_DIR}/claude" ] && [ ! -d "\${T3CODE_MANAGED_BIN_DIR}/claude" ]; then
      "\${T3CODE_MANAGED_BIN_DIR}/claude" "$@"
    else
      command claude "$@"
    fi
  }
  unalias codex 2>/dev/null || true
  codex() {
    if [ -x "\${T3CODE_MANAGED_BIN_DIR}/codex" ] && [ ! -d "\${T3CODE_MANAGED_BIN_DIR}/codex" ]; then
      "\${T3CODE_MANAGED_BIN_DIR}/codex" "$@"
    else
      command codex "$@"
    fi
  }
  typeset -ga precmd_functions 2>/dev/null || true
  _t3code_ensure_managed_bin() {
    case ":$PATH:" in
      *:\${T3CODE_MANAGED_BIN_DIR}:*) ;;
      *) PATH="\${T3CODE_MANAGED_BIN_DIR}:$PATH" ;;
    esac
  }
  {
    precmd_functions=(\${precmd_functions:#_t3code_ensure_managed_bin} _t3code_ensure_managed_bin)
  } 2>/dev/null || true
fi
`;
}

function ensureManagedZshWrappers(zshDir: string): void {
  fs.mkdirSync(zshDir, { recursive: true });
  const quotedZshDir = shellQuote(zshDir);
  writeFileIfChanged(
    path.join(zshDir, ".zshenv"),
    `# FCode zsh env wrapper
_t3code_home="\${T3CODE_ORIGINAL_ZDOTDIR:-$HOME}"
export ZDOTDIR="$_t3code_home"
[[ -f "$_t3code_home/.zshenv" ]] && source "$_t3code_home/.zshenv"
export ZDOTDIR=${quotedZshDir}
`,
    0o644,
  );
  writeFileIfChanged(
    path.join(zshDir, ".zprofile"),
    `# FCode zsh profile wrapper
_t3code_home="\${T3CODE_ORIGINAL_ZDOTDIR:-$HOME}"
export ZDOTDIR="$_t3code_home"
[[ -f "$_t3code_home/.zprofile" ]] && source "$_t3code_home/.zprofile"
export ZDOTDIR=${quotedZshDir}
`,
    0o644,
  );
  writeFileIfChanged(path.join(zshDir, ".zshrc"), buildManagedZshRc(quotedZshDir), 0o644);
}

export function prepareManagedTerminalWrappers(options: {
  baseEnv: NodeJS.ProcessEnv;
  rootDir: string;
  zshRootDir: string;
}): ManagedTerminalWrapperState {
  if (process.platform === "win32") {
    return {
      binDir: null,
      codexHomeDir: null,
      hookScriptPath: null,
      claudeSettingsPath: null,
      zshDir: null,
      targetPathByCliKind: {},
    };
  }

  const targetPathByCliKind: Partial<Record<TerminalCliKind, string>> = {};
  for (const cliKind of ["codex", "claude"] as const) {
    const commandName = managedTerminalCommandNameForCliKind(cliKind);
    const targetPath = resolveExecutableOnPath(commandName, options.baseEnv);
    if (!targetPath) {
      continue;
    }
    targetPathByCliKind[cliKind] = targetPath;
  }

  if (Object.keys(targetPathByCliKind).length === 0) {
    return {
      binDir: null,
      codexHomeDir: null,
      hookScriptPath: null,
      claudeSettingsPath: null,
      zshDir: null,
      targetPathByCliKind,
    };
  }

  fs.mkdirSync(options.rootDir, { recursive: true });
  const codexHomeDir = path.join(options.rootDir, "codex-home");
  const hookScriptPath = path.join(options.rootDir, "notify-hook.sh");
  const claudeSettingsPath = path.join(options.rootDir, "claude-settings.json");
  fs.mkdirSync(codexHomeDir, { recursive: true });
  writeFileIfChanged(hookScriptPath, buildNotifyHookScript(), 0o755);
  writeFileIfChanged(claudeSettingsPath, buildClaudeSettingsJson(hookScriptPath), 0o644);
  writeFileIfChanged(
    path.join(codexHomeDir, "hooks.json"),
    buildCodexHooksJson(hookScriptPath),
    0o644,
  );
  for (const [cliKind, targetPath] of Object.entries(targetPathByCliKind) as Array<
    [TerminalCliKind, string]
  >) {
    const wrapperPath = path.join(options.rootDir, managedTerminalCommandNameForCliKind(cliKind));
    writeFileIfChanged(
      wrapperPath,
      buildWrapperScript({
        claudeSettingsPath,
        cliKind,
        codexHomeDir,
        notifyHookPath: hookScriptPath,
        targetPath,
      }),
      0o755,
    );
  }
  ensureManagedZshWrappers(options.zshRootDir);

  return {
    binDir: options.rootDir,
    codexHomeDir,
    hookScriptPath,
    claudeSettingsPath,
    zshDir: options.zshRootDir,
    targetPathByCliKind,
  };
}

function applyManagedTerminalWrapperEnvState(
  env: NodeJS.ProcessEnv,
  wrapperState: {
    binDir: string | null;
    zshDir: string | null;
  },
): NodeJS.ProcessEnv {
  if (!wrapperState.binDir) {
    return env;
  }

  const envPathKey = envPathKeyFor(env);
  const currentPath = env[envPathKey]?.trim() ?? "";
  const currentEntries = currentPath
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (!currentEntries.includes(wrapperState.binDir)) {
    currentEntries.unshift(wrapperState.binDir);
  }

  return {
    ...env,
    T3CODE_MANAGED_BIN_DIR: wrapperState.binDir,
    T3CODE_ORIGINAL_ZDOTDIR: env.ZDOTDIR ?? env.HOME ?? "",
    ...(wrapperState.zshDir ? { ZDOTDIR: wrapperState.zshDir } : {}),
    [envPathKey]: currentEntries.join(path.delimiter),
  };
}

export function applyManagedTerminalAgentWrapperEnv(
  env: NodeJS.ProcessEnv,
  wrapperState: {
    binDir: string | null;
    zshDir: string | null;
  },
): NodeJS.ProcessEnv {
  return applyManagedTerminalWrapperEnvState(env, wrapperState);
}

export function prepareManagedTerminalAgentWrappers(options: {
  baseEnv: NodeJS.ProcessEnv;
  targetDir: string;
  zshDir: string;
}): ManagedTerminalWrapperState {
  return prepareManagedTerminalWrappers({
    baseEnv: options.baseEnv,
    rootDir: options.targetDir,
    zshRootDir: options.zshDir,
  });
}

export function prependManagedTerminalAgentWrapperPath(
  env: NodeJS.ProcessEnv,
  managedWrapperState: {
    binDir: string | null;
    zshDir: string | null;
  },
): NodeJS.ProcessEnv {
  return applyManagedTerminalWrapperEnvState(env, managedWrapperState);
}
