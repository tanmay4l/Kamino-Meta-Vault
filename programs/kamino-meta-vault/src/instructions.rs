use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::{
    AuthorityTransferred, CampaignFailed, Deposited, Finalized, KaminoVaultRecorded,
    MetaVaultConfig, MetaVaultError, MetaVaultInitialized, PauseSet, PositionClosed,
    ProposalCanceled, ProposalCreated, StrategyProposal, VoteCast, VoteRetracted, VoterPosition,
    Withdrawn, AUTHORITY_SEED, BOND_VAULT_SEED, CONFIG_SEED, KAMINO_KVAULT_MAINNET_PROGRAM_ID,
    KAMINO_KVAULT_STAGING_PROGRAM_ID, KAMINO_VAULT_STATE_ADMIN_OFFSET,
    KAMINO_VAULT_STATE_DISCRIMINATOR, KAMINO_VAULT_STATE_TOKEN_MINT_OFFSET, MAX_BPS, MAX_PROPOSALS,
    MAX_PROPOSAL_TITLE_BYTES, POSITION_SEED, PROPOSAL_SEED,
};

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub token_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = payer,
        space = 8 + MetaVaultConfig::INIT_SPACE,
        seeds = [CONFIG_SEED, token_mint.key().as_ref()],
        bump
    )]
    pub config: Account<'info, MetaVaultConfig>,
    #[account(seeds = [AUTHORITY_SEED, config.key().as_ref()], bump)]
    /// CHECK: PDA used as future Kamino/Squads admin authority. It stores no data.
    pub dao_authority: UncheckedAccount<'info>,
    #[account(
        init,
        payer = payer,
        token::mint = token_mint,
        token::authority = dao_authority,
        seeds = [BOND_VAULT_SEED, config.key().as_ref()],
        bump
    )]
    pub bond_vault: Account<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn initialize_config(
    ctx: Context<InitializeConfig>,
    deposit_deadline_slot: u64,
    voting_deadline_slot: u64,
    min_deposit_amount: u64,
    quorum_bps: u16,
) -> Result<()> {
    let config_key = ctx.accounts.config.key();
    initialize_config_state(
        &mut ctx.accounts.config,
        InitializeConfigState {
            authority: ctx.accounts.payer.key(),
            token_mint: ctx.accounts.token_mint.key(),
            bond_vault: ctx.accounts.bond_vault.key(),
            dao_authority: ctx.accounts.dao_authority.key(),
            authority_bump: ctx.bumps.dao_authority,
            bond_vault_bump: ctx.bumps.bond_vault,
            deposit_deadline_slot,
            voting_deadline_slot,
            min_deposit_amount,
            quorum_bps,
        },
    )?;
    emit_initialized(&ctx.accounts.config, config_key);
    Ok(())
}

#[derive(Accounts)]
#[instruction(config_seed: [u8; 32])]
pub struct InitializeConfigWithSeed<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub token_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = payer,
        space = 8 + MetaVaultConfig::INIT_SPACE,
        seeds = [CONFIG_SEED, token_mint.key().as_ref(), config_seed.as_ref()],
        bump
    )]
    pub config: Account<'info, MetaVaultConfig>,
    #[account(seeds = [AUTHORITY_SEED, config.key().as_ref()], bump)]
    /// CHECK: PDA used as future Kamino/Squads admin authority. It stores no data.
    pub dao_authority: UncheckedAccount<'info>,
    #[account(
        init,
        payer = payer,
        token::mint = token_mint,
        token::authority = dao_authority,
        seeds = [BOND_VAULT_SEED, config.key().as_ref()],
        bump
    )]
    pub bond_vault: Account<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn initialize_config_with_seed(
    ctx: Context<InitializeConfigWithSeed>,
    _config_seed: [u8; 32],
    deposit_deadline_slot: u64,
    voting_deadline_slot: u64,
    min_deposit_amount: u64,
    quorum_bps: u16,
) -> Result<()> {
    let config_key = ctx.accounts.config.key();
    initialize_config_state(
        &mut ctx.accounts.config,
        InitializeConfigState {
            authority: ctx.accounts.payer.key(),
            token_mint: ctx.accounts.token_mint.key(),
            bond_vault: ctx.accounts.bond_vault.key(),
            dao_authority: ctx.accounts.dao_authority.key(),
            authority_bump: ctx.bumps.dao_authority,
            bond_vault_bump: ctx.bumps.bond_vault,
            deposit_deadline_slot,
            voting_deadline_slot,
            min_deposit_amount,
            quorum_bps,
        },
    )?;
    emit_initialized(&ctx.accounts.config, config_key);
    Ok(())
}

