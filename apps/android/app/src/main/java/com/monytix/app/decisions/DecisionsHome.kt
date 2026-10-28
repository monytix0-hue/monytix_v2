package com.monytix.app.decisions

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import com.monytix.app.shell.UiSessionStore
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.monytix.app.R
import com.monytix.app.auth.MonytixApi
import com.monytix.app.theme.FigIcon
import com.monytix.app.theme.LocalPersonalTheme
import com.monytix.app.theme.PersonalRadius
import com.monytix.app.theme.PersonalSpace
import java.text.NumberFormat
import java.util.Locale
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

enum class DecisionPage { Home, Weigh, Confirm, Solutions }

private val filters = listOf("Need you" to "need_you", "Upcoming" to "upcoming", "Made" to "made")
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

private data class MeterLine(val label: String, val fraction: Float)
private data class ChoiceLine(
    val id: String,
    val name: String?,
    val approach: String?,
    val amount: String?,
    val meters: List<MeterLine>,
    val outcomes: List<String>,
    val hint: String?,
)
private data class PublishedDecision(
    val id: String,
    val title: String?,
    val amount: String?,
    val timing: String?,
    val state: String?,
    val question: String?,
    val context: String?,
    val badge: String?,
    val summary: String?,
    val weightCount: Int,
    val choices: List<ChoiceLine>,
)
private data class DecisionRead(val heaviest: PublishedDecision?, val decisions: List<PublishedDecision>) {
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

private data class WeightLine(val name: String?, val priority: String?, val meaning: String?, val importance: Float)
private data class SolutionLine(val title: String?, val tag: String?, val detail: String?)
private data class DecisionWeights(
    val title: String?,
    val question: String?,
    val context: String?,
    val mattered: String?,
    val expected: List<String>,
    val choices: List<ChoiceLine>,
    val weights: List<WeightLine>,
    val solutions: List<SolutionLine>,
    val tradeoffTitle: String?,
    val tradeoffDescription: String?,
    val transparency: String?,
    val optionalNote: String?,
) {
    companion object {
        fun empty() = DecisionWeights(null, null, null, null, emptyList(), emptyList(), emptyList(), emptyList(), null, null, null, null)

        fun parse(json: String): DecisionWeights {
            return try {
                val root = JSONObject(json)
                val decision = root.optJSONObject("decision")
                val tradeoff = root.optJSONObject("tradeoff")
                DecisionWeights(
                    title = text(decision, "title"),
                    question = text(decision, "question"),
                    context = text(decision, "context"),
                    mattered = text(decision, "mattered"),
                    expected = strings(decision?.optJSONArray("expected")),
                    choices = lines(root.optJSONArray("choices")) { choice(it, "choice") },
                    weights = lines(root.optJSONArray("weights")) {
                        WeightLine(text(it, "name"), text(it, "priority"), text(it, "meaning"), it.optDouble("importance", 0.45).toFloat().coerceIn(0f, 1f))
                    },
                    solutions = lines(root.optJSONArray("solutions")) { SolutionLine(text(it, "title"), text(it, "tag"), text(it, "detail")) },
                    tradeoffTitle = text(tradeoff, "title"),
                    tradeoffDescription = text(tradeoff, "description"),
                    transparency = text(root, "transparency"),
                    optionalNote = text(root, "optional_note"),
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
    val choices = lines(obj.optJSONArray("choices")) { choice(it, id) }
    return PublishedDecision(
        id = id,
        title = text(obj, "title") ?: type?.let { decisionNames[it] },
        amount = money(text(obj, "amount")),
        timing = text(obj, "timing"),
        state = text(obj, "state"),
        question = text(obj, "question"),
        context = text(obj, "context"),
        badge = text(obj, "badge"),
        summary = text(obj, "summary"),
        weightCount = obj.optInt("weight_count", choices.size),
        choices = choices,
    )
}

private fun choice(obj: JSONObject, fallback: String): ChoiceLine {
    val meters = lines(obj.optJSONArray("meters")) {
        MeterLine(text(it, "label") ?: "Balance", it.optDouble("fraction", 0.0).toFloat().coerceIn(0f, 1f))
    }
    return ChoiceLine(
        id = text(obj, "id") ?: fallback,
        name = text(obj, "name"),
        approach = text(obj, "approach"),
        amount = text(obj, "amount"),
        meters = meters,
        outcomes = strings(obj.optJSONArray("outcomes")),
        hint = text(obj, "hint"),
    )
}

private fun text(obj: JSONObject?, key: String): String? {
    if (obj == null || !obj.has(key) || obj.isNull(key)) return null
    val value = obj.opt(key)
    val rendered = when (value) {
        is String -> value
        is Number -> value.toString()
        else -> return null
    }
    return rendered.ifBlank { null }
}

private fun strings(rows: JSONArray?): List<String> {
    if (rows == null) return emptyList()
    return buildList {
        for (index in 0 until rows.length()) {
            val value = rows.optString(index)
            if (value.isNotBlank()) add(value)
        }
    }
}

private fun <T> lines(rows: JSONArray?, map: (JSONObject) -> T): List<T> {
    if (rows == null) return emptyList()
    return buildList {
        for (index in 0 until rows.length()) {
            rows.optJSONObject(index)?.let { add(map(it)) }
        }
    }
}

private fun money(raw: String?): String? {
    if (raw.isNullOrBlank()) return null
    if (raw.contains("₹")) return raw
    val amount = raw.replace(",", "").toDoubleOrNull() ?: return raw
    val format = NumberFormat.getCurrencyInstance(Locale("en", "IN"))
    format.maximumFractionDigits = 0
    return format.format(amount)
}

@Composable
fun DecisionHome(
    store: UiSessionStore,
    onOpen: (String) -> Unit,
) {
    val theme = LocalPersonalTheme.current
    val read = remember(store.decisionsJson) {
        val json = store.decisionsJson
        if (json.isNullOrBlank()) DecisionRead.empty() else DecisionRead.parse(json)
    }
    var filter by remember { mutableStateOf(filters.first().second) }
    val listed = read.decisions.filter { it.state == filter }
    val boardEmpty = read.heaviest == null && read.decisions.isEmpty()
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = PersonalSpace.s28)
            .padding(top = PersonalSpace.s20, bottom = 128.dp),
        verticalArrangement = Arrangement.spacedBy(PersonalSpace.s20),
    ) {
        Text("Decisions", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 22.sp)
        Text("See the choices that deserve your attention", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp)
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
        if (boardEmpty) {
            Quiet("No choices need you right now.")
        } else if (filter == "need_you" && featured != null) {
            val open = featured
            Card(Modifier.clickable { onOpen(open.id) }) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(open.badge ?: "NEEDS A CHOICE", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 12.sp)
                    if (open.weightCount > 0) {
                        Text("${open.weightCount} WEIGHTS", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 12.sp)
                    }
                }
                Text(open.title ?: "Decision", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 18.sp)
                open.question?.let { Text(it, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 16.sp) }
                open.context?.let { Text(it, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp) }
                if (open.choices.isNotEmpty()) {
                    Text(open.choices.take(3).joinToString("   ") { it.amount ?: it.name ?: "Choice" }, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
                } else {
                    open.amount?.let { Text(it, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp) }
                }
                Text("Weigh your options →", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 15.sp)
            }
            if (listed.isEmpty()) {
                Quiet("No other choices are waiting.")
            } else {
                Text("Other choices ahead", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                listed.forEachIndexed { index, row -> ListCard(row, index, onOpen) }
            }
        } else if (listed.isEmpty()) {
            Quiet(
                when (filter) {
                    "upcoming" -> "Nothing is saved for later."
                    "made" -> "No decisions are marked yet."
                    else -> "No choices need you right now."
                },
            )
        } else {
            listed.forEachIndexed { index, row -> ListCard(row, index, onOpen) }
        }
        Text("A Decision is a choice — not a recommendation.", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp)
        Text("Monytix shows the trade-offs. You decide which weights matter most, choose an option, and mark the decision.", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp)
    }
}

@Composable
private fun ListCard(row: PublishedDecision, index: Int, onOpen: (String) -> Unit) {
    val theme = LocalPersonalTheme.current
    Card(Modifier.clickable { onOpen(row.id) }) {
        FigIcon(if (index % 2 == 0) R.drawable.fig_biz_shield_2 else R.drawable.fig_biz_shield, 32.dp)
        Text(row.timing ?: "Needs a choice", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
        Text(row.title ?: "Decision", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 16.sp)
        row.summary?.let { Text(it, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp) }
        row.amount?.let { Text(it, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp) }
        Text("Compare choices →", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 15.sp)
    }
}

@Composable
private fun Quiet(message: String) {
    val theme = LocalPersonalTheme.current
    Text(message, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp)
}

@Composable
fun DecisionFlow(
    page: DecisionPage,
    decisionId: String,
    store: UiSessionStore,
    api: MonytixApi,
    token: suspend (Boolean) -> String?,
    onBack: () -> Unit,
    onContinue: () -> Unit,
    onConfirm: () -> Unit,
    onSave: () -> Unit,
) {
    val theme = LocalPersonalTheme.current
    val scope = rememberCoroutineScope()
    val weights = store.decisionScreen(decisionId)?.let { DecisionWeights.parse(it) } ?: DecisionWeights.empty()
    var selected by remember(decisionId) { mutableStateOf<Int?>(null) }
    var reason by remember { mutableStateOf("") }
    var posting by remember { mutableStateOf(false) }
    val title = when (page) {
        DecisionPage.Weigh -> "Weigh your options"
        DecisionPage.Confirm -> "Mark your decision"
        else -> "Next step"
    }
    val choice = selected?.let { weights.choices.getOrNull(it) }
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
            Column {
                Text(title, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 22.sp)
                weights.title?.let { Text(it, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp) }
            }
        }
        when (page) {
            DecisionPage.Weigh -> WeighBody(weights, selected, onSelect = { selected = it }, onContinue = onContinue)
            DecisionPage.Confirm -> ConfirmBody(
                weights = weights,
                choice = choice,
                reason = reason,
                posting = posting,
                onReason = { reason = it },
                onConfirm = {
                    scope.launch {
                        if (post(api, token, decisionId, "ACCEPT", choice?.id) { posting = it }) {
                            store.prefetch()
                            onConfirm()
                        }
                    }
                },
                onSave = {
                    scope.launch {
                        if (post(api, token, decisionId, "SNOOZE", null) { posting = it }) {
                            store.prefetch()
                            onSave()
                        }
                    }
                },
            )
            DecisionPage.Solutions -> SolutionsBody(weights, choice)
            DecisionPage.Home -> Unit
        }
    }
}

private suspend fun post(
    api: MonytixApi,
    token: suspend (Boolean) -> String?,
    decisionId: String,
    action: String,
    optionId: String?,
    posting: (Boolean) -> Unit,
): Boolean {
    posting(true)
    val body = JSONObject().put("action", action)
    if (action == "ACCEPT" && optionId != null) body.put("selected_option_id", optionId)
    val result = api.submit(
        "POST",
        "/v1/decisions/$decisionId/actions",
        body.toString(),
        "decision-${action.lowercase()}-$decisionId-${optionId ?: "later"}",
        token,
    )
    posting(false)
    return result.status in 200..299
}

@Composable
private fun WeighBody(weights: DecisionWeights, selected: Int?, onSelect: (Int) -> Unit, onContinue: () -> Unit) {
    val theme = LocalPersonalTheme.current
    if (weights.choices.isEmpty()) {
        Quiet("This choice is not available yet.")
        return
    }
    weights.question?.let { Text(it, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 16.sp) }
    weights.context?.let { Text(it, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp) }
    Card {
        Text("THE TRADE-OFF", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 12.sp)
        Text(weights.tradeoffTitle ?: "What are you balancing?", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 16.sp)
        Text(weights.tradeoffDescription ?: "Every option moves the balance between money you can use now and protection you build for later.", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("FLEXIBILITY NOW", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 12.sp)
            Text("SAFETY LATER", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 12.sp)
        }
        Meter(0.5f)
    }
    Text("1. See what each choice changes", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 16.sp)
    weights.choices.forEachIndexed { index, choice ->
        val on = selected == index
        Card(
            Modifier
                .border(if (on) 2.dp else 1.dp, if (on) theme.action.default else theme.palette.border, RoundedCornerShape(PersonalRadius.card))
                .clickable { onSelect(index) },
        ) {
            choice.approach?.let { Text(it.uppercase(), color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 12.sp) }
            Text(choice.name ?: "Choice", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 16.sp)
            if (choice.amount != null && choice.amount != choice.name) {
                Text(choice.amount, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp)
            }
            choice.meters.forEach { meter ->
                Text(meter.label, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
                Meter(meter.fraction)
            }
            choice.outcomes.forEach { Text(it, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp) }
            choice.hint?.let { Text(it, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp) }
        }
    }
    Text("2. Tell Monytix what matters to you", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 16.sp)
    weights.weights.forEach { line ->
        Card {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(line.name ?: "Weight", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                Text(line.priority ?: "MEDIUM", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 13.sp)
            }
            line.meaning?.let { Text(it, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp) }
            Meter(line.importance)
        }
    }
    selected?.let { weights.choices.getOrNull(it) }?.let { choice ->
        Card {
            Text("Selected choice", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
            Text(choice.name ?: "Choice", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 16.sp)
            choice.outcomes.forEach { Text(it, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp) }
        }
    }
    Gold("Continue with selected choice", enabled = selected != null, onClick = onContinue)
}

@Composable
private fun ConfirmBody(
    weights: DecisionWeights,
    choice: ChoiceLine?,
    reason: String,
    posting: Boolean,
    onReason: (String) -> Unit,
    onConfirm: () -> Unit,
    onSave: () -> Unit,
) {
    val theme = LocalPersonalTheme.current
    Text("Confirm the choice you want to carry forward", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp)
    Card {
        Text("YOUR CHOICE", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 12.sp)
        Text(choice?.name ?: "Choose an option first", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 16.sp)
        choice?.approach?.let { Text(it, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp) }
        choice?.outcomes?.forEach { Text(it, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp) }
    }
    Card {
        Text("What you weighted most", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
        Text(weights.mattered ?: "The weights you marked highest are the ones this choice carries forward.", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp)
        Text("Expected outcomes", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
        weights.expected.forEach { Text(it, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp) }
    }
    Text("Add your reason · optional", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
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
                Text("I chose this because…", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp)
            }
            inner()
        },
    )
    Text("Confirm this decision", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 16.sp)
    Gold("Confirm decision →", enabled = choice != null && !posting, onClick = onConfirm)
    Text("Mark it for later", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 16.sp)
    Gold("Save for later", enabled = !posting, onClick = onSave)
}

@Composable
private fun SolutionsBody(weights: DecisionWeights, choice: ChoiceLine?) {
    val theme = LocalPersonalTheme.current
    Text("Your decision created a financial need", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp)
    Card {
        Text("DECISION MARKED", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 12.sp)
        Text(choice?.name ?: weights.question ?: "Decision marked", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 16.sp)
        Text("Decision → Need → Solution options", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp)
        weights.context?.let { Text(it, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp) }
    }
    Text("Ways to fulfil this decision", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 16.sp)
    if (weights.solutions.isEmpty()) {
        Quiet("This choice is not available yet.")
    } else {
        weights.solutions.forEach { way ->
            Card {
                Text(way.title ?: "Way to fulfil it", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                way.tag?.let { Text(it, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 13.sp) }
                way.detail?.let { Text(it, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp) }
            }
        }
    }
    Card {
        Text("Why you are seeing these", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 16.sp)
        Text(weights.transparency ?: "These options follow from the decision you already made. Monytix does not create a Decision because a product is available.", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp)
    }
    Card {
        Text("Choosing a product is optional", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 16.sp)
        Text(weights.optionalNote ?: "Your Decision is still complete. You can return to these options later.", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp)
    }
}

@Composable
private fun Meter(fraction: Float) {
    val theme = LocalPersonalTheme.current
    Box(Modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(PersonalRadius.pill)).background(theme.palette.border)) {
        Box(Modifier.fillMaxHeight().fillMaxWidth(fraction.coerceAtLeast(0.04f)).background(theme.action.default))
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
private fun Gold(label: String, enabled: Boolean = true, onClick: () -> Unit) {
    val theme = LocalPersonalTheme.current
    Box(
        Modifier
            .fillMaxWidth()
            .height(48.dp)
            .clip(RoundedCornerShape(PersonalRadius.action))
            .background(theme.action.default.copy(alpha = if (enabled) 1f else 0.4f))
            .clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, color = theme.action.label, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 15.sp)
    }
}
