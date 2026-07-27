// Azure Static Web App to host the React SPA (§5 Frontend). Deployment content
// is pushed by CI/CD; this provisions the resource only. MSAL/Entra auth is
// configured in application settings post-deploy — no secrets in the template.

@description('Static Web App name.')
param name string

@description('Location (Static Web Apps have limited regions).')
param location string = 'westeurope'

@description('Resource tags.')
param tags object

resource swa 'Microsoft.Web/staticSites@2023-12-01' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: 'Standard'
    tier: 'Standard'
  }
  properties: {
    allowConfigFileUpdates: true
  }
}

output id string = swa.id
output name string = swa.name
output defaultHostname string = swa.properties.defaultHostname
