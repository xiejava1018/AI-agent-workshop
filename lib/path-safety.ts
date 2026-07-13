import { realpathSync } from "fs";
import { resolve, normalize, isAbsolute, relative } from "path";

export class PathTraversalError extends Error {
  constructor(public readonly input: string, public readonly root: string) {
    super(`path outside root: ${input} not within ${root}`);
    this.name = "PathTraversalError";
  }
}

export function assertWithinRoot(input: string, root: string): string {
  const fullInput = isAbsolute(input) ? normalize(input) : resolve(root, input);
  const fullRoot = resolve(root);
  let realInput: string;
  try {
    realInput = realpathSync(fullInput);
  } catch {
    realInput = fullInput;
  }
  let realRoot: string;
  try {
    realRoot = realpathSync(fullRoot);
  } catch (e) {
    throw new PathTraversalError(input, root);
  }
  const rel = relative(realRoot, realInput);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new PathTraversalError(input, root);
  }
  return realInput;
}
