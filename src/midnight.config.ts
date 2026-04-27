/**
 * Midnight Network Configuration
 */
export const midnightConfig = {
  // Midnight Network (testnet, devnet, or local)
  network: 'testnet',
  
  // URL of the Midnight Indexer
  indexerUrl: process.env.NEXT_PUBLIC_MIDNIGHT_INDEXER_URL || 'https://indexer.testnet.midnight.network',
  
  // URL of the Proof Server
  proofServerUrl: process.env.NEXT_PUBLIC_MIDNIGHT_PROOF_SERVER_URL || 'http://localhost:6300',
  
  // URL of the Node (for submitting transactions)
  nodeUrl: process.env.NEXT_PUBLIC_MIDNIGHT_NODE_URL || 'https://rpc.testnet.midnight.network',
  
  // YTTM Token Asset ID (placeholder)
  yttmAssetId: process.env.NEXT_PUBLIC_YTTM_ASSET_ID || '0000000000000000000000000000000000000000000000000000000000000000',
};

export default midnightConfig;
