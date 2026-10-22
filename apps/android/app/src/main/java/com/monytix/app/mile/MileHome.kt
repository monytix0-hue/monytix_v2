package com.monytix.app.mile

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
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.monytix.app.R
import com.monytix.app.auth.MonytixApi
import com.monytix.app.shell.UiSessionStore
import com.monytix.app.theme.FigIcon
import com.monytix.app.theme.LocalPersonalTheme
import com.monytix.app.theme.PersonalRadius
import com.monytix.app.theme.PersonalSpace
import org.json.JSONObject

enum class MileStep { Outcomes, Outcome, Trace, Report, Lifetime }

private const val Unavailable = "Unavailable"

private data class Family(val name: String, val line: String)

private val families = listOf(
    Family("Safety", "Protection & resilience"),
    Family("Debt", "Commitments reduced"),
    Family("Savings", "Cash retained"),
    Family("Wealth", "Future assets built"),
    Family("Opportunity", "New capacity opened"),
    Family("Freedom", "More financial flexibility"),
)

private val homeMix = listOf("Protected", "Debt", "Saved", "Wealth")

private data class MileOutcome(
    val id: String,
    val title: String?,
    val line: String?,
    val amount: String?,
    val miles: String?,
    val share: String?,
)

private data class MileMonth(val label: String, val value: String?)

private data class MileSummary(
    val period: String?,
    val distance: String?,
    val distanceLine: String?,
    val months: List<MileMonth>,
    val impact: String?,
    val impactLine: String?,
    val outcomes: List<MileOutcome>,
    val movement: String?,
    val reportYear: String?,
    val reportDistance: String?,
    val reportImpact: String?,
    val reportLine: String?,
    val lifetimeDistance: String?,
    val lifetimeImpact: String?,
    val lifetimeLine: String?,
) {
    companion object {
        fun empty() = MileSummary(null, null, null, emptyList(), null, null, emptyList(), null, null, null, null, null, null, null, null)

        fun parse(json: String?): MileSummary {
            if (json.isNullOrBlank()) return empty()
            return try {
                val root = JSONObject(json)
                val distance = field(root, "distance")
                val impact = field(root, "impact")
                val movement = field(root, "movement")
                val report = field(root, "report")
                val lifetime = field(root, "lifetime")
                MileSummary(
                    period = field(root, "period")?.optString("label").orEmpty().ifBlank { null },
                    distance = text(distance, "value"),
                    distanceLine = text(distance, "line"),
                    months = months(root),
                    impact = text(impact, "amount"),
                    impactLine = text(impact, "line"),
                    outcomes = outcomes(root),
                    movement = text(movement, "line"),
                    reportYear = text(report, "year"),
                    reportDistance = text(report, "distance"),
                    reportImpact = text(report, "impact"),
                    reportLine = text(report, "line"),
                    lifetimeDistance = text(lifetime, "distance"),
                    lifetimeImpact = text(lifetime, "impact"),
                    lifetimeLine = text(lifetime, "line"),
                )
            } catch (_: Exception) {
                empty()
            }
        }
    }
}

private data class MileEvent(val id: String, val title: String?, val line: String?, val miles: String?)

private data class MileTrace(
    val title: String?,
    val line: String?,
    val miles: String?,
    val whenLabel: String?,
    val changed: String?,
    val decisionId: String?,
    val decision: String?,
)

private fun field(root: JSONObject, key: String): JSONObject? {
    val value = root.optJSONObject(key) ?: return null
    return if (value.optBoolean("available")) value else null
}

private fun text(obj: JSONObject?, key: String): String? = obj?.optString(key).orEmpty().ifBlank { null }

private fun months(root: JSONObject): List<MileMonth> {
    val rows = root.optJSONArray("months") ?: return emptyList()
    return buildList {
        for (index in 0 until rows.length()) {
            val row = rows.optJSONObject(index) ?: continue
            val label = row.optString("label")
            if (label.isBlank()) continue
            add(MileMonth(label, text(row, "value")))
        }
    }
}

