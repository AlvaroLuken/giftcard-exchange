const { expect } = require("chai");
const { ethers } = require("hardhat");


// For more on how to test events with ethers, see - https://github.com/ethers-io/ethers.js/issues/283

describe("Market contract - Buying flow",  function() {

    let arbitrator;
    let market;

    let owner;
    let seller;
    let buyer;
    let foreignParty;

    let price;
    let cardInfo_hash;
    let metaevidence;

    let transactionID;
    let transactionObj;
    let arbitration;
    let disputeID;

    let listEvent;
    let buyEvent

    beforeEach(async function() {

        this.timeout(60000);

        // Deploying the arbitrator contract.
        const ArbitratorFactory = await ethers.getContractFactory("SimpleCentralizedArbitrator");
        arbitrator = await ArbitratorFactory.deploy();

        // Deploying the market contract && getting signers.
        const MarketFactory = await ethers.getContractFactory("Market");
        [owner, seller, buyer, foreignParty] = await ethers.getSigners();

        market = await MarketFactory.deploy(arbitrator.address);


        // Shared logic by tests - listing the gift card to be bought by the buyer.
        price = ethers.utils.parseEther("1");
        cardInfo_hash = ethers.utils.keccak256(ethers.utils.formatBytes32String("giftcard information"));
        metaevidence = "ERC 1497 compliant metavidence";

        listEvent = new Promise((resolve, reject) => {

            market.on("TransactionStateUpdate", (_transactionID, _transactionObj, event) => {
                
                event.removeListener();

                transactionID = _transactionID;
                transactionObj = _transactionObj;

                resolve();
            })

            setTimeout(() => {
                reject(new Error("TransactionStateUpdate event timeout."));
            }, 60000);
        })

        await market.connect(seller).listNewCard(cardInfo_hash, price);
        await listEvent;

        buyEvent = new Promise((resolve, reject) => {

            market.on("TransactionStateUpdate", (_transactionID, _transactionObj, event) => {
                
                event.removeListener();

                transactionID = _transactionID;
                transactionObj = _transactionObj;

                resolve();
            });

            setTimeout(() => {
                reject(new Error("TransactionStateUpdate timeout"));
            }, 60000);
        })

        await market.connect(buyer).buyCard(transactionID, transactionObj, metaevidence, {value: price});
        await buyEvent;

        let reclaimTransactionEvent = new Promise((resolve, reject) => {

            market.on("TransactionStateUpdate", (_transactionID, _transactionObj, event) => {
                
                event.removeListener();
                transactionObj = _transactionObj;
                resolve();
            })

            setTimeout(() => {
                reject(new Error("reclaimEvent timeout"));
            }, 20000);
        });

        let reclaimDisputeEvent = new Promise((resolve, reject) => {

            market.on("DisputeStateUpdate", (_disputeID, _transactionID, _arbitration, event) => {
                
                event.removeListener();
                arbitration = _arbitration;
                resolve();
            })

            setTimeout(() => {
                reject(new Error("reclaimEvent timeout"));
            }, 20000);
        });

        await market.connect(buyer).reclaimDisputeByBuyer(
            transactionID, transactionObj, {value: ethers.utils.parseEther("1")}
        );
        await reclaimTransactionEvent;
        await reclaimDisputeEvent;
        
        await arbitrator.changeCalled(); // changes arbitration cost

        let sellerFeeDepositEvent = new Promise((resolve, reject) => {

            market.on("DisputeStateUpdate", (_disputeID, _transactionID, _arbitration, event) => {
                event.removeListener();

                arbitration = _arbitration;

                resolve();
            })

            setTimeout(() => {
                reject(new Error("seller fee deposit event timeout"));
            }, 20000);
        })

        await market.connect(seller).payArbitrationFeeBySeller(
            transactionID, transactionID, transactionObj, arbitration, {value: ethers.utils.parseEther("2")}
        );
        await sellerFeeDepositEvent;
    });


    describe("Dispute cases - buyer responds to seller fee deposit", function() {

        describe("Buyer pays arbitration fee", function() {

            it("Should emit transaction state update event", async function() {

                await expect(market.connect(buyer).payArbitrationFeeByBuyer(
                    transactionID, transactionID, transactionObj, arbitration, {value: ethers.utils.parseEther("1")}
                )).to.emit(market, "TransactionStateUpdate")
            })

            it("Should emit dispute event", async function() {
                
                await expect(market.connect(buyer).payArbitrationFeeByBuyer(
                    transactionID, transactionID, transactionObj, arbitration, {value: ethers.utils.parseEther("1")}
                )).to.emit(market, "Dispute")
            })

            // raiseDispute has already been tested in SellerFees
        })

        describe("Revert cases", async function() {

            it("Should not allow arbitration fee payment after deposit period has ended", async function() {

                this.timeout(80000);

                await new Promise((resolve, reject) => {
                    setTimeout(() => {
                        // Wait for one minute
                        resolve();
                    }, 60000);
                })

                await expect(market.connect(buyer).payArbitrationFeeByBuyer(
                    transactionID, transactionID, transactionObj, arbitration, {value: ethers.utils.parseEther("1")}
                )).to.be.revertedWith("The arbitration fee deposit period is over.");
            })

            it("Should only allow the seller to pay the seller fee", async function() {

                await expect(market.connect(foreignParty).payArbitrationFeeByBuyer(
                    transactionID, transactionID, transactionObj, arbitration, {value: ethers.utils.parseEther("1")}
                )).to.be.revertedWith("Only the buyer involved in the dispute can pay the buyer's fee.");
            })

            it("Should only allow buyer to deposit fee when it's the buyer's turn to do so.", async function() {
                
                let disputeID;
                let disputeEvent = new Promise((resolve, reject) => {

                    market.on("Dispute", (_arbitrator, _disputeID, _metaEvidenceID, _transactionID, event) => {

                        event.removeListener();
                        disputeID = _disputeID;
                        resolve();
                    })

                    setTimeout(() => {
                        reject(new Error("feeDeposit event timeout"));
                    }, 20000);
                })

                let transactionEvent = new Promise((resolve, reject) => {

                    market.on("TransactionStateUpdate", (_transactionID, _transactionObj, event) => {
                        event.removeListener();
                        transactionObj = _transactionObj
                        resolve();
                    })

                    setTimeout(() => {
                        reject(new Error("feeDeposit event timeout"));
                    }, 20000);
                })

                await market.connect(buyer).payArbitrationFeeByBuyer(
                    transactionID, transactionID, transactionObj, arbitration, {value: ethers.utils.parseEther("1")}
                );

                await transactionEvent;
                await disputeEvent;
                arbitration = await market.disputeID_to_arbitration(disputeID);

                await expect(market.connect(buyer).payArbitrationFeeByBuyer(
                    transactionID, transactionID, transactionObj, arbitration, {value: ethers.utils.parseEther("1")}
                )).to.be.revertedWith("Can only pay deposit fee when its the buyer's turn to respond.");

            })
        })
    })
})