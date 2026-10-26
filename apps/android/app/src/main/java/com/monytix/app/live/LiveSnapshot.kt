package com.monytix.app.live

import org.json.JSONObject

internal fun movementLine(row: RecordedPreview): String {
    val money = if (!row.currency.isNullOrBlank() && !row.amount.isNullOrBlank()) "${row.currency} ${row.amount}" else "Recorded"
    val weight = if (row.weightName.isNullOrBlank()) "" else " · ${row.weightName}"
    return "$money · ${row.transactionDate ?: "Recorded"}$weight"
}

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

data class LiveDecision(
    val title: String,
    val question: String?,
)

data class LiveWeight(
    val name: String,
    val amount: String,
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
    val activeMissions: List<ActiveMission>,
    val decisions: List<LiveDecision>,
    val weights: List<LiveWeight>,
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
            activeMissions = emptyList(),
            decisions = emptyList(),
            weights = emptyList(),
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
                val missionRows = root.optJSONArray("active_missions")
                val activeMissions = buildList {
                    if (missionRows != null) {
                        for (index in 0 until missionRows.length()) {
                            val row = missionRows.optJSONObject(index) ?: continue
                            add(
                                ActiveMission(
                                    title = row.optString("title").ifBlank { null },
                                    line = row.optString("line").ifBlank { null },
                                    progress = row.optString("progress").ifBlank { null },
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
                val missions = if (activeMissions.isNotEmpty()) activeMissions else listOfNotNull(activeMission)
                val decisionObject = root.optJSONObject("decision_cards")
                val decisionRows = decisionObject?.optJSONArray("cards")
                val decisions = if (decisionObject?.optBoolean("available") == true && decisionRows != null) {
                    buildList {
                        for (index in 0 until decisionRows.length()) {
                            val row = decisionRows.optJSONObject(index) ?: continue
                            val title = row.optString("title")
                            if (title.isBlank()) continue
                            add(LiveDecision(title = title, question = row.optionalText("question")))
                        }
                    }
                } else {
                    emptyList()
                }
                val weightObject = root.optJSONObject("weight_summary")
                val weightRows = weightObject?.optJSONArray("weights")
                val weights = if (weightObject?.optBoolean("available") == true && weightRows != null) {
                    buildList {
                        for (index in 0 until weightRows.length()) {
                            val row = weightRows.optJSONObject(index) ?: continue
                            val name = row.optString("name")
                            if (name.isBlank()) continue
                            add(LiveWeight(name = name, amount = row.optString("amount")))
                        }
                    }
                } else {
                    emptyList()
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
                    activeMissions = missions,
                    decisions = decisions,
                    weights = weights,
                    mile = mile,
                )
            } catch (_: Exception) {
                unavailable()
            }
        }
    }
}
