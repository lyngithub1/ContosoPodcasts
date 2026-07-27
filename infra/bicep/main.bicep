// =============================================================================
// Azure Scientific Podcast Studio — infrastructure (resource-group scope)
// -----------------------------------------------------------------------------
// Deploys the platform described in the spec (§5): storage with 9 artifact
// containers, Cosmos DB for workflow/audit metadata, Azure AI Speech, Azure AI
// Search, Key Vault, Service Bus, App Insights/Log Analytics, a Container Apps
// API host, API Management as the façade, and a Static Web App for the SPA.
//
// Security posture: a single user-assigned managed identity is granted least-
// privilege data-plane roles via RBAC. No account keys or connection strings are
// emitted as outputs; secrets that cannot use managed identity go to Key Vault.
// =============================================================================

targetScope = 'resourceGroup'

@minLength(3)
@maxLength(16)
@description('Short lowercase prefix used to derive resource names, e.g. "podstudio".')
param namePrefix string = 'podstudio'

@description('Azure region for all resources. Defaults to the resource group location.')
param location string = resourceGroup().location

@description('Azure region for Cosmos DB. Defaults to the primary location; override when the primary region is capacity-constrained for new Cosmos accounts.')
param cosmosLocation string = location

@description('Azure region for the compute tier (Container Apps environment + app and API Management). Defaults to the primary location; override when the primary region is capacity-constrained (e.g. Container Apps/AKS heavy usage).')
param computeLocation string = location

@description('Deployment environment moniker (dev/test/prod). Drives SKUs.')
@allowed(['dev', 'test', 'prod'])
param environment string = 'dev'

@description('Publisher email for API Management (required by the service).')
param apimPublisherEmail string = 'platform@contoso-lifesciences.example'

@description('Publisher/organization name for API Management.')
param apimPublisherName string = 'Contoso Life Sciences'

@description('Object ID (Entra) of an admin group granted Key Vault + data access for operations. Optional.')
param adminPrincipalId string = ''

@description('Container image for the domain API. Defaults to a placeholder; CI/CD or az containerapp update swaps in the real image.')
param apiImage string = 'mcr.microsoft.com/k8se/quickstart:latest'

@description('Allowed CORS origins for the API (comma-separated, or * for any).')
param corsOrigins string = '*'

@description('Deploy private endpoints and disable public network access on Storage, Key Vault, AI Search, and Document Intelligence. Set false only for a public sandbox.')
param usePrivateEndpoints bool = true

var tags = {
  application: 'azure-scientific-podcast-studio'
  environment: environment
  managedBy: 'bicep'
}

// A short, stable, globally-unique-ish token for names that must be global.
var token = toLower(uniqueString(subscription().id, resourceGroup().id, namePrefix))
var isProd = environment == 'prod'

// ---------------------------------------------------------------------------
// Identity + observability
// ---------------------------------------------------------------------------
module identity 'modules/identity.bicep' = {
  name: 'identity'
  params: {
    name: '${namePrefix}-id'
    location: location
    tags: tags
  }
}

module monitoring 'modules/monitoring.bicep' = {
  name: 'monitoring'
  params: {
    logAnalyticsName: '${namePrefix}-law'
    appInsightsName: '${namePrefix}-appi'
    location: location
    tags: tags
  }
}

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------
module keyVault 'modules/keyvault.bicep' = {
  name: 'keyvault'
  params: {
    name: 'kv-${token}'
    location: computeLocation
    tags: tags
    principalId: identity.outputs.principalId
    adminPrincipalId: adminPrincipalId
    usePrivateEndpoint: usePrivateEndpoints
  }
}

// ---------------------------------------------------------------------------
// Storage (9 artifact containers, private, versioned)
// ---------------------------------------------------------------------------
module storage 'modules/storage.bicep' = {
  name: 'storage'
  params: {
    name: 'st${token}'
    location: computeLocation
    tags: tags
    principalId: identity.outputs.principalId
    isProd: isProd
    usePrivateEndpoint: usePrivateEndpoints
  }
}

