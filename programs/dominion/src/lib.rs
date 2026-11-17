use anchor_lang::prelude::*;
use anchor_spl::{associated_token::AssociatedToken, token::{self, Mint, Token, TokenAccount, MintTo, SetAuthority, TransferChecked, spl_token::instruction::AuthorityType}};

declare_id!("Fg6PaFpoGXkYsidMpWxTWqkZ7FEfcYkgMQHHTPqzW8B");
pub const INITIAL_SUPPLY: u64 = 1_000_000_000_000_000;
pub const TOKEN_DECIMALS: u8 = 6;

#[program]
pub mod dominion {
    use super::*;
    pub fn initialize_config(ctx: Context<InitializeConfig>) -> Result<()> {
        require!(ctx.accounts.quote_mint.freeze_authority.is_none(), LaunchError::FreezeAuthority);
        ctx.accounts.config.quote_mint = ctx.accounts.quote_mint.key();
        ctx.accounts.config.bump = ctx.bumps.config;
        Ok(())
    }
    pub fn create_pool(ctx: Context<CreatePool>, name: String, symbol: String, seed_quote: u64) -> Result<()> {
        require!(!name.trim().is_empty() && name.len() <= 32, LaunchError::InvalidMetadata);
        require!(!symbol.is_empty() && symbol.len() <= 10 && symbol.bytes().all(|b| b.is_ascii_alphanumeric()), LaunchError::InvalidMetadata);
        require!(seed_quote > 0, LaunchError::ZeroAmount);
        require!(ctx.accounts.quote_mint.freeze_authority.is_none(), LaunchError::FreezeAuthority);
        let mint_key = ctx.accounts.mint.key();
        let bump = [ctx.bumps.pool];
        let seeds: &[&[u8]] = &[b"pool", mint_key.as_ref(), &bump];
        token::mint_to(CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), MintTo {
            mint: ctx.accounts.mint.to_account_info(), to: ctx.accounts.token_vault.to_account_info(), authority: ctx.accounts.pool.to_account_info()
        }, &[seeds]), INITIAL_SUPPLY)?;
        token::set_authority(CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), SetAuthority {
            current_authority: ctx.accounts.pool.to_account_info(), account_or_mint: ctx.accounts.mint.to_account_info()
        }, &[seeds]), AuthorityType::MintTokens, None)?;
        token::transfer_checked(CpiContext::new(ctx.accounts.token_program.to_account_info(), TransferChecked {
            from: ctx.accounts.creator_quote.to_account_info(), mint: ctx.accounts.quote_mint.to_account_info(), to: ctx.accounts.quote_vault.to_account_info(), authority: ctx.accounts.creator.to_account_info()
        }), seed_quote, ctx.accounts.quote_mint.decimals)?;
        let pool = &mut ctx.accounts.pool;
        pool.creator = ctx.accounts.creator.key();
        pool.mint = mint_key;
        pool.quote_mint = ctx.accounts.quote_mint.key();
        pool.token_vault = ctx.accounts.token_vault.key();
        pool.quote_vault = ctx.accounts.quote_vault.key();
        pool.initial_supply = INITIAL_SUPPLY;
        pool.created_at = Clock::get()?.unix_timestamp;
        pool.bump = bump[0];
        pool.name = name;
        pool.symbol = symbol;
        emit!(PoolCreated { pool: pool.key(), mint: mint_key, creator: pool.creator, quote_mint: pool.quote_mint, seed_quote });
        Ok(())
    }
    pub fn buy(ctx: Context<Swap>, amount_in: u64, min_out: u64, deadline: i64) -> Result<()> {
        check_deadline(deadline)?;
        let out = output_amount(ctx.accounts.quote_vault.amount, ctx.accounts.token_vault.amount, amount_in)?;
        require!(out >= min_out && min_out > 0, LaunchError::Slippage);
        token::transfer_checked(CpiContext::new(ctx.accounts.token_program.to_account_info(), TransferChecked {
            from: ctx.accounts.trader_quote.to_account_info(), mint: ctx.accounts.quote_mint.to_account_info(), to: ctx.accounts.quote_vault.to_account_info(), authority: ctx.accounts.trader.to_account_info()
        }), amount_in, ctx.accounts.quote_mint.decimals)?;
        let mint_key = ctx.accounts.mint.key();
        let bump = [ctx.accounts.pool.bump];
        let seeds: &[&[u8]] = &[b"pool", mint_key.as_ref(), &bump];
        token::transfer_checked(CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), TransferChecked {
            from: ctx.accounts.token_vault.to_account_info(), mint: ctx.accounts.mint.to_account_info(), to: ctx.accounts.trader_token.to_account_info(), authority: ctx.accounts.pool.to_account_info()
        }, &[seeds]), out, TOKEN_DECIMALS)?;
        emit!(Trade { pool: ctx.accounts.pool.key(), trader: ctx.accounts.trader.key(), buy: true, amount_in, amount_out: out });
        Ok(())
    }
    pub fn sell(ctx: Context<Swap>, amount_in: u64, min_out: u64, deadline: i64) -> Result<()> {
        check_deadline(deadline)?;
        let out = output_amount(ctx.accounts.token_vault.amount, ctx.accounts.quote_vault.amount, amount_in)?;
        require!(out >= min_out && min_out > 0, LaunchError::Slippage);
        token::transfer_checked(CpiContext::new(ctx.accounts.token_program.to_account_info(), TransferChecked {
            from: ctx.accounts.trader_token.to_account_info(), mint: ctx.accounts.mint.to_account_info(), to: ctx.accounts.token_vault.to_account_info(), authority: ctx.accounts.trader.to_account_info()
        }), amount_in, TOKEN_DECIMALS)?;
        let mint_key = ctx.accounts.mint.key();
        let bump = [ctx.accounts.pool.bump];
        let seeds: &[&[u8]] = &[b"pool", mint_key.as_ref(), &bump];
        token::transfer_checked(CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), TransferChecked {
            from: ctx.accounts.quote_vault.to_account_info(), mint: ctx.accounts.quote_mint.to_account_info(), to: ctx.accounts.trader_quote.to_account_info(), authority: ctx.accounts.pool.to_account_info()
        }, &[seeds]), out, ctx.accounts.quote_mint.decimals)?;
        emit!(Trade { pool: ctx.accounts.pool.key(), trader: ctx.accounts.trader.key(), buy: false, amount_in, amount_out: out });
        Ok(())
    }
}

