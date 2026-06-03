use anchor_lang::prelude::*;

pub const CONFIG_SEED: &[u8] = b"config";
pub const AUTHORITY_SEED: &[u8] = b"authority";
pub const BOND_VAULT_SEED: &[u8] = b"bond_vault";
pub const POSITION_SEED: &[u8] = b"position";
pub const PROPOSAL_SEED: &[u8] = b"proposal";

pub const MAX_BPS: u16 = 10_000;
pub const MAX_PROPOSAL_TITLE_BYTES: usize = 64;
pub const MAX_PROPOSALS: u64 = 16;

pub const KAMINO_KVAULT_MAINNET_PROGRAM_ID: Pubkey =
    pubkey!("KvauGMspG5k6rtzrqqn7WNn3oZdyKqLKwK2XWQ8FLjd");
pub const KAMINO_KVAULT_STAGING_PROGRAM_ID: Pubkey =
    pubkey!("stKvQfwRsQiKnLtMNVLHKS3exFJmZFsgfzBPWHECUYK");
pub const KAMINO_VAULT_STATE_DISCRIMINATOR: [u8; 8] = [228, 196, 82, 165, 98, 210, 235, 152];
pub const KAMINO_VAULT_STATE_ADMIN_OFFSET: usize = KAMINO_VAULT_STATE_DISCRIMINATOR.len();
pub const KAMINO_VAULT_STATE_TOKEN_MINT_OFFSET: usize = KAMINO_VAULT_STATE_DISCRIMINATOR.len() + 72;
