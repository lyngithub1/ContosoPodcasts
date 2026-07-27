// Service Bus for job events (synthesis, QA, delivery) — §5 API and orchestration.
// Local auth disabled; the platform identity gets Azure Service Bus Data Owner.

@description('Service Bus namespace name (globally unique).')
@maxLength(50)
param name string

@description('Location.')
param location string

@description('Resource tags.')
param tags object

@description('Principal ID of the platform managed identity.')
param principalId string

var dataOwnerRoleId = '090c5cfd-751d-490a-894a-3ce6f1109419'

var queueNames = [
  'synthesis-jobs'
  'qa-jobs'
  'delivery-jobs'
]

resource namespace 'Microsoft.ServiceBus/namespaces@2022-10-01-preview' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: 'Standard'
    tier: 'Standard'
  }
  properties: {
    minimumTlsVersion: '1.2'
    disableLocalAuth: true
    publicNetworkAccess: 'Enabled'
  }
}

resource queues 'Microsoft.ServiceBus/namespaces/queues@2022-10-01-preview' = [
  for q in queueNames: {
    parent: namespace
    name: q
    properties: {
      lockDuration: 'PT5M'
      maxDeliveryCount: 10
      deadLetteringOnMessageExpiration: true
      enablePartitioning: false
    }
  }
]

resource dataOwner 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(namespace.id, principalId, dataOwnerRoleId)
  scope: namespace
  properties: {
    principalId: principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', dataOwnerRoleId)
  }
}

output id string = namespace.id
output name string = namespace.name
output fqdn string = replace(replace(namespace.properties.serviceBusEndpoint, 'https://', ''), ':443/', '')
