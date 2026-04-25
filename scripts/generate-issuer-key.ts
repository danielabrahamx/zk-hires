import { generateKeypair } from "../src/issuer/eddsa";

async function main() {
  const { privKey, pubKey } = await generateKeypair();
  const pubHex =
    pubKey[0].toString(16).padStart(64, "0") +
    pubKey[1].toString(16).padStart(64, "0");
  // eslint-disable-next-line no-console
  console.log("ISSUER_PRIV_KEY=" + privKey.toString("hex"));
  // eslint-disable-next-line no-console
  console.log("ISSUER_PUB_KEY=" + pubHex);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
