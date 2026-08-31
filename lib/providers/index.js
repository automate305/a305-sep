import hostinger from './hostinger.js';
import googleWorkspace from './google-workspace.js';

const providers = {
  hostinger,
  google_workspace: googleWorkspace,
};

export function getProvider(providerName) {
  const provider = providers[providerName];
  if (!provider) {
    throw new Error(`Unknown provider: "${providerName}". Available: ${Object.keys(providers).join(', ')}`);
  }
  return provider;
}
