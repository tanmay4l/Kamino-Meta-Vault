use anchor_lang::prelude::*;

#[event]
pub struct MetaVaultInitialized {
    pub config: Pubkey,
    pub authority: Pubkey,
    pub token_mint: Pubkey,
    pub bond_vault: Pubkey,
    pub dao_authority: Pubkey,
    pub bootstrap_start_slot: u64,
    pub deposit_deadline_slot: u64,
    pub voting_deadline_slot: u64,
    pub min_deposit_amount: u64,
    pub quorum_bps: u16,
}

#[event]
pub struct PauseSet {
    pub config: Pubkey,
    pub authority: Pubkey,
    pub paused: bool,
}

#[event]
pub struct AuthorityTransferred {
    pub config: Pubkey,
    pub previous_authority: Pubkey,
    pub new_authority: Pubkey,
}

#[event]
pub struct Deposited {
    pub config: Pubkey,
    pub owner: Pubkey,
    pub position: Pubkey,
    pub amount: u64,
    pub bonded_amount: u64,
    pub total_bonded: u64,
    pub slot: u64,
}

#[event]
pub struct Withdrawn {
    pub config: Pubkey,
    pub owner: Pubkey,
    pub position: Pubkey,
    pub amount: u64,
    pub bonded_amount: u64,
    pub total_bonded: u64,
}

#[event]
pub struct PositionClosed {
    pub config: Pubkey,
    pub owner: Pubkey,
    pub position: Pubkey,
}

#[event]
pub struct ProposalCreated {
    pub config: Pubkey,
    pub proposal: Pubkey,
    pub proposer: Pubkey,
    pub curator: Pubkey,
    pub proposal_id: u64,
    pub metadata_hash: [u8; 32],
}

#[event]
pub struct ProposalCanceled {
    pub config: Pubkey,
    pub proposal: Pubkey,
    pub canceled_by: Pubkey,
    pub proposal_id: u64,
}

#[event]
pub struct VoteCast {
    pub config: Pubkey,
    pub proposal: Pubkey,
    pub owner: Pubkey,
    pub principal: u64,
    pub weight: u128,
    pub total_voted_principal: u64,
    pub total_vote_weight: u128,
}

#[event]
pub struct VoteRetracted {
    pub config: Pubkey,
    pub proposal: Pubkey,
    pub owner: Pubkey,
    pub principal: u64,
    pub weight: u128,
    pub total_voted_principal: u64,
    pub total_vote_weight: u128,
}

#[event]
pub struct Finalized {
    pub config: Pubkey,
    pub selected_proposal: Pubkey,
    pub selected_curator: Pubkey,
    pub total_bonded: u64,
    pub total_voted_principal: u64,
    pub total_vote_weight: u128,
}

#[event]
pub struct CampaignFailed {
    pub config: Pubkey,
    pub total_bonded: u64,
    pub total_voted_principal: u64,
    pub quorum_bps: u16,
}

#[event]
pub struct KaminoVaultRecorded {
    pub config: Pubkey,
    pub curator: Pubkey,
    pub kamino_vault: Pubkey,
}
