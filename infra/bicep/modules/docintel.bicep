// Azure AI Document Intelligence (Cognitive Services, kind FormRecognizer) used
// by the research-ingestion path: `prebuilt-read` extracts text from uploaded
// PDFs, images, and office documents before it is indexed into AI Search.
//
// Key-based auth is disabled; the platform identity is granted Cognitive
// Services User via RBAC. A custom subdomain is required for AAD token auth.
// Public network access is disabled when a private endpoint is wired up in
// main.bicep (the account is then reachable only from the VNet).

@description('Document Intelligence account name.')
@maxLength(64)
param name string

@description('Location.')
param location string

@description('Resource tags.')
param tags object

@description('Principal ID of the platform managed identity.')
param principalId string

@description('Set false to keep the account publicly reachable (AAD-only) when no private endpoint is deployed.')
param usePrivateEndpoint bool = true

var cognitiveServicesUserRoleId = 'a97b65f3-24c7-4388-baec-2e87135dc908'

resource docIntel 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: name
  location: location
  tags: tags
  kind: 'FormRecognizer'
  sku: {
    name: 'S0'
  }
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    // Required for AAD/managed-identity authentication.
    customSubDomainName: name
    disableLocalAuth: true
    publicNetworkAccess: usePrivateEndpoint ? 'Disabled' : 'Enabled'
    networkAcls: {
      defaultAction: usePrivateEndpoint ? 'Deny' : 'Allow'
    }
  }
}

resource docIntelUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(docIntel.id, principalId, cognitiveServicesUserRoleId)
  scope: docIntel
  properties: {
    principalId: principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', cognitiveServicesUserRoleId)
  }
}

output id string = docIntel.id
output name string = docIntel.name
output endpoint string = docIntel.properties.endpoint
