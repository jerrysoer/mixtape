import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildProgram } from "./cli.js";
import { shortVersion } from "./commands/doctor.js";
import { MixtapeError } from "./lib/io.js";

describe("CLI surface", () => {
  it("lists doctor and every pipeline command", () => {
    const names = buildProgram().commands.map((c) => c.name());
    expect(names).toEqual(["doctor", "break", "hook", "press", "render", "batch", "spy"]);
  });

  it("uses press, not adapt", () => {
    expect(buildProgram().commands.map((c) => c.name())).not.toContain("adapt");
  });

  it("spy refuses to call anything without a SEARCHAPI_KEY", async () => {
    const program = buildProgram().exitOverride();
    const saved = process.env["SEARCHAPI_KEY"];
    process.env["SEARCHAPI_KEY"] = "";
    try {
      await expect(program.parseAsync(["node", "mixtape", "spy", "acme"])).rejects.toSatisfy((e: unknown) => e instanceof MixtapeError && e.message.includes("SEARCHAPI_KEY"));
    } finally {
      if (saved === undefined) delete process.env["SEARCHAPI_KEY"];
      else process.env["SEARCHAPI_KEY"] = saved;
    }
  });

  it("installs as both mixtape and mx", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { bin: Record<string, string> };
    expect(pkg.bin).toEqual({ mixtape: "dist/bin.js", mx: "dist/bin.js" });
  });
});

describe("fixtures", () => {
  it("use fictional brands only", () => {
    const f = JSON.parse(readFileSync(new URL("../fixtures/brands.json", import.meta.url), "utf8")) as { ads: { brand: string }[] };
    expect(new Set(f.ads.map((a) => a.brand))).toEqual(new Set(["Fuelwell", "Northpeak Sleep"]));
    expect(f.ads).toHaveLength(12);
  });
});

describe("doctor", () => {
  it("shortens tool version lines", () => {
    expect(shortVersion("ffmpeg version 9.0.2 Copyright (c) 2000-2026")).toBe("9.0.2");
    expect(shortVersion('{"schemaVersion":"1","ok":true,"data":{"version":"1.0.1"}}')).toBe("1.0.1");
    expect(shortVersion("v26.11.1")).toBe("26.11.1");
  });
});
