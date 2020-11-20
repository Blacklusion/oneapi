/**
 *
 *                                             OneApi
 *                                      © 2020 Blacklusion
 *
 *  This worker (worker-sync.js) allows to update the Api List stored in the Cloudflare KV by accessing the Validationcore Api
 *  Additionally a worker is needed, which handles the user requests (worker-oneapi.js)
 */

/**
 * Settings
 */

// Contains all countryCodes and the according Load Balancing zone (hardcoded to avoid unnecessary Api requests)
// 0 = Europe -> Are not contained in map. Default case = Europe
// 1 = Americas
// 2 = Asia
// prettier-ignore
const countryMap = new Map([['AF', 2],['AS', 2],['AI', 1],['AG', 1],['AR', 1],['AM', 2],['AW', 1],['AU', 2],['AZ', 2],['BS', 1],['BH', 2],['BD', 2],['BB', 1],['BZ', 1],['BM', 1],['BT', 2],['BO', 1],['BQ', 1],['BV', 1],['BR', 1],['BN', 2],['KH', 2],['CA', 1],['KY', 1],['CL', 1],['CN', 2],['CX', 2],['CC', 2],['CO', 1],['CK', 2],['CR', 1],['CU', 1],['CW', 1],['CY', 2],['DM', 1],['DO', 1],['EC', 1],['SV', 1],['FK', 1],['FJ', 2],['GF', 1],['PF', 2],['GE', 2],['GL', 1],['GD', 1],['GP', 1],['GU', 2],['GT', 1],['GY', 1],['HT', 1],['HM', 2],['HN', 1],['HK', 2],['IN', 2],['ID', 2],['IR', 2],['IQ', 2],['IL', 2],['JM', 1],['JP', 2],['JO', 2],['KZ', 2],['KI', 2],['KP', 2],['KR', 2],['KW', 2],['KG', 2],['LA', 2],['LB', 2],['MO', 2],['MY', 2],['MV', 2],['MH', 2],['MQ', 1],['MX', 1],['FM', 2],['MN', 2],['MS', 1],['MM', 2],['NR', 2],['NP', 2],['NC', 2],['NZ', 2],['NI', 1],['NU', 2],['NF', 2],['MP', 2],['OM', 2],['PK', 2],['PW', 2],['PS', 2],['PA', 1],['PG', 2],['PY', 1],['PE', 1],['PH', 2],['PN', 2],['PR', 1],['QA', 2],['BL', 1],['KN', 1],['LC', 1],['MF', 1],['PM', 1],['VC', 1],['WS', 2],['SA', 2],['SG', 2],['SX', 1],['SB', 2],['GS', 1],['LK', 2],['SR', 1],['SY', 2],['TW', 2],['TJ', 2],['TH', 2],['TL', 2],['TK', 2],['TO', 2],['TT', 1],['TR', 2],['TM', 2],['TC', 1],['TV', 2],['AE', 2],['US', 1],['UM', 2],['UY', 1],['UZ', 2],['VU', 2],['VE', 1],['VN', 2],['VG', 1],['VI', 1],['WF', 2],['YE', 2]])

// Token needed to identify for the private validationcore Api
// Note: The following variables must be set as environment variables in the Cloudflare workers settings
const authToken = AUTHTOKEN;

// Url of the private validationcore Api
const apiUrl = APIURL;

// The validationcore will consider all validations between now() and now() - timeOffset
// only if all validations for an endpoint are ok, the endpoint is considered healthy
// e.g. if set to 30min, the past 3 validations have to be successful (assuming every 10mins a validation is performed)
const timeOffsetMs = typeof TIMEOFFSETMS === "string" ? Number.parseFloat(TIMEOFFSETMS) : TIMEOFFSETMS;

// Determines if endpoints for mainnet or testnet will be requested
// When deploying OneApi for multiple chains (e.g. Mainnet & Testnet), there should be a separate sync-worker for each chain
// Note: Setting isMainnet is not enough. The KV namespace Bindings have to be set as well in the cloudflare worker settings
const isMainnet = typeof ISMAINNET === "string" ? ISMAINNET === "true" : ISMAINNET;

