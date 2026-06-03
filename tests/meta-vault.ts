import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { expect } from "chai";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccount,
  createMint,
  getAccount,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { KaminoMetaVault } from "../target/types/kamino_meta_vault";

describe("kamino-meta-vault", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const program = anchor.workspace.KaminoMetaVault as Program<KaminoMetaVault>;
  const payer = (
    provider.wallet as anchor.Wallet & { payer: anchor.web3.Keypair }
  ).payer;

  const metadataHash = Array(32).fill(7);
  const maxProposals = 16;
  const kaminoKvaultProgramId = new anchor.web3.PublicKey(
    "KvauGMspG5k6rtzrqqn7WNn3oZdyKqLKwK2XWQ8FLjd"
  );
  const initializedKaminoVault = new anchor.web3.PublicKey(
    "3WG4wtgB2Pqz1d4z3ca3NJoNDa6L33UKMinEBj8L4VLk"
  );
  const wrongAdminKaminoVault = new anchor.web3.PublicKey(
    "DwR2UyEQpSMuvvJDW4kFx3ceEixTfNGe6k9tQ6xkAZbn"
  );
  const wrongMintKaminoVault = new anchor.web3.PublicKey(
    "CXrSsH1HTGNa4Z21KpkexaL36kHEDY4MQBBtxtErgRu6"
  );
  const initializedKaminoVaultMint = anchor.web3.Keypair.fromSecretKey(
    Uint8Array.from([
      228, 49, 22, 82, 133, 119, 6, 218, 2, 191, 190, 238, 145, 67, 69, 181, 47,
      165, 121, 103, 176, 86, 208, 222, 39, 187, 5, 63, 47, 213, 7, 92, 96, 151,
      31, 140, 5, 43, 88, 244, 183, 88, 157, 8, 166, 1, 140, 194, 101, 2, 135,
      129, 86, 134, 75, 109, 232, 203, 30, 99, 71, 69, 42, 121,
    ])
  );

  async function setupConfig(
    quorumBps = 5_000,
    deadlineOffsets = { deposit: 20, voting: 24 },
    mintKeypair?: anchor.web3.Keypair
  ) {
    const mint = await createMint(
      provider.connection,
      payer,
      payer.publicKey,
      null,
      6,
      mintKeypair
    );
    const ownerAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer,
      mint,
      payer.publicKey
    );
    await mintTo(
      provider.connection,
      payer,
      mint,
      ownerAta.address,
      payer,
      5_000_000
    );

    const [config] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("config"), mint.toBuffer()],
      program.programId
    );
    const [daoAuthority] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("authority"), config.toBuffer()],
      program.programId
    );
    const [bondVault] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("bond_vault"), config.toBuffer()],
      program.programId
    );
    const [position] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("position"), config.toBuffer(), payer.publicKey.toBuffer()],
      program.programId
    );

    const currentSlot = await provider.connection.getSlot();
    const depositDeadline = currentSlot + deadlineOffsets.deposit;
    const votingDeadline = currentSlot + deadlineOffsets.voting;

    await program.methods
      .initializeConfig(
        new anchor.BN(depositDeadline),
        new anchor.BN(votingDeadline),
        new anchor.BN(100_000),
        quorumBps
      )
      .accountsStrict({
        payer: payer.publicKey,
        tokenMint: mint,
        config,
        daoAuthority,
        bondVault,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    return {
      mint,
      ownerAta: ownerAta.address,
      config,
      daoAuthority,
      bondVault,
      position,
      depositDeadline,
      votingDeadline,
    };
  }

  function proposalAddress(config: anchor.web3.PublicKey, proposalId: number) {
    return anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("proposal"),
        config.toBuffer(),
        new anchor.BN(proposalId).toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    )[0];
  }

  function positionAddress(
    config: anchor.web3.PublicKey,
    owner: anchor.web3.PublicKey
  ) {
    return anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("position"), config.toBuffer(), owner.toBuffer()],
      program.programId
    )[0];
  }

  async function warpPast(slot: number) {
    const target = slot + 1;
    const connection = provider.connection as anchor.web3.Connection & {
      _rpcRequest?: (method: string, args: unknown[]) => Promise<unknown>;
      _blockhashInfo?: {
        latestBlockhash: unknown | null;
        lastFetch: number;
        simulatedSignatures: string[];
        transactionSignatures: string[];
      };
    };

    for (let i = 0; connection._rpcRequest && i < 5; i += 1) {
      const response = await connection._rpcRequest("warpSlot", [target]);
      if (
        response &&
        typeof response === "object" &&
        "error" in response &&
        response.error
      ) {
        break;
      }
      if (connection._blockhashInfo) {
        connection._blockhashInfo = {
          latestBlockhash: null,
          lastFetch: 0,
          simulatedSignatures: [],
          transactionSignatures: [],
        };
      }

      for (let attempt = 0; attempt < 20; attempt += 1) {
        const currentSlot = await provider.connection.getSlot();
        if (currentSlot >= target) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    for (let i = 0; i < 200; i += 1) {
      const currentSlot = await provider.connection.getSlot();
      if (currentSlot >= target) {
        return;
      }

      const tx = new anchor.web3.Transaction().add(
        anchor.web3.SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: payer.publicKey,
          lamports: 1,
        })
      );
      const { blockhash } = await provider.connection.getLatestBlockhash();
      tx.feePayer = payer.publicKey;
      tx.recentBlockhash = blockhash;
      tx.sign(payer);
      const signature = await provider.connection
        .sendRawTransaction(tx.serialize(), {
          skipPreflight: false,
          maxRetries: 10,
        })
        .catch(() => null);

      for (let attempt = 0; attempt < 20; attempt += 1) {
        const nextSlot = await provider.connection.getSlot();
        if (nextSlot >= target) {
          return;
        }
        if (signature) {
          const status = await provider.connection.getSignatureStatuses([
            signature,
          ]);
          const value = status.value[0];
          if (value?.err) {
            break;
          }
          if (value?.confirmationStatus) {
            break;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    throw new Error(`slot did not advance to ${target}`);
  }

  async function ageBond(position: anchor.web3.PublicKey) {
    const positionState = await program.account.voterPosition.fetch(position);
    await warpPast(positionState.startSlot.toNumber() + 1);
  }

  async function deposit(
    config: anchor.web3.PublicKey,
    position: anchor.web3.PublicKey,
    owner: anchor.web3.Keypair,
    ownerTokenAccount: anchor.web3.PublicKey,
    bondVault: anchor.web3.PublicKey,
    amount: number
  ) {
    await program.methods
      .deposit(new anchor.BN(amount))
      .accountsStrict({
        owner: owner.publicKey,
        config,
        position,
        ownerTokenAccount,
        bondVault,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers(owner === payer ? [] : [owner])
      .rpc();
  }

  async function createProposal(
    config: anchor.web3.PublicKey,
    proposalId: number
  ) {
    const proposal = proposalAddress(config, proposalId);
    await program.methods
      .createProposal(
        payer.publicKey,
        metadataHash,
        "USDC conservative curator"
      )
      .accountsStrict({
        proposer: payer.publicKey,
        config,
        proposal,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    return proposal;
  }

  async function vote(
    config: anchor.web3.PublicKey,
    position: anchor.web3.PublicKey,
    proposal: anchor.web3.PublicKey,
    owner: anchor.web3.Keypair
  ) {
    await program.methods
      .vote()
      .accountsStrict({
        owner: owner.publicKey,
        config,
        position,
        proposal,
      })
      .signers(owner === payer ? [] : [owner])
      .rpc();
  }

  async function setupSecondVoter(
    mint: anchor.web3.PublicKey,
    config: anchor.web3.PublicKey
  ) {
    const second = anchor.web3.Keypair.generate();
    await fundSigner(second);
    const secondAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer,
      mint,
      second.publicKey
    );
    await mintTo(
      provider.connection,
      payer,
      mint,
      secondAta.address,
      payer,
      1_000_000
    );

    return {
      keypair: second,
      ata: secondAta.address,
      position: positionAddress(config, second.publicKey),
    };
  }

  async function fundSigner(signer: anchor.web3.Keypair) {
    const targetBalance = 500_000_000;
    const currentBalance = await provider.connection.getBalance(
      signer.publicKey
    );
    if (currentBalance >= targetBalance) {
      return;
    }

    await provider.connection.requestAirdrop(signer.publicKey, targetBalance);
    for (let i = 0; i < 50; i += 1) {
      const balance = await provider.connection.getBalance(signer.publicKey);
      if (balance >= targetBalance) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`airdrop did not fund ${signer.publicKey.toBase58()}`);
  }

  async function setupVoter(
    mint: anchor.web3.PublicKey,
    config: anchor.web3.PublicKey
  ) {
    const voter = anchor.web3.Keypair.generate();
    await fundSigner(voter);
    const ata = await createAssociatedTokenAccount(
      provider.connection,
      payer,
      mint,
      voter.publicKey
    );
    await mintTo(provider.connection, payer, mint, ata, payer, 2_000_000);

    return {
      keypair: voter,
      ata,
      position: positionAddress(config, voter.publicKey),
    };
  }

  async function createOwnedAccount(owner: anchor.web3.PublicKey) {
    const account = anchor.web3.Keypair.generate();
    const lamports =
      await provider.connection.getMinimumBalanceForRentExemption(8);
    const tx = new anchor.web3.Transaction().add(
      anchor.web3.SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: account.publicKey,
        lamports,
        space: 8,
        programId: owner,
      })
    );

    await provider.sendAndConfirm(tx, [payer, account]);
    return account.publicKey;
  }

  async function createKaminoVaultAccount() {
    return initializedKaminoVault;
  }

  async function expectRpcError(
    action: () => Promise<unknown>,
    message: string
  ) {
    try {
      await action();
      expect.fail(`expected ${message}`);
    } catch (err) {
      expect(String(err)).to.include(message);
    }
  }

  it("initializes multiple configs for the same mint with explicit seeds", async () => {
    const mint = await createMint(
      provider.connection,
      payer,
      payer.publicKey,
      null,
      6
    );
    const configSeeds = [Buffer.alloc(32, 1), Buffer.alloc(32, 2)];
    const configs: anchor.web3.PublicKey[] = [];

    for (const configSeed of configSeeds) {
      const [config] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("config"), mint.toBuffer(), configSeed],
        program.programId
      );
      const [daoAuthority] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("authority"), config.toBuffer()],
        program.programId
      );
      const [bondVault] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("bond_vault"), config.toBuffer()],
        program.programId
      );
      const currentSlot = await provider.connection.getSlot();

      await program.methods
        .initializeConfigWithSeed(
          Array.from(configSeed),
          new anchor.BN(currentSlot + 20),
          new anchor.BN(currentSlot + 30),
          new anchor.BN(100_000),
          5_000
        )
        .accountsStrict({
          payer: payer.publicKey,
          tokenMint: mint,
          config,
          daoAuthority,
          bondVault,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .rpc();

      configs.push(config);
    }

    expect(configs[0].equals(configs[1])).to.equal(false);
    const [firstState, secondState] = await Promise.all(
      configs.map((config) => program.account.metaVaultConfig.fetch(config))
    );
    expect(firstState.tokenMint.toBase58()).to.equal(mint.toBase58());
    expect(secondState.tokenMint.toBase58()).to.equal(mint.toBase58());
    expect(firstState.bondVault.equals(secondState.bondVault)).to.equal(false);
  });

  it("rejects proposals without a title or metadata commitment", async () => {
    const ctx = await setupConfig();
    const proposal = proposalAddress(ctx.config, 0);

    await expectRpcError(
      () =>
        program.methods
          .createProposal(payer.publicKey, metadataHash, "")
          .accountsStrict({
            proposer: payer.publicKey,
            config: ctx.config,
            proposal,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .rpc(),
      "InvalidProposalTitle"
    );

    await expectRpcError(
      () =>
        program.methods
          .createProposal(
            payer.publicKey,
            Array(32).fill(0),
            "USDC conservative curator"
          )
          .accountsStrict({
            proposer: payer.publicKey,
            config: ctx.config,
            proposal,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .rpc(),
      "InvalidProposalMetadata"
    );

    const configState = await program.account.metaVaultConfig.fetch(ctx.config);
    expect(configState.proposalCount.toNumber()).to.equal(0);

    await createProposal(ctx.config, 0);
    const validConfigState = await program.account.metaVaultConfig.fetch(
      ctx.config
    );
    expect(validConfigState.proposalCount.toNumber()).to.equal(1);
  });

  it("accepts a bond, records a proposal vote, and blocks withdrawal while voted", async () => {
    const ctx = await setupConfig();
    const proposal = await createProposal(ctx.config, 0);

    await deposit(
      ctx.config,
      ctx.position,
      payer,
      ctx.ownerAta,
      ctx.bondVault,
      250_000
    );
    await ageBond(ctx.position);
    await vote(ctx.config, ctx.position, proposal, payer);

    const configState = await program.account.metaVaultConfig.fetch(ctx.config);
    const proposalState = await program.account.strategyProposal.fetch(
      proposal
    );
    const vaultState = await getAccount(provider.connection, ctx.bondVault);

    expect(configState.totalBonded.toNumber()).to.equal(250_000);
    expect(configState.totalVotedPrincipal.toNumber()).to.equal(250_000);
    expect(proposalState.supportPrincipal.toNumber()).to.equal(250_000);
    expect(vaultState.amount).to.equal(250_000n);

    await expectRpcError(
      () =>
        program.methods
          .withdraw(new anchor.BN(1))
          .accountsStrict({
            owner: payer.publicKey,
            config: ctx.config,
            position: ctx.position,
            ownerTokenAccount: ctx.ownerAta,
            bondVault: ctx.bondVault,
            daoAuthority: ctx.daoAuthority,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc(),
      "ActiveVote"
    );
  });

  it("retracts votes and allows pre-finalization withdrawal", async () => {
    const ctx = await setupConfig();
    const proposal = await createProposal(ctx.config, 0);

    await deposit(
      ctx.config,
      ctx.position,
      payer,
      ctx.ownerAta,
      ctx.bondVault,
      300_000
    );
    await ageBond(ctx.position);
    await vote(ctx.config, ctx.position, proposal, payer);

    await program.methods
      .retractVote()
      .accountsStrict({
        owner: payer.publicKey,
        config: ctx.config,
        position: ctx.position,
        proposal,
      })
      .rpc();

    await program.methods
      .withdraw(new anchor.BN(100_000))
      .accountsStrict({
        owner: payer.publicKey,
        config: ctx.config,
        position: ctx.position,
        ownerTokenAccount: ctx.ownerAta,
        bondVault: ctx.bondVault,
        daoAuthority: ctx.daoAuthority,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const configState = await program.account.metaVaultConfig.fetch(ctx.config);
    const proposalState = await program.account.strategyProposal.fetch(
      proposal
    );
    expect(configState.totalBonded.toNumber()).to.equal(200_000);
    expect(configState.totalVotedPrincipal.toNumber()).to.equal(0);
    expect(proposalState.supportPrincipal.toNumber()).to.equal(0);
  });

  it("closes an empty position and rejects active or funded positions", async () => {
    const ctx = await setupConfig();
    const proposal = await createProposal(ctx.config, 0);

    await deposit(
      ctx.config,
      ctx.position,
      payer,
      ctx.ownerAta,
      ctx.bondVault,
      300_000
    );
    await ageBond(ctx.position);
    await vote(ctx.config, ctx.position, proposal, payer);

    await expectRpcError(
      () =>
        program.methods
          .closePosition()
          .accountsStrict({
            owner: payer.publicKey,
            config: ctx.config,
            position: ctx.position,
          })
          .rpc(),
      "ActiveVote"
    );

    await program.methods
      .retractVote()
      .accountsStrict({
        owner: payer.publicKey,
        config: ctx.config,
        position: ctx.position,
        proposal,
      })
      .rpc();

    await expectRpcError(
      () =>
        program.methods
          .closePosition()
          .accountsStrict({
            owner: payer.publicKey,
            config: ctx.config,
            position: ctx.position,
          })
          .rpc(),
      "InsufficientBond"
    );

    await program.methods
      .withdraw(new anchor.BN(300_000))
      .accountsStrict({
        owner: payer.publicKey,
        config: ctx.config,
        position: ctx.position,
        ownerTokenAccount: ctx.ownerAta,
        bondVault: ctx.bondVault,
        daoAuthority: ctx.daoAuthority,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    await program.methods
      .closePosition()
      .accountsStrict({
        owner: payer.publicKey,
        config: ctx.config,
        position: ctx.position,
      })
      .rpc();

    const closedPosition = await program.account.voterPosition.fetchNullable(
      ctx.position
    );
    expect(closedPosition).to.equal(null);
  });

  it("rejects deposits after the deposit deadline", async () => {
    const ctx = await setupConfig(5_000, { deposit: 1, voting: 1 });
    await warpPast(ctx.depositDeadline);

    await expectRpcError(
      () =>
        deposit(
          ctx.config,
          ctx.position,
          payer,
          ctx.ownerAta,
          ctx.bondVault,
          250_000
        ),
      "DepositsClosed"
    );
  });

  it("enforces pause authority and blocks deposits while paused", async () => {
    const ctx = await setupConfig();
    const nonAuthority = anchor.web3.Keypair.generate();

    await expectRpcError(
      () =>
        program.methods
          .setPaused(true)
          .accountsStrict({
            authority: nonAuthority.publicKey,
            config: ctx.config,
          })
          .signers([nonAuthority])
          .rpc(),
      "Unauthorized"
    );

    await program.methods
      .setPaused(true)
      .accountsStrict({
        authority: payer.publicKey,
        config: ctx.config,
      })
      .rpc();

    await expectRpcError(
      () =>
        deposit(
          ctx.config,
          ctx.position,
          payer,
          ctx.ownerAta,
          ctx.bondVault,
          250_000
        ),
      "Paused"
    );
  });

  it("rejects spoofed token accounts and PDA authorities", async () => {
    const ctx = await setupConfig();
    const wrongMint = await createMint(
      provider.connection,
      payer,
      payer.publicKey,
      null,
      6
    );
    const wrongMintAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer,
      wrongMint,
      payer.publicKey
    );
    await mintTo(
      provider.connection,
      payer,
      wrongMint,
      wrongMintAta.address,
      payer,
      250_000
    );

    await expectRpcError(
      () =>
        deposit(
          ctx.config,
          ctx.position,
          payer,
          wrongMintAta.address,
          ctx.bondVault,
          250_000
        ),
      "ConstraintRaw"
    );

    await expectRpcError(
      () =>
        deposit(
          ctx.config,
          ctx.position,
          payer,
          ctx.ownerAta,
          wrongMintAta.address,
          250_000
        ),
      "ConstraintAddress"
    );

    const otherOwner = anchor.web3.Keypair.generate();
    const otherOwnerAta = await createAssociatedTokenAccount(
      provider.connection,
      payer,
      ctx.mint,
      otherOwner.publicKey
    );
    await mintTo(
      provider.connection,
      payer,
      ctx.mint,
      otherOwnerAta,
      payer,
      250_000
    );

    await expectRpcError(
      () =>
        deposit(
          ctx.config,
          ctx.position,
          payer,
          otherOwnerAta,
          ctx.bondVault,
          250_000
        ),
      "Unauthorized"
    );

    await deposit(
      ctx.config,
      ctx.position,
      payer,
      ctx.ownerAta,
      ctx.bondVault,
      250_000
    );

    await expectRpcError(
      () =>
        program.methods
          .withdraw(new anchor.BN(100_000))
          .accountsStrict({
            owner: payer.publicKey,
            config: ctx.config,
            position: ctx.position,
            ownerTokenAccount: ctx.ownerAta,
            bondVault: ctx.bondVault,
            daoAuthority: payer.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc(),
      "ConstraintSeeds"
    );

    await expectRpcError(
      () =>
        program.methods
          .withdraw(new anchor.BN(100_000))
          .accountsStrict({
            owner: payer.publicKey,
            config: ctx.config,
            position: ctx.position,
            ownerTokenAccount: otherOwnerAta,
            bondVault: ctx.bondVault,
            daoAuthority: ctx.daoAuthority,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc(),
      "Unauthorized"
    );
  });

  it("transfers config authority for multisig handoff", async () => {
    const ctx = await setupConfig();
    const newAuthority = anchor.web3.Keypair.generate();
    const nonAuthority = anchor.web3.Keypair.generate();

    await expectRpcError(
      () =>
        program.methods
          .transferAuthority(newAuthority.publicKey)
          .accountsStrict({
            authority: nonAuthority.publicKey,
            config: ctx.config,
          })
          .signers([nonAuthority])
          .rpc(),
      "Unauthorized"
    );

    await expectRpcError(
      () =>
        program.methods
          .transferAuthority(anchor.web3.PublicKey.default)
          .accountsStrict({
            authority: payer.publicKey,
            config: ctx.config,
          })
          .rpc(),
      "InvalidConfig"
    );

    await program.methods
      .transferAuthority(newAuthority.publicKey)
      .accountsStrict({
        authority: payer.publicKey,
        config: ctx.config,
      })
      .rpc();

    const configState = await program.account.metaVaultConfig.fetch(ctx.config);
    expect(configState.authority.toBase58()).to.equal(
      newAuthority.publicKey.toBase58()
    );

    await expectRpcError(
      () =>
        program.methods
          .setPaused(true)
          .accountsStrict({
            authority: payer.publicKey,
            config: ctx.config,
          })
          .rpc(),
      "Unauthorized"
    );

    await program.methods
      .setPaused(true)
      .accountsStrict({
        authority: newAuthority.publicKey,
        config: ctx.config,
      })
      .signers([newAuthority])
      .rpc();

    const pausedConfig = await program.account.metaVaultConfig.fetch(
      ctx.config
    );
    expect(pausedConfig.paused).to.equal(true);
  });

  it("caps proposal creation to keep campaign closeout bounded", async () => {
    const ctx = await setupConfig(5_000, { deposit: 40, voting: 80 });

    for (let proposalId = 0; proposalId < maxProposals; proposalId += 1) {
      await createProposal(ctx.config, proposalId);
    }

    const configState = await program.account.metaVaultConfig.fetch(ctx.config);
    expect(configState.proposalCount.toNumber()).to.equal(maxProposals);

    await expectRpcError(
      () =>
        program.methods
          .createProposal(
            payer.publicKey,
            metadataHash,
            "extra curator strategy"
          )
          .accountsStrict({
            proposer: payer.publicKey,
            config: ctx.config,
            proposal: proposalAddress(ctx.config, maxProposals),
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .rpc(),
      "ProposalLimitReached"
    );

    const unchangedState = await program.account.metaVaultConfig.fetch(
      ctx.config
    );
    expect(unchangedState.proposalCount.toNumber()).to.equal(maxProposals);
  });

  it("lets the proposer cancel an unvoted proposal and blocks inactive proposal votes", async () => {
    const ctx = await setupConfig();
    const proposal = await createProposal(ctx.config, 0);
    const nonProposer = anchor.web3.Keypair.generate();

    await expectRpcError(
      () =>
        program.methods
          .cancelProposal()
          .accountsStrict({
            signer: nonProposer.publicKey,
            config: ctx.config,
            proposal,
          })
          .signers([nonProposer])
          .rpc(),
      "Unauthorized"
    );

    await program.methods
      .cancelProposal()
      .accountsStrict({
        signer: payer.publicKey,
        config: ctx.config,
        proposal,
      })
      .rpc();

    const proposalState = await program.account.strategyProposal.fetch(
      proposal
    );
    expect(proposalState.active).to.equal(false);

    await deposit(
      ctx.config,
      ctx.position,
      payer,
      ctx.ownerAta,
      ctx.bondVault,
      250_000
    );
    await ageBond(ctx.position);
    await expectRpcError(
      () => vote(ctx.config, ctx.position, proposal, payer),
      "InactiveProposal"
    );
  });

  it("rejects canceling a proposal after votes exist", async () => {
    const ctx = await setupConfig();
    const proposal = await createProposal(ctx.config, 0);

    await deposit(
      ctx.config,
      ctx.position,
      payer,
      ctx.ownerAta,
      ctx.bondVault,
      250_000
    );
    await ageBond(ctx.position);
    await vote(ctx.config, ctx.position, proposal, payer);

    await expectRpcError(
      () =>
        program.methods
          .cancelProposal()
          .accountsStrict({
            signer: payer.publicKey,
            config: ctx.config,
            proposal,
          })
          .rpc(),
      "ProposalHasVotes"
    );

    const proposalState = await program.account.strategyProposal.fetch(
      proposal
    );
    expect(proposalState.active).to.equal(true);
  });

  it("rejects young votes and double voting", async () => {
    const ctx = await setupConfig();
    const proposal = await createProposal(ctx.config, 0);
    await deposit(
      ctx.config,
      ctx.position,
      payer,
      ctx.ownerAta,
      ctx.bondVault,
      250_000
    );

    await expectRpcError(
      () => vote(ctx.config, ctx.position, proposal, payer),
      "VoteTooYoung"
    );

    await ageBond(ctx.position);
    await vote(ctx.config, ctx.position, proposal, payer);
    await expectRpcError(
      () => vote(ctx.config, ctx.position, proposal, payer),
      "ActiveVote"
    );
  });

  it("rejects voting after the voting deadline and finalizing before it", async () => {
    const ctx = await setupConfig(5_000, { deposit: 10, voting: 12 });
    const proposal = await createProposal(ctx.config, 0);
    await deposit(
      ctx.config,
      ctx.position,
      payer,
      ctx.ownerAta,
      ctx.bondVault,
      250_000
    );

    await expectRpcError(
      () =>
        program.methods
          .finalize()
          .accountsStrict({
            config: ctx.config,
            winningProposal: proposal,
          })
          .rpc(),
      "VotingClosed"
    );

    await warpPast(ctx.votingDeadline);
    await expectRpcError(
      () => vote(ctx.config, ctx.position, proposal, payer),
      "VotingClosed"
    );
  });

  it("rejects recording a Kamino vault before finalization", async () => {
    const ctx = await setupConfig();
    const kaminoVault = await createKaminoVaultAccount();

    await expectRpcError(
      () =>
        program.methods
          .recordKaminoVault()
          .accountsStrict({
            curator: payer.publicKey,
            config: ctx.config,
            kaminoVault,
          })
          .rpc(),
      "NotFinalized"
    );
  });

  it("requires strict quorum instead of accepting an exact threshold", async () => {
    const ctx = await setupConfig(5_000);
    const second = await setupSecondVoter(ctx.mint, ctx.config);
    const proposal = await createProposal(ctx.config, 0);

    await deposit(
      ctx.config,
      ctx.position,
      payer,
      ctx.ownerAta,
      ctx.bondVault,
      250_000
    );
    await deposit(
      ctx.config,
      second.position,
      second.keypair,
      second.ata,
      ctx.bondVault,
      250_000
    );
    await ageBond(ctx.position);
    await vote(ctx.config, ctx.position, proposal, payer);
    await warpPast(ctx.votingDeadline);

    await expectRpcError(
      () =>
        program.methods
          .finalize()
          .accountsStrict({
            config: ctx.config,
            winningProposal: proposal,
          })
          .rpc(),
      "QuorumNotReached"
    );
  });

  it("fails a no-quorum campaign and permits active voters to exit", async () => {
    const ctx = await setupConfig(5_000);
    const second = await setupSecondVoter(ctx.mint, ctx.config);
    const proposal = await createProposal(ctx.config, 0);

    await deposit(
      ctx.config,
      ctx.position,
      payer,
      ctx.ownerAta,
      ctx.bondVault,
      250_000
    );
    await deposit(
      ctx.config,
      second.position,
      second.keypair,
      second.ata,
      ctx.bondVault,
      250_000
    );
    await ageBond(ctx.position);
    await vote(ctx.config, ctx.position, proposal, payer);
    await warpPast(ctx.votingDeadline);

    await program.methods
      .failCampaign()
      .accountsStrict({
        config: ctx.config,
      })
      .rpc();

    await program.methods
      .withdraw(new anchor.BN(250_000))
      .accountsStrict({
        owner: payer.publicKey,
        config: ctx.config,
        position: ctx.position,
        ownerTokenAccount: ctx.ownerAta,
        bondVault: ctx.bondVault,
        daoAuthority: ctx.daoAuthority,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const configState = await program.account.metaVaultConfig.fetch(ctx.config);
    const positionState = await program.account.voterPosition.fetch(
      ctx.position
    );
    const vaultState = await getAccount(provider.connection, ctx.bondVault);

    expect(configState.finalized).to.equal(true);
    expect(configState.selectedProposal.toBase58()).to.equal(
      anchor.web3.PublicKey.default.toBase58()
    );
    expect(configState.selectedCurator.toBase58()).to.equal(
      anchor.web3.PublicKey.default.toBase58()
    );
    expect(configState.kaminoVault.toBase58()).to.equal(
      anchor.web3.PublicKey.default.toBase58()
    );
    expect(configState.totalBonded.toNumber()).to.equal(250_000);
    expect(positionState.bondedAmount.toNumber()).to.equal(0);
    expect(positionState.votedProposal.toBase58()).to.equal(
      anchor.web3.PublicKey.default.toBase58()
    );
    expect(vaultState.amount).to.equal(250_000n);

    const kaminoVault = await createKaminoVaultAccount();
    await expectRpcError(
      () =>
        program.methods
          .recordKaminoVault()
          .accountsStrict({
            curator: payer.publicKey,
            config: ctx.config,
            kaminoVault,
          })
          .rpc(),
      "Unauthorized"
    );
    await expectRpcError(
      () =>
        program.methods
          .finalize()
          .accountsStrict({
            config: ctx.config,
            winningProposal: proposal,
          })
          .rpc(),
      "AlreadyFinalized"
    );
  });

  it("rejects failing a campaign once strict quorum is reachable", async () => {
    const ctx = await setupConfig(5_000);
    const proposal = await createProposal(ctx.config, 0);

    await deposit(
      ctx.config,
      ctx.position,
      payer,
      ctx.ownerAta,
      ctx.bondVault,
      250_000
    );
    await ageBond(ctx.position);
    await vote(ctx.config, ctx.position, proposal, payer);
    await warpPast(ctx.votingDeadline);

    await expectRpcError(
      () =>
        program.methods
          .failCampaign()
          .accountsStrict({
            config: ctx.config,
          })
          .remainingAccounts([
            {
              pubkey: proposal,
              isWritable: false,
              isSigner: false,
            },
          ])
          .rpc(),
      "QuorumStillReachable"
    );
  });

  it("fails a quorum-reached campaign when no proposal has strict majority", async () => {
    const ctx = await setupConfig();
    const second = await setupSecondVoter(ctx.mint, ctx.config);
    const firstProposal = await createProposal(ctx.config, 0);
    const secondProposal = await createProposal(ctx.config, 1);

    await deposit(
      ctx.config,
      ctx.position,
      payer,
      ctx.ownerAta,
      ctx.bondVault,
      250_000
    );
    await deposit(
      ctx.config,
      second.position,
      second.keypair,
      second.ata,
      ctx.bondVault,
      250_000
    );
    await ageBond(ctx.position);
    await ageBond(second.position);
    await vote(ctx.config, ctx.position, firstProposal, payer);
    await vote(ctx.config, second.position, secondProposal, second.keypair);
    await warpPast(ctx.votingDeadline);

    await expectRpcError(
      () =>
        program.methods
          .failCampaign()
          .accountsStrict({
            config: ctx.config,
          })
          .remainingAccounts([
            {
              pubkey: firstProposal,
              isWritable: false,
              isSigner: false,
            },
          ])
          .rpc(),
      "ProposalCountMismatch"
    );

    await program.methods
      .failCampaign()
      .accountsStrict({
        config: ctx.config,
      })
      .remainingAccounts([
        {
          pubkey: firstProposal,
          isWritable: false,
          isSigner: false,
        },
        {
          pubkey: secondProposal,
          isWritable: false,
          isSigner: false,
        },
      ])
      .rpc();

    await program.methods
      .withdraw(new anchor.BN(250_000))
      .accountsStrict({
        owner: second.keypair.publicKey,
        config: ctx.config,
        position: second.position,
        ownerTokenAccount: second.ata,
        bondVault: ctx.bondVault,
        daoAuthority: ctx.daoAuthority,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([second.keypair])
      .rpc();

    const configState = await program.account.metaVaultConfig.fetch(ctx.config);
    const positionState = await program.account.voterPosition.fetch(
      second.position
    );

    expect(configState.finalized).to.equal(true);
    expect(configState.selectedProposal.toBase58()).to.equal(
      anchor.web3.PublicKey.default.toBase58()
    );
    expect(configState.totalBonded.toNumber()).to.equal(250_000);
    expect(positionState.bondedAmount.toNumber()).to.equal(0);
    expect(positionState.votedProposal.toBase58()).to.equal(
      anchor.web3.PublicKey.default.toBase58()
    );
  });

  it("rejects finalization without strict majority", async () => {
    const ctx = await setupConfig();
    const second = await setupSecondVoter(ctx.mint, ctx.config);
    const firstProposal = await createProposal(ctx.config, 0);
    const secondProposal = await createProposal(ctx.config, 1);

    await deposit(
      ctx.config,
      ctx.position,
      payer,
      ctx.ownerAta,
      ctx.bondVault,
      250_000
    );
    await deposit(
      ctx.config,
      second.position,
      second.keypair,
      second.ata,
      ctx.bondVault,
      250_000
    );
    await ageBond(ctx.position);
    await ageBond(second.position);
    await vote(ctx.config, ctx.position, firstProposal, payer);
    await vote(ctx.config, second.position, secondProposal, second.keypair);
    await warpPast(ctx.votingDeadline);

    await expectRpcError(
      () =>
        program.methods
          .finalize()
          .accountsStrict({
            config: ctx.config,
            winningProposal: firstProposal,
          })
          .rpc(),
      "MajorityNotReached"
    );
  });

  it("keeps voting tallies consistent across many voters", async () => {
    const ctx = await setupConfig(5_000, { deposit: 80, voting: 110 });
    const proposal = await createProposal(ctx.config, 0);
    const voters = [
      {
        keypair: payer,
        ata: ctx.ownerAta,
        position: ctx.position,
        amount: 150_000,
      },
    ];

    for (const amount of [200_000, 250_000, 300_000, 350_000]) {
      const voter = await setupVoter(ctx.mint, ctx.config);
      voters.push({ ...voter, amount });
    }

    for (const voter of voters) {
      await deposit(
        ctx.config,
        voter.position,
        voter.keypair,
        voter.ata,
        ctx.bondVault,
        voter.amount
      );
    }
    await warpPast((await provider.connection.getSlot()) + 2);

    let expectedPrincipal = 0;
    let expectedWeight = new anchor.BN(0);
    for (const voter of voters) {
      await vote(ctx.config, voter.position, proposal, voter.keypair);
      const positionState = await program.account.voterPosition.fetch(
        voter.position
      );
      expectedPrincipal += voter.amount;
      expectedWeight = expectedWeight.add(positionState.voteWeight);

      const configState = await program.account.metaVaultConfig.fetch(
        ctx.config
      );
      const proposalState = await program.account.strategyProposal.fetch(
        proposal
      );
      expect(configState.totalVotedPrincipal.toNumber()).to.equal(
        expectedPrincipal
      );
      expect(proposalState.supportPrincipal.toNumber()).to.equal(
        expectedPrincipal
      );
      expect(configState.totalVoteWeight.toString()).to.equal(
        expectedWeight.toString()
      );
      expect(proposalState.supportWeight.toString()).to.equal(
        expectedWeight.toString()
      );
    }
  });

  it("stress checks vote, retract, and revote tally conservation", async () => {
    const ctx = await setupConfig(3_000, { deposit: 120, voting: 160 });
    const proposals = [
      await createProposal(ctx.config, 0),
      await createProposal(ctx.config, 1),
      await createProposal(ctx.config, 2),
    ];
    const voters = [
      {
        keypair: payer,
        ata: ctx.ownerAta,
        position: ctx.position,
        amount: 150_000,
        activeProposal: -1,
        weight: new anchor.BN(0),
      },
    ];

    for (const amount of [
      175_000, 200_000, 225_000, 250_000, 275_000, 300_000, 325_000,
    ]) {
      const voter = await setupVoter(ctx.mint, ctx.config);
      voters.push({
        ...voter,
        amount,
        activeProposal: -1,
        weight: new anchor.BN(0),
      });
    }

    for (const voter of voters) {
      await deposit(
        ctx.config,
        voter.position,
        voter.keypair,
        voter.ata,
        ctx.bondVault,
        voter.amount
      );
    }
    await warpPast((await provider.connection.getSlot()) + 2);

    async function cast(voterIndex: number, proposalIndex: number) {
      const voter = voters[voterIndex];
      await vote(
        ctx.config,
        voter.position,
        proposals[proposalIndex],
        voter.keypair
      );
      const positionState = await program.account.voterPosition.fetch(
        voter.position
      );
      voter.activeProposal = proposalIndex;
      voter.weight = positionState.voteWeight;
    }

    async function retract(voterIndex: number) {
      const voter = voters[voterIndex];
      await program.methods
        .retractVote()
        .accountsStrict({
          owner: voter.keypair.publicKey,
          config: ctx.config,
          position: voter.position,
          proposal: proposals[voter.activeProposal],
        })
        .signers(voter.keypair === payer ? [] : [voter.keypair])
        .rpc();
      voter.activeProposal = -1;
      voter.weight = new anchor.BN(0);
    }

    async function assertTallies() {
      const expectedPrincipalByProposal = [0, 0, 0];
      const expectedWeightByProposal = [
        new anchor.BN(0),
        new anchor.BN(0),
        new anchor.BN(0),
      ];
      let expectedPrincipal = 0;
      let expectedWeight = new anchor.BN(0);

      for (const voter of voters) {
        if (voter.activeProposal < 0) {
          continue;
        }
        expectedPrincipal += voter.amount;
        expectedWeight = expectedWeight.add(voter.weight);
        expectedPrincipalByProposal[voter.activeProposal] += voter.amount;
        expectedWeightByProposal[voter.activeProposal] =
          expectedWeightByProposal[voter.activeProposal].add(voter.weight);
      }

      const configState = await program.account.metaVaultConfig.fetch(
        ctx.config
      );
      expect(configState.totalVotedPrincipal.toNumber()).to.equal(
        expectedPrincipal
      );
      expect(configState.totalVoteWeight.toString()).to.equal(
        expectedWeight.toString()
      );

      for (const [index, proposal] of proposals.entries()) {
        const proposalState = await program.account.strategyProposal.fetch(
          proposal
        );
        expect(proposalState.supportPrincipal.toNumber()).to.equal(
          expectedPrincipalByProposal[index]
        );
        expect(proposalState.supportWeight.toString()).to.equal(
          expectedWeightByProposal[index].toString()
        );
      }
    }

    for (const [index] of voters.entries()) {
      await cast(index, index % proposals.length);
    }
    await assertTallies();

    for (const index of [1, 3, 6]) {
      await retract(index);
    }
    await assertTallies();

    await cast(1, 2);
    await cast(3, 0);
    await cast(6, 1);
    await assertTallies();

    const vaultState = await getAccount(provider.connection, ctx.bondVault);
    const totalDeposited = voters.reduce((sum, voter) => sum + voter.amount, 0);
    expect(vaultState.amount).to.equal(BigInt(totalDeposited));
  });

  it("checks generated operation sequences against model invariants", async () => {
    const ctx = await setupConfig(3_000, { deposit: 180, voting: 220 });
    const proposals = [
      await createProposal(ctx.config, 0),
      await createProposal(ctx.config, 1),
      await createProposal(ctx.config, 2),
    ];
    const voters = [
      {
        keypair: payer,
        ata: ctx.ownerAta,
        position: ctx.position,
        bonded: 400_000,
        activeProposal: -1,
        weight: new anchor.BN(0),
      },
    ];

    for (const amount of [450_000, 500_000, 550_000, 600_000]) {
      const voter = await setupVoter(ctx.mint, ctx.config);
      voters.push({
        ...voter,
        bonded: amount,
        activeProposal: -1,
        weight: new anchor.BN(0),
      });
    }

    for (const voter of voters) {
      await deposit(
        ctx.config,
        voter.position,
        voter.keypair,
        voter.ata,
        ctx.bondVault,
        voter.bonded
      );
    }
    await warpPast((await provider.connection.getSlot()) + 2);

    let seed = 0x5eed_1234;
    function nextInt(max: number) {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      return seed % max;
    }

    async function cast(voterIndex: number, proposalIndex: number) {
      const voter = voters[voterIndex];
      await ageBond(voter.position);
      await vote(
        ctx.config,
        voter.position,
        proposals[proposalIndex],
        voter.keypair
      );
      const positionState = await program.account.voterPosition.fetch(
        voter.position
      );
      voter.activeProposal = proposalIndex;
      voter.weight = positionState.voteWeight;
    }

    async function retract(voterIndex: number) {
      const voter = voters[voterIndex];
      await program.methods
        .retractVote()
        .accountsStrict({
          owner: voter.keypair.publicKey,
          config: ctx.config,
          position: voter.position,
          proposal: proposals[voter.activeProposal],
        })
        .signers(voter.keypair === payer ? [] : [voter.keypair])
        .rpc();
      voter.activeProposal = -1;
      voter.weight = new anchor.BN(0);
    }

    async function withdraw(voterIndex: number, amount: number) {
      const voter = voters[voterIndex];
      await program.methods
        .withdraw(new anchor.BN(amount))
        .accountsStrict({
          owner: voter.keypair.publicKey,
          config: ctx.config,
          position: voter.position,
          ownerTokenAccount: voter.ata,
          bondVault: ctx.bondVault,
          daoAuthority: ctx.daoAuthority,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers(voter.keypair === payer ? [] : [voter.keypair])
        .rpc();
      voter.bonded -= amount;
    }

    async function assertModel(step: number) {
      const expectedPrincipalByProposal = [0, 0, 0];
      const expectedWeightByProposal = [
        new anchor.BN(0),
        new anchor.BN(0),
        new anchor.BN(0),
      ];
      let expectedBonded = 0;
      let expectedVotedPrincipal = 0;
      let expectedVoteWeight = new anchor.BN(0);

      for (const voter of voters) {
        const positionState = await program.account.voterPosition.fetch(
          voter.position
        );
        expect(
          positionState.bondedAmount.toNumber(),
          `bonded step ${step}`
        ).to.equal(voter.bonded);

        expectedBonded += voter.bonded;
        if (voter.activeProposal >= 0) {
          expect(positionState.votedProposal.toBase58()).to.equal(
            proposals[voter.activeProposal].toBase58()
          );
          expect(positionState.voteWeight.toString()).to.equal(
            voter.weight.toString()
          );
          expectedVotedPrincipal += voter.bonded;
          expectedVoteWeight = expectedVoteWeight.add(voter.weight);
          expectedPrincipalByProposal[voter.activeProposal] += voter.bonded;
          expectedWeightByProposal[voter.activeProposal] =
            expectedWeightByProposal[voter.activeProposal].add(voter.weight);
        } else {
          expect(positionState.votedProposal.toBase58()).to.equal(
            anchor.web3.PublicKey.default.toBase58()
          );
          expect(positionState.voteWeight.toString()).to.equal("0");
        }
      }

      const configState = await program.account.metaVaultConfig.fetch(
        ctx.config
      );
      expect(
        configState.totalBonded.toNumber(),
        `total bonded step ${step}`
      ).to.equal(expectedBonded);
      expect(
        configState.totalVotedPrincipal.toNumber(),
        `voted principal step ${step}`
      ).to.equal(expectedVotedPrincipal);
      expect(
        configState.totalVoteWeight.toString(),
        `vote weight step ${step}`
      ).to.equal(expectedVoteWeight.toString());

      for (const [index, proposal] of proposals.entries()) {
        const proposalState = await program.account.strategyProposal.fetch(
          proposal
        );
        expect(
          proposalState.supportPrincipal.toNumber(),
          `proposal principal ${index} step ${step}`
        ).to.equal(expectedPrincipalByProposal[index]);
        expect(
          proposalState.supportWeight.toString(),
          `proposal weight ${index} step ${step}`
        ).to.equal(expectedWeightByProposal[index].toString());
      }

      const vaultState = await getAccount(provider.connection, ctx.bondVault);
      expect(vaultState.amount, `vault amount step ${step}`).to.equal(
        BigInt(expectedBonded)
      );
    }

    await assertModel(0);
    for (let step = 1; step <= 28; step += 1) {
      const voterIndex = nextInt(voters.length);
      const voter = voters[voterIndex];
      const op = nextInt(4);

      if (op === 0) {
        const proposalIndex = nextInt(proposals.length);
        if (voter.activeProposal >= 0) {
          await expectRpcError(
            () => cast(voterIndex, proposalIndex),
            "ActiveVote"
          );
        } else if (voter.bonded === 0) {
          await expectRpcError(
            () => cast(voterIndex, proposalIndex),
            "InsufficientBond"
          );
        } else {
          await cast(voterIndex, proposalIndex);
        }
      } else if (op === 1) {
        if (voter.activeProposal >= 0) {
          await retract(voterIndex);
        } else {
          await expectRpcError(
            () =>
              program.methods
                .retractVote()
                .accountsStrict({
                  owner: voter.keypair.publicKey,
                  config: ctx.config,
                  position: voter.position,
                  proposal: proposals[0],
                })
                .signers(voter.keypair === payer ? [] : [voter.keypair])
                .rpc(),
            "ConstraintAddress"
          );
        }
      } else if (op === 2) {
        const amount = Math.min(100_000, voter.bonded);
        if (voter.activeProposal >= 0) {
          await expectRpcError(
            () => withdraw(voterIndex, Math.max(1, amount)),
            "ActiveVote"
          );
        } else if (amount === 0) {
          await expectRpcError(
            () => withdraw(voterIndex, 1),
            "InsufficientBond"
          );
        } else {
          await withdraw(voterIndex, amount);
        }
      } else {
        const amount = 100_000;
        if (voter.activeProposal >= 0) {
          await expectRpcError(
            () =>
              deposit(
                ctx.config,
                voter.position,
                voter.keypair,
                voter.ata,
                ctx.bondVault,
                amount
              ),
            "ActiveVote"
          );
        } else {
          await deposit(
            ctx.config,
            voter.position,
            voter.keypair,
            voter.ata,
            ctx.bondVault,
            amount
          );
          voter.bonded += amount;
        }
      }

      await assertModel(step);
    }
  });

  it("finalizes the winning curator, records a Kamino vault, and permits post-finalization exit", async () => {
    const ctx = await setupConfig(
      5_000,
      { deposit: 20, voting: 24 },
      initializedKaminoVaultMint
    );
    const proposal = await createProposal(ctx.config, 0);
    const kaminoVault = await createKaminoVaultAccount();
    const nonKaminoVault = await createOwnedAccount(
      anchor.web3.SystemProgram.programId
    );
    const uninitializedKaminoVault = await createOwnedAccount(
      kaminoKvaultProgramId
    );

    await deposit(
      ctx.config,
      ctx.position,
      payer,
      ctx.ownerAta,
      ctx.bondVault,
      400_000
    );
    await ageBond(ctx.position);
    await vote(ctx.config, ctx.position, proposal, payer);
    await warpPast(ctx.votingDeadline);

    await program.methods
      .finalize()
      .accountsStrict({
        config: ctx.config,
        winningProposal: proposal,
      })
      .rpc();

    const nonCurator = anchor.web3.Keypair.generate();
    await expectRpcError(
      () =>
        program.methods
          .recordKaminoVault()
          .accountsStrict({
            curator: nonCurator.publicKey,
            config: ctx.config,
            kaminoVault,
          })
          .signers([nonCurator])
          .rpc(),
      "Unauthorized"
    );

    await expectRpcError(
      () =>
        program.methods
          .recordKaminoVault()
          .accountsStrict({
            curator: payer.publicKey,
            config: ctx.config,
            kaminoVault: nonKaminoVault,
          })
          .rpc(),
      "InvalidKaminoVaultProgram"
    );

    await expectRpcError(
      () =>
        program.methods
          .recordKaminoVault()
          .accountsStrict({
            curator: payer.publicKey,
            config: ctx.config,
            kaminoVault: uninitializedKaminoVault,
          })
          .rpc(),
      "InvalidKaminoVaultAccount"
    );

    await expectRpcError(
      () =>
        program.methods
          .recordKaminoVault()
          .accountsStrict({
            curator: payer.publicKey,
            config: ctx.config,
            kaminoVault: wrongAdminKaminoVault,
          })
          .rpc(),
      "InvalidKaminoVaultAuthority"
    );

    await expectRpcError(
      () =>
        program.methods
          .recordKaminoVault()
          .accountsStrict({
            curator: payer.publicKey,
            config: ctx.config,
            kaminoVault: wrongMintKaminoVault,
          })
          .rpc(),
      "InvalidKaminoVaultMint"
    );

    await program.methods
      .setPaused(true)
      .accountsStrict({
        authority: payer.publicKey,
        config: ctx.config,
      })
      .rpc();

    await expectRpcError(
      () =>
        program.methods
          .recordKaminoVault()
          .accountsStrict({
            curator: payer.publicKey,
            config: ctx.config,
            kaminoVault,
          })
          .rpc(),
      "Paused"
    );

    await program.methods
      .setPaused(false)
      .accountsStrict({
        authority: payer.publicKey,
        config: ctx.config,
      })
      .rpc();

    await program.methods
      .recordKaminoVault()
      .accountsStrict({
        curator: payer.publicKey,
        config: ctx.config,
        kaminoVault,
      })
      .rpc();

    const secondKaminoVault = await createKaminoVaultAccount();
    await expectRpcError(
      () =>
        program.methods
          .recordKaminoVault()
          .accountsStrict({
            curator: payer.publicKey,
            config: ctx.config,
            kaminoVault: secondKaminoVault,
          })
          .rpc(),
      "KaminoVaultAlreadyRecorded"
    );

    await program.methods
      .withdraw(new anchor.BN(400_000))
      .accountsStrict({
        owner: payer.publicKey,
        config: ctx.config,
        position: ctx.position,
        ownerTokenAccount: ctx.ownerAta,
        bondVault: ctx.bondVault,
        daoAuthority: ctx.daoAuthority,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const configState = await program.account.metaVaultConfig.fetch(ctx.config);
    const positionState = await program.account.voterPosition.fetch(
      ctx.position
    );
    const vaultState = await getAccount(provider.connection, ctx.bondVault);

    expect(configState.finalized).to.equal(true);
    expect(configState.selectedCurator.toBase58()).to.equal(
      payer.publicKey.toBase58()
    );
    expect(configState.kaminoVault.toBase58()).to.equal(kaminoVault.toBase58());
    expect(configState.totalBonded.toNumber()).to.equal(0);
    expect(positionState.bondedAmount.toNumber()).to.equal(0);
    expect(positionState.votedProposal.toBase58()).to.equal(
      anchor.web3.PublicKey.default.toBase58()
    );
    expect(vaultState.amount).to.equal(0n);
  });
});
