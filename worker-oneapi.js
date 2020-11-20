/**
 *
 *                                             OneApi
 *                                      © 2020 Blacklusion
 *
 *  This worker (worker-oneapi.js) allows to handle Api Requests by categorizing them and forwarding them to an appropriate endpoint
 *  Additionally a worker is needed, which is adding an updated list of endpoints to the cloudflare KV storage (worker-sync.js)
 */

/**
 * Settings
 */

// Headers that will be used, whenever a request is answered by OneApi and not forwarded to an Api Endpoint (e.g. 404 Route not found)
const headers = {
  server: "oneapi/1.0.0",
  "x-rejected-by": "oneapi",
  "x-service-by": "blacklusionx",
  "Content-Type": "application/json",
  Connection: "keep-alive",
  "Access-Control-Allow-Headers": "Origin, X-Requested-With, Content-Type, Accept",
  "Access-Control-Allow-Origin": "*",
};

// Fetch requests will be aborted after specified amount
const timeoutMs = 2000;

// Maximum amount of requests that will be sent to DIFFERENT Endpoints, before an Error will be returned
const maxRetries = 2;

// Stores all apiEndpoint urls (locally)
// In case a connection to an Api Endpoint fails, it will be removed from the list
// Every worker has its own and independent list. Frequently the lists are synced between the workers
let apiList = new Map();

//
let lastRefreshDate = Date.now();

// Hardcoded list of endpoints, that are used in case no other endpoints are available
const fallback = [];

// Contains all countryCodes and the according Load Balancing zone (hardcoded to avoid unnecessary Api requests)
// 0 = Europe -> Are not contained in map. Default case = Europe
// 1 = Americas
// 2 = Asia
// prettier-ignore
const countryMap = new Map([['AF', 2],['AS', 2],['AI', 1],['AG', 1],['AR', 1],['AM', 2],['AW', 1],['AU', 2],['AZ', 2],['BS', 1],['BH', 2],['BD', 2],['BB', 1],['BZ', 1],['BM', 1],['BT', 2],['BO', 1],['BQ', 1],['BV', 1],['BR', 1],['BN', 2],['KH', 2],['CA', 1],['KY', 1],['CL', 1],['CN', 2],['CX', 2],['CC', 2],['CO', 1],['CK', 2],['CR', 1],['CU', 1],['CW', 1],['CY', 2],['DM', 1],['DO', 1],['EC', 1],['SV', 1],['FK', 1],['FJ', 2],['GF', 1],['PF', 2],['GE', 2],['GL', 1],['GD', 1],['GP', 1],['GU', 2],['GT', 1],['GY', 1],['HT', 1],['HM', 2],['HN', 1],['HK', 2],['IN', 2],['ID', 2],['IR', 2],['IQ', 2],['IL', 2],['JM', 1],['JP', 2],['JO', 2],['KZ', 2],['KI', 2],['KP', 2],['KR', 2],['KW', 2],['KG', 2],['LA', 2],['LB', 2],['MO', 2],['MY', 2],['MV', 2],['MH', 2],['MQ', 1],['MX', 1],['FM', 2],['MN', 2],['MS', 1],['MM', 2],['NR', 2],['NP', 2],['NC', 2],['NZ', 2],['NI', 1],['NU', 2],['NF', 2],['MP', 2],['OM', 2],['PK', 2],['PW', 2],['PS', 2],['PA', 1],['PG', 2],['PY', 1],['PE', 1],['PH', 2],['PN', 2],['PR', 1],['QA', 2],['BL', 1],['KN', 1],['LC', 1],['MF', 1],['PM', 1],['VC', 1],['WS', 2],['SA', 2],['SG', 2],['SX', 1],['SB', 2],['GS', 1],['LK', 2],['SR', 1],['SY', 2],['TW', 2],['TJ', 2],['TH', 2],['TL', 2],['TK', 2],['TO', 2],['TT', 1],['TR', 2],['TM', 2],['TC', 1],['TV', 2],['AE', 2],['US', 1],['UM', 2],['UY', 1],['UZ', 2],['VU', 2],['VE', 1],['VN', 2],['VG', 1],['VI', 1],['WF', 2],['YE', 2]])

