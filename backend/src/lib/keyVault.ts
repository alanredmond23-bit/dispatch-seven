// Azure Key Vault client — menagerie-kv-37040
// Uses DefaultAzureCredential (managed identity in ACA, env vars locally)
// NEVER hardcode secrets — always pull from vault

import { SecretClient } from "@azure/keyvault-secrets";
import { DefaultAzureCredential } from "@azure/identity";

const vaultUri = process.env.AZURE_KEY_VAULT_URI || "https://menagerie-kv-37040.vault.azure.net";
const credential = new DefaultAzureCredential();
const client = new SecretClient(vaultUri, credential);

export async function getSecret(name: string): Promise<string> {
  const secret = await client.getSecret(name);
  if (!secret.value) throw new Error(`Secret ${name} is empty in Key Vault`);
  return secret.value;
}

// Pre-fetch critical secrets at boot — fail fast if missing
export async function loadSecrets(): Promise<void> {
  const required = ["VOYAGE-API-KEY", "ANTHROPIC-API-KEY"];
  await Promise.all(required.map(getSecret));
  console.log("Key Vault: all required secrets loaded");
}
