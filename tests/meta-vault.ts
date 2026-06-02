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

  async function setupConfig(
    quorumBps = 5_000,
    deadlineOffsets = { deposit: 20, voting: 24 }
  ) {
    const mint = await createMint(
      provider.connection,
      payer,
      payer.publicKey,
      null,
      6
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

    if (connection._rpcRequest) {
      try {
        await connection._rpcRequest("warpSlot", [target]);
        if (connection._blockhashInfo) {
          connection._blockhashInfo = {
            latestBlockhash: null,
            lastFetch: 0,
            simulatedSignatures: [],
            transactionSignatures: [],
          };
        }
      } catch (_) {
        // Some RPCs do not expose the local-validator warp method.
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
      await provider.sendAndConfirm(tx, [payer]);
      await new Promise((resolve) => setTimeout(resolve, 100));
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
    const signature = await provider.connection.requestAirdrop(
      second.publicKey,
      2_000_000_000
    );
    await provider.connection.confirmTransaction(signature);
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
    const tx = new anchor.web3.Transaction().add(
      anchor.web3.SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: signer.publicKey,
        lamports: 500_000_000,
      })
    );
    await provider.sendAndConfirm(tx, [payer]);
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

    await expectRpcError(
      () =>
        program.methods
          .recordKaminoVault(anchor.web3.Keypair.generate().publicKey)
          .accountsStrict({
            curator: payer.publicKey,
            config: ctx.config,
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

    await expectRpcError(
      () =>
        program.methods
          .recordKaminoVault(anchor.web3.Keypair.generate().publicKey)
          .accountsStrict({
            curator: payer.publicKey,
            config: ctx.config,
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

    await warpPast(ctx.votingDeadline);
    await program.methods
      .finalize()
      .accountsStrict({
        config: ctx.config,
        winningProposal: proposal,
      })
      .rpc();

    const configState = await program.account.metaVaultConfig.fetch(ctx.config);
    const vaultState = await getAccount(provider.connection, ctx.bondVault);
    expect(configState.finalized).to.equal(true);
    expect(configState.totalBonded.toNumber()).to.equal(expectedPrincipal);
    expect(vaultState.amount).to.equal(BigInt(expectedPrincipal));
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
    const ctx = await setupConfig();
    const proposal = await createProposal(ctx.config, 0);
    const kaminoVault = anchor.web3.Keypair.generate().publicKey;

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
          .recordKaminoVault(kaminoVault)
          .accountsStrict({
            curator: nonCurator.publicKey,
            config: ctx.config,
          })
          .signers([nonCurator])
          .rpc(),
      "Unauthorized"
    );

    await program.methods
      .recordKaminoVault(kaminoVault)
      .accountsStrict({
        curator: payer.publicKey,
        config: ctx.config,
      })
      .rpc();

    await expectRpcError(
      () =>
        program.methods
          .recordKaminoVault(anchor.web3.Keypair.generate().publicKey)
          .accountsStrict({
            curator: payer.publicKey,
            config: ctx.config,
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
