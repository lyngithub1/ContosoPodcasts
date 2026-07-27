// Azure API Management as the API façade (§5). Developer SKU for non-prod,
// StandardV2 for prod. Uses the platform managed identity and wires App
// Insights. A single API is provisioned pointing at the Container Apps backend.

@description('API Management service name (globally unique).')
@maxLength(50)
param name string

@description('Location.')
param location string

@description('Resource tags.')
param tags object

@description('Publisher email (required).')
param publisherEmail string

@description('Publisher/organization name.')
param publisherName string

@description('Prod uses StandardV2; non-prod uses Developer.')
param isProd bool = false

@description('Resource ID of the user-assigned managed identity.')
param userAssignedIdentityId string

@description('Application Insights instrumentation key for APIM diagnostics.')
param appInsightsInstrumentationKey string

@description('Backend base URL (Container Apps API).')
param backendUrl string

resource apim 'Microsoft.ApiManagement/service@2023-05-01-preview' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: isProd ? 'StandardV2' : 'Developer'
    capacity: 1
  }
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${userAssignedIdentityId}': {}
    }
  }
  properties: {
    publisherEmail: publisherEmail
    publisherName: publisherName
  }
}

resource apimLogger 'Microsoft.ApiManagement/service/loggers@2023-05-01-preview' = {
  parent: apim
  name: 'appinsights'
  properties: {
    loggerType: 'applicationInsights'
    resourceId: null
    credentials: {
      instrumentationKey: appInsightsInstrumentationKey
    }
  }
}

resource api 'Microsoft.ApiManagement/service/apis@2023-05-01-preview' = {
  parent: apim
  name: 'studio-api'
  properties: {
    displayName: 'Podcast Studio API'
    path: 'studio'
    protocols: ['https']
    subscriptionRequired: true
    serviceUrl: backendUrl
  }
}

// Wildcard pass-through operations so every backend route (/healthz, /api/*)
// is reachable through the façade without enumerating each endpoint.
var passthroughMethods = ['GET', 'POST', 'DELETE']
resource apiOperations 'Microsoft.ApiManagement/service/apis/operations@2023-05-01-preview' = [
  for m in passthroughMethods: {
    parent: api
    name: '${toLower(m)}-all'
    properties: {
      displayName: '${m} (all)'
      method: m
      urlTemplate: '/*'
      templateParameters: []
      responses: []
    }
  }
]

output id string = apim.id
output name string = apim.name
output gatewayUrl string = apim.properties.gatewayUrl
