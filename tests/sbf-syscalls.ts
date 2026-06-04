import { execFileSync } from "child_process";
import { existsSync } from "fs";
import { dirname, join } from "path";
import { expect } from "chai";

describe("sbf syscall imports", () => {
  it("imports only allowed Solana runtime syscalls", () => {
    const programBinary = join(
      process.cwd(),
      "target/deploy/kamino_meta_vault.so"
    );
    expect(existsSync(programBinary), `${programBinary} must exist`).to.equal(
      true
    );

    const importedSymbols = readUndefinedGlobalSymbols(programBinary);
    expect(importedSymbols.globalUndefinedLineCount).to.be.greaterThan(0);
    expect(importedSymbols.symbols.length).to.be.greaterThan(0);

    const unexpectedSymbols = importedSymbols.symbols.filter(
      (symbol) => !allowedRuntimeSyscalls.has(symbol)
    );

    expect(unexpectedSymbols).to.deep.equal([]);
  });
});

const allowedRuntimeSyscalls = new Set([
  "abort",
  "sol_create_program_address",
  "sol_get_clock_sysvar",
  "sol_get_rent_sysvar",
  "sol_invoke_signed_rust",
  "sol_log_",
  "sol_log_data",
  "sol_log_pubkey",
  "sol_memcmp_",
  "sol_memcpy_",
  "sol_memmove_",
  "sol_memset_",
  "sol_panic_",
  "sol_try_find_program_address",
]);

function readUndefinedGlobalSymbols(programBinary: string) {
  const readelf = resolveLlvmReadelf();
  const output = execFileSync(readelf, ["-sW", programBinary], {
    encoding: "utf8",
  });
  const symbols = new Set<string>();
  let globalUndefinedLineCount = 0;

  for (const line of output.split("\n")) {
    if (/\bGLOBAL\s+DEFAULT\s+UND\b/.test(line)) {
      globalUndefinedLineCount += 1;
    }

    const match = line.match(/\bGLOBAL\s+DEFAULT\s+UND\s+(\S+)\s*$/);
    if (match) {
      symbols.add(match[1]);
    }
  }

  return {
    globalUndefinedLineCount,
    symbols: [...symbols].sort(),
  };
}

function resolveLlvmReadelf() {
  if (process.env.SBF_LLVM_READELF) {
    return process.env.SBF_LLVM_READELF;
  }

  try {
    const solana = execFileSync("which", ["solana"], {
      encoding: "utf8",
    }).trim();
    const fromSolanaInstall = join(
      dirname(solana),
      "platform-tools-sdk/sbf/dependencies/platform-tools/llvm/bin/llvm-readelf"
    );
    if (existsSync(fromSolanaInstall)) {
      return fromSolanaInstall;
    }
  } catch {
    // Fall back to PATH below.
  }

  return "llvm-readelf";
}
