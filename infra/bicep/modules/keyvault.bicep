// Key Vault (RBAC authorization) for secrets that cannot use managed identity
// (e.g. third-party podcast-host API keys). The platform identity gets
// Key Vault Secrets User; an optional admin principal gets Secrets Officer.

@description('Key Vault name (globally unique, 3-24 chars).')
@maxLength(24)
param name string

@description('Location.')
param location string

@description('Resource tags.')
param tags object

@description('Principal ID of the platform managed identity (Secrets User).')
param principalId string

@description('Optional admin principal (Secrets Officer). Empty to skip.')
param adminPrincipalId string = ''

@description('Set false to keep the vault publicly reachable when no private endpoint is deployed.')
param usePrivateEndpoint bool = true

// Built-in role definition IDs
var secretsUserRoleId = '4633458b-17de-408a-b874-0445c86b69e6'
var secretsOfficerRoleId = 'b86a8fe4-44ce-4948-aee5-eccb2c155cd7'

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    sku: {
      family: 'A'
      name: 'standard'
    }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    enablePurgeProtection: true
    publicNetworkAccess: usePrivateEndpoint ? 'Disabled' : 'Enabled'
    networkAcls: {
      defaultAction: usePrivateEndpoint ? 'Deny' : 'Allow'
      bypass: 'AzureServices'
    }
  }
}

resource secretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, principalId, secretsUserRoleId)
  scope: keyVault
  properties: {
    principalId: principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', secretsUserRoleId)
  }
}

resource secretsOfficer 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(adminPrincipalId)) {
  name: guid(keyVault.id, adminPrincipalId, secretsOfficerRoleId)
  scope: keyVault
  properties: {
    principalId: adminPrincipalId
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', secretsOfficerRoleId)
  }
}

output id string = keyVault.id
output uri string = keyVault.properties.vaultUri
output name string = keyVault.name
