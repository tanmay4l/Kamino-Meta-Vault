use anchor_lang::prelude::*;

use crate::MAX_PROPOSAL_TITLE_BYTES;

#[account]
#[derive(InitSpace)]
pub struct MetaVaultConfig {
    pub authority: Pubkey,
    pub token_mint: Pubkey,
    pub bond_vault: Pubkey,
    pub dao_authority: Pubkey,
    pub selected_proposal: Pubkey,
    pub selected_curator: Pubkey,
    pub kamino_vault: Pubkey,
    pub bootstrap_start_slot: u64,
    pub deposit_deadline_slot: u64,
    pub voting_deadline_slot: u64,
    pub min_deposit_amount: u64,
    pub quorum_bps: u16,
    pub proposal_count: u64,
    pub total_bonded: u64,
    pub total_voted_principal: u64,
    pub total_vote_weight: u128,
    pub finalized: bool,
    pub paused: bool,
    pub authority_bump: u8,
    pub bond_vault_bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct VoterPosition {
    pub config: Pubkey,
    pub owner: Pubkey,
    pub bonded_amount: u64,
    pub start_slot: u64,
    pub voted_proposal: Pubkey,
    pub vote_weight: u128,
}

#[account]
#[derive(InitSpace)]
pub struct StrategyProposal {
    pub config: Pubkey,
    pub proposer: Pubkey,
    pub curator: Pubkey,
    pub proposal_id: u64,
    pub support_principal: u64,
    pub support_weight: u128,
    pub active: bool,
    pub metadata_hash: [u8; 32],
    #[max_len(MAX_PROPOSAL_TITLE_BYTES)]
    pub title: String,
}
