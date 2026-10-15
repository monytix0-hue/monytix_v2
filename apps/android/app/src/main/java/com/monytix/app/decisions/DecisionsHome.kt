package com.monytix.app.decisions

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.monytix.app.auth.MonytixApi
import com.monytix.app.theme.LocalPersonalTheme
import com.monytix.app.theme.PersonalRadius
import com.monytix.app.theme.PersonalSpace
import org.json.JSONObject

enum class DecisionPage { Home, Weigh, Confirm, Solutions }

private const val Unavailable = "Unavailable"
private val filters = listOf("Need you" to "need_you", "Upcoming" to "upcoming", "Made" to "made")
private val structuralWeights = listOf("Resilience", "Risk", "Comfort", "Opportunity")
private val decisionNames = mapOf(
    "D01" to "Emergency Fund Allocation",
    "D02" to "Cash Buffer Top-Up",
    "D03" to "Credit Card Payment",
    "D04" to "Loan EMI Protection",
    "D05" to "Insurance Renewal",
    "D06" to "Insurance Coverage Gap",
    "D07" to "Idle Cash Deployment",
    "D08" to "Income Surplus Allocation",
    "D09" to "Recurring Review",
    "D10" to "Expense Spike Review",
    "D11" to "Large Expense Warning",
    "D12" to "Cash Crunch Forecast",
    "D13" to "Savings Rate Lift",
    "D14" to "Goal Contribution Catch-Up",
    "D15" to "Salary Day Allocation",
    "D16" to "Bonus Allocation",
    "D17" to "Emergency Fund Milestone Push",
    "D18" to "SIP Continuity",
    "D19" to "Idle Cash to SIP",
    "D20" to "Asset Drift Rebalance",
    "D21" to "Retirement Funding Gap",
    "D22" to "Goal-Linked Investing",
    "D23" to "Dining Optimization",
    "D24" to "Shopping Control",
    "D25" to "Entertainment Cap",
    "D26" to "Travel Spend Review",
    "D27" to "Discretionary Squeeze",
    "D28" to "Mission Acceleration",
    "D29" to "Confidence Growth Opportunity",
    "D30" to "Milestone Unlock",
)

private data class PublishedDecision(
    val id: String,
    val title: String?,
    val amount: String?,
    val timing: String?,
    val state: String?,
)

private data class DecisionRead(
    val heaviest: PublishedDecision?,
    val decisions: List<PublishedDecision>,
) {
    companion object {
        fun empty() = DecisionRead(null, emptyList())

        fun parse(json: String): DecisionRead {
            return try {
                val root = JSONObject(json)
                val rows = root.optJSONArray("decisions")
                val decisions = buildList {
                    if (rows != null) {
                        for (index in 0 until rows.length()) {
                            rows.optJSONObject(index)?.let(::decision)?.let(::add)
                        }
                    }
                }
                val heaviest = root.optJSONObject("heaviest")
                DecisionRead(
                    heaviest = if (heaviest?.optBoolean("available") == true) decision(heaviest) else null,
                    decisions = decisions,
                )
            } catch (_: Exception) {
                empty()
            }
        }
    }
}

private data class ChoiceLine(val name: String?, val amount: String?)
private data class WeightLine(val name: String?, val priority: String?)
private data class SolutionLine(val title: String?, val detail: String?)

private data class DecisionWeights(
    val question: String?,
    val choices: List<ChoiceLine>,
    val weights: List<WeightLine>,
    val solutions: List<SolutionLine>,
) {
    companion object {
        fun empty() = DecisionWeights(null, emptyList(), emptyList(), emptyList())

        fun parse(json: String): DecisionWeights {
            return try {
                val root = JSONObject(json)
                val decision = root.optJSONObject("decision")
                DecisionWeights(
                    question = text(decision, "question"),
                    choices = lines(root.optJSONArray("choices")) { ChoiceLine(text(it, "name"), text(it, "amount")) },
                    weights = lines(root.optJSONArray("weights")) { WeightLine(text(it, "name"), text(it, "priority")) },
                    solutions = lines(root.optJSONArray("solutions")) { SolutionLine(text(it, "title"), text(it, "detail")) },
                )
            } catch (_: Exception) {
                empty()
            }
        }
    }
}

private fun decision(obj: JSONObject): PublishedDecision? {
    val id = obj.optString("id")
    if (id.isBlank()) return null
    val type = obj.optString("type").ifBlank { null }
    return PublishedDecision(
        id = id,
        title = text(obj, "title") ?: type?.let { decisionNames[it] },
        amount = text(obj, "amount"),
        timing = text(obj, "timing"),
        state = text(obj, "state"),
    )
}

