# Azure Container Apps Deploy

## One-time setup
az containerapp create \
  --name dispatch7-backend \
  --resource-group menagerie-rg \
  --environment dispatch7-env \
  --image mcr.microsoft.com/azuredocs/containerapps-helloworld:latest \
  --target-port 3000 \
  --ingress external \
  --min-replicas 1 \
  --max-replicas 10

## GitHub Actions secrets needed
- AZURE_CREDENTIALS: output of `az ad sp create-for-rbac --role contributor --scope /subscriptions/{id}/resourceGroups/menagerie-rg`
- ACR_NAME: your Azure Container Registry name (check menagerie-rg)
