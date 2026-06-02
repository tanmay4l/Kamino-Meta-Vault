#![allow(clippy::diverging_sub_expression)]

pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use error::*;
pub use events::*;
pub use state::*;

use instructions::*;

declare_id!("C2GxY5PJV2mYqZhvsmrCz22KKVik7qax4V8jx9RywaTr");

#[program]
pub mod kamino_meta_vault {
    use super::*;

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        deposit_deadline_slot: u64,
        voting_deadline_slot: u64,
        min_deposit_amount: u64,
        quorum_bps: u16,
    ) -> Result<()> {
        instructions::initialize_config(
            ctx,
            deposit_deadline_slot,
            voting_deadline_slot,
            min_deposit_amount,
            quorum_bps,
        )
    }

    pub fn initialize_config_with_seed(
        ctx: Context<InitializeConfigWithSeed>,
        config_seed: [u8; 32],
        deposit_deadline_slot: u64,
        voting_deadline_slot: u64,
        min_deposit_amount: u64,
        quorum_bps: u16,
    ) -> Result<()> {
        instructions::initialize_config_with_seed(
            ctx,
            config_seed,
            deposit_deadline_slot,
            voting_deadline_slot,
            min_deposit_amount,
            quorum_bps,
        )
    }

    pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
        instructions::set_paused(ctx, paused)
    }

    pub fn transfer_authority(
        ctx: Context<TransferAuthority>,
        new_authority: Pubkey,
    ) -> Result<()> {
        instructions::transfer_authority(ctx, new_authority)
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        instructions::deposit(ctx, amount)
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        instructions::withdraw(ctx, amount)
    }

    pub fn close_position(ctx: Context<ClosePosition>) -> Result<()> {
        instructions::close_position(ctx)
    }

    pub fn create_proposal(
        ctx: Context<CreateProposal>,
        curator: Pubkey,
        metadata_hash: [u8; 32],
        title: String,
    ) -> Result<()> {
        instructions::create_proposal(ctx, curator, metadata_hash, title)
    }

    pub fn cancel_proposal(ctx: Context<CancelProposal>) -> Result<()> {
        instructions::cancel_proposal(ctx)
    }

    pub fn vote(ctx: Context<Vote>) -> Result<()> {
        instructions::vote(ctx)
    }

    pub fn retract_vote(ctx: Context<RetractVote>) -> Result<()> {
        instructions::retract_vote(ctx)
    }

    pub fn finalize(ctx: Context<Finalize>) -> Result<()> {
        instructions::finalize(ctx)
    }

    pub fn fail_campaign(ctx: Context<FailCampaign>) -> Result<()> {
        instructions::fail_campaign(ctx)
    }

    pub fn record_kamino_vault(ctx: Context<RecordKaminoVault>) -> Result<()> {
        instructions::record_kamino_vault(ctx)
    }
}
