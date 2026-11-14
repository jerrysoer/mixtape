#!/usr/bin/env node
import { buildProgram } from "./cli.js";
import { MixtapeError, err } from "./lib/io.js";

buildProgram()
  .parseAsync(process.argv)
  .catch((e: unknown) => {
    if (e instanceof MixtapeError) {
      err(e.message);
      process.exitCode = e.exitCode;
      return;
    }
    err("Unexpected error. Run with NODE_DEBUG=mixtape for details.");
    if (process.env["NODE_DEBUG"]?.includes("mixtape")) console.error(e);
    process.exitCode = 1;
  });
