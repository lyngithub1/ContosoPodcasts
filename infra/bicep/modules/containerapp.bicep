// Azure Container Apps environment + domain API app (§5 API and orchestration).
// Uses the user-assigned managed identity for all service-to-service auth; the
// SPA never receives credentials. Ships with a placeholder image — CI/CD swaps
// in the real API image. Endpoints are passed as configuration, not secrets.

@description('Container Apps managed environment name.')
param envName string

@description('Container app (API) name.')
param appName string

@description('Location.')
param location string

@description('Resource tags.')
param tags object

@description('Resource ID of the user-assigned managed identity.')
param userAssignedIdentityId string

@description('Log Analytics workspace customer/GUID id.')
param logAnalyticsCustomerId string

@description('Log Analytics shared key.')
@secure()
param logAnalyticsKey string

@description('Application Insights connection string.')
param appInsightsConnectionString string

param speechEndpoint string
param cosmosEndpoint string
param storageBlobEndpoint string
param searchEndpoint string
param docIntelEndpoint string = ''
param serviceBusFqdn string
param keyVaultUri string
param clientIdEnv string

@description('Full resource ID of the Azure AI Speech account (for Entra TTS auth).')
param speechResourceId string

@description('Cosmos SQL database name.')
param cosmosDatabase string = 'podcaststudio'

@description('Allowed CORS origins for the API (comma-separated, or * for any).')
param corsOrigins string = '*'

@description('Container image reference for the API.')
param containerImage string = 'mcr.microsoft.com/k8se/quickstart:latest'

@description('ACR login server for identity-based pulls. Empty for public images.')
param registryServer string = ''

@description('Resource ID of the delegated infrastructure subnet for VNet integration. Empty for a non-VNet (Consumption-only) environment.')
param infrastructureSubnetId string = ''

var registries = empty(registryServer) ? [] : [
  {
    server: registryServer
    identity: userAssignedIdentityId
  }
]

// When a subnet is supplied, create a VNet-integrated workload-profiles
// environment so the app can reach private endpoints (e.g. Cosmos).
var vnetConfig = empty(infrastructureSubnetId)
  ? {}
  : {
      vnetConfiguration: {
        infrastructureSubnetId: infrastructureSubnetId
        internal: false
      }
      workloadProfiles: [
        {
          name: 'Consumption'
          workloadProfileType: 'Consumption'
        }
      ]
    }

resource environment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: envName
  location: location
  tags: tags
  properties: union({
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalyticsCustomerId
        sharedKey: logAnalyticsKey
      }
    }
    zoneRedundant: false
  }, vnetConfig)
}

resource api 'Microsoft.App/containerApps@2024-03-01' = {
  name: appName
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${userAssignedIdentityId}': {}
    }
  }
  properties: union({
    managedEnvironmentId: environment.id
    configuration: {
      activeRevisionsMode: 'Single'
      registries: registries
      ingress: {
        external: true
        targetPort: 8080
        transport: 'auto'
        allowInsecure: false
      }
    }
    template: {
      containers: [
        {
          name: 'api'
          image: containerImage
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            { name: 'AZURE_CLIENT_ID', value: clientIdEnv }
            { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsightsConnectionString }
            { name: 'SPEECH_ENDPOINT', value: speechEndpoint }
            { name: 'SPEECH_RESOURCE_ID', value: speechResourceId }
            { name: 'COSMOS_ENDPOINT', value: cosmosEndpoint }
            { name: 'COSMOS_DATABASE', value: cosmosDatabase }
            { name: 'STORAGE_BLOB_ENDPOINT', value: storageBlobEndpoint }
            { name: 'SEARCH_ENDPOINT', value: searchEndpoint }
            { name: 'DOCINTEL_ENDPOINT', value: docIntelEndpoint }
            { name: 'SERVICEBUS_FQDN', value: serviceBusFqdn }
            { name: 'KEYVAULT_URI', value: keyVaultUri }
            { name: 'CORS_ORIGINS', value: corsOrigins }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 5
        rules: [
          {
            name: 'http-scale'
            http: {
              metadata: {
                concurrentRequests: '50'
              }
            }
          }
        ]
      }
    }
  }, empty(infrastructureSubnetId) ? {} : { workloadProfileName: 'Consumption' })
}

output id string = api.id
output name string = api.name
output fqdn string = api.properties.configuration.ingress.fqdn