// If set to true only https endpoints will be requested (recommended). If Set t false only http endpoints will be requested
const isSSL = typeof ISSSL === "string" ? ISSSL === "true" : ISSSL;

/**
 * Triggered through cron triggers in cloudflare settings
 */
addEventListener("scheduled", (event) => {
  event.waitUntil(handleSchedule());
});

/**
 * Performs multiple requests to the private validationcore Api and updates the ApiList stored in the KV Storage
 * @return {Promise<void>}
 */
async function handleSchedule() {
  let apiJson = {};
  /**
   * Fetch chain api endpoints
   */
  apiJson = await addEndpointsToJson(apiJson, await getApiEndpointsFromValidationcore("chain"), "a");

  /**
   * Fetch history api endpoints
   */
  apiJson = await addEndpointsToJson(apiJson, await getApiEndpointsFromValidationcore("history"), "b");

  /**
   * Fetch hyperion api endpoints
   */
  apiJson = await addEndpointsToJson(apiJson, await getApiEndpointsFromValidationcore("hyperion"), "c");

  /**
   * Fetch wallet api endpoints
   */
  apiJson = await addEndpointsToJson(apiJson, await getApiEndpointsFromValidationcore("wallet"), "d");

  /**
   * Write all endpoints to Cloudflare KV storage
   */
  await api_endpoints
    .put("all", JSON.stringify(apiJson))
    .then(() => console.log("Updated ApiList in KV Storage"))
    .catch((e) => {
      console.error("Error while writing Api Endpoints to KV", e);
    });
}

/**
 * Sends a request to the validationcore Api and returns a json formatted string with a lit of endpoints and their geographical region
 * @param {string} apiType = type of requested features (currently supported: chain, wallet, history, hyperion)
 * @return {Promise<string|undefined>} = json formatted string with endpoints and their geographical region or undefined
 */
async function getApiEndpointsFromValidationcore(apiType) {
  try {
    const response = await fetch(apiUrl, {
      body: JSON.stringify({
        "auth-token": authToken,
        "time-offset-ms": timeOffsetMs,
        "api-type": apiType,
        "is-mainnet": isMainnet,
        "is-ssl": isSSL,
      }),
      method: "POST",
      headers: { "content-type": "application/json" },
    });

    // Check if Response was successful / Catch Http errors
    if (response.ok) {
      return response.text();
    } else {
      if (response.status !== 404) {
        console.log(
          "Error while requesting Api List from validationcore Api: " + response.status + " " + response.statusText
        );
      }
      return undefined;
    }
  } catch (e) {
    // Catch DNS and other non Http errors
    console.log("Connection to validationcore api " + apiUrl + " was not possible:", e);
    return undefined;
  }
}

/**
 * Parses an endpointsAsJson as returned from the validationcore Api to an ApiList Array
 * @param {string} endpointsAsJson = json formatted string (cannot be an JsonObject)
 * @param {number} apiType = describing the apiType, must match numbers in routeMap in worker-oneapi.js
 * @return {Promise<[]|undefined>}
 */
async function addEndpointsToJson(json, endpointsAsJson, apiType) {
  if (endpointsAsJson === undefined) {
    return json;
  }

  // Parse string to JsonObject
  let endpointJson;
  try {
    endpointJson = JSON.parse(endpointsAsJson);
  } catch (e) {
    console.error("Error while parsing JSON ", e);
    return json;
  }

  // First create a Map to group all apiEndpoints in the same zone as an array
  const apiMap = new Map();
  for (var apiUrl of Object.keys(endpointJson)) {
    let loadBalancingRegion = countryMap.get(endpointJson[apiUrl]);
    if (loadBalancingRegion === undefined) loadBalancingRegion = 0;
    const key = apiType + "" + loadBalancingRegion;

    if (apiMap.has(key)) {
      const values = apiMap.get(key);
      values.push(apiUrl);
      apiMap.set(key, values);
    } else {
      apiMap.set(key, [apiUrl]);
    }
  }

  // Write all new Key Value pairs to json
  apiMap.forEach((value, key) => {
    json[key] = value;
  });
  return json;
}
