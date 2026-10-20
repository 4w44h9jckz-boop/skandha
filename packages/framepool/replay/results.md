# Replay of mined frame transactions

Every fixture of `fixtures-exp-frames-85ee60d.json` judged as emem's `docs/spec/12-replay.md`
says, by `bun replay/run.ts replay/fixtures-exp-frames-85ee60d.json`. Its input is
exp-frames 85ee60d671c67a536c26265b8cba9fca78ff0360, test/fixtures/chain, with parent headers from https://rpc1.privacy.ethrex.xyz, eth_getBlockByNumber, read 2026-10-20. Generated: do
not edit; run the command again and compare.

## Totals

- **hegota-testnet**: 172 agree; 10 explained (recent-roots)
- **eip-8141**: 154 agree; 8 explained (expiry_verifier); 3 explained (expiry_verifier, recent-roots); 10 explained (max_verify_gas); 6 explained (max_verify_gas, recent-roots); 1 explained (recent-roots)
- **eip-8141 (plain)**: 5 agree; 1 explained (expiry_verifier); 6 header missing

## Fixtures

| Hash | Chain | Block | Verdict, comparison (differences) |
| --- | --- | --- | --- |
| `0x045fb58b1c52183b` | 8141 | 304885 | hegota-testnet: ok, agree<br>eip-8141: ErrFrameUnrecognizedPrefix, explained (expiry_verifier) |
| `0x0478e663ed8de73c` | 8141 | 315380 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x05a342d384c75e9e` | 8141 | 305063 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x082ce547c15b5050` | 8141 | 305126 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x0abd7a2213ae3947` | 8141 | 305055 | hegota-testnet: ok, agree<br>eip-8141: ErrFrameVerifyGas, explained (max_verify_gas) |
| `0x0b5d5f84b46e4873` | 8141 | 305151 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x0d41c2ac1a614853` | 8141 | 305521 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x0d6ba2ebb5e91a2e` | 8141 | 302995 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x0db33e7d82508c0b` | 8141 | 304936 | hegota-testnet: ok, agree<br>eip-8141: ErrFrameVerifyGas, explained (max_verify_gas) |
| `0x0dcba149bc9881ae` | 8141 | 305574 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x0ed442c74beaf35d` | 8141 | 315376 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x0fa9ce58662705c8` | 8141 | 305326 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x1071aec56d95978b` | 8141 | 66 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x10ad88695c05ee04` | 8141 | 305054 | hegota-testnet: ok, agree<br>eip-8141: ErrFrameVerifyGas, explained (max_verify_gas) |
| `0x11594d4ddea48ab6` | 8141 | 316318 | hegota-testnet: ErrFrameUnrecognizedPrefix, explained (recent-roots)<br>eip-8141: ErrFrameUnrecognizedPrefix, explained (expiry_verifier, recent-roots) |
| `0x13a2d8a6511f35af` | 8141 | 306340 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x1746a1a68f68281c` | 8141 | 305328 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x17e40b0ace92c462` | 8141 | 127677 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x1b02b102684dd499` | 8141 | 306137 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x1d381c945c266b56` | 8141 | 305250 | hegota-testnet: ok, agree<br>eip-8141: ErrFrameUnrecognizedPrefix, explained (expiry_verifier) |
| `0x1d4837401d9cec98` | 8141 | 305232 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x211d8380e6ae1cb3` | 8141 | 306471 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x22aa05cc9c72135f` | 8141 | 305977 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x243ea12619fcb733` | 8141 | 304987 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x24d95a900830b8a6` | 8141 | 305533 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x26ed3e31ef89ea6f` | 8141 | 49563 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x2719e9459155a1c3` | 8141 | 304240 | hegota-testnet: ErrFrameUnrecognizedPrefix, explained (recent-roots)<br>eip-8141: ErrFrameUnrecognizedPrefix, explained (max_verify_gas, recent-roots) |
| `0x287b27c3808d1aab` | 8141 | 305533 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x2a0afccfa97f2053` | 8141 | 304983 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x2b90c598179b0cb8` | 8141 | 8155 | hegota-testnet: ErrFrameUnrecognizedPrefix, explained (recent-roots)<br>eip-8141: ErrFrameUnrecognizedPrefix, explained (max_verify_gas, recent-roots) |
| `0x2c7be31990ca69af` | 8141 | 303137 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x2c8171116f1f5171` | 8141 | 304888 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x2e1062eff4108169` | 8141 | 304500 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x2f734f97812a2b36` | 8141 | 304989 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x316eb3f1f300f874` | 8141 | 316312 | hegota-testnet: ErrFrameUnrecognizedPrefix, explained (recent-roots)<br>eip-8141: ErrFrameUnrecognizedPrefix, explained (expiry_verifier, recent-roots) |
| `0x327eaf95192e82e3` | 8141 | 305065 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x3389926a0e1e3df0` | 8141 | 306469 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x344bde97d1380e08` | 8141 | 305423 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x34ae87b165ac15ca` | 8141 | 320285 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x35291ed9ee356043` | 8141 | 305574 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x35a01d1149d8b341` | 8141 | 304225 | hegota-testnet: ErrFrameUnrecognizedPrefix, explained (recent-roots)<br>eip-8141: ErrFrameUnrecognizedPrefix, explained (max_verify_gas, recent-roots) |
| `0x35ee10cd62157664` | 8141 | 305463 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x3626bfffa2fc1638` | 8141 | 305422 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x3650463db2e5bcb0` | 8141 | 305249 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x37b9884bf42a0b2b` | 8141 | 305325 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x380b7d11153462b0` | 8141 | 304937 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x396093a2574edecb` | 8141 | 304738 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x39cc39d67b050cb9` | 8141 | 305058 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x3f0a76488d59f740` | 8141 | 305576 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x3f605baea3e18b4d` | 8141 | 305525 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x427dd098d8f97de4` | 8141 | 305327 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x43da03441529a67f` | 8141 | 305742 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x473d6320383fa11f` | 8141 | 306152 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x4a4f93b9635ddc48` | 7034189865 | 98914 | eip-8141 (plain): ok, agree |
| `0x4c68a30a16961d9d` | 8141 | 302628 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x4e12d85fee7de68b` | 8141 | 305313 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x4f266e949708b3c6` | 8141 | 306064 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x5786f2e2df2fc320` | 8141 | 305343 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x5a84aaa3921df515` | 8141 | 305534 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x5b31310f62aad1b8` | 8141 | 305446 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x5bcd8f553491bab2` | 8141 | 304740 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x5c08e5feca6995ba` | 8141 | 302877 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x5c607c0b5e21080e` | 8141 | 320280 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x5cd226e75d7303ad` | 8141 | 305254 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x5d2311bc4668e551` | 8141 | 304733 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x5d5d194459e3cd6c` | 8141 | 305400 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x5fb29fe15de91029` | 8141 | 304240 | hegota-testnet: ErrFrameUnrecognizedPrefix, explained (recent-roots)<br>eip-8141: ErrFrameUnrecognizedPrefix, explained (max_verify_gas, recent-roots) |
| `0x624ad97d70719a3d` | 8141 | 67 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x6256f61748c76a0d` | 8141 | 315371 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x642c7f1207ae6302` | 8141 | 305066 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x66adfe6fac269973` | 8141 | 304734 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x674b154165252e70` | 8141 | 306066 | hegota-testnet: ok, agree<br>eip-8141: ErrFrameVerifyGas, explained (max_verify_gas) |
| `0x68f20f09eda8ac96` | 8141 | 74 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x68fc041abd4c9c03` | 8141 | 302848 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x6b5f024336eb1bd7` | 8141 | 305314 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x6f07b8e74f8bdd8d` | 8141 | 70 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x7350bf5f3b043455` | 8141 | 316309 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x738854c6d0850576` | 8141 | 305976 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x75b9fae8678a950f` | 8141 | 305354 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x7c36ba99b08c3aad` | 8141 | 304223 | hegota-testnet: ErrFrameUnrecognizedPrefix, explained (recent-roots)<br>eip-8141: ErrFrameUnrecognizedPrefix, explained (max_verify_gas, recent-roots) |
| `0x7d3e237f2256863a` | 8141 | 304887 | hegota-testnet: ok, agree<br>eip-8141: ErrFrameUnrecognizedPrefix, explained (expiry_verifier) |
| `0x7d656faf6de87e98` | 8141 | 72 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x7e7f0d836fda3f07` | 8141 | 305355 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x7f53ae0cf1ed9a94` | 8141 | 305233 | hegota-testnet: ok, agree<br>eip-8141: ErrFrameUnrecognizedPrefix, explained (expiry_verifier) |
| `0x7fa5825c35412025` | 8141 | 304501 | hegota-testnet: ErrFrameUnrecognizedPrefix, explained (recent-roots)<br>eip-8141: ErrFrameUnrecognizedPrefix, explained (max_verify_gas, recent-roots) |
| `0x7fbe019993c20930` | 8141 | 302623 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x80ca74022f3cdddd` | 8141 | 49562 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x80f2c88b35662f48` | 8141 | 303016 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x81669417973b5682` | 8141 | 305315 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x822694c896372d8d` | 8141 | 305252 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x84d4a91f00c6510f` | 8141 | 305251 | hegota-testnet: ok, agree<br>eip-8141: ErrFrameUnrecognizedPrefix, explained (expiry_verifier) |
| `0x85b550481cdd8f71` | 8141 | 304881 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x87eb827484c3b9e0` | 8141 | 305064 | hegota-testnet: ok, agree<br>eip-8141: ErrFrameUnrecognizedPrefix, explained (expiry_verifier) |
| `0x89f8530c75037e17` | 7034189865 | 98911 | eip-8141 (plain): ok, agree |
| `0x8d3b555a015486be` | 8141 | 303122 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x8d92c6ea17bb5c1e` | 8141 | 306479 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x922d2f8209e20937` | 8141 | 305231 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x9247ec31a7e23034` | 8141 | 305520 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x936da668bb1f2c4f` | 8141 | 304745 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x952ac725a9f1ce2c` | 8141 | 302875 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x96243e113085a465` | 8141 | 306481 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x96800f6b37d4c108` | 8141 | 304742 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x96cdac1117ad36bb` | 8141 | 304878 | hegota-testnet: ok, agree<br>eip-8141: ErrFrameUnrecognizedPrefix, explained (expiry_verifier) |
| `0x9790756d730306ca` | 8141 | 306342 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x9882637a3a4c99b1` | 8141 | 302847 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x98c008189cef9cd9` | 8141 | 316307 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x9982c825e71c8b44` | 8141 | 304730 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x9a399fe1848d0322` | 8141 | 304737 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x9b4fd03bfa47ebf7` | 8141 | 320286 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x9d827f05d02355ad` | 8141 | 304219 | hegota-testnet: ok, agree<br>eip-8141: ErrFrameVerifyGas, explained (max_verify_gas) |
| `0x9dad46a4c06c8256` | 8141 | 304746 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x9de7b8b0218e1d08` | 8141 | 305437 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x9e34ae74166b02e2` | 8141 | 305237 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0x9ebfcfc593c5471c` | 7034189865 | 98911 | eip-8141 (plain): ErrFrameUnrecognizedPrefix, explained (expiry_verifier) |
| `0xa05de9a4f929ac36` | 8141 | 129105 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0xa119ee0009edecf6` | 8141 | 304221 | hegota-testnet: ok, agree<br>eip-8141: ErrFrameVerifyGas, explained (max_verify_gas) |
| `0xa317ca5b4252861e` | 8141 | 303123 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0xa427233c33d49cbd` | 8141 | 305519 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0xa48badb6a22156bc` | 8141 | 305357 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0xa55459ce89b77d51` | 8141 | 305056 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0xa625cf0bf4f55a8a` | 8141 | 305356 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0xa70c6698f2c67e89` | 8141 | 305575 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0xa9320bf8b3930c0b` | 8141 | 304986 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0xaa8aa58cb05b25a2` | 8141 | 302629 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0xaca3e784a3a0308b` | 8141 | 302878 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0xad6f9bb2f4e3de7d` | 8141 | 306143 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0xaee6c586922f3957` | 7034189865 | 98913 | eip-8141 (plain): ok, agree |
| `0xaefa7328b482abf8` | 8141 | 305235 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0xb1342980fe904502` | 8141 | 303018 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0xb214621d169068e6` | 8141 | 305974 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0xb28a915867eb5061` | 8141 | 305886 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0xb30b839b162498ff` | 8141 | 305523 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0xb397ca02c00313fd` | 8141 | 305149 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0xb3ec8cda7a1f14bf` | 8141 | 305312 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0xb464883d25461d6b` | 8141 | 320287 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0xb9017b81c81918bb` | 8141 | 305975 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0xb91efd4abb4e7548` | 8141 | 302636 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0xb9fd14873107703e` | 8141 | 315369 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0xbb32f1fe1431716a` | 8141 | 305524 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0xbb57dbc8a388c004` | 8141 | 306334 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0xbd73cb7e2fb35c3b` | 8141 | 38263 | hegota-testnet: ok, agree<br>eip-8141: ErrFrameVerifyGas, explained (max_verify_gas) |
| `0xbdece10137bff29a` | 8141 | 305248 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0xbeeeb9f0167eb5c3` | 8141 | 305447 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0xc4030e91d6b935f9` | 8141 | 305533 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0xc408bec9af822098` | 8141 | 304938 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0xc487bc7b4cd4d60b` | 8141 | 305982 | hegota-testnet: ok, agree<br>eip-8141: ErrFrameVerifyGas, explained (max_verify_gas) |
| `0xc727c5bc3ec023dc` | 8141 | 305576 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0xc8d332625eaa3cfe` | 8141 | 303017 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0xcc0fb0a92c58e3df` | 8141 | 72 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0xcc96591e9e6117ca` | 8141 | 303002 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0xccd392f45c7d16cf` | 8141 | 316413 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0xcd0d8bf62f5113cd` | 8141 | 304731 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0xcf793fa5cd962a92` | 8141 | 305345 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0xd175f2ae680209ae` | 8141 | 305741 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0xd176b8daf7cff762` | 7034189865 | 98912 | eip-8141 (plain): ok, agree |
| `0xd2d2ae9699bafea6` | 8141 | 305401 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0xd44f0765707dd27a` | 8141 | 315366 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0xd56b23e8c079dc46` | 8141 | 305448 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0xd7ae77c38a43b31b` | 8141 | 305518 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0xda25878b5f7142f8` | 8141 | 305006 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0xdb1815fdf33e6066` | 8141 | 305342 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0xdb62d5052ff913d2` | 8141 | 305517 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0xdd3285b2ef871fbd` | 8141 | 306129 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0xded7fd61e96718ba` | 8141 | 305399 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0xe035073997e16d43` | 8141 | 305150 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0xe22b0d5ce4f6831d` | 8141 | 304739 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0xe23a53ac89083dab` | 8141 | 305056 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0xe4a94f7b09f0fb98` | 8141 | 306344 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0xea13068da88d0d6b` | 8141 | 91066 | hegota-testnet: ErrFrameUnrecognizedPrefix, explained (recent-roots)<br>eip-8141: ErrFrameUnrecognizedPrefix, explained (recent-roots) |
| `0xeb293eb7ea7ac27f` | 8141 | 306131 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0xebbf8e6f879b057f` | 8141 | 303121 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0xec1af2384b905289` | 8141 | 304735 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0xed4fae2046cded26` | 8141 | 306065 | hegota-testnet: ok, agree<br>eip-8141: ErrFrameVerifyGas, explained (max_verify_gas) |
| `0xed7892538fb26904` | 8141 | 302874 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0xefb6d408ccbe6513` | 8141 | 304874 | hegota-testnet: ok, agree<br>eip-8141: ErrFrameUnrecognizedPrefix, explained (expiry_verifier) |
| `0xf09b366152b40dee` | 7034189865 | 98914 | eip-8141 (plain): ok, agree |
| `0xf14a42b232daee00` | 8141 | 316423 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0xf1e4bca4aaa8dbd4` | 8141 | 306403 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0xf2c01318a275b98b` | 8141 | 304984 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0xf32a16816d3c2883` | 8141 | 305000 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0xf34ec26c02d93978` | 8141 | 38219 | hegota-testnet: ok, agree<br>eip-8141: ErrFrameVerifyGas, explained (max_verify_gas) |
| `0xf57451a7523d427e` | 8141 | 304743 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0xf790e5adbda3e680` | 8141 | 302876 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0xf7d46af177260a3d` | 8141 | 316311 | hegota-testnet: ErrFrameUnrecognizedPrefix, explained (recent-roots)<br>eip-8141: ErrFrameUnrecognizedPrefix, explained (expiry_verifier, recent-roots) |
| `0xfb8bb650f4d4ff7f` | 8141 | 306345 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0xfd663ca66585d808` | 8141 | 305344 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0xfde5cf2a22d33ef7` | 8141 | 304985 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
| `0xffb402794317f1ad` | 8141 | 320282 | hegota-testnet: ok, agree<br>eip-8141: ok, agree |
