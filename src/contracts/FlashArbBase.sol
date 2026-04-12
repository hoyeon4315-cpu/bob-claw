// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * BOB Claw — Flash Loan Arbitrage Skeleton (Base chain)
 *
 * Strategy: Borrow LBTC via Aave V3 flash loan → swap to cbBTC via Odos →
 *           swap back to LBTC at better rate → repay flash loan + 0.05% fee.
 *
 * Safety:
 *   - Owner-only execution
 *   - Emergency stop
 *   - Min profit threshold enforced on-chain
 *   - No unlimited approvals
 *   - All profit sent to owner, nothing held in contract
 *
 * NOTE: This is a SKELETON for dry-run testing. Do NOT deploy with real funds
 *       until the full execution pipeline is verified.
 */

// Minimal Aave V3 interfaces
interface IPoolAddressesProvider {
    function getPool() external view returns (address);
}

interface IPool {
    function flashLoanSimple(
        address receiverAddress,
        address asset,
        uint256 amount,
        bytes calldata params,
        uint16 referralCode
    ) external;
}

interface IFlashLoanSimpleReceiver {
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external returns (bool);
}

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
}

contract FlashArbBase is IFlashLoanSimpleReceiver {
    // ── Base Mainnet Addresses ──────────────────────────────────────────────
    address public constant AAVE_POOL_PROVIDER = 0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D;
    address public constant LBTC  = 0xecAc9C5F704e954931349Da37F60E39f515c11c1;
    address public constant CBBTC = 0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf;
    address public constant ODOS_ROUTER = 0x0D05a7D3448512B78fa8A9e46c4872C88C4a0D05;

    address public owner;
    bool public stopped;
    uint256 public minProfitBps; // e.g., 30 = 0.30%

    event ArbExecuted(uint256 borrowed, uint256 profit, uint256 gasUsed);
    event EmergencyStop(address indexed by);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    modifier notStopped() {
        require(!stopped, "emergency stopped");
        _;
    }

    constructor(uint256 _minProfitBps) {
        owner = msg.sender;
        minProfitBps = _minProfitBps;
    }

    // ── Emergency Controls ──────────────────────────────────────────────────

    function emergencyStop() external onlyOwner {
        stopped = true;
        emit EmergencyStop(msg.sender);
    }

    function resume() external onlyOwner {
        stopped = false;
    }

    function setMinProfit(uint256 _bps) external onlyOwner {
        require(_bps >= 10, "min 0.10%");
        minProfitBps = _bps;
    }

    // ── Flash Loan Entry Point ──────────────────────────────────────────────

    /// @notice Initiate flash loan arb. Calldata for Odos swaps must be pre-built off-chain.
    /// @param amount LBTC amount to borrow (8 decimals)
    /// @param swapCalldata1 Odos calldata: LBTC → cbBTC
    /// @param swapCalldata2 Odos calldata: cbBTC → LBTC
    function executeArb(
        uint256 amount,
        bytes calldata swapCalldata1,
        bytes calldata swapCalldata2
    ) external onlyOwner notStopped {
        address pool = IPoolAddressesProvider(AAVE_POOL_PROVIDER).getPool();
        bytes memory params = abi.encode(swapCalldata1, swapCalldata2);
        IPool(pool).flashLoanSimple(address(this), LBTC, amount, params, 0);
    }

    // ── Flash Loan Callback ─────────────────────────────────────────────────

    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external override returns (bool) {
        uint256 gasStart = gasleft();

        // Verify caller is Aave pool
        address pool = IPoolAddressesProvider(AAVE_POOL_PROVIDER).getPool();
        require(msg.sender == pool, "caller not pool");
        require(initiator == address(this), "initiator mismatch");
        require(asset == LBTC, "wrong asset");

        // Decode swap calldata
        (bytes memory swap1, bytes memory swap2) = abi.decode(params, (bytes, bytes));

        // Approve Odos router for swap 1 (exact amount, not unlimited)
        IERC20(LBTC).approve(ODOS_ROUTER, amount);

        // Swap 1: LBTC → cbBTC
        (bool ok1,) = ODOS_ROUTER.call(swap1);
        require(ok1, "swap1 failed");

        // Approve Odos router for swap 2
        uint256 cbbtcBal = IERC20(CBBTC).balanceOf(address(this));
        IERC20(CBBTC).approve(ODOS_ROUTER, cbbtcBal);

        // Swap 2: cbBTC → LBTC
        (bool ok2,) = ODOS_ROUTER.call(swap2);
        require(ok2, "swap2 failed");

        // Calculate profit
        uint256 totalOwed = amount + premium;
        uint256 lbtcBal = IERC20(LBTC).balanceOf(address(this));
        require(lbtcBal >= totalOwed, "unprofitable");

        uint256 profit = lbtcBal - totalOwed;
        uint256 minRequired = (amount * minProfitBps) / 10000;
        require(profit >= minRequired, "below min profit");

        // Approve Aave to pull repayment
        IERC20(LBTC).approve(pool, totalOwed);

        // Send profit to owner (don't hold in contract)
        if (profit > 0) {
            IERC20(LBTC).transfer(owner, profit);
        }

        // Clear Odos approvals
        IERC20(LBTC).approve(ODOS_ROUTER, 0);
        IERC20(CBBTC).approve(ODOS_ROUTER, 0);

        uint256 gasUsed = gasStart - gasleft();
        emit ArbExecuted(amount, profit, gasUsed);

        return true;
    }

    // ── Recovery ────────────────────────────────────────────────────────────

    /// @notice Recover any tokens stuck in contract
    function recover(address token) external onlyOwner {
        uint256 bal = IERC20(token).balanceOf(address(this));
        if (bal > 0) IERC20(token).transfer(owner, bal);
    }
}