// ---------------------------------------------------------------------------
// Private networking (VNet + Cosmos private endpoint + DNS)
// ---------------------------------------------------------------------------
// Corporate policy force-disables Cosmos public network access, so the API must
// reach Cosmos privately. The VNet, Container Apps environment, and Cosmos
// account share the compute region for the private endpoint to bind.
module network 'modules/network.bicep' = {
  name: 'network'
  params: {
    name: '${namePrefix}-vnet'
    location: computeLocation
    tags: tags
  }
}

// ---------------------------------------------------------------------------
// Metadata store (Cosmos DB, serverless SQL API)
// ---------------------------------------------------------------------------
module cosmos 'modules/cosmos.bicep' = {
  name: 'cosmos'
  params: {
    name: 'cosmos-${token}'
    location: cosmosLocation
    tags: tags
    principalId: identity.outputs.principalId
    peSubnetId: network.outputs.peSubnetId
    cosmosPrivateDnsZoneId: network.outputs.cosmosDnsZoneId
  }
}

// ---------------------------------------------------------------------------
// Speech + Search
// ---------------------------------------------------------------------------
module speech 'modules/speech.bicep' = {
  name: 'speech'
  params: {
    name: '${namePrefix}-speech-${token}'
    location: location
    tags: tags
    principalId: identity.outputs.principalId
  }
}

module search 'modules/search.bicep' = {
  name: 'search'
  params: {
    name: '${namePrefix}-search-${token}'
    location: computeLocation
    tags: tags
    principalId: identity.outputs.principalId
    isProd: isProd
    usePrivateEndpoint: usePrivateEndpoints
  }
}

// Document Intelligence (prebuilt-read) extracts text from uploaded research
// documents before they are indexed into AI Search.
module docIntel 'modules/docintel.bicep' = {
  name: 'docintel'
  params: {
    name: '${namePrefix}-docintel-${token}'
    location: computeLocation
    tags: tags
    principalId: identity.outputs.principalId
    usePrivateEndpoint: usePrivateEndpoints
  }
}

// ---------------------------------------------------------------------------
// Private endpoints
// ---------------------------------------------------------------------------
// Cosmos declares its own private endpoint inside modules/cosmos.bicep (it is
// mandatory there because corporate policy force-disables public access). The
// rest are declared here against the shared privateEndpoint module.
//
// Speech is deliberately absent: its TTS/STT data plane rejected a cross-region
// private endpoint (403 "Traffic is not from an approved private endpoint"), so
// it keeps public network access with AAD/RBAC and no keys. Co-locating Speech
// with this VNet in one region is the production fix.
module storagePrivateEndpoint 'modules/privateEndpoint.bicep' = if (usePrivateEndpoints) {
  name: 'pe-storage-blob'
  params: {
    name: 'pe-${storage.outputs.name}-blob'
    location: computeLocation
    tags: tags
    subnetId: network.outputs.peSubnetId
    targetResourceId: storage.outputs.id
    groupId: 'blob'
    privateDnsZoneId: network.outputs.blobDnsZoneId
  }
}

module keyVaultPrivateEndpoint 'modules/privateEndpoint.bicep' = if (usePrivateEndpoints) {
  name: 'pe-keyvault'
  params: {
    name: 'pe-${keyVault.outputs.name}'
    location: computeLocation
    tags: tags
    subnetId: network.outputs.peSubnetId
    targetResourceId: keyVault.outputs.id
    groupId: 'vault'
    privateDnsZoneId: network.outputs.keyVaultDnsZoneId
  }
}

module searchPrivateEndpoint 'modules/privateEndpoint.bicep' = if (usePrivateEndpoints) {
  name: 'pe-search'
  params: {
    name: 'pe-${search.outputs.name}'
    location: computeLocation
    tags: tags
    subnetId: network.outputs.peSubnetId
    targetResourceId: search.outputs.id
    groupId: 'searchService'
    privateDnsZoneId: network.outputs.searchDnsZoneId
  }
}

