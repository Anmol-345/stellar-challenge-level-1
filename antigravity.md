# SendXLM.js - TypeError: Cannot read properties of undefined (reading 'fromXDR') Fix

## Problem
When attempting to send a payment, the following error occurs at line 137 in SendXLM.js:
```
Payment error: TypeError: Cannot read properties of undefined (reading 'fromXDR')
    at sendPayment (SendXLM.js:137:1)
```

This means one of the following is undefined when trying to call `.fromXDR()`:
- `StellarSdk.TransactionBuilder` is undefined
- The transaction object is undefined
- The signed XDR response is undefined

## Root Cause Analysis

### Most Likely Cause: Missing or Incorrect Signed XDR
```typescript
// ❌ PROBLEMATIC CODE AT LINE 137
const transactionToSubmit = StellarSdk.TransactionBuilder.fromXDR(
  signedTxXdr,  // ← This might be undefined!
  this.networkPassphrase
);
```

The wallet signing operation failed or didn't return the signed transaction XDR.

### Secondary Causes:
1. **StellarSdk not imported or not initialized**
2. **Wallet kit signing failed silently**
3. **signedTxXdr is null/undefined from wallet response**
4. **Network passphrase mismatch causing wallet to reject**

## Solution: Fix SendXLM.js

### Step 1: Add Error Checking Before fromXDR Call
Before line 137, add validation:

```typescript
// BEFORE attempting to reconstruct transaction
if (!signedTxXdr) {
  throw new Error('Transaction signing failed: No signed XDR returned from wallet');
}

if (!StellarSdk.TransactionBuilder) {
  throw new Error('StellarSdk not properly initialized - TransactionBuilder is undefined');
}

// NOW safely call fromXDR
const transactionToSubmit = StellarSdk.TransactionBuilder.fromXDR(
  signedTxXdr,
  this.networkPassphrase
);
```

### Step 2: Add Try-Catch Around Wallet Signing
Wrap wallet signing in try-catch to catch failures:

```typescript
let signedTxXdr;
try {
  const signResponse = await this.kit.signTransaction(transaction.toXDR(), {
    networkPassphrase: this.networkPassphrase,
  });
  signedTxXdr = signResponse?.signedTxXdr;
} catch (error) {
  throw new Error(`Wallet signing failed: ${error.message}`);
}

if (!signedTxXdr) {
  throw new Error('Transaction signing failed: No signed transaction returned');
}
```

### Step 3: Verify StellarSdk Import
At the top of SendXLM.js, ensure:
```typescript
import * as StellarSdk from '@stellar/stellar-sdk';
```

NOT:
```typescript
const StellarSdk = require('@stellar/stellar-sdk');  // May not work correctly
```

### Step 4: Verify networkPassphrase is Set Correctly
```typescript
// ✅ CORRECT - Should match wallet network
this.networkPassphrase === StellarSdk.Networks.TESTNET
  ? 'Test SDF Network ; September 2015'
  : 'Public Global Stellar Network ; September 2015'

// ❌ WRONG - Don't hardcode
networkPassphrase: 'Public Global Stellar Network ; September 2015'
```

## Complete sendPayment Method - Fixed Version

```typescript
async sendPayment(params: {
  from: string;
  to: string;
  amount: string;
  memo?: string;
}): Promise<{ hash: string; success: boolean }> {
  try {
    // Load account for transaction
    const account = await this.server.loadAccount(params.from);

    // Build transaction
    const transactionBuilder = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    }).addOperation(
      StellarSdk.Operation.payment({
        destination: params.to,
        asset: StellarSdk.Asset.native(),
        amount: params.amount,
      })
    );

    if (params.memo) {
      transactionBuilder.addMemo(StellarSdk.Memo.text(params.memo));
    }

    const transaction = transactionBuilder.setTimeout(180).build();
    console.log('Transaction built, requesting wallet signature...');

    // Request wallet signature
    let signedTxXdr;
    try {
      const signResponse = await this.kit.signTransaction(
        transaction.toXDR(), 
        {
          networkPassphrase: this.networkPassphrase,
        }
      );
      
      signedTxXdr = signResponse?.signedTxXdr;
      console.log('Wallet signature received:', !!signedTxXdr);
      
    } catch (signError: any) {
      throw new Error(`Wallet signing failed: ${signError.message}`);
    }

    // Validate signed XDR
    if (!signedTxXdr) {
      throw new Error('Transaction signing failed: Wallet did not return signed transaction');
    }

    // Reconstruct transaction from signed XDR
    if (!StellarSdk?.TransactionBuilder) {
      throw new Error('StellarSdk.TransactionBuilder is not available - module not loaded');
    }

    const transactionToSubmit = StellarSdk.TransactionBuilder.fromXDR(
      signedTxXdr,
      this.networkPassphrase
    );

    // Submit to network
    console.log('Submitting transaction to Stellar network...');
    const result = await this.server.submitTransaction(
      transactionToSubmit as StellarSdk.Transaction
    );

    console.log('Transaction submitted successfully:', result.hash);
    return {
      hash: result.hash,
      success: result.successful,
    };

  } catch (error: any) {
    console.error('sendPayment error:', error);
    throw error;
  }
}
```

## Debugging Steps

### 1. Add Console Logs
```typescript
console.log('1. Transaction built');
console.log('2. Requesting wallet signature...');
const signResponse = await this.kit.signTransaction(...);
console.log('3. Wallet response:', signResponse);
console.log('4. signedTxXdr value:', signResponse?.signedTxXdr);
console.log('5. StellarSdk.TransactionBuilder:', StellarSdk.TransactionBuilder);
```

### 2. Check Wallet Connection First
Ensure wallet is properly connected before sending:
```typescript
if (!this.publicKey) {
  throw new Error('Wallet not connected');
}

if (!this.kit) {
  throw new Error('Stellar Wallets Kit not initialized');
}
```

### 3. Verify Network Match
Before attempting payment:
```typescript
console.log('Wallet Network:', this.network);
console.log('Transaction Network Passphrase:', this.networkPassphrase);
// These should match the wallet's settings
```

## Expected Outcome
After applying these fixes:
1. ✅ Wallet signing completes successfully
2. ✅ `signedTxXdr` is properly returned from wallet
3. ✅ `StellarSdk.TransactionBuilder.fromXDR()` can reconstruct transaction
4. ✅ Transaction submits to network without "Cannot read properties of undefined" error
5. ✅ User receives transaction hash on success

## Prevention Tips
- Always validate async results before using them
- Add null checks before calling methods
- Log at each step of transaction lifecycle
- Ensure module imports are correct (ES6 import vs require)
- Keep StellarSdk and wallet kit versions aligned
