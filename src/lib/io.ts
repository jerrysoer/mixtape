// All user-facing output goes through here (no console.log in product code).
export function out(line = ""): void {
  process.stdout.write(line + "\n");
}

export function err(line: string): void {
  process.stderr.write(line + "\n");
}

export class MixtapeError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
    this.name = "MixtapeError";
  }
}