fn check_deadline(deadline: i64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(deadline >= now && deadline <= now.saturating_add(300), LaunchError::Expired);
    Ok(())
}
/// Exact integer constant product with floor output, so rounding benefits reserves.
pub fn output_amount(reserve_in: u64, reserve_out: u64, amount: u64) -> Result<u64> {
    require!(reserve_in > 0 && reserve_out > 0 && amount > 0, LaunchError::ZeroAmount);
    // Reject an input balance overflow even though u128 intermediate would fit.
    let next = reserve_in.checked_add(amount).ok_or(LaunchError::Overflow)?;
    let numerator = (reserve_out as u128).checked_mul(amount as u128).ok_or(LaunchError::Overflow)?;
    let result = u64::try_from(numerator / next as u128).map_err(|_| LaunchError::Overflow)?;
    require!(result > 0 && result < reserve_out, LaunchError::Dust);
    Ok(result)
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)] pub payer: Signer<'info>,
    pub quote_mint: Account<'info, Mint>,
    #[account(init, payer = payer, space = 8 + Config::INIT_SPACE, seeds = [b"config", quote_mint.key().as_ref()], bump)]
    pub config: Account<'info, Config>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct CreatePool<'info> {
    #[account(mut)] pub creator: Signer<'info>,
    #[account(seeds = [b"config", quote_mint.key().as_ref()], bump = config.bump, has_one = quote_mint)]
    pub config: Account<'info, Config>,
    pub quote_mint: Account<'info, Mint>,
    #[account(init, payer = creator, mint::decimals = TOKEN_DECIMALS, mint::authority = pool)]
    pub mint: Account<'info, Mint>,
    #[account(init, payer = creator, space = 8 + Pool::INIT_SPACE, seeds = [b"pool", mint.key().as_ref()], bump)]
    pub pool: Account<'info, Pool>,
    #[account(init, payer = creator, associated_token::mint = mint, associated_token::authority = pool)]
    pub token_vault: Account<'info, TokenAccount>,
    #[account(init, payer = creator, associated_token::mint = quote_mint, associated_token::authority = pool)]
    pub quote_vault: Account<'info, TokenAccount>,
    #[account(mut, associated_token::mint = quote_mint, associated_token::authority = creator)]
    pub creator_quote: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct Swap<'info> {
    #[account(mut)] pub trader: Signer<'info>,
    #[account(seeds = [b"pool", mint.key().as_ref()], bump = pool.bump, has_one = mint, has_one = quote_mint, has_one = token_vault, has_one = quote_vault)]
    pub pool: Account<'info, Pool>,
    #[account(constraint = mint.decimals == TOKEN_DECIMALS @ LaunchError::InvalidMint)]
    pub mint: Account<'info, Mint>,
    pub quote_mint: Account<'info, Mint>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = pool)]
    pub token_vault: Account<'info, TokenAccount>,
    #[account(mut, associated_token::mint = quote_mint, associated_token::authority = pool)]
    pub quote_vault: Account<'info, TokenAccount>,
    #[account(init_if_needed, payer = trader, associated_token::mint = mint, associated_token::authority = trader)]
    pub trader_token: Account<'info, TokenAccount>,
    #[account(init_if_needed, payer = trader, associated_token::mint = quote_mint, associated_token::authority = trader)]
    pub trader_quote: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
#[account]
#[derive(InitSpace)]
pub struct Config { pub quote_mint: Pubkey, pub bump: u8 }
#[account]
#[derive(InitSpace)]
pub struct Pool {
    pub creator: Pubkey, pub mint: Pubkey, pub quote_mint: Pubkey,
    pub token_vault: Pubkey, pub quote_vault: Pubkey,
    pub initial_supply: u64, pub created_at: i64, pub bump: u8,
    #[max_len(32)] pub name: String,
    #[max_len(10)] pub symbol: String,
}
#[event]
pub struct PoolCreated { pub pool: Pubkey, pub mint: Pubkey, pub creator: Pubkey, pub quote_mint: Pubkey, pub seed_quote: u64 }
#[event]
pub struct Trade { pub pool: Pubkey, pub trader: Pubkey, pub buy: bool, pub amount_in: u64, pub amount_out: u64 }
#[error_code]
pub enum LaunchError {
    #[msg("Le mint de paiement possède une autorité de gel.")] FreezeAuthority,
    #[msg("Nom ou symbole invalide.")] InvalidMetadata,
    #[msg("Les réserves et le montant doivent être positifs.")] ZeroAmount,
    #[msg("Le résultat minimal n'est pas atteint.")] Slippage,
    #[msg("Devis expiré ou délai supérieur à cinq minutes.")] Expired,
    #[msg("Dépassement numérique.")] Overflow,
    #[msg("Montant trop faible ou réserve insuffisante.")] Dust,
    #[msg("Mint incompatible.")] InvalidMint,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn example() { assert_eq!(output_amount(1_000, 1_000, 100).unwrap(), 90); }
    #[test] fn zero_and_dust_rejected() {
        for (x,y,a) in [(0,1,1),(1,0,1),(1,1,0),(1_000,1,1)] { assert!(output_amount(x,y,a).is_err()); }
    }
    #[test] fn overflow_rejected() { assert!(output_amount(u64::MAX, 100, 1).is_err()); }
    #[test] fn invariant_and_roundtrip() {
        for x in [10u64, 1_000, 1_000_000, 10_000_000_000] {
            for y in [10u64, 1_000, 1_000_000, 10_000_000_000] {
                for amount in [1u64, 10, 100, 1_000, 1_000_000] {
                    if let Ok(out) = output_amount(x,y,amount) {
                        assert!((x+amount) as u128 * (y-out) as u128 >= x as u128 * y as u128);
                        if let Ok(back) = output_amount(y-out,x+amount,out) { assert!(back <= amount); }
                    }
                }
            }
        }
    }
    #[test] fn near_u64_limit() {
        let out = output_amount(u64::MAX/2, u64::MAX, u64::MAX/2).unwrap();
        assert_eq!(out, u64::MAX/2);
    }
}
