#!/bin/bash
# D7 Key Vault setup — menagerie-kv-37040
# Run from WORKHORSE after: az login

set -e
VAULT="menagerie-kv-37040"
RG="menagerie-rg"

echo "Setting D7 secrets in $VAULT..."

# Load from local .env.local (NEVER commit)
source .env.local

az keyvault secret set --vault-name $VAULT --name "VOYAGE-API-KEY" --value "$VOYAGE_API_KEY"
az keyvault secret set --vault-name $VAULT --name "ANTHROPIC-API-KEY" --value "$ANTHROPIC_API_KEY"
az keyvault secret set --vault-name $VAULT --name "ANTHROPIC-API-KEY-B" --value "$ANTHROPIC_API_KEY_B"
az keyvault secret set --vault-name $VAULT --name "ANTHROPIC-API-KEY-C" --value "$ANTHROPIC_API_KEY_C"
az keyvault secret set --vault-name $VAULT --name "DEEPGRAM-API-KEY" --value "$DEEPGRAM_API_KEY"
az keyvault secret set --vault-name $VAULT --name "ASSEMBLYAI-API-KEY" --value "$ASSEMBLYAI_API_KEY"
az keyvault secret set --vault-name $VAULT --name "SUPABASE-SERVICE-ROLE" --value "$SUPABASE_SERVICE_ROLE"

echo "Done. Verify with:"
echo "  az keyvault secret list --vault-name $VAULT --query '[].name' -o tsv"
