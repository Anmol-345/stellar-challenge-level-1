import React, { useState } from 'react'
import { retrievePublicKey, userSignTransaction } from './Freighter'
import * as StellarSdk from '@stellar/stellar-sdk'

const SendXLM = ({ publicKey: propPublicKey, onBack }) => {
    const [recipient, setRecipient] = useState("");
    const [amount, setAmount] = useState("");
    const [memo, setMemo] = useState("");
    const [loading, setLoading] = useState(false);
    const [errors, setErrors] = useState({});
    const [alert, setAlert] = useState(null);
    const [transactionHash, setTransactionHash] = useState("");
    const [transactionComplete, setTransactionComplete] = useState(false);

    const server = new StellarSdk.Horizon.Server('https://horizon-testnet.stellar.org');
    const networkPassphrase = 'Test SDF Network ; September 2015';

    // Validation Logic (from transaction.md)
    const validateForm = () => {
        const newErrors = {};

        // Validate recipient
        if (!recipient.trim()) {
            newErrors.recipient = 'Recipient address is required';
        } else if (recipient.length !== 56 || !recipient.startsWith('G')) {
            newErrors.recipient = 'Invalid Stellar address (must start with G and be 56 characters)';
        } else if (!StellarSdk.StrKey.isValidEd25519PublicKey(recipient)) {
            newErrors.recipient = 'Invalid Stellar address format';
        }

        // Validate amount
        if (!amount.trim()) {
            newErrors.amount = 'Amount is required';
        } else {
            const numAmount = parseFloat(amount);
            if (isNaN(numAmount) || numAmount <= 0) {
                newErrors.amount = 'Amount must be a positive number';
            } else if (numAmount < 0.0000001) {
                newErrors.amount = 'Amount is too small (minimum: 0.0000001 XLM)';
            } else if (numAmount > 999999999) {
                newErrors.amount = 'Amount is too large';
            }
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    // Core Transaction Logic (from transaction.md: sendPayment method)
    const sendPayment = async (e) => {
        e.preventDefault();

        if (!validateForm()) {
            return;
        }

        try {
            setLoading(true);
            setAlert(null);
            setTransactionHash("");
            setTransactionComplete(false);

            // Step 1: Get sender's public key
            let senderAddress = propPublicKey;
            if (!senderAddress) {
                try {
                    senderAddress = await retrievePublicKey();
                } catch (error) {
                    throw new Error("Failed to retrieve your wallet address. Please ensure Freighter is connected.");
                }
            }

            if (!senderAddress || senderAddress.trim() === "") {
                throw new Error("Wallet not connected. Please connect your Freighter wallet first.");
            }

            setAlert({ type: 'info', message: 'Loading your account...' });

            // Step 2: Load sender's account from network
            let account;
            try {
                account = await server.loadAccount(senderAddress);
            } catch (error) {
                if (error.response?.status === 404) {
                    throw new Error("Account not found on Stellar Network. Please fund your account first using Friendbot.");
                } else if (error.response?.status === 400) {
                    throw new Error("Invalid account address. Please check your Freighter wallet.");
                }
                throw error;
            }

            setAlert({ type: 'info', message: 'Building transaction...' });

            // Step 3: Create TransactionBuilder with proper configuration
            const transactionBuilder = new StellarSdk.TransactionBuilder(account, {
                fee: StellarSdk.BASE_FEE, // 100 stroops
                networkPassphrase: networkPassphrase, // TESTNET signature
            });

            // Step 4: Add payment operation
            transactionBuilder.addOperation(
                StellarSdk.Operation.payment({
                    destination: recipient,
                    asset: StellarSdk.Asset.native(), // XLM
                    amount: parseFloat(amount).toFixed(7),
                })
            );

            // Step 5: Add optional memo
            if (memo && memo.trim()) {
                transactionBuilder.addMemo(StellarSdk.Memo.text(memo.substring(0, 28)));
            }

            // Step 6: Set timeout and build transaction
            const transaction = transactionBuilder
                .setTimeout(180) // 3 minutes (from transaction.md)
                .build();

            setAlert({ type: 'info', message: 'Requesting signature from Freighter...' });

            // Step 7: Sign transaction via wallet
            const xdr = transaction.toEnvelope().toXDR('base64');
            let signedXdr;
            try {
                signedXdr = await userSignTransaction(xdr, networkPassphrase, senderAddress);
                console.log("Signed XDR received:", typeof signedXdr, signedXdr ? signedXdr.substring(0, 50) : "undefined");
                
                // Validate signed XDR
                if (!signedXdr) {
                    throw new Error('Transaction signing failed: Wallet did not return signed transaction');
                }
                if (typeof signedXdr !== 'string') {
                    throw new Error('Invalid response from Freighter: expected XDR string but got ' + typeof signedXdr);
                }
            } catch (error) {
                throw new Error("Transaction sign request cancelled or failed. Details: " + error.message);
            }

            setAlert({ type: 'info', message: 'Submitting transaction to Stellar Network...' });

            // Step 8: Submit to network - reconstruct transaction from signed XDR
            let transactionToSubmit;
            try {
                // Use StellarSdk.TransactionBuilder to reconstruct from XDR
                // The fromXDR method should be available on the envelope/transaction class
                console.log("Attempting to reconstruct from XDR, StellarSdk keys:", Object.keys(StellarSdk).filter(k => k.includes('Transaction') || k.includes('Envelope')));
                
                // Try multiple approaches to get the transaction
                if (typeof StellarSdk.TransactionBuilder?.fromXDR === 'function') {
                    transactionToSubmit = StellarSdk.TransactionBuilder.fromXDR(signedXdr, networkPassphrase);
                } else if (typeof StellarSdk.Envelope?.fromXDR === 'function') {
                    transactionToSubmit = StellarSdk.Envelope.fromXDR(signedXdr, networkPassphrase);
                } else {
                    // Fallback: create new envelope directly
                    console.log("Using fallback: creating new Envelope");
                    transactionToSubmit = new StellarSdk.Envelope(StellarSdk.xdr.TransactionEnvelope.fromXDR(signedXdr, 'base64'), networkPassphrase);
                }
            } catch (error) {
                console.error("XDR parsing error:", error);
                console.error("Signed XDR sample:", signedXdr.substring(0, 100));
                throw new Error('Failed to reconstruct transaction from signed XDR: ' + error.message);
            }

            let result;
            try {
                result = await server.submitTransaction(transactionToSubmit);
            } catch (error) {
                console.error("Submission error:", error);
                let errorMessage = "Transaction submission failed. ";

                if (error.message.includes("insufficient")) {
                    errorMessage = "Insufficient balance. Please check your account balance.";
                } else if (error.message.includes("destination")) {
                    errorMessage = "Invalid destination account. Please verify the recipient address.";
                } else if (error.response?.status === 400) {
                    errorMessage = "Invalid transaction. Please verify all details and try again.";
                } else if (error.message.includes("timeout")) {
                    errorMessage = "Transaction timed out. Please check your connection.";
                } else {
                    errorMessage += error.message || "Please try again.";
                }

                throw new Error(errorMessage);
            }

            // Step 9: Success - return transaction hash
            setTransactionHash(result.hash);
            setAlert({
                type: 'success',
                message: '✅ Transaction Successful! Your XLM has been sent.',
            });
            setTransactionComplete(true);

            // Clear form
            setRecipient("");
            setAmount("");
            setMemo("");
            setErrors({});

        } catch (error) {
            console.error("Payment error:", error);
            setAlert({
                type: 'error',
                message: error.message || "Transaction failed. Please try again.",
            });
        } finally {
            setLoading(false);
        }
    };

    // Transaction Confirmation Screen (matching transaction.md UI pattern)
    if (transactionComplete) {
        const explorerUrl = `https://stellar.expert/explorer/testnet/tx/${transactionHash}`;

        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 p-8">
                <div className="max-w-md mx-auto">
                    <div className="bg-gradient-to-b from-slate-800 to-slate-900 rounded-lg shadow-xl border border-slate-700 p-8 text-center">
                        {/* Success Icon */}
                        <div className="mb-6 flex justify-center">
                            <div className="bg-green-500/20 border-2 border-green-500 rounded-full p-4">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                            </div>
                        </div>

                        <h2 className="text-3xl font-bold text-green-400 mb-2">Transaction Sent!</h2>
                        <p className="text-slate-400 mb-6">Your XLM transfer has been submitted to the Stellar Network</p>

                        {/* Transaction Details */}
                        <div className="bg-slate-700/50 rounded-lg p-4 mb-6 border border-slate-600 text-left">
                            <div className="mb-4">
                                <span className="text-slate-400 text-xs uppercase tracking-wider">Transaction Hash</span>
                                <p className="text-slate-200 font-mono text-xs break-all mt-1">{transactionHash}</p>
                            </div>
                            <div className="mb-4">
                                <span className="text-slate-400 text-xs uppercase tracking-wider">Recipient</span>
                                <p className="text-slate-200 font-mono text-xs break-all mt-1">{recipient}</p>
                            </div>
                            <div>
                                <span className="text-slate-400 text-xs uppercase tracking-wider">Amount Sent</span>
                                <p className="text-blue-400 font-bold text-lg mt-1">{amount} XLM</p>
                            </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="space-y-3">
                            <a
                                href={explorerUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="w-full inline-block bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-bold py-2.5 px-6 rounded-lg transition duration-200 flex items-center justify-center gap-2 group"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 group-hover:scale-110 transition" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                </svg>
                                View on Stellar Expert
                            </a>
                            <button
                                onClick={onBack}
                                className="w-full bg-gradient-to-r from-slate-600 to-slate-700 hover:from-slate-700 hover:to-slate-800 text-white font-bold py-2.5 px-6 rounded-lg transition duration-200"
                            >
                                Back to Wallet
                            </button>
                        </div>

                        <p className="text-slate-400 text-xs mt-6">Transaction will settle within a few seconds on the Stellar Network</p>
                    </div>
                </div>
            </div>
        );
    }

    // Send Payment Form
    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 p-8">
            <div className="max-w-md mx-auto bg-slate-800 rounded-lg shadow-xl border border-slate-700 p-8">
                <div className="mb-6">
                    <button
                        onClick={onBack}
                        className="text-blue-400 hover:text-blue-300 font-semibold mb-4 inline-flex items-center"
                    >
                        ← Back
                    </button>
                    <h2 className="text-3xl font-bold text-white">Send XLM</h2>
                    <p className="text-slate-400 text-sm mt-2">Transfer Stellar Lumens to another address</p>
                </div>

                {/* Alert Messages */}
                {alert && (
                    <div
                        className={`mb-6 p-4 rounded-lg font-semibold text-sm ${
                            alert.type === "success"
                                ? "bg-green-900 text-green-200 border border-green-700"
                                : alert.type === "error"
                                ? "bg-red-900 text-red-200 border border-red-700"
                                : "bg-blue-900 text-blue-200 border border-blue-700"
                        }`}
                    >
                        {alert.message}
                    </div>
                )}

                {/* Payment Form */}
                <form onSubmit={sendPayment} className="space-y-4">
                    {/* Recipient Input */}
                    <div>
                        <label className="block text-slate-300 text-sm font-semibold mb-2">
                            Recipient Address
                        </label>
                        <input
                            type="text"
                            value={recipient}
                            onChange={(e) => setRecipient(e.target.value)}
                            placeholder="G..."
                            className={`w-full px-4 py-3 bg-slate-700 text-white placeholder-slate-500 rounded-lg border ${
                                errors.recipient ? 'border-red-500' : 'border-slate-600'
                            } focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20`}
                            disabled={loading}
                        />
                        {errors.recipient && (
                            <p className="text-red-400 text-xs mt-1">{errors.recipient}</p>
                        )}
                    </div>

                    {/* Amount Input */}
                    <div>
                        <label className="block text-slate-300 text-sm font-semibold mb-2">
                            Amount (XLM)
                        </label>
                        <input
                            type="number"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            placeholder="0.00"
                            step="0.0000001"
                            min="0"
                            className={`w-full px-4 py-3 bg-slate-700 text-white placeholder-slate-500 rounded-lg border ${
                                errors.amount ? 'border-red-500' : 'border-slate-600'
                            } focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20`}
                            disabled={loading}
                        />
                        {errors.amount && (
                            <p className="text-red-400 text-xs mt-1">{errors.amount}</p>
                        )}
                    </div>

                    {/* Memo Input (Optional) */}
                    <div>
                        <label className="block text-slate-300 text-sm font-semibold mb-2">
                            Memo (Optional)
                        </label>
                        <input
                            type="text"
                            value={memo}
                            onChange={(e) => setMemo(e.target.value)}
                            placeholder="Payment for..."
                            maxLength="28"
                            className="w-full px-4 py-3 bg-slate-700 text-white placeholder-slate-500 rounded-lg border border-slate-600 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                            disabled={loading}
                        />
                        <p className="text-slate-500 text-xs mt-1">{memo.length}/28 characters</p>
                    </div>

                    {/* Submit Button */}
                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3 px-6 rounded-lg transition duration-200 mt-6 flex items-center justify-center gap-2"
                    >
                        {loading ? (
                            <>
                                <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                Processing...
                            </>
                        ) : (
                            <>
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                                </svg>
                                Send XLM
                            </>
                        )}
                    </button>
                </form>

                {/* Security Warning */}
                <div className="mt-4 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                    <p className="text-blue-200/90 text-xs">
                        ⚠️ <strong>Double-check</strong> the recipient address before sending. Transactions on the blockchain are irreversible!
                    </p>
                </div>
            </div>
        </div>
    );
};

export default SendXLM;
