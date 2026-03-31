# Stellar Wallet Transaction Logic - Antigravity Replication Prompt

## Project Overview
This is a Stellar blockchain payment dashboard that allows users to:
1. Connect their Stellar wallet (via Freighter, xBull, Albedo, etc.)
2. View their balance (XLM and other assets)
3. Send XLM payments to other addresses
4. View transaction history
5. Explore transactions on Stellar Expert

**Technology Stack:**
- Frontend: Next.js 14 (React with TypeScript)
- Blockchain: Stellar SDK (@stellar/stellar-sdk)
- Wallet Integration: Stellar Wallets Kit (@creit.tech/stellar-wallets-kit)
- Network: Testnet (https://horizon-testnet.stellar.org)
- Styling: TailwindCSS

---

## Core Transaction Logic Architecture

### 1. Stellar Helper Class (Backend Blockchain Logic)
**File:** `lib/stellar-helper.ts`

#### Class: StellarHelper
```
Properties:
- server: Horizon server instance (testnet)
- networkPassphrase: StellarSdk.Networks.TESTNET
- kit: StellarWalletsKit instance
- network: WalletNetwork.TESTNET
- publicKey: string | null (connected wallet address)

Constructor:
- Initializes Horizon server for testnet
- Sets network passphrase
- Initializes Stellar Wallets Kit with Freighter as default
```

#### Method 1: connectWallet()
**Purpose:** Connect user's wallet using Stellar Wallets Kit modal
```
Flow:
1. Open wallet selection modal via kit.openModal()
2. User selects wallet (e.g., Freighter)
3. Kit sets selected wallet via kit.setWallet()
4. Retrieve connected wallet address via kit.getAddress()
5. Store publicKey and return address
6. Error handling: Throw error if connection fails

Returns: string (wallet address)
Errors: Wallet not installed, connection timeout, user cancellation
```

#### Method 2: getBalance(publicKey: string)
**Purpose:** Fetch connected wallet's balance
```
Flow:
1. Load account from Stellar network: server.loadAccount(publicKey)
2. Find native asset (XLM) in balances array
3. Extract all non-native assets (tokens) from balances
4. Format assets with: code, issuer, balance

Returns: {
  xlm: string (e.g., "1000.50")
  assets: Array of {
    code: string (asset code)
    issuer: string (asset issuer address)
    balance: string (amount)
  }
}

Usage: Display in BalanceDisplay component
```

#### Method 3: sendPayment(params)
**Purpose:** Create, sign, and submit payment transaction
```
Parameters:
{
  from: string (sender address)
  to: string (recipient address)
  amount: string (amount in stroops/smallest unit)
  memo?: string (optional transaction memo)
}

Flow:
1. Load sender's account from network
2. Create TransactionBuilder with:
   - Account object
   - Fee: StellarSdk.BASE_FEE (100 stroops)
   - Network passphrase: TESTNET
3. Add payment operation:
   - Destination: recipient address
   - Asset: Native (XLM)
   - Amount: specified amount
4. If memo provided: Add memo.text()
5. Set timeout: 180 seconds
6. Build transaction
7. Sign transaction via kit.signTransaction():
   - Convert to XDR format
   - Pass to wallet for user signature
   - Return signed XDR
8. Convert signed XDR back to Transaction
9. Submit to network via server.submitTransaction()
10. Return transaction hash and success status

Returns: {
  hash: string (transaction hash for tracking)
  success: boolean (whether submission succeeded)
}

Error Handling:
- Insufficient balance
- Invalid destination address
- Network failures
- User rejected transaction
- Transaction timeout

Validation happens at component level before calling this method
```

#### Method 4: getRecentTransactions(publicKey, limit = 10)
**Purpose:** Fetch transaction history for an account
```
Flow:
1. Query Horizon server for payments related to account:
   - server.payments()
   - Filter by account: .forAccount(publicKey)
   - Order by date: .order('desc') (newest first)
   - Limit results: .limit(limit)
   - Execute: .call()
2. Map each record to standardized format:
   - id: payment ID
   - type: transaction type (payment, etc.)
   - amount: transaction amount
   - asset: 'XLM' for native, or asset_code
   - from: sender address
   - to: recipient address
   - createdAt: ISO timestamp
   - hash: transaction hash

Returns: Array of {
  id: string
  type: string
  amount?: string
  asset?: string
  from?: string
  to?: string
  createdAt: string
  hash: string
}

Usage: Display in TransactionHistory component, refresh after successful payment
```

#### Method 5: getExplorerLink(hash, type = 'tx')
**Purpose:** Generate Stellar Expert explorer link
```
Flow:
1. Determine network: testnet or public
2. Construct URL: 
   - https://stellar.expert/explorer/{network}/{type}/{hash}
   - Example: https://stellar.expert/explorer/testnet/tx/abcd1234...

Returns: string (explorer URL)
```

#### Method 6: formatAddress(address, startChars = 4, endChars = 4)
**Purpose:** Shorten long addresses for display
```
Example:
- Input: "GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJHT4EFURBRNC6ZQOPWTNHJ2B"
- Output: "GBRP...H2B"
```

#### Method 7: disconnect()
**Purpose:** Clear connected wallet state
```
Sets publicKey = null and returns true
```

---

### 2. Payment Form Component
**File:** `components/PaymentForm.tsx`

#### State Management:
```
- recipient: string (destination address)
- amount: string (payment amount)
- memo: string (optional transaction memo)
- loading: boolean (submission in progress)
- errors: object {recipient?, amount?} (validation errors)
- alert: object {type, message} | null (success/error messages)
- txHash: string (returned transaction hash)
```

#### Validation Logic:
```
validateForm() {
  Validate recipient:
  1. Check if not empty
  2. Check length === 56 characters
  3. Check starts with 'G' (Stellar address prefix)
  Error: "Invalid Stellar address (must start with G and be 56 characters)"

  Validate amount:
  1. Check if not empty
  2. Parse as float
  3. Check > 0
  4. Check >= 0.0000001 (minimum Stellar amount)
  Errors: "Amount must be a positive number" or "Amount is too small"

  Return: boolean (all fields valid)
}
```

#### Form Submission Flow:
```
1. On form submit:
   - Prevent default form behavior
   - Run validateForm()
   - Exit if validation fails

2. If validation passes:
   - Set loading = true
   - Clear previous alerts and txHash

3. Call stellar.sendPayment({
     from: publicKey,
     to: recipient,
     amount: amount,
     memo: memo || undefined
   })

4. If successful:
   - Set txHash to returned hash
   - Show success alert
   - Clear form fields (recipient, amount, memo)
   - Clear errors
   - Call onSuccess callback (to refresh balance/history)

5. If error:
   - Parse error message
   - Check for specific errors (insufficient balance, invalid destination)
   - Show appropriate error alert

6. Finally:
   - Set loading = false
```

#### UI Components:
```
Input Fields:
- Recipient Address (56-char validation)
- Amount (number, positive, min 0.0000001)
- Memo (optional)

Button: Send Payment (disabled during loading, shows spinner)

Alerts:
- Success message with transaction hash
- Error message with specific failure reason

Post-Success Display:
- Show transaction hash
- Show "View on Stellar Expert" link
```

---

### 3. Transaction History Component
**File:** `components/TransactionHistory.tsx`

#### State Management:
```
- transactions: Array<Transaction>
- loading: boolean (initial fetch)
- refreshing: boolean (manual refresh)
- limit: number (default 10 recent transactions)
```

#### Data Fetching Flow:
```
1. On component mount:
   - If publicKey exists, call fetchTransactions()

2. fetchTransactions():
   - Set refreshing = true
   - Call stellar.getRecentTransactions(publicKey, limit)
   - Update transactions state
   - Handle errors (log to console)
   - Set loading = false
   - Set refreshing = false

3. Manual refresh:
   - User clicks refresh button
   - Triggers fetchTransactions()
```

#### Transaction Display Logic:
```
For each transaction:
1. Determine direction:
   - If tx.from === currentPublicKey → Outgoing (red, arrow up)
   - Else → Incoming (green, arrow down)

2. Format amount display:
   - Outgoing: "-{amount} {asset}"
   - Incoming: "+{amount} {asset}"

3. Format date:
   - < 1 minute: "Just now"
   - < 60 minutes: "{mins}m ago"
   - < 24 hours: "{hours}h ago"
   - < 7 days: "{days}d ago"
   - Older: "MMM DD, YYYY"

4. Display grid:
   - Icon (up arrow for sent, down arrow for received)
   - Amount with color coding
   - From address (shortened)
   - To address (shortened)
   - Transaction date
   - Transaction hash (shortened)
   - Link to explorer

5. Empty state:
   - Show message if no transactions
   - "Your transaction history will appear here..."

6. Loading state:
   - Show 3 skeleton loaders while fetching
```

---

### 4. Wallet Connection Component
**File:** `components/WalletConnection.tsx`

#### Connection Flow:
```
1. User clicks "Connect Wallet" button
2. Set loading = true
3. Call stellar.connectWallet()
4. Wallet modal opens (user selects wallet and approves)
5. Once address is returned:
   - Set publicKey
   - Set isConnected = true
   - Call onConnect callback with publicKey
   - Set loading = false
6. Error handling:
   - Catch exceptions
   - Show alert with error message
   - Set loading = false
```

#### Disconnection Flow:
```
1. User clicks "Disconnect" button
2. Call stellar.disconnect()
3. Clear publicKey
4. Set isConnected = false
5. Call onDisconnect callback
```

#### Copy Address Feature:
```
1. User clicks copy button
2. navigator.clipboard.writeText(publicKey)
3. Show "Copied!" feedback
4. Auto-hide after 2 seconds
```

#### Display Logic:
```
If not connected:
- Show "Connect Your Wallet" card
- Display supported wallets list
- Show "Connect Wallet" button

If connected:
- Show connected address (full or shortened)
- Show copy button with feedback
- Show disconnect button
```

---

### 5. Balance Display Component
**File:** `components/BalanceDisplay.tsx`

#### Data Fetching:
```
1. On mount or publicKey change:
   - Set loading = true
   - Call stellar.getBalance(publicKey)
   - Display XLM balance prominently
   - Display other assets in list
   - Set loading = false

2. Error handling:
   - Show error state if fetch fails
```

#### Display:
```
Main Display:
- XLM balance with large font
- Unit label "XLM"
- Format: 2 decimal places for display

Assets List:
- For each non-native asset:
  - Asset code
  - Issuer address (shortened)
  - Balance amount
  - Option to interact/send
```

---

### 6. Main Dashboard Flow (page.tsx)
**File:** `app/page.tsx`

#### Component Orchestration:
```
State:
- publicKey: string | null
- isConnected: boolean
- refreshKey: number (for manual refresh triggers)

Layout Flow:
1. Header: Show dashboard title and navigation
2. Wallet Connection Section:
   - Always visible
   - Allows connect/disconnect
3. Dashboard Content (only if connected):
   - Balance Display
   - Payment Form (left column)
   - Transaction History (right column)
   - Info cards about Stellar benefits
4. Getting Started Guide (only if not connected):
   - Show educational cards

Callbacks:
- onConnect: Updates publicKey and isConnected, shows dashboard
- onDisconnect: Clears publicKey and hides dashboard
- onPaymentSuccess: Increments refreshKey to refresh balance/history
```

---

## Key Validation Rules

### Stellar Address Validation:
```
- Exact length: 56 characters
- Must start with 'G'
- Valid Base32 encoding
```

### Amount Validation:
```
- Must be positive number
- Minimum: 0.0000001 XLM (1 stroops)
- No currency symbols allowed
- Decimal places supported
```

### Memo Validation:
```
- Optional field
- Max length: 28 characters (if text memo)
- ASCII text only
```

---

## Error Handling Strategy

### Wallet Connection Errors:
```
1. Freighter not installed → Guide user to install
2. User cancels connection → Gracefully handle
3. Network timeout → Retry or show error
```

### Payment Errors:
```
1. Insufficient balance → "Check your balance"
2. Invalid destination → "Address not found on network"
3. Transaction rejected by wallet → "User cancelled"
4. Network submission failed → "Connection issue, try again"
5. Timeout → "Transaction took too long"
```

### Balance/History Fetch Errors:
```
1. Account not found → "Account not activated" (needs initial funding)
2. Network error → "Unable to connect to network"
3. Rate limited → "Too many requests, try later"
```

---

## Refresh Mechanisms

### Manual Refresh:
```
- Transaction History: Click refresh button
- Balance: Callback from successful payment
- Triggered via refreshKey state increment
```

### Auto-Refresh Triggers:
```
- After successful payment → Refresh balance and history
- User connects wallet → Load initial balance and history
- User manually clicks refresh → Update all data
```

---

## Security Considerations

### Private Key Management:
```
- NEVER stored in frontend code
- ALWAYS kept in wallet extension
- Transaction signing happens in wallet only
- Frontend only handles public key
```

### Address Validation:
```
- Validate recipient address format (56 chars, starts with G)
- Validate via Stellar network (account exists, can receive)
```

### Transaction Confirmation:
```
- Always show transaction hash to user
- Provide link to verify on Stellar Expert
- Show confirmation with all transaction details
```

---

## Testing Scenarios

### Test Transaction Flow:
```
1. Connect to testnet wallet
2. Get initial XLM balance from faucet (if needed)
3. Send payment to another testnet address
4. Verify transaction appears in history
5. Check transaction on Stellar Expert
6. Test with various amounts and memo
```

### Test Validation:
```
1. Try invalid recipient addresses
2. Try amounts outside valid range
3. Try without memo (should work)
4. Try with memo too long
5. Try insufficient balance
6. Try disconnecting mid-transaction
```

### Test Error States:
```
1. Network down → Show error
2. Account not found → Show error
3. Invalid credentials → Show error
4. Transaction rejected → Show error
```

---

## Integration Points

### External Dependencies:
```
@stellar/stellar-sdk
- TransactionBuilder
- Operation.payment()
- Asset.native()
- Networks
- Horizon Server

@creit.tech/stellar-wallets-kit
- StellarWalletsKit
- WalletNetwork
- Modal functionality
- Transaction signing
```

### Callback Architecture:
```
Parent (page.tsx) → Child components:
- onConnect(publicKey) → Update dashboard
- onDisconnect() → Hide dashboard
- onPaymentSuccess() → Refresh all data
- onRefresh() → Manual data refresh
```

---

## Summary: Complete Transaction Lifecycle

### User sends 100 XLM:
```
1. User enters recipient address
2. User enters amount (100)
3. Optional: Add memo
4. Click "Send Payment"
5. Form validates inputs
6. Call stellar.sendPayment()
7. StellarHelper creates transaction builder
8. Adds payment operation (100 XLM to recipient)
9. Wallet prompts user to sign
10. User confirms in wallet extension
11. Signed transaction submitted to Stellar network
12. Returns transaction hash if successful
13. Show success message with hash
14. Clear form
15. Refresh balance (decreased by 100 + 0.00001 fee)
16. Refresh transaction history (shows new transaction)
17. User can click link to view on Stellar Expert
```

---

## Files Structure Reference
```
lib/stellar-helper.ts        → Core blockchain logic
components/WalletConnection.tsx → Wallet connection UI
components/PaymentForm.tsx     → Payment submission UI
components/TransactionHistory.tsx → Transaction display UI
components/BalanceDisplay.tsx  → Balance display UI
app/page.tsx                   → Main orchestration
```

---

## Network Configuration
```
Network: Testnet
Horizon API: https://horizon-testnet.stellar.org
Network Passphrase: "Test SDF Network ; September 2015"
Base Fee: 100 stroops (0.00001 XLM)
Transaction Timeout: 180 seconds
Supported Wallets: Freighter, xBull, Albedo, Rabet, Lobstr, Hana, WalletConnect
```

This prompt contains all the logic needed for antigravity to replicate the exact transaction functionality.