// Contains all available api Routes. There are 4 possible Api Categories
// 0 -> Chain Api
// 1 -> History Api
// 2 -> Hyperion Api
// 3 -> Wallet Api
const routeMap = new Map([
  // Chain Api
  ["/v1/chain/abi_bin_to_json", "a"],
  ["/v1/chain/abi_json_to_bin", "a"],
  ["/v1/chain/get_abi", "a"],
  ["/v1/chain/get_account", "a"],
  ["/v1/chain/get_activated_protocol_features", "a"],
  ["/v1/chain/get_block", "a"],
  ["/v1/chain/get_block_header_state", "a"],
  ["/v1/chain/get_code", "a"],
  ["/v1/chain/get_currency_balance", "a"],
  ["/v1/chain/get_currency_stats", "a"],
  ["/v1/chain/get_info", "a"],
  ["/v1/chain/get_producers", "a"],
  ["/v1/chain/get_raw_abi", "a"],
  ["/v1/chain/get_raw_code_and_abi", "a"],
  ["/v1/chain/get_required_keys", "a"],
  ["/v1/chain/get_scheduled_transaction", "a"],
  ["/v1/chain/get_table_by_scope", "a"],
  ["/v1/chain/get_table_rows", "a"],
  ["/v1/chain/push_transaction", "a"],
  ["/v1/chain/push_transactions", "a"],
  ["/v1/chain/send_transaction", "a"],

  // History Api
  ["/v1/history/get_actions", "b"],
  ["/v1/history/get_transaction", "b"],
  ["/v1/history/get_controlled_accounts", "b"],
  ["/v1/history/get_key_accounts", "b"],

  // Hyperion Api
  ["/v2/history/get_abi_snapshot", "c"],
  ["/v2/history/get_actions", "c"],
  ["/v2/history/get_deltas", "c"],
  ["/v2/history/get_schedule", "c"],
  ["/v2/history/get_transaction", "c"],
  ["/v2/history/get_created_accounts", "c"],
  ["/v2/history/get_creator", "c"],

  // todo: change link signature state api
  ["/v2/state/get_account", "c"],
  ["/v2/state/get_key_accounts", "c"],
  ["/v2/state/get_links", "c"],
  ["/v2/state/get_tokens", "c"],
  ["/v2/state/get_proposals", "c"],
  ["/v2/state/get_voters", "c"],

  // Wallet Api
  ["/v1/chain/get_accounts_by_authorizers", "d"],
  // Check route
  ["/v2/stats/get_missed_blocks", "d"],

  // Check route
  ["/v2/health", "c"],
]);

/**
 * Intercept Request
 */
addEventListener("fetch", async (event) => {
  await event.respondWith(handleRequest(event.request));
});

/**
 * Categorizes Request into different types of Apis and returns a response accordingly
 * @param request = original request
 * @return {Promise<Response>}
 */
function handleRequest(request) {
  // Extract requested API route
  const requestPath = new URL(request.url).pathname;

  // Get needed apiType for route (e.g. is Hyperion required etc.)
  const apiType = routeMap.get(requestPath);

  /**
   * Requested route is a valid route => Forward to Endpoint
   */
  if (apiType !== undefined) {
    return forwardRequest(request, apiType);
  } else if (
    /**
     * Requested route should be disabled => Return standardized Error and do not forward request to Api
     */
    requestPath.startsWith("/v1/producer") ||
    requestPath.startsWith("/v1/db_size") ||
    requestPath.startsWith("/v1/net")
  ) {
    return routeForbidden(request.method, requestPath);
  } else {
    /**
     * Route not found => Return standardized Error
     */
    return routeNotFound(request.method, requestPath);
  }
}

/**
 * Forwards request to Api Endpoint based on geographical location of the request and returns response of Api
 * If Api Request fails (e.g timeout / dns error) a backup Api Request to another Api-Endpoint will be sent
 * @param {Request} request = original request as provided by cloudflare
 * @param {string} apiType = specifies the needed feature set (e.g. Hyperion, History, Chain-Api). Must match the ApiTypes in oneapi-sync worker
 * @return {Promise<Response>}
 */
