package com.monytix.app.shell

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.monytix.app.auth.MonytixApi
import org.json.JSONObject

/**
 * Session-scoped UI snapshots. One bootstrap load fills every tab and its sheets.
 */
class UiSessionStore(
    private val api: MonytixApi,
    private val token: suspend (Boolean) -> String?,
) {
    var liveJson by mutableStateOf<String?>(null)
        private set
    var decisionsJson by mutableStateOf<String?>(null)
        private set
    var decisionScreensJson by mutableStateOf<String?>(null)
        private set
    var missionsJson by mutableStateOf<String?>(null)
        private set
    var missionScreensJson by mutableStateOf<String?>(null)
        private set
    var missionDefinitionsJson by mutableStateOf<String?>(null)
        private set
    var mileSummaryJson by mutableStateOf<String?>(null)
        private set
    var mileEventsJson by mutableStateOf<String?>(null)
        private set

    /** The owner's home currency, timezone and country, from the same single prefetch. */
    var preferences by mutableStateOf<OwnerPreferences?>(null)
        private set

    /** Formatting facts for the currencies this owner holds, keyed by ISO code. */
    var currencyFormats by mutableStateOf<Map<String, CurrencyFormat>>(emptyMap())
        private set

    var liveReady by mutableStateOf(false)
        private set
    var decisionsReady by mutableStateOf(false)
        private set
    var missionsReady by mutableStateOf(false)
        private set
    var mileReady by mutableStateOf(false)
        private set

    private val insightCache = mutableMapOf<String, String>()

    suspend fun prefetch() {
        val json = api.getJson("/v1/ui/bootstrap", token)
        val root = json?.let { runCatching { JSONObject(it) }.getOrNull() }
        if (root == null) {
            markReady()
            return
        }
        liveJson = root.optJSONObject("live")?.toString()
        decisionsJson = root.optJSONObject("decisions")?.toString()
        decisionScreensJson = root.optJSONObject("decision_screens")?.toString()
        missionsJson = root.optJSONObject("missions")?.toString()
        missionScreensJson = root.optJSONObject("mission_screens")?.toString()
        missionDefinitionsJson = root.optJSONObject("mission_definitions")?.toString()
        mileSummaryJson = root.optJSONObject("mile_summary")?.toString()
        mileEventsJson = root.optJSONObject("mile_events")?.toString()
        preferences = OwnerPreferences.from(root.optJSONObject("preferences"))
        currencyFormats = parseCurrencyFormats(root.optJSONObject("currency_formats"))
        markReady()
    }

    fun decisionScreen(id: String): String? = objectSlice(decisionScreensJson, id)

    fun missionScreen(id: String): JSONObject? {
        val screens = missionScreensJson ?: return null
        return runCatching { JSONObject(screens).optJSONObject(id) }.getOrNull()
    }

    fun missionDefinition(code: String): String? = objectSlice(missionDefinitionsJson, code)

    fun mileTrace(id: String): String? {
        val events = mileEventsJson ?: return null
        val rows = runCatching { JSONObject(events).optJSONArray("events") }.getOrNull() ?: return null
        for (index in 0 until rows.length()) {
            val event = rows.optJSONObject(index) ?: continue
            if (event.optString("id") == id) return JSONObject().put("event", event).toString()
        }
        return null
    }

    suspend fun invalidateAfterImport() {
        insightCache.clear()
        prefetch()
    }

    /** Ledger insights are cached per date window so switching filters does not repeat the analytics call. */
    suspend fun ledgerInsights(from: String?, to: String?): String? {
        val key = "${from.orEmpty()}|${to.orEmpty()}"
        insightCache[key]?.let { return it }
        val query = buildString {
            append("/v1/ledger/insights")
            val params = buildList {
                if (from != null) add("from=$from")
                if (to != null) add("to=$to")
            }
            if (params.isNotEmpty()) append("?").append(params.joinToString("&"))
        }
        val json = api.getJson(query, token) ?: return null
        insightCache[key] = json
        return json
    }

    fun invalidateInsights() {
        insightCache.clear()
    }

    fun clear() {
        liveJson = null
        decisionsJson = null
        decisionScreensJson = null
        missionsJson = null
        missionScreensJson = null
        missionDefinitionsJson = null
        mileSummaryJson = null
        mileEventsJson = null
        preferences = null
        currencyFormats = emptyMap()
        insightCache.clear()
        liveReady = false
        decisionsReady = false
        missionsReady = false
        mileReady = false
    }

    /**
     * Minor units for a code, from `ref.currency` when the bootstrap shipped it.
     * `null` means "use the platform's default", which is right for every code the
     * server can detect.
     */
    fun minorUnits(currency: String?): Int? =
        currency?.uppercase(java.util.Locale.ROOT)?.let { currencyFormats[it]?.minorUnits }

    /** The currency a row should be rendered in: its own, else the home currency. */
    fun displayCurrency(row: String?, account: String? = null): String? =
        Money.currency(row, account, preferences?.defaultCurrencyCode)

    private fun parseCurrencyFormats(root: JSONObject?): Map<String, CurrencyFormat> {
        if (root == null) return emptyMap()
        val out = mutableMapOf<String, CurrencyFormat>()
        val keys = root.keys()
        while (keys.hasNext()) {
            val key = keys.next()
            val code = key.uppercase(java.util.Locale.ROOT)
            CurrencyFormat.from(code, root.optJSONObject(key))?.let { out[code] = it }
        }
        return out
    }

    private fun markReady() {
        liveReady = true
        decisionsReady = true
        missionsReady = true
        mileReady = true
    }

    private fun objectSlice(json: String?, key: String): String? {
        if (json.isNullOrBlank()) return null
        return runCatching { JSONObject(json).optJSONObject(key)?.toString() }.getOrNull()
    }
}
