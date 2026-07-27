// Azure Storage: 9 private artifact containers (§4.10), blob versioning,
// soft delete, TLS 1.2, no public blob access, no shared-key preference.
// The platform identity is granted Storage Blob Data Contributor via RBAC.

@description('Storage account name (globally unique, 3-24 lowercase alphanumerics).')
@maxLength(24)
param name string

@description('Location.')
param location string

@description('Resource tags.')
param tags object

@description('Principal ID of the platform managed identity.')
param principalId string

@description('Prod uses ZRS + longer retention.')
param isProd bool = false

@description('Set false to keep the account publicly reachable when no private endpoint is deployed.')
param usePrivateEndpoint bool = true

var containerNames = [
  'source-quarantine'
  'source-approved'
  'research-extracted'
  'scripts'
  'synthesis-input'
  'audio-preview'
  'audio-approved'
  'publication-assets'
  'audit-exports'
]

var blobDataContributorRoleId = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: isProd ? 'Standard_ZRS' : 'Standard_LRS'
  }
  kind: 'StorageV2'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    accessTier: 'Hot'
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    supportsHttpsTrafficOnly: true
    publicNetworkAccess: usePrivateEndpoint ? 'Disabled' : 'Enabled'
    networkAcls: {
      defaultAction: usePrivateEndpoint ? 'Deny' : 'Allow'
      bypass: 'AzureServices'
    }
    encryption: {
      keySource: 'Microsoft.Storage'
      services: {
        blob: {
          enabled: true
        }
        file: {
          enabled: true
        }
      }
    }
  }
}

resource blobServices 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    isVersioningEnabled: true
    deleteRetentionPolicy: {
      enabled: true
      days: isProd ? 30 : 7
    }
    containerDeleteRetentionPolicy: {
      enabled: true
      days: isProd ? 30 : 7
    }
  }
}

resource containers 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = [
  for c in containerNames: {
    parent: blobServices
    name: c
    properties: {
      publicAccess: 'None'
    }
  }
]

// Lifecycle rules: quarantine expires quickly, previews tier to cool then expire.
resource lifecycle 'Microsoft.Storage/storageAccounts/managementPolicies@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    policy: {
      rules: [
        {
          name: 'expire-quarantine'
          enabled: true
          type: 'Lifecycle'
          definition: {
            filters: {
              blobTypes: ['blockBlob']
              prefixMatch: ['source-quarantine/']
            }
            actions: {
              baseBlob: {
                delete: {
                  daysAfterCreationGreaterThan: 7
                }
              }
            }
          }
        }
        {
          name: 'cool-audio-preview'
          enabled: true
          type: 'Lifecycle'
          definition: {
            filters: {
              blobTypes: ['blockBlob']
              prefixMatch: ['audio-preview/']
            }
            actions: {
              baseBlob: {
                tierToCool: {
                  daysAfterModificationGreaterThan: 30
                }
                delete: {
                  daysAfterModificationGreaterThan: 180
                }
              }
            }
          }
        }
      ]
    }
  }
}

resource blobDataContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, principalId, blobDataContributorRoleId)
  scope: storage
  properties: {
    principalId: principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', blobDataContributorRoleId)
  }
}

output id string = storage.id
output name string = storage.name
output blobEndpoint string = storage.properties.primaryEndpoints.blob