async function forwardRequest(request, apiType) {
  try {
    /**
     * Middleware
     */
    // Method of the original request
    const method = request.method;
    const hasBody = method.toString() !== "GET" && method.toString() !== "HEAD";

    // Body of the original request
    const body = await request.text();

    // Test if body is valid JSON and return standardized error if not
    try {
      if (hasBody) {
        JSON.parse(body);
      }
    } catch (e) {
      return invalidJson();
    }

    /**
     * Load balancing
     */
    // Get CountryCode of the origin of the request
    const countryCode = request.headers.get("CF-IPCountry");

    // Get load balancer region for the country the request is sent from
    // OneApi is subdivided in a number of regions (see readme). Every country is part of one of the regions
    let loadBalancerRegion = countryMap.get(countryCode);

    // Default to European Load balancer region if no region could be determined
    if (loadBalancerRegion === undefined) loadBalancerRegion = 0;

    // Stores all available loadbalancer regions. If one region did not contain a valid Api Endpoint, it will be removed from
    // the temporary array and the next region will be tried. This step is repeated until not regions are left
    // in that case the fallback list is activated
    let loadBalancerRegions = [2, 1, 0];
    loadBalancerRegions.splice(loadBalancerRegions.indexOf(loadBalancerRegion), 1);

    /**
     * Updated ApiList (if required)
     */
    // ApiList is empty => Get ApiList from KV and wait until it is updated
    if (!apiList || apiList.size === 0) {
      apiList = convertJsonStringToMap(await api_endpoints.get("all"));
      lastRefreshDate = Date.now();
    }

    // ApiList is not empty, but older than 10mins => Get ApiList from KV and wait until it is updated
    else if (Date.now() - lastRefreshDate > 600000) {
      apiList = convertJsonStringToMap(await api_endpoints.get("all"));
      lastRefreshDate = Date.now();
    }

    // ApiList is not empty, but older than 1min and younger than 10mins => Get ApiList from KV and DON'T wait until it is updated
    // => This ensures that frequent used Workers have next to no delay, since frequently a reload is triggered,
    else if (Date.now() - lastRefreshDate > 60000) {
      api_endpoints.get("all").then((list) => {
        apiList = convertJsonStringToMap(list);
        lastRefreshDate = Date.now();
      });
    }

    // Helper variable, used for determining if the fallback list is accessed
    let isFallback = false;

    // Get all apiEndpoints for that load balancing region
    let tmpApiList = [...apiList.get(apiType + "" + loadBalancerRegion)];

    //todo: check async
    for (let retryCounter = 0; retryCounter < maxRetries; retryCounter++) {
      // Switch geographical region if no endpoints are available in the requested load balancer region
      while (tmpApiList === undefined || tmpApiList.length === 0) {
        if (loadBalancerRegions.length > 0) {
          loadBalancerRegion = loadBalancerRegions.pop();
          //console.log("Switched to Region " + loadBalancerRegion);

          // Request Api Endpoint list for newly switched load balancer region
          tmpApiList = [...apiList.get(apiType + "" + loadBalancerRegion)];
          //console.log("Loaded new list for new Region: ", loadBalancerRegion);
        } else {
          // Switch to fallback in case all load balancing regions have
          //console.log("Switched to Fallback");
          isFallback = true;
          tmpApiList = [...fallback];
        }
      }

      // Get random Endpoint from list
      const randomIndex = Math.floor(Math.random() * tmpApiList.length);
      const apiEndpoint = tmpApiList[randomIndex];

      // Temporarily exclude endpoint for future requests, in case primary endpoint times out and a backup endpoint has to be chosen
      tmpApiList.splice(randomIndex, 1);

      // Endpoint url with requestPath
      const requestUrl =
        new URL(new URL(request.url).pathname, apiEndpoint) + new URL(request.url).search + new URL(request.url).hash;

      /**
       * Send Request to Api Endpoint
       */
      try {
        let response;
        if (hasBody) {
          response = await timeout(fetch(requestUrl, { body: body, method: method, headers: request.headers }));
        } else {
          response = await timeout(fetch(requestUrl, { method: method, headers: request.headers }));
        }

        // Add custom header to response
        const responseModified = new Response(response.body, response);
        responseModified.headers.set("x-request-handled-by", apiEndpoint);
        responseModified.headers.set("Access-Control-Allow-Origin", "*");

        // Check status of request
        const status = response.status;
        if (status === 403 || status === 429 || status >= 502) {
          throw "Http error";
        }

        return responseModified === undefined ? await noServerAvailable() : responseModified;
      } catch (e) {
        console.log("error", e);

        // Remove Api Endpoint from cached ApiList
        if (!isFallback) {
          const array = apiList.get(apiType + "" + loadBalancerRegion);
          const index = array.indexOf(apiEndpoint);

          if (index >= 0) {
            array.splice(index, 1);
            apiList.set(apiType + "" + loadBalancerRegion, array);

            console.log("successfully removed " + apiEndpoint + " from apiList");
          }
        }
      }
    }
  } catch (error) {
    console.error("Error while handling request: ", error);
    return noServerAvailable();
  }
}