private fun outcomes(root: JSONObject): List<MileOutcome> {
    val rows = root.optJSONArray("outcomes") ?: return emptyList()
    return buildList {
        for (index in 0 until rows.length()) {
            val row = rows.optJSONObject(index) ?: continue
            val id = row.optString("id")
            if (id.isBlank()) continue
            add(MileOutcome(id, text(row, "title"), text(row, "line"), text(row, "amount"), text(row, "miles"), text(row, "share")))
        }
    }
}

private fun events(json: String?): List<MileEvent> {
    if (json.isNullOrBlank()) return emptyList()
    return try {
        val rows = JSONObject(json).optJSONArray("events") ?: return emptyList()
        buildList {
            for (index in 0 until rows.length()) {
                val row = rows.optJSONObject(index) ?: continue
                val id = row.optString("id")
                if (id.isBlank()) continue
                add(MileEvent(id, text(row, "title"), text(row, "line"), text(row, "miles")))
            }
        }
    } catch (_: Exception) {
        emptyList()
    }
}

private fun trace(json: String?): MileTrace? {
    if (json.isNullOrBlank()) return null
    return try {
        val event = JSONObject(json).optJSONObject("event") ?: return null
        val id = event.optString("id")
        if (id.isBlank()) return null
        MileTrace(
            text(event, "title"),
            text(event, "line"),
            text(event, "miles"),
            text(event, "when"),
            text(event, "changed"),
            text(event, "decision_id"),
            text(event, "decision"),
        )
    } catch (_: Exception) {
        null
    }
}

private fun MileSummary.outcome(name: String): MileOutcome? =
    outcomes.firstOrNull { it.title.equals(name, ignoreCase = true) }

@Composable
fun MileHome(
    store: UiSessionStore,
    onOutcomes: () -> Unit,
    onTrace: (String) -> Unit,
    onReport: () -> Unit,
    onLifetime: () -> Unit,
) {
    val summary = remember(store.mileSummaryJson) { MileSummary.parse(store.mileSummaryJson) }
    val recent = remember(store.mileEventsJson) { events(store.mileEventsJson) }
    LaunchedEffect(store) {
        if (!store.mileReady) store.refreshMile()
    }
    val theme = LocalPersonalTheme.current
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = PersonalSpace.s28)
            .padding(top = PersonalSpace.s20, bottom = 128.dp),
        verticalArrangement = Arrangement.spacedBy(PersonalSpace.s20),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(PersonalSpace.s8)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text("M.I.L.E.", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.ExtraBold, fontSize = 22.sp)
                Pill(summary.period ?: Unavailable)
            }
            Text("Money Impact & Life Evolution", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 14.sp)
        }
        Card {
            Eyebrow("YOUR RECENT FINANCIAL DISTANCE")
            Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(PersonalSpace.s8)) {
                Text(summary.distance ?: Unavailable, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
                Text("MILES", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 13.sp)
            }
            Text(summary.distanceLine ?: Unavailable, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 14.sp)
            if (summary.months.isEmpty()) {
                Text(Unavailable, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
            } else {
                summary.months.forEach { month ->
                    Text("${month.label} · ${month.value ?: Unavailable}", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
                }
            }
            Link("View lifetime journey", onLifetime)
        }
        Card {
            Eyebrow("POSITIVE FINANCIAL IMPACT")
            Text(summary.impact ?: Unavailable, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
            Text(summary.impactLine ?: "positive financial impact", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 14.sp)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(PersonalSpace.s8)) {
                homeMix.forEach { name ->
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(summary.outcome(name)?.amount ?: Unavailable, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                        Text(name, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 12.sp)
                    }
                }
            }
            Gold("See where your impact came from  →", onOutcomes)
        }
        Card {
            Eyebrow("HOW YOUR FINANCIAL LIFE IS MOVING")
            Text(summary.movement ?: Unavailable, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
            Text(Unavailable, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 14.sp)
        }
        Card {
            Eyebrow("RECENT MILES")
            Text("What actually moved you forward", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 14.sp)
            if (recent.isEmpty()) {
                EventRow(R.drawable.fig_shield_check, null, null, null)
            } else {
                recent.forEachIndexed { index, event ->
                    val icon = listOf(R.drawable.fig_shield_check, R.drawable.fig_credit_card, R.drawable.fig_utensils)[index % 3]
                    EventRow(icon, event.title, event.line, event.miles) { onTrace(event.id) }
                }
            }
            Link("See every MILE", onOutcomes)
        }
        Card(Modifier.clickable(onClick = onReport)) {
            Eyebrow(summary.reportYear?.let { "YOUR $it M.I.L.E. REPORT" } ?: "YOUR M.I.L.E. REPORT")
            Text("See the year your money changed.", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
            Text("Decisions · Missions · Impact · Evolution", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
        }
    }
}

@Composable
fun MileSheets(
    api: MonytixApi,
    token: suspend (Boolean) -> String?,
    stack: List<MileStep>,
    outcomeId: String,
    eventId: String,
    onChange: (List<MileStep>) -> Unit,
    onOutcome: (String) -> Unit,
    onOpenDecision: (String) -> Unit,
) {
    val step = stack.lastOrNull() ?: return
    val theme = LocalPersonalTheme.current
    var summary by remember { mutableStateOf(MileSummary.empty()) }
    var detail by remember { mutableStateOf<MileTrace?>(null) }
    LaunchedEffect(api, eventId) {
        summary = MileSummary.parse(api.getJson("/v1/mile/summary", token))
        detail = if (eventId.isBlank()) null else trace(api.getJson("/v1/mile/events/$eventId", token))
    }
    val outcome = summary.outcomes.firstOrNull { it.id == outcomeId }
    fun pop() { onChange(stack.dropLast(1)) }
    Box(Modifier.fillMaxSize()) {
        Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.55f)).clickable { pop() })
        Column(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .fillMaxHeight(0.92f)
                .clip(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp))
                .background(theme.palette.sheet)
                .verticalScroll(rememberScrollState())
                .navigationBarsPadding()
                .padding(PersonalSpace.s20),
            verticalArrangement = Arrangement.spacedBy(PersonalSpace.s16),
        ) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text(sheetTitle(step, outcome, detail), color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 22.sp, modifier = Modifier.weight(1f))
                CircleButton(::pop) {
                    Icon(Icons.Outlined.Close, contentDescription = "Close", tint = theme.palette.textPrimary)
                }
            }
            when (step) {
                MileStep.Outcomes -> OutcomesBody(summary, onOutcome)
                MileStep.Outcome -> OutcomeBody(outcome)
                MileStep.Trace -> TraceBody(detail, onOpenDecision)
                MileStep.Report -> ReportBody(summary)
                MileStep.Lifetime -> LifetimeBody(summary)
            }
        }
    }
}