struct InitializeConfigState {
    authority: Pubkey,
    token_mint: Pubkey,
    bond_vault: Pubkey,
    dao_authority: Pubkey,
    authority_bump: u8,
    bond_vault_bump: u8,
    deposit_deadline_slot: u64,
    voting_deadline_slot: u64,
    min_deposit_amount: u64,
    quorum_bps: u16,
}

fn initialize_config_state(
    config: &mut Account<MetaVaultConfig>,
    params: InitializeConfigState,
) -> Result<()> {
    let clock = Clock::get()?;
    require!(
        params.deposit_deadline_slot >= clock.slot
            && params.voting_deadline_slot >= params.deposit_deadline_slot,
        MetaVaultError::InvalidConfig
    );
    require!(params.min_deposit_amount > 0, MetaVaultError::InvalidConfig);
    require!(
        params.quorum_bps > 0 && params.quorum_bps <= MAX_BPS,
        MetaVaultError::InvalidConfig
    );

    config.authority = params.authority;
    config.token_mint = params.token_mint;
    config.bond_vault = params.bond_vault;
    config.dao_authority = params.dao_authority;
    config.selected_proposal = Pubkey::default();
    config.selected_curator = Pubkey::default();
    config.kamino_vault = Pubkey::default();
    config.bootstrap_start_slot = clock.slot;
    config.deposit_deadline_slot = params.deposit_deadline_slot;
    config.voting_deadline_slot = params.voting_deadline_slot;
    config.min_deposit_amount = params.min_deposit_amount;
    config.quorum_bps = params.quorum_bps;
    config.proposal_count = 0;
    config.total_bonded = 0;
    config.total_voted_principal = 0;
    config.total_vote_weight = 0;
    config.finalized = false;
    config.paused = false;
    config.authority_bump = params.authority_bump;
    config.bond_vault_bump = params.bond_vault_bump;
    Ok(())
}

fn emit_initialized(config: &Account<MetaVaultConfig>, config_key: Pubkey) {
    emit!(MetaVaultInitialized {
        config: config_key,
        authority: config.authority,
        token_mint: config.token_mint,
        bond_vault: config.bond_vault,
        dao_authority: config.dao_authority,
        bootstrap_start_slot: config.bootstrap_start_slot,
        deposit_deadline_slot: config.deposit_deadline_slot,
        voting_deadline_slot: config.voting_deadline_slot,
        min_deposit_amount: config.min_deposit_amount,
        quorum_bps: config.quorum_bps,
    });
}

#[derive(Accounts)]
pub struct SetPaused<'info> {
    pub authority: Signer<'info>,
    #[account(mut, has_one = authority @ MetaVaultError::Unauthorized)]
    pub config: Account<'info, MetaVaultConfig>,
}

pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
    let config_key = ctx.accounts.config.key();
    ctx.accounts.config.paused = paused;
    emit!(PauseSet {
        config: config_key,
        authority: ctx.accounts.authority.key(),
        paused,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct TransferAuthority<'info> {
    pub authority: Signer<'info>,
    #[account(mut, has_one = authority @ MetaVaultError::Unauthorized)]
    pub config: Account<'info, MetaVaultConfig>,
}

pub fn transfer_authority(ctx: Context<TransferAuthority>, new_authority: Pubkey) -> Result<()> {
    require!(
        new_authority != Pubkey::default(),
        MetaVaultError::InvalidConfig
    );
    let config_key = ctx.accounts.config.key();
    let previous_authority = ctx.accounts.config.authority;
    ctx.accounts.config.authority = new_authority;
    emit!(AuthorityTransferred {
        config: config_key,
        previous_authority,
        new_authority,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut)]
    pub config: Account<'info, MetaVaultConfig>,
    #[account(
        init_if_needed,
        payer = owner,
        space = 8 + VoterPosition::INIT_SPACE,
        seeds = [POSITION_SEED, config.key().as_ref(), owner.key().as_ref()],
        bump
    )]
    pub position: Account<'info, VoterPosition>,
    #[account(
        mut,
        constraint = owner_token_account.mint == config.token_mint,
        constraint = owner_token_account.owner == owner.key() @ MetaVaultError::Unauthorized
    )]
    pub owner_token_account: Account<'info, TokenAccount>,
    #[account(mut, address = config.bond_vault)]
    pub bond_vault: Account<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    let clock = Clock::get()?;
    let config_key = ctx.accounts.config.key();
    let position_key = ctx.accounts.position.key();
    let config = &mut ctx.accounts.config;
    require!(!config.paused, MetaVaultError::Paused);
    require!(!config.finalized, MetaVaultError::AlreadyFinalized);
    require!(
        clock.slot <= config.deposit_deadline_slot,
        MetaVaultError::DepositsClosed
    );
    require!(
        amount >= config.min_deposit_amount,
        MetaVaultError::ZeroAmount
    );
    require!(
        ctx.accounts.position.voted_proposal == Pubkey::default(),
        MetaVaultError::ActiveVote
    );

    let position = &mut ctx.accounts.position;
    if position.owner == Pubkey::default() {
        position.config = config_key;
        position.owner = ctx.accounts.owner.key();
        position.bonded_amount = 0;
        position.start_slot = clock.slot;
        position.voted_proposal = Pubkey::default();
        position.vote_weight = 0;
    }

    token::transfer(
        CpiContext::new(
            token::ID,
            Transfer {
                from: ctx.accounts.owner_token_account.to_account_info(),
                to: ctx.accounts.bond_vault.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            },
        ),
        amount,
    )?;

    position.bonded_amount = position
        .bonded_amount
        .checked_add(amount)
        .ok_or(MetaVaultError::ArithmeticOverflow)?;
    position.start_slot = clock.slot;
    config.total_bonded = config
        .total_bonded
        .checked_add(amount)
        .ok_or(MetaVaultError::ArithmeticOverflow)?;
    emit!(Deposited {
        config: config_key,
        owner: ctx.accounts.owner.key(),
        position: position_key,
        amount,
        bonded_amount: position.bonded_amount,
        total_bonded: config.total_bonded,
        slot: clock.slot,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut)]
    pub config: Account<'info, MetaVaultConfig>,
    #[account(
        mut,
        seeds = [POSITION_SEED, config.key().as_ref(), owner.key().as_ref()],
        bump,
        has_one = owner,
        has_one = config
    )]
    pub position: Account<'info, VoterPosition>,
    #[account(
        mut,
        constraint = owner_token_account.mint == config.token_mint,
        constraint = owner_token_account.owner == owner.key() @ MetaVaultError::Unauthorized
    )]
    pub owner_token_account: Account<'info, TokenAccount>,
    #[account(mut, address = config.bond_vault)]
    pub bond_vault: Account<'info, TokenAccount>,
    #[account(seeds = [AUTHORITY_SEED, config.key().as_ref()], bump = config.authority_bump)]
    /// CHECK: PDA token authority for the bond vault.
    pub dao_authority: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
    let config_key = ctx.accounts.config.key();
    let position_key = ctx.accounts.position.key();
    let config = &mut ctx.accounts.config;
    require!(!config.paused, MetaVaultError::Paused);
    require!(amount > 0, MetaVaultError::ZeroAmount);
    require!(
        config.finalized || ctx.accounts.position.voted_proposal == Pubkey::default(),
        MetaVaultError::ActiveVote
    );
    require!(
        ctx.accounts.position.bonded_amount >= amount,
        MetaVaultError::InsufficientBond
    );

    ctx.accounts.position.bonded_amount = ctx
        .accounts
        .position
        .bonded_amount
        .checked_sub(amount)
        .ok_or(MetaVaultError::ArithmeticOverflow)?;
    config.total_bonded = config
        .total_bonded
        .checked_sub(amount)
        .ok_or(MetaVaultError::ArithmeticOverflow)?;
    if config.finalized {
        ctx.accounts.position.voted_proposal = Pubkey::default();
        ctx.accounts.position.vote_weight = 0;
    }

    let seeds: &[&[u8]] = &[
        AUTHORITY_SEED,
        config_key.as_ref(),
        &[config.authority_bump],
    ];
    token::transfer(
        CpiContext::new_with_signer(
            token::ID,
            Transfer {
                from: ctx.accounts.bond_vault.to_account_info(),
                to: ctx.accounts.owner_token_account.to_account_info(),
                authority: ctx.accounts.dao_authority.to_account_info(),
            },
            &[seeds],
        ),
        amount,
    )?;
    emit!(Withdrawn {
        config: config_key,
        owner: ctx.accounts.owner.key(),
        position: position_key,
        amount,
        bonded_amount: ctx.accounts.position.bonded_amount,
        total_bonded: config.total_bonded,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct ClosePosition<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    pub config: Account<'info, MetaVaultConfig>,
    #[account(
        mut,
        close = owner,
        seeds = [POSITION_SEED, config.key().as_ref(), owner.key().as_ref()],
        bump,
        has_one = owner,
        has_one = config,
        constraint = position.voted_proposal == Pubkey::default() @ MetaVaultError::ActiveVote,
        constraint = position.bonded_amount == 0 @ MetaVaultError::InsufficientBond
    )]
    pub position: Account<'info, VoterPosition>,
}

