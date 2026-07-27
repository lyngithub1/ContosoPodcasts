// User-assigned managed identity used by all platform services for
// service-to-service authentication (no keys in source or config).

@description('Managed identity name.')
param name string

@description('Location.')
param location string

@description('Resource tags.')
param tags object

resource uami 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: name
  location: location
  tags: tags
}

output id string = uami.id
output principalId string = uami.properties.principalId
output clientId string = uami.properties.clientId
output name string = uami.name