private fun sheetTitle(step: MileStep, outcome: MileOutcome?, detail: MileTrace?): String = when (step) {
    MileStep.Outcomes -> "M.I.L.E. outcomes"
    MileStep.Outcome -> outcome?.title ?: Unavailable
    MileStep.Trace -> "M.I.L.E. event trace"
    MileStep.Report -> "M.I.L.E. report"
    MileStep.Lifetime -> "Lifetime M.I.L.E."
}

@Composable
private fun OutcomesBody(summary: MileSummary, onOpen: (String) -> Unit) {
    val theme = LocalPersonalTheme.current
    Text(summary.period ?: Unavailable, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 14.sp)
    Text("IMPACT FROM YOUR ACTIONS", color = eyebrow(), fontFamily = theme.fontFamily, fontWeight = FontWeight.ExtraBold, fontSize = 13.sp)
    Text(summary.impact ?: Unavailable, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
    Text(summary.impactLine ?: "Positive financial impact", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 14.sp)
    Text("THIS IMPACT EARNED YOU", color = eyebrow(), fontFamily = theme.fontFamily, fontWeight = FontWeight.ExtraBold, fontSize = 13.sp)
    Text(summary.distance ?: Unavailable, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
    Text("IMPACT BREAKDOWN", color = eyebrow(), fontFamily = theme.fontFamily, fontWeight = FontWeight.ExtraBold, fontSize = 13.sp)
    families.forEach { family ->
        val match = summary.outcome(family.name)
        FamilyRow(family, match?.amount, match?.id?.let { { onOpen(it) } })
    }
}

@Composable
private fun OutcomeBody(outcome: MileOutcome?) {
    val theme = LocalPersonalTheme.current
    Text(outcome?.line ?: Unavailable, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 14.sp)
    Text(outcome?.amount ?: Unavailable, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
    Text(outcome?.share ?: Unavailable, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 14.sp)
    Text("THIS IMPACT EARNED YOU", color = eyebrow(), fontFamily = theme.fontFamily, fontWeight = FontWeight.ExtraBold, fontSize = 13.sp)
    Text(outcome?.miles ?: Unavailable, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
    Text("HOW THIS IMPACT WAS CREATED", color = eyebrow(), fontFamily = theme.fontFamily, fontWeight = FontWeight.ExtraBold, fontSize = 13.sp)
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(PersonalSpace.s8)) {
        listOf("Impact" to outcome?.amount, "MILES" to outcome?.miles, "Actions" to null).forEach { (label, value) ->
            Card(Modifier.weight(1f)) {
                Text(value ?: Unavailable, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                Text(label, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 12.sp)
            }
        }
    }
    Text("KEY DRIVERS", color = eyebrow(), fontFamily = theme.fontFamily, fontWeight = FontWeight.ExtraBold, fontSize = 13.sp)
    Text(Unavailable, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 14.sp)
    Text("RECENT ACTIONS", color = eyebrow(), fontFamily = theme.fontFamily, fontWeight = FontWeight.ExtraBold, fontSize = 13.sp)
    Text(Unavailable, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 14.sp)
}

@Composable
private fun TraceBody(detail: MileTrace?, onOpenDecision: (String) -> Unit) {
    val theme = LocalPersonalTheme.current
    Text(detail?.miles ?: Unavailable, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
    Text(detail?.title ?: Unavailable, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 16.sp)
    Text(detail?.line ?: Unavailable, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 14.sp)
    Text(detail?.whenLabel ?: Unavailable, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
    Text("WHAT CHANGED", color = eyebrow(), fontFamily = theme.fontFamily, fontWeight = FontWeight.ExtraBold, fontSize = 13.sp)
    Text(detail?.changed ?: Unavailable, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 14.sp)
    Text("WHY THESE MILES EXIST", color = eyebrow(), fontFamily = theme.fontFamily, fontWeight = FontWeight.ExtraBold, fontSize = 13.sp)
    Text(detail?.decision ?: Unavailable, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 14.sp)
    val decisionId = detail?.decisionId
    if (decisionId != null) {
        Gold("View decision details") { onOpenDecision(decisionId) }
    } else {
        Text("View decision details", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 14.sp)
        Text(Unavailable, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
    }
}

@Composable
private fun ReportBody(summary: MileSummary) {
    val theme = LocalPersonalTheme.current
    Text(summary.reportYear ?: Unavailable, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 14.sp)
    Text("Your M.I.L.E.", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 16.sp)
    Text(summary.reportLine ?: Unavailable, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 14.sp)
    Text(summary.reportDistance ?: Unavailable, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
    Text("MILES travelled this year", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
    Text(summary.reportImpact ?: Unavailable, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 14.sp)
    Text("YOUR YEAR IN NUMBERS", color = eyebrow(), fontFamily = theme.fontFamily, fontWeight = FontWeight.ExtraBold, fontSize = 13.sp)
    listOf("Money protected", "Debt reduced", "Money saved", "Wealth built", "Decisions carried through", "Missions advanced", "Milestones reached").forEach { label ->
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(label, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 14.sp)
            Text(Unavailable, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 14.sp)
        }
    }
    Text("BIGGEST EVOLUTION", color = eyebrow(), fontFamily = theme.fontFamily, fontWeight = FontWeight.ExtraBold, fontSize = 13.sp)
    Text(Unavailable, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 14.sp)
}

@Composable
private fun LifetimeBody(summary: MileSummary) {
    val theme = LocalPersonalTheme.current
    Text("Your Financial Journey", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 16.sp)
    Text(summary.lifetimeLine ?: "Your financial evolution doesn't reset each year. It keeps building.", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 14.sp)
    Text(summary.lifetimeDistance ?: Unavailable, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
    Text("Lifetime MILES", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
    Text(summary.lifetimeImpact ?: Unavailable, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 14.sp)
    Text("DISTANCE BY YEAR", color = eyebrow(), fontFamily = theme.fontFamily, fontWeight = FontWeight.ExtraBold, fontSize = 13.sp)
    Text(Unavailable, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 14.sp)
    Text("WHAT BUILT YOUR DISTANCE", color = eyebrow(), fontFamily = theme.fontFamily, fontWeight = FontWeight.ExtraBold, fontSize = 13.sp)
    listOf("Safety & resilience", "Debt & commitments", "Saving & cash flow", "Wealth building").forEach { label ->
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(label, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 14.sp)
            Text(Unavailable, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 14.sp)
        }
    }
}

@Composable
private fun FamilyRow(family: Family, amount: String?, onOpen: (() -> Unit)?) {
    val theme = LocalPersonalTheme.current
    val modifier = if (onOpen == null) Modifier else Modifier.clickable(onClick = onOpen)
    Row(
        modifier.fillMaxWidth().then(Modifier),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f).then(modifier), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(family.name, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 15.sp)
            Text(family.line, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
        }
        Text(amount ?: Unavailable, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 14.sp)
    }
}

@Composable
private fun EventRow(icon: Int, title: String?, line: String?, miles: String?, onOpen: (() -> Unit)? = null) {
    val theme = LocalPersonalTheme.current
    Row(
        Modifier
            .fillMaxWidth()
            .then(if (onOpen == null) Modifier else Modifier.clickable(onClick = onOpen)),
        horizontalArrangement = Arrangement.spacedBy(PersonalSpace.s12),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        FigIcon(icon, 28.dp)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title ?: Unavailable, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 15.sp)
            Text(line ?: Unavailable, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
        }
        Text(miles ?: Unavailable, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 13.sp)
    }
}

@Composable
private fun eyebrow() = with(LocalPersonalTheme.current) {
    if (isDark) palette.popoverBorder else palette.textPrimary
}

@Composable
private fun Eyebrow(label: String) {
    Text(label, color = eyebrow(), fontFamily = LocalPersonalTheme.current.fontFamily, fontWeight = FontWeight.ExtraBold, fontSize = 13.sp)
}

@Composable
private fun Pill(label: String) {
    val theme = LocalPersonalTheme.current
    Text(
        label,
        modifier = Modifier
            .clip(CircleShape)
            .background(if (theme.isDark) theme.palette.surfaceRaised else theme.status.lavender)
            .padding(horizontal = PersonalSpace.s12, vertical = PersonalSpace.s8),
        color = if (theme.isDark) theme.palette.popoverBorder else theme.palette.textPrimary,
        fontFamily = theme.fontFamily,
        fontWeight = FontWeight.Bold,
        fontSize = 12.sp,
    )
}

@Composable
private fun Card(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    val theme = LocalPersonalTheme.current
    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(PersonalRadius.card))
            .background(theme.palette.surface)
            .border(1.dp, theme.palette.border, RoundedCornerShape(PersonalRadius.card))
            .padding(PersonalSpace.s16),
        verticalArrangement = Arrangement.spacedBy(PersonalSpace.s8),
        content = { content() },
    )
}

@Composable
private fun Gold(label: String, onClick: () -> Unit) {
    val theme = LocalPersonalTheme.current
    Box(
        modifier = Modifier.fillMaxWidth().height(48.dp).clip(RoundedCornerShape(PersonalRadius.action)).background(theme.action.default).clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, color = theme.action.label, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 15.sp)
    }
}

@Composable
private fun Link(label: String, onClick: () -> Unit) {
    val theme = LocalPersonalTheme.current
    Text(
        "$label  →",
        color = theme.palette.textPrimary,
        fontFamily = theme.fontFamily,
        fontWeight = FontWeight.SemiBold,
        fontSize = 14.sp,
        modifier = Modifier.clickable(onClick = onClick),
    )
}

@Composable
private fun CircleButton(onClick: () -> Unit, content: @Composable () -> Unit) {
    val theme = LocalPersonalTheme.current
    Box(
        modifier = Modifier.size(40.dp).clip(CircleShape).background(theme.palette.surface).border(1.dp, theme.palette.border, CircleShape).clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
        content = { content() },
    )
}
