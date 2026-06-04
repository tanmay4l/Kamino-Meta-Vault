# Kamino Meta Vault

An Anchor program for running a bonded curator vote around a Kamino vault strategy.

The basic flow is:

1. A vault campaign is opened for one token mint.
2. Users deposit a bond before the deposit deadline.
3. Bonded users vote on curator proposals.
4. After the voting deadline, the winning proposal can be finalized if quorum and strict-majority rules pass.
5. The selected Kamino vault can be recorded, and voters can exit according to the campaign outcome.

The repo is intentionally small. It contains the on-chain program, integration tests, and CI validation. Operator scripts, UI code, and deployment notes are not included here.

## Commands

```sh
yarn install
yarn validate:local
```

`yarn validate:local` runs formatting, clippy, TypeScript checking, Anchor build, and the integration test suite.

## Status

This is devnet-stage code, not audited production infrastructure.

## Production Bar

Current backend bar:

- Contract instructions have integration coverage through the public Anchor interface.
- Campaign setup requires strictly ordered deposit and voting windows.
- Campaign setup rejects zero minimum deposits and out-of-range quorum values.
- Voting uses bonded deposits, time-weighted voting, strict quorum, and strict majority.
- Voting tallies freeze at the voting deadline; votes cannot be cast or retracted after the window closes.
- Emergency pause blocks new campaign actions without blocking bonded-user withdrawals or empty-position closeout.
- Proposal creation is authority-gated, proposal count is bounded, and unvoted proposals can be canceled by the current config authority.
- Strategy proposals require a non-empty title and nonzero metadata hash.
- Proposal creation closes with the deposit window so locked bond capital cannot be redirected to late-added proposals.
- Authority can be handed off through a co-signed transfer path for multisig acceptance.
- Campaigns can finalize successfully or fail when quorum/majority rules are not met.
- Recorded Kamino vault accounts must be owned by an allowed Kamino kvault program, carry the Kamino `VaultState` discriminator, match the campaign mint, and use the DAO PDA as vault admin.
- CI runs formatting, clippy, TypeScript checking, Anchor build, integration tests, and build artifact checksums.

Not production complete:

- No independent audit has been completed.
- The program records a selected Kamino vault; it does not create or manage Kamino vaults by CPI.
- The current Anchor/Solana SBF build emits an undefined-syscall post-processing warning because the installed platform-tools syscall allowlist is empty. CI checks the compiled ELF and fails if it imports any undefined symbol outside the Solana runtime syscall set.
- Devnet upgrades should be executed through the configured upgrade authority flow before claiming a new binary is deployed.
- Mainnet launch needs a fresh audit, reproducible build hash, upgrade authority policy, monitoring, and incident runbook.
