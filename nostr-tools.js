// Minimal Nostr tools for Sidecar extension
// This is a simplified version - in production, use the full nostr-tools library

const NostrTools = (() => {
  // Utility functions for hex/string conversion
  function hexToBytes(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return bytes;
  }
  
  function bytesToHex(bytes) {
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }
  
  // Bech32 encoding/decoding for NIP-19
  const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
  
  function bech32Polymod(values) {
    const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
    let chk = 1;
    for (const value of values) {
      const top = chk >> 25;
      chk = (chk & 0x1ffffff) << 5 ^ value;
      for (let i = 0; i < 5; i++) {
        chk ^= ((top >> i) & 1) ? GEN[i] : 0;
      }
    }
    return chk;
  }
  
  function bech32HrpExpand(hrp) {
    const ret = [];
    const p = hrp.length;
    for (let i = 0; i < p; i++) {
      ret.push(hrp.charCodeAt(i) >> 5);
    }
    ret.push(0);
    for (let i = 0; i < p; i++) {
      ret.push(hrp.charCodeAt(i) & 31);
    }
    return ret;
  }
  
  function bech32VerifyChecksum(hrp, data) {
    return bech32Polymod(bech32HrpExpand(hrp).concat(data)) === 1;
  }
  
  function bech32CreateChecksum(hrp, data) {
    const values = bech32HrpExpand(hrp).concat(data).concat([0, 0, 0, 0, 0, 0]);
    const mod = bech32Polymod(values) ^ 1;
    const ret = [];
    for (let i = 0; i < 6; i++) {
      ret.push((mod >> 5 * (5 - i)) & 31);
    }
    return ret;
  }
  
  function bech32Encode(hrp, data) {
    const combined = data.concat(bech32CreateChecksum(hrp, data));
    let ret = hrp + '1';
    for (const d of combined) {
      ret += BECH32_CHARSET.charAt(d);
    }
    return ret;
  }
  
  function bech32Decode(bechString) {
    if (bechString.length > 90) throw new Error('Too long');
    if (bechString !== bechString.toLowerCase() && bechString !== bechString.toUpperCase()) {
      throw new Error('Mixed case');
    }
    bechString = bechString.toLowerCase();
    const pos = bechString.lastIndexOf('1');
    if (pos < 1 || pos + 7 > bechString.length || pos + 1 + 6 > bechString.length) {
      throw new Error('Invalid separator position');
    }
    const hrp = bechString.substring(0, pos);
    const data = [];
    for (let i = pos + 1; i < bechString.length; i++) {
      const d = BECH32_CHARSET.indexOf(bechString.charAt(i));
      if (d === -1) throw new Error('Invalid character');
      data.push(d);
    }
    if (!bech32VerifyChecksum(hrp, data)) throw new Error('Invalid checksum');
    return { hrp, data: data.slice(0, -6) };
  }
  
  function convertBits(data, fromBits, toBits, pad = true) {
    let acc = 0;
    let bits = 0;
    const ret = [];
    const maxv = (1 << toBits) - 1;
    const maxAcc = (1 << (fromBits + toBits - 1)) - 1;
    for (const value of data) {
      if (value < 0 || (value >> fromBits) !== 0) {
        throw new Error('Invalid data');
      }
      acc = ((acc << fromBits) | value) & maxAcc;
      bits += fromBits;
      while (bits >= toBits) {
        bits -= toBits;
        ret.push((acc >> bits) & maxv);
      }
    }
    if (pad) {
      if (bits > 0) {
        ret.push((acc << (toBits - bits)) & maxv);
      }
    } else if (bits >= fromBits || ((acc << (toBits - bits)) & maxv)) {
      throw new Error('Invalid padding');
    }
    return ret;
  }
  
  // Simple secp256k1 implementation (very basic - use a proper library in production)
  async function generatePrivateKey() {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return bytesToHex(array);
  }
  
  async function getPublicKey(privateKey) {
    // This is a placeholder - in production, use a proper secp256k1 library
    // For demo purposes, we'll create a deterministic but fake public key
    const encoder = new TextEncoder();
    const data = encoder.encode(privateKey);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return bytesToHex(new Uint8Array(hashBuffer));
  }
  
  async function getEventHash(event) {
    const eventData = JSON.stringify([
      0,
      event.pubkey,
      event.created_at,
      event.kind,
      event.tags,
      event.content
    ]);
    const encoder = new TextEncoder();
    const data = encoder.encode(eventData);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return bytesToHex(new Uint8Array(hashBuffer));
  }
  
  async function signEvent(event, privateKey) {
    // This is a placeholder - in production, use proper secp256k1 signing
    const id = await getEventHash(event);
    // Create a fake signature for demo
    const fakeSignature = '0'.repeat(128);
    return {
      ...event,
      id,
      sig: fakeSignature
    };
  }
  
  // NIP-19 encoding/decoding
  const nip19 = {
    npubEncode(hex) {
      const data = convertBits(hexToBytes(hex), 8, 5);
      return bech32Encode('npub', data);
    },
    
    nsecEncode(hex) {
      const data = convertBits(hexToBytes(hex), 8, 5);
      return bech32Encode('nsec', data);
    },
    
    decode(nip19String) {
      const { hrp, data } = bech32Decode(nip19String);
      const bytes = convertBits(data, 5, 8, false);
      
      switch (hrp) {
        case 'npub':
        case 'nsec':
          return {
            type: hrp,
            data: bytesToHex(new Uint8Array(bytes))
          };
        default:
          throw new Error('Unknown prefix');
      }
    }
  };
  
  return {
    generatePrivateKey,
    getPublicKey,
    getEventHash,
    finishEvent: signEvent,
    nip19
  };
})();

// Make available globally
window.NostrTools = NostrTools;