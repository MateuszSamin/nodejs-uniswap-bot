import { createPublicClient, createWalletClient, encodeFunctionData, getContract, http, parseUnits } from 'viem';
import { mainnet } from 'viem/chains';
import { formatUnits } from "viem";
import * as dotenv from 'dotenv';
import { privateKeyToAccount } from 'viem/accounts';

dotenv.config();

const privateKey = process.env.PRIVATE_KEY?.startsWith('0x') ? process.env.PRIVATE_KEY : `0x${process.env.PRIVATE_KEY}` || '';
//@ts-ignore
const account = privateKeyToAccount(privateKey);

const client = createPublicClient({
    chain: mainnet,
    transport: http('/YOUR PROVIDER API KEY/'),
});

const walletClient = createWalletClient({
    account,
    chain: mainnet,
    transport: http('/YOUR PROVIDER API KEY/'),
})

const uniswapV2RouterAddress = '0x7a250d5630b4cf539739df2c5dacb4c659f2488d';

const tokenOut = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'; // WETH
const tokenIn = '0xdAC17F958D2ee523a2206206994597C13D831ec7'; // USDT

const routerABI = [
    {
        "constant": false,
        "inputs": [
            { "name": "amountIn", "type": "uint256" },
            { "name": "amountOutMin", "type": "uint256" },
            { "name": "path", "type": "address[]" },
            { "name": "to", "type": "address" },
            { "name": "deadline", "type": "uint256" }
        ],
        "name": "swapExactTokensForETHSupportingFeeOnTransferTokens",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "constant": true,
        "inputs": [
            { "name": "amountIn", "type": "uint256" },
            { "name": "path", "type": "address[]" }
        ],
        "name": "getAmountsOut",
        "outputs": [
            { "name": "amounts", "type": "uint256[]" }
        ],
        "stateMutability": "view",
        "type": "function"
    }
];

const uniswapV2Router = getContract({
    address: uniswapV2RouterAddress,
    abi: routerABI,
    client: client
})

async function getEthForDollar() {
    const path = [tokenIn, tokenOut]; // USDT to ETH
    const amountOutUSD = BigInt(1 * 10 ** 6);

    try {
        const amountsIn: any = await client.readContract({
            ...uniswapV2Router,
            functionName: 'getAmountsOut',
            args: [amountOutUSD, path]
        });

        const ethAmount = formatUnits(amountsIn[1], 18);
        console.log(`For 1 USDT you can buy: ${ethAmount} ETH`);
    } catch (error) {
        console.error("Cannot check price for ETH:", error);
    }
}

async function getUSDTBalance() {
    return await client.readContract({
        address: tokenIn,
        abi: [{
            "constant": true,
            "inputs": [{ "name": "owner", "type": "address" }],
            "name": "balanceOf",
            "outputs": [{ "name": "balance", "type": "uint256" }],
            "stateMutability": "view",
            "type": "function"
        }],
        functionName: 'balanceOf',
        args: [account.address]
    });
}

async function getAllowance() {
    return await client.readContract({
        address: tokenIn,
        abi: [{
            "constant": true,
            "inputs": [
                { "name": "owner", "type": "address" },
                { "name": "spender", "type": "address" }
            ],
            "name": "allowance",
            "outputs": [{ "name": "remaining", "type": "uint256" }],
            "stateMutability": "view",
            "type": "function"
        }],
        functionName: 'allowance',
        args: [account.address, uniswapV2RouterAddress]
    });
}

async function approveUSDT(spender: string, amount: bigint) {
    const balance = await getUSDTBalance();
    const allowance = await getAllowance();

    if (balance < amount) {
        console.error(`Error: You have only ${formatUnits(balance, 6)} USDT, but you need ${formatUnits(amount, 6)} USDT.`);
        return;
    }

    if (allowance >= amount) {
        console.log(" USDT already has been approved");
        return;
    }

    try {
        const tx = await walletClient.sendTransaction({
            to: tokenIn,
            data: encodeFunctionData({
                abi: [{
                    "constant": false,
                    "inputs": [
                        { "name": "spender", "type": "address" },
                        { "name": "value", "type": "uint256" }
                    ],
                    "name": "approve",
                    "outputs": [{ "name": "", "type": "bool" }],
                    "stateMutability": "nonpayable",
                    "type": "function"
                }],
                functionName: "approve",
                //@ts-ignore
                args: [spender, amount]
            }),
            account
        });

        console.log("USDT approve: ", `https://etherscan.io/tx/${tx}`);
    } catch (error) {
        console.error("Error approve USDT:", error);
    }
}

async function swapUSDTForETH() {
    const amountIn = parseUnits("1", 6);
    const path = [tokenIn, tokenOut];
    const deadline = Math.floor(Date.now() / 1000) + 60 * 5; // 5 minutes from the current Unix time

    try{
        const amountOut: any = await client.readContract({
            ...uniswapV2Router,
            functionName: 'getAmountsOut',
            args: [amountIn, path]
        })

        const minAmountOut = BigInt(amountOut[1]) * 99n / 100n; // 1% slippage tolerance

        const hash = await walletClient.sendTransaction({
            to: uniswapV2RouterAddress,
            data: encodeFunctionData({
                abi: routerABI,
                functionName: 'swapExactTokensForETHSupportingFeeOnTransferTokens',
                args: [amountIn, minAmountOut, path, account.address, deadline]
            }),
            account
        });

        console.log("Transaction has been sent. Link to etherscan:", `https://etherscan.io/tx/${hash}`);
    } catch (error) {
        console.error("Cannot swap USDT for ETH:", error);
    }
}

async function getBalance(address: any) {
    const balanceSepolia = await client.getBalance({ address });

    console.log(`Balance(ETH) of ${address}: ${formatUnits(balanceSepolia, 18)} ETH`);
}

async function executeSwap() {
    try {
        console.log(" Fetching initial balance...");
        await getBalance(account.address);

        console.log(" Checking price for ETH...");
        await getEthForDollar();

        console.log(" Checking USDT balance...");
        await getUSDTBalance();

        console.log(" Approving USDT transfer...");
        await approveUSDT(uniswapV2RouterAddress, parseUnits("1", 6));

        console.log(" Swapping USDT for ETH...");
        await swapUSDTForETH();

        console.log(" Fetching final balance...");
        await getBalance(account.address);
    } catch (error) {
        console.error(" Error executing swap:", error);
    }
}

executeSwap();