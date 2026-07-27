// Azure AI Search for indexed research passages, hybrid retrieval, and citation
// anchors (§5 AI and research). API keys disabled (RBAC-only); the platform
// identity gets Search Index Data Contributor + Search Service Contributor.

@description('Search service name (globally unique, lowercase).')
@maxLength(60)
param name string

@description('Location.')
param location string

@description('Resource tags.')
param tags object

@description('Principal ID of the platform managed identity.')
param principalId string

@description('Prod uses standard tier + replicas.')
param isProd bool = false

@description('Set false to keep the search service publicly reachable (AAD-only) when no private endpoint is deployed.')
param usePrivateEndpoint bool = true

var indexDataContributorRoleId = '8ebe5a00-799e-43f5-93ac-243d3dce84a7'
var serviceContributorRoleId = '7ca78c08-252a-4471-8644-bb5ff32d4ba0'

resource search 'Microsoft.Search/searchServices@2024-06-01-preview' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: isProd ? 'standard' : 'basic'
  }
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    replicaCount: isProd ? 2 : 1
    partitionCount: 1
    hostingMode: 'default'
    publicNetworkAccess: usePrivateEndpoint ? 'disabled' : 'enabled'
    disableLocalAuth: true
    authOptions: null
    semanticSearch: 'free'
  }
}

resource indexDataContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(search.id, principalId, indexDataContributorRoleId)
  scope: search
  properties: {
    principalId: principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', indexDataContributorRoleId)
  }
}

resource serviceContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(search.id, principalId, serviceContributorRoleId)
  scope: search
  properties: {
    principalId: principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', serviceContributorRoleId)
  }
}

output id string = search.id
output name string = search.name
output endpoint string = 'https://${search.name}.search.windows.net'