private fun text(obj: JSONObject?, key: String): String? {
    val value = obj?.optString(key).orEmpty()
    return value.ifBlank { null }
}

private fun <T> lines(rows: org.json.JSONArray?, map: (JSONObject) -> T): List<T> {
    if (rows == null) return emptyList()
    return buildList {
        for (index in 0 until rows.length()) {
            rows.optJSONObject(index)?.let { add(map(it)) }
        }
    }
}

@Composable
fun DecisionHome(
    api: MonytixApi,
    token: suspend (Boolean) -> String?,
    onOpen: (String) -> Unit,
) {
    val theme = LocalPersonalTheme.current
    var read by remember { mutableStateOf(DecisionRead.empty()) }
    var filter by remember { mutableStateOf(filters.first().second) }
    LaunchedEffect(api) {
        val json = api.getJson("/v1/ui/decisions", token)
        read = if (json.isNullOrBlank()) DecisionRead.empty() else DecisionRead.parse(json)
    }
    val listed = read.decisions.filter { it.state == filter }
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = PersonalSpace.s28)
            .padding(top = PersonalSpace.s20, bottom = 128.dp),
        verticalArrangement = Arrangement.spacedBy(PersonalSpace.s20),
    ) {
        Text("Decisions", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 22.sp)
        Text("See the choices that deserve your attention.", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp)
        Row(horizontalArrangement = Arrangement.spacedBy(PersonalSpace.s8)) {
            filters.forEach { (label, value) ->
                val on = filter == value
                Text(
                    label,
                    color = if (on) theme.action.label else theme.palette.textSecondary,
                    fontFamily = theme.fontFamily,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 14.sp,
                    modifier = Modifier
                        .clip(RoundedCornerShape(PersonalRadius.pill))
                        .background(if (on) theme.action.default else theme.palette.surface)
                        .border(1.dp, if (on) theme.action.default else theme.palette.border, RoundedCornerShape(PersonalRadius.pill))
                        .clickable { filter = value }
                        .padding(horizontal = PersonalSpace.s16, vertical = PersonalSpace.s12),
                )
            }
        }
        val featured = read.heaviest
        Card(if (featured?.id != null) Modifier.clickable { onOpen(featured.id) } else Modifier) {
            Text(featured?.title ?: Unavailable, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 16.sp)
            Text(featured?.amount ?: Unavailable, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp)
            Text(featured?.timing ?: Unavailable, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
        }
        Text("A decision is a choice — not a recommendation.", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp)
        Text("Other choices ahead", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 16.sp)
        if (listed.isEmpty()) {
            Card {
                Text(Unavailable, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 16.sp)
            }
        } else {
            listed.forEach { row ->
                Card(Modifier.clickable { onOpen(row.id) }) {
                    Text(row.title ?: Unavailable, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                    Text(row.amount ?: Unavailable, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp)
                    Text(row.timing ?: Unavailable, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
                }
            }
        }
    }
}

@Composable
fun DecisionFlow(
    page: DecisionPage,
    decisionId: String,
    api: MonytixApi,
    token: suspend (Boolean) -> String?,
    onBack: () -> Unit,
    onContinue: () -> Unit,
    onConfirm: () -> Unit,
    onSave: () -> Unit,
) {
    val theme = LocalPersonalTheme.current
    var weights by remember { mutableStateOf(DecisionWeights.empty()) }
    var selected by remember { mutableStateOf<Int?>(null) }
    var reason by remember { mutableStateOf("") }
    LaunchedEffect(decisionId) {
        val json = api.getJson("/v1/ui/decisions/$decisionId/weights", token)
        weights = if (json.isNullOrBlank()) DecisionWeights.empty() else DecisionWeights.parse(json)
        selected = null
    }
    val title = when (page) {
        DecisionPage.Weigh -> "Weigh your options"
        DecisionPage.Confirm -> "Mark your decision"
        else -> "Next step"
    }
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(theme.palette.canvas)
            .verticalScroll(rememberScrollState())
            .navigationBarsPadding()
            .padding(horizontal = PersonalSpace.s20)
            .padding(top = PersonalSpace.s16, bottom = PersonalSpace.s32),
        verticalArrangement = Arrangement.spacedBy(PersonalSpace.s16),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(PersonalSpace.s12)) {
            Box(
                Modifier.size(48.dp).clip(CircleShape).background(theme.palette.surface).border(1.dp, theme.palette.border, CircleShape).clickable(onClick = onBack),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Back", tint = theme.palette.textPrimary)
            }
            Text(title, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 22.sp)
        }
        when (page) {
            DecisionPage.Weigh -> WeighBody(weights, selected, onSelect = { selected = it }, onContinue = onContinue)
            DecisionPage.Confirm -> ConfirmBody(
                choice = selected?.let { weights.choices.getOrNull(it)?.name },
                reason = reason,
                onReason = { reason = it },
                onConfirm = onConfirm,
                onSave = onSave,
            )
            DecisionPage.Solutions -> SolutionsBody(weights)
            DecisionPage.Home -> Unit
        }
    }
}

