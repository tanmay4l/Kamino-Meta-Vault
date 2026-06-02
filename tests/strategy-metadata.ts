import { createHash } from "crypto";
import { expect } from "chai";

interface StrategyReserve {
  reserve: string;
  targetAllocationWeight: number;
  allocationCap: string;
}

interface StrategyMetadata {
  version: number;
  name: string;
  tokenMint: string;
  curator: string;
  vaultTokenSymbol: string;
  vaultTokenName: string;
  performanceFeeRatePercentage: string;
  managementFeeRatePercentage: string;
  reserves: StrategyReserve[];
  riskSummary: string;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)])
    );
  }

  return value;
}

function canonicalJson(metadata: StrategyMetadata): string {
  return JSON.stringify(canonicalize(metadata));
}

function strategyMetadataHash(metadata: StrategyMetadata): Buffer {
  return createHash("sha256").update(canonicalJson(metadata)).digest();
}

describe("strategy metadata", () => {
  const metadata: StrategyMetadata = {
    version: 1,
    name: "MetaUSDC Conservative",
    tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    curator: "11111111111111111111111111111111",
    vaultTokenSymbol: "USDC",
    vaultTokenName: "MetaUSDC",
    performanceFeeRatePercentage: "15.0",
    managementFeeRatePercentage: "2.0",
    reserves: [
      {
        reserve: "11111111111111111111111111111111",
        targetAllocationWeight: 10_000,
        allocationCap: "1000000",
      },
    ],
    riskSummary: "Test strategy",
  };

  it("uses canonical key ordering for deterministic proposal hashes", () => {
    const reordered = {
      riskSummary: metadata.riskSummary,
      reserves: metadata.reserves,
      managementFeeRatePercentage: metadata.managementFeeRatePercentage,
      performanceFeeRatePercentage: metadata.performanceFeeRatePercentage,
      vaultTokenName: metadata.vaultTokenName,
      vaultTokenSymbol: metadata.vaultTokenSymbol,
      curator: metadata.curator,
      tokenMint: metadata.tokenMint,
      name: metadata.name,
      version: metadata.version,
    } as StrategyMetadata;

    expect(canonicalJson(metadata)).to.equal(canonicalJson(reordered));
    expect(strategyMetadataHash(metadata)).to.deep.equal(
      strategyMetadataHash(reordered)
    );
    expect(strategyMetadataHash(metadata)).to.have.length(32);
  });
});
