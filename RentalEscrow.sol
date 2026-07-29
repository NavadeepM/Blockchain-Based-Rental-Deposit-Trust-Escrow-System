// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title RentalEscrow
 * @notice Decentralized escrow for rental / gig security deposits.
 *         Funds are locked on-chain (in native ETH, representing the
 *         Razorpay-collected deposit converted/pegged off-chain) and can
 *         only leave the contract through one of three deterministic paths:
 *           1. Mutual completion  -> full refund to tenant
 *           2. Landlord claim     -> full (or partial) payout to landlord
 *              for damages, only after the dispute window / evidence flow
 *           3. Arbitrator ruling  -> contract splits funds per verdict
 *
 *         Evidence (photos / condition reports) is NOT stored on-chain.
 *         Only its keccak256 / IPFS CID hash is stored, giving tamper-proof
 *         provenance while keeping gas costs low.
 */
contract RentalEscrow {
    enum AgreementStatus {
        Created,        // landlord created, awaiting tenant deposit
        Funded,         // tenant has locked the deposit
        Completed,      // released back to tenant, agreement closed
        Disputed,       // either party raised a dispute
        Resolved,       // arbitrator (or auto-timeout) resolved dispute
        Cancelled        // cancelled before funding
    }

    struct Agreement {
        address landlord;
        address tenant;
        address arbitrator;      // platform-appointed arbitrator / DAO multisig
        uint256 depositAmount;   // in wei
        uint256 createdAt;
        uint256 fundedAt;
        uint256 rentalEndsAt;    // agreed end-of-tenancy timestamp
        uint256 disputeWindow;   // seconds after rentalEndsAt landlord can still raise a claim
        AgreementStatus status;
        bytes32 landlordEvidenceHash; // hash of condition report / IPFS CID bundle
        bytes32 tenantEvidenceHash;
        uint16 landlordSharePct; // set on resolution, out of 10000 (basis points)
        bool exists;
    }

    uint256 public agreementCounter;
    mapping(uint256 => Agreement) public agreements;

    // agreementId => evidence CID string (off-chain pointer, e.g. ipfs://<cid>)
    mapping(uint256 => string) public landlordEvidenceURI;
    mapping(uint256 => string) public tenantEvidenceURI;

    event AgreementCreated(uint256 indexed id, address indexed landlord, address indexed tenant, uint256 depositAmount, uint256 rentalEndsAt);
    event DepositFunded(uint256 indexed id, address indexed tenant, uint256 amount);
    event AgreementCompleted(uint256 indexed id, uint256 refundAmount);
    event DisputeRaised(uint256 indexed id, address indexed raisedBy, bytes32 evidenceHash, string evidenceURI);
    event DisputeResolved(uint256 indexed id, address indexed arbitrator, uint16 landlordSharePct, uint256 landlordAmount, uint256 tenantAmount);
    event AgreementCancelled(uint256 indexed id);

    modifier onlyLandlord(uint256 id) {
        require(agreements[id].landlord == msg.sender, "Not landlord");
        _;
    }

    modifier onlyTenant(uint256 id) {
        require(agreements[id].tenant == msg.sender, "Not tenant");
        _;
    }

    modifier onlyArbitrator(uint256 id) {
        require(agreements[id].arbitrator == msg.sender, "Not arbitrator");
        _;
    }

    modifier onlyParty(uint256 id) {
        require(
            agreements[id].landlord == msg.sender || agreements[id].tenant == msg.sender,
            "Not a party to agreement"
        );
        _;
    }

    modifier exists(uint256 id) {
        require(agreements[id].exists, "Agreement does not exist");
        _;
    }

    /// @notice Landlord creates a new rental agreement shell (no funds yet).
    function createAgreement(
        address tenant,
        address arbitrator,
        uint256 depositAmount,
        uint256 rentalEndsAt,
        uint256 disputeWindow
    ) external returns (uint256) {
        require(tenant != address(0) && arbitrator != address(0), "Invalid address");
        require(depositAmount > 0, "Deposit must be > 0");
        require(rentalEndsAt > block.timestamp, "End date must be future");

        uint256 id = ++agreementCounter;
        agreements[id] = Agreement({
            landlord: msg.sender,
            tenant: tenant,
            arbitrator: arbitrator,
            depositAmount: depositAmount,
            createdAt: block.timestamp,
            fundedAt: 0,
            rentalEndsAt: rentalEndsAt,
            disputeWindow: disputeWindow,
            status: AgreementStatus.Created,
            landlordEvidenceHash: bytes32(0),
            tenantEvidenceHash: bytes32(0),
            landlordSharePct: 0,
            exists: true
        });

        emit AgreementCreated(id, msg.sender, tenant, depositAmount, rentalEndsAt);
        return id;
    }

    /// @notice Tenant locks the deposit into escrow. Must match exact amount.
    function fundDeposit(uint256 id) external payable exists(id) onlyTenant(id) {
        Agreement storage a = agreements[id];
        require(a.status == AgreementStatus.Created, "Not fundable");
        require(msg.value == a.depositAmount, "Incorrect deposit amount");

        a.status = AgreementStatus.Funded;
        a.fundedAt = block.timestamp;

        emit DepositFunded(id, msg.sender, msg.value);
    }

    /// @notice Landlord cancels before tenant funds (e.g. tenant backed out).
    function cancelAgreement(uint256 id) external exists(id) onlyLandlord(id) {
        Agreement storage a = agreements[id];
        require(a.status == AgreementStatus.Created, "Cannot cancel after funding");
        a.status = AgreementStatus.Cancelled;
        emit AgreementCancelled(id);
    }

    /// @notice Either party marks the tenancy as complete with no issues.
    ///         Requires BOTH landlord and tenant to call this (2-of-2 sign-off)
    ///         OR the dispute window to have elapsed with no dispute raised.
    mapping(uint256 => mapping(address => bool)) public completionSignoff;

    function confirmCompletion(uint256 id) external exists(id) onlyParty(id) {
        Agreement storage a = agreements[id];
        require(a.status == AgreementStatus.Funded, "Not in funded state");

        completionSignoff[id][msg.sender] = true;

        if (completionSignoff[id][a.landlord] && completionSignoff[id][a.tenant]) {
            _release(id, a.depositAmount, 0);
        }
    }

    /// @notice Anyone can trigger auto-release once rentalEndsAt + disputeWindow
    ///         has passed with no dispute raised — protects tenant from a
    ///         non-responsive landlord holding funds hostage.
    function autoReleaseAfterWindow(uint256 id) external exists(id) {
        Agreement storage a = agreements[id];
        require(a.status == AgreementStatus.Funded, "Not in funded state");
        require(block.timestamp > a.rentalEndsAt + a.disputeWindow, "Dispute window still open");
        _release(id, a.depositAmount, 0);
    }

    function _release(uint256 id, uint256 tenantAmount, uint256 landlordAmount) internal {
        Agreement storage a = agreements[id];
        a.status = AgreementStatus.Completed;

        if (tenantAmount > 0) {
            (bool okT, ) = payable(a.tenant).call{value: tenantAmount}("");
            require(okT, "Tenant transfer failed");
        }
        if (landlordAmount > 0) {
            (bool okL, ) = payable(a.landlord).call{value: landlordAmount}("");
            require(okL, "Landlord transfer failed");
        }

        emit AgreementCompleted(id, tenantAmount);
    }

    /// @notice Either party raises a dispute and attaches a hash of the
    ///         off-chain evidence bundle (photos, condition report, chat log).
    function raiseDispute(uint256 id, bytes32 evidenceHash, string calldata evidenceURI) external exists(id) onlyParty(id) {
        Agreement storage a = agreements[id];
        require(a.status == AgreementStatus.Funded, "Not disputable");
        require(block.timestamp <= a.rentalEndsAt + a.disputeWindow, "Dispute window closed");

        a.status = AgreementStatus.Disputed;

        if (msg.sender == a.landlord) {
            a.landlordEvidenceHash = evidenceHash;
            landlordEvidenceURI[id] = evidenceURI;
        } else {
            a.tenantEvidenceHash = evidenceHash;
            tenantEvidenceURI[id] = evidenceURI;
        }

        emit DisputeRaised(id, msg.sender, evidenceHash, evidenceURI);
    }

    /// @notice Counter-party can attach their own evidence to an existing dispute.
    function submitCounterEvidence(uint256 id, bytes32 evidenceHash, string calldata evidenceURI) external exists(id) onlyParty(id) {
        Agreement storage a = agreements[id];
        require(a.status == AgreementStatus.Disputed, "No active dispute");

        if (msg.sender == a.landlord) {
            a.landlordEvidenceHash = evidenceHash;
            landlordEvidenceURI[id] = evidenceURI;
        } else {
            a.tenantEvidenceHash = evidenceHash;
            tenantEvidenceURI[id] = evidenceURI;
        }
    }

    /// @notice Arbitrator resolves the dispute, splitting the deposit by basis points.
    /// @param landlordSharePct Landlord's share out of 10000 (e.g. 3000 = 30%).
    function resolveDispute(uint256 id, uint16 landlordSharePct) external exists(id) onlyArbitrator(id) {
        Agreement storage a = agreements[id];
        require(a.status == AgreementStatus.Disputed, "No active dispute");
        require(landlordSharePct <= 10000, "Invalid basis points");

        uint256 landlordAmount = (a.depositAmount * landlordSharePct) / 10000;
        uint256 tenantAmount = a.depositAmount - landlordAmount;

        a.landlordSharePct = landlordSharePct;
        a.status = AgreementStatus.Resolved;

        if (tenantAmount > 0) {
            (bool okT, ) = payable(a.tenant).call{value: tenantAmount}("");
            require(okT, "Tenant transfer failed");
        }
        if (landlordAmount > 0) {
            (bool okL, ) = payable(a.landlord).call{value: landlordAmount}("");
            require(okL, "Landlord transfer failed");
        }

        emit DisputeResolved(id, msg.sender, landlordSharePct, landlordAmount, tenantAmount);
    }

    function getAgreement(uint256 id) external view returns (Agreement memory) {
        return agreements[id];
    }

    receive() external payable {
        revert("Use fundDeposit()");
    }
}
