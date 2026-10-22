package com.monytix.app.shell

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.monytix.app.auth.MonytixApi
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch

/**
 * Session-scoped UI snapshots. Prefetched after sign-in so tab remounts render
 * immediately instead of empty-then-fetch on every pill tap.
 */
class UiSessionStore(
    private val api: MonytixApi,
    private val token: suspend (Boolean) -> String?,
) {
    var liveJson by mutableStateOf<String?>(null)
        private set
    var decisionsJson by mutableStateOf<String?>(null)
        private set
    var missionsJson by mutableStateOf<String?>(null)
        private set
    var mileSummaryJson by mutableStateOf<String?>(null)
        private set
    var mileEventsJson by mutableStateOf<String?>(null)
        private set

    var liveReady by mutableStateOf(false)
        private set
    var decisionsReady by mutableStateOf(false)
        private set
    var missionsReady by mutableStateOf(false)
        private set
    var mileReady by mutableStateOf(false)
        private set

    suspend fun prefetch() = coroutineScope {
        launch { refreshLive() }
        launch { refreshDecisions() }
        launch { refreshMissions() }
        launch { refreshMile() }
    }

    suspend fun refreshLive() {
        liveJson = api.getJson("/v1/ui/live", token)
        liveReady = true
    }

    suspend fun refreshDecisions() {
        decisionsJson = api.getJson("/v1/ui/decisions", token)
        decisionsReady = true
    }

    suspend fun refreshMissions() {
        missionsJson = api.getJson("/v1/ui/missions", token)
        missionsReady = true
    }

    suspend fun refreshMile() {
        coroutineScope {
            launch {
                mileSummaryJson = api.getJson("/v1/mile/summary", token)
            }
            launch {
                mileEventsJson = api.getJson("/v1/mile/events", token)
            }
        }
        mileReady = true
    }

    /** After statement import / Gmail connect affecting Live. */
    suspend fun invalidateAfterImport() {
        refreshLive()
        refreshMissions()
    }

    fun clear() {
        liveJson = null
        decisionsJson = null
        missionsJson = null
        mileSummaryJson = null
        mileEventsJson = null
        liveReady = false
        decisionsReady = false
        missionsReady = false
        mileReady = false
    }
}