module docIntelPrivateEndpoint 'modules/privateEndpoint.bicep' = if (usePrivateEndpoints) {
  name: 'pe-docintel'
  params: {
    name: 'pe-${docIntel.outputs.name}'
    location: computeLocation
    tags: tags
    subnetId: network.outputs.peSubnetId
    targetResourceId: docIntel.outputs.id
    groupId: 'account'
    privateDnsZoneId: network.outputs.cognitiveServicesDnsZoneId
  }
}

// ---------------------------------------------------------------------------
// Messaging (job events)
// ---------------------------------------------------------------------------
module serviceBus 'modules/servicebus.bicep' = {
  name: 'servicebus'
  params: {
    name: '${namePrefix}-sb-${token}'
    location: location
    tags: tags
    principalId: identity.outputs.principalId
  }
}

// ---------------------------------------------------------------------------
// API host (Container Apps) + APIM façade + SPA hosting
// ---------------------------------------------------------------------------
module acr 'modules/acr.bicep' = {
  name: 'acr'
  params: {
    name: 'acr${token}'
    location: computeLocation
    tags: tags
    principalId: identity.outputs.principalId
  }
}

module api 'modules/containerapp.bicep' = {
  name: 'api'
  params: {
    envName: '${namePrefix}-cae'
    appName: '${namePrefix}-api'
    location: computeLocation
    tags: tags
    userAssignedIdentityId: identity.outputs.id
    logAnalyticsCustomerId: monitoring.outputs.logAnalyticsCustomerId
    logAnalyticsKey: monitoring.outputs.logAnalyticsPrimaryKey
    appInsightsConnectionString: monitoring.outputs.appInsightsConnectionString
    speechEndpoint: speech.outputs.endpoint
    speechResourceId: speech.outputs.id
    cosmosEndpoint: cosmos.outputs.endpoint
    cosmosDatabase: cosmos.outputs.databaseName
    storageBlobEndpoint: storage.outputs.blobEndpoint
    searchEndpoint: search.outputs.endpoint
    docIntelEndpoint: docIntel.outputs.endpoint
    serviceBusFqdn: serviceBus.outputs.fqdn
    keyVaultUri: keyVault.outputs.uri
    clientIdEnv: identity.outputs.clientId
    corsOrigins: corsOrigins
    containerImage: apiImage
    registryServer: acr.outputs.loginServer
    infrastructureSubnetId: network.outputs.infraSubnetId
  }
}

module apim 'modules/apim.bicep' = {
  name: 'apim'
  params: {
    name: '${namePrefix}-apim-${token}'
    location: computeLocation
    tags: tags
    publisherEmail: apimPublisherEmail
    publisherName: apimPublisherName
    isProd: isProd
    userAssignedIdentityId: identity.outputs.id
    appInsightsInstrumentationKey: monitoring.outputs.appInsightsInstrumentationKey
    backendUrl: 'https://${api.outputs.fqdn}'
  }
}

module web 'modules/staticwebapp.bicep' = {
  name: 'web'
  params: {
    name: '${namePrefix}-web'
    location: location
    tags: tags
  }
}

// ---------------------------------------------------------------------------
// Outputs (no secrets)
// ---------------------------------------------------------------------------
output managedIdentityClientId string = identity.outputs.clientId
output storageAccountName string = storage.outputs.name
output blobEndpoint string = storage.outputs.blobEndpoint
output cosmosEndpoint string = cosmos.outputs.endpoint
output speechEndpoint string = speech.outputs.endpoint
output searchEndpoint string = search.outputs.endpoint
output docIntelEndpoint string = docIntel.outputs.endpoint
output keyVaultUri string = keyVault.outputs.uri
output apiFqdn string = api.outputs.fqdn
output apimGatewayUrl string = apim.outputs.gatewayUrl
output staticWebAppHostname string = web.outputs.defaultHostname
output appInsightsConnectionString string = monitoring.outputs.appInsightsConnectionString
output containerRegistryLoginServer string = acr.outputs.loginServer
output containerRegistryName string = acr.outputs.name
