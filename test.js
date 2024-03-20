const web3 = require("@solana/web3.js");
(async () => {
  const solana = new web3.Connection("https://solana-mainnet.core.chainstack.com/1df381dbb264fe238f307c11c3e7e30e");
  const accountPublicKey = new web3.PublicKey(
    "GgPpTKg78vmzgDtP1DNn72CHAYjRdKY7AV6zgszoHCSa"
  );
  const mintAccount = new web3.PublicKey(
    "1YDQ35V8g68FGvcT85haHwAXv1U7XMzuc4mZeEXfrjE"
  );
  console.log(
    JSON.stringify(console.log(await solana.getRecentBlockhash())
  ));
})();
