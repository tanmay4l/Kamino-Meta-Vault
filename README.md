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