pub fn close_position(ctx: Context<ClosePosition>) -> Result<()> {
    emit!(PositionClosed {
        config: ctx.accounts.config.key(),
        owner: ctx.accounts.owner.key(),
        position: ctx.accounts.position.key(),
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(curator: Pubkey, metadata_hash: [u8; 32], title: String)]
pub struct CreateProposal<'info> {
    #[account(mut)]
    pub proposer: Signer<'info>,
    #[account(mut)]
    pub config: Account<'info, MetaVaultConfig>,
    #[account(
        init,
        payer = proposer,
        space = 8 + StrategyProposal::INIT_SPACE,
        seeds = [PROPOSAL_SEED, config.key().as_ref(), &config.proposal_count.to_le_bytes()],
        bump
    )]
    pub proposal: Account<'info, StrategyProposal>,
    pub system_program: Program<'info, System>,
}

pub fn create_proposal(
    ctx: Context<CreateProposal>,
    curator: Pubkey,
    metadata_hash: [u8; 32],
    title: String,
) -> Result<()> {
    let clock = Clock::get()?;
    let config_key = ctx.accounts.config.key();
    let proposal_key = ctx.accounts.proposal.key();
    let config = &mut ctx.accounts.config;
    require!(!config.paused, MetaVaultError::Paused);
    require!(!config.finalized, MetaVaultError::AlreadyFinalized);
    require!(
        clock.slot <= config.voting_deadline_slot,
        MetaVaultError::VotingClosed
    );
    require!(
        config.proposal_count < MAX_PROPOSALS,
        MetaVaultError::ProposalLimitReached
    );
    require!(curator != Pubkey::default(), MetaVaultError::InvalidConfig);
    require!(
        has_visible_title(&title),
        MetaVaultError::InvalidProposalTitle
    );
    require!(
        metadata_hash != [0; 32],
        MetaVaultError::InvalidProposalMetadata
    );
    require!(
        title.len() <= MAX_PROPOSAL_TITLE_BYTES,
        MetaVaultError::InvalidConfig
    );

    let proposal = &mut ctx.accounts.proposal;
    proposal.config = config_key;
    proposal.proposer = ctx.accounts.proposer.key();
    proposal.curator = curator;
    proposal.proposal_id = config.proposal_count;
    proposal.support_principal = 0;
    proposal.support_weight = 0;
    proposal.active = true;
    proposal.metadata_hash = metadata_hash;
    proposal.title = title;

    config.proposal_count = config
        .proposal_count
        .checked_add(1)
        .ok_or(MetaVaultError::ArithmeticOverflow)?;
    emit!(ProposalCreated {
        config: config_key,
        proposal: proposal_key,
        proposer: ctx.accounts.proposer.key(),
        curator,
        proposal_id: proposal.proposal_id,
        metadata_hash,
    });
    Ok(())
}

