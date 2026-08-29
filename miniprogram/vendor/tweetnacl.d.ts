interface TweetNaclSignKeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

interface TweetNacl {
  hash(message: Uint8Array): Uint8Array;
  sign: {
    detached(message: Uint8Array, secretKey: Uint8Array): Uint8Array;
    keyPair: {
      fromSeed(seed: Uint8Array): TweetNaclSignKeyPair;
    };
  };
}

declare const nacl: TweetNacl;

export = nacl;
