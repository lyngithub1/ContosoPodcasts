// Azure Cosmos DB (serverless, SQL API) for projects, workflow state, reviews,
// recipients, and audit metadata (§5 Data). Local-auth disabled — the platform
// identity is granted the built-in data-plane contributor role.

@description('Cosmos DB account name (globally unique, lowercase).')
@maxLength(44)
param name string

@description('Location.')
param location string

@description('Resource tags.')
param tags object

@description('Principal ID of the platform managed identity (data-plane).')
param principalId string

@description('Resource ID of the private-endpoint subnet. When set, a private endpoint is created and public access stays disabled.')
param peSubnetId string = ''

@description('Resource ID of the privatelink.documents.azure.com private DNS zone. Required to auto-register the private endpoint A records.')
param cosmosPrivateDnsZoneId string = ''

var databaseName = 'podcaststudio'

var containers = [
  { id: 'projects', pk: '/id' }
  { id: 'scripts', pk: '/projectId' }
  { id: 'evidence', pk: '/projectId' }
  { id: 'reviews', pk: '/projectId' }
  { id: 'recipients', pk: '/id' }
  { id: 'auditEvents', pk: '/projectId' }
  { id: 'pronunciations', pk: '/locale' }
  { id: 'researchPlans', pk: '/projectId' }
  { id: 'sources', pk: '/projectId' }
  { id: 'claims', pk: '/projectId' }
  { id: 'structuredEvidence', pk: '/projectId' }
  { id: 'synthesisJobs', pk: '/projectId' }
  { id: 'audioVersions', pk: '/projectId' }
  { id: 'qualityReports', pk: '/projectId' }
  { id: 'distributionLists', pk: '/id' }
  { id: 'publications', pk: '/projectId' }
  { id: 'deliveryReceipts', pk: '/publicationId' }
  { id: 'voiceProfiles', pk: '/id' }
  { id: 'scriptTemplates', pk: '/id' }
]

resource account 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' = {
  name: name
  location: location
  tags: tags
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    disableLocalAuth: true
    enableAutomaticFailover: false
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    locations: [
      {
        locationName: location
        failoverPriority: 0
        isZoneRedundant: false
      }
    ]
    capabilities: [
      {
        name: 'EnableServerless'
      }
    ]
    backupPolicy: {
      type: 'Continuous'
      continuousModeProperties: {
        tier: 'Continuous7Days'
      }
    }
    minimalTlsVersion: 'Tls12'
    // Public network access is force-disabled by corporate Azure Policy
    // (MCAPSGovDeployPolicies -> CosmosDB_PublicNetwork_Modify). The Container
    // Apps API reaches this account over the private endpoint below; setting
    // 'Disabled' here keeps the template in sync with the enforced posture.
    publicNetworkAccess: 'Disabled'
  }
}

// Private endpoint (SQL API) so the VNet-integrated Container Apps environment
// can reach Cosmos while public access remains disabled.
resource privateEndpoint 'Microsoft.Network/privateEndpoints@2023-11-01' = if (!empty(peSubnetId)) {
  name: 'pe-${name}'
  location: location
  tags: tags
  properties: {
    subnet: {
      id: peSubnetId
    }
    privateLinkServiceConnections: [
      {
        name: 'pe-${name}-conn'
        properties: {
          privateLinkServiceId: account.id
          groupIds: ['Sql']
        }
      }
    ]
  }
}

resource privateEndpointDns 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2023-11-01' = if (!empty(peSubnetId) && !empty(cosmosPrivateDnsZoneId)) {
  parent: privateEndpoint
  name: 'zg-cosmos'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'documents'
        properties: {
          privateDnsZoneId: cosmosPrivateDnsZoneId
        }
      }
    ]
  }
}

resource database 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15' = {
  parent: account
  name: databaseName
  properties: {
    resource: {
      id: databaseName
    }
  }
}

resource sqlContainers 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = [
  for c in containers: {
    parent: database
    name: c.id
    properties: {
      resource: {
        id: c.id
        partitionKey: {
          paths: [c.pk]
          kind: 'Hash'
        }
      }
    }
  }
]

// Built-in "Cosmos DB Built-in Data Contributor" data-plane role definition.
resource dataContributorAssignment 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-05-15' = {
  parent: account
  name: guid(account.id, principalId, 'data-contributor')
  properties: {
    roleDefinitionId: '${account.id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002'
    principalId: principalId
    scope: account.id
  }
}

output id string = account.id
output name string = account.name
output endpoint string = account.properties.documentEndpoint
output databaseName string = databaseName
