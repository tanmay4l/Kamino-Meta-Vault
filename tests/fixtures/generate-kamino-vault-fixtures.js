const fs = require("fs");
const path = require("path");
const anchor = require("@anchor-lang/core");

const root = path.join(__dirname, "..", "..");
const idlPath = path.join(root, "target", "idl", "kamino_meta_vault.json");
let programIdValue;

if (fs.existsSync(idlPath)) {
  programIdValue = JSON.parse(fs.readFileSync(idlPath, "utf8")).address;
} else {
  const anchorToml = fs.readFileSync(path.join(root, "Anchor.toml"), "utf8");
  const programIdMatch = anchorToml.match(/kamino_meta_vault\s*=\s*"([^"]+)"/);
  programIdValue = programIdMatch?.[1];
}

if (!programIdValue) {
  throw new Error("kamino_meta_vault program id not found");
}

const programId = new anchor.web3.PublicKey(programIdValue);
const mint = anchor.web3.Keypair.fromSecretKey(
  Uint8Array.from([
    228, 49, 22, 82, 133, 119, 6, 218, 2, 191, 190, 238, 145, 67, 69, 181, 47,
    165, 121, 103, 176, 86, 208, 222, 39, 187, 5, 63, 47, 213, 7, 92, 96, 151,
    31, 140, 5, 43, 88, 244, 183, 88, 157, 8, 166, 1, 140, 194, 101, 2, 135,
    129, 86, 134, 75, 109, 232, 203, 30, 99, 71, 69, 42, 121,
  ])
).publicKey;
const [config] = anchor.web3.PublicKey.findProgramAddressSync(
  [Buffer.from("config"), mint.toBuffer()],
  programId
);
const [daoAuthority] = anchor.web3.PublicKey.findProgramAddressSync(
  [Buffer.from("authority"), config.toBuffer()],
  programId
);

const discriminator = Buffer.from([228, 196, 82, 165, 98, 210, 235, 152]);
const kvaultProgramId = "KvauGMspG5k6rtzrqqn7WNn3oZdyKqLKwK2XWQ8FLjd";
const wrongAdmin = new anchor.web3.PublicKey(
  "Exg8rVFeb34d63innYWGvLnSrvsEeQNKxQgNd7MgU9MZ"
);
const wrongMint = new anchor.web3.PublicKey(
  "6L8ZFvYHqW5Y3zvE1ajBjN9Fo4SC8aLsn9BQkMDv71DS"
);

function vaultData(admin, tokenMint) {
  const data = Buffer.alloc(112);
  discriminator.copy(data, 0);
  admin.toBuffer().copy(data, 8);
  tokenMint.toBuffer().copy(data, 80);
  return data.toString("base64");
}

function fixture(pubkey, data) {
  return {
    pubkey,
    account: {
      lamports: 1670400,
      data: [data, "base64"],
      owner: kvaultProgramId,
      executable: false,
      rentEpoch: "18446744073709551615",
      space: 112,
    },
  };
}

const fixtures = [
  [
    "kamino-vault-state.json",
    fixture(
      "3WG4wtgB2Pqz1d4z3ca3NJoNDa6L33UKMinEBj8L4VLk",
      vaultData(daoAuthority, mint)
    ),
  ],
  [
    "kamino-vault-state-wrong-admin.json",
    fixture(
      "DwR2UyEQpSMuvvJDW4kFx3ceEixTfNGe6k9tQ6xkAZbn",
      vaultData(wrongAdmin, mint)
    ),
  ],
  [
    "kamino-vault-state-wrong-mint.json",
    fixture(
      "CXrSsH1HTGNa4Z21KpkexaL36kHEDY4MQBBtxtErgRu6",
      vaultData(daoAuthority, wrongMint)
    ),
  ],
];

for (const [filename, contents] of fixtures) {
  const json = JSON.stringify(contents, null, 2).replace(
    /"rentEpoch": "18446744073709551615"/g,
    '"rentEpoch": 18446744073709551615'
  );
  fs.writeFileSync(path.join(__dirname, filename), `${json}\n`);
}

console.log(`Generated Kamino fixtures for ${programId.toBase58()}`);
