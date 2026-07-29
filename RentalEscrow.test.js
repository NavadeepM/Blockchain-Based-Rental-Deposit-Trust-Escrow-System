const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("RentalEscrow", function () {
  let escrow, landlord, tenant, arbitrator, stranger;
  const DEPOSIT = ethers.parseEther("1.0");

  beforeEach(async function () {
    [landlord, tenant, arbitrator, stranger] = await ethers.getSigners();
    const Escrow = await ethers.getContractFactory("RentalEscrow");
    escrow = await Escrow.deploy();
    await escrow.waitForDeployment();
  });

  async function createAgreement({ disputeWindow = 3 * 24 * 3600 } = {}) {
    const rentalEndsAt = (await time.latest()) + 30 * 24 * 3600; // 30 days out
    const tx = await escrow
      .connect(landlord)
      .createAgreement(tenant.address, arbitrator.address, DEPOSIT, rentalEndsAt, disputeWindow);
    const receipt = await tx.wait();
    const event = receipt.logs
      .map((l) => { try { return escrow.interface.parseLog(l); } catch { return null; } })
      .find((e) => e && e.name === "AgreementCreated");
    return { id: event.args.id, rentalEndsAt };
  }

  describe("Agreement creation & funding", function () {
    it("creates an agreement with correct fields", async function () {
      const { id, rentalEndsAt } = await createAgreement();
      const a = await escrow.getAgreement(id);
      expect(a.landlord).to.equal(landlord.address);
      expect(a.tenant).to.equal(tenant.address);
      expect(a.arbitrator).to.equal(arbitrator.address);
      expect(a.depositAmount).to.equal(DEPOSIT);
      expect(a.status).to.equal(0); // Created
      expect(a.rentalEndsAt).to.equal(rentalEndsAt);
    });

    it("rejects funding from a non-tenant address", async function () {
      const { id } = await createAgreement();
      await expect(
        escrow.connect(stranger).fundDeposit(id, { value: DEPOSIT })
      ).to.be.revertedWith("Not tenant");
    });

    it("rejects funding with the wrong amount", async function () {
      const { id } = await createAgreement();
      await expect(
        escrow.connect(tenant).fundDeposit(id, { value: ethers.parseEther("0.5") })
      ).to.be.revertedWith("Incorrect deposit amount");
    });

    it("locks funds in the contract on correct funding", async function () {
      const { id } = await createAgreement();
      await escrow.connect(tenant).fundDeposit(id, { value: DEPOSIT });
      const bal = await ethers.provider.getBalance(await escrow.getAddress());
      expect(bal).to.equal(DEPOSIT);
      const a = await escrow.getAgreement(id);
      expect(a.status).to.equal(1); // Funded
    });

    it("lets landlord cancel before funding", async function () {
      const { id } = await createAgreement();
      await escrow.connect(landlord).cancelAgreement(id);
      const a = await escrow.getAgreement(id);
      expect(a.status).to.equal(5); // Cancelled
    });
  });

  describe("Mutual completion & release", function () {
    it("releases full deposit to tenant on 2-of-2 signoff", async function () {
      const { id } = await createAgreement();
      await escrow.connect(tenant).fundDeposit(id, { value: DEPOSIT });

      const before = await ethers.provider.getBalance(tenant.address);
      await escrow.connect(landlord).confirmCompletion(id);
      const tx = await escrow.connect(tenant).confirmCompletion(id);
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      const after = await ethers.provider.getBalance(tenant.address);
      expect(after - before + gasUsed).to.equal(DEPOSIT);

      const a = await escrow.getAgreement(id);
      expect(a.status).to.equal(2); // Completed
    });

    it("does NOT release after only one party signs off", async function () {
      const { id } = await createAgreement();
      await escrow.connect(tenant).fundDeposit(id, { value: DEPOSIT });
      await escrow.connect(landlord).confirmCompletion(id);
      const a = await escrow.getAgreement(id);
      expect(a.status).to.equal(1); // still Funded
    });

    it("auto-releases to tenant after dispute window elapses with no dispute", async function () {
      const { id, rentalEndsAt } = await createAgreement({ disputeWindow: 100 });
      await escrow.connect(tenant).fundDeposit(id, { value: DEPOSIT });

      await time.increaseTo(rentalEndsAt + 200);

      const before = await ethers.provider.getBalance(tenant.address);
      await escrow.connect(stranger).autoReleaseAfterWindow(id); // anyone can trigger
      const after = await ethers.provider.getBalance(tenant.address);
      expect(after - before).to.equal(DEPOSIT);
    });

    it("reverts auto-release before the window elapses", async function () {
      const { id } = await createAgreement({ disputeWindow: 100 });
      await escrow.connect(tenant).fundDeposit(id, { value: DEPOSIT });
      await expect(escrow.autoReleaseAfterWindow(id)).to.be.revertedWith("Dispute window still open");
    });
  });

  describe("Dispute flow with on-chain evidence hashing", function () {
    it("lets landlord raise a dispute with an evidence hash + IPFS URI", async function () {
      const { id } = await createAgreement();
      await escrow.connect(tenant).fundDeposit(id, { value: DEPOSIT });

      const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes("damage-photos-bundle-v1"));
      const uri = "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";

      await expect(escrow.connect(landlord).raiseDispute(id, evidenceHash, uri))
        .to.emit(escrow, "DisputeRaised")
        .withArgs(id, landlord.address, evidenceHash, uri);

      const a = await escrow.getAgreement(id);
      expect(a.status).to.equal(3); // Disputed
      expect(a.landlordEvidenceHash).to.equal(evidenceHash);
      expect(await escrow.landlordEvidenceURI(id)).to.equal(uri);
    });

    it("lets tenant submit counter-evidence once disputed", async function () {
      const { id } = await createAgreement();
      await escrow.connect(tenant).fundDeposit(id, { value: DEPOSIT });

      const h1 = ethers.keccak256(ethers.toUtf8Bytes("landlord-report"));
      await escrow.connect(landlord).raiseDispute(id, h1, "ipfs://cid1");

      const h2 = ethers.keccak256(ethers.toUtf8Bytes("tenant-counter-report"));
      await escrow.connect(tenant).submitCounterEvidence(id, h2, "ipfs://cid2");

      const a = await escrow.getAgreement(id);
      expect(a.tenantEvidenceHash).to.equal(h2);
    });

    it("rejects dispute raised after the dispute window closes", async function () {
      const { id, rentalEndsAt } = await createAgreement({ disputeWindow: 100 });
      await escrow.connect(tenant).fundDeposit(id, { value: DEPOSIT });
      await time.increaseTo(rentalEndsAt + 200);

      const h = ethers.keccak256(ethers.toUtf8Bytes("late-claim"));
      await expect(
        escrow.connect(landlord).raiseDispute(id, h, "ipfs://late")
      ).to.be.revertedWith("Dispute window closed");
    });

    it("arbitrator splits deposit correctly per basis-point verdict (30% landlord / 70% tenant)", async function () {
      const { id } = await createAgreement();
      await escrow.connect(tenant).fundDeposit(id, { value: DEPOSIT });

      const h = ethers.keccak256(ethers.toUtf8Bytes("evidence"));
      await escrow.connect(landlord).raiseDispute(id, h, "ipfs://cid");

      const landlordBefore = await ethers.provider.getBalance(landlord.address);
      const tenantBefore = await ethers.provider.getBalance(tenant.address);

      await expect(escrow.connect(arbitrator).resolveDispute(id, 3000))
        .to.emit(escrow, "DisputeResolved")
        .withArgs(id, arbitrator.address, 3000, ethers.parseEther("0.3"), ethers.parseEther("0.7"));

      const landlordAfter = await ethers.provider.getBalance(landlord.address);
      const tenantAfter = await ethers.provider.getBalance(tenant.address);

      expect(landlordAfter - landlordBefore).to.equal(ethers.parseEther("0.3"));
      expect(tenantAfter - tenantBefore).to.equal(ethers.parseEther("0.7"));

      const a = await escrow.getAgreement(id);
      expect(a.status).to.equal(4); // Resolved
      expect(a.landlordSharePct).to.equal(3000);
    });

    it("rejects resolution from a non-arbitrator", async function () {
      const { id } = await createAgreement();
      await escrow.connect(tenant).fundDeposit(id, { value: DEPOSIT });
      const h = ethers.keccak256(ethers.toUtf8Bytes("evidence"));
      await escrow.connect(landlord).raiseDispute(id, h, "ipfs://cid");

      await expect(
        escrow.connect(stranger).resolveDispute(id, 5000)
      ).to.be.revertedWith("Not arbitrator");
    });

    it("rejects basis points above 10000", async function () {
      const { id } = await createAgreement();
      await escrow.connect(tenant).fundDeposit(id, { value: DEPOSIT });
      const h = ethers.keccak256(ethers.toUtf8Bytes("evidence"));
      await escrow.connect(landlord).raiseDispute(id, h, "ipfs://cid");

      await expect(
        escrow.connect(arbitrator).resolveDispute(id, 10001)
      ).to.be.revertedWith("Invalid basis points");
    });
  });

  describe("Security", function () {
    it("does not accept bare ETH transfers", async function () {
      await expect(
        landlord.sendTransaction({ to: await escrow.getAddress(), value: DEPOSIT })
      ).to.be.revertedWith("Use fundDeposit()");
    });

    it("prevents double funding of the same agreement", async function () {
      const { id } = await createAgreement();
      await escrow.connect(tenant).fundDeposit(id, { value: DEPOSIT });
      await expect(
        escrow.connect(tenant).fundDeposit(id, { value: DEPOSIT })
      ).to.be.revertedWith("Not fundable");
    });
  });
});