@Composable
private fun WeighBody(weights: DecisionWeights, selected: Int?, onSelect: (Int) -> Unit, onContinue: () -> Unit) {
    val theme = LocalPersonalTheme.current
    Text(weights.question ?: Unavailable, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
    Card {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("Flexibility", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
            Text("Safety", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
        }
        Box(Modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(PersonalRadius.pill)).background(theme.palette.border))
        Text(Unavailable, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp)
    }
    val choices = weights.choices.ifEmpty { listOf(ChoiceLine(null, null)) }
    choices.forEachIndexed { index, choice ->
        val on = selected == index && weights.choices.isNotEmpty()
        Card(
            Modifier
                .border(1.dp, if (on) theme.action.default else theme.palette.border, RoundedCornerShape(PersonalRadius.card))
                .clickable(enabled = weights.choices.isNotEmpty()) { onSelect(index) },
        ) {
            Text(choice.name ?: Unavailable, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 16.sp)
            Text(choice.amount ?: Unavailable, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp)
            Box(Modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(PersonalRadius.pill)).background(theme.palette.border))
        }
    }
    val lines = if (weights.weights.isEmpty()) structuralWeights.map { WeightLine(it, null) } else weights.weights
    lines.forEach { line ->
        Card {
            Text(line.name ?: Unavailable, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 16.sp)
            Text(line.priority ?: Unavailable, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp)
            Box(Modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(PersonalRadius.pill)).background(theme.palette.border))
        }
    }
    Gold("Continue with selected choice", onContinue)
}

@Composable
private fun ConfirmBody(choice: String?, reason: String, onReason: (String) -> Unit, onConfirm: () -> Unit, onSave: () -> Unit) {
    val theme = LocalPersonalTheme.current
    Card {
        Text(choice ?: Unavailable, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 16.sp)
        Text("What mattered", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
        Text(Unavailable, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp)
        Text("Expected outcomes", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
        Text(Unavailable, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp)
    }
    Text("Optional reason", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
    BasicTextField(
        value = reason,
        onValueChange = onReason,
        textStyle = androidx.compose.ui.text.TextStyle(color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontSize = 15.sp),
        cursorBrush = SolidColor(theme.palette.textPrimary),
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(PersonalRadius.action))
            .background(theme.palette.surface)
            .border(1.dp, theme.palette.border, RoundedCornerShape(PersonalRadius.action))
            .padding(PersonalSpace.s16),
        decorationBox = { inner ->
            if (reason.isEmpty()) {
                Text("Unavailable", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp)
            }
            inner()
        },
    )
    Gold("Confirm decision", onConfirm)
    Gold("Save for later", onSave)
}

@Composable
private fun SolutionsBody(weights: DecisionWeights) {
    val theme = LocalPersonalTheme.current
    Card {
        Text(weights.question ?: Unavailable, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 16.sp)
        Text(Unavailable, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp)
    }
    Text("Ways to fulfill it", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 16.sp)
    val ways = weights.solutions.ifEmpty { List(3) { SolutionLine(null, null) } }
    ways.forEach { way ->
        Card {
            Text(way.title ?: Unavailable, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 16.sp)
            Text(way.detail ?: Unavailable, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp)
            Text("Explore", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
        }
    }
    Card {
        Text("Transparency", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 16.sp)
        Text(Unavailable, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp)
    }
    Card {
        Text("Choosing a product is optional", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 16.sp)
        Text(Unavailable, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp)
    }
}

@Composable
private fun Card(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    val theme = LocalPersonalTheme.current
    Column(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(PersonalRadius.card))
            .background(theme.palette.surface)
            .border(1.dp, theme.palette.border, RoundedCornerShape(PersonalRadius.card))
            .padding(PersonalSpace.s16),
        verticalArrangement = Arrangement.spacedBy(PersonalSpace.s8),
    ) { content() }
}

@Composable
private fun Gold(label: String, onClick: () -> Unit) {
    val theme = LocalPersonalTheme.current
    Box(
        Modifier.fillMaxWidth().height(48.dp).clip(RoundedCornerShape(PersonalRadius.action)).background(theme.action.default).clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, color = theme.action.label, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 15.sp)
    }
}