/**
 * Throws an error if promise is not resolved within the specified amount of timeoutMs (see beginning of file)
 * @param {Promise} promise = promise to be resolved (e.g. fetch request)
 * @return {Promise} = resolved or rejected Promise
 */
function timeout(promise) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error("fetch timeout"));
    }, timeoutMs);
    promise.then(
      (res) => {
        clearTimeout(timeoutId);
        resolve(res);
      },
      (err) => {
        clearTimeout(timeoutId);
        reject(err);
      }
    );
  });
}

/**
 * Returns "404 Route Not Found" Message
 * @param {string} method = Http method (e.g. "GET")
 * @param {string} route = Requested route (e.g. /v1/chain/...)
 * @return {Promise<Response>}
 */
async function routeNotFound(method, route) {
  const message =
    "{\n" +
    '    "message": "Route ' +
    method +
    ":" +
    route +
    ' not found",\n' +
    '    "error": "Not Found",\n' +
    '    "statusCode": 404\n' +
    "}";
  return new Response(message, {
    status: 404,
    headers: headers,
  });
}

/**
 * Returns "403 Forbidden" Message
 * Should be called if a requested route may be supported by some api Endpoints, but if that particular should
 * should be disabled (e.g. for security reasons)
 * @param {string} method = Http method (e.g. "GET")
 * @param {string} route = Requested route (e.g. /v1/chain/...)
 * @return {Promise<Response>}
 */
async function routeForbidden(method, route) {
  const message =
    "{\n" +
    '    "message": "Route ' +
    method +
    ":" +
    route +
    ' is disabled",\n' +
    '    "error": "Forbidden",\n' +
    '    "statusCode": 403\n' +
    "}";
  return new Response(message, {
    status: 403,
    headers: headers,
  });
}

/**
 * Returns "502 Bad Gateway" Message
 * Should be called if no API Endpoint returned a valid response
 * or if no endpoints are available (e.g. no Hyperion on Testnet)
 * @return {Promise<Response>}
 */
async function noServerAvailable() {
  const message =
    "{\n" +
    '    "message": "OneApi did not get a valid reply from any of the upstream Api endpoints.",\n' +
    '    "error": "Bad Gateway",\n' +
    '    "statusCode": 502\n' +
    "}";
  return new Response(message, {
    status: 502,
    headers: headers,
  });
}
/**
 * Returns "400 Bad Request" Message
 * Should be called if request body cannot be parsed into a JSON
 * @return {Promise<Response>}
 */
async function invalidJson() {
  const message =
    "{\n" + '    "message": "INVALID_JSON",\n' + '    "error": "Bad Request",\n' + '    "statusCode": 400\n' + "}";
  return new Response(message, {
    status: 400,
    headers: headers,
  });
}

/**
 * Converts json formatted String to Map and returns it
 * @param {string} jsonString = json formatted string as stored by the oneapi-sync worker
 * @return {undefined|Map<string, string[]>} = either a map containing containing the endpoints or undefined
 */
function convertJsonStringToMap(jsonString) {
  try {
    const json = JSON.parse(jsonString);
    const map = new Map();
    for (let key in json) {
      if (key !== undefined) {
        map.set(key, json[key]);
      }
    }
    return map;
  } catch (e) {
    console.error("Error while converting json to map: ", e);
    return undefined;
  }
}
