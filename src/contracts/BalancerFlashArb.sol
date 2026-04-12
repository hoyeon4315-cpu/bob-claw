// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * BOB Claw — Balancer V3 Flash Loan Triangular Arbitrage (Base chain)
 *
 * Strategy: Borrow USDC via Balancer V3 (0% fee) → 3-leg triangular swap
 *           via Odos router → repay flash loan → keep profit.
 *
 * Route: USDC → BTC_A → BTC_B → USDC (e.g., USDC → LBTC → cbBTC → USDC)
 *
 * Why Balancer V3:
 *   - Flash loan fee = 0% (vs Aave 0.05%)
 *   - $260K+ USDC in vault on Base
 *   - This 0.05% difference is the entire edge at current spread levels
 *
 * Safety (per AGENTS.md):
 *   - Owner-only execution, no LLM in execution path
 *   - Emergency stop checked before every trade
 *   - Min profit threshold enforced on-chain
 *   - No unlimited approvals (exact amounts only)
 *   - All profit sent to owner immediately
 *   - Daily loss tracking (off-chain enforced)
 */

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}

/// @dev Balancer V3 Vault interface — only the flash loan parts we need
interface IBalancerVault {
    /// @notice Unlock the vault for a flash loan. The callback receives control.
    function unlock(bytes calldata data) external returns (bytes memory);

    /// @notice Send tokens from the vault to a recipient (inside unlock callback)
    function sendTo(IERC20 token, address to, uint256 amount) external;

    /// @notice Settle — the vault pulls tokens back. Returns credit.
    function settle(IERC20 token, uint256 amount) external returns (uint256);

    /// @notice Transfer tokens to the vault before calling settle
    function isUnlocked() external view returns (bool);
}