fn has_visible_title(title: &str) -> bool {
    title.bytes().any(|byte| !byte.is_ascii_whitespace())
}

#[derive(Accounts)]
pub struct CancelProposal<'info> {
    pub signer: Signer<'info>,
    #[account(mut)]
    pub config: Account<'info, MetaVaultConfig>,
    #[account(mut, has_one = config)]
    pub proposal: Account<'info, StrategyProposal>,
}

pub fn cancel_proposal(ctx: Context<CancelProposal>) -> Result<()> {
    let clock = Clock::get()?;
    let config = &ctx.accounts.config;
    let signer = ctx.accounts.signer.key();
    require!(!config.paused, MetaVaultError::Paused);
    require!(!config.finalized, MetaVaultError::AlreadyFinalized);
    require!(
        clock.slot <= config.voting_deadline_slot,
        MetaVaultError::VotingClosed
    );
    require!(
        ctx.accounts.proposal.active,
        MetaVaultError::InactiveProposal
    );
    require!(
        signer == config.authority || signer == ctx.accounts.proposal.proposer,
        MetaVaultError::Unauthorized
    );
    require!(
        ctx.accounts.proposal.support_principal == 0 && ctx.accounts.proposal.support_weight == 0,
        MetaVaultError::ProposalHasVotes
    );

    ctx.accounts.proposal.active = false;
    emit!(ProposalCanceled {
        config: config.key(),
        proposal: ctx.accounts.proposal.key(),
        canceled_by: signer,
        proposal_id: ctx.accounts.proposal.proposal_id,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct Vote<'info> {
    pub owner: Signer<'info>,
    #[account(mut)]
    pub config: Account<'info, MetaVaultConfig>,
    #[account(
        mut,
        seeds = [POSITION_SEED, config.key().as_ref(), owner.key().as_ref()],
        bump,
        has_one = owner,
        has_one = config
    )]
    pub position: Account<'info, VoterPosition>,
    #[account(mut, has_one = config)]
    pub proposal: Account<'info, StrategyProposal>,
}

pub fn vote(ctx: Context<Vote>) -> Result<()> {
    let clock = Clock::get()?;
    let proposal_key = ctx.accounts.proposal.key();
    let config = &mut ctx.accounts.config;
    require!(!config.paused, MetaVaultError::Paused);
    require!(!config.finalized, MetaVaultError::AlreadyFinalized);
    require!(
        clock.slot <= config.voting_deadline_slot,
        MetaVaultError::VotingClosed
    );
    require!(
        ctx.accounts.proposal.active,
        MetaVaultError::InactiveProposal
    );
    require!(
        ctx.accounts.position.voted_proposal == Pubkey::default(),
        MetaVaultError::ActiveVote
    );
    require!(
        ctx.accounts.position.bonded_amount > 0,
        MetaVaultError::InsufficientBond
    );

    let weight = time_weight(
        ctx.accounts.position.bonded_amount,
        ctx.accounts.position.start_slot,
        clock.slot,
    )?;
    require!(weight > 0, MetaVaultError::VoteTooYoung);
    ctx.accounts.position.voted_proposal = proposal_key;
    ctx.accounts.position.vote_weight = weight;
    ctx.accounts.proposal.support_principal = ctx
        .accounts
        .proposal
        .support_principal
        .checked_add(ctx.accounts.position.bonded_amount)
        .ok_or(MetaVaultError::ArithmeticOverflow)?;
    ctx.accounts.proposal.support_weight = ctx
        .accounts
        .proposal
        .support_weight
        .checked_add(weight)
        .ok_or(MetaVaultError::ArithmeticOverflow)?;
    config.total_voted_principal = config
        .total_voted_principal
        .checked_add(ctx.accounts.position.bonded_amount)
        .ok_or(MetaVaultError::ArithmeticOverflow)?;
    config.total_vote_weight = config
        .total_vote_weight
        .checked_add(weight)
        .ok_or(MetaVaultError::ArithmeticOverflow)?;
    emit!(VoteCast {
        config: config.key(),
        proposal: proposal_key,
        owner: ctx.accounts.owner.key(),
        principal: ctx.accounts.position.bonded_amount,
        weight,
        total_voted_principal: config.total_voted_principal,
        total_vote_weight: config.total_vote_weight,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct RetractVote<'info> {
    pub owner: Signer<'info>,
    #[account(mut)]
    pub config: Account<'info, MetaVaultConfig>,
    #[account(
        mut,
        seeds = [POSITION_SEED, config.key().as_ref(), owner.key().as_ref()],
        bump,
        has_one = owner,
        has_one = config
    )]
    pub position: Account<'info, VoterPosition>,
    #[account(mut, has_one = config, address = position.voted_proposal)]
    pub proposal: Account<'info, StrategyProposal>,
}

