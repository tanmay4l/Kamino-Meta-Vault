use anchor_lang::prelude::*;

#[error_code]
pub enum MetaVaultError {
    #[msg("Invalid configuration")]
    InvalidConfig,
    #[msg("Protocol is paused")]
    Paused,
    #[msg("Bootstrap deposits are closed")]
    DepositsClosed,
    #[msg("Voting is closed")]
    VotingClosed,
    #[msg("Vault has already finalized")]
    AlreadyFinalized,
    #[msg("Vault is not finalized")]
    NotFinalized,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Insufficient bonded balance")]
    InsufficientBond,
    #[msg("Retract the active vote before changing bonded balance")]
    ActiveVote,
    #[msg("Position has not voted")]
    NoActiveVote,
    #[msg("Bond must age before it can vote")]
    VoteTooYoung,
    #[msg("Proposal is not active")]
    InactiveProposal,
    #[msg("Proposal title is empty")]
    InvalidProposalTitle,
    #[msg("Proposal metadata hash is empty")]
    InvalidProposalMetadata,
    #[msg("Proposal does not belong to this config")]
    ProposalConfigMismatch,
    #[msg("Quorum was not reached")]
    QuorumNotReached,
    #[msg("Proposal does not have strict majority")]
    MajorityNotReached,
    #[msg("Campaign cannot be failed while quorum is reachable")]
    QuorumStillReachable,
    #[msg("All campaign proposals must be supplied to fail after quorum")]
    ProposalCountMismatch,
    #[msg("Duplicate proposal supplied")]
    DuplicateProposal,
    #[msg("Campaign proposal limit reached")]
    ProposalLimitReached,
    #[msg("Proposal already has votes")]
    ProposalHasVotes,
    #[msg("Kamino vault is already recorded")]
    KaminoVaultAlreadyRecorded,
    #[msg("Kamino vault account is not owned by an allowed Kamino kvault program")]
    InvalidKaminoVaultProgram,
    #[msg("Kamino vault account is not an initialized Kamino VaultState")]
    InvalidKaminoVaultAccount,
    #[msg("Kamino vault token mint does not match this campaign")]
    InvalidKaminoVaultMint,
    #[msg("Kamino vault admin authority does not match the DAO authority")]
    InvalidKaminoVaultAuthority,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,
}
