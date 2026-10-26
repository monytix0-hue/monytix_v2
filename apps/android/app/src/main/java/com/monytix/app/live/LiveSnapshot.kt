package com.monytix.app.live

import org.json.JSONObject

internal fun JSONObject.optionalText(key: String): String? {
    if (isNull(key)) return null
    return optString(key).trim().ifBlank { null }
}

data class RecordedCurrency(
    val currency: String,
    val inflow: String,
    val outflow: String,
)

data class RecordedPreview(
    val id: String,
    val amount: String?,
    val currency: String?,
    val direction: String?,
    val transactionDate: String?,
    val description: String?,
    val accountName: String?,
    val weightName: String?,
)

data class ActiveMission(
    val title: String?,
    val line: String?,
    val progress: String?,
)

data class LiveMile(
    val impact: String?,
    val line: String?,
    val pills: List<String>,
)

data class LiveSnapshot(
    val recordedFlowAvailable: Boolean,
    val currencies: List<RecordedCurrency>,
    val transactionsKnown: Boolean,
    val hasRecordedTransactions: Boolean,
    val availableBalance: String?,
    val previewsKnown: Boolean,
    val previews: List<RecordedPreview>,
    val activeMission: ActiveMission?,
    val mile: LiveMile?,
) {
    companion object {
        fun unavailable() = LiveSnapshot(
            recordedFlowAvailable = false,
            currencies = emptyList(),
            transactionsKnown = false,
            hasRecordedTransactions = false,
            availableBalance = null,
            previewsKnown = false,
            previews = emptyList(),
            activeMission = null,
            mile = null,
        )

        fun parse(json: String): LiveSnapshot {
            return try {
                val root = JSONObject(json)
                val flow = root.optJSONObject("recordedFlow")
                val rows = flow?.optJSONArray("currencies")
                val currencies = buildList {
                    if (rows != null) {
                        for (index in 0 until rows.length()) {
                            val row = rows.optJSONObject(index) ?: continue
                            add(
                                RecordedCurrency(
                                    currency = row.optString("currency"),
                                    inflow = row.optString("inflow"),
                                    outflow = row.optString("outflow"),
                                ),
                            )
                        }
                    }
                }
                val transactions = root.optJSONObject("transactions")
                val balance = root.optJSONObject("summary")?.optJSONObject("available_balance")
                val amount = balance?.optString("amount").orEmpty()
                val currency = balance?.optString("currency").orEmpty()
                val previewRows = root.optJSONArray("transactions_preview")
                val previews = buildList {
                    if (previewRows != null) {
                        for (index in 0 until previewRows.length()) {
                            val row = previewRows.optJSONObject(index) ?: continue
                            val id = row.optString("id")
                            if (id.isBlank()) continue
                            add(
                                RecordedPreview(
                                    id = id,
                                    amount = row.optionalText("amount"),
                                    currency = row.optionalText("currency"),
                                    direction = row.optionalText("direction"),
                                    transactionDate = row.optionalText("transactionDate"),
                                    description = row.optionalText("description"),
                                    accountName = row.optionalText("accountName"),
                                    weightName = row.optionalText("weightName"),
                                ),
                            )
                        }
                    }
                }
                val mission = root.optJSONObject("active_mission")
                val activeMission = if (mission?.optBoolean("available") == true) {
                    ActiveMission(
                        title = mission.optString("title").ifBlank { null },
                        line = mission.optString("line").ifBlank { null },
                        progress = mission.optString("progress").ifBlank { null },
                    )
                } else {
                    null
                }
                val mileObject = root.optJSONObject("mile")
                val mile = if (mileObject?.optBoolean("available") == true) {
                    val pills = mileObject.optJSONArray("pills")
                    LiveMile(
                        impact = mileObject.optionalText("impact"),
                        line = mileObject.optionalText("line"),
                        pills = buildList {
                            if (pills != null) {
                                for (index in 0 until pills.length()) {
                                    val label = pills.optString(index)
                                    if (label.isNotBlank()) add(label)
                                }
                            }
                        },
                    )
                } else {
                    null
                }
                LiveSnapshot(
                    recordedFlowAvailable = flow?.optBoolean("available") == true && currencies.isNotEmpty(),
                    currencies = currencies,
                    transactionsKnown = transactions?.optBoolean("available") == true,
                    hasRecordedTransactions = transactions?.optBoolean("hasRecorded") == true,
                    availableBalance = if (balance?.optBoolean("available") == true && amount.isNotBlank() && currency.isNotBlank()) {
                        "$currency $amount"
                    } else {
                        null
                    },
                    previewsKnown = previewRows != null,
                    previews = previews,
                    activeMission = activeMission,
                    mile = mile,
                )
            } catch (_: Exception) {
                unavailable()
            }
        }
    }
}
