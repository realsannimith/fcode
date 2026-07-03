// FILE: executableLookup.ts
// Purpose: Synchronous PATH/PATHEXT executable resolution shared by modules that
// need to know whether a CLI binary exists before spawning it.

import fs from "node:fs";
import path from "node:path";

export function envPathKeyFor(env: NodeJS.ProcessEnv): "PATH" | "Path" | "path" {
  if ("PATH" in env) return "PATH";
  if ("Path" in env) return "Path";
  return "path";
}

export function isExecutableFile(filePath: string): boolean {
  try {
    const stats = fs.statSync(filePath);
    if (!stats.isFile()) {
      return false;
    }
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function executableCandidates(commandName: string, env: NodeJS.ProcessEnv): string[] {
  if (process.platform !== "win32") {
    return [commandName];
  }

  const pathExt = env.PATHEXT?.split(";").filter(Boolean) ?? [".EXE", ".CMD", ".BAT"];
  const lowerCommandName = commandName.toLowerCase();
  const hasExtension = pathExt.some((extension) =>
    lowerCommandName.endsWith(extension.toLowerCase()),
  );
  return hasExtension ? [commandName] : pathExt.map((extension) => `${commandName}${extension}`);
}

/**
 * Resolve a command name against the PATH entries of `env`, returning the
 * absolute path of the first executable match, or null when nothing matches.
 * Command names that already contain a path separator are checked directly.
 */
export function resolveExecutableOnPath(
  commandName: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (commandName.includes("/") || commandName.includes(path.sep)) {
    for (const candidateName of executableCandidates(commandName, env)) {
      if (isExecutableFile(candidateName)) {
        return path.resolve(candidateName);
      }
    }
    return null;
  }

  const envPathKey = envPathKeyFor(env);
  const envPath = env[envPathKey]?.trim();
  if (!envPath) {
    return null;
  }

  for (const entry of envPath.split(path.delimiter)) {
    const directory = entry.trim();
    if (!directory) {
      continue;
    }
    for (const candidateName of executableCandidates(commandName, env)) {
      const candidatePath = path.join(directory, candidateName);
      if (isExecutableFile(candidatePath)) {
        return candidatePath;
      }
    }
  }

  return null;
}
