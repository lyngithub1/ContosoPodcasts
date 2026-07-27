// Azure AI Speech (Cognitive Services, kind SpeechServices) for TTS, batch
// synthesis, and speech-to-text QA (§5 Speech). Key-based auth disabled;
// the platform identity is granted Cognitive Services User via RBAC.

@description('Speech account name.')
@maxLength(64)
param name string

@description('Location.')
param location string

@description('Resource tags.')
param tags object

@description('Principal ID of the platform managed identity.')
param principalId string

var cognitiveServicesUserRoleId = 'a97b65f3-24c7-4388-baec-2e87135dc908'

resource speech 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: name
  location: location
  tags: tags
  kind: 'SpeechServices'
  sku: {
    name: 'S0'
  }
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    customSubDomainName: name
    disableLocalAuth: true
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      defaultAction: 'Allow'
    }
  }
}

resource speechUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(speech.id, principalId, cognitiveServicesUserRoleId)
  scope: speech
  properties: {
    principalId: principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', cognitiveServicesUserRoleId)
  }
}

output id string = speech.id
output name string = speech.name
output endpoint string = speech.properties.endpoint