contract BalancerFlashArb {
    // ── Base Mainnet Addresses ──────────────────────────────────────────────
    address public constant BALANCER_VAULT = 0xbA1333333333a1BA1108E8412f11850A5C319bA9;
    address public constant USDC  = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address public constant LBTC  = 0xecAc9C5F704e954931349Da37F60E39f515c11c1;
    address public constant CBBTC = 0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf;
    address public constant TBTC  = 0x236aa50979D5f3De3Bd1Eeb40E81137F22ab794b;
    address public constant ODOS_ROUTER = 0x0D05a7D3448512B78fa8A9e46c4872C88C4a0D05;

    address public owner;
    bool public stopped;
    uint256 public minProfitUsdc; // absolute minimum in USDC (6 decimals), e.g., 300000 = $0.30
    uint256 private _locked;

    event ArbExecuted(
        uint256 borrowed,
        uint256 profit,
        uint256 gasUsed,
        address tokenA,
        address tokenB
    );
    event EmergencyStop(address indexed by);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    modifier notStopped() {
        require(!stopped, "emergency stopped");
        _;
    }

    modifier nonReentrant() {
        require(_locked == 0, "reentrant");
        _locked = 1;
        _;
        _locked = 0;
    }

    constructor(uint256 _minProfitUsdc) {
        owner = msg.sender;
        minProfitUsdc = _minProfitUsdc;
    }

    // ── Emergency Controls ──────────────────────────────────────────────────

    function emergencyStop() external onlyOwner {
        stopped = true;
        emit EmergencyStop(msg.sender);
    }

    function resume() external onlyOwner {
        stopped = false;
    }

    function setMinProfit(uint256 _usdc) external onlyOwner {
        minProfitUsdc = _usdc;
    }

    // ── Flash Loan Entry Point ──────────────────────────────────────────────

    /// @notice Execute triangular arb: borrow USDC → swap to tokenA → swap to tokenB → swap back to USDC
    /// @param amount USDC amount to borrow (6 decimals)
    /// @param tokenA First BTC derivative (LBTC, cbBTC, or tBTC)
    /// @param tokenB Second BTC derivative
    /// @param swapData1 Odos calldata: USDC → tokenA
    /// @param swapData2 Odos calldata: tokenA → tokenB
    /// @param swapData3 Odos calldata: tokenB → USDC
    function executeTriangularArb(
        uint256 amount,
        address tokenA,
        address tokenB,
        bytes calldata swapData1,
        bytes calldata swapData2,
        bytes calldata swapData3
    ) external onlyOwner notStopped {
        require(_isValidBtcToken(tokenA) && _isValidBtcToken(tokenB), "invalid token");
        require(tokenA != tokenB, "same token");

        // Encode callback selector + params — vault forwards this as raw call
        bytes memory data = abi.encodeWithSelector(
            this.unlockCallback.selector,
            abi.encode(amount, tokenA, tokenB, swapData1, swapData2, swapData3)
        );

        IBalancerVault(BALANCER_VAULT).unlock(data);
    }

    /// @dev Called by Balancer Vault during unlock(). This is our flash loan callback.
    /// The vault is "unlocked" — we can sendTo/settle freely.
    function unlockCallback(bytes calldata data) external nonReentrant returns (bytes memory) {
        require(msg.sender == BALANCER_VAULT, "not vault");

        uint256 gasStart = gasleft();

        (
            uint256 amount,
            address tokenA,
            address tokenB,
            bytes memory swap1,
            bytes memory swap2,
            bytes memory swap3
        ) = abi.decode(data, (uint256, address, address, bytes, bytes, bytes));

        // Step 1: Receive USDC from vault
        IBalancerVault(BALANCER_VAULT).sendTo(IERC20(USDC), address(this), amount);

        // Step 2: Swap USDC → tokenA via Odos
        IERC20(USDC).approve(ODOS_ROUTER, amount);
        (bool ok1,) = ODOS_ROUTER.call(swap1);
        require(ok1, "swap1 failed");
        IERC20(USDC).approve(ODOS_ROUTER, 0);

        // Step 3: Swap tokenA → tokenB via Odos
        uint256 balA = IERC20(tokenA).balanceOf(address(this));
        IERC20(tokenA).approve(ODOS_ROUTER, balA);
        (bool ok2,) = ODOS_ROUTER.call(swap2);
        require(ok2, "swap2 failed");
        IERC20(tokenA).approve(ODOS_ROUTER, 0);

        // Step 4: Swap tokenB → USDC via Odos
        uint256 balB = IERC20(tokenB).balanceOf(address(this));
        IERC20(tokenB).approve(ODOS_ROUTER, balB);
        (bool ok3,) = ODOS_ROUTER.call(swap3);
        require(ok3, "swap3 failed");
        IERC20(tokenB).approve(ODOS_ROUTER, 0);

        // Step 5: Verify profit
        uint256 usdcBalance = IERC20(USDC).balanceOf(address(this));
        require(usdcBalance >= amount, "unprofitable");

        uint256 profit = usdcBalance - amount;
        require(profit >= minProfitUsdc, "below min profit");

        // Step 6: Repay vault (transfer USDC back and settle)
        IERC20(USDC).transfer(BALANCER_VAULT, amount);
        IBalancerVault(BALANCER_VAULT).settle(IERC20(USDC), amount);

        // Step 7: Send profit to owner
        if (profit > 0) {
            IERC20(USDC).transfer(owner, profit);
        }

        uint256 gasUsed = gasStart - gasleft();
        emit ArbExecuted(amount, profit, gasUsed, tokenA, tokenB);

        return "";
    }

    // ── Recovery ────────────────────────────────────────────────────────────

    function recover(address token) external onlyOwner {
        uint256 bal = IERC20(token).balanceOf(address(this));
        if (bal > 0) IERC20(token).transfer(owner, bal);
    }

    // ── Internal ────────────────────────────────────────────────────────────

    function _isValidBtcToken(address token) internal pure returns (bool) {
        return token == LBTC || token == CBBTC || token == TBTC;
    }
}