pub fn retract_vote(ctx: Context<RetractVote>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let config_key = config.key();
    let proposal_key = ctx.accounts.proposal.key();
    let principal = ctx.accounts.position.bonded_amount;
    let weight = ctx.accounts.position.vote_weight;
    require!(!config.paused, MetaVaultError::Paused);
    require!(!config.finalized, MetaVaultError::AlreadyFinalized);
    require!(
        ctx.accounts.position.voted_proposal != Pubkey::default(),
        MetaVaultError::NoActiveVote
    );

    ctx.accounts.proposal.support_principal = ctx
        .accounts
        .proposal
        .support_principal
        .checked_sub(ctx.accounts.position.bonded_amount)
        .ok_or(MetaVaultError::ArithmeticOverflow)?;
    ctx.accounts.proposal.support_weight = ctx
        .accounts
        .proposal
        .support_weight
        .checked_sub(ctx.accounts.position.vote_weight)
        .ok_or(MetaVaultError::ArithmeticOverflow)?;
    config.total_voted_principal = config
        .total_voted_principal
        .checked_sub(ctx.accounts.position.bonded_amount)
        .ok_or(MetaVaultError::ArithmeticOverflow)?;
    config.total_vote_weight = config
        .total_vote_weight
        .checked_sub(ctx.accounts.position.vote_weight)
        .ok_or(MetaVaultError::ArithmeticOverflow)?;
    ctx.accounts.position.voted_proposal = Pubkey::default();
    ctx.accounts.position.vote_weight = 0;
    emit!(VoteRetracted {
        config: config_key,
        proposal: proposal_key,
        owner: ctx.accounts.owner.key(),
        principal,
        weight,
        total_voted_principal: config.total_voted_principal,
        total_vote_weight: config.total_vote_weight,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct Finalize<'info> {
    #[account(mut)]
    pub config: Account<'info, MetaVaultConfig>,
    #[account(has_one = config)]
    pub winning_proposal: Account<'info, StrategyProposal>,
}

pub fn finalize(ctx: Context<Finalize>) -> Result<()> {
    let clock = Clock::get()?;
    let config = &mut ctx.accounts.config;
    require!(!config.paused, MetaVaultError::Paused);
    require!(!config.finalized, MetaVaultError::AlreadyFinalized);
    require!(
        clock.slot > config.voting_deadline_slot,
        MetaVaultError::VotingClosed
    );

    require!(config.total_bonded > 0, MetaVaultError::QuorumNotReached);
    let voted_scaled = (config.total_voted_principal as u128)
        .checked_mul(MAX_BPS as u128)
        .ok_or(MetaVaultError::ArithmeticOverflow)?;
    let quorum_scaled = (config.total_bonded as u128)
        .checked_mul(config.quorum_bps as u128)
        .ok_or(MetaVaultError::ArithmeticOverflow)?;
    require!(
        voted_scaled > quorum_scaled,
        MetaVaultError::QuorumNotReached
    );
    require!(
        ctx.accounts.winning_proposal.active,
        MetaVaultError::InactiveProposal
    );
    require!(
        ctx.accounts
            .winning_proposal
            .support_weight
            .checked_mul(2)
            .ok_or(MetaVaultError::ArithmeticOverflow)?
            > config.total_vote_weight,
        MetaVaultError::MajorityNotReached
    );

    config.finalized = true;
    config.selected_proposal = ctx.accounts.winning_proposal.key();
    config.selected_curator = ctx.accounts.winning_proposal.curator;
    emit!(Finalized {
        config: config.key(),
        selected_proposal: config.selected_proposal,
        selected_curator: config.selected_curator,
        total_bonded: config.total_bonded,
        total_voted_principal: config.total_voted_principal,
        total_vote_weight: config.total_vote_weight,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct FailCampaign<'info> {
    #[account(mut)]
    pub config: Account<'info, MetaVaultConfig>,
}

pub fn fail_campaign(ctx: Context<FailCampaign>) -> Result<()> {
    let clock = Clock::get()?;
    let config = &mut ctx.accounts.config;
    let config_key = config.key();
    require!(!config.paused, MetaVaultError::Paused);
    require!(!config.finalized, MetaVaultError::AlreadyFinalized);
    require!(
        clock.slot > config.voting_deadline_slot,
        MetaVaultError::VotingClosed
    );

    let voted_scaled = (config.total_voted_principal as u128)
        .checked_mul(MAX_BPS as u128)
        .ok_or(MetaVaultError::ArithmeticOverflow)?;
    let quorum_scaled = (config.total_bonded as u128)
        .checked_mul(config.quorum_bps as u128)
        .ok_or(MetaVaultError::ArithmeticOverflow)?;
    if voted_scaled > quorum_scaled {
        verify_no_strict_majority(config, config_key, ctx.remaining_accounts)?;
    }

    config.finalized = true;
    config.selected_proposal = Pubkey::default();
    config.selected_curator = Pubkey::default();
    config.kamino_vault = Pubkey::default();
    emit!(CampaignFailed {
        config: config.key(),
        total_bonded: config.total_bonded,
        total_voted_principal: config.total_voted_principal,
        quorum_bps: config.quorum_bps,
    });
    Ok(())
}

fn verify_no_strict_majority<'info>(
    config: &Account<MetaVaultConfig>,
    config_key: Pubkey,
    proposal_accounts: &'info [AccountInfo<'info>],
) -> Result<()> {
    let proposal_count =
        usize::try_from(config.proposal_count).map_err(|_| MetaVaultError::ArithmeticOverflow)?;
    require!(
        proposal_accounts.len() == proposal_count,
        MetaVaultError::ProposalCountMismatch
    );

    let mut seen = vec![false; proposal_count];
    for proposal_info in proposal_accounts {
        let proposal = Account::<StrategyProposal>::try_from(proposal_info)?;
        require!(
            proposal.config == config_key,
            MetaVaultError::ProposalConfigMismatch
        );
        let proposal_id = usize::try_from(proposal.proposal_id)
            .map_err(|_| MetaVaultError::ArithmeticOverflow)?;
        require!(proposal_id < proposal_count, MetaVaultError::InvalidConfig);
        require!(!seen[proposal_id], MetaVaultError::DuplicateProposal);
        seen[proposal_id] = true;
        require!(
            proposal
                .support_weight
                .checked_mul(2)
                .ok_or(MetaVaultError::ArithmeticOverflow)?
                <= config.total_vote_weight,
            MetaVaultError::QuorumStillReachable
        );
    }

    Ok(())
}

#[derive(Accounts)]
pub struct RecordKaminoVault<'info> {
    pub curator: Signer<'info>,
    #[account(mut)]
    pub config: Account<'info, MetaVaultConfig>,
    /// CHECK: owner is validated against the Kamino kvault program allowlist.
    pub kamino_vault: UncheckedAccount<'info>,
}

pub fn record_kamino_vault(ctx: Context<RecordKaminoVault>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let kamino_vault = ctx.accounts.kamino_vault.key();
    require!(!config.paused, MetaVaultError::Paused);
    require!(config.finalized, MetaVaultError::NotFinalized);
    require!(
        ctx.accounts.curator.key() == config.selected_curator,
        MetaVaultError::Unauthorized
    );
    require!(
        kamino_vault != Pubkey::default(),
        MetaVaultError::InvalidConfig
    );
    require!(
        config.kamino_vault == Pubkey::default(),
        MetaVaultError::KaminoVaultAlreadyRecorded
    );
    require!(
        is_allowed_kamino_vault_program(ctx.accounts.kamino_vault.owner),
        MetaVaultError::InvalidKaminoVaultProgram
    );
    require!(
        ctx.accounts.kamino_vault.data_len() >= KAMINO_VAULT_STATE_TOKEN_MINT_OFFSET + 32,
        MetaVaultError::InvalidKaminoVaultAccount
    );
    let vault_state = kamino_vault_state_header(&ctx.accounts.kamino_vault)?;
    require!(
        vault_state.token_mint == config.token_mint,
        MetaVaultError::InvalidKaminoVaultMint
    );
    require!(
        vault_state.vault_admin_authority == config.dao_authority,
        MetaVaultError::InvalidKaminoVaultAuthority
    );
    config.kamino_vault = kamino_vault;
    emit!(KaminoVaultRecorded {
        config: config.key(),
        curator: ctx.accounts.curator.key(),
        kamino_vault,
    });
    Ok(())
}

fn is_allowed_kamino_vault_program(owner: &Pubkey) -> bool {
    *owner == KAMINO_KVAULT_MAINNET_PROGRAM_ID || *owner == KAMINO_KVAULT_STAGING_PROGRAM_ID
}

struct KaminoVaultStateHeader {
    vault_admin_authority: Pubkey,
    token_mint: Pubkey,
}

fn kamino_vault_state_header(kamino_vault: &UncheckedAccount) -> Result<KaminoVaultStateHeader> {
    let data = kamino_vault.try_borrow_data()?;
    require!(
        data.len() >= KAMINO_VAULT_STATE_TOKEN_MINT_OFFSET + 32,
        MetaVaultError::InvalidKaminoVaultAccount
    );
    require!(
        data[..KAMINO_VAULT_STATE_DISCRIMINATOR.len()] == KAMINO_VAULT_STATE_DISCRIMINATOR,
        MetaVaultError::InvalidKaminoVaultAccount
    );

    Ok(KaminoVaultStateHeader {
        vault_admin_authority: read_pubkey_at(&data, KAMINO_VAULT_STATE_ADMIN_OFFSET)?,
        token_mint: read_pubkey_at(&data, KAMINO_VAULT_STATE_TOKEN_MINT_OFFSET)?,
    })
}

fn read_pubkey_at(data: &[u8], offset: usize) -> Result<Pubkey> {
    let end = offset
        .checked_add(32)
        .ok_or(MetaVaultError::ArithmeticOverflow)?;
    let bytes: [u8; 32] = data
        .get(offset..end)
        .ok_or(MetaVaultError::InvalidKaminoVaultAccount)?
        .try_into()
        .map_err(|_| MetaVaultError::InvalidKaminoVaultAccount)?;
    Ok(Pubkey::new_from_array(bytes))
}

fn time_weight(amount: u64, start_slot: u64, now_slot: u64) -> Result<u128> {
    let held_slots = now_slot.saturating_sub(start_slot);
    if held_slots < 2 {
        return Ok(0);
    }
    let multiplier = 64u32
        .checked_sub(held_slots.leading_zeros())
        .ok_or(MetaVaultError::ArithmeticOverflow)? as u128;
    (amount as u128)
        .checked_mul(multiplier)
        .ok_or(MetaVaultError::ArithmeticOverflow.into())
}
