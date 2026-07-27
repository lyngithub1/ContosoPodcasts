using './main.bicep'

param namePrefix = 'podstudio'
param environment = 'dev'
// Cosmos and the compute tier (Container Apps + APIM) run in France Central because this
// subscription lacks Cosmos region access in West/North Europe and hit Container Apps capacity
// limits there. The stateless/data services stay in the primary location (West Europe).
param cosmosLocation = 'francecentral'
param computeLocation = 'francecentral'
param apimPublisherEmail = 'platform@contoso-lifesciences.example'
param apimPublisherName = 'Contoso Life Sciences'
// Optional: set to an Entra group/user object id to grant Key Vault admin access.
param adminPrincipalId = ''
