import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AnchorDiceGameQ425 } from "../target/types/anchor_dice_game_q4_25";
import { Keypair, PublicKey, Transaction, Ed25519Program, SystemProgram, LAMPORTS_PER_SOL, SYSVAR_INSTRUCTIONS_PUBKEY, sendAndConfirmTransaction } from "@solana/web3.js";
import { BN } from "bn.js";
import { randomBytes } from "crypto"

describe("anchor-dice-game-q4-25", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.anchorDiceGameQ425 as Program<AnchorDiceGameQ425>;

  let house = new Keypair();
  let player = new Keypair();
  let seed = new BN(randomBytes(16));

  let vault = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), house.publicKey.toBytes()],
    program.programId
  )[0]

  let bet = PublicKey.findProgramAddressSync(
    [Buffer.from("bet"), vault.toBytes(), seed.toBuffer("le", 16)],
    program.programId
  )[0]

  it("Airdropping SOL", async () => {
    await Promise.all([house, player].map(async (k) => {
      const sig = await provider.connection.requestAirdrop(k.publicKey, 1000 * anchor.web3.LAMPORTS_PER_SOL)

      await confirmTx(sig)
    }))
  })

  it("Initialize", async () => {
    let signature = await program.methods.initialize(new BN(LAMPORTS_PER_SOL).mul(new BN(100)))
      .accountsStrict({
        house: house.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
        vault
      })
      .signers([house])
      .rpc()

    await confirmTx(signature)
  })

  it("Place a bet", async () => {
    const sig = await program.methods
      .placeBet(seed, 50, new BN(LAMPORTS_PER_SOL / 100))
      .accountsStrict({
        player: player.publicKey,
        house: house.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
        vault,
        bet,
      })
      .signers([player])
      .rpc();

    await confirmTx(sig);

    const betAccount = await program.account.bet.fetch(bet);
    console.log("Bet account after placeBet:", betAccount);
  })

  it("Resolve a bet", async () => {
    const account = await provider.connection.getAccountInfo(bet, "confirmed");
    if (!account || !account.data) {
      throw new Error("bet account not found or has no data");
    }

    const sig_ix = Ed25519Program.createInstructionWithPrivateKey({
      privateKey: house.secretKey,
      message: account.data.subarray(8),
    });

    const resolveIx = await program.methods
      .resolveBet(
        Buffer.from(sig_ix.data.buffer.slice(16 + 32, 16 + 32 + 64))
      )
      .accountsStrict({
        player: player.publicKey,
        house: house.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
        vault,
        bet,
        instructionSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .signers([house])
      .instruction();

    const tx = new Transaction().add(sig_ix).add(resolveIx);

    await sendAndConfirmTransaction(provider.connection, tx, [house]);
  });

  it("Refund a bet", async () => {
    let signature = program.methods.refundBet()
      .accountsStrict({
        player: player.publicKey,
        house: house.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
        vault,
        bet
      })
      .signers([player])
      .rpc()
      .then(confirmTx)
  })
});

const confirmTx = async (signature: string): Promise<string> => {
  const latestBlockHash = await anchor.getProvider().connection.getLatestBlockhash();

  await anchor.getProvider().connection.confirmTransaction({
    signature,
    ...latestBlockHash
  },
    "confirmed"
  );

  return signature
}
