// Azure Container Registry for the domain API image. Admin user disabled — the
// platform managed identity is granted AcrPull and Container Apps pulls with it.

@description('Container registry name (alphanumeric, globally unique).')
@minLength(5)
@maxLength(50)
param name string

@description('Location.')
param location string

@description('Resource tags.')
param tags object

@description('Principal ID of the managed identity granted AcrPull.')
param principalId string

resource registry 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: false
    publicNetworkAccess: 'Enabled'
  }
}

// Built-in AcrPull role.
var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'

resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, principalId, acrPullRoleId)
  scope: registry
  properties: {
    principalId: principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
  }
}

output id string = registry.id
output name string = registry.name
output loginServer string = registry.properties.loginServer